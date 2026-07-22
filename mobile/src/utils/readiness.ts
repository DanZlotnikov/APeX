import { colors } from '../theme';

// Single source of truth for readiness color bands — used by the athlete
// detail screen, the manager's athlete-monitoring table, and
// api/athletes.ts's pass/fail determination (AT_RISK_READINESS_FLOOR), so a
// given score always reads the same everywhere.
export const READY_READINESS_FLOOR = 80;
export const AT_RISK_READINESS_FLOOR = 65;

export function readinessColor(value: number | null): string {
  if (value == null) return colors.muted;
  if (value >= READY_READINESS_FLOOR) return '#00D4BC';
  if (value >= AT_RISK_READINESS_FLOOR) return '#F5A623';
  return '#FF3B30';
}
