/**
 * Pure computation for the Overview screen's "TODAY'S ROUTINE" table — no
 * network calls, just combines already-fetched data:
 *   - routine: the athlete's routine settings (api/routine.ts)
 *   - todaysSessions: today's saved sessions (api/sessions.ts)
 *   - todaysCompletedJobs: today's completed-but-not-yet-saved video_jobs
 *     (VideoJobsContext's `jobs`, filtered to status === 'completed')
 *
 * Reps shown are the TOTAL across every separate attempt at an exercise
 * today, not just the latest one — but each attempt is (as of migration
 * 017) its own permanent, separate `sessions` row; there is no server-side
 * pre-summed running total to read anymore (migration 015/016's same-day
 * MERGE behavior was reverted after it turned out not to be what was
 * wanted — it silently overwrote each attempt's own video/report with the
 * next one's, which read as "the same video, but reps keep counting up").
 * So this sums across every matching session today itself, plus every
 * completed-but-not-yet-saved job's reps, so the total here matches what
 * saving those jobs will actually add up to before the athlete even taps
 * Save. If the athlete discards a completed job, it's deleted and never
 * becomes a session, so it naturally drops out of the total.
 *
 * An exercise counts as "completed" once that running total meets the daily
 * target, not merely once something was attempted — 3 reps against a
 * target of 10 is still incomplete, just with progress. Readiness displayed
 * is whichever attempt (saved session or unsaved job) was recorded most
 * recently — there's no meaningful way to merge two different clips'
 * joint-by-joint breakdowns into one number, so this is a "your last set's
 * reading" indicator, not an average.
 */
import { SessionHistoryEntry } from '../api/sessions';
import { RoutineSetting } from '../api/routine';
import { VideoJob } from '../api/videoJobs';
import { exerciseLabel, readinessPctFromAnalysis, resolveJobExerciseKey } from './pipelineExercise';

export interface RoutineProgressRow {
  exerciseType: string;
  label: string;
  targetReps: number;
  completedReps: number;
  readinessPct: number | null;
  completed: boolean;
}

export interface RoutineProgress {
  rows: RoutineProgressRow[];
  completedCount: number;
  requiredCount: number;
  completedPct: number | null; // null when nothing is required (avoid a misleading 0%)
}

export function computeRoutineProgress(
  routine: RoutineSetting[],
  todaysSessions: SessionHistoryEntry[],
  todaysCompletedJobs: VideoJob[],
): RoutineProgress {
  const required = routine.filter((r) => r.enabled);
  const rows: RoutineProgressRow[] = [];
  let completedCount = 0;

  for (const setting of required) {
    let totalReps = 0;
    let latestRecordedAt: string | null = null;
    let latestReadinessPct: number | null = null;

    // Every attempt today is its own separate session row (migration 017)
    // — sum across ALL of them, not just the first/only match.
    for (const session of todaysSessions) {
      if (session.exerciseType !== setting.exerciseType) continue;
      totalReps += session.repCount;
      if (latestRecordedAt == null || session.recordedAt > latestRecordedAt) {
        latestRecordedAt = session.recordedAt;
        latestReadinessPct = session.readinessScore;
      }
    }

    for (const job of todaysCompletedJobs) {
      if (resolveJobExerciseKey(job) !== setting.exerciseType) continue;
      totalReps += job.analysis?.rep_count ?? 0;
      if (latestRecordedAt == null || job.recordedAt > latestRecordedAt) {
        latestRecordedAt = job.recordedAt;
        const readinessPct = readinessPctFromAnalysis(job.analysis);
        latestReadinessPct = readinessPct != null ? Math.round(readinessPct) : null;
      }
    }

    // Completed means the daily rep target was actually met, not just that
    // an attempt was processed today — e.g. 3/10 reps is still incomplete.
    const completed = totalReps >= setting.targetReps;
    if (completed) completedCount += 1;

    rows.push({
      exerciseType: setting.exerciseType,
      label: exerciseLabel(setting.exerciseType),
      targetReps: setting.targetReps,
      completedReps: totalReps,
      readinessPct: latestReadinessPct,
      completed,
    });
  }

  return {
    rows,
    completedCount,
    requiredCount: required.length,
    completedPct: required.length ? Math.round((completedCount / required.length) * 100) : null,
  };
}
