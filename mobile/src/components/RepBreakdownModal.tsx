import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { JointCheck, JointFixationCheck, JointRomCheck, RepWindow } from '../api/videoJobs';
import { useSettings } from '../state/SettingsContext';
import { ACCENTS, AccentKey, colors, spacing } from '../theme';
import { formatDurationPrecise } from '../utils/format';
import MultiMetricTrend, { TrendSeries } from './charts/MultiMetricTrend';

// Same neutral blue AthleteMonitoringTable.tsx uses for its "injury" (non-
// ranked) mode — reused here for the rest-time series per the request that
// it read like "injured" blue, distinct from every metric's own accent color.
const REST_BLUE = '#3B82F6';

// L and R need their own fixed, mutually-distinct colors — separate from the
// overall/score line (user's accent) AND from REST_BLUE above. 'blue' is
// deliberately excluded from this pool: ACCENTS.blue (#3B9EFF) reads as
// near-identical to REST_BLUE (#3B82F6) on a small chart, so picking it for
// L or R would make that series indistinguishable from the rest-time line.
const PALETTE_ORDER: AccentKey[] = ['teal', 'violet', 'amber', 'rose'];

const { width: SCREEN_W } = Dimensions.get('window');

interface Props {
  visible: boolean;
  onClose: () => void;
  kind: 'balance' | 'rom' | 'fixation';
  check: JointCheck | JointRomCheck | JointFixationCheck;
  reps: RepWindow[]; // canonical per-rep timing, independent of `check`
}

export default function RepBreakdownModal({ visible, onClose, kind, check, reps }: Props) {
  const { accentColor } = useSettings();
  const insets = useSafeAreaInsets();

  const otherColors = PALETTE_ORDER.map((k) => ACCENTS[k].color).filter((c) => c !== accentColor);
  const lColor = otherColors[0];
  const rColor = otherColors[1];

  const series: TrendSeries[] = [];
  if (kind === 'balance') {
    const c = check as JointCheck;
    series.push(
      { key: 'l', label: 'Left', color: lColor, dashed: true, points: c.reps.map((r) => ({ x: r.rep, y: r.l_value })) },
      { key: 'r', label: 'Right', color: rColor, dashed: true, points: c.reps.map((r) => ({ x: r.rep, y: r.r_value })) },
      { key: 'score', label: 'Balance %', color: accentColor, points: c.reps.map((r) => ({ x: r.rep, y: r.balance_pct })) },
    );
  } else if (kind === 'rom') {
    const c = check as JointRomCheck;
    series.push(
      { key: 'l', label: 'Left', color: lColor, dashed: true, points: c.reps.map((r) => ({ x: r.rep, y: r.l_deg })) },
      { key: 'r', label: 'Right', color: rColor, dashed: true, points: c.reps.map((r) => ({ x: r.rep, y: r.r_deg })) },
      { key: 'score', label: 'ROM %', color: accentColor, points: c.reps.map((r) => ({ x: r.rep, y: r.rom_pct })) },
    );
  } else {
    const c = check as JointFixationCheck;
    series.push(
      { key: 'l', label: 'Left', color: lColor, dashed: true, points: c.reps.map((r) => ({ x: r.rep, y: r.l_deviation })) },
      { key: 'r', label: 'Right', color: rColor, dashed: true, points: c.reps.map((r) => ({ x: r.rep, y: r.r_deviation })) },
      { key: 'score', label: 'Fixation %', color: accentColor, points: c.reps.map((r) => ({ x: r.rep, y: r.fixation_pct })) },
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

  // Custom horizontal slide (native Modal's own "slide" animation is
  // vertical) so opening/closing this matches the rest of the app's
  // slide_from_right screen-push convention rather than a bottom sheet.
  const translateX = useRef(new Animated.Value(SCREEN_W)).current;

  useEffect(() => {
    if (visible) {
      translateX.setValue(SCREEN_W);
      Animated.timing(translateX, { toValue: 0, duration: 260, useNativeDriver: true }).start();
    }
  }, [visible]);

  function handleClose() {
    Animated.timing(translateX, { toValue: SCREEN_W, duration: 220, useNativeDriver: true })
      .start(({ finished }) => { if (finished) onClose(); });
  }

  return (
    // transparent: every other Modal in this app uses it — an opaque
    // full-screen Modal triggers iOS's real view-controller-level
    // UIModalPresentationFullScreen transition, which was leaving the
    // ScrollView-based screen underneath with a stale/shrunk measured
    // layout ("scrolls inside a clipped box") once dismissed. `transparent`
    // switches iOS to an overFullScreen overlay instead, which keeps the
    // presenting screen's layout intact; styles.screen's own opaque
    // background still makes this read as a normal full-screen page.
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <Animated.View style={[styles.screen, { transform: [{ translateX }] }]}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <Pressable hitSlop={10} onPress={handleClose} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
            <Text style={[styles.backArrow, { color: accentColor }]}>←</Text>
            <Text style={[styles.backLabel, { color: accentColor }]}>Back</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{check.label}</Text>
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
              {kind !== 'balance' && <Text style={[styles.th, styles.colVal]}>{kind === 'rom' ? 'ACH°' : 'DEV'}</Text>}
              <Text style={[styles.th, styles.colVal]}>{kind === 'balance' ? 'BAL%' : kind === 'rom' ? 'ROM%' : 'FIX%'}</Text>
              <Text style={[styles.th, styles.colTime]}>TIME</Text>
            </View>

            {reps.map((r, i) => {
              const c = check.reps.find((cr) => cr.rep === r.rep) as any;
              const lVal = c && (kind === 'balance' ? c.l_value : kind === 'rom' ? c.l_deg : c.l_deviation);
              const rVal = c && (kind === 'balance' ? c.r_value : kind === 'rom' ? c.r_deg : c.r_deviation);
              const achVal = c && (kind === 'rom' ? c.achieved_deg : c.achieved_deviation);
              const pctVal = c && (kind === 'balance' ? c.balance_pct : kind === 'rom' ? c.rom_pct : c.fixation_pct);
              return (
                <React.Fragment key={r.rep}>
                  <View style={styles.tableRow}>
                    <Text style={[styles.td, styles.colRep]}>{r.rep + 1}</Text>
                    {c ? (
                      <>
                        <Text style={[styles.td, styles.colVal]}>{lVal}</Text>
                        <Text style={[styles.td, styles.colVal]}>{rVal}</Text>
                        {kind !== 'balance' && <Text style={[styles.td, styles.colVal]}>{achVal}</Text>}
                        <Text style={[styles.td, styles.colVal]}>{Math.round(pctVal)}%</Text>
                      </>
                    ) : (
                      <>
                        <Text style={[styles.td, styles.colVal]}>—</Text>
                        <Text style={[styles.td, styles.colVal]}>—</Text>
                        {kind !== 'balance' && <Text style={[styles.td, styles.colVal]}>—</Text>}
                        <Text style={[styles.td, styles.colVal]}>—</Text>
                      </>
                    )}
                    <Text style={[styles.td, styles.colTime]}>{formatDurationPrecise(r.duration_sec)}</Text>
                  </View>

                  {i < reps.length - 1 && (
                    <View style={styles.restRow}>
                      <Text style={styles.restText}>
                        REST — {formatDurationPrecise(Math.max(0, reps[i + 1].start_sec - r.end_sec))}
                      </Text>
                    </View>
                  )}
                </React.Fragment>
              );
            })}
          </View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: spacing.md },
  backArrow: { fontSize: 18, fontWeight: '700' },
  backLabel: { fontSize: 13, fontWeight: '700' },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800' },
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
