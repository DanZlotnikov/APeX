/**
 * Pure computation for the Overview screen's "TODAY'S ROUTINE" table — no
 * network calls, just combines already-fetched data:
 *   - routine: the athlete's routine settings (api/routine.ts)
 *   - todaysSessions: today's saved sessions (api/sessions.ts)
 *   - todaysCompletedJobs: today's completed-but-not-yet-saved video_jobs
 *     (VideoJobsContext's `jobs`, filtered to status === 'completed')
 *
 * Reps accumulate across every attempt at an exercise today, not just the
 * latest one — mirroring save_video_job's same-day accumulate behavior
 * (migration 015: multiple saves of the same exercise on the same day sum
 * their rep counts into one session instead of the later one replacing the
 * earlier). This function sums today's saved session's rep_count (already a
 * running total server-side) with every completed-but-not-yet-saved job's
 * reps, so the count here matches what saving those jobs will actually
 * produce, before the athlete even taps Save. If the athlete discards a
 * completed job, it's deleted and never becomes a session, so it naturally
 * drops out of the total.
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
import { exerciseLabel, resolveJobExerciseKey } from './pipelineExercise';

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

    const session = todaysSessions.find((s) => s.exerciseType === setting.exerciseType);
    if (session) {
      totalReps += session.repCount;
      latestRecordedAt = session.recordedAt;
      latestReadinessPct = session.readinessScore;
    }

    for (const job of todaysCompletedJobs) {
      if (resolveJobExerciseKey(job) !== setting.exerciseType) continue;
      totalReps += job.analysis?.rep_count ?? 0;
      if (latestRecordedAt == null || job.recordedAt > latestRecordedAt) {
        latestRecordedAt = job.recordedAt;
        const balancePct = job.analysis?.analyses?.balance?.overall_balance_pct;
        latestReadinessPct = balancePct != null ? Math.round(balancePct) : null;
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
