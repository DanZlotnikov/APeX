-- APeX · Revert same-day session merging — every save is its own row
-- Run this AFTER 016_readiness_from_balance_and_rom.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Reported: "I keep uploading pullup videos and the history keeps showing
-- the same original pullup video, but the reps keep counting up." This is
-- migration 015/016's same-day accumulate behavior working exactly as
-- built — but it's not what was actually wanted. Per clarified product
-- decision: every saved video is its own permanent, separate session, full
-- stop. History shows every attempt individually, not one row per
-- (athlete, exercise, day) that later attempts silently update in place.
--
-- What this undoes:
--   1. save_video_job no longer looks up/merges into an existing same-day
--      session for the exercise — it's a plain INSERT every time, back to
--      migration 011's shape (still using this migration's own balance+rom
--      readiness formula, and 010's result_video_path column — those parts
--      are unrelated to the same-day behavior and stay).
--   2. Drops sessions_athlete_exercise_day_uniq (migration 007) — the
--      unique index that FORCED at most one row per (athlete, exercise,
--      day). With merging gone, a second same-day save must be allowed to
--      insert as its own row rather than crash with 23505 again.
--
-- What this does NOT do: recover any individual attempts that were already
-- merged together before this fix shipped. Migrations 015/016's UPDATE path
-- overwrote biomechanics_json/result_video_path with each new attempt's
-- data and only kept a summed rep_count — the earlier attempts' own videos/
-- reports for any session that got merged are gone; there's nothing left to
-- reconstruct them from. Only saves from this point forward are affected.
--
-- The Overview "Routine" progress table's "reps today" is still a total
-- across every attempt for that exercise today — that part of the original
-- ask was correct and stays, just computed client-side by summing across
-- now-multiple session rows instead of reading one pre-summed row (see
-- mobile/src/utils/routineProgress.ts).
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.sessions_athlete_exercise_day_uniq;

CREATE OR REPLACE FUNCTION public.save_video_job(p_job_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_job           public.video_jobs%ROWTYPE;
  v_legacy        JSONB;
  v_balance_pct   NUMERIC;
  v_rom_pct       NUMERIC;
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
  v_rom_pct     := (v_job.analysis_json #>> '{analyses,rom,overall_rom_pct}')::NUMERIC;

  v_exercise_type := COALESCE(v_legacy ->> 'legacy_exercise_key', v_job.exercise_type);
  v_rep_count      := COALESCE((v_job.analysis_json ->> 'rep_count')::INT, 0);
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
