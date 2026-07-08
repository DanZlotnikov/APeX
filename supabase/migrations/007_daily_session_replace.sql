-- APeX · One session per athlete/exercise/day
-- Run this AFTER 001_schema.sql .. 006_athlete_recovery.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Supports the "today's required tasks" flow: an athlete can redo an exercise
-- as many times as they like, but only the latest attempt for a given
-- exercise on a given day is kept — the app deletes any existing same-day
-- session for that exercise before inserting the new one (see
-- mobile/src/api/sessions.ts createSession). This unique index is a
-- defensive DB-level backstop against that invariant being violated by a
-- race or a bug, not the primary enforcement mechanism (a plain UNIQUE
-- constraint can't express "replace on conflict" by itself, so the app still
-- does the delete-then-insert).
--
-- Truncated to a UTC calendar day to match the app's own definition of
-- "today" (new Date().toISOString().slice(0,10)) everywhere else.
--
-- Data predating this migration can violate the invariant (multiple
-- same-day sessions per exercise recorded before "replace on save" existed),
-- so duplicates are cleaned up first — keeping the latest attempt per
-- (athlete, exercise, day), same as the app's own replace behavior — before
-- the unique index is created. session_metrics cascades on session delete.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM public.sessions s
WHERE s.id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY athlete_id, exercise_type, ((recorded_at AT TIME ZONE 'UTC')::date)
      ORDER BY recorded_at DESC
    ) AS rn
    FROM public.sessions
  ) ranked
  WHERE ranked.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS sessions_athlete_exercise_day_uniq
  ON public.sessions (athlete_id, exercise_type, ((recorded_at AT TIME ZONE 'UTC')::date));
