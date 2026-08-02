/**
 * Per-exercise readiness trend + the exercise-picker option list backing it
 * — see screens/dashboard/ReadinessScreen.tsx, the screen reached by
 * tapping either athlete-facing "READINESS TREND" card
 * (OverviewScreen.tsx / manager's AthleteDetailPreview.tsx). Paginated
 * session history for that same screen lives in api/sessions.ts's
 * getSessionHistoryPage, alongside its sibling getSessionHistory.
 */
import { supabase } from './supabase';

export type ReadinessWindowDays = 7 | 30 | 90 | 365;

export interface ReadinessPoint {
  recordedAt: string;
  readiness: number;
}

// Every qualifying session in the window is its own point, chronological,
// no per-day averaging — the same simple semantics
// api/athletes.ts's buildViewModel already uses for its fixed 30-day
// readinessHistory (just parameterized here by window and exercise instead
// of hardcoded to 30 days / all exercises mixed together). `exerciseType`
// null means "overall" — every exercise, unfiltered.
export async function getReadinessTrend(
  athleteId: string,
  exerciseType: string | null,
  windowDays: ReadinessWindowDays,
): Promise<ReadinessPoint[]> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  let query = supabase
    .from('sessions')
    .select('recorded_at, readiness_score')
    .eq('athlete_id', athleteId)
    .gte('recorded_at', cutoff)
    .not('readiness_score', 'is', null)
    .order('recorded_at', { ascending: true });
  if (exerciseType) query = query.eq('exercise_type', exerciseType);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r) => ({ recordedAt: r.recorded_at, readiness: r.readiness_score as number }));
}

// Distinct exercise types this athlete actually has saved history for —
// same "new-pipeline sessions only" scope api/sessions.ts's getSessionHistory
// uses, so the picker never offers an exercise with nothing to show. Not
// scoped to any time window (an exercise dropped from a chart's window is
// still a real, pickable option — it just renders "No data yet" until you
// widen the window or it's dropped entirely once picked with zero history,
// which can't happen since this list itself is history-derived).
export async function getExercisesWithHistory(athleteId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('exercise_type')
    .eq('athlete_id', athleteId)
    .not('biomechanics_json', 'is', null);
  if (error) throw error;
  const seen = new Set<string>();
  for (const r of data ?? []) {
    if (r.exercise_type) seen.add(r.exercise_type);
  }
  return Array.from(seen);
}
