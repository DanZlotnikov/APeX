export const colors = {
  bg: '#07101C',
  surface: '#0E1E2F',
  surfaceHigh: '#152336',
  primary: '#00D4BC',
  primaryText: '#001A18',
  text: '#F0F6FF',
  muted: '#6B7F96',
  danger: '#FF3B30',
  warning: '#F5A623',
  border: '#1C2E40',
};

// Maps a readiness/risk status to its display color.
export function riskColor(status: 'green' | 'yellow' | 'red'): string {
  return status === 'green' ? colors.primary : status === 'yellow' ? colors.warning : colors.danger;
}

// ── user-selectable accent themes ─────────────────────────────────────────────
// The dashboard and primary accent touchpoints (buttons, wordmark) recolor to
// the chosen accent; the structural dark palette above stays fixed.
export type AccentKey = 'teal' | 'blue' | 'violet' | 'amber' | 'rose';

export const ACCENTS: Record<AccentKey, { color: string; on: string; label: string }> = {
  teal:   { color: '#00D4BC', on: '#001A18', label: 'Teal' },
  blue:   { color: '#3B9EFF', on: '#031424', label: 'Blue' },
  violet: { color: '#B794F6', on: '#160B2E', label: 'Violet' },
  amber:  { color: '#F5A623', on: '#1E1400', label: 'Amber' },
  rose:   { color: '#FF6B8B', on: '#2A0710', label: 'Rose' },
};

export type FontScaleKey = 'S' | 'M' | 'L';
export const FONT_SCALES: Record<FontScaleKey, number> = { S: 0.9, M: 1, L: 1.15 };

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
  xxl: 64,
};
