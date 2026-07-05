import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TeamStatsViewModel as TeamStats } from '../../../api/types';
import { colors, spacing } from '../../../theme';

interface Props {
  stats: TeamStats;
}

export default function TeamReadinessCard({ stats }: Props) {
  const { readinessAverage, readinessTrend } = stats;
  const trendPositive = readinessTrend >= 0;
  const trendColor = trendPositive ? '#00D4BC' : '#FF3B30';
  const trendLabel = `${trendPositive ? '+' : ''}${readinessTrend}%`;

  const barWidth = `${readinessAverage}%`;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>TEAM READINESS</Text>
        <View style={[styles.trendBadge, { backgroundColor: trendPositive ? 'rgba(0,212,188,0.1)' : 'rgba(255,59,48,0.1)', borderColor: trendColor }]}>
          <Text style={[styles.trendText, { color: trendColor }]}>{trendLabel} vs last week</Text>
        </View>
      </View>

      <View style={styles.row}>
        <Text style={styles.avg}>{readinessAverage}</Text>
        <Text style={styles.pct}>%</Text>
        <Text style={styles.avgLabel}>avg</Text>
      </View>

      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: barWidth as any }]} />
      </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
  },
  trendBadge: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  trendText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    marginBottom: spacing.sm,
  },
  avg: {
    color: colors.text,
    fontSize: 44,
    fontWeight: '900',
    lineHeight: 48,
  },
  pct: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  avgLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 4,
  },
  barTrack: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#00D4BC',
    borderRadius: 3,
  },
});
