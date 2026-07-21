-- APeX · Async Video Pipeline (video_jobs)
-- Run this AFTER 001_schema.sql through 008_individual_athletes.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Backs the new server-side pose/exercise pipeline — see HANDOFF_video_pipeline.md
-- at the repo root for full context. The app no longer analyzes video
-- on-device; it uploads to Storage, inserts a `video_jobs` row, and a
-- separate worker process (backend/server/supabase_worker.py — a different
-- codebase/session, not part of this migration) polls for queued jobs using
-- the SERVICE ROLE key, which bypasses RLS entirely. Everything below is
-- scoped to what the *app* (acting as the athlete, with the athlete's own
-- session) is allowed to do.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── video_jobs ────────────────────────────────────────────────────────────────

CREATE TYPE public.video_job_status AS ENUM ('queued', 'processing', 'completed', 'failed');

CREATE TABLE public.video_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status             public.video_job_status NOT NULL DEFAULT 'queued',
  cancel_requested   BOOLEAN NOT NULL DEFAULT FALSE,
  raw_video_path     TEXT NOT NULL,        -- exercise-videos/raw/{athlete_id}/{id}.mp4
  result_video_path  TEXT,                 -- exercise-videos/processed/{athlete_id}/{id}/two_panel.mp4, set by the worker
  -- Set by the app at upload time when this recording was made for a specific
  -- Today's Task tile (squat|jump|pullup — the OLD/manager-module vocabulary,
  -- since that's what tasks are defined in); NULL for a free record/upload
  -- with no associated task. Purely informational for the worker (it never
  -- reads or writes this) — it's how the app later resolves "pending" tasks
  -- to the video_jobs row that fulfills them, and matches it against
  -- exercise_type below once completed to detect a mismatch (see checklist
  -- item 8 / HANDOFF_video_pipeline.md).
  target_exercise_key TEXT,
  exercise_type      TEXT,                 -- set by the worker: squat|deadlift|vertical_jump|pull_up|push_up|ab_crunch
  analysis_json      JSONB,                -- set by the worker — full report, see HANDOFF section 1
  duration_sec       NUMERIC NOT NULL,     -- known at upload time, set by the app
  recorded_at        TIMESTAMPTZ NOT NULL, -- known at upload time, set by the app
  error_message      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ
);

CREATE INDEX idx_video_jobs_athlete_status ON public.video_jobs (athlete_id, status);

-- No 'cancelled'/'discarded' status by design — cancelling a queued/processing
-- job or discarding a completed one both just delete the row via the RPCs
-- below. A row only ever exists while it's live.

ALTER TABLE public.video_jobs ENABLE ROW LEVEL SECURITY;

-- Athletes read/insert their own rows only. Deliberately NO general UPDATE
-- policy — athletes can't write their own analysis_json or flip status to
-- 'completed'; every athlete-initiated write goes through the SECURITY
-- DEFINER RPCs below instead. The worker's service-role key bypasses RLS
-- entirely regardless of what's declared here.
CREATE POLICY "athlete reads own video jobs" ON public.video_jobs
  FOR SELECT USING (athlete_id = auth.uid());

CREATE POLICY "athlete inserts own video jobs" ON public.video_jobs
  FOR INSERT WITH CHECK (athlete_id = auth.uid());

-- ── Storage bucket: exercise-videos (private) ────────────────────────────────
-- Layout: raw/{athlete_id}/{job_id}.mp4 (app-uploaded),
--         processed/{athlete_id}/{job_id}/two_panel.mp4 (worker-uploaded).
-- storage.foldername(name) splits the object path on '/'; element 1 is
-- 'raw'/'processed', element 2 is the athlete_id folder.

INSERT INTO storage.buckets (id, name, public)
VALUES ('exercise-videos', 'exercise-videos', FALSE)
ON CONFLICT (id) DO NOTHING;

-- raw/: athletes can insert/select/delete their own (upload, play back, and
-- clean up on cancel/discard).
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

