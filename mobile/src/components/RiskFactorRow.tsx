import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './ui/Text';
import { RiskFactor } from '../utils/exerciseAnalyzer';
import { StatDelta } from '../utils/stats';
import DeltaChip from './DeltaChip';
import { colors, riskColor, spacing } from '../theme';

interface Props {
  factor: RiskFactor;
  delta?: StatDelta;
}

/**
 * One color-coded risk factor: label + headline percentage + status pill, a thin
 * quality bar (fill = score, colored by status), and a plain-language detail line.
 */
export default function RiskFactorRow({ factor, delta }: Props) {
  const color = riskColor(factor.status);
  const pill = factor.status === 'green' ? 'GOOD' : factor.status === 'yellow' ? 'WATCH' : 'LOW';

  return (
    <View style={styles.row}>
      <View style={styles.top}>
        <Text style={styles.label} numberOfLines={1}>{factor.label}</Text>
        <Text style={[styles.value, { color }]}>
          {factor.value}
          <Text style={styles.unit}>{factor.unit}</Text>
        </Text>
        <View style={[styles.pill, { borderColor: color }]}>
          <Text style={[styles.pillText, { color }]}>{pill}</Text>
        </View>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${factor.score}%`, backgroundColor: color }]} />
      </View>

      <View style={styles.bottom}>
        <Text style={styles.detail}>{factor.detail}</Text>
        {delta && <DeltaChip delta={delta} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginTop: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center' },
  label: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600' },
  value: { fontSize: 20, fontWeight: '900', marginRight: spacing.sm },
  unit: { fontSize: 12, fontWeight: '700' },
  pill: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pillText: { fontSize: 9, fontWeight: '800', letterSpacing: 1 },

  track: {
    height: 4,
    backgroundColor: colors.surfaceHigh,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  fill: { height: 4, borderRadius: 2 },

  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs, gap: spacing.sm },
  detail: { flex: 1, color: colors.muted, fontSize: 11, lineHeight: 15 },
});
