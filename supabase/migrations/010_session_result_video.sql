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
