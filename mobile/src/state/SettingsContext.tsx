/**
 * App-wide settings: accent theme, font-size scale, sound, units, and the
 * historical-comparison window. Loaded once from storage on mount and persisted
 * on every change. Also carries the athlete Profile so the dashboard and
 * overview can read/update it in one place.
 *
 * Scope (per plan): consumed by the dashboard and primary accent touchpoints
 * (PrimaryButton, Home wordmark). Other screens keep the static theme for now.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../api/supabase';
import { AccentKey, ACCENTS, FONT_SCALES, FontScaleKey } from '../theme';
import { EMPTY_PROFILE, loadProfile, Profile, saveProfile } from '../utils/history';
import { readJSON, writeJSON } from '../utils/storage';

export type Units = 'metric' | 'imperial';

export interface Settings {
  accent: AccentKey;
  fontScale: FontScaleKey;
  sound: boolean;
  units: Units;
  windowDays: number; // comparison / trend window
}

const DEFAULTS: Settings = {
  accent: 'teal',
  fontScale: 'M',
  sound: false,
  units: 'metric',
  windowDays: 30,
};

const SETTINGS_FILE = 'settings.json';

interface Ctx {
  ready: boolean;
  settings: Settings;
  profile: Profile;
  accentColor: string;
  accentOn: string;
  fontScale: number;
  update: (patch: Partial<Settings>) => void;
  updateProfile: (patch: Partial<Profile>) => void;
  refreshProfile: () => Promise<void>;
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  // Profile is stored per-user (see utils/history.ts) — this tracks whoever's
  // currently signed in so updateProfile saves under the right file. A ref,
  // not state: it only needs to be read inside callbacks, never rendered.
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadProfileFor(userId: string | null) {
      const p = userId ? await loadProfile(userId) : EMPTY_PROFILE;
      if (active) setProfile(p);
    }

    (async () => {
      const [s, { data }] = await Promise.all([
        readJSON<Settings>(SETTINGS_FILE, DEFAULTS),
        supabase.auth.getSession(),
      ]);
      if (!active) return;
      setSettings({ ...DEFAULTS, ...s });
      userIdRef.current = data.session?.user.id ?? null;
      await loadProfileFor(userIdRef.current);
      if (active) setReady(true);
    })();

    // Re-scope the profile whenever the signed-in user changes (login,
    // logout, or switching accounts on the same device) — without this, a
    // newly signed-in user would keep seeing whoever was signed in before.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user.id ?? null;
      if (uid === userIdRef.current) return;
      userIdRef.current = uid;
      void loadProfileFor(uid);
    });

    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void writeJSON(SETTINGS_FILE, next);
      return next;
    });
  }, []);

  const updateProfile = useCallback((patch: Partial<Profile>) => {
    const userId = userIdRef.current;
    if (!userId) return; // not signed in — nothing to scope the save to
    setProfile((prev) => {
      const next = { ...prev, ...patch };
      void saveProfile(next, userId);
      return next;
    });
  }, []);

  // Re-reads the current user's local profile file. Needed after
  // api/sync.ts's syncLocalDataFromServer overwrites it on a fresh
  // login/signup — that write happens outside this context, so without an
  // explicit refresh the in-memory `profile` here would keep showing
  // whatever was loaded before the sync (stale, possibly empty).
  const refreshProfile = useCallback(async () => {
    const userId = userIdRef.current;
    setProfile(userId ? await loadProfile(userId) : EMPTY_PROFILE);
  }, []);

  const value = useMemo<Ctx>(() => {
    const accent = ACCENTS[settings.accent] ?? ACCENTS.teal;
    return {
      ready,
      settings,
      profile,
      accentColor: accent.color,
      accentOn: accent.on,
      fontScale: FONT_SCALES[settings.fontScale] ?? 1,
      update,
      updateProfile,
      refreshProfile,
    };
  }, [ready, settings, profile, update, updateProfile, refreshProfile]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}

/** Convenience: just the accent color (falls back to teal outside a provider). */
export function useAccent(): string {
  const ctx = useContext(SettingsContext);
  return ctx?.accentColor ?? ACCENTS.teal.color;
}
