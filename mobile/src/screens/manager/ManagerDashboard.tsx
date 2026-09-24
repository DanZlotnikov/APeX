import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../components/ui/Text';
import { getTeamAthletes } from '../../api/athletes';
import { supabase } from '../../api/supabase';
import { AthleteViewModel, TeamStatsViewModel } from '../../api/types';
import { useSettings } from '../../state/SettingsContext';
import { colors, spacing } from '../../theme';
import { exerciseLabel, getPipelineExerciseKeys } from '../../utils/pipelineExercise';
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
  const { accentColor } = useSettings();
  const [athletes,        setAthletes]        = useState<AthleteViewModel[]>([]);
  const [exerciseColumns, setExerciseColumns] = useState<ExerciseColumn[]>([]);
  const [loading,         setLoading]         = useState(true);
  const teamRef = useRef(teamId);

  const loadAthletes = useCallback(async () => {
    try {
      const data = await getTeamAthletes(teamRef.current);
      setAthletes(data);
      // Columns are the union of whatever's active across the roster, in
      // canonical order — each athlete now has their own individual routine
      // (migration 021), so there's no single team-wide list to read this
      // from anymore. A given athlete's cell just reads "—" for a column
      // that isn't in their own routine (see AthleteMonitoringTable's
      // exerciseValue).
      const active = new Set<string>();
      for (const a of data) {
        for (const e of a.perExerciseReadiness) active.add(e.key);
      }
      const keys = await getPipelineExerciseKeys();
      setExerciseColumns(
        keys.filter((k) => active.has(k)).map((k) => ({ key: k, label: exerciseLabel(k) })),
      );
    } catch (e) {
      console.warn('Failed to load athletes', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAthletes();

    // Realtime: refresh on new sessions, and on any change to an athlete's
    // individual routine (added/removed/reps changed on their own Routine
    // tab in AthleteDetailPreview) — so that's reflected here immediately,
    // not just on next mount/session.
    // NOTE: Supabase → Database → Replication must have these tables enabled.
    //
    // Topic includes the manager's own user id, not just teamId:
    // supabase.channel(topic) reuses an existing channel object for a
    // matching topic string rather than creating a new one (confirmed the
    // hard way elsewhere in this app — see videoJobs.ts/VideoJobsContext.tsx)
    // — a team-only topic would collide across every manager viewing the same
    // team simultaneously, or across a fast unmount/remount of this same
    // component racing removeChannel's async teardown. Fetched here (rather
    // than threaded in as a prop) to keep this a self-contained fix.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const uid = data.user?.id ?? 'anon';
      channel = supabase
        .channel(`sessions:${teamId}:${uid}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'sessions' },
          () => { void loadAthletes(); },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'athlete_routines' },
          () => { void loadAthletes(); },
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [loadAthletes, teamId]);

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
        <ActivityIndicator color={accentColor} size="large" />
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
