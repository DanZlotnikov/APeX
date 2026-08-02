-- APeX · Exercises Registry (source of truth for available exercises) + Deadlift Removal
-- Run this AFTER 022_routine_sets.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Two changes bundled together because they touch the same constraints:
--
-- 1. New `exercises` table: the app's list of available exercises (key,
--    labels, display order, enabled/disabled) now lives here instead of
--    being hardcoded in mobile (PIPELINE_EXERCISE_KEYS/LABELS) or implied by
--    a CHECK constraint. Disabling/relabeling/reordering/re-enabling any
--    exercise the pipeline already knows how to detect is now a data change
--    — no mobile app-store release, no new migration. Detection itself (the
--    pose-analysis discriminator) is still real Python code
--    (backend/GENMO/scripts/exercises/) — this table doesn't change that,
--    it only changes how the app learns which of the pipeline's known
--    exercises are currently offered, and what to call them.
--
--    `key` is the bridged vocabulary sessions/athlete_routine_sets already
--    store; `raw_key` is the pipeline's own raw output vocabulary
--    video_jobs stores (see mobile/src/utils/pipelineExercise.ts's old
--    RAW_TO_BRIDGED comment) — identical for squat/push_up/ab_crunch,
--    different for jump/pullup (vertical_jump/pull_up).
--
-- 2. Deadlift removed for good: it's caused genuine squat misdetections
--    twice now (migration 005 removed it from the old on-device analyzer
--    for this exact reason; the new pipeline's reintroduction, migration
--    018, has now shown the same failure — see backend/GENMO/scripts/
--    exercises/analyze.py's _resolve_standing and exercises.py's history).
--    Simply not seeded into `exercises` below, plus existing deadlift data
--    is deleted (mirrors migration 005's deletion order/pattern) and the
--    exercise_type columns that used to CHECK against a hardcoded list now
--    FK against this table, so 'deadlift' can never be written again.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── exercises: the registry itself ───────────────────────────────────────────

CREATE TABLE public.exercises (
  key         TEXT PRIMARY KEY,
  raw_key     TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  short_label TEXT NOT NULL,
  sort_order  INT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_exercises_updated_at
  BEFORE UPDATE ON public.exercises
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;

-- Reference data, not sensitive — any signed-in user (athlete or manager)
-- can read the full list. No write policy: managed via migration for now,
-- same as every other exercise-vocabulary decision in this schema so far.
CREATE POLICY "authenticated users read exercises" ON public.exercises
  FOR SELECT USING (auth.uid() IS NOT NULL);

INSERT INTO public.exercises (key, raw_key, label, short_label, sort_order, enabled) VALUES
  ('squat',     'squat',         'Squat',         'SQUAT',     0, TRUE),
  ('jump',      'vertical_jump', 'Vertical Jump',  'JUMP',      1, TRUE),
  ('pullup',    'pull_up',       'Pull-Up',        'PULL-UP',   2, TRUE),
  ('push_up',   'push_up',       'Push-Up',        'PUSH-UP',   3, TRUE),
  ('ab_crunch', 'ab_crunch',     'Ab Crunch',      'AB CRUNCH', 4, TRUE)
ON CONFLICT (key) DO NOTHING;

-- ── Delete existing deadlift data (mirrors migration 005's order/pattern) ───

DELETE FROM public.session_metrics
WHERE metric_key LIKE 'deadlift_%'
   OR session_id IN (SELECT id FROM public.sessions WHERE exercise_type = 'deadlift');

DELETE FROM public.sessions WHERE exercise_type = 'deadlift';
DELETE FROM public.video_jobs WHERE exercise_type = 'deadlift';
DELETE FROM public.athlete_routine_sets WHERE exercise_type = 'deadlift';

-- ── Convert exercise_type from a hardcoded CHECK list to a real FK ───────────
-- against the registry above — this is what makes future availability
-- changes a pure data operation instead of a new migration.

ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_exercise_type_check,
  ADD  CONSTRAINT sessions_exercise_type_fkey FOREIGN KEY (exercise_type) REFERENCES public.exercises(key);

ALTER TABLE public.athlete_routine_sets
  DROP CONSTRAINT IF EXISTS athlete_routine_sets_exercise_type_check,
  ADD  CONSTRAINT athlete_routine_sets_exercise_type_fkey FOREIGN KEY (exercise_type) REFERENCES public.exercises(key);

-- video_jobs.exercise_type (migration 009) was never CHECK-constrained
-- (nullable free text set by the worker, which writes via the service-role
-- key and so bypasses RLS but not FKs/CHECKs) — this is its first real
-- constraint. References raw_key since this column holds the pipeline's raw
-- vocabulary, not the bridged one.
ALTER TABLE public.video_jobs
  ADD CONSTRAINT video_jobs_exercise_type_fkey FOREIGN KEY (exercise_type) REFERENCES public.exercises(raw_key);
