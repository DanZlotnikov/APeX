import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getTeamAthletes } from '../../api/athletes';
import { supabase } from '../../api/supabase';
import { AthleteViewModel, TeamStatsViewModel } from '../../api/types';
import { colors, spacing } from '../../theme';
import AthleteMonitoringTable from './components/AthleteMonitoringTable';
import ComplianceCard from './components/ComplianceCard';
import TeamReadinessCard from './components/TeamReadinessCard';
import TeamSummaryCards from './components/TeamSummaryCards';

interface Props {
  teamId: string;
  onAthleteSelect: (athlete: AthleteViewModel) => void;
}

function computeTeamStats(athletes: AthleteViewModel[]): TeamStatsViewModel {
  const total       = athletes.length;
  const ready       = athletes.filter((a) => a.status === 'green').length;
  const needsReview = athletes.filter((a) => a.status !== 'green').length;
  const missing     = athletes.filter((a) => a.missingTests > 0).length;
  const avgReadiness = total > 0
    ? Math.round(athletes.reduce((s, a) => s + a.readiness, 0) / total)
    : 0;
  const completedToday = athletes.filter((a) => a.missingTests === 0 && a.lastTestDate !== 'Never').length;
  const compliancePct  = total > 0 ? Math.round((completedToday / total) * 100) : 0;

  return {
    totalAthletes:   total,
    ready,
    needsReview,
    missingTests:    missing,
    readinessAverage: avgReadiness,
    readinessTrend:  0,
    compliancePct,
    completedTests:  completedToday,
    expectedTests:   total,
  };
}

export default function ManagerDashboard({ teamId, onAthleteSelect }: Props) {
  const [athletes, setAthletes] = useState<AthleteViewModel[]>([]);
  const [loading,  setLoading]  = useState(true);
  const teamRef = useRef(teamId);

  const loadAthletes = useCallback(async () => {
    try {
      const data = await getTeamAthletes(teamRef.current);
      setAthletes(data);
    } catch (e) {
      console.warn('Failed to load athletes', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAthletes();

    // Realtime: refresh when any session is inserted for this team
    // NOTE: Supabase → Database → Replication must have 'sessions' enabled
    const channel = supabase
      .channel(`sessions:${teamId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sessions' },
        () => { void loadAthletes(); },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [loadAthletes, teamId]);

  const stats = computeTeamStats(athletes);

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
          <AthleteMonitoringTable athletes={athletes} onSelectAthlete={onAthleteSelect} />
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
