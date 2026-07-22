import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getRoutine, RoutineSetting, setRoutineExercise } from '../../api/routine';
import RepStepper from '../../components/RepStepper';
import Toggle from '../../components/Toggle';
import { useSettings } from '../../state/SettingsContext';
import { exerciseLabel, PIPELINE_EXERCISE_KEYS, PipelineExerciseKey } from '../../utils/pipelineExercise';
import { colors, spacing } from '../../theme';

interface Props {
  userId?: string;
  teamId?: string;
}

// Routine tab: on/off + 1-10 daily-reps target for every exercise the
// detection pipeline knows about (see HANDOFF_video_pipeline.md /
// pipelineExercise.ts). An athlete with a team can watch + perform it but
// not edit it (readOnly below); an individual/teamless athlete can also
// edit — enforced again server-side by migration 014's RLS, this is just
// the UI reflecting that rule, not the only thing enforcing it. Recording is
// done from the AppBar's Record/Upload buttons (always visible above this
// tab), not from a per-exercise button here.
export default function RoutineScreen({ userId, teamId }: Props) {
  const { accentColor } = useSettings();
  const [settings, setSettings] = useState<Partial<Record<PipelineExerciseKey, RoutineSetting>>>({});
  const [loading, setLoading] = useState(true);
  const readOnly = !!teamId;

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (userId) {
        getRoutine(userId, teamId ?? null)
          .then((rows) => {
            if (!active) return;
            const map: Partial<Record<PipelineExerciseKey, RoutineSetting>> = {};
            rows.forEach((r) => { map[r.exerciseType] = r; });
            setSettings(map);
          })
          .catch((e) => console.warn('[APeX] Failed to load routine:', e))
          .finally(() => { if (active) setLoading(false); });
      } else {
        setLoading(false);
      }
      return () => { active = false; };
    }, [userId, teamId]),
  );

  async function updateSetting(key: PipelineExerciseKey, patch: Partial<Pick<RoutineSetting, 'enabled' | 'targetReps'>>) {
    if (!userId || readOnly) return;
    const current: RoutineSetting = settings[key] ?? { exerciseType: key, enabled: false, targetReps: 5 };
    const next: RoutineSetting = { ...current, ...patch };
    // Saved immediately, optimistically — reverted below if the write fails.
    setSettings((prev) => ({ ...prev, [key]: next }));
    try {
      await setRoutineExercise(userId, key, next.enabled, next.targetReps);
    } catch (e) {
      console.warn('[APeX] Failed to save routine setting:', e);
      setSettings((prev) => ({ ...prev, [key]: current }));
      Alert.alert('Could not save', 'Something went wrong updating your routine. Please try again.');
    }
  }

  if (!userId) return null;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>ROUTINE</Text>
        <Text style={styles.title}>Daily exercises</Text>
        <Text style={styles.subtitle}>
          {readOnly
            ? 'Your routine is view-only. Routine editing is available for individual athletes only.'
            : 'Turn on an exercise and set how many reps you want to do each day. Changes save instantly.'}
        </Text>

        {loading ? (
          <ActivityIndicator color={accentColor} style={styles.loading} />
        ) : (
          PIPELINE_EXERCISE_KEYS.map((key) => {
            const setting = settings[key] ?? { exerciseType: key, enabled: false, targetReps: 5 };
            return (
              <View key={key} style={styles.card}>
                <View style={styles.headerRow}>
                  <Text style={[styles.exerciseLabel, !setting.enabled && styles.exerciseLabelOff]}>{exerciseLabel(key)}</Text>
                  <Toggle
                    value={setting.enabled}
                    onValueChange={(v) => void updateSetting(key, { enabled: v })}
                    disabled={readOnly}
                    accentColor={accentColor}
                  />
                </View>

                {setting.enabled && (
                  <View style={styles.stepperBlock}>
                    <RepStepper
                      min={1}
                      max={10}
                      value={setting.targetReps}
                      onChange={(v) => void updateSetting(key, { targetReps: v })}
                      disabled={readOnly}
                      accentColor={accentColor}
                    />
                    <Text style={styles.repsCaption}>REPS / DAY</Text>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },

  kicker: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2.5, marginBottom: spacing.xs },
  title: { color: colors.text, fontSize: 26, fontWeight: '900', letterSpacing: 0.5 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.xs, marginBottom: spacing.md },
  loading: { marginTop: spacing.lg },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exerciseLabel: { color: colors.text, fontSize: 16, fontWeight: '800' },
  exerciseLabelOff: { color: colors.muted },

  stepperBlock: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  repsCaption: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginLeft: spacing.sm },
});
