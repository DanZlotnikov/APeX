/**
 * Pure computation for the Overview screen's "TODAY'S ROUTINE" table — no
 * network calls, just combines already-fetched data:
 *   - routine: the athlete's routine (api/routine.ts) — an ordered list of
 *     sets per exercise
 *   - todaysSessions: today's saved sessions (api/sessions.ts)
 *   - todaysCompletedJobs: today's completed-but-not-yet-saved video_jobs
 *     (VideoJobsContext's `jobs`, filtered to status === 'completed')
 *
 * Each attempt at an exercise today (as of migration 017) is its own
 * permanent, separate `sessions` row — there's no server-side running total
 * to read. This gathers every attempt today (saved sessions plus completed-
 * but-not-yet-saved jobs, so the table matches what saving those jobs will
 * actually add up to before the athlete even taps Save) and hands them to
 * matchAttemptsToSets (utils/routineSets.ts), which positionally matches
 * them against the routine's ordered set targets — see that file for the
 * matching rule. An exercise counts as "completed" once every one of its
 * sets is completed that way, not merely once something was attempted.
 */
import { SessionHistoryEntry } from '../api/sessions';
import { RoutineExercise } from '../api/routine';
import { VideoJob } from '../api/videoJobs';
import { exerciseLabel, readinessPctFromAnalysis, resolveJobExerciseKey } from './pipelineExercise';
import { AttemptForMatching, matchAttemptsToSets } from './routineSets';

export interface RoutineProgressRow {
  exerciseType: string;
  label: string;
  requiredSets: number;
  completedSets: number;
  readinessPct: number | null; // avg readiness across today's completed sets
  completed: boolean;
}

export interface RoutineProgress {
  rows: RoutineProgressRow[];
  completedCount: number;
  requiredCount: number;
  completedPct: number | null; // null when nothing is required (avoid a misleading 0%)
}

export function computeRoutineProgress(
  routine: RoutineExercise[],
  todaysSessions: SessionHistoryEntry[],
  todaysCompletedJobs: VideoJob[],
): RoutineProgress {
  const required = routine.filter((r) => r.sets.length > 0);
  const rows: RoutineProgressRow[] = [];
  let completedCount = 0;

  for (const exercise of required) {
    const attempts: AttemptForMatching[] = [];

    for (const session of todaysSessions) {
      if (session.exerciseType !== exercise.exerciseType) continue;
      attempts.push({ recordedAt: session.recordedAt, repCount: session.repCount, readinessPct: session.readinessScore });
    }
    for (const job of todaysCompletedJobs) {
      if (resolveJobExerciseKey(job) !== exercise.exerciseType) continue;
      const readinessPct = readinessPctFromAnalysis(job.analysis);
      attempts.push({
        recordedAt: job.recordedAt,
        repCount: job.analysis?.rep_count ?? 0,
        readinessPct: readinessPct != null ? Math.round(readinessPct) : null,
      });
    }

    const match = matchAttemptsToSets(exercise.sets, attempts);
    if (match.completedToday) completedCount += 1;

    rows.push({
      exerciseType: exercise.exerciseType,
      label: exerciseLabel(exercise.exerciseType),
      requiredSets: match.requiredSets,
      completedSets: match.completedSets,
      readinessPct: match.avgReadiness,
      completed: match.completedToday,
    });
  }

  return {
    rows,
    completedCount,
    requiredCount: required.length,
    completedPct: required.length ? Math.round((completedCount / required.length) * 100) : null,
  };
}
