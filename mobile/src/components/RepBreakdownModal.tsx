import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { JointCheck, JointRomCheck, RepWindow } from '../api/videoJobs';
import { useSettings } from '../state/SettingsContext';
import { colors, spacing } from '../theme';
import { formatDuration } from '../utils/format';
import MultiMetricTrend, { TrendSeries } from './charts/MultiMetricTrend';

// Same neutral blue AthleteMonitoringTable.tsx uses for its "injury" (non-
// ranked) mode — reused here for the rest-time series per the request that
// it read like "injured" blue, distinct from every metric's own accent color.
const REST_BLUE = '#3B82F6';

interface Props {
  visible: boolean;
  onClose: () => void;
  kind: 'balance' | 'rom';
  check: JointCheck | JointRomCheck;
  reps: RepWindow[]; // canonical per-rep timing, independent of `check`
}

export default function RepBreakdownModal({ visible, onClose, kind, check, reps }: Props) {
  const { accentColor } = useSettings();

  const series: TrendSeries[] = [];
  if (kind === 'balance') {
    const c = check as JointCheck;
    series.push(
      { key: 'l', label: 'Left', color: accentColor, points: c.reps.map((r) => ({ x: r.rep, y: r.l_value })) },
      { key: 'r', label: 'Right', color: accentColor, points: c.reps.map((r) => ({ x: r.rep, y: r.r_value })) },
      { key: 'score', label: 'Balance %', color: accentColor, points: c.reps.map((r) => ({ x: r.rep, y: r.balance_pct })) },
    );
  } else {
    const c = check as JointRomCheck;
    series.push(
      { key: 'l', label: 'Left', color: accentColor, points: c.reps.map((r) => ({ x: r.rep, y: r.l_deg })) },
      { key: 'r', label: 'Right', color: accentColor, points: c.reps.map((r) => ({ x: r.rep, y: r.r_deg })) },
      { key: 'score', label: 'ROM %', color: accentColor, points: c.reps.map((r) => ({ x: r.rep, y: r.rom_pct })) },
    );
  }

  // Rest between rep i and rep i+1 sits at the midpoint on the shared x-axis
  // — there's naturally one fewer rest gap than reps.
  const restPoints = reps.slice(0, -1).map((r, i) => {
    const next = reps[i + 1];
    return { x: r.rep + 0.5, y: Math.max(0, next.start_sec - r.end_sec) };
  });
  series.push({ key: 'rest', label: 'Rest (s)', color: REST_BLUE, points: restPoints });

  const repById = new Map(reps.map((r) => [r.rep, r]));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>{check.label}</Text>
          <Pressable hitSlop={10} onPress={onClose} style={({ pressed }) => pressed && styles.pressed}>
            <Text style={[styles.close, { color: accentColor }]}>×</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <MultiMetricTrend series={series} height={180} />
          </View>

          <Text style={styles.sectionKicker}>PER REP</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, styles.colRep]}>REP</Text>
              <Text style={[styles.th, styles.colVal]}>L</Text>
              <Text style={[styles.th, styles.colVal]}>R</Text>
              {kind === 'rom' && <Text style={[styles.th, styles.colVal]}>ACH°</Text>}
              <Text style={[styles.th, styles.colVal]}>{kind === 'balance' ? 'BAL%' : 'ROM%'}</Text>
              <Text style={[styles.th, styles.colTime]}>TIME</Text>
            </View>

            {reps.map((r, i) => {
              const c = check.reps.find((cr) => cr.rep === r.rep) as any;
              return (
                <React.Fragment key={r.rep}>
                  <View style={styles.tableRow}>
                    <Text style={[styles.td, styles.colRep]}>{r.rep + 1}</Text>
                    {c ? (
                      <>
                        <Text style={[styles.td, styles.colVal]}>{kind === 'balance' ? c.l_value : c.l_deg}</Text>
                        <Text style={[styles.td, styles.colVal]}>{kind === 'balance' ? c.r_value : c.r_deg}</Text>
                        {kind === 'rom' && <Text style={[styles.td, styles.colVal]}>{c.achieved_deg}</Text>}
                        <Text style={[styles.td, styles.colVal]}>{Math.round(kind === 'balance' ? c.balance_pct : c.rom_pct)}%</Text>
                      </>
                    ) : (
                      <>
                        <Text style={[styles.td, styles.colVal]}>—</Text>
                        <Text style={[styles.td, styles.colVal]}>—</Text>
                        {kind === 'rom' && <Text style={[styles.td, styles.colVal]}>—</Text>}
                        <Text style={[styles.td, styles.colVal]}>—</Text>
                      </>
                    )}
                    <Text style={[styles.td, styles.colTime]}>{formatDuration(r.duration_sec)}</Text>
                  </View>

                  {i < reps.length - 1 && (
                    <View style={styles.restRow}>
                      <Text style={styles.restText}>
                        REST — {formatDuration(Math.max(0, reps[i + 1].start_sec - r.end_sec))}
                      </Text>
                    </View>
                  )}
                </React.Fragment>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800', marginRight: spacing.md },
  close: { fontSize: 26, fontWeight: '300', lineHeight: 26 },
  pressed: { opacity: 0.5 },

  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  card: {
    backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },

  sectionKicker: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2.5 },
  table: {
    backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row', paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surfaceHigh,
  },
  th: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  tableRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  td: { color: colors.text, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  colRep: { width: 40 },
  colVal: { flex: 1, textAlign: 'center' },
  colTime: { width: 56, textAlign: 'right' },

  restRow: {
    paddingVertical: 6, paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(59,130,246,0.08)',
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  restText: { color: REST_BLUE, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
});
