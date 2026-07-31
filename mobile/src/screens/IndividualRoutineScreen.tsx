import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import PrimaryButton from '../components/PrimaryButton';
import RepStepper from '../components/RepStepper';
import { addOrUpdateRoutineExercise, getRoutine, removeRoutineExercise, RoutineSetting } from '../api/routine';
import { useSettings } from '../state/SettingsContext';
import { colors, spacing } from '../theme';
import { exerciseLabel, PIPELINE_EXERCISE_KEYS, PipelineExerciseKey } from '../utils/pipelineExercise';

interface Props {
  athleteId?: string;
  /** True when this athlete has a manager — routine is manager-controlled,
   * view-only here. False for an individual (teamless) athlete (self-edits)
   * and always false when a manager is viewing one of their own athletes. */
  readOnly: boolean;
}

const DEFAULT_TARGET_REPS = 5;
// Roughly 2/3 of RepStepper's own BTN_SIZE (36) — see removeBtn's style comment.
const REMOVE_BTN_SIZE = 24;

// Shared by both the athlete's own "Routine" tab (DashboardScreen) and the
// manager's per-athlete "Routine" tab (AthleteDetailPreview) — same
// component, same look/behavior either way, just readOnly differs (see
// supabase/migrations/021_individual_routines.sql: an athlete_routines row
// IS the routine now, no more team-wide default + per-athlete override).
export default function IndividualRoutineScreen({ athleteId, readOnly }: Props) {
  const { accentColor } = useSettings();
  const [routine, setRoutine] = useState<RoutineSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    if (!athleteId) { setLoading(false); return; }
    try {
      const r = await getRoutine(athleteId);
      setRoutine(r);
    } catch (e) {
      console.warn('[APeX] Failed to load routine:', e);
    } finally {
      setLoading(false);
    }
  }, [athleteId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const activeEntries = routine.filter((r) => r.enabled);
  const availableKeys = PIPELINE_EXERCISE_KEYS.filter(
    (k) => !activeEntries.some((r) => r.exerciseType === k),
  );

  // Picking an exercise adds it immediately at the default rep target and
  // closes the modal right away — the reps can then be adjusted on its card
  // via the same RepStepper every other row already uses, no separate
  // "set reps before adding" step.
  async function handlePickExercise(key: PipelineExerciseKey) {
    if (!athleteId) return;
    setAddOpen(false);
    setRoutine((prev) => [
      ...prev.filter((r) => r.exerciseType !== key),
      { exerciseType: key, enabled: true, targetReps: DEFAULT_TARGET_REPS },
    ]);
    try {
      await addOrUpdateRoutineExercise(athleteId, key, DEFAULT_TARGET_REPS);
    } catch (e) {
      console.warn('[APeX] Failed to add routine exercise:', e);
      Alert.alert('Could not add exercise', 'Something went wrong. Please try again.');
      void load();
    }
  }

  async function updateReps(key: PipelineExerciseKey, reps: number) {
    if (!athleteId) return;
    const prevEntry = routine.find((r) => r.exerciseType === key);
    setRoutine((prev) => prev.map((r) => (r.exerciseType === key ? { ...r, targetReps: reps } : r)));
    try {
      await addOrUpdateRoutineExercise(athleteId, key, reps);
    } catch (e) {
      console.warn('[APeX] Failed to update reps:', e);
      if (prevEntry) setRoutine((prev) => prev.map((r) => (r.exerciseType === key ? prevEntry : r)));
      Alert.alert('Could not save', 'Something went wrong updating the rep target. Please try again.');
    }
  }

  async function deleteExercise(key: PipelineExerciseKey) {
    if (!athleteId) return;
    const prevRoutine = routine;
    setRoutine((prev) => prev.filter((r) => r.exerciseType !== key));
    try {
      await removeRoutineExercise(athleteId, key);
    } catch (e) {
      console.warn('[APeX] Failed to remove routine exercise:', e);
      setRoutine(prevRoutine);
      Alert.alert('Could not remove', 'Something went wrong removing this exercise. Please try again.');
    }
  }

  if (!athleteId) return null;

  return (
    <View style={styles.screen}>
      {/* Pinned above the ScrollView (a sibling, not a scroll child) so it
          stays put while the exercise list scrolls underneath it. */}
      <View style={styles.stickyHeader}>
        <Text style={styles.kicker}>INDIVIDUAL ROUTINE</Text>
        <Text style={styles.title}>Daily exercises</Text>
        <Text style={styles.subtitle}>
          {readOnly
            ? "Your manager controls your routine — exercises and rep targets are set for you."
            : 'Add exercises and set how many reps you want done each day. Tap × to remove one.'}
        </Text>
        {!readOnly && availableKeys.length > 0 && (
          <PrimaryButton label="+ Add Exercise" onPress={() => setAddOpen(true)} style={styles.addBtn} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={accentColor} style={styles.loading} />
        ) : activeEntries.length === 0 ? (
          readOnly && (
            <Text style={styles.empty}>Your manager hasn't added any exercises to your routine yet.</Text>
          )
        ) : (
          activeEntries.map((entry) => (
            <View key={entry.exerciseType} style={styles.card}>
              {/* pointerEvents="none": this Text is a normal-flow block that
                  spans the card's full content width (including the blank
                  paddingRight reserved for the button below), so without
                  this it sits geometrically on top of the remove button's
                  hit box and swallows touches meant for it — confirmed to
                  be exactly why only a sliver of that box was ever
                  reachable. A plain label never needs to intercept touches. */}
              <Text style={styles.exerciseLabel} pointerEvents="none">{exerciseLabel(entry.exerciseType)}</Text>
              <View style={styles.stepperBlock}>
                <RepStepper
                  min={1}
                  max={10}
                  value={entry.targetReps}
                  onChange={(v) => void updateReps(entry.exerciseType, v)}
                  disabled={readOnly}
                  accentColor={accentColor}
                />
                <Text style={styles.repsCaption}>REPS</Text>
              </View>
              {/* Rendered last (not first) so it also paints in front for
                  hit-testing purposes — belt and suspenders alongside the
                  pointerEvents fix above. Same button as RepStepper's own
                  +/- (plain bordered circle, no nested wrapper, no hitSlop
                  tricks) — that one is proven reliable to tap — just gray
                  and at half its size. */}
              {!readOnly && (
                <Pressable
                  onPress={() => void deleteExercise(entry.exerciseType)}
                  style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.removeBtnText}>×</Text>
                </Pressable>
              )}
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAddOpen(false)} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>ADD EXERCISE</Text>
          {availableKeys.map((key) => (
            <Pressable
              key={key}
              onPress={() => void handlePickExercise(key)}
              style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
            >
              <Text style={styles.modalRowText}>{exerciseLabel(key)}</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },

  stickyHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    zIndex: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  kicker: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2.5, marginBottom: spacing.xs },
  title: { color: colors.text, fontSize: 26, fontWeight: '900', letterSpacing: 0.5 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.xs },
  loading: { marginTop: spacing.lg },
  empty: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },

  addBtn: { marginTop: spacing.md },
  pressed: { opacity: 0.6 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  exerciseLabel: { color: colors.text, fontSize: 16, fontWeight: '800', paddingRight: REMOVE_BTN_SIZE + spacing.sm + spacing.xs },

  // Exactly RepStepper's own +/- button (BTN_SIZE=36, borderWidth 1.5, no
  // background, no hitSlop) at half the size and in gray instead of the
  // accent color — that one is proven reliable to tap in practice, so this
  // reuses the identical structure rather than a custom hit-area trick.
  removeBtn: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: REMOVE_BTN_SIZE,
    height: REMOVE_BTN_SIZE,
    borderRadius: REMOVE_BTN_SIZE / 2,
    borderWidth: 1.5,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Giving the text an explicit box matching the button (previous attempt)
  // backfired on iOS — textAlignVertical is Android-only, so on iOS that
  // just left the glyph top-aligned within its own now-full-size box
  // instead of centered by the parent. Reverted to letting the text size
  // naturally to its own content so the Pressable's alignItems/
  // justifyContent: 'center' actually does the centering, with
  // includeFontPadding: false (Android's extra font-metric padding around
  // text) and a small manual nudge down — × commonly sits slightly above
  // true center in most fonts' own glyph metrics.
  removeBtnText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '800',
    includeFontPadding: false,
    marginTop: -1,
  },

  stepperBlock: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  repsCaption: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginLeft: spacing.sm },

  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalCard: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    top: '30%',
    backgroundColor: colors.surfaceHigh,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  modalTitle: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: spacing.sm },
  modalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  modalRowPressed: { opacity: 0.6 },
  modalRowText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  chevron: { color: colors.muted, fontSize: 18, fontWeight: '400' },
});
