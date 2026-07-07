import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getTeamAthletes } from '../../api/athletes';
import { getTeamExercises } from '../../api/exercises';
import { supabase } from '../../api/supabase';
import { AthleteViewModel, TeamStatsViewModel } from '../../api/types';
import { colors, spacing } from '../../theme';
import { EXERCISE_LABELS } from '../../utils/exerciseMetrics';
import AthleteMonitoringTable, { ExerciseColumn } from './components/AthleteMonitoringTable';
import ComplianceCard from './components/ComplianceCard';
import TeamReadinessCard from './components/TeamReadinessCard';
import TeamSummaryCards from './components/TeamSummaryCards';

interface Props {
  teamId: string;
  onAthleteSelect: (athlete: AthleteViewModel) => void;
}

function computeTeamStats(athletes: AthleteViewModel[], injuredCount: number): TeamStatsViewModel {
  const total       = athletes.length;
  const ready       = athletes.filter((a) => a.status === 'green').length;
  const missing     = athletes.filter((a) => a.missingTests > 0).length;
  const avgReadiness = total > 0
    ? Math.round(athletes.reduce((s, a) => s + a.readiness, 0) / total)
    : 0;
  // Compliance = individual tests completed today / individual tests required today,
  // summed across every athlete's assigned exercises (not athlete headcount).
  const expectedTests = athletes.reduce((s, a) => s + a.perExerciseReadiness.length, 0);
  const completedTests = athletes.reduce(
    (s, a) => s + (a.perExerciseReadiness.length - a.missingTests),
    0,
  );
  const compliancePct = expectedTests > 0 ? Math.round((completedTests / expectedTests) * 100) : 0;

  return {
    totalAthletes:   total,
    ready,
    injuredCount,
    missingTests:    missing,
    readinessAverage: avgReadiness,
    readinessTrend:  0,
    compliancePct,
    completedTests,
    expectedTests,
  };
}

export default function ManagerDashboard({ teamId, onAthleteSelect }: Props) {
  const [athletes,        setAthletes]        = useState<AthleteViewModel[]>([]);
  const [exerciseColumns, setExerciseColumns] = useState<ExerciseColumn[]>([]);
  const [loading,         setLoading]         = useState(true);
  const teamRef = useRef(teamId);

  const loadAthletes = useCallback(async () => {
    try {
      const [data, configs] = await Promise.all([
        getTeamAthletes(teamRef.current),
        getTeamExercises(teamRef.current),
      ]);
      setAthletes(data);
      setExerciseColumns(
        configs.filter((c) => c.enabled).map((c) => ({ key: c.exerciseKey, label: EXERCISE_LABELS[c.exerciseKey] })),
      );
    } catch (e) {
      console.warn('Failed to load athletes', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAthletes();

    // Realtime: refresh on new sessions, and on any change to what's required
    // per athlete (team-wide toggle in ExercisesScreen, or a per-athlete
    // assignment override) — so a manager ticking an exercise on/off there
    // is reflected here immediately, not just on next mount/session.
    // NOTE: Supabase → Database → Replication must have these tables enabled.
    const channel = supabase
      .channel(`sessions:${teamId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sessions' },
        () => { void loadAthletes(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'athlete_exercise_assignments' },
        () => { void loadAthletes(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'team_exercises' },
        () => { void loadAthletes(); },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [loadAthletes, teamId]);

  // Switching tabs (e.g. Exercises → Athletes) doesn't unmount this screen,
  // so it won't pick up an assignment/config change made on the Exercises
  // tab on its own — refetch on every focus so it can't go stale just by
  // tabbing away and back. This is the dependable path; the realtime
  // subscription above is best-effort on top of it (requires Replication to
  // be enabled for those tables in the Supabase dashboard).
  useFocusEffect(useCallback(() => { void loadAthletes(); }, [loadAthletes]));

  // Injured athletes get their own inspection-only table below (see
  // AthleteMonitoringTable's colorMode='neutral') and drop out of team-wide
  // ranking/compliance stats — they're on a separate recovery track, not
  // being compared against the rest of the roster.
  const healthyAthletes = athletes.filter((a) => !a.injured);
  const injuredAthletes = athletes.filter((a) => a.injured);
  const stats = computeTeamStats(healthyAthletes, injuredAthletes.length);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <TeamSummaryCards stats={stats} />

        <TeamReadinessCard stats={stats} />
        <ComplianceCard stats={stats} />

        {athletes.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No athletes on this team yet.</Text>
          </View>
        ) : (
          <AthleteMonitoringTable
            athletes={healthyAthletes}
            exerciseColumns={exerciseColumns}
            onSelectAthlete={onAthleteSelect}
          />
        )}

        {injuredAthletes.length > 0 && (
          <AthleteMonitoringTable
            athletes={injuredAthletes}
            exerciseColumns={exerciseColumns}
            onSelectAthlete={onAthleteSelect}
            title="INJURY MONITORING"
            colorMode="neutral"
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bg },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 120 },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: { color: colors.muted, fontSize: 13, fontWeight: '500' },
});
