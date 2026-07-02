import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatDelta } from '../utils/stats';
import { colors } from '../theme';

interface Props {
  delta: StatDelta;
  showRecent?: boolean; // also show the "vs previous window" figure
  recentLabel?: string; // e.g. '30d'
}

/**
 * Compact historical-comparison indicator: an arrow + magnitude coloured by
 * whether the change is an improvement (direction-aware). Renders nothing when
 * there's no prior data for the stat.
 */
export default function DeltaChip({ delta, showRecent = false, recentLabel = 'recent' }: Props) {
  const primary = delta.vsAvg != null ? delta.vsAvg : delta.vsRecent;
  if (primary == null) return null;

  const neutral = delta.good == null;
  const color = neutral ? colors.muted : delta.good ? colors.primary : colors.danger;
  const arrow = neutral ? (primary > 0 ? '▲' : primary < 0 ? '▼' : '■') : delta.good ? '▲' : '▼';
  const mag = Math.abs(primary);

  return (
    <View style={styles.wrap}>
      <View style={[styles.chip, { borderColor: color }]}>
        <Text style={[styles.txt, { color }]}>
          {arrow} {mag}%
        </Text>
      </View>
      {showRecent && delta.vsRecent != null && (
        <Text style={styles.recent}>
          {delta.vsRecent > 0 ? '+' : ''}{delta.vsRecent}% {recentLabel}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  txt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  recent: { color: colors.muted, fontSize: 9, fontWeight: '600' },
});
