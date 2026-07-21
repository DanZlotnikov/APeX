-- APeX · Combined Migration
-- Paste this entire file in Supabase Dashboard → SQL Editor → New query, then click Run.
-- Then run: npm run seed   (from the mobile/ directory)
-- ─────────────────────────────────────────────────────────────────────────────

-- APeX · Initial Schema
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Teams ────────────────────────────────────────────────────────────────────

CREATE TABLE public.teams (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.team_settings (
  team_id                UUID PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  readiness_threshold    INT  NOT NULL DEFAULT 75,
  max_lr_imbalance       INT  NOT NULL DEFAULT 15,
  required_tests_per_day INT  NOT NULL DEFAULT 3,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.required_tests (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0
);

-- ── Users ────────────────────────────────────────────────────────────────────

-- One row per Supabase auth user; id mirrors auth.users.id
CREATE TABLE public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('athlete', 'manager')),
  team_id    UUID REFERENCES public.teams(id),
  full_name  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Physical attributes — only for athletes
CREATE TABLE public.athlete_profiles (
  id            UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  height_cm     INT,
  weight_kg     INT,
  position      TEXT,
  date_of_birth DATE
);

-- ── Sessions ─────────────────────────────────────────────────────────────────

CREATE TABLE public.sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exercise_type      TEXT NOT NULL CHECK (exercise_type IN ('squat','deadlift','jump','pullup')),
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rep_count          INT NOT NULL DEFAULT 0,
  readiness_score    INT,               -- 0–100, computed client-side
  video_storage_path TEXT,              -- Supabase Storage key (future)
  analysis_json      JSONB,             -- full Assessment object for audit/replay
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Key-value aggregate metrics extracted from analysis_json for fast queries
CREATE TABLE public.session_metrics (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  metric_key TEXT  NOT NULL,
  value      FLOAT NOT NULL
);

-- ── Notifications ─────────────────────────────────────────────────────────────

CREATE TABLE public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  athlete_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  message    TEXT NOT NULL,
  severity   TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tracks which managers have dismissed which notifications
CREATE TABLE public.notification_reads (
  manager_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (manager_id, notification_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_sessions_athlete_time ON public.sessions (athlete_id, recorded_at DESC);
CREATE INDEX idx_sessions_exercise     ON public.sessions (exercise_type);
CREATE INDEX idx_notif_team_time       ON public.notifications (team_id, created_at DESC);
CREATE INDEX idx_metrics_session       ON public.session_metrics (session_id, metric_key);
CREATE INDEX idx_profiles_team_role    ON public.profiles (team_id, role);

-- ── Trigger: auto-update team_settings.updated_at ────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_team_settings_updated_at
  BEFORE UPDATE ON public.team_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Helper: caller's team_id ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.my_team_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT team_id FROM public.profiles WHERE id = auth.uid()
$$;

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.teams              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.required_tests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_metrics    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

-- teams: members can read their own team
CREATE POLICY "read own team" ON public.teams
  FOR SELECT USING (id = public.my_team_id());

-- team_settings: team members can read; only managers update
CREATE POLICY "read team settings" ON public.team_settings
  FOR SELECT USING (team_id = public.my_team_id());

CREATE POLICY "manager updates team settings" ON public.team_settings
  FOR UPDATE USING (
    team_id = public.my_team_id()
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
  );

-- required_tests: all team members read; managers write
CREATE POLICY "read required tests" ON public.required_tests
  FOR SELECT USING (team_id = public.my_team_id());

CREATE POLICY "manager manages required tests" ON public.required_tests
  FOR ALL USING (
    team_id = public.my_team_id()
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
  ) WITH CHECK (team_id = public.my_team_id());

-- profiles: read all same-team; update own
CREATE POLICY "read team profiles" ON public.profiles
  FOR SELECT USING (team_id = public.my_team_id());

CREATE POLICY "insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "update own profile" ON public.profiles
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- athlete_profiles: athletes own; managers in same team can read
CREATE POLICY "athlete manages own profile" ON public.athlete_profiles
  FOR ALL USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "manager reads team athlete profiles" ON public.athlete_profiles
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND (SELECT team_id FROM public.profiles WHERE id = athlete_profiles.id)
        = public.my_team_id()
  );

-- sessions: athletes own; managers can read team's
CREATE POLICY "athlete owns sessions" ON public.sessions
  FOR ALL USING (athlete_id = auth.uid())
  WITH CHECK (athlete_id = auth.uid());

CREATE POLICY "manager reads team sessions" ON public.sessions
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND (SELECT team_id FROM public.profiles WHERE id = sessions.athlete_id)
        = public.my_team_id()
  );

-- session_metrics: follow session access
CREATE POLICY "athlete owns session metrics" ON public.session_metrics
  FOR ALL USING (
    (SELECT athlete_id FROM public.sessions WHERE id = session_metrics.session_id)
    = auth.uid()
  ) WITH CHECK (
    (SELECT athlete_id FROM public.sessions WHERE id = session_metrics.session_id)
    = auth.uid()
  );

CREATE POLICY "manager reads team session metrics" ON public.session_metrics
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND (
      SELECT team_id FROM public.profiles
      WHERE id = (SELECT athlete_id FROM public.sessions WHERE id = session_metrics.session_id)
    ) = public.my_team_id()
  );

