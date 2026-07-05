// ── DB row types (mirror the PostgreSQL schema) ────────────────────────────────

export interface DbProfile {
  id: string;
  role: 'athlete' | 'manager';
  team_id: string;
  full_name: string;
  created_at: string;
}

export interface DbAthleteProfile {
  id: string;
  height_cm: number | null;
  weight_kg: number | null;
  position: string | null;
  date_of_birth: string | null;
}

export interface DbSession {
  id: string;
  athlete_id: string;
  exercise_type: 'squat' | 'deadlift' | 'jump' | 'pullup';
  recorded_at: string;
  rep_count: number;
  readiness_score: number | null;
  analysis_json: Record<string, unknown> | null;
  created_at: string;
}

export interface DbSessionMetric {
  id: string;
  session_id: string;
  metric_key: string;
  value: number;
}

export interface DbNotification {
  id: string;
  team_id: string;
  athlete_id: string | null;
  session_id: string | null;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  created_at: string;
}

export interface DbTeamSettings {
  team_id: string;
  readiness_threshold: number;
  max_lr_imbalance: number;
  required_tests_per_day: number;
  updated_at: string;
}

export interface DbRequiredTest {
  id: string;
  team_id: string;
  label: string;
  enabled: boolean;
  sort_order: number;
}

// ── View models (for UI consumption) ──────────────────────────────────────────

export type AthleteStatus = 'green' | 'yellow' | 'red';

export interface AthleteProfileData {
  position: string;
  heightCm: number;
  weightKg: number;
  age: number;
}

export interface NotificationViewModel {
  id: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  athleteId: string | null;
  timestamp: string;
}

export interface AthleteViewModel {
  id: string;
  name: string;
  status: AthleteStatus;
  readiness: number;
  lrImbalance: number;
  lastTestDate: string;
  lastTestTime: string | null;
  missingTests: number;
  profile: AthleteProfileData;
  readinessHistory: number[];  // last 30 days, oldest → newest
  totalSessions: number;
}

export interface TeamStatsViewModel {
  totalAthletes: number;
  ready: number;
  needsReview: number;
  missingTests: number;
  readinessAverage: number;
  readinessTrend: number;
  compliancePct: number;
  completedTests: number;
  expectedTests: number;
}

export interface TeamSettingsViewModel {
  teamId: string;
  teamName: string;
  readinessThreshold: number;
  maxLRImbalance: number;
  requiredTestsPerDay: number;
  requiredTests: Array<{ id: string; label: string; enabled: boolean }>;
}
