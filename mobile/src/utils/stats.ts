/**
 * Historical comparison engine.
 *
 * Given the just-computed Assessment and the athlete's prior history, derive how
 * each stat changed versus (a) the all-time average and (b) the previous X days.
 * Direction-aware: e.g. a smaller knee angle means a *deeper* squat = better.
 *
 * Runs in React Native after the WebView posts the Assessment — the analysis
 * pipeline itself is unchanged.
 */
import { Assessment } from './exerciseAnalyzer';
import { entriesWithinDays, HistoryEntry, mean } from './history';

type ImproveDir = 'up' | 'down' | 'info';

export interface StatDelta {
  vsAvg: number | null;    // signed % change vs all-time average
  vsRecent: number | null; // signed % change vs previous window
  direction: 'up' | 'down' | 'flat';
  good: boolean | null;    // improved? direction-aware; null = informational
}

export interface Comparison {
  baseline: boolean; // no prior history to compare against
  readiness: StatDelta;
  exercises: Record<string, {
    metrics: Record<string, StatDelta>;
    factors: Record<string, StatDelta>; // by factor id, based on its score
  }>;
}

function pctChange(cur: number, avg: number | null): number | null {
  if (avg == null || Math.abs(avg) < 1e-6) return null;
  return Math.round(((cur - avg) / Math.abs(avg)) * 100);
}

function makeDelta(cur: number, allAvg: number | null, recentAvg: number | null, dir: ImproveDir): StatDelta {
  const vsAvg = pctChange(cur, allAvg);
  const vsRecent = pctChange(cur, recentAvg);
  const ref = vsAvg != null ? vsAvg : vsRecent != null ? vsRecent : 0;
  const direction = ref > 1 ? 'up' : ref < -1 ? 'down' : 'flat';
  let good: boolean | null = null;
  if (dir === 'up') good = direction === 'up' ? true : direction === 'down' ? false : null;
  else if (dir === 'down') good = direction === 'down' ? true : direction === 'up' ? false : null;
  return { vsAvg, vsRecent, direction, good };
}

// pull a value from one entry, or null if that exercise/factor is absent
function exVal(e: HistoryEntry, key: string, pick: (m: any) => number | undefined): number | null {
  const ex = e.assessment.perExercise.find((x) => x.key === key);
  if (!ex) return null;
  const v = pick(ex);
  return v == null ? null : v;
}

function avgOf(entries: HistoryEntry[], get: (e: HistoryEntry) => number | null): number | null {
  const vals = entries.map(get).filter((v): v is number => v != null);
  return mean(vals);
}

// metric direction: which way is "better"
const METRIC_DIR: Record<string, ImproveDir> = {
  minKneeAngle: 'down', // smaller angle = deeper
  romDeg: 'up',
  avgRepSec: 'info',
  reps: 'info',
};

export function compareToHistory(
  assessment: Assessment,
  history: HistoryEntry[],
  windowDays: number,
): Comparison {
  const prior = history; // history passed in should already exclude current session
  const baseline = prior.length === 0;
  const recent = entriesWithinDays(prior, windowDays);

  const readiness = makeDelta(
    assessment.readiness,
    avgOf(prior, (e) => e.assessment.readiness),
    avgOf(recent, (e) => e.assessment.readiness),
    'up',
  );

  const exercises: Comparison['exercises'] = {};
  for (const ex of assessment.perExercise) {
    const key = ex.key;
    const metrics: Record<string, StatDelta> = {};
    (['minKneeAngle', 'romDeg', 'avgRepSec'] as const).forEach((mk) => {
      metrics[mk] = makeDelta(
        ex.metrics[mk],
        avgOf(prior, (e) => exVal(e, key, (m) => m.metrics[mk])),
        avgOf(recent, (e) => exVal(e, key, (m) => m.metrics[mk])),
        METRIC_DIR[mk],
      );
    });
    const factors: Record<string, StatDelta> = {};
    for (const f of ex.factors) {
      factors[f.id] = makeDelta(
        f.score,
        avgOf(prior, (e) => exVal(e, key, (m) => m.factors.find((x: any) => x.id === f.id)?.score)),
        avgOf(recent, (e) => exVal(e, key, (m) => m.factors.find((x: any) => x.id === f.id)?.score)),
        'up',
      );
    }
    exercises[key] = { metrics, factors };
  }

  return { baseline, readiness, exercises };
}
