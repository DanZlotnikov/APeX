-- APeX · Security Hardening (pre-beta audit)
-- Run this AFTER 018_manager_routine_rearchitecture.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Closes three holes found in a full "assume a hostile client with only the
-- anon key" RLS re-audit before beta launch. See SECURITY_APP_STORE_AUDIT.md
-- at the repo root for the full write-up.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. profiles.role / profiles.team_id were freely client-updatable ────────
-- The only UPDATE policy on profiles (001_schema.sql) is
-- `USING (id = auth.uid()) WITH CHECK (id = auth.uid())` — that only ensures
-- you can't hijack someone ELSE's row, it does nothing to stop you from
-- rewriting your OWN row's role/team_id. Since every other table's RLS
-- (my_team_id(), the manager-role checks in mark_athlete_injured/recovered,
-- team_routines, athlete_exercise_assignments, notifications, etc.) trusts
-- profiles.role/team_id as ground truth, this was a full privilege-escalation
-- path: any authenticated user could directly
--   UPDATE profiles SET role = 'manager', team_id = '<any-team-uuid>' WHERE id = auth.uid()
-- and become a manager of an arbitrary team with zero invite/authorization.
--
-- Fixed via trigger rather than an RLS WITH CHECK subquery, to sidestep any
-- ambiguity about old-vs-new row visibility in a self-referential subquery —
-- a BEFORE UPDATE trigger's OLD/NEW are unambiguous. No legitimate code path
-- ever updates role/team_id post-creation (both are set once, at INSERT time,
-- by create_manager_team / join_team_as_athlete / create_individual_athlete)
-- so this can safely hard-block ANY change to these two columns, always —
-- including via the service-role key, which bypasses RLS but not triggers,
-- so this is also a defense-in-depth backstop against a buggy admin script.

CREATE OR REPLACE FUNCTION public.prevent_profile_role_team_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.team_id IS DISTINCT FROM OLD.team_id THEN
    RAISE EXCEPTION 'role and team_id cannot be changed after account creation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_lock_role_team
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_role_team_change();

-- ── 2. video_jobs.raw_video_path was unsanitized, attacker-controlled ───────
-- The app sets this client-side before INSERT (mobile/src/api/videoJobs.ts),
-- and the only INSERT policy (009_video_jobs_pipeline.sql) checks
-- `athlete_id = auth.uid()` but never validates raw_video_path's VALUE. The
-- worker (backend/server/supabase_client.py's download_object/delete_object)
-- builds a Storage URL by directly interpolating this string and calls it
-- with the SERVICE ROLE key. Confirmed two exploitable consequences:
--   (a) IDOR: set raw_video_path to another athlete's real object path — the
--       worker downloads/processes/serves back a stranger's private video,
--       and cancelling the job deletes the victim's file outright.
--   (b) Path traversal / SSRF: a raw_video_path containing "../" segments
--       gets collapsed by httpx's URL normalization (confirmed against the
--       vendored httpx source, _urlparse.py's normalize_path()) BEFORE the
--       request is sent, meaning a crafted value can escape the intended
--       /storage/v1/object/{bucket}/ prefix and hit ARBITRARY REST/Storage/
--       Auth-admin endpoints on the same Supabase project, authenticated
--       with the service-role key.
-- Fixed at the DB layer (belt-and-suspenders alongside the Python-side check
-- in supabase_worker.py) so it's enforced regardless of which code path ever
-- inserts a row: raw_video_path must be exactly "raw/<own athlete_id>/" plus
-- a safe-charset filename plus a short extension — nothing else can match,
-- so neither a stranger's path nor a traversal payload can ever be stored.

ALTER TABLE public.video_jobs
  ADD CONSTRAINT video_jobs_raw_video_path_format
  CHECK (raw_video_path ~ ('^raw/' || athlete_id::text || '/[A-Za-z0-9_-]+\.[A-Za-z0-9]{2,5}$'));

-- ── 3. notifications: any team member could INSERT arbitrary fabricated ─────
-- notifications for their own team (fake message text, spoofed athlete_id
-- pointing at a teammate, severity='critical' to trigger the alert badge,
-- session_id referencing a session that isn't theirs). The legitimate path
-- (save_video_job, SECURITY DEFINER) doesn't need or use this client-facing
-- policy — it bypasses RLS entirely — and the one client-side caller that
-- did (mobile/src/api/notifications.ts's createNotification) is dead code,
-- only reachable from the retired on-device flow. Safe to drop outright.

DROP POLICY IF EXISTS "team notifications insert" ON public.notifications;

-- ── 4. sessions / session_metrics: athlete had full client-side write ───────
-- access (INSERT/UPDATE, not just SELECT/DELETE) via a "FOR ALL" policy, left
-- over from before save_video_job (SECURITY DEFINER) became the only
-- legitimate way to create a session. That FOR ALL scope let an athlete
-- fabricate their own readiness data via a raw API call, bypassing the
-- pipeline entirely (self-data-integrity issue, not a cross-account one,
-- but worth closing while everything else is being tightened). DELETE stays
-- (mobile/src/api/sessions.ts's deleteSession is a real, used feature).

DROP POLICY IF EXISTS "athlete owns sessions" ON public.sessions;
CREATE POLICY "athlete reads own sessions" ON public.sessions
  FOR SELECT USING (athlete_id = auth.uid());
CREATE POLICY "athlete deletes own sessions" ON public.sessions
  FOR DELETE USING (athlete_id = auth.uid());

DROP POLICY IF EXISTS "athlete owns session metrics" ON public.session_metrics;
CREATE POLICY "athlete reads own session metrics" ON public.session_metrics
  FOR SELECT USING (
    (SELECT athlete_id FROM public.sessions WHERE id = session_metrics.session_id) = auth.uid()
  );