-- notifications: all team members can read; athletes + managers can insert
CREATE POLICY "team notifications read" ON public.notifications
  FOR SELECT USING (team_id = public.my_team_id());

CREATE POLICY "team notifications insert" ON public.notifications
  FOR INSERT WITH CHECK (team_id = public.my_team_id());

-- notification_reads: managers manage their own
CREATE POLICY "own notification reads" ON public.notification_reads
  FOR ALL USING (manager_id = auth.uid())
  WITH CHECK (manager_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- APeX · Invite Codes + Sign-up Functions
-- Run this AFTER 001_schema.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Invite code column on teams ───────────────────────────────────────────────

ALTER TABLE public.teams ADD COLUMN invite_code TEXT;

-- Auto-fill any existing teams (deterministic: based on UUID)
UPDATE public.teams
SET invite_code = upper(substr(md5(id::text), 1, 6))
WHERE invite_code IS NULL;

ALTER TABLE public.teams ALTER COLUMN invite_code SET NOT NULL;
ALTER TABLE public.teams ADD CONSTRAINT teams_invite_code_key UNIQUE (invite_code);

-- ── Public code lookup (used during sign-up, before the user has a profile) ──

CREATE OR REPLACE FUNCTION public.get_team_by_invite_code(p_code TEXT)
RETURNS TABLE(team_id UUID, team_name TEXT) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id, name FROM public.teams WHERE invite_code = upper(trim(p_code));
$$;

-- ── Manager sign-up: create team + profile in one transaction ────────────────

CREATE OR REPLACE FUNCTION public.create_manager_team(p_team_name TEXT, p_full_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_team_id UUID;
  v_code    TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Generate a collision-free 6-char code
  LOOP
    v_code := upper(substr(md5(random()::text || auth.uid()::text || now()::text), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.teams WHERE invite_code = v_code);
  END LOOP;

  INSERT INTO public.teams (name, invite_code) VALUES (p_team_name, v_code) RETURNING id INTO v_team_id;

  INSERT INTO public.team_settings (team_id) VALUES (v_team_id);

  INSERT INTO public.required_tests (team_id, label, enabled, sort_order) VALUES
    (v_team_id, 'Jump Test',      TRUE,  0),
    (v_team_id, 'Squat Test',     TRUE,  1),
    (v_team_id, 'Balance Test',   TRUE,  2),
    (v_team_id, 'Single-Leg Hop', FALSE, 3);

  INSERT INTO public.profiles (id, role, team_id, full_name)
  VALUES (auth.uid(), 'manager', v_team_id, p_full_name);

  RETURN v_team_id;
END;
$$;

-- ── Athlete sign-up: validate invite code + create profile ───────────────────

CREATE OR REPLACE FUNCTION public.join_team_as_athlete(p_invite_code TEXT, p_full_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_team_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id INTO v_team_id
  FROM public.teams WHERE invite_code = upper(trim(p_invite_code));

  IF v_team_id IS NULL THEN RAISE EXCEPTION 'Invalid invite code'; END IF;

  INSERT INTO public.profiles (id, role, team_id, full_name)
  VALUES (auth.uid(), 'athlete', v_team_id, p_full_name);

  INSERT INTO public.athlete_profiles (id) VALUES (auth.uid());

  RETURN v_team_id;
END;
$$;

-- ── Manager: regenerate invite code ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.regenerate_invite_code(p_team_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_code TEXT;
BEGIN
  IF (SELECT role     FROM public.profiles WHERE id = auth.uid()) != 'manager'
  OR (SELECT team_id  FROM public.profiles WHERE id = auth.uid()) != p_team_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  LOOP
    v_code := upper(substr(md5(random()::text || now()::text), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.teams WHERE invite_code = v_code);
  END LOOP;

  UPDATE public.teams SET invite_code = v_code WHERE id = p_team_id;
  RETURN v_code;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- APeX · Exercise Configuration (manager "Exercises" tab)
-- Run this AFTER 001_schema.sql + 002_invite_codes.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Replaces the never-wired-up `required_tests` table and the
-- `team_settings.max_lr_imbalance` / `required_tests_per_day` columns with a
-- real per-exercise configuration: which exercises the team tests, the
-- minimum rep count, and three research-backed metric thresholds each
-- (see mobile/src/utils/exerciseMetrics.ts for the metric catalog + citations
-- — defaults below MUST stay in sync with that file).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── team_exercises ────────────────────────────────────────────────────────────

CREATE TABLE public.team_exercises (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  exercise_key TEXT NOT NULL CHECK (exercise_key IN ('squat','deadlift','jump','pullup')),
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  min_reps     INT NOT NULL DEFAULT 3,
  thresholds   JSONB NOT NULL DEFAULT '{}'::jsonb, -- { "<metricId>": <number>, ... }
  sort_order   INT NOT NULL DEFAULT 0,
  UNIQUE (team_id, exercise_key)
);

CREATE INDEX idx_team_exercises_team ON public.team_exercises (team_id);

-- ── athlete_exercise_assignments ─────────────────────────────────────────────
-- Per-athlete assignment EXCEPTIONS only. No row for an (athlete, exercise)
-- pair means "use team_exercises.enabled" — only explicit overrides live here.

CREATE TABLE public.athlete_exercise_assignments (
  athlete_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exercise_key TEXT NOT NULL CHECK (exercise_key IN ('squat','deadlift','jump','pullup')),
  assigned     BOOLEAN NOT NULL,
  PRIMARY KEY (athlete_id, exercise_key)
);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.team_exercises              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_exercise_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read team exercises" ON public.team_exercises
  FOR SELECT USING (team_id = public.my_team_id());

CREATE POLICY "manager manages team exercises" ON public.team_exercises
  FOR ALL USING (
    team_id = public.my_team_id()
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
  ) WITH CHECK (team_id = public.my_team_id());

CREATE POLICY "athlete reads own assignments" ON public.athlete_exercise_assignments
  FOR SELECT USING (athlete_id = auth.uid());

CREATE POLICY "manager manages team athlete assignments" ON public.athlete_exercise_assignments
  FOR ALL USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND (SELECT team_id FROM public.profiles WHERE id = athlete_exercise_assignments.athlete_id)
        = public.my_team_id()
  ) WITH CHECK (
    (SELECT team_id FROM public.profiles WHERE id = athlete_exercise_assignments.athlete_id)
    = public.my_team_id()
  );

-- ── Backfill default rows for existing teams ─────────────────────────────────

INSERT INTO public.team_exercises (team_id, exercise_key, enabled, min_reps, thresholds, sort_order)
SELECT t.id, x.exercise_key, TRUE, x.min_reps, x.thresholds::jsonb, x.sort_order
FROM public.teams t
CROSS JOIN (VALUES
  ('squat',    5, '{"depth":80,"symmetry":15,"fatigue":30}',  0),
  ('deadlift', 5, '{"hinge":20,"symmetry":20,"fatigue":30}',  1),
  ('jump',     3, '{"landing":65,"symmetry":15,"flightTime":0.40}', 2),
  ('pullup',   3, '{"depth":60,"symmetry":15,"fatigue":30}',  3)
) AS x(exercise_key, min_reps, thresholds, sort_order)
ON CONFLICT (team_id, exercise_key) DO NOTHING;

-- ── create_manager_team: seed team_exercises instead of required_tests ──────

CREATE OR REPLACE FUNCTION public.create_manager_team(p_team_name TEXT, p_full_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_team_id UUID;
  v_code    TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  LOOP
    v_code := upper(substr(md5(random()::text || auth.uid()::text || now()::text), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.teams WHERE invite_code = v_code);
  END LOOP;

  INSERT INTO public.teams (name, invite_code) VALUES (p_team_name, v_code) RETURNING id INTO v_team_id;

  INSERT INTO public.team_settings (team_id) VALUES (v_team_id);

  INSERT INTO public.team_exercises (team_id, exercise_key, enabled, min_reps, thresholds, sort_order) VALUES
    (v_team_id, 'squat',    TRUE, 5, '{"depth":80,"symmetry":15,"fatigue":30}'::jsonb,          0),
    (v_team_id, 'deadlift', TRUE, 5, '{"hinge":20,"symmetry":20,"fatigue":30}'::jsonb,          1),
    (v_team_id, 'jump',     TRUE, 3, '{"landing":65,"symmetry":15,"flightTime":0.40}'::jsonb,   2),
    (v_team_id, 'pullup',   TRUE, 3, '{"depth":60,"symmetry":15,"fatigue":30}'::jsonb,          3);

  INSERT INTO public.profiles (id, role, team_id, full_name)
  VALUES (auth.uid(), 'manager', v_team_id, p_full_name);

  RETURN v_team_id;
END;
$$;

-- ── Drop superseded objects ───────────────────────────────────────────────────

DROP TABLE public.required_tests;

ALTER TABLE public.team_settings
  DROP COLUMN max_lr_imbalance,
  DROP COLUMN required_tests_per_day;

-- ─────────────────────────────────────────────────────────────────────────────
-- APeX · Athlete Injury Tracking
-- ─────────────────────────────────────────────────────────────────────────────
-- "Mark as Injured" doesn't delete any history — it stamps injury_started_at,
-- and the app treats that as a fresh-start cutoff: sessions recorded before it
-- stop counting toward readiness trend / per-exercise readiness / compliance,
-- so the athlete's stats "reset" for a clean injury-recovery track while the
-- pre-injury data stays in the DB for record.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN injured           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN injury_started_at TIMESTAMPTZ;

-- Scoped RPC rather than a broad manager-write RLS policy on profiles — only
-- flips the two injury columns, and only for an athlete on the caller's team.
CREATE OR REPLACE FUNCTION public.mark_athlete_injured(p_athlete_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) != 'manager' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF (SELECT team_id FROM public.profiles WHERE id = p_athlete_id) != public.my_team_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.profiles
  SET injured = TRUE, injury_started_at = NOW()
  WHERE id = p_athlete_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- APeX · Remove Deadlift
-- ─────────────────────────────────────────────────────────────────────────────
-- Deadlift detection intersected too much with squat (torso-lean/hip-angle
-- signature overlap caused frequent misclassification between the two) and has
-- been removed from the analyzer entirely. This removes it from the DB as
-- well: deletes any existing deadlift data, then tightens the exercise-key
-- CHECK constraints so it can never be inserted again.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM public.session_metrics
WHERE metric_key LIKE 'deadlift_%'
   OR session_id IN (SELECT id FROM public.sessions WHERE exercise_type = 'deadlift');

DELETE FROM public.sessions WHERE exercise_type = 'deadlift';

DELETE FROM public.athlete_exercise_assignments WHERE exercise_key = 'deadlift';

DELETE FROM public.team_exercises WHERE exercise_key = 'deadlift';

ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_exercise_type_check,
  ADD  CONSTRAINT sessions_exercise_type_check CHECK (exercise_type IN ('squat','jump','pullup'));

ALTER TABLE public.team_exercises
  DROP CONSTRAINT IF EXISTS team_exercises_exercise_key_check,
  ADD  CONSTRAINT team_exercises_exercise_key_check CHECK (exercise_key IN ('squat','jump','pullup'));

ALTER TABLE public.athlete_exercise_assignments
  DROP CONSTRAINT IF EXISTS athlete_exercise_assignments_exercise_key_check,
  ADD  CONSTRAINT athlete_exercise_assignments_exercise_key_check CHECK (exercise_key IN ('squat','jump','pullup'));

CREATE OR REPLACE FUNCTION public.create_manager_team(p_team_name TEXT, p_full_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_team_id UUID;
  v_code    TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  LOOP
    v_code := upper(substr(md5(random()::text || auth.uid()::text || now()::text), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.teams WHERE invite_code = v_code);
  END LOOP;

  INSERT INTO public.teams (name, invite_code) VALUES (p_team_name, v_code) RETURNING id INTO v_team_id;

  INSERT INTO public.team_settings (team_id) VALUES (v_team_id);

  INSERT INTO public.team_exercises (team_id, exercise_key, enabled, min_reps, thresholds, sort_order) VALUES
    (v_team_id, 'squat',  TRUE, 5, '{"depth":80,"symmetry":15,"fatigue":30}'::jsonb,        0),
    (v_team_id, 'jump',   TRUE, 3, '{"landing":65,"symmetry":15,"flightTime":0.40}'::jsonb, 1),
    (v_team_id, 'pullup', TRUE, 3, '{"depth":60,"symmetry":15,"fatigue":30}'::jsonb,        2);

  INSERT INTO public.profiles (id, role, team_id, full_name)
  VALUES (auth.uid(), 'manager', v_team_id, p_full_name);

  RETURN v_team_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- APeX · Athlete Recovery (end injury tracking)
-- ─────────────────────────────────────────────────────────────────────────────
-- Both transitions (healthy → injured, injured → recovered) now stamp the
-- same `stats_reset_at` cutoff, which the app uses instead of
-- injury_started_at to scope readiness trend / per-exercise readiness /
-- compliance — so switching status in EITHER direction starts a clean stats
-- window from that moment. injury_started_at is left untouched by recovery,
-- purely as a historical "when did the most recent injury begin" record.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN stats_reset_at TIMESTAMPTZ;

UPDATE public.profiles
SET stats_reset_at = injury_started_at
WHERE injured = TRUE AND injury_started_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mark_athlete_injured(p_athlete_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) != 'manager' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF (SELECT team_id FROM public.profiles WHERE id = p_athlete_id) != public.my_team_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.profiles
  SET injured = TRUE, injury_started_at = NOW(), stats_reset_at = NOW()
  WHERE id = p_athlete_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_athlete_recovered(p_athlete_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) != 'manager' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF (SELECT team_id FROM public.profiles WHERE id = p_athlete_id) != public.my_team_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.profiles
  SET injured = FALSE, stats_reset_at = NOW()
  WHERE id = p_athlete_id;
END;
$$;

-- APeX · One session per athlete/exercise/day
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM public.sessions s
WHERE s.id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY athlete_id, exercise_type, ((recorded_at AT TIME ZONE 'UTC')::date)
      ORDER BY recorded_at DESC
    ) AS rn
    FROM public.sessions
  ) ranked
  WHERE ranked.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS sessions_athlete_exercise_day_uniq
  ON public.sessions (athlete_id, exercise_type, ((recorded_at AT TIME ZONE 'UTC')::date));

-- ─────────────────────────────────────────────────────────────────────────────
-- APeX · Individual (teamless) Athletes
-- ─────────────────────────────────────────────────────────────────────────────
-- Lets an athlete sign up without an invite code, as an individual (pro or
-- amateur) with no manager/team — profiles.team_id simply stays NULL. Every
-- team/manager-scoped feature is already keyed off team_id being non-null, so
-- it naturally doesn't apply to these athletes — no new "is individual"
-- column, derived as `team_id IS NULL` wherever the app needs to know.
--
-- Requires one RLS fix: the only existing SELECT policy on `profiles` is
-- team-scoped ("team_id = my_team_id()"), never true when team_id IS NULL
-- (SQL NULL = NULL is not TRUE) — without a standalone "read your own row"
-- policy a teamless athlete's own profile would be invisible to their own
-- client via RLS and they could never get past login.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "read own profile" ON public.profiles
  FOR SELECT USING (id = auth.uid());

-- Mirrors join_team_as_athlete, minus the invite-code/team lookup.
CREATE OR REPLACE FUNCTION public.create_individual_athlete(p_full_name TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  INSERT INTO public.profiles (id, role, team_id, full_name)
  VALUES (auth.uid(), 'athlete', NULL, p_full_name);

  INSERT INTO public.athlete_profiles (id) VALUES (auth.uid());
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- APeX · Async Video Pipeline (video_jobs)
-- ─────────────────────────────────────────────────────────────────────────────
-- See HANDOFF_video_pipeline.md at the repo root for full context, and
-- supabase/functions/notify-video-ready/ for the Edge Function this schema
-- expects — that's deployed separately via `supabase functions deploy`, not
-- part of this SQL, and its Database Webhook is wired up manually in the
-- Dashboard (Database → Webhooks) after deploying.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.video_job_status AS ENUM ('queued', 'processing', 'completed', 'failed');

CREATE TABLE public.video_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status             public.video_job_status NOT NULL DEFAULT 'queued',
  cancel_requested   BOOLEAN NOT NULL DEFAULT FALSE,
  raw_video_path     TEXT NOT NULL,
  result_video_path  TEXT,
  target_exercise_key TEXT,  -- set by the app when recorded for a Today's Task tile; NULL for a free record
  exercise_type      TEXT,
  analysis_json      JSONB,
  duration_sec       NUMERIC NOT NULL,
  recorded_at        TIMESTAMPTZ NOT NULL,
  error_message      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ
);

CREATE INDEX idx_video_jobs_athlete_status ON public.video_jobs (athlete_id, status);

ALTER TABLE public.video_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "athlete reads own video jobs" ON public.video_jobs
  FOR SELECT USING (athlete_id = auth.uid());

CREATE POLICY "athlete inserts own video jobs" ON public.video_jobs
  FOR INSERT WITH CHECK (athlete_id = auth.uid());

INSERT INTO storage.buckets (id, name, public)
VALUES ('exercise-videos', 'exercise-videos', FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "athlete manages own raw videos" ON storage.objects
  FOR ALL USING (
    bucket_id = 'exercise-videos'
    AND (storage.foldername(name))[1] = 'raw'
    AND (storage.foldername(name))[2] = auth.uid()::text
  ) WITH CHECK (
    bucket_id = 'exercise-videos'
    AND (storage.foldername(name))[1] = 'raw'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "athlete reads own processed videos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'exercise-videos'
    AND (storage.foldername(name))[1] = 'processed'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "athlete deletes own processed videos" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'exercise-videos'
    AND (storage.foldername(name))[1] = 'processed'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Re-admits 'deadlift' (new pipeline's 3D detection, unrelated to the old
-- on-device 2D method removed in migration 005) plus push_up/ab_crunch, none
-- of which have a legacy readiness/session_metrics bridge. team_exercises /
-- athlete_exercise_assignments deliberately stay squat/jump/pullup-only.
ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_exercise_type_check,
  ADD  CONSTRAINT sessions_exercise_type_check
    CHECK (exercise_type IN ('squat','jump','pullup','deadlift','push_up','ab_crunch'));

-- New-pipeline sessions leave analysis_json NULL (that shape is the old
-- on-device Assessment, which HistoryDetailScreen.tsx's per-rep trend charts
-- still read for pre-existing sessions) and populate this instead.
ALTER TABLE public.sessions ADD COLUMN biomechanics_json JSONB;

ALTER TABLE public.profiles ADD COLUMN expo_push_token TEXT;

CREATE OR REPLACE FUNCTION public.cancel_video_job(p_job_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status public.video_job_status;
BEGIN
  SELECT status INTO v_status FROM public.video_jobs
  WHERE id = p_job_id AND athlete_id = auth.uid();
  IF v_status IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;

  IF v_status = 'queued' THEN
    DELETE FROM public.video_jobs WHERE id = p_job_id;
  ELSE
    UPDATE public.video_jobs SET cancel_requested = TRUE WHERE id = p_job_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.discard_video_job(p_job_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.video_jobs
  WHERE id = p_job_id AND athlete_id = auth.uid() AND status = 'completed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found or not completed'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_video_job(p_job_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_job           public.video_jobs%ROWTYPE;
  v_legacy        JSONB;
  v_exercise_type TEXT;
  v_rep_count     INT;
  v_readiness     INT;
  v_session_id    UUID;
  v_team_id       UUID;
  v_athlete_name  TEXT;
  v_metric        JSONB;
BEGIN
  SELECT * INTO v_job FROM public.video_jobs
  WHERE id = p_job_id AND athlete_id = auth.uid() AND status = 'completed';
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'Job not found or not completed'; END IF;

  v_legacy := v_job.analysis_json #> '{analyses,legacy_metrics}';

  v_exercise_type := COALESCE(v_legacy ->> 'legacy_exercise_key', v_job.exercise_type);
  v_rep_count      := COALESCE((v_job.analysis_json ->> 'rep_count')::INT, 0);
  v_readiness      := NULLIF(v_legacy ->> 'readiness_score', '')::INT;

  INSERT INTO public.sessions
    (athlete_id, exercise_type, rep_count, readiness_score, biomechanics_json, recorded_at)
  VALUES
    (auth.uid(), v_exercise_type, v_rep_count, v_readiness, v_job.analysis_json, v_job.recorded_at)
  RETURNING id INTO v_session_id;

  IF v_legacy IS NOT NULL THEN
    FOR v_metric IN SELECT * FROM jsonb_array_elements(v_legacy -> 'session_metrics')
    LOOP
      INSERT INTO public.session_metrics (session_id, metric_key, value)
      VALUES (v_session_id, v_metric ->> 'metric_key', (v_metric ->> 'value')::FLOAT);
    END LOOP;
  END IF;

  SELECT team_id, full_name INTO v_team_id, v_athlete_name
  FROM public.profiles WHERE id = auth.uid();

  IF v_team_id IS NOT NULL THEN
    INSERT INTO public.notifications (team_id, athlete_id, session_id, message, severity)
    VALUES (
      v_team_id, auth.uid(), v_session_id,
      v_athlete_name || ' completed a ' || v_exercise_type || ' test',
      'info'
    );
  END IF;

  DELETE FROM public.video_jobs WHERE id = p_job_id;

  RETURN v_session_id;
END;
$$;

-- APeX · Persist the two-panel result video on `sessions`
-- Run this AFTER 009_video_jobs_pipeline.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- save_video_job (009) deletes the video_jobs row once a session is created,
-- which would otherwise strand result_video_path — the Performance/History
-- screen needs it to keep playing the two-panel video after saving. This
-- migration also cements the app's decision to make History a clean
-- new-pipeline-only screen: it no longer reads the old on-device Assessment
-- shape (sessions.analysis_json) at all, only sessions with a non-null
-- biomechanics_json (see mobile/src/api/sessions.ts's getSessionHistory).
-- Old sessions (analysis_json-only, no biomechanics_json) are left in place
-- untouched — they simply won't appear in the app anymore. Nothing here
-- drops or migrates that old data; if you want it purged, do that manually.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sessions ADD COLUMN result_video_path TEXT;

-- Bug fix from 009: cancel_video_job's ELSE branch (anything not 'queued')
-- only ever set cancel_requested, assuming the worker would eventually see
-- it and delete the row. True for 'processing', but a 'failed' row is
-- already terminal — the worker never looks at it again, so the row would
-- sit there forever with cancel_requested=true and never actually go away.
-- The Processing tab's "Remove" button on a failed-job card (checklist item
-- 7) needs failed rows deleted immediately, same as queued.
CREATE OR REPLACE FUNCTION public.cancel_video_job(p_job_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status public.video_job_status;
BEGIN
  SELECT status INTO v_status FROM public.video_jobs
  WHERE id = p_job_id AND athlete_id = auth.uid();
  IF v_status IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;

  IF v_status IN ('queued', 'failed') THEN
    DELETE FROM public.video_jobs WHERE id = p_job_id;
  ELSE
    -- 'processing': can't interrupt mid-GPU-inference. The worker checks
    -- cancel_requested right after claiming and right after finishing, and
    -- deletes the row itself once it notices (see supabase_worker.py).
    UPDATE public.video_jobs SET cancel_requested = TRUE WHERE id = p_job_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_video_job(p_job_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_job           public.video_jobs%ROWTYPE;
  v_legacy        JSONB;
  v_exercise_type TEXT;
  v_rep_count     INT;
  v_readiness     INT;
  v_session_id    UUID;
  v_team_id       UUID;
  v_athlete_name  TEXT;
  v_metric        JSONB;
BEGIN
  SELECT * INTO v_job FROM public.video_jobs
  WHERE id = p_job_id AND athlete_id = auth.uid() AND status = 'completed';
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'Job not found or not completed'; END IF;

  v_legacy := v_job.analysis_json #> '{analyses,legacy_metrics}';

  v_exercise_type := COALESCE(v_legacy ->> 'legacy_exercise_key', v_job.exercise_type);
  v_rep_count      := COALESCE((v_job.analysis_json ->> 'rep_count')::INT, 0);
  v_readiness      := NULLIF(v_legacy ->> 'readiness_score', '')::INT;

  INSERT INTO public.sessions
    (athlete_id, exercise_type, rep_count, readiness_score, biomechanics_json, result_video_path, recorded_at)
  VALUES
    (auth.uid(), v_exercise_type, v_rep_count, v_readiness, v_job.analysis_json, v_job.result_video_path, v_job.recorded_at)
  RETURNING id INTO v_session_id;

  IF v_legacy IS NOT NULL THEN
    FOR v_metric IN SELECT * FROM jsonb_array_elements(v_legacy -> 'session_metrics')
    LOOP
      INSERT INTO public.session_metrics (session_id, metric_key, value)
      VALUES (v_session_id, v_metric ->> 'metric_key', (v_metric ->> 'value')::FLOAT);
    END LOOP;
  END IF;

  SELECT team_id, full_name INTO v_team_id, v_athlete_name
  FROM public.profiles WHERE id = auth.uid();

  IF v_team_id IS NOT NULL THEN
    INSERT INTO public.notifications (team_id, athlete_id, session_id, message, severity)
    VALUES (
      v_team_id, auth.uid(), v_session_id,
      v_athlete_name || ' completed a ' || v_exercise_type || ' test',
      'info'
    );
  END IF;

  DELETE FROM public.video_jobs WHERE id = p_job_id;

  RETURN v_session_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- APeX · Use the new pipeline's balance score as "readiness" (stopgap)
-- Run this AFTER 010_session_result_video.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- The legacy-bridged readiness_score (squat/jump/pullup only, from the old
-- on-device formula) and the new pipeline's balance score are independently
-- computed and can disagree for the same session (e.g. legacy=100 while
-- balance=93) — confusing to show side by side. Per product decision: until
-- a more precise unified assessment is built, every "readiness" number shown
-- anywhere (session detail, Today's Tasks, the athlete/manager readiness
-- trend) is just the new pipeline's overall_balance_pct, rounded, instead of
-- the legacy formula's score. A useful side effect: push_up/deadlift/
-- ab_crunch — which have no legacy bridge and previously stored a NULL
-- readiness_score — now get a real score too, since balance is computed for
-- all 6 exercises, not just the legacy-bridged 3.
--
-- legacy_metrics.session_metrics (squat_depth, squat_symmetry, etc.) are
-- untouched — those still feed the manager's per-exercise threshold table,
-- a separate concern from this one top-line readiness number.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_video_job(p_job_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_job           public.video_jobs%ROWTYPE;
  v_legacy        JSONB;
  v_balance_pct   NUMERIC;
  v_exercise_type TEXT;
  v_rep_count     INT;
  v_readiness     INT;
  v_session_id    UUID;
  v_team_id       UUID;
  v_athlete_name  TEXT;
  v_metric        JSONB;
BEGIN
  SELECT * INTO v_job FROM public.video_jobs
  WHERE id = p_job_id AND athlete_id = auth.uid() AND status = 'completed';
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'Job not found or not completed'; END IF;

  v_legacy      := v_job.analysis_json #> '{analyses,legacy_metrics}';
  v_balance_pct := (v_job.analysis_json #>> '{analyses,balance,overall_balance_pct}')::NUMERIC;

  v_exercise_type := COALESCE(v_legacy ->> 'legacy_exercise_key', v_job.exercise_type);
  v_rep_count      := COALESCE((v_job.analysis_json ->> 'rep_count')::INT, 0);
  -- Stopgap decision (see migration header): readiness = balance, not the
  -- legacy formula. Stays NULL when there's no balance report at all (e.g.
  -- too few reps for a confident measurement) — ROUND(NULL) is NULL in
  -- Postgres, so this falls through correctly without a separate NULL check.
  v_readiness := ROUND(v_balance_pct);

  INSERT INTO public.sessions
    (athlete_id, exercise_type, rep_count, readiness_score, biomechanics_json, result_video_path, recorded_at)
  VALUES
    (auth.uid(), v_exercise_type, v_rep_count, v_readiness, v_job.analysis_json, v_job.result_video_path, v_job.recorded_at)
  RETURNING id INTO v_session_id;

  IF v_legacy IS NOT NULL THEN
    FOR v_metric IN SELECT * FROM jsonb_array_elements(v_legacy -> 'session_metrics')
    LOOP
      INSERT INTO public.session_metrics (session_id, metric_key, value)
      VALUES (v_session_id, v_metric ->> 'metric_key', (v_metric ->> 'value')::FLOAT);
    END LOOP;
  END IF;

  SELECT team_id, full_name INTO v_team_id, v_athlete_name
  FROM public.profiles WHERE id = auth.uid();

  IF v_team_id IS NOT NULL THEN
    INSERT INTO public.notifications (team_id, athlete_id, session_id, message, severity)
    VALUES (
      v_team_id, auth.uid(), v_session_id,
      v_athlete_name || ' completed a ' || v_exercise_type || ' test',
      'info'
    );
  END IF;

  DELETE FROM public.video_jobs WHERE id = p_job_id;

  RETURN v_session_id;
END;
$$;
