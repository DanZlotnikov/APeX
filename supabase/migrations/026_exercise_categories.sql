-- APeX · Exercise Categories + Padel
-- Run this AFTER 025_notification_exercise_label.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Every exercise now belongs to a category — a new `exercise_categories`
-- table, same reference-data pattern migration 023 already established for
-- `exercises` itself (key/label/sort_order/enabled + a read-only RLS policy).
-- All 5 existing exercises are backfilled into 'general_fitness'; a new
-- 'padel' category is added along with its first exercise, a basic-detection
-- "Padel Stroke" (see backend/GENMO/scripts/exercises/exercises.py's
-- "stroke" registration and biomechanics/fixation.py's new "arm fixation"
-- metric — padel has no balance/rom profile, only fixation, see migration
-- 027 for why save_video_job() needed a matching readiness-formula update).
--
-- category_key is added nullable, backfilled, THEN set NOT NULL — the only
-- safe order for adding a required column to a table that already has rows.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.exercise_categories (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  sort_order  INT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_exercise_categories_updated_at
  BEFORE UPDATE ON public.exercise_categories
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.exercise_categories ENABLE ROW LEVEL SECURITY;

-- Reference data, not sensitive — same policy shape as migration 023's
-- "authenticated users read exercises".
CREATE POLICY "authenticated users read exercise categories" ON public.exercise_categories
  FOR SELECT USING (auth.uid() IS NOT NULL);

INSERT INTO public.exercise_categories (key, label, sort_order) VALUES
  ('general_fitness', 'General Fitness', 0),
  ('padel',            'Padel',           1)
ON CONFLICT (key) DO NOTHING;

-- ── exercises.category_key ───────────────────────────────────────────────────

ALTER TABLE public.exercises
  ADD COLUMN category_key TEXT REFERENCES public.exercise_categories(key);

UPDATE public.exercises SET category_key = 'general_fitness';

ALTER TABLE public.exercises
  ALTER COLUMN category_key SET NOT NULL;

-- ── Padel's first exercise ───────────────────────────────────────────────────
-- raw_key == key here (no bridging needed, unlike jump/pullup) — same
-- un-bridged pattern squat/push_up/ab_crunch already use. Label spells out
-- "Padel" since it's shown standalone in places with no surrounding category
-- context (History rows, notifications, session titles).

INSERT INTO public.exercises (key, raw_key, label, short_label, sort_order, enabled, category_key) VALUES
  ('stroke', 'stroke', 'Padel Stroke', 'STROKE', 5, TRUE, 'padel')
ON CONFLICT (key) DO NOTHING;
