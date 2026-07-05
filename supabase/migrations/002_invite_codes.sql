-- APeX · Invite Codes + Sign-up Functions
-- Run this AFTER 001_schema.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Invite code column on teams ───────────────────────────────────────────────

ALTER TABLE public.teams ADD COLUMN invite_code TEXT;

-- Auto-fill any existing teams (deterministic: based on UUID)
UPDATE public.teams
SET invite_code = upper(substr(md5(id::text), 1, 6))
WHERE invite_code IS NULL;

ALTER TABLE public.teams ALTER COLUMN invite_code SET NOT NULL;
ALTER TABLE public.teams ADD CONSTRAINT teams_invite_code_key UNIQUE (invite_code);

-- ── Public code lookup (used during sign-up, before the user has a profile) ──

CREATE OR REPLACE FUNCTION public.get_team_by_invite_code(p_code TEXT)
RETURNS TABLE(team_id UUID, team_name TEXT) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id, name FROM public.teams WHERE invite_code = upper(trim(p_code));
$$;

-- ── Manager sign-up: create team + profile in one transaction ────────────────

CREATE OR REPLACE FUNCTION public.create_manager_team(p_team_name TEXT, p_full_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_team_id UUID;
  v_code    TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Generate a collision-free 6-char code
  LOOP
    v_code := upper(substr(md5(random()::text || auth.uid()::text || now()::text), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.teams WHERE invite_code = v_code);
  END LOOP;

  INSERT INTO public.teams (name, invite_code) VALUES (p_team_name, v_code) RETURNING id INTO v_team_id;

  INSERT INTO public.team_settings (team_id) VALUES (v_team_id);

  INSERT INTO public.required_tests (team_id, label, enabled, sort_order) VALUES
    (v_team_id, 'Jump Test',      TRUE,  0),
    (v_team_id, 'Squat Test',     TRUE,  1),
    (v_team_id, 'Balance Test',   TRUE,  2),
    (v_team_id, 'Single-Leg Hop', FALSE, 3);

  INSERT INTO public.profiles (id, role, team_id, full_name)
  VALUES (auth.uid(), 'manager', v_team_id, p_full_name);

  RETURN v_team_id;
END;
$$;

-- ── Athlete sign-up: validate invite code + create profile ───────────────────

CREATE OR REPLACE FUNCTION public.join_team_as_athlete(p_invite_code TEXT, p_full_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_team_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id INTO v_team_id
  FROM public.teams WHERE invite_code = upper(trim(p_invite_code));

  IF v_team_id IS NULL THEN RAISE EXCEPTION 'Invalid invite code'; END IF;

  INSERT INTO public.profiles (id, role, team_id, full_name)
  VALUES (auth.uid(), 'athlete', v_team_id, p_full_name);

  INSERT INTO public.athlete_profiles (id) VALUES (auth.uid());

  RETURN v_team_id;
END;
$$;

-- ── Manager: regenerate invite code ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.regenerate_invite_code(p_team_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_code TEXT;
BEGIN
  IF (SELECT role     FROM public.profiles WHERE id = auth.uid()) != 'manager'
  OR (SELECT team_id  FROM public.profiles WHERE id = auth.uid()) != p_team_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  LOOP
    v_code := upper(substr(md5(random()::text || now()::text), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.teams WHERE invite_code = v_code);
  END LOOP;

  UPDATE public.teams SET invite_code = v_code WHERE id = p_team_id;
  RETURN v_code;
END;
$$;
