-- APeX · Individual Routines
-- Run this AFTER 020_manager_video_access.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Replaces the manager's team-wide routine (team_routines: one shared
-- default for the whole roster, plus a per-athlete boolean override in
-- athlete_exercise_assignments) with a genuinely per-athlete routine: the
-- manager now edits each team athlete's own athlete_routines rows directly,
-- the exact same table/shape an individual (teamless) athlete already
-- self-edits (migration 014). A team athlete still can't write their own
-- rows — "individual athlete manages own routine" (014) already restricts
-- writes to athlete_id = auth.uid() AND team_id IS NULL — only the new
-- manager-write policy below changes.
--
-- team_routines and athlete_exercise_assignments are deliberately NOT
-- dropped here (minimal, additive change) — they simply stop being read or
-- written by the app after this migration. Left in place in case of
-- rollback; safe to drop in a later cleanup once this is confirmed working.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── athlete_routines: let a manager write their own team's athletes' rows ───
-- Mirrors "manager manages team athlete assignments" (003_exercise_config.sql)
-- exactly — same role+team_id shape, just targeting athlete_routines instead
-- of athlete_exercise_assignments. "manager reads team athlete routines"
-- (014) already covers SELECT; this adds INSERT/UPDATE/DELETE.
CREATE POLICY "manager manages team athlete routines" ON public.athlete_routines
  FOR ALL USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND (SELECT team_id FROM public.profiles WHERE id = athlete_routines.athlete_id)
        = public.my_team_id()
  ) WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND (SELECT team_id FROM public.profiles WHERE id = athlete_routines.athlete_id)
        = public.my_team_id()
  );

-- ── Backfill: materialize every team athlete's CURRENT effective routine ────
-- into real athlete_routines rows, so nobody's routine appears to reset to
-- empty the moment the app stops resolving team_routines + overrides live.
-- "Effective" = the per-athlete override if one exists, else the team
-- default's enabled flag (exact same rule mobile/src/api/teamRoutine.ts's
-- resolveEffectiveRoutine used) — only the effectively-ENABLED exercises are
-- inserted, since under the new model presence of a row IS "enabled" (no
-- more writing a disabled row; see api/routine.ts). ON CONFLICT DO NOTHING
-- guards re-running this and against any pre-existing row (shouldn't exist
-- for a team athlete, since they were never allowed to write here before
-- today, but defensive regardless).
INSERT INTO public.athlete_routines (athlete_id, exercise_type, enabled, target_reps)
SELECT
  p.id,
  tr.exercise_type,
  TRUE,
  tr.target_reps
FROM public.profiles p
JOIN public.team_routines tr ON tr.team_id = p.team_id
LEFT JOIN public.athlete_exercise_assignments aea
  ON aea.athlete_id = p.id AND aea.exercise_type = tr.exercise_type
WHERE p.role = 'athlete'
  AND p.team_id IS NOT NULL
  AND COALESCE(aea.assigned, tr.enabled) = TRUE
ON CONFLICT (athlete_id, exercise_type) DO NOTHING;
