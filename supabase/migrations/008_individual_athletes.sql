-- APeX · Individual (teamless) Athletes
-- Run this AFTER 001_schema.sql through 007_daily_session_replace.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Lets an athlete sign up without an invite code, as an individual (pro or
-- amateur) with no manager/team — profiles.team_id simply stays NULL. Every
-- team/manager-scoped feature (exercise assignment, compliance, injury
-- tracking, manager notifications) is already keyed off team_id being
-- non-null via my_team_id()/team_id joins, so it naturally doesn't apply to
-- these athletes — no new "is individual" column, it's derived as
-- `team_id IS NULL` wherever the app needs to know. Nothing changes for
-- athletes who do have a team.
--
-- This does require one RLS fix: the only existing SELECT policy on
-- `profiles` is team-scoped ("team_id = my_team_id()"), which is never true
-- when team_id IS NULL (SQL NULL = NULL is not TRUE) — without a standalone
-- "read your own row" policy, a teamless athlete's own profile row would be
-- invisible to their own client via RLS, even though it physically exists,
-- and they could never get past login ("Profile not found").
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "read own profile" ON public.profiles
  FOR SELECT USING (id = auth.uid());

-- Mirrors join_team_as_athlete, minus the invite-code/team lookup.
CREATE OR REPLACE FUNCTION public.create_individual_athlete(p_full_name TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  INSERT INTO public.profiles (id, role, team_id, full_name)
  VALUES (auth.uid(), 'athlete', NULL, p_full_name);

  INSERT INTO public.athlete_profiles (id) VALUES (auth.uid());
END;
$$;
