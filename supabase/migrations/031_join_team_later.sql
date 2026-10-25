-- APeX · An individual athlete can join a team later, with the team's invite code
-- Run this AFTER 030_handedness_and_tennis_strokes.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. The role/team lock gets exactly one exception ────────────────────────
-- 019_security_hardening.sql blocks every change to profiles.role / team_id after account creation
-- (it stops a user from making themselves a manager or moving onto any team they like). Joining a
-- team later needs one change through it: an ATHLETE with NO team getting a team, and only from
-- join_team_with_code() below, which checks the invite code first. That function marks its own
-- transaction (apex.joining_team); nothing else can, because each API request is its own
-- transaction and clients can't run SQL. Every other role/team change is still blocked.

CREATE OR REPLACE FUNCTION public.prevent_profile_role_team_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'role and team_id cannot be changed after account creation';
  END IF;
  IF NEW.team_id IS DISTINCT FROM OLD.team_id THEN
    IF NOT (current_setting('apex.joining_team', true) = 'on'
            AND OLD.role = 'athlete' AND OLD.team_id IS NULL AND NEW.team_id IS NOT NULL) THEN
      RAISE EXCEPTION 'role and team_id cannot be changed after account creation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. join_team_with_code ──────────────────────────────────────────────────
-- Called by the athlete themself (Settings → Join a team). Joining means: their main sport now
-- comes from the manager (effective_sport(), 028), the manager can edit their routine (021), and
-- the manager can see their sessions and videos — including those from before they joined (the
-- app says so before they confirm). The manager gets a notification, which opens the athlete.

CREATE OR REPLACE FUNCTION public.join_team_with_code(p_invite_code TEXT)
RETURNS TABLE (team_id UUID, team_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_profile   public.profiles%ROWTYPE;
  v_team_id   UUID;
  v_team_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF v_profile.role <> 'athlete' THEN RAISE EXCEPTION 'Only athletes can join a team'; END IF;
  IF v_profile.team_id IS NOT NULL THEN RAISE EXCEPTION 'You are already on a team'; END IF;

  SELECT t.id, t.name INTO v_team_id, v_team_name
  FROM public.teams t WHERE t.invite_code = upper(trim(p_invite_code));
  IF v_team_id IS NULL THEN RAISE EXCEPTION 'Invalid invite code'; END IF;

  PERFORM set_config('apex.joining_team', 'on', true);  -- this transaction only; see section 1
  UPDATE public.profiles SET team_id = v_team_id WHERE id = auth.uid();
  PERFORM set_config('apex.joining_team', 'off', true);

  INSERT INTO public.notifications (team_id, athlete_id, message, severity)
  VALUES (v_team_id, auth.uid(), v_profile.full_name || ' joined the team', 'info');

  RETURN QUERY SELECT v_team_id, v_team_name;
END;
$$;

REVOKE ALL ON FUNCTION public.join_team_with_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_team_with_code(TEXT) TO authenticated;
