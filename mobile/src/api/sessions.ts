import { Assessment } from '../utils/exerciseAnalyzer';
import { ExerciseKey } from '../utils/exerciseMetrics';
import { mean } from '../utils/history';
import { createNotification } from './notifications';
import { supabase } from './supabase';

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
