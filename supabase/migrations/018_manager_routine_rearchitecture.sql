-- APeX · Manager Routine Rearchitecture
-- Run this AFTER 017_sessions_no_same_day_merge.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Replaces the manager's old squat/jump/pullup-only "required exercises"
-- system (team_exercises + its per-metric thresholds) with a team-scoped
-- version of the athlete routine model (migration 014): a manager now sets
-- the SAME enabled/target_reps shape, across all 6 pipeline exercises, that
-- an individual athlete sets for themselves. Per-athlete overrides stay a
-- simple boolean (athlete_exercise_assignments, widened from 3 to 6
-- exercises and renamed exercise_key -> exercise_type for consistency with
-- every other exercise-vocabulary column in the schema) — reps are never
-- overridden per athlete, only enabled/disabled.
--
-- The manager-configurable per-metric threshold system (team_exercises.
-- thresholds/min_reps, mobile/src/utils/exerciseMetrics.ts's EXERCISE_METRICS)
-- is retired entirely: readiness is now sessions.readiness_score (the same
-- balance+ROM average an individual athlete sees) for every exercise, not a
-- manager-tunable pass/fail threshold. See MANAGER_MODULE_AUDIT.md sections
-- 2, 3, and 6 for the discrepancies this migration resolves.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── team_routines: manager-owned team default (mirrors athlete_routines) ────

CREATE TABLE public.team_routines (
  team_id       UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  exercise_type TEXT NOT NULL CHECK (exercise_type IN ('squat','jump','pullup','deadlift','push_up','ab_crunch')),
  enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  target_reps   INT NOT NULL DEFAULT 5 CHECK (target_reps BETWEEN 1 AND 10),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, exercise_type)
);

CREATE INDEX idx_team_routines_team ON public.team_routines (team_id);

CREATE TRIGGER trg_team_routines_updated_at
  BEFORE UPDATE ON public.team_routines
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.team_routines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read team routines" ON public.team_routines
  FOR SELECT USING (team_id = public.my_team_id());

CREATE POLICY "manager manages team routines" ON public.team_routines
  FOR ALL USING (
    team_id = public.my_team_id()
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
  ) WITH CHECK (team_id = public.my_team_id());

-- Best-effort carry-over of whatever a team had already configured (enabled +
-- min_reps -> target_reps; min_reps was always 1-10-compatible) rather than
-- silently resetting every team to nothing enabled. Exercises the old system
-- never covered (deadlift/push_up/ab_crunch) simply have no row yet — same
-- "no row = {enabled:false, target_reps:5}" convention athlete_routines
-- already uses (see mobile/src/api/routine.ts), nothing to backfill.
INSERT INTO public.team_routines (team_id, exercise_type, enabled, target_reps)
SELECT team_id, exercise_key, enabled, min_reps
FROM public.team_exercises
ON CONFLICT (team_id, exercise_type) DO NOTHING;

-- ── Drop the old team_exercises system (data already carried over above) ────

DROP TABLE public.team_exercises;

-- ── athlete_exercise_assignments: widen to 6 exercises, rename for consistency ──

ALTER TABLE public.athlete_exercise_assignments RENAME COLUMN exercise_key TO exercise_type;

ALTER TABLE public.athlete_exercise_assignments
  DROP CONSTRAINT IF EXISTS athlete_exercise_assignments_exercise_key_check,
  ADD  CONSTRAINT athlete_exercise_assignments_exercise_type_check
    CHECK (exercise_type IN ('squat','jump','pullup','deadlift','push_up','ab_crunch'));

-- ── create_manager_team: stop seeding team_exercises (opt-in like an ─────────
-- individual athlete's routine now, not opt-out) ─────────────────────────────

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

  INSERT INTO public.profiles (id, role, team_id, full_name)
  VALUES (auth.uid(), 'manager', v_team_id, p_full_name);

  RETURN v_team_id;
END;
$$;

-- ── save_video_job: drop the legacy_metrics/session_metrics bridge ──────────
-- exercise_type normalization (vertical_jump -> jump, pull_up -> pullup) no
-- longer depends on the backend's legacy_metrics analyzer (removed — see
-- backend/GENMO/scripts/biomechanics/analysis.py) — it's a fixed, stable
-- 2-entry mapping done directly here instead. readiness_score was already
-- balance+ROM-based, independent of legacy_metrics (migration 016) — no
-- change to that formula. session_metrics is no longer written by this
-- pipeline: it only ever existed to feed the now-retired manager per-metric
-- threshold system.
CREATE OR REPLACE FUNCTION public.save_video_job(p_job_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_job           public.video_jobs%ROWTYPE;
  v_balance_pct   NUMERIC;
  v_rom_pct       NUMERIC;
  v_exercise_type TEXT;
  v_rep_count     INT;
  v_readiness     INT;
  v_session_id    UUID;
  v_team_id       UUID;
  v_athlete_name  TEXT;
BEGIN
  SELECT * INTO v_job FROM public.video_jobs
  WHERE id = p_job_id AND athlete_id = auth.uid() AND status = 'completed';
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'Job not found or not completed'; END IF;

  v_balance_pct := (v_job.analysis_json #>> '{analyses,balance,overall_balance_pct}')::NUMERIC;
  v_rom_pct     := (v_job.analysis_json #>> '{analyses,rom,overall_rom_pct}')::NUMERIC;

  v_exercise_type := CASE v_job.exercise_type
    WHEN 'vertical_jump' THEN 'jump'
    WHEN 'pull_up'       THEN 'pullup'
    ELSE v_job.exercise_type
  END;
  v_rep_count := COALESCE((v_job.analysis_json ->> 'rep_count')::INT, 0);
  -- readiness = average of L/R balance and range of motion (whichever is
  -- present, if not both — see migration 016). NULL only when neither
  -- analyzer produced a result (e.g. 0 reps).
  v_readiness := ROUND(
    CASE
      WHEN v_balance_pct IS NULL THEN v_rom_pct
      WHEN v_rom_pct IS NULL THEN v_balance_pct
      ELSE (v_balance_pct + v_rom_pct) / 2.0
    END
  );

  INSERT INTO public.sessions
    (athlete_id, exercise_type, rep_count, readiness_score, biomechanics_json, result_video_path, recorded_at)
  VALUES
    (auth.uid(), v_exercise_type, v_rep_count, v_readiness, v_job.analysis_json, v_job.result_video_path, v_job.recorded_at)
  RETURNING id INTO v_session_id;

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
