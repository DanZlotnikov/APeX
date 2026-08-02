/**
 * Matches a day's exercise attempts against a routine's ordered set targets —
 * the one place this algorithm lives, shared by the athlete-facing "Today's
 * Routine" progress (routineProgress.ts, which also knows about unsaved-but-
 * completed video_jobs) and the manager/self view model (api/athletes.ts,
 * which only ever sees persisted `sessions` rows). See
 * supabase/migrations/022_routine_sets.sql for why this is a read-time
 * computation rather than something stored on `sessions`.
 *
 * Matching is positional: each attempt today, in the order it was recorded,
 * is checked against the set at the same position (Set 1, Set 2, ...) — the
 * same order an athlete would actually perform sets in. A set counts as
 * completed only if its matched attempt's rep_count meets that set's own
 * target_reps; an extra attempt beyond the number of sets required, or one
 * recorded before an earlier set was ever attempted, simply has nothing to
 * bind to. A short attempt (e.g. 3/4 reps) is still saved as a `sessions`
 * row elsewhere — this function just doesn't count it toward completion.
 */
import { RoutineSet } from '../api/routine';

export interface AttemptForMatching {
  recordedAt: string; // ISO timestamp
  repCount: number;
  readinessPct: number | null;
}

export interface SetMatchResult {
  requiredSets: number;
  completedSets: number;
  completedToday: boolean; // requiredSets > 0 && completedSets >= requiredSets
  avgReadiness: number | null; // avg readiness across attempts that completed a set; null if none did
}

export function matchAttemptsToSets(sets: RoutineSet[], attemptsToday: AttemptForMatching[]): SetMatchResult {
  const orderedSets = sets.slice().sort((a, b) => a.index - b.index);
  const orderedAttempts = attemptsToday
    .slice()
    .sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0));

  let completedSets = 0;
  const completedReadiness: number[] = [];

  for (let i = 0; i < orderedSets.length; i++) {
    const attempt = orderedAttempts[i];
    if (!attempt) continue; // no attempt recorded at this position yet
    if (attempt.repCount >= orderedSets[i].targetReps) {
      completedSets += 1;
      if (attempt.readinessPct != null) completedReadiness.push(attempt.readinessPct);
    }
  }

  const requiredSets = orderedSets.length;
  return {
    requiredSets,
    completedSets,
    completedToday: requiredSets > 0 && completedSets >= requiredSets,
    avgReadiness: completedReadiness.length
      ? Math.round(completedReadiness.reduce((a, b) => a + b, 0) / completedReadiness.length)
      : null,
  };
}
