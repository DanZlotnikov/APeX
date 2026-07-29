-- APeX · Dev Seed Data — Dan Test readiness trend (dan@test.com)
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds a week of squat/vertical-jump/pull-up sessions for the existing
-- dan@test.com athlete, ending with today, so the Overview/Manager readiness
-- trend chart has a realistic rising arc to show:
--   - 8 days total (7 days back through today), overall readiness trending
--     80% -> ~90%, with natural day-to-day ups and downs, not monotonic.
--   - Today: 5 reps squat, 3 reps vertical jump (exercise_type 'jump'),
--     2 reps pullup — exactly the reps requested.
--
-- Requires: dan@test.com already exists in auth.users (sign up in the app,
-- or create it via the Supabase dashboard, first).
--
-- This script also:
--   - creates the profiles row for it if missing (individual/teamless
--     athlete) — a no-op if the account already signed up normally;
--   - seeds athlete_routines so squat/jump/pullup are the athlete's active
--     routine. This matters: mobile/src/api/athletes.ts buildViewModel()
--     averages "today's overall readiness" across every ENABLED
--     athlete_routines exercise, treating an untested one as 0 — with no
--     enabled routine at all, overall readiness would read 0%, not ~90%.
--     Enabling exactly these 3 (and no others) makes today's average land
--     on the per-exercise numbers below, by design.
--   - every session is its own row (migration 017 — no same-day merging),
--     so this is a plain INSERT per exercise per day, matching current
--     save_video_job behavior exactly.
--
-- Idempotent: clears any existing sessions for dan@test.com in the 8-day
-- window this script seeds before inserting the fresh trend, so re-running
-- this replaces old test data with a clean arc instead of piling more,
-- noisier points on top of it (assumes dan@test.com is a dedicated test
-- account — this deletes real history if it isn't).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.seed_dan_readiness_trend()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_dan_id     UUID;
  v_session_id UUID;
  v_day_start  TIMESTAMPTZ;

  -- Day -7 (oldest) -> day 0 (today), 8 points, rising 80 -> 90 with ups/downs.
  day_readiness INT[] := ARRAY[80, 83, 79, 85, 82, 88, 86, 90];

  -- Same daily routine every day: squat 5 reps, jump (vertical jump) 3 reps,
  -- pullup 2 reps. Per-exercise readiness deviates slightly around each
  -- day's target (deltas sum to zero) so the trend chart — one point per
  -- session, not per day — looks like natural per-exercise variation while
  -- the day's average still lands exactly on day_readiness[i].
  squat_delta  CONSTANT INT := -1;
  jump_delta   CONSTANT INT := 2;
  pullup_delta CONSTANT INT := -1;

  i INT;
BEGIN
  SELECT id INTO v_dan_id FROM auth.users WHERE email = 'dan@test.com';
  IF v_dan_id IS NULL THEN
    RAISE EXCEPTION 'dan@test.com not found in auth.users — create the account first (sign up in the app, or via the Supabase dashboard).';
  END IF;

  -- Clear any existing sessions in the 8-day window (session_metrics cascades)
  -- so re-running this replaces old data with a clean trend rather than
  -- adding noisier points on top of whatever's already there.
  DELETE FROM public.sessions
  WHERE athlete_id = v_dan_id
    AND (recorded_at AT TIME ZONE 'UTC')::date >= ((NOW() AT TIME ZONE 'UTC')::date - 7);

  -- Ensure a profile exists (individual/teamless athlete) — no-op if the
  -- account already signed up normally and has one.
  INSERT INTO public.profiles (id, role, team_id, full_name)
  VALUES (v_dan_id, 'athlete', NULL, 'Dan Test')
  ON CONFLICT (id) DO NOTHING;

  -- Active routine: squat/jump/pullup enabled, matching target reps. The
  -- other 3 exercises are explicitly disabled (not just left unseeded) in
  -- case this account already toggled any of them on via the app's Routine
  -- screen — otherwise "today's overall readiness" would average across
  -- more than these 3 and land well below 90%.
  INSERT INTO public.athlete_routines (athlete_id, exercise_type, enabled, target_reps) VALUES
    (v_dan_id, 'squat',     TRUE,  5),
    (v_dan_id, 'jump',      TRUE,  3),
    (v_dan_id, 'pullup',    TRUE,  2),
    (v_dan_id, 'deadlift',  FALSE, 5),
    (v_dan_id, 'push_up',   FALSE, 5),
    (v_dan_id, 'ab_crunch', FALSE, 5)
  ON CONFLICT (athlete_id, exercise_type)
  DO UPDATE SET enabled = EXCLUDED.enabled, target_reps = EXCLUDED.target_reps;

  FOR i IN 1..8 LOOP
    v_day_start := date_trunc('day', NOW() AT TIME ZONE 'UTC') - ((8 - i) || ' days')::INTERVAL;

    -- Squat — 08:00
    INSERT INTO public.sessions (id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score, analysis_json)
    VALUES (gen_random_uuid(), v_dan_id, 'squat', v_day_start + INTERVAL '8 hours', 5,
            day_readiness[i] + squat_delta,
            jsonb_build_object('readiness', day_readiness[i] + squat_delta, 'exercise', 'squat'))
    RETURNING id INTO v_session_id;
    INSERT INTO public.session_metrics (session_id, metric_key, value) VALUES
      (v_session_id, 'squat_rom_deg',    72.0 + i),
      (v_session_id, 'lr_imbalance_pct', 6.0),
      (v_session_id, 'squat_reps',       5);

    -- Vertical jump — 08:15
    INSERT INTO public.sessions (id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score, analysis_json)
    VALUES (gen_random_uuid(), v_dan_id, 'jump', v_day_start + INTERVAL '8 hours 15 minutes', 3,
            day_readiness[i] + jump_delta,
            jsonb_build_object('readiness', day_readiness[i] + jump_delta, 'exercise', 'jump'))
    RETURNING id INTO v_session_id;
    INSERT INTO public.session_metrics (session_id, metric_key, value) VALUES
      (v_session_id, 'jump_rom_deg',     80.0 + i),
      (v_session_id, 'lr_imbalance_pct', 5.0),
      (v_session_id, 'jump_reps',        3),
      (v_session_id, 'flight_time_s',    0.42 + (i * 0.005));

    -- Pull-up — 08:30
    INSERT INTO public.sessions (id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score, analysis_json)
    VALUES (gen_random_uuid(), v_dan_id, 'pullup', v_day_start + INTERVAL '8 hours 30 minutes', 2,
            day_readiness[i] + pullup_delta,
            jsonb_build_object('readiness', day_readiness[i] + pullup_delta, 'exercise', 'pullup'))
    RETURNING id INTO v_session_id;
    INSERT INTO public.session_metrics (session_id, metric_key, value) VALUES
      (v_session_id, 'pullup_rom_deg',   60.0 + i),
      (v_session_id, 'lr_imbalance_pct', 7.0),
      (v_session_id, 'pullup_reps',      2);
  END LOOP;

  RETURN 'Seeded dan@test.com: 8 days x 3 exercises = 24 sessions, readiness trending 80% -> 90%.';
END $$;

-- Run it
SELECT public.seed_dan_readiness_trend();
