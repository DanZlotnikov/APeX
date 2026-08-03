-- APeX · Notification Exercise Label
-- Run this AFTER 024_session_duration.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- save_video_job's manager notification ("Dan completed a squat test") built
-- its exercise name from a hardcoded two-case mapping (vertical_jump->jump,
-- pull_up->pullup, everything else passed through unchanged) left over from
-- before the exercises registry (migration 023). Anything not one of those
-- two hardcoded cases — e.g. push_up, whose bridged key is literally
-- "push_up" — went out in the notification text verbatim instead of its
-- real label ("Push-Up"). Same bug shape migration 023 already fixed
-- everywhere else by moving to a real registry lookup; this closes the one
-- remaining hardcoded spot. Also drops "test" from the message's own wording
-- ("completed a Squat exercise", not "... test") to match the rest of the
-- app's vocabulary — nothing here is actually a pass/fail test.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_video_job(p_job_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_job            public.video_jobs%ROWTYPE;
  v_balance_pct    NUMERIC;
  v_rom_pct        NUMERIC;
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

  v_balance_pct := (v_job.analysis_json #>> '{analyses,balance,overall_balance_pct}')::NUMERIC;
  v_rom_pct     := (v_job.analysis_json #>> '{analyses,rom,overall_rom_pct}')::NUMERIC;

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
      v_athlete_name || ' completed a ' || v_exercise_label || ' exercise',
      'info'
    );
  END IF;

  DELETE FROM public.video_jobs WHERE id = p_job_id;

  RETURN v_session_id;
END;
$$;
