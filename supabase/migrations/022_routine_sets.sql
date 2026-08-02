-- APeX · Routine Sets (reps become sets of reps)
-- Run this AFTER 021_individual_routines.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Replaces athlete_routines' single target_reps-per-exercise shape with a
-- genuine sets structure: each (athlete, exercise) now has an ORDERED list of
-- sets, each with its own target rep count (e.g. Set 1: 5 reps, Set 2: 8 reps,
-- Set 3: 3 reps) instead of one flat daily rep total. Presence of >=1 row for
-- an (athlete_id, exercise_type) still means "this exercise is in the
-- routine" (same convention athlete_routines established) — the vestigial
-- `enabled` column (always TRUE in practice since migration 021, see
-- mobile/src/api/routine.ts) is dropped rather than carried over.
--
-- set_index is ascending display/performance order (Set 1 = smallest index),
-- not necessarily contiguous after removals — the app always reads ORDER BY
-- set_index and never relies on specific index values, so a gap left by a
-- removed set is harmless (see mobile/src/api/routine.ts's addSet, which
-- always allocates max(index)+1 rather than filling gaps).
--
-- Completion is computed client-side (mobile/src/utils/routineSets.ts): the
-- day's attempts at an exercise (each a separate `sessions` row — see
-- migration 017) are matched 1:1, in the order they were recorded, against
-- this table's sets in set_index order. A set counts as completed only if
-- its matched attempt's rep_count meets that set's own target_reps; an
-- exercise counts as completed only once every one of its sets does. No
-- schema changes to `sessions` are needed for this — matching is purely a
-- read-time computation over its existing rep_count/recorded_at columns.
--
-- athlete_routines is deliberately NOT dropped (minimal, additive change,
-- same rollback-safety rationale as migration 021) — it simply stops being
-- read or written by the app after this migration.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.athlete_routine_sets (
  athlete_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exercise_type TEXT NOT NULL CHECK (exercise_type IN ('squat','jump','pullup','deadlift','push_up','ab_crunch')),
  set_index     INT NOT NULL CHECK (set_index >= 0),
  target_reps   INT NOT NULL DEFAULT 3 CHECK (target_reps BETWEEN 1 AND 10),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (athlete_id, exercise_type, set_index)
);

CREATE INDEX idx_athlete_routine_sets_athlete ON public.athlete_routine_sets (athlete_id);

-- Reuses the same trigger function 001_schema.sql defined for team_settings.
CREATE TRIGGER trg_athlete_routine_sets_updated_at
  BEFORE UPDATE ON public.athlete_routine_sets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.athlete_routine_sets ENABLE ROW LEVEL SECURITY;

-- Same four policies athlete_routines ended up with across migrations 014 +
-- 021, retargeted at this table.

CREATE POLICY "athlete reads own routine sets" ON public.athlete_routine_sets
  FOR SELECT USING (athlete_id = auth.uid());

CREATE POLICY "manager reads team athlete routine sets" ON public.athlete_routine_sets
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND (SELECT team_id FROM public.profiles WHERE id = athlete_routine_sets.athlete_id)
        = public.my_team_id()
  );

CREATE POLICY "individual athlete manages own routine sets" ON public.athlete_routine_sets
  FOR ALL USING (
    athlete_id = auth.uid()
    AND (SELECT team_id FROM public.profiles WHERE id = auth.uid()) IS NULL
  ) WITH CHECK (
    athlete_id = auth.uid()
    AND (SELECT team_id FROM public.profiles WHERE id = auth.uid()) IS NULL
  );

CREATE POLICY "manager manages team athlete routine sets" ON public.athlete_routine_sets
  FOR ALL USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND (SELECT team_id FROM public.profiles WHERE id = athlete_routine_sets.athlete_id)
        = public.my_team_id()
  ) WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND (SELECT team_id FROM public.profiles WHERE id = athlete_routine_sets.athlete_id)
        = public.my_team_id()
  );

-- ── Backfill: every existing athlete_routines row becomes exactly ONE set ───
-- (set_index 0) carrying over its old target_reps verbatim — "N reps/day"
-- becomes "1 set of N reps", the closest faithful equivalent, so nobody's
-- routine silently resets or changes difficulty the moment this ships.
INSERT INTO public.athlete_routine_sets (athlete_id, exercise_type, set_index, target_reps)
SELECT athlete_id, exercise_type, 0, target_reps
FROM public.athlete_routines
WHERE enabled = TRUE
ON CONFLICT (athlete_id, exercise_type, set_index) DO NOTHING;
