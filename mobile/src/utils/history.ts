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

export const EMPTY_PROFILE: Profile = { name: '', heightCm: null, weightKg: null };

// History and profile are stored per-user (userId = the Supabase auth user
// id) — a shared device-global filename would leak one account's session
// history/profile into whichever account is signed in next on the same
// device, which is exactly the bug this scoping fixes. `settings.json`
// (theme/units/sound — device UI prefs, not personal data) intentionally
// stays global; see SettingsContext.tsx.
function historyFile(userId: string): string { return `history_${userId}.json`; }
function profileFile(userId: string): string { return `profile_${userId}.json`; }

// ── IO ────────────────────────────────────────────────────────────────────────

export async function loadHistory(userId: string): Promise<HistoryEntry[]> {
  const list = await readJSON<HistoryEntry[]>(historyFile(userId), []);
  // stored chronologically; ensure ascending by date
  return list.slice().sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

// Same-day replace: an athlete can redo an exercise as many times as they
// like, but only the latest attempt for a given exercise on a given day is
// kept locally too (mirrors the DB-side replace in api/sessions.ts
// createSession). "Today" is the UTC calendar day, matching dateISO's own
// format (new Date().toISOString()) and the rest of the app's "today" checks.
export async function saveTodayEntry(
  entry: HistoryEntry,
  exerciseKey: 'squat' | 'jump' | 'pullup',
  userId: string,
): Promise<void> {
  const list = await loadHistory(userId);
  const todayUtc = entry.dateISO.slice(0, 10);
  const filtered = list.filter((e) => {
    const sameDay = e.dateISO.slice(0, 10) === todayUtc;
    const sameExercise = e.assessment.perExercise.some((x) => x.key === exerciseKey);
    return !(sameDay && sameExercise);
  });
  filtered.push(entry);
  await writeJSON(historyFile(userId), filtered);
}

// Bulk overwrite — used on fresh sign-in/sign-up to make the local cache
// match the DB truth (see api/sync.ts). Not for normal saves (saveTodayEntry
// above handles those); this replaces the whole file wholesale.
export async function replaceHistory(entries: HistoryEntry[], userId: string): Promise<void> {
  await writeJSON(historyFile(userId), entries);
}

export async function deleteEntry(id: string, userId: string): Promise<void> {
  const list = await loadHistory(userId);
  const found = list.find((e) => e.id === id);
  if (found) await deleteVideo(found.videoFile);
  await writeJSON(historyFile(userId), list.filter((e) => e.id !== id));
}

export async function loadProfile(userId: string): Promise<Profile> {
  return readJSON<Profile>(profileFile(userId), EMPTY_PROFILE);
}

export async function saveProfile(p: Profile, userId: string): Promise<void> {
  await writeJSON(profileFile(userId), p);
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
