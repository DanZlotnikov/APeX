/**
 * Pure computation for the Overview screen's "TODAY'S ROUTINE" table — no
 * network calls, just combines already-fetched data:
 *   - routine: the athlete's routine settings (api/routine.ts)
 *   - todaysSessions: today's saved sessions (api/sessions.ts)
 *   - todaysCompletedJobs: today's completed-but-not-yet-saved video_jobs
 *     (VideoJobsContext's `jobs`, filtered to status === 'completed')
 *
 * An exercise becomes eligible to count as "completed" the moment a
 * completed video_jobs row exists for it today — before Save is even
 * tapped — and stays eligible once saved (the same row just moves from
 * video_jobs to sessions). It only actually counts as completed once its
 * rep count meets the daily target, though: 3 reps against a target of 10 is
 * still incomplete, just with progress. If the athlete discards it, the job
 * is deleted and never becomes a session, so it naturally drops out of both
 * input lists and reverts to not-completed. Multiple attempts at the same
 * exercise on the same day (e.g. two completed-but-unsaved recordings, or a
 * completed recording plus an earlier saved session) resolve to whichever is
 * most recent — mirroring sessions' own same-day-replace rule (migration
 * 007/012).
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

interface Candidate {
  recordedAt: string;
  reps: number;
  readinessPct: number | null;
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
    const candidates: Candidate[] = [];

    const session = todaysSessions.find((s) => s.exerciseType === setting.exerciseType);
    if (session) {
      candidates.push({ recordedAt: session.recordedAt, reps: session.repCount, readinessPct: session.readinessScore });
    }

    for (const job of todaysCompletedJobs) {
      if (resolveJobExerciseKey(job) !== setting.exerciseType) continue;
      const balancePct = job.analysis?.analyses?.balance?.overall_balance_pct;
      candidates.push({
        recordedAt: job.recordedAt,
        reps: job.analysis?.rep_count ?? 0,
        readinessPct: balancePct != null ? Math.round(balancePct) : null,
      });
    }

    const latest = candidates.length
      ? candidates.reduce((a, b) => (b.recordedAt > a.recordedAt ? b : a))
      : null;

    // Completed means the daily rep target was actually met, not just that
    // an attempt was processed today — e.g. 3/10 reps is still incomplete.
    const completed = latest != null && latest.reps >= setting.targetReps;
    if (completed) completedCount += 1;

    rows.push({
      exerciseType: setting.exerciseType,
      label: exerciseLabel(setting.exerciseType),
      targetReps: setting.targetReps,
      completedReps: latest?.reps ?? 0,
      readinessPct: latest?.readinessPct ?? null,
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
