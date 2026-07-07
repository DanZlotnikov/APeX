-- APeX · Athlete Recovery (end injury tracking)
-- Run this AFTER 001_schema.sql through 005_remove_deadlift.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds the other half of injury tracking: returning an athlete to the regular
-- roster. Both transitions (healthy → injured, injured → recovered) now stamp
-- the same `stats_reset_at` cutoff, which the app uses (instead of
-- injury_started_at) to scope readiness trend / per-exercise readiness /
-- compliance — so switching status in EITHER direction starts a clean stats
-- window from that moment, rather than only resetting on injury.
-- injury_started_at is kept as-is (untouched by recovery) purely as a
-- historical "when did the most recent injury begin" record.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN stats_reset_at TIMESTAMPTZ;

-- Backfill: anyone already marked injured keeps their existing cutoff.
UPDATE public.profiles
SET stats_reset_at = injury_started_at
WHERE injured = TRUE AND injury_started_at IS NOT NULL;

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
  SET injured = TRUE, injury_started_at = NOW(), stats_reset_at = NOW()
  WHERE id = p_athlete_id;
END;
$$;

-- Ends injury tracking and returns the athlete to the regular roster.
-- injury_started_at is left untouched (historical record); stats_reset_at
-- moves forward again so the regular-roster stats start fresh from now,
-- rather than picking back up from the pre-injury history.
CREATE OR REPLACE FUNCTION public.mark_athlete_recovered(p_athlete_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) != 'manager' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF (SELECT team_id FROM public.profiles WHERE id = p_athlete_id) != public.my_team_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.profiles
  SET injured = FALSE, stats_reset_at = NOW()
  WHERE id = p_athlete_id;
END;
$$;
