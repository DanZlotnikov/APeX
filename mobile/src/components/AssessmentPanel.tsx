import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Text } from './ui/Text';
import { Assessment, ExerciseAssessment } from '../utils/exerciseAnalyzer';
import { Comparison, StatDelta } from '../utils/stats';
import RiskFactorRow from './RiskFactorRow';
import ReadinessGauge from './ReadinessGauge';
import PhysioCard from './PhysioCard';
import DeltaChip from './DeltaChip';
import LineTrend from './charts/LineTrend';
import { colors, spacing } from '../theme';

interface Props {
  assessment: Assessment;
  comparison?: Comparison | null;
}

type ExerciseCmp = Comparison['exercises'][string] | undefined;

export default function AssessmentPanel({ assessment, comparison }: Props) {
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [fade]);

  const translateY = fade.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  const baseline = comparison?.baseline ?? true;

  return (
    <Animated.View style={[styles.wrap, { opacity: fade, transform: [{ translateY }] }]}>
      <Text style={styles.sectionTitle}>READINESS ASSESSMENT</Text>
      {baseline && (
        <Text style={styles.baseline}>First session — baseline set. Future analyses will compare against your history.</Text>
      )}

      {assessment.perExercise.map((ex) => (
        <ExerciseCard key={ex.key} ex={ex} cmp={comparison?.exercises[ex.key]} />
      ))}

      <View style={styles.gaugeCard}>
        <ReadinessGauge readiness={assessment.readiness} label={assessment.readinessLabel} />
        {comparison && !comparison.baseline && (
          <View style={styles.gaugeDelta}>
            <Text style={styles.gaugeDeltaLabel}>VS HISTORY</Text>
            <DeltaChip delta={comparison.readiness} />
          </View>
        )}
      </View>

      {assessment.recommendation && <PhysioCard recKey={assessment.recommendation} />}

      {assessment.confidence < 0.6 && (
        <Text style={styles.confidence}>
          ⚠ Lower tracking confidence — film from the front or side with the whole body in frame for the most accurate reading.
        </Text>
      )}
    </Animated.View>
  );
}

// Per-exercise chart labels and Y-axis orientation.
// For squat/pullup: lower angle = better performance, so we invert for display.
// For jump:         higher = bigger jump (already correct orientation).
function chartConfig(key: ExerciseAssessment['key']): {
  depthLabel: string;
  depthUnit: string;
  invertDepth: boolean; // if true, display (max - v) so "up" means better
} {
  switch (key) {
    case 'squat':
      return { depthLabel: 'DEPTH', depthUnit: '°', invertDepth: true };
    case 'jump':
      return { depthLabel: 'HEIGHT', depthUnit: '', invertDepth: false };
    case 'pullup':
      return { depthLabel: 'CONTRACTION', depthUnit: '°', invertDepth: true };
  }
}

function ExerciseCard({ ex, cmp }: { ex: ExerciseAssessment; cmp: ExerciseCmp }) {
  const m = ex.metrics;
  const cfg = chartConfig(ex.key);
  const hasCharts = m.perRepDepth.length >= 2;

  // When invertDepth, display the "flexion" = (180 - angle) so the chart goes
  // up when performance improves (deeper squat / fuller pull-up contraction).
  const depthSeries = cfg.invertDepth
    ? m.perRepDepth.map((v) => 180 - v)
    : m.perRepDepth;

  const repLabels = m.perRepDepth.map((_, i) => `R${i + 1}`);

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{ex.label}</Text>
        <Text style={styles.cardReps}>{ex.reps} {ex.reps === 1 ? 'REP' : 'REPS'}</Text>
      </View>

      {/* ── Summary stats ── */}
      <View style={styles.stats}>
        <Stat label={ex.key === 'pullup' ? 'PEAK' : 'DEEPEST'} value={`${m.minKneeAngle}°`} delta={cmp?.metrics.minKneeAngle} />
        <Stat label="ROM" value={`${m.romDeg}°`} delta={cmp?.metrics.romDeg} />
        <Stat label="AVG/REP" value={`${m.avgRepSec}s`} delta={cmp?.metrics.avgRepSec} />
        <Stat label="TOTAL" value={`${m.totalSec}s`} />
      </View>

      {/* ── Per-rep sparklines (shown when ≥ 2 reps) ── */}
      {hasCharts && (
        <View style={styles.chartRow}>
          <View style={styles.chartPane}>
            <Text style={styles.chartTitle}>{cfg.depthLabel} / REP</Text>
            <LineTrend
              data={depthSeries}
              height={64}
              startLabel={repLabels[0]}
              endLabel={repLabels[repLabels.length - 1]}
            />
            <Text style={styles.chartAvg}>
              avg {Math.round(depthSeries.reduce((a, b) => a + b, 0) / depthSeries.length)}{cfg.depthUnit}
            </Text>
          </View>

          <View style={[styles.chartPane, styles.chartPaneRight]}>
            <Text style={styles.chartTitle}>PACE / REP</Text>
            <LineTrend
              data={m.perRepDurationSec}
              height={64}
              color="#F59E0B"
              startLabel={repLabels[0]}
              endLabel={repLabels[repLabels.length - 1]}
            />
            <Text style={[styles.chartAvg, styles.chartAvgAmber]}>
              avg {(m.perRepDurationSec.reduce((a, b) => a + b, 0) / m.perRepDurationSec.length).toFixed(1)}s
            </Text>
          </View>
        </View>
      )}

      {/* ── Risk factors ── */}
      {ex.factors.map((f) => (
        <RiskFactorRow key={f.id} factor={f} delta={cmp?.factors[f.id]} />
      ))}
    </View>
  );
}

function Stat({ label, value, delta }: { label: string; value: string; delta?: StatDelta }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {delta && (
        <View style={styles.statDelta}>
          <DeltaChip delta={delta} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },

  sectionTitle: {
    color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2.5,
    marginBottom: spacing.sm,
  },
  baseline: { color: colors.muted, fontSize: 11, lineHeight: 16, marginBottom: spacing.md, fontStyle: 'italic' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '800', letterSpacing: 1.5 },
  cardReps: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1 },

  stats: {
    flexDirection: 'row',
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginBottom: spacing.sm,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '800' },
  statLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 3 },
  statDelta: { marginTop: 5 },

  // Per-rep charts
  chartRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  chartPane: { flex: 1 },
  chartPaneRight: { borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: spacing.md },
  chartTitle: {
    color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.5,
    marginBottom: 4,
  },
  chartAvg: {
    color: colors.primary, fontSize: 10, fontWeight: '700',
    textAlign: 'right', marginTop: 2,
  },
  chartAvgAmber: { color: '#F59E0B' },

  gaugeCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
  },
  gaugeDelta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  gaugeDeltaLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.5 },

  confidence: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
});
