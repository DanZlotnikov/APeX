import { Units } from '../state/SettingsContext';

export function formatHeight(cm: number | null, units: Units): string {
  if (cm == null) return '—';
  if (units === 'metric') return `${Math.round(cm)} cm`;
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inch = Math.round(totalIn - ft * 12);
  return `${ft}'${inch}"`;
}

export function formatWeight(kg: number | null, units: Units): string {
  if (kg == null) return '—';
  if (units === 'metric') return `${Math.round(kg)} kg`;
  return `${Math.round(kg * 2.2046)} lb`;
}

/** Convert a numeric input in the user's display units back to canonical metric. */
export function heightInputToCm(value: number, units: Units): number {
  return units === 'metric' ? value : value * 2.54; // imperial input taken as total inches
}

export function weightInputToKg(value: number, units: Units): number {
  return units === 'metric' ? value : value / 2.2046;
}