-- processed/: athletes can select (signed URL playback) and delete (on
-- discard) their own — never insert, only the worker (service role) writes
-- these.
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

-- ── sessions: widen for the pipeline's 3 new exercise types ──────────────────
-- squat/vertical_jump/pull_up are bridged back to the existing
-- squat/jump/pullup vocabulary by legacy_metrics.legacy_exercise_key (see
-- save_video_job below) — no widening needed for those. deadlift/push_up/
-- ab_crunch have no legacy bridge (never existed in the old on-device
-- analyzer), so they pass through under the new pipeline's own raw keys.
-- NOTE: this re-admits 'deadlift' as a sessions.exercise_type value —
-- migration 005 removed it from the OLD on-device analyzer specifically
-- because ITS 2D torso-lean heuristic confused it with squat. The new
-- pipeline's 3D GEM-based deadlift detection is a different, unrelated
-- method; this is not a reversal of that decision.
--
-- team_exercises / athlete_exercise_assignments (the manager-configurable
-- required-exercise system) deliberately stay squat/jump/pullup-only — the
-- 3 new types have no readiness score or session_metrics to threshold
-- against, so there's nothing for a manager to configure for them yet.

ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_exercise_type_check,
  ADD  CONSTRAINT sessions_exercise_type_check
    CHECK (exercise_type IN ('squat','jump','pullup','deadlift','push_up','ab_crunch'));

-- Full new-pipeline report (HANDOFF section 1 shape) for sessions created via
-- this pipeline. Deliberately a NEW column, not reusing `analysis_json`:
-- analysis_json still holds the OLD on-device Assessment shape
-- (perExercise[].factors/metrics, including per-rep trend arrays like
-- perRepDepth that HistoryDetailScreen.tsx's charts read) for existing
-- sessions, and the two shapes are incompatible. New-pipeline sessions leave
-- analysis_json NULL and populate biomechanics_json instead — the app must
-- render "detailed trends not yet available" for those rather than assume
-- analysis_json is always present.
ALTER TABLE public.sessions ADD COLUMN biomechanics_json JSONB;

-- ── push notifications ────────────────────────────────────────────────────────

ALTER TABLE public.profiles ADD COLUMN expo_push_token TEXT;
-- Covered by the existing "update own profile" / "read own profile" /
-- "read team profiles" policies — no new RLS needed for this column.

-- ── RPCs ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cancel_video_job(p_job_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status public.video_job_status;
BEGIN
  SELECT status INTO v_status FROM public.video_jobs
  WHERE id = p_job_id AND athlete_id = auth.uid();
  IF v_status IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;

  IF v_status = 'queued' THEN
    -- Worker hasn't touched it yet — nothing to signal, just remove it.
    DELETE FROM public.video_jobs WHERE id = p_job_id;
  ELSE
    -- 'processing': can't interrupt mid-GPU-inference. The worker checks
    -- cancel_requested right after claiming and right after finishing, and
    -- deletes the row itself once it notices (see supabase_worker.py).
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

-- Saves a completed job into the existing `sessions` history table, then
-- deletes the video_jobs row. Mirrors the old on-device flow's
-- api/sessions.ts createSession(): notifies the athlete's manager (if any —
-- individual/teamless athletes just skip this, same as before) and inserts
-- session_metrics alongside the session.
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

  -- Prefer the legacy-bridged key (squat/jump/pullup) so the existing
  -- manager module's vocabulary keeps working for those 3; otherwise pass
  -- the new pipeline's raw key through (deadlift/push_up/ab_crunch — no
  -- bridge exists for these, see the sessions.exercise_type comment above).
  v_exercise_type := COALESCE(v_legacy ->> 'legacy_exercise_key', v_job.exercise_type);
  v_rep_count      := COALESCE((v_job.analysis_json ->> 'rep_count')::INT, 0);
  -- NULL (not 0) when there's no legacy bridge — the manager UI must render
  -- that as "no readiness data," never as a false zero score.
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
