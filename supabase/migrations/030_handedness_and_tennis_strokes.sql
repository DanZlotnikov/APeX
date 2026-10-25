-- APeX · Playing hand + forehand/backhand as separate exercises
-- Run this AFTER 029_public_exercise_categories.sql.
-- Run it BEFORE restarting the worker on the matching pipeline code: the worker writes
-- video_jobs.exercise_type = 'tennis_forehand' / 'tennis_backhand', which must already exist in
-- public.exercises (video_jobs_exercise_type_fkey, migration 023).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. profiles.handedness ──────────────────────────────────────────────────
-- Which hand the athlete holds the racket in, chosen at sign-up (and editable in Settings).
-- NULL = not chosen yet (accounts created before this migration): the pipeline then works the
-- racket hand out from the motion itself. An existing column, so no new grants are needed;
-- "update own profile" (001_schema.sql) already lets the athlete set it, and neither profile
-- trigger (019 role/team lock, 028 sport columns) touches it.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS handedness TEXT CHECK (handedness IN ('left', 'right'));

-- ── 2. Forehand and backhand replace the single "Tennis Stroke" ─────────────
-- The pipeline now tells the two apart and scores each against its own targets, so they are
-- separate exercises with separate history and trends. tennis_stroke stays (disabled) so the
-- sessions already saved under it keep their label; it is never produced again.
INSERT INTO public.exercises (key, raw_key, label, short_label, sort_order, enabled, category_key) VALUES
  ('tennis_forehand', 'tennis_forehand', 'Tennis Forehand', 'FOREHAND', 6, TRUE, 'tennis'),
  ('tennis_backhand', 'tennis_backhand', 'Tennis Backhand', 'BACKHAND', 7, TRUE, 'tennis')
ON CONFLICT (key) DO NOTHING;

UPDATE public.exercises SET sort_order = 8 WHERE key = 'tennis_serve';
UPDATE public.exercises SET enabled = FALSE WHERE key = 'tennis_stroke';

-- Routine sets assigned as "Tennis Stroke" become forehand sets, since a stroke video can no
-- longer complete them (a set whose forehand twin already exists is left as it was).
UPDATE public.athlete_routine_sets s
SET exercise_type = 'tennis_forehand'
WHERE s.exercise_type = 'tennis_stroke'
  AND NOT EXISTS (
    SELECT 1 FROM public.athlete_routine_sets f
    WHERE f.athlete_id = s.athlete_id AND f.exercise_type = 'tennis_forehand' AND f.set_index = s.set_index
  );
