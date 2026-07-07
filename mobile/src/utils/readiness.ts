import { colors } from '../theme';

// Single source of truth for readiness color bands — used by both the
// athlete detail screen and the manager's athlete-monitoring table so a given
// score always reads the same color everywhere.
export function readinessColor(value: number | null): string {
  if (value == null) return colors.muted;
  if (value >= 80) return '#00D4BC';
  if (value >= 65) return '#F5A623';
  return '#FF3B30';
}
