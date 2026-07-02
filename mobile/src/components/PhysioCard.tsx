import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RecommendationKey } from '../utils/exerciseAnalyzer';
import { PHYSIO_LIBRARY } from '../utils/physioLibrary';
import PhysioDemo from './PhysioDemo';
import { colors, spacing } from '../theme';

interface Props {
  recKey: RecommendationKey;
}

/**
 * Corrective-exercise recommendation shown when the assessment finds real injury
 * risk. Header + exercise name, a looping demo animation, the rationale,
 * step-by-step instructions, and dosage chips (frequency / duration / timeline).
 */
export default function PhysioCard({ recKey }: Props) {
  const ex = PHYSIO_LIBRARY[recKey];
  if (!ex) return null;

  return (
    <View style={styles.card}>
      <View style={styles.accent} />

      <Text style={styles.kicker}>RECOMMENDED CORRECTIVE</Text>
      <Text style={styles.name}>{ex.name}</Text>
      <Text style={styles.target}>{ex.target}</Text>

      <PhysioDemo demoKey={ex.demoKey} style={styles.demo} />

      <Text style={styles.why}>{ex.why}</Text>

      <View style={styles.steps}>
        {ex.steps.map((s, i) => (
          <View key={i} style={styles.stepRow}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumText}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{s}</Text>
          </View>
        ))}
      </View>

      <View style={styles.chips}>
        <Chip label="FREQUENCY" value={ex.frequency} />
        <Chip label="DOSE" value={ex.duration} />
        <Chip label="TIMELINE" value={ex.timeline} />
      </View>
    </View>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <Text style={styles.chipValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  accent: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 3,
    backgroundColor: colors.primary,
  },

  kicker: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  name: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing.xs },
  target: { color: colors.muted, fontSize: 12, fontWeight: '600', marginTop: 2 },

  demo: {
    height: 200,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
  },

  why: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: spacing.md, opacity: 0.9 },

  steps: { marginTop: spacing.md, gap: spacing.sm },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start' },
  stepNum: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm, marginTop: 1,
  },
  stepNumText: { color: colors.primary, fontSize: 11, fontWeight: '800' },
  stepText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19, opacity: 0.9 },

  chips: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  chip: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  chipLabel: { color: colors.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  chipValue: { color: colors.text, fontSize: 11, fontWeight: '600', marginTop: 3, lineHeight: 15 },
});
