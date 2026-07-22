-- APeX · save_video_job: accumulate same-day reps instead of replacing them
-- Run this AFTER 014_athlete_routines.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Reported: "I uploaded 2 more pullups and it didn't add the reps to the
-- overview counter (even after save)." Root cause: save_video_job
-- (migration 007's createSession, then migration 012's rewrite) has always
-- fully REPLACED the day's session for that exercise on every save — an
-- athlete recording pullups twice in one day and saving both ends up with
-- only the second attempt's rep count, the first one silently deleted from
-- both sessions and history. That was a deliberate product decision at the
-- time (007's comment: "only the latest attempt ... is kept"), but per
-- product decision this should instead accumulate: every rep performed
-- today should count toward today's total, not just the last clip.
--
-- New behavior: if a session already exists for (athlete, exercise, today),
-- UPDATE it instead of delete-then-insert —
--   rep_count        -> summed (existing + this attempt)
--   readiness_score  -> reps-weighted average of existing and this attempt
--                        (a larger sample outweighs a smaller one; NULL on
--                        either side just falls through to the other,
--                        exactly like ROUND(NULL) already did before)
--   biomechanics_json / result_video_path / recorded_at -> this (latest)
--                        attempt's — there's no meaningful way to merge two
--                        different clips' joint-by-joint breakdowns into
--                        one, so the detailed report/video shown is always
--                        "your most recent set today," same as before; only
--                        the rep_count/readiness_score reflect the whole day
--   session_metrics (legacy bridge rows) -> replaced with this attempt's,
--                        same reasoning as biomechanics_json above
-- No existing same-day session -> unchanged, plain INSERT as before.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_video_job(p_job_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_job            public.video_jobs%ROWTYPE;
  v_legacy         JSONB;
  v_balance_pct    NUMERIC;
  v_exercise_type  TEXT;
  v_rep_count      INT;
  v_readiness      INT;
  v_session_id     UUID;
  v_team_id        UUID;
  v_athlete_name   TEXT;
  v_metric         JSONB;
  v_existing_id    UUID;
  v_existing_reps  INT;
  v_existing_ready INT;
  v_total_reps     INT;
  v_merged_ready   INT;
BEGIN
  SELECT * INTO v_job FROM public.video_jobs
  WHERE id = p_job_id AND athlete_id = auth.uid() AND status = 'completed';
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'Job not found or not completed'; END IF;

  v_legacy      := v_job.analysis_json #> '{analyses,legacy_metrics}';
  v_balance_pct := (v_job.analysis_json #>> '{analyses,balance,overall_balance_pct}')::NUMERIC;

  v_exercise_type := COALESCE(v_legacy ->> 'legacy_exercise_key', v_job.exercise_type);
  v_rep_count      := COALESCE((v_job.analysis_json ->> 'rep_count')::INT, 0);
  -- readiness = L/R balance, not the legacy formula (see migration 011).
  -- NULL when there's no balance report at all (e.g. too few reps) —
  -- ROUND(NULL) is NULL in Postgres, falls through correctly.
  v_readiness := ROUND(v_balance_pct);

  SELECT id, rep_count, readiness_score INTO v_existing_id, v_existing_reps, v_existing_ready
  FROM public.sessions
  WHERE athlete_id = auth.uid()
    AND exercise_type = v_exercise_type
    AND ((recorded_at AT TIME ZONE 'UTC')::date) = ((v_job.recorded_at AT TIME ZONE 'UTC')::date);

  IF v_existing_id IS NOT NULL THEN
    v_total_reps := v_existing_reps + v_rep_count;
    v_merged_ready := CASE
      WHEN v_existing_ready IS NULL THEN v_readiness
      WHEN v_readiness IS NULL THEN v_existing_ready
      WHEN v_total_reps > 0 THEN ROUND(
        (v_existing_ready::NUMERIC * v_existing_reps + v_readiness::NUMERIC * v_rep_count) / v_total_reps
      )
      ELSE ROUND((v_existing_ready + v_readiness) / 2.0)
    END;

    UPDATE public.sessions
    SET rep_count          = v_total_reps,
        readiness_score    = v_merged_ready,
        biomechanics_json  = v_job.analysis_json,
        result_video_path  = v_job.result_video_path,
        recorded_at        = v_job.recorded_at
    WHERE id = v_existing_id;
    v_session_id := v_existing_id;
  ELSE
    INSERT INTO public.sessions
      (athlete_id, exercise_type, rep_count, readiness_score, biomechanics_json, result_video_path, recorded_at)
    VALUES
      (auth.uid(), v_exercise_type, v_rep_count, v_readiness, v_job.analysis_json, v_job.result_video_path, v_job.recorded_at)
    RETURNING id INTO v_session_id;
  END IF;

  -- Only touch session_metrics when this attempt actually has legacy
  -- metrics to contribute — a 0-rep completed job (no legacy bridge output)
  -- must not wipe out a real earlier attempt's metrics for nothing.
  IF v_legacy IS NOT NULL THEN
    IF v_existing_id IS NOT NULL THEN
      DELETE FROM public.session_metrics WHERE session_id = v_existing_id;
    END IF;
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
