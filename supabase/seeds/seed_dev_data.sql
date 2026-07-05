-- APeX · Dev Seed Data
-- ─────────────────────────────────────────────────────────────────────────────
-- PREREQUISITES
--   1. Run 001_schema.sql first.
--   2. In Supabase Dashboard → Authentication → Providers → Email, disable
--      "Confirm email" so dev accounts can sign in immediately after signup.
--   3. Create the following users in Dashboard → Authentication → Users:
--        Email: daniel.cohen@apex.dev   Password: apex_dev_123
--        Email: noa.levy@apex.dev       Password: apex_dev_123
--        Email: amit.bar@apex.dev       Password: apex_dev_123
--        Email: coach@apex.dev          Password: apex_dev_123
--   4. Then run this entire file in the SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.seed_dev_data()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_team_id    UUID;
  v_daniel_id  UUID;
  v_noa_id     UUID;
  v_amit_id    UUID;
  v_coach_id   UUID;
  v_session_id UUID;

  -- Readiness arcs (oldest → newest, 10 sessions each)
  daniel_readiness  INT[] := ARRAY[82,87,85,89,88,86,90,88,91,91];
  noa_readiness     INT[] := ARRAY[82,80,84,78,81,76,79,74,77,74];
  amit_readiness    INT[] := ARRAY[78,75,71,73,68,65,68,63,64,61];

  -- ROM arcs
  daniel_squat_rom  FLOAT[] := ARRAY[72,74,75,77,76,75,79,77,80,80];
  daniel_jump_rom   FLOAT[] := ARRAY[80,82,83,85,84,83,87,85,88,88];
  noa_squat_rom     FLOAT[] := ARRAY[74,72,75,70,73,68,71,66,69,67];
  noa_jump_rom      FLOAT[] := ARRAY[82,80,83,78,81,76,79,74,77,74];
  amit_squat_rom    FLOAT[] := ARRAY[70,68,64,66,62,59,62,57,58,55];
  amit_jump_rom     FLOAT[] := ARRAY[76,74,70,72,68,65,68,63,64,61];

  -- Jump flight times (seconds)
  daniel_flight  FLOAT[] := ARRAY[0.44,0.46,0.45,0.48,0.47,0.46,0.49,0.48,0.50,0.49];
  noa_flight     FLOAT[] := ARRAY[0.43,0.42,0.44,0.41,0.42,0.40,0.41,0.39,0.40,0.39];
  amit_flight    FLOAT[] := ARRAY[0.41,0.39,0.37,0.38,0.35,0.33,0.35,0.32,0.33,0.31];

  i INT;
  ex_type TEXT;
  rom_val FLOAT;
  flight_val FLOAT;
  lr_val FLOAT;
