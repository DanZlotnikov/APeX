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
