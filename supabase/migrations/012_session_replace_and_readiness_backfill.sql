-- APeX · save_video_job same-day replace + normalize readiness to L/R balance
-- Run this AFTER 011_readiness_from_balance.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Two production bugs, both confirmed live:
--
-- 1. save_video_job never replicated the old on-device flow's same-day-replace
--    behavior (see 007_daily_session_replace.sql / mobile/src/api/sessions.ts's
--    createSession: "an athlete can redo an exercise as many times as they
--    like, but only the latest attempt for a given exercise on a given day is
--    kept"). Confirmed in production: a second same-day save for the same
--    exercise hit sessions_athlete_exercise_day_uniq and threw 23505 instead
--    of replacing the earlier session. Fixed below by deleting any existing
--    same-day session for (athlete_id, exercise_type) before inserting, the
--    same pattern createSession already uses — session_metrics cascades on
--    session delete, so no separate cleanup is needed.
--
-- 2. readiness_score meant two different things depending on when a session
--    was saved: 011 redefined it to be the new pipeline's overall_balance_pct,
--    but only going forward — sessions saved before 011 (via the now-retired
--    on-device flow) kept the old multi-factor weighted-formula score in the
--    same column, with nothing distinguishing the two. Per product decision,
--    readiness_score should mean "L/R balance" consistently everywhere, not
--    just for new-pipeline sessions. Old sessions have no biomechanics report
--    to recompute a real balance score from, but they DO already have their
--    own L/R asymmetry measurement stored as a `${exercise}_symmetry`
--    session_metrics value (the old flow's own LSI-style factor — see
--    mobile/src/utils/exerciseMetrics.ts) — backfilled below via the same
--    relationship the new pipeline uses (balance% = 100 - asymmetry%), so
--    historical sessions get a real, comparable balance-based number instead
--    of a leftover old-formula score or a hole in the trend line.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Fix 1: save_video_job same-day replace ───────────────────────────────────

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
  -- readiness = L/R balance, not the legacy formula (see migration 011).
  -- NULL when there's no balance report at all (e.g. too few reps) —
  -- ROUND(NULL) is NULL in Postgres, falls through correctly.
  v_readiness := ROUND(v_balance_pct);

  -- Same-day replace, mirroring createSession (007_daily_session_replace.sql):
  -- an athlete can redo an exercise as many times as they like, but only the
  -- latest attempt for a given exercise on a given day is kept.
  DELETE FROM public.sessions
  WHERE athlete_id = auth.uid()
    AND exercise_type = v_exercise_type
    AND ((recorded_at AT TIME ZONE 'UTC')::date) = ((v_job.recorded_at AT TIME ZONE 'UTC')::date);

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

-- ── Fix 2: normalize historical readiness_score to L/R balance ──────────────
-- Only touches pre-011 sessions (biomechanics_json IS NULL — every
-- save_video_job session always populates it, so this predicate reliably
-- isolates old-flow sessions). Sessions with no matching `_symmetry` metric
-- row are left untouched rather than guessed at.
--
-- This deliberately does NOT touch the seed/demo data (supabase/seeds/ —
-- the "Wingate U21" team): those sessions use a different, older metric-key
-- scheme (`lr_imbalance_pct`, matching 001_schema.sql's own original
-- example comment) with a hand-authored readiness_score array telling a
-- specific narrative (Daniel improving, Noa/Amit declining) that isn't
-- derived from lr_imbalance_pct at all — mechanically overwriting it here
-- would flatten/break that intentional demo storytelling, not fix a real
-- inconsistency. Confirmed empirically: real (non-seed) old sessions use
-- `${exercise}_symmetry` exclusively, so this UPDATE's join naturally never
-- matches seed rows — nothing extra needed to exclude them.

UPDATE public.sessions s
SET readiness_score = GREATEST(0, LEAST(100, ROUND(100 - sm.value)))
FROM public.session_metrics sm
WHERE s.biomechanics_json IS NULL
  AND sm.session_id = s.id
  AND sm.metric_key = s.exercise_type || '_symmetry';