BEGIN
  -- Resolve user IDs from auth.users
  SELECT id INTO v_daniel_id FROM auth.users WHERE email = 'daniel.cohen@apex.dev';
  SELECT id INTO v_noa_id    FROM auth.users WHERE email = 'noa.levy@apex.dev';
  SELECT id INTO v_amit_id   FROM auth.users WHERE email = 'amit.bar@apex.dev';
  SELECT id INTO v_coach_id  FROM auth.users WHERE email = 'coach@apex.dev';

  IF v_daniel_id IS NULL OR v_noa_id IS NULL OR v_amit_id IS NULL OR v_coach_id IS NULL THEN
    RAISE EXCEPTION 'One or more dev users not found in auth.users. Create them in the Supabase dashboard first.';
  END IF;

  -- Skip if already seeded
  IF EXISTS (SELECT 1 FROM public.teams WHERE name = 'Wingate U21') THEN
    RETURN 'Already seeded — skipping.';
  END IF;

  -- ── Team ────────────────────────────────────────────────────────────────────
  -- 'APEX01' is the fixed dev invite code athletes use during sign-up
  INSERT INTO public.teams (name, invite_code)
  VALUES ('Wingate U21', 'APEX01')
  RETURNING id INTO v_team_id;

  INSERT INTO public.team_settings (team_id, readiness_threshold, max_lr_imbalance, required_tests_per_day)
  VALUES (v_team_id, 75, 15, 3);

  INSERT INTO public.required_tests (team_id, label, enabled, sort_order) VALUES
    (v_team_id, 'Jump Test',       TRUE,  0),
    (v_team_id, 'Squat Test',      TRUE,  1),
    (v_team_id, 'Balance Test',    TRUE,  2),
    (v_team_id, 'Single-Leg Hop',  FALSE, 3);

  -- ── Profiles ─────────────────────────────────────────────────────────────────
  INSERT INTO public.profiles (id, role, team_id, full_name) VALUES
    (v_daniel_id, 'athlete', v_team_id, 'Daniel Cohen'),
    (v_noa_id,    'athlete', v_team_id, 'Noa Levy'),
    (v_amit_id,   'athlete', v_team_id, 'Amit Bar'),
    (v_coach_id,  'manager', v_team_id, 'Head Coach');

  INSERT INTO public.athlete_profiles (id, height_cm, weight_kg, position, date_of_birth) VALUES
    (v_daniel_id, 181, 78, 'Forward',    '2004-06-15'),
    (v_noa_id,    174, 64, 'Midfielder', '2005-03-22'),
    (v_amit_id,   185, 83, 'Defender',   '2003-11-08');

  -- ── Sessions — Daniel Cohen (improving arc) ───────────────────────────────
  -- Sessions alternate squat (odd index) / jump (even index), 10 days ago → 1 day ago
  FOR i IN 1..10 LOOP
    ex_type    := CASE WHEN i % 2 = 1 THEN 'squat' ELSE 'jump' END;
    rom_val    := CASE WHEN ex_type = 'squat' THEN daniel_squat_rom[i] ELSE daniel_jump_rom[i] END;
    flight_val := daniel_flight[i];
    lr_val     := CASE WHEN i <= 4 THEN 5.0 ELSE 4.0 END; -- slight improvement

    INSERT INTO public.sessions (id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score, analysis_json)
    VALUES (
      gen_random_uuid(), v_daniel_id, ex_type,
      NOW() - ((11 - i) || ' days')::INTERVAL + (8 * 60 * '1 minute'::INTERVAL),
      CASE WHEN ex_type = 'squat' THEN 5 ELSE 10 END,
      daniel_readiness[i],
      jsonb_build_object('readiness', daniel_readiness[i], 'exercise', ex_type)
    )
    RETURNING id INTO v_session_id;

    INSERT INTO public.session_metrics (session_id, metric_key, value) VALUES
      (v_session_id, ex_type || '_rom_deg',   rom_val),
      (v_session_id, 'lr_imbalance_pct',      lr_val),
      (v_session_id, ex_type || '_reps',      CASE WHEN ex_type = 'squat' THEN 5 ELSE 10 END);

    IF ex_type = 'jump' THEN
      INSERT INTO public.session_metrics (session_id, metric_key, value)
      VALUES (v_session_id, 'flight_time_s', flight_val);
    END IF;
  END LOOP;

  -- ── Sessions — Noa Levy (declining, L/R issue) ────────────────────────────
  FOR i IN 1..10 LOOP
    ex_type := CASE WHEN i % 2 = 1 THEN 'squat' ELSE 'jump' END;
    rom_val := CASE WHEN ex_type = 'squat' THEN noa_squat_rom[i] ELSE noa_jump_rom[i] END;

    INSERT INTO public.sessions (id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score, analysis_json)
    VALUES (
      gen_random_uuid(), v_noa_id, ex_type,
      NOW() - ((11 - i) || ' days')::INTERVAL + (7.5 * 60 * '1 minute'::INTERVAL),
      CASE WHEN ex_type = 'squat' THEN 4 ELSE 9 END,
      noa_readiness[i],
      jsonb_build_object('readiness', noa_readiness[i], 'exercise', ex_type)
    )
    RETURNING id INTO v_session_id;

    INSERT INTO public.session_metrics (session_id, metric_key, value) VALUES
      (v_session_id, ex_type || '_rom_deg',  rom_val),
      (v_session_id, 'lr_imbalance_pct',     11.0 + (i * 0.3)), -- worsening imbalance
      (v_session_id, ex_type || '_reps',     CASE WHEN ex_type = 'squat' THEN 4 ELSE 9 END);

    IF ex_type = 'jump' THEN
      INSERT INTO public.session_metrics (session_id, metric_key, value)
      VALUES (v_session_id, 'flight_time_s', noa_flight[i]);
    END IF;
  END LOOP;

  -- ── Sessions — Amit Bar (clear decline, high imbalance) ──────────────────
  FOR i IN 1..10 LOOP
    ex_type := CASE WHEN i % 2 = 1 THEN 'squat' ELSE 'jump' END;
    rom_val := CASE WHEN ex_type = 'squat' THEN amit_squat_rom[i] ELSE amit_jump_rom[i] END;

    INSERT INTO public.sessions (id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score, analysis_json)
    VALUES (
      gen_random_uuid(), v_amit_id, ex_type,
      NOW() - ((11 - i) || ' days')::INTERVAL + (7 * 60 * '1 minute'::INTERVAL),
      CASE WHEN ex_type = 'squat' THEN 3 ELSE 7 END,
      amit_readiness[i],
      jsonb_build_object('readiness', amit_readiness[i], 'exercise', ex_type)
    )
    RETURNING id INTO v_session_id;

    INSERT INTO public.session_metrics (session_id, metric_key, value) VALUES
      (v_session_id, ex_type || '_rom_deg',  rom_val),
      (v_session_id, 'lr_imbalance_pct',     18.0 + (i * 0.5)), -- high and worsening
      (v_session_id, ex_type || '_reps',     CASE WHEN ex_type = 'squat' THEN 3 ELSE 7 END);

    IF ex_type = 'jump' THEN
      INSERT INTO public.session_metrics (session_id, metric_key, value)
      VALUES (v_session_id, 'flight_time_s', amit_flight[i]);
    END IF;
  END LOOP;

  -- ── Notifications ─────────────────────────────────────────────────────────
  INSERT INTO public.notifications (team_id, athlete_id, message, severity) VALUES
    (v_team_id, v_amit_id,  'Amit Bar readiness dropped 12% from baseline', 'critical'),
    (v_team_id, v_noa_id,   'Noa Levy shows increased L/R imbalance (13%)', 'warning'),
    (v_team_id, v_daniel_id,'Daniel Cohen missed today''s jump test',         'warning'),
    (v_team_id, NULL,       '2 athletes require immediate review',             'info');

  RETURN 'Seeded: Wingate U21 team, 3 athletes, 30 sessions, 4 notifications.';
END $$;

-- Run it
SELECT public.seed_dev_data();
