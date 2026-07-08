/**
 * Session history + athlete profile persistence and aggregation.
 *
 * Every analysis is saved as a HistoryEntry (the full Assessment plus a copied
 * video). These functions load/save/delete entries and derive the time-series
 * and averages the dashboard and the historical-comparison engine consume.
 */
import { Assessment } from './exerciseAnalyzer';
import { deleteVideo, readJSON, writeJSON } from './storage';

export interface HistoryEntry {
  id: string;
  dateISO: string;
  videoFile: string | null; // storage token (see storage.resolveVideo)
  assessment: Assessment;
}

export interface Profile {
  name: string;
  heightCm: number | null; // canonical metric; UI converts for display
  weightKg: number | null;
}

const HISTORY_FILE = 'history.json';
const PROFILE_FILE = 'profile.json';

export const EMPTY_PROFILE: Profile = { name: '', heightCm: null, weightKg: null };

// ── IO ────────────────────────────────────────────────────────────────────────

export async function loadHistory(): Promise<HistoryEntry[]> {
  const list = await readJSON<HistoryEntry[]>(HISTORY_FILE, []);
  // stored chronologically; ensure ascending by date
  return list.slice().sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

// Same-day replace: an athlete can redo an exercise as many times as they
// like, but only the latest attempt for a given exercise on a given day is
// kept locally too (mirrors the DB-side replace in api/sessions.ts
// createSession). "Today" is the UTC calendar day, matching dateISO's own
// format (new Date().toISOString()) and the rest of the app's "today" checks.
export async function saveTodayEntry(entry: HistoryEntry, exerciseKey: 'squat' | 'jump' | 'pullup'): Promise<void> {
  const list = await loadHistory();
  const todayUtc = entry.dateISO.slice(0, 10);
  const filtered = list.filter((e) => {
    const sameDay = e.dateISO.slice(0, 10) === todayUtc;
    const sameExercise = e.assessment.perExercise.some((x) => x.key === exerciseKey);
    return !(sameDay && sameExercise);
  });
  filtered.push(entry);
  await writeJSON(HISTORY_FILE, filtered);
}

export async function deleteEntry(id: string): Promise<void> {
  const list = await loadHistory();
  const found = list.find((e) => e.id === id);
  if (found) await deleteVideo(found.videoFile);
  await writeJSON(HISTORY_FILE, list.filter((e) => e.id !== id));
}

export async function loadProfile(): Promise<Profile> {
  return readJSON<Profile>(PROFILE_FILE, EMPTY_PROFILE);
}

export async function saveProfile(p: Profile): Promise<void> {
  await writeJSON(PROFILE_FILE, p);
}

export function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── aggregation ─────────────────────────────────────────────────────────────

export interface Point {
  dateISO: string;
  value: number;
}

export type ExerciseKey = 'squat' | 'jump' | 'pullup';
export type MetricKey = 'minKneeAngle' | 'romDeg' | 'avgRepSec' | 'reps';

/** A per-exercise metric over time (only sessions that contain that exercise). */
export function exerciseSeries(
  history: HistoryEntry[],
  key: ExerciseKey,
  metric: MetricKey,
): Point[] {
  const out: Point[] = [];
  for (const e of history) {
    const ex = e.assessment.perExercise.find((x) => x.key === key);
    if (!ex) continue;
    const value = metric === 'reps' ? ex.reps : ex.metrics[metric];
    out.push({ dateISO: e.dateISO, value });
  }
  return out;
}

/** Which exercises appear anywhere in history. */
export function exercisesInHistory(history: HistoryEntry[]): ExerciseKey[] {
  const set = new Set<ExerciseKey>();
  history.forEach((e) => e.assessment.perExercise.forEach((x) => set.add(x.key)));
  return Array.from(set);
}

export function entriesWithinDays(history: HistoryEntry[], days: number): HistoryEntry[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return history.filter((e) => new Date(e.dateISO).getTime() >= cutoff);
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
