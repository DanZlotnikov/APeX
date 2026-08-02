-- APeX · Session Duration
-- Run this AFTER 023_exercises_registry.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- sessions has never stored a clip's duration — video_jobs.duration_sec
-- (known at upload time, set by the app) existed since migration 009 but
-- save_video_job never copied it into the permanent sessions row, so it was
-- lost the moment the video_jobs row was deleted. The new per-exercise
-- Readiness screen's history rows need it, so it's carried across from here
-- on. Nullable: every session saved before this ships has no duration to
-- backfill (the source video_jobs row is long gone) — the app renders that
-- as "—", same as any other historical-data gap.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sessions ADD COLUMN duration_sec NUMERIC;

-- Same function migration 018 last defined, unchanged except for carrying
-- v_job.duration_sec into the new column.
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
      v_athlete_name || ' completed a ' || v_exercise_type || ' test',
      'info'
    );
  END IF;

  DELETE FROM public.video_jobs WHERE id = p_job_id;

  RETURN v_session_id;
END;
$$;
