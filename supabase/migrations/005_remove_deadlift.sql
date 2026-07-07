-- APeX · Remove Deadlift
-- Run this AFTER 001_schema.sql + 002_invite_codes.sql + 003_exercise_config.sql
-- + 004_athlete_injury.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Deadlift detection intersected too much with squat (torso-lean/hip-angle
-- signature overlap caused frequent misclassification between the two) and has
-- been removed from the analyzer entirely. This migration removes it from the
-- DB as well: deletes any existing deadlift data, then tightens the
-- exercise-key CHECK constraints so it can never be inserted again.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Delete existing deadlift data ─────────────────────────────────────────────

DELETE FROM public.session_metrics
WHERE metric_key LIKE 'deadlift_%'
   OR session_id IN (SELECT id FROM public.sessions WHERE exercise_type = 'deadlift');

DELETE FROM public.sessions WHERE exercise_type = 'deadlift';

DELETE FROM public.athlete_exercise_assignments WHERE exercise_key = 'deadlift';

DELETE FROM public.team_exercises WHERE exercise_key = 'deadlift';

-- ── Tighten CHECK constraints (column-level checks are auto-named
--    "<table>_<column>_check" by Postgres when declared inline, as in
--    001_schema.sql / 003_exercise_config.sql — IF EXISTS guards against a
--    naming mismatch) ───────────────────────────────────────────────────────

ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_exercise_type_check,
  ADD  CONSTRAINT sessions_exercise_type_check CHECK (exercise_type IN ('squat','jump','pullup'));

ALTER TABLE public.team_exercises
  DROP CONSTRAINT IF EXISTS team_exercises_exercise_key_check,
  ADD  CONSTRAINT team_exercises_exercise_key_check CHECK (exercise_key IN ('squat','jump','pullup'));

ALTER TABLE public.athlete_exercise_assignments
  DROP CONSTRAINT IF EXISTS athlete_exercise_assignments_exercise_key_check,
  ADD  CONSTRAINT athlete_exercise_assignments_exercise_key_check CHECK (exercise_key IN ('squat','jump','pullup'));

-- ── create_manager_team: stop seeding a deadlift row for new teams ───────────

CREATE OR REPLACE FUNCTION public.create_manager_team(p_team_name TEXT, p_full_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_team_id UUID;
  v_code    TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  LOOP
    v_code := upper(substr(md5(random()::text || auth.uid()::text || now()::text), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.teams WHERE invite_code = v_code);
  END LOOP;

  INSERT INTO public.teams (name, invite_code) VALUES (p_team_name, v_code) RETURNING id INTO v_team_id;

  INSERT INTO public.team_settings (team_id) VALUES (v_team_id);

  INSERT INTO public.team_exercises (team_id, exercise_key, enabled, min_reps, thresholds, sort_order) VALUES
    (v_team_id, 'squat',  TRUE, 5, '{"depth":80,"symmetry":15,"fatigue":30}'::jsonb,        0),
    (v_team_id, 'jump',   TRUE, 3, '{"landing":65,"symmetry":15,"flightTime":0.40}'::jsonb, 1),
    (v_team_id, 'pullup', TRUE, 3, '{"depth":60,"symmetry":15,"fatigue":30}'::jsonb,        2);

  INSERT INTO public.profiles (id, role, team_id, full_name)
  VALUES (auth.uid(), 'manager', v_team_id, p_full_name);

  RETURN v_team_id;
END;
$$;
