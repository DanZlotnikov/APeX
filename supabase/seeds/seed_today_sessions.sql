-- APeX · Dev Seed Data — today's sessions for Noa Levy & Amit Bar
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds one more day (today) on top of seed_dev_data.sql's 10-day history for
-- these two athletes only, continuing their existing declining arcs one step
-- further. Daniel Cohen is untouched. Run seed_dev_data.sql first.
--
-- Idempotent: skips (per athlete) if a session already exists for them today.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.seed_today_sessions()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_noa_id     UUID;
  v_amit_id    UUID;
  v_session_id UUID;
  v_result     TEXT := '';
BEGIN
  SELECT id INTO v_noa_id  FROM auth.users WHERE email = 'noa.levy@apex.dev';
  SELECT id INTO v_amit_id FROM auth.users WHERE email = 'amit.bar@apex.dev';

  IF v_noa_id IS NULL OR v_amit_id IS NULL THEN
    RAISE EXCEPTION 'noa.levy@apex.dev / amit.bar@apex.dev not found in auth.users — run seed_dev_data.sql first.';
  END IF;

  -- ── Noa Levy — squat + jump today, decline continues ──────────────────────
  IF EXISTS (SELECT 1 FROM public.sessions WHERE athlete_id = v_noa_id AND recorded_at::date = CURRENT_DATE) THEN
    v_result := v_result || 'Noa Levy already has a session today — skipped. ';
  ELSE
    INSERT INTO public.sessions (id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score, analysis_json)
    VALUES (gen_random_uuid(), v_noa_id, 'squat', NOW() - INTERVAL '2 hours', 4, 72,
            jsonb_build_object('readiness', 72, 'exercise', 'squat'))
    RETURNING id INTO v_session_id;
    INSERT INTO public.session_metrics (session_id, metric_key, value) VALUES
      (v_session_id, 'squat_rom_deg',     64.0),
      (v_session_id, 'lr_imbalance_pct',  14.3),
      (v_session_id, 'squat_reps',        4);

    INSERT INTO public.sessions (id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score, analysis_json)
    VALUES (gen_random_uuid(), v_noa_id, 'jump', NOW() - INTERVAL '1 hour', 9, 70,
            jsonb_build_object('readiness', 70, 'exercise', 'jump'))
    RETURNING id INTO v_session_id;
    INSERT INTO public.session_metrics (session_id, metric_key, value) VALUES
      (v_session_id, 'jump_rom_deg',      71.0),
      (v_session_id, 'lr_imbalance_pct',  14.3),
      (v_session_id, 'jump_reps',         9),
      (v_session_id, 'flight_time_s',     0.37);

    v_result := v_result || 'Noa Levy: added squat + jump sessions for today. ';
  END IF;

  -- ── Amit Bar — squat + jump today, decline continues ───────────────────────
  IF EXISTS (SELECT 1 FROM public.sessions WHERE athlete_id = v_amit_id AND recorded_at::date = CURRENT_DATE) THEN
    v_result := v_result || 'Amit Bar already has a session today — skipped.';
  ELSE
    INSERT INTO public.sessions (id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score, analysis_json)
    VALUES (gen_random_uuid(), v_amit_id, 'squat', NOW() - INTERVAL '2 hours', 3, 58,
            jsonb_build_object('readiness', 58, 'exercise', 'squat'))
    RETURNING id INTO v_session_id;
    INSERT INTO public.session_metrics (session_id, metric_key, value) VALUES
      (v_session_id, 'squat_rom_deg',     52.0),
      (v_session_id, 'lr_imbalance_pct',  23.5),
      (v_session_id, 'squat_reps',        3);

    INSERT INTO public.sessions (id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score, analysis_json)
    VALUES (gen_random_uuid(), v_amit_id, 'jump', NOW() - INTERVAL '1 hour', 7, 55,
            jsonb_build_object('readiness', 55, 'exercise', 'jump'))
    RETURNING id INTO v_session_id;
    INSERT INTO public.session_metrics (session_id, metric_key, value) VALUES
      (v_session_id, 'jump_rom_deg',      58.0),
      (v_session_id, 'lr_imbalance_pct',  23.5),
      (v_session_id, 'jump_reps',         7),
      (v_session_id, 'flight_time_s',     0.29);

    v_result := v_result || 'Amit Bar: added squat + jump sessions for today.';
  END IF;

  RETURN v_result;
END $$;

-- Run it
SELECT public.seed_today_sessions();
