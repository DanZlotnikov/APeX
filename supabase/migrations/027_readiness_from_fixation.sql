-- APeX · Readiness From Fixation
-- Run this AFTER 026_exercise_categories.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- save_video_job() has only ever averaged analyses.balance/analyses.rom into
-- readiness_score. Padel's "Padel Stroke" (migration 026) has no balance or
-- rom profile — it only ever produces analyses.fixation (see backend/GENMO/
-- scripts/biomechanics/fixation.py) — so left unchanged, EVERY saved padel
-- session would get readiness_score = NULL, permanently: both v_balance_pct
-- and v_rom_pct would be NULL, and the old CASE only ever falls back to
-- "whichever of the two is present", never landing on a real number when
-- neither is. That's not just a blank UI cell — it also silently drops every
-- padel session from the roster-average readiness calc (mobile's athletes.ts)
-- and from the Readiness screen's trend query (which filters
-- readiness_score IS NOT NULL).
--
-- Same function migration 025 last defined, unchanged except for adding
-- v_fixation_pct and generalizing the CASE to an AVG() over whichever of the
-- three analyses are actually present — this also means a future 4th
-- analyzer (e.g. fatigue, per biomechanics/analysis.py's own docstring)
-- won't need this function touched again.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_video_job(p_job_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_job            public.video_jobs%ROWTYPE;
  v_balance_pct    NUMERIC;
  v_rom_pct        NUMERIC;
  v_fixation_pct   NUMERIC;
  v_exercise_type  TEXT;
  v_exercise_label TEXT;
  v_rep_count      INT;
  v_readiness      INT;
  v_session_id     UUID;
  v_team_id        UUID;
  v_athlete_name   TEXT;
BEGIN
  SELECT * INTO v_job FROM public.video_jobs
  WHERE id = p_job_id AND athlete_id = auth.uid() AND status = 'completed';
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'Job not found or not completed'; END IF;

  v_balance_pct  := (v_job.analysis_json #>> '{analyses,balance,overall_balance_pct}')::NUMERIC;
  v_rom_pct      := (v_job.analysis_json #>> '{analyses,rom,overall_rom_pct}')::NUMERIC;
  v_fixation_pct := (v_job.analysis_json #>> '{analyses,fixation,overall_fixation_pct}')::NUMERIC;

  -- Bridged key (sessions.exercise_type) + human label both come from the
  -- registry now, keyed by the pipeline's raw output — same source of truth
  -- the mobile client's resolveJobExerciseKey()/exerciseLabel() already use.
  -- Falls back to the raw value only if the registry somehow doesn't have a
  -- row for it (shouldn't happen — video_jobs.exercise_type FKs against
  -- exercises.raw_key as of migration 023 — but a save shouldn't hard-fail
  -- over a label lookup).
  SELECT key, label INTO v_exercise_type, v_exercise_label
  FROM public.exercises WHERE raw_key = v_job.exercise_type;
  IF v_exercise_type IS NULL THEN
    v_exercise_type  := v_job.exercise_type;
    v_exercise_label := v_job.exercise_type;
  END IF;

  v_rep_count := COALESCE((v_job.analysis_json ->> 'rep_count')::INT, 0);
  -- readiness = average of whichever of {balance, rom, fixation} this
  -- exercise actually produced (see migration 016 for the original
  -- balance+rom rule) — NULL only when none of the three produced a result
  -- (e.g. 0 reps). unnest()+WHERE v IS NOT NULL drops the absent ones before
  -- averaging, rather than nesting a 3-way CASE.
  v_readiness := (
    SELECT ROUND(AVG(v)) FROM unnest(ARRAY[v_balance_pct, v_rom_pct, v_fixation_pct]) AS v WHERE v IS NOT NULL
  );

  INSERT INTO public.sessions
    (athlete_id, exercise_type, rep_count, readiness_score, biomechanics_json, result_video_path, recorded_at, duration_sec)
  VALUES
    (auth.uid(), v_exercise_type, v_rep_count, v_readiness, v_job.analysis_json, v_job.result_video_path, v_job.recorded_at, v_job.duration_sec)
  RETURNING id INTO v_session_id;

  SELECT team_id, full_name INTO v_team_id, v_athlete_name
  FROM public.profiles WHERE id = auth.uid();

  IF v_team_id IS NOT NULL THEN
    INSERT INTO public.notifications (team_id, athlete_id, session_id, message, severity)
    VALUES (
      v_team_id, auth.uid(), v_session_id,
      v_athlete_name || ' completed a ' || v_exercise_label || ' exercise',
      'info'
    );
  END IF;

  DELETE FROM public.video_jobs WHERE id = p_job_id;

  RETURN v_session_id;
END;
$$;
