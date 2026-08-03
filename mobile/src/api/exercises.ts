/**
 * The app's exercise registry — see supabase/migrations/023_exercises_registry.sql
 * and 026_exercise_categories.sql. Source of truth for which exercises
 * exist, their display labels, which category they belong to, and the
 * order they're shown in — no longer hardcoded in mobile (see
 * utils/pipelineExercise.ts, which wraps this for the rest of the app).
 */
import { supabase } from './supabase';

export interface ExerciseInfo {
  key: string;    // bridged vocabulary — matches sessions/athlete_routine_sets.exercise_type
  rawKey: string; // pipeline's raw vocabulary — matches video_jobs.exercise_type
  label: string;
  shortLabel: string;
  sortOrder: number;
  enabled: boolean;
  categoryKey: string; // matches exercise_categories.key — every exercise has one (required column)
}

export interface ExerciseCategoryInfo {
  key: string;
  label: string;
  sortOrder: number;
  enabled: boolean;
}

let cachedPromise: Promise<ExerciseInfo[]> | null = null;
let cachedList: ExerciseInfo[] = [];

// Fetches EVERY row, enabled or not — a session recorded for an exercise
// that's since been disabled (disabling never deletes its history, that's
// the whole point of the registry) still needs a real label wherever it's
// displayed (History, the Readiness screen's exercise picker), not just a
// raw key. getAvailableExercises() below is the enabled-only view most
// callers actually want; this is the one real fetch backing both.
async function fetchAllExercises(): Promise<ExerciseInfo[]> {
  const { data, error } = await supabase
    .from('exercises')
    .select('key, raw_key, label, short_label, sort_order, enabled, category_key')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  const list = (data ?? []).map((r) => ({
    key: r.key,
    rawKey: r.raw_key,
    label: r.label,
    shortLabel: r.short_label,
    sortOrder: r.sort_order,
    enabled: r.enabled,
    categoryKey: r.category_key,
  }));
  cachedList = list;
  return list;
}

// Fetched once and memoized for the app session: every caller (data-layer
// functions like api/routine.ts/api/athletes.ts, or a screen's own load
// callback) awaits the same in-flight/resolved promise, so there's at most
// one network round trip and no "cache not populated yet" race between
// whichever caller happens to run first. A failure (e.g. called before auth
// has resolved, so RLS rejects it) is deliberately NOT memoized — the next
// caller gets a fresh attempt rather than a permanently empty registry for
// the rest of the session.
export function getAllExercises(): Promise<ExerciseInfo[]> {
  if (!cachedPromise) {
    cachedPromise = fetchAllExercises().catch((e) => {
      cachedPromise = null;
      throw e;
    });
  }
  return cachedPromise;
}

// Only enabled exercises, in display order — a disabled exercise (toggled
// off in Supabase, no app update needed) simply never appears here. This is
// what call sites enumerating "what can be added/shown as a live option"
// (routine screens, monitoring columns) should use.
export async function getAvailableExercises(): Promise<ExerciseInfo[]> {
  const all = await getAllExercises();
  return all.filter((e) => e.enabled);
}

// Synchronous best-effort read of the FULL registry (enabled or not) for
// plain label-lookup helpers that can't await
// (utils/pipelineExercise.ts's exerciseLabel/resolveJobExerciseKey) — empty
// until the first getAllExercises()/getAvailableExercises() call resolves.
// Those helpers already fall back gracefully to the raw key string on a
// miss, the same as for any exercise key they don't recognize.
export function getCachedExercisesSync(): ExerciseInfo[] {
  return cachedList;
}

let cachedCategoriesPromise: Promise<ExerciseCategoryInfo[]> | null = null;
let cachedCategoriesList: ExerciseCategoryInfo[] = [];

async function fetchExerciseCategories(): Promise<ExerciseCategoryInfo[]> {
  const { data, error } = await supabase
    .from('exercise_categories')
    .select('key, label, sort_order, enabled')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  const list = (data ?? []).map((r) => ({
    key: r.key,
    label: r.label,
    sortOrder: r.sort_order,
    enabled: r.enabled,
  }));
  cachedCategoriesList = list;
  return list;
}

// Same fetch-once/memoized-on-success-only shape as getAllExercises() above.
export function getExerciseCategories(): Promise<ExerciseCategoryInfo[]> {
  if (!cachedCategoriesPromise) {
    cachedCategoriesPromise = fetchExerciseCategories().catch((e) => {
      cachedCategoriesPromise = null;
      throw e;
    });
  }
  return cachedCategoriesPromise;
}

// Same sync-best-effort shape as getCachedExercisesSync() above, for
// label-lookup helpers that can't await (pipelineExercise.ts's categoryLabel).
export function getCachedExerciseCategoriesSync(): ExerciseCategoryInfo[] {
  return cachedCategoriesList;
}
