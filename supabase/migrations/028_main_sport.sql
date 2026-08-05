-- APeX · Main Sport (Tennis category + per-profile/per-athlete sport selection)
-- Run this AFTER 001_schema.sql through 027_readiness_from_fixation.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds a "main sport" to every profile, correlating 1:1 with
-- exercise_categories (026_exercise_categories.sql). An individual athlete
-- or a manager picks their own; a team athlete inherits their manager's pick
-- unless the manager sets a per-athlete override — same "sparse override, no
-- row/value = inherit the default" shape athlete_exercise_assignments
-- (003_exercise_config.sql) already uses for exercise enablement.
--
-- Also adds Tennis as a second real sport category (stroke + serve), so the
-- pipeline has more than one non-general-fitness sport to actually
-- disambiguate between — see exercises.py's Python-side changes shipped
-- alongside this migration.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Tennis category + exercises ──────────────────────────────────────────────

INSERT INTO public.exercise_categories (key, label, sort_order) VALUES
  ('tennis', 'Tennis', 2)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.exercises (key, raw_key, label, short_label, sort_order, enabled, category_key) VALUES
  ('tennis_stroke', 'tennis_stroke', 'Tennis Stroke', 'STROKE', 6, TRUE, 'tennis'),
  ('tennis_serve',  'tennis_serve',  'Tennis Serve',  'SERVE',  7, TRUE, 'tennis')
ON CONFLICT (key) DO NOTHING;

-- ── profiles.main_sport_key / sport_override_key ─────────────────────────────
-- Nullable -> backfill -> NOT NULL is the only safe order for adding a
-- required column to a table that already has rows (same reasoning
-- 026_exercise_categories.sql's category_key backfill already documents).

ALTER TABLE public.profiles ADD COLUMN main_sport_key TEXT REFERENCES public.exercise_categories(key);
UPDATE public.profiles SET main_sport_key = 'general_fitness';
ALTER TABLE public.profiles ALTER COLUMN main_sport_key SET NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN main_sport_key SET DEFAULT 'general_fitness';

-- Manager-set per-athlete override — NULL (the common case) means "use the
-- team's/manager's own main_sport_key". Only ever meaningful for a team
-- athlete; the CHECK below keeps that true structurally, not just by
-- convention.
ALTER TABLE public.profiles ADD COLUMN sport_override_key TEXT REFERENCES public.exercise_categories(key);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_sport_override_requires_team
  CHECK (sport_override_key IS NULL OR team_id IS NOT NULL);

-- ── Enforcement trigger ───────────────────────────────────────────────────────
-- The only existing UPDATE policy on profiles ("update own profile",
-- 001_schema.sql) is a blanket "you can update your own row" — it has no
-- idea which COLUMN is being touched, so on its own it would let a team
-- athlete quietly rewrite their own main_sport_key (meaningless while
-- inherited, but should still be a hard no, not just hidden in the UI) and
-- would let ANY authenticated user set their own sport_override_key
-- (meant to be exclusively the manager's call). Same "trigger, not an RLS
-- WITH CHECK subquery" reasoning prevent_profile_role_team_change already
-- uses (019_security_hardening.sql) — a BEFORE UPDATE trigger's OLD/NEW is
-- unambiguous, and this is a real defense-in-depth backstop, not just
-- client-side UI hiding.
--
-- auth.uid() inside a SECURITY DEFINER function still reflects the ACTUAL
-- calling user's JWT (it reads a session GUC, not the executing role), so
-- set_athlete_sport_override (below) calling this as the manager correctly
-- has auth.uid() = the manager's id, not the athlete's — this trigger does
-- not block that legitimate path, only a direct client-side self-update.

CREATE OR REPLACE FUNCTION public.enforce_sport_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.main_sport_key IS DISTINCT FROM OLD.main_sport_key
     AND OLD.team_id IS NOT NULL AND OLD.role = 'athlete' AND auth.uid() = OLD.id THEN
    RAISE EXCEPTION 'main_sport is set by your manager while you are on a team';
  END IF;

  IF NEW.sport_override_key IS DISTINCT FROM OLD.sport_override_key
     AND auth.uid() = OLD.id THEN
    RAISE EXCEPTION 'sport_override_key can only be set by your manager';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_enforce_sport
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_sport_columns();

-- ── effective_sport(): the one place "what sport does this athlete play,
-- accounting for inheritance/override" is computed ────────────────────────
-- COALESCE order: an athlete's own per-athlete override always wins; else,
-- if they're on a team, their manager's main_sport_key; else (individual
-- athlete, or called on a manager themselves) their own main_sport_key.

CREATE OR REPLACE FUNCTION public.effective_sport(p_athlete_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    a.sport_override_key,
    CASE WHEN a.team_id IS NOT NULL THEN
      (SELECT m.main_sport_key FROM public.profiles m WHERE m.team_id = a.team_id AND m.role = 'manager')
    END,
    a.main_sport_key
  )
  FROM public.profiles a WHERE a.id = p_athlete_id
$$;

-- ── set_athlete_sport_override: manager sets/clears one athlete's override ──
-- Same shape as mark_athlete_injured (006_athlete_recovery.sql): manager-role
-- check, then same-team check, then UPDATE. p_sport_key = NULL clears the
-- override (falls back to the team default).

CREATE OR REPLACE FUNCTION public.set_athlete_sport_override(p_athlete_id UUID, p_sport_key TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) != 'manager' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF (SELECT team_id FROM public.profiles WHERE id = p_athlete_id) != public.my_team_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_sport_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.exercise_categories WHERE key = p_sport_key) THEN
    RAISE EXCEPTION 'Unknown sport';
  END IF;

  UPDATE public.profiles SET sport_override_key = p_sport_key WHERE id = p_athlete_id;
END;
$$;

-- ── Signup RPCs: accept an optional main sport, default general_fitness ─────
-- Trailing + DEFAULT-valued param, so an already-deployed client calling the
-- old (fewer-arg) signature keeps working unchanged.

CREATE OR REPLACE FUNCTION public.create_manager_team(
  p_team_name TEXT, p_full_name TEXT, p_main_sport_key TEXT DEFAULT 'general_fitness'
)
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

  INSERT INTO public.profiles (id, role, team_id, full_name, main_sport_key)
  VALUES (auth.uid(), 'manager', v_team_id, p_full_name, COALESCE(p_main_sport_key, 'general_fitness'));

  RETURN v_team_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_team_as_athlete(
  p_invite_code TEXT, p_full_name TEXT, p_main_sport_key TEXT DEFAULT 'general_fitness'
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_team_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id INTO v_team_id
  FROM public.teams WHERE invite_code = upper(trim(p_invite_code));

  IF v_team_id IS NULL THEN RAISE EXCEPTION 'Invalid invite code'; END IF;

  INSERT INTO public.profiles (id, role, team_id, full_name, main_sport_key)
  VALUES (auth.uid(), 'athlete', v_team_id, p_full_name, COALESCE(p_main_sport_key, 'general_fitness'));

  INSERT INTO public.athlete_profiles (id) VALUES (auth.uid());

  RETURN v_team_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_individual_athlete(
  p_full_name TEXT, p_main_sport_key TEXT DEFAULT 'general_fitness'
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  INSERT INTO public.profiles (id, role, team_id, full_name, main_sport_key)
  VALUES (auth.uid(), 'athlete', NULL, p_full_name, COALESCE(p_main_sport_key, 'general_fitness'));

  INSERT INTO public.athlete_profiles (id) VALUES (auth.uid());
END;
$$;
