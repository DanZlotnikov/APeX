/**
 * "Main sport" — see supabase/migrations/028_main_sport.sql. Every profile
 * has its own main_sport_key (self-editable for a manager or an individual
 * athlete, dormant for a team athlete — see effective_sport()'s inheritance
 * rule) and an optional manager-set sport_override_key (team athletes
 * only). This file wraps that: reading the effective (inherited/overridden)
 * value, an athlete/manager updating their own pick, and a manager setting
 * a per-athlete override — mirrors api/athletes.ts's markAthleteInjured
 * shape for the manager-action RPC.
 */
import { supabase } from './supabase';

// Cosmetic only — no dedicated padel-racket emoji exists in Unicode, so 🏓
// (table-tennis paddle) stands in, same visual family as 🎾 for tennis.
// Not DB-driven (same convention as SignUpScreen.tsx's existing RoleCard
// icons, which are hardcoded too) since it's pure decoration, not data any
// other part of the app needs to reason about.
export const SPORT_EMOJI: Record<string, string> = {
  general_fitness: '🏋️',
  padel: '🏓',
  tennis: '🎾',
};
export const DEFAULT_SPORT_EMOJI = '🏅';

export function sportEmoji(categoryKey: string): string {
  return SPORT_EMOJI[categoryKey] ?? DEFAULT_SPORT_EMOJI;
}

// Self-edit — RLS ("update own profile", 001_schema.sql) plus a DB trigger
// (028_main_sport.sql's enforce_sport_columns) both gate this: a team
// athlete's own update is rejected server-side, not just hidden in the UI,
// so this can safely be called by any caller that's already checked
// canEditMainSport-equivalent state client-side without it becoming a
// second source of truth for that permission.
export async function updateMainSport(sportKey: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');
  const { error } = await supabase.from('profiles').update({ main_sport_key: sportKey }).eq('id', user.id);
  if (error) throw error;
}

// Racket hand (profiles.handedness, migration 030). Unlike the main sport it's the athlete's own
// to set even on a team. null = never chosen (accounts from before it existed).
export type Handedness = 'left' | 'right';

export async function getHandedness(userId: string): Promise<Handedness | null> {
  const { data, error } = await supabase.from('profiles').select('handedness').eq('id', userId).single();
  if (error) throw error;
  return (data?.handedness as Handedness | null) ?? null;
}

export async function updateHandedness(hand: Handedness): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');
  const { error } = await supabase.from('profiles').update({ handedness: hand }).eq('id', user.id);
  if (error) throw error;
}

// Accounts for team inheritance / per-athlete override — the one place this
// resolution logic lives (mirrored server-side in effective_sport() for the
// Python pipeline, so both always agree).
export async function getEffectiveSport(athleteId: string): Promise<string> {
  const { data, error } = await supabase.rpc('effective_sport', { p_athlete_id: athleteId });
  if (error) throw error;
  return (data as string | null) ?? 'general_fitness';
}

// Manager sets (or clears, with sportKey=null) one athlete's sport override.
export async function setAthleteSportOverride(athleteId: string, sportKey: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_athlete_sport_override', {
    p_athlete_id: athleteId,
    p_sport_key: sportKey,
  });
  if (error) throw error;
}
