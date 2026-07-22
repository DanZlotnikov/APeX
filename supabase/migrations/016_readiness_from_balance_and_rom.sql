-- APeX · save_video_job: readiness now averages balance AND range of motion
-- Run this AFTER 015_session_same_day_accumulate.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- The new rom.py analyzer (alongside balance.py) scores how much of each
-- exercise's expected joint range of motion a rep actually achieved,
-- reported at analysis_json #> '{analyses,rom,overall_rom_pct}' — same
-- shape/units (0-100) as balance's overall_balance_pct. Per product
-- decision, readiness_score should reflect BOTH now, not balance alone:
-- an athlete who's perfectly symmetric but barely dipping (poor ROM), or
-- vice versa, shouldn't read as "Ready" on one score alone.
--
-- v_readiness becomes the simple average of overall_balance_pct and
-- overall_rom_pct when both are present; if only one analyzer produced a
-- result for this exercise (shouldn't normally happen — rom.py covers the
-- same 6 exercises balance.py does — but analyze_rom/analyze_balance can
-- each independently return None for 0 reps), that one alone is used,
-- exactly like ROUND(NULL) already fell through safely before this change.
-- Everything else about save_video_job (migration 015's same-day rep
-- accumulation / reps-weighted readiness merge) is unchanged — it already
-- treats "this attempt's readiness" as an opaque number to merge, so it
-- doesn't care that the number's own formula just changed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_video_job(p_job_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_job            public.video_jobs%ROWTYPE;
  v_legacy         JSONB;
  v_balance_pct    NUMERIC;
  v_rom_pct        NUMERIC;
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
  v_rom_pct     := (v_job.analysis_json #>> '{analyses,rom,overall_rom_pct}')::NUMERIC;

  v_exercise_type := COALESCE(v_legacy ->> 'legacy_exercise_key', v_job.exercise_type);
  v_rep_count      := COALESCE((v_job.analysis_json ->> 'rep_count')::INT, 0);
  -- readiness = average of L/R balance and range of motion (whichever is
  -- present, if not both — see header comment). NULL only when neither
  -- analyzer produced a result (e.g. 0 reps), same as before this change.
  v_readiness := ROUND(
    CASE
      WHEN v_balance_pct IS NULL THEN v_rom_pct
      WHEN v_rom_pct IS NULL THEN v_balance_pct
      ELSE (v_balance_pct + v_rom_pct) / 2.0
    END
  );

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
