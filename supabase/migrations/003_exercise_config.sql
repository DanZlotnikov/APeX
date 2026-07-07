-- APeX · Exercise Configuration (manager "Exercises" tab)
-- Run this AFTER 001_schema.sql + 002_invite_codes.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Replaces the never-wired-up `required_tests` table and the
-- `team_settings.max_lr_imbalance` / `required_tests_per_day` columns with a
-- real per-exercise configuration: which exercises the team tests, the
-- minimum rep count, and three research-backed metric thresholds each
-- (see mobile/src/utils/exerciseMetrics.ts for the metric catalog + citations
-- — defaults below MUST stay in sync with that file).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── team_exercises ────────────────────────────────────────────────────────────

CREATE TABLE public.team_exercises (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  exercise_key TEXT NOT NULL CHECK (exercise_key IN ('squat','deadlift','jump','pullup')),
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  min_reps     INT NOT NULL DEFAULT 3,
  thresholds   JSONB NOT NULL DEFAULT '{}'::jsonb, -- { "<metricId>": <number>, ... }
  sort_order   INT NOT NULL DEFAULT 0,
  UNIQUE (team_id, exercise_key)
);

CREATE INDEX idx_team_exercises_team ON public.team_exercises (team_id);

-- ── athlete_exercise_assignments ─────────────────────────────────────────────
-- Per-athlete assignment EXCEPTIONS only. No row for an (athlete, exercise)
-- pair means "use team_exercises.enabled" — only explicit overrides live here.

CREATE TABLE public.athlete_exercise_assignments (
  athlete_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exercise_key TEXT NOT NULL CHECK (exercise_key IN ('squat','deadlift','jump','pullup')),
  assigned     BOOLEAN NOT NULL,
  PRIMARY KEY (athlete_id, exercise_key)
);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.team_exercises              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_exercise_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read team exercises" ON public.team_exercises
  FOR SELECT USING (team_id = public.my_team_id());

CREATE POLICY "manager manages team exercises" ON public.team_exercises
  FOR ALL USING (
    team_id = public.my_team_id()
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
  ) WITH CHECK (team_id = public.my_team_id());

CREATE POLICY "athlete reads own assignments" ON public.athlete_exercise_assignments
  FOR SELECT USING (athlete_id = auth.uid());

CREATE POLICY "manager manages team athlete assignments" ON public.athlete_exercise_assignments
  FOR ALL USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND (SELECT team_id FROM public.profiles WHERE id = athlete_exercise_assignments.athlete_id)
        = public.my_team_id()
  ) WITH CHECK (
    (SELECT team_id FROM public.profiles WHERE id = athlete_exercise_assignments.athlete_id)
    = public.my_team_id()
  );

-- ── Backfill default rows for existing teams ─────────────────────────────────

INSERT INTO public.team_exercises (team_id, exercise_key, enabled, min_reps, thresholds, sort_order)
SELECT t.id, x.exercise_key, TRUE, x.min_reps, x.thresholds::jsonb, x.sort_order
FROM public.teams t
CROSS JOIN (VALUES
  ('squat',    5, '{"depth":80,"symmetry":15,"fatigue":30}',  0),
  ('deadlift', 5, '{"hinge":20,"symmetry":20,"fatigue":30}',  1),
  ('jump',     3, '{"landing":65,"symmetry":15,"flightTime":0.40}', 2),
  ('pullup',   3, '{"depth":60,"symmetry":15,"fatigue":30}',  3)
) AS x(exercise_key, min_reps, thresholds, sort_order)
ON CONFLICT (team_id, exercise_key) DO NOTHING;

-- ── create_manager_team: seed team_exercises instead of required_tests ──────

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
    (v_team_id, 'squat',    TRUE, 5, '{"depth":80,"symmetry":15,"fatigue":30}'::jsonb,          0),
    (v_team_id, 'deadlift', TRUE, 5, '{"hinge":20,"symmetry":20,"fatigue":30}'::jsonb,          1),
    (v_team_id, 'jump',     TRUE, 3, '{"landing":65,"symmetry":15,"flightTime":0.40}'::jsonb,   2),
    (v_team_id, 'pullup',   TRUE, 3, '{"depth":60,"symmetry":15,"fatigue":30}'::jsonb,          3);

  INSERT INTO public.profiles (id, role, team_id, full_name)
  VALUES (auth.uid(), 'manager', v_team_id, p_full_name);

  RETURN v_team_id;
END;
$$;

-- ── Drop superseded objects ───────────────────────────────────────────────────

DROP TABLE public.required_tests;

ALTER TABLE public.team_settings
  DROP COLUMN max_lr_imbalance,
  DROP COLUMN required_tests_per_day;
