import { Assessment } from '../utils/exerciseAnalyzer';
import { HistoryEntry, Profile, replaceHistory, saveProfile } from '../utils/history';
import { supabase } from './supabase';

// Local storage (history_<uid>.json / profile_<uid>.json — see utils/history.ts)
// is device-scoped: a fresh sign-in on a new/reinstalled device, or right
// after signup, has no local cache yet even though the athlete may already
// have real history in the DB (every save syncs to `sessions`, which stores
// the full Assessment in analysis_json specifically "for audit/replay").
// Call this once on a genuine login/signup action (not on session-restore —
// that's an already-logged-in device, where local storage is already
// correct and faster to just use) to overwrite the local cache with the DB
// truth. Best-effort: never throws, so a sync failure (offline, etc.) never
// blocks sign-in — the app just falls back to whatever's locally cached.
export async function syncLocalDataFromServer(userId: string): Promise<void> {
  try {
    const [sessionsRes, athleteProfileRes, profileRes] = await Promise.all([
      supabase
        .from('sessions')
        .select('id, recorded_at, analysis_json')
        .eq('athlete_id', userId)
        .order('recorded_at', { ascending: true }),
      supabase
        .from('athlete_profiles')
        .select('height_cm, weight_kg')
        .eq('id', userId)
        .single(),
      supabase
        .from('profiles')
        .select('full_name')
        .eq('id', userId)
        .single(),
    ]);

    const entries: HistoryEntry[] = (sessionsRes.data ?? [])
      .filter((s) => s.analysis_json)
      .map((s) => ({
        id: s.id,
        dateISO: s.recorded_at,
        videoFile: null,
        assessment: s.analysis_json as unknown as Assessment,
      }));
    await replaceHistory(entries, userId);

    const profile: Profile = {
      name: profileRes.data?.full_name ?? '',
      heightCm: athleteProfileRes.data?.height_cm ?? null,
      weightKg: athleteProfileRes.data?.weight_kg ?? null,
    };
    await saveProfile(profile, userId);
  } catch (e) {
    console.warn('[APeX] Failed to sync local data from server on login:', e);
  }
}
