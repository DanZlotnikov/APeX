import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../../components/ui/Text';
import { TeamStatsViewModel as TeamStats } from '../../../api/types';
import { colors, spacing } from '../../../theme';

interface Props {
  stats: TeamStats;
}

export default function TeamSummaryCards({ stats }: Props) {
  return (
    <View style={styles.row}>
      <SummaryCard label="TOTAL" value={stats.totalAthletes} valueColor={colors.text} />
      <SummaryCard label="READY" value={stats.ready} valueColor="#00D4BC" />
      <SummaryCard label="INJURED" value={stats.injuredCount} valueColor="#3B82F6" />
      <SummaryCard label="MISSING" value={stats.missingTests} valueColor="#FF3B30" />
    </View>
  );
}

function SummaryCard({ label, value, valueColor }: { label: string; value: number; valueColor: string }) {
  return (
    <View style={styles.card}>
      <Text style={[styles.value, { color: valueColor }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  value: {
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 32,
  },
  label: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 3,
  },
});
