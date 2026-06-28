import React, { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import PoseView from '../components/PoseView';
import PrimaryButton from '../components/PrimaryButton';
import { colors, spacing } from '../theme';
import { ExerciseResults, hasAnyExercise } from '../utils/exerciseAnalyzer';

interface Props {
  videoUri: string;
  onRecordAgain: () => void;
  onHome: () => void;
}

const EXERCISE_LABELS: Record<keyof ExerciseResults, string> = {
  squat:        'Squat',
  deadlift:     'Deadlift',
  verticalJump: 'Vertical Jump',
};

export default function AnalysisScreen({ videoUri, onRecordAgain, onHome }: Props) {
  const [results, setResults] = useState<ExerciseResults | null>(null);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>MOVEMENT ANALYSIS</Text>
      </View>

      <View style={styles.viewer}>
        <PoseView videoUri={videoUri} onExerciseResults={setResults} />
      </View>

      {results && hasAnyExercise(results) && (
        <View style={styles.resultsPanel}>
          <Text style={styles.resultsPanelLabel}>EXERCISES DETECTED</Text>
          {(Object.keys(EXERCISE_LABELS) as (keyof ExerciseResults)[])
            .filter(key => results[key] > 0)
            .map(key => (
              <View key={key} style={styles.resultRow}>
                <Text style={styles.resultName}>{EXERCISE_LABELS[key]}</Text>
                <Text style={styles.resultCount}>× {results[key]}</Text>
              </View>
            ))}
        </View>
      )}

      <View style={styles.footer}>
        <PrimaryButton label="Record Again" onPress={onRecordAgain} />
        <Pressable
          onPress={onHome}
          style={({ pressed }) => [styles.homeBtn, pressed && styles.homeBtnPressed]}
        >
          <Text style={styles.homeBtnText}>MAIN MENU</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  header: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2.5,
  },

  viewer: { flex: 1 },

  // ── exercise results panel ───────────────────────────────────────────────────
  resultsPanel: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.xs,
  },
  resultsPanelLabel: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2.5,
    marginBottom: spacing.xs,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  resultName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  resultCount: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
  },

  // ── footer ───────────────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.xs,
  },
  homeBtn: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  homeBtnPressed: { opacity: 0.4 },
  homeBtnText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2.5,
  },
});
