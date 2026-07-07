-- APeX · Athlete Injury Tracking
-- Run this AFTER 001_schema.sql + 002_invite_codes.sql + 003_exercise_config.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- "Mark as Injured" doesn't delete any history — it stamps injury_started_at,
-- and the app treats that as a fresh-start cutoff: sessions recorded before it
-- stop counting toward readiness trend / per-exercise readiness / compliance,
-- so the athlete's stats "reset" for a clean injury-recovery track while the
-- pre-injury data stays in the DB for record.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN injured           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN injury_started_at TIMESTAMPTZ;

-- Scoped RPC rather than a broad manager-write RLS policy on profiles — only
-- flips the two injury columns, and only for an athlete on the caller's team.
CREATE OR REPLACE FUNCTION public.mark_athlete_injured(p_athlete_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) != 'manager' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF (SELECT team_id FROM public.profiles WHERE id = p_athlete_id) != public.my_team_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.profiles
  SET injured = TRUE, injury_started_at = NOW()
  WHERE id = p_athlete_id;
END;
$$;
