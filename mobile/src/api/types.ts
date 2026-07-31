import { PipelineExerciseKey } from '../utils/pipelineExercise';

// ── DB row types (mirror the PostgreSQL schema) ────────────────────────────────

export interface DbProfile {
  id: string;
  role: 'athlete' | 'manager';
  team_id: string | null; // null = individual athlete, no manager/team
  full_name: string;
  injured: boolean;
  injury_started_at: string | null;
  stats_reset_at: string | null;
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
  exercise_type: PipelineExerciseKey;
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

export interface ExerciseReadiness {
  key: PipelineExerciseKey;
  label: string;
  readiness: number | null; // most recent session's readiness_score for this exercise (any day)
  testedToday: boolean;     // whether at least one session for this exercise was recorded today
  passed: boolean | null;   // null = never tested; else today's summed reps meet target AND readiness isn't in the "at risk" band (or, if not tested today, the most recent reading isn't)
}

export interface AthleteViewModel {
  id: string;
  name: string;
  status: AthleteStatus;
  readiness: number; // average of perExerciseReadiness (exercises with data only)
  perExerciseReadiness: ExerciseReadiness[];
  lastTestDate: string;
  lastTestTime: string | null;
  missingTests: number;
  profile: AthleteProfileData;
  readinessHistory: number[];  // last 30 days, oldest → newest
  totalSessions: number;
  injured: boolean;
  injuryStartedAt: string | null;
  statsResetAt: string | null; // cutoff for readiness trend / per-exercise readiness / compliance
}

export interface TeamStatsViewModel {
  totalAthletes: number;
  ready: number;
  injuredCount: number;
  missingTests: number;
  readinessAverage: number;
  readinessTrend: number;
  compliancePct: number;
  completedTests: number;
  expectedTests: number;
}

