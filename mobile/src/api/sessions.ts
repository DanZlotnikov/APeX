import { Assessment } from '../utils/exerciseAnalyzer';
import { mean } from '../utils/history';
import { createNotification } from './notifications';
import { supabase } from './supabase';

function extractExerciseType(assessment: Assessment): 'squat' | 'jump' | 'pullup' {
  return assessment.perExercise[0]?.key ?? 'squat';
}

// Persists every RiskFactor value the analyzer already computed, keyed
// `${exerciseKey}_${factorId}` — this is exactly what the manager's per-exercise
// metric thresholds (mobile/src/utils/exerciseMetrics.ts) look up against.
// Jump's `flightTime` isn't a factor (no analyzer factor has that id), so it's
// derived here from perRepDurationSec (flight duration per rep, see
// exerciseAnalyzer.ts's segmentJumps/jPerDur).
function extractMetrics(assessment: Assessment): Array<{ metric_key: string; value: number }> {
  const out: Array<{ metric_key: string; value: number }> = [];

  for (const ex of assessment.perExercise) {
    for (const f of ex.factors) {
      out.push({ metric_key: `${ex.key}_${f.id}`, value: f.value });
    }
    if (ex.key === 'jump' && ex.metrics.perRepDurationSec.length > 0) {
      const flightTime = mean(ex.metrics.perRepDurationSec);
      if (flightTime != null) out.push({ metric_key: 'jump_flightTime', value: flightTime });
    }
  }

  return out;
}

const EXERCISE_LABEL: Record<string, string> = {
  squat:  'Squat Test',
  jump:   'Jump Test',
  pullup: 'Pull-up Test',
};

export async function createSession(
  assessment:  Assessment,
  teamId:      string,
  athleteName: string,
): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const athleteId = user.id;

  const exerciseType = extractExerciseType(assessment);
  const repCount     = assessment.perExercise[0]?.reps ?? 0;

  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .insert({
      athlete_id:      athleteId,
      exercise_type:   exerciseType,
      rep_count:       repCount,
      readiness_score: assessment.readiness,
      analysis_json:   assessment as any,
    })
    .select('id')
    .single();

  if (sessionErr) throw sessionErr;

  const metricRows = extractMetrics(assessment).map((m) => ({
    session_id: session.id,
    ...m,
  }));

  if (metricRows.length > 0) {
    const { error: metricsErr } = await supabase.from('session_metrics').insert(metricRows);
    if (metricsErr) throw metricsErr;
  }

  // Notify manager for every completed test
  const label = EXERCISE_LABEL[exerciseType] ?? exerciseType;
  await createNotification(teamId, athleteId, `${athleteName} completed a ${label}`, 'info', session.id);

  return session.id;
}
