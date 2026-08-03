import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TeamStatsViewModel as TeamStats } from '../../../api/types';
import { colors, spacing } from '../../../theme';

interface Props {
  stats: TeamStats;
}

export default function ComplianceCard({ stats }: Props) {
  const { compliancePct, completedTests, expectedTests } = stats;
  const barWidth = `${compliancePct}%`;
  const barColor = compliancePct >= 80 ? '#00D4BC' : compliancePct >= 60 ? '#F5A623' : '#FF3B30';

  return (
    <View style={styles.card}>
      <Text style={styles.title}>COMPLIANCE</Text>

      <View style={styles.row}>
        <Text style={[styles.pct, { color: barColor }]}>{compliancePct}%</Text>
        <Text style={styles.sub}>exercises completed today</Text>
      </View>

      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: barWidth as any, backgroundColor: barColor }]} />
      </View>

      <Text style={styles.detail}>
        {completedTests} / {expectedTests} required exercises
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  title: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: spacing.sm,
  },
  pct: {
    fontSize: 36,
    fontWeight: '900',
    lineHeight: 40,
  },
  sub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 5,
    flex: 1,
    flexShrink: 1,
  },
  barTrack: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  detail: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
});
