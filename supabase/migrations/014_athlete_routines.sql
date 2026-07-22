-- APeX · Athlete Daily Routine
-- Run this AFTER 013_video_jobs_replica_identity.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per (athlete, exercise): whether that exercise is part of the
-- athlete's daily routine, and how many reps/day are required when it is.
-- Covers all 6 exercises the detection pipeline knows about (the same
-- vocabulary sessions.exercise_type / video_jobs.exercise_type already use —
-- see migration 009's comment and mobile/src/utils/pipelineExercise.ts),
-- not just the 3-exercise squat/jump/pullup set the older team_exercises /
-- required_tests manager system covers.
--
-- No row means "not in the routine" — the app treats a missing row as
-- {enabled: false, target_reps: 5} client-side (see api/routine.ts) rather
-- than every athlete needing 6 pre-seeded rows.
--
-- Editing rule: an athlete with a team can only view + perform their
-- routine; only an individual (teamless) athlete can edit it. Enforced here
-- at the RLS layer, not just by hiding the UI controls client-side — the
-- same team_id IS NULL predicate migration 008 established for "is this an
-- individual athlete".
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.athlete_routines (
  athlete_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exercise_type TEXT NOT NULL CHECK (exercise_type IN ('squat','jump','pullup','deadlift','push_up','ab_crunch')),
  enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  target_reps   INT NOT NULL DEFAULT 5 CHECK (target_reps BETWEEN 1 AND 10),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (athlete_id, exercise_type)
);

CREATE INDEX idx_athlete_routines_athlete ON public.athlete_routines (athlete_id);

-- Reuses the same trigger function 001_schema.sql defined for team_settings.
CREATE TRIGGER trg_athlete_routines_updated_at
  BEFORE UPDATE ON public.athlete_routines
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.athlete_routines ENABLE ROW LEVEL SECURITY;

-- Any athlete (team or individual) can read their own routine — "watch".
CREATE POLICY "athlete reads own routine" ON public.athlete_routines
  FOR SELECT USING (athlete_id = auth.uid());

-- Managers can read their team athletes' routines, mirroring the existing
-- athlete_profiles/sessions manager-read policies. No manager-side editor
-- exists yet — this just keeps the read side consistent/future-proof.
CREATE POLICY "manager reads team athlete routines" ON public.athlete_routines
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND (SELECT team_id FROM public.profiles WHERE id = athlete_routines.athlete_id)
        = public.my_team_id()
  );

-- Only an individual (teamless) athlete may insert/update/delete their own
-- routine rows — "edit". A team athlete's own client is blocked here even
-- if the UI somehow let a write through.
CREATE POLICY "individual athlete manages own routine" ON public.athlete_routines
  FOR ALL USING (
    athlete_id = auth.uid()
    AND (SELECT team_id FROM public.profiles WHERE id = auth.uid()) IS NULL
  ) WITH CHECK (
    athlete_id = auth.uid()
    AND (SELECT team_id FROM public.profiles WHERE id = auth.uid()) IS NULL
  );
