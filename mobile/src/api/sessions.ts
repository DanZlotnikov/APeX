import { Assessment } from '../utils/exerciseAnalyzer';
import { createNotification } from './notifications';
import { supabase } from './supabase';

function extractExerciseType(assessment: Assessment): 'squat' | 'deadlift' | 'jump' | 'pullup' {
  const key = (assessment.perExercise[0]?.key ?? '').toLowerCase();
  if (key.includes('jump') || key.includes('vertical')) return 'jump';
  if (key.includes('dead'))                             return 'deadlift';
  if (key.includes('pull'))                             return 'pullup';
  return 'squat';
}

function extractMetrics(assessment: Assessment): Array<{ metric_key: string; value: number }> {
  const out: Array<{ metric_key: string; value: number }> = [];

  for (const ex of assessment.perExercise) {
    const isJump  = ex.key.includes('jump') || ex.key.includes('vertical');
    const exLabel = isJump ? 'jump' : 'squat';

    if (ex.metrics.romDeg > 0) {
      out.push({ metric_key: `${exLabel}_rom_deg`, value: ex.metrics.romDeg });
    }
    out.push({ metric_key: `${exLabel}_reps`, value: ex.reps });

    const symmetry = ex.factors.find((f) => f.id === 'lr_symmetry' || f.rec === 'symmetry');
    if (symmetry) {
      out.push({ metric_key: 'lr_imbalance_pct', value: symmetry.value });
    }

    if (isJump) {
      const flight = ex.factors.find((f) => f.id === 'flight_time');
      if (flight) {
        out.push({ metric_key: 'flight_time_s', value: flight.value });
      }
    }
  }

  return out;
}

const EXERCISE_LABEL: Record<string, string> = {
  squat:    'Squat Test',
  jump:     'Jump Test',
  deadlift: 'Deadlift Test',
  pullup:   'Pull-up Test',
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
