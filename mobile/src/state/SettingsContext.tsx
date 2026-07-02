/**
 * App-wide settings: accent theme, font-size scale, sound, units, and the
 * historical-comparison window. Loaded once from storage on mount and persisted
 * on every change. Also carries the athlete Profile so the dashboard and
 * overview can read/update it in one place.
 *
 * Scope (per plan): consumed by the dashboard and primary accent touchpoints
 * (PrimaryButton, Home wordmark). Other screens keep the static theme for now.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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
  sound: true,
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
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);

  useEffect(() => {
    (async () => {
      const [s, p] = await Promise.all([
        readJSON<Settings>(SETTINGS_FILE, DEFAULTS),
        loadProfile(),
      ]);
      setSettings({ ...DEFAULTS, ...s });
      setProfile(p);
      setReady(true);
    })();
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void writeJSON(SETTINGS_FILE, next);
      return next;
    });
  }, []);

  const updateProfile = useCallback((patch: Partial<Profile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...patch };
      void saveProfile(next);
      return next;
    });
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
    };
  }, [ready, settings, profile, update, updateProfile]);

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
