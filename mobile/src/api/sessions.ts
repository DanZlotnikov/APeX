import { Assessment } from '../utils/exerciseAnalyzer';
import { ExerciseKey } from '../utils/exerciseMetrics';
import { mean } from '../utils/history';
import { createNotification } from './notifications';
import { supabase } from './supabase';
import { VideoJobAnalysis } from './videoJobs';

// Persists every RiskFactor value the analyzer already computed for ONE
// exercise, keyed `${exerciseKey}_${factorId}` — this is exactly what the
// manager's per-exercise metric thresholds (mobile/src/utils/exerciseMetrics.ts)
// look up against. Jump's `flightTime` isn't a factor (no analyzer factor has
// that id), so it's derived here from perRepDurationSec (flight duration per
// rep, see exerciseAnalyzer.ts's segmentJumps/jPerDur).
function extractMetrics(ex: Assessment['perExercise'][number]): Array<{ metric_key: string; value: number }> {
  const out: Array<{ metric_key: string; value: number }> = [];

  for (const f of ex.factors) {
    out.push({ metric_key: `${ex.key}_${f.id}`, value: f.value });
  }
  if (ex.key === 'jump' && ex.metrics.perRepDurationSec.length > 0) {
    const flightTime = mean(ex.metrics.perRepDurationSec);
    if (flightTime != null) out.push({ metric_key: 'jump_flightTime', value: flightTime });
  }

  return out;
}

const EXERCISE_LABEL: Record<string, string> = {
  squat:  'Squat Test',
  jump:   'Jump Test',
  pullup: 'Pull-up Test',
};

// exerciseKey is the exercise actually performed (see AnalysisScreen's
// target-vs-actual resolution) — the caller decides this, createSession just
// persists it. An athlete can redo any exercise as many times as they like,
// but only one session per (athlete, exercise, day) is kept: any existing
// session for this exercise recorded today is deleted before the new one is
// inserted (cascades to its session_metrics), so history/readiness/manager
// view all only ever see the latest attempt for that day.
//
// teamId is optional: an individual athlete (no manager/team) still gets a
// full cloud-synced session + history, just with no manager to notify — the
// notification step below is simply skipped when there's no team.
export async function createSession(
  assessment:  Assessment,
  teamId:      string | undefined,
  athleteName: string,
  exerciseKey: ExerciseKey,
): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const athleteId = user.id;

  const ex = assessment.perExercise.find((e) => e.key === exerciseKey);
  const repCount = ex?.reps ?? 0;

  const todayUtc = new Date().toISOString().slice(0, 10);
  const { error: deleteErr } = await supabase
    .from('sessions')
    .delete()
    .eq('athlete_id', athleteId)
    .eq('exercise_type', exerciseKey)
    .gte('recorded_at', `${todayUtc}T00:00:00.000Z`)
    .lt('recorded_at', `${todayUtc}T23:59:59.999Z`);
  if (deleteErr) throw deleteErr;

  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .insert({
      athlete_id:      athleteId,
      exercise_type:   exerciseKey,
      rep_count:       repCount,
      readiness_score: assessment.readiness,
      analysis_json:   assessment as any,
    })
    .select('id')
    .single();

  if (sessionErr) throw sessionErr;

  const metricRows = ex ? extractMetrics(ex).map((m) => ({ session_id: session.id, ...m })) : [];

  if (metricRows.length > 0) {
    const { error: metricsErr } = await supabase.from('session_metrics').insert(metricRows);
    if (metricsErr) throw metricsErr;
  }

  // Notify manager for every completed test — nothing to notify without a team
  if (teamId) {
    const label = EXERCISE_LABEL[exerciseKey] ?? exerciseKey;
    await createNotification(teamId, athleteId, `${athleteName} completed a ${label}`, 'info', session.id);
  }

  return session.id;
}

// ── new-pipeline session history ─────────────────────────────────────────────
// The Performance > History tab is a clean break from the retired on-device
// flow above: it only ever shows sessions produced by the new server-side
// pipeline (sessions.biomechanics_json IS NOT NULL — see migration 010 and
// HANDOFF_video_pipeline.md section 3.4). Sessions saved by the old flow
// (analysis_json only, biomechanics_json null) are left untouched in the DB
// but deliberately never surfaced here — no backward-compat rendering for
// that shape in this screen.

export interface SessionHistoryEntry {
  id: string;
  exerciseType: string | null;
  repCount: number;
  readinessScore: number | null;
  recordedAt: string;
  resultVideoPath: string | null;
  biomechanics: VideoJobAnalysis | null;
  durationSec: number | null;
}

const HISTORY_COLUMNS =
  'id, exercise_type, rep_count, readiness_score, recorded_at, result_video_path, biomechanics_json, duration_sec';

function fromHistoryRow(r: any): SessionHistoryEntry {
  return {
    id: r.id,
    exerciseType: r.exercise_type,
    repCount: r.rep_count,
    readinessScore: r.readiness_score,
    recordedAt: r.recorded_at,
    resultVideoPath: r.result_video_path,
    biomechanics: r.biomechanics_json,
    durationSec: r.duration_sec,
  };
}

export async function getSessionHistory(athleteId: string): Promise<SessionHistoryEntry[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select(HISTORY_COLUMNS)
    .eq('athlete_id', athleteId)
    .not('biomechanics_json', 'is', null)
    .order('recorded_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(fromHistoryRow);
}

// Paginated variant for the Readiness screen's scroll-to-load-more history
// list — same "new-pipeline sessions only" scope as getSessionHistory
// above, optionally narrowed to one exercise. `offset`/`limit` map directly
// to a Postgres range; the caller (ReadinessScreen) treats a page shorter
// than `limit` as "no more to load".
export async function getSessionHistoryPage(
  athleteId: string,
  exerciseType: string | null,
  offset: number,
  limit: number,
): Promise<SessionHistoryEntry[]> {
  let query = supabase
    .from('sessions')
    .select(HISTORY_COLUMNS)
    .eq('athlete_id', athleteId)
    .not('biomechanics_json', 'is', null)
    .order('recorded_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (exerciseType) query = query.eq('exercise_type', exerciseType);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(fromHistoryRow);
}

export async function getSessionById(sessionId: string): Promise<SessionHistoryEntry | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select(HISTORY_COLUMNS)
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return data ? fromHistoryRow(data) : null;
}

// Also removes the two-panel video from Storage (RLS from migration 009
// permits the athlete to delete their own processed/ objects directly).
export async function deleteSession(session: Pick<SessionHistoryEntry, 'id' | 'resultVideoPath'>): Promise<void> {
  const { error } = await supabase.from('sessions').delete().eq('id', session.id);
  if (error) throw error;
  if (session.resultVideoPath) {
    const { error: storageErr } = await supabase.storage.from('exercise-videos').remove([session.resultVideoPath]);
    if (storageErr) console.warn('[APeX] Failed to delete session video:', storageErr.message);
  }
}
