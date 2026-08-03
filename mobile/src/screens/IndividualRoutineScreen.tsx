import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import PrimaryButton from '../components/PrimaryButton';
import RepStepper from '../components/RepStepper';
import {
  addExercise, addSet, getRoutine, removeExercise, removeSet, RoutineExercise, updateSetReps,
} from '../api/routine';
import { ExerciseCategoryInfo, ExerciseInfo, getExerciseCategories } from '../api/exercises';
import { useSettings } from '../state/SettingsContext';
import { colors, spacing } from '../theme';
import { exerciseLabel, getAvailableExerciseInfos, PipelineExerciseKey } from '../utils/pipelineExercise';

interface Props {
  athleteId?: string;
  /** True when this athlete has a manager — routine is manager-controlled,
   * view-only here. False for an individual (teamless) athlete (self-edits)
   * and always false when a manager is viewing one of their own athletes. */
  readOnly: boolean;
}

const DEFAULT_SET_REPS = 3;
// Roughly 2/3 of RepStepper's own BTN_SIZE (36) — see removeBtn's style comment.
const REMOVE_BTN_SIZE = 24;

// Shared by both the athlete's own "Routine" tab (DashboardScreen) and the
// manager's per-athlete "Routine" tab (AthleteDetailPreview) — same
// component, same look/behavior either way, just readOnly differs. Each
// exercise is now a list of ordered sets, each with its own rep target (see
// supabase/migrations/022_routine_sets.sql) — presence of >=1 set row IS the
// exercise being "in the routine", same convention the old flat-target model
// already used for whole exercises.
export default function IndividualRoutineScreen({ athleteId, readOnly }: Props) {
  const { accentColor } = useSettings();
  const [routine, setRoutine] = useState<RoutineExercise[]>([]);
  const [allExercises, setAllExercises] = useState<ExerciseInfo[]>([]);
  const [categories, setCategories] = useState<ExerciseCategoryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  // Which step the "+ Add Exercise" modal is showing — pick a category
  // first, then an exercise within it (see openAddModal below for how the
  // starting step is decided).
  const [pickerStep, setPickerStep] = useState<'category' | 'exercise'>('category');
  const [pickedCategory, setPickedCategory] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!athleteId) { setLoading(false); return; }
    try {
      const [r, exercises, cats] = await Promise.all([
        getRoutine(athleteId), getAvailableExerciseInfos(), getExerciseCategories(),
      ]);
      setRoutine(r);
      setAllExercises(exercises);
      setCategories(cats);
    } catch (e) {
      console.warn('[APeX] Failed to load routine:', e);
    } finally {
      setLoading(false);
    }
  }, [athleteId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const activeEntries = routine.filter((r) => r.sets.length > 0);
  const availableExercises = allExercises.filter(
    (e) => !activeEntries.some((r) => r.exerciseType === e.key),
  );
  // Categories are already sort_order-sorted from the API; filter/map here
  // preserves that order, no re-sort needed. Only categories with at least
  // one available exercise are shown — an empty category (everything in it
  // already in the routine) would just be a dead end to tap into.
  const categoriesWithAvailable = categories
    .map((category) => ({ category, exercises: availableExercises.filter((e) => e.categoryKey === category.key) }))
    .filter((c) => c.exercises.length > 0);
  const exercisesForPickedCategory = categoriesWithAvailable.find((c) => c.category.key === pickedCategory)?.exercises ?? [];

  // Opening the modal (re)computes the starting step fresh from current
  // data every time, rather than relying on state left over from the last
  // time it was open. Skips straight to the exercise-list step if only one
  // category currently has anything available at all (e.g. a roster with
  // every General Fitness exercise already in the routine, leaving only
  // Padel) — showing a one-item category list first would be pure friction.
  function openAddModal() {
    if (categoriesWithAvailable.length === 1) {
      setPickedCategory(categoriesWithAvailable[0].category.key);
      setPickerStep('exercise');
    } else {
      setPickedCategory(null);
      setPickerStep('category');
    }
    setAddOpen(true);
  }

  function closeAddModal() {
    setAddOpen(false);
    setPickedCategory(null);
    setPickerStep('category');
  }

  // Tapping a category with exactly one available exercise adds it directly
  // instead of showing a redundant one-item step 2 — this is what makes
  // Padel's single "Padel Stroke" exercise feel like one tap, not two.
  function handlePickCategory(categoryKey: string, exercisesInCategory: ExerciseInfo[]) {
    if (exercisesInCategory.length === 1) {
      void handlePickExercise(exercisesInCategory[0].key);
      return;
    }
    setPickedCategory(categoryKey);
    setPickerStep('exercise');
  }

  // Picking an exercise adds it immediately with one set at the default rep
  // target and closes the modal right away — sets can then be tuned or added
  // to on its card via the same controls every other row already uses.
  async function handlePickExercise(key: PipelineExerciseKey) {
    if (!athleteId) return;
    closeAddModal();
    setRoutine((prev) => [
      ...prev.filter((r) => r.exerciseType !== key),
      { exerciseType: key, sets: [{ index: 0, targetReps: DEFAULT_SET_REPS }] },
    ]);
    try {
      await addExercise(athleteId, key);
    } catch (e) {
      console.warn('[APeX] Failed to add routine exercise:', e);
      Alert.alert('Could not add exercise', 'Something went wrong. Please try again.');
      void load();
    }
  }

  async function handleAddSet(key: PipelineExerciseKey) {
    if (!athleteId) return;
    const exercise = routine.find((r) => r.exerciseType === key);
    if (!exercise) return;
    const newIndex = exercise.sets.length ? Math.max(...exercise.sets.map((s) => s.index)) + 1 : 0;
    setRoutine((prev) => prev.map((r) => (
      r.exerciseType === key ? { ...r, sets: [...r.sets, { index: newIndex, targetReps: DEFAULT_SET_REPS }] } : r
    )));
    try {
      await addSet(athleteId, key, exercise.sets);
    } catch (e) {
      console.warn('[APeX] Failed to add set:', e);
      setRoutine((prev) => prev.map((r) => (r.exerciseType === key ? exercise : r)));
      Alert.alert('Could not add set', 'Something went wrong. Please try again.');
    }
  }

  async function updateSetTargetReps(key: PipelineExerciseKey, setIndex: number, reps: number) {
    if (!athleteId) return;
    const prevExercise = routine.find((r) => r.exerciseType === key);
    setRoutine((prev) => prev.map((r) => (
      r.exerciseType === key
        ? { ...r, sets: r.sets.map((s) => (s.index === setIndex ? { ...s, targetReps: reps } : s)) }
        : r
    )));
    try {
      await updateSetReps(athleteId, key, setIndex, reps);
    } catch (e) {
      console.warn('[APeX] Failed to update set reps:', e);
      if (prevExercise) setRoutine((prev) => prev.map((r) => (r.exerciseType === key ? prevExercise : r)));
      Alert.alert('Could not save', 'Something went wrong updating the rep target. Please try again.');
    }
  }

  async function deleteSet(key: PipelineExerciseKey, setIndex: number) {
    if (!athleteId) return;
    const prevExercise = routine.find((r) => r.exerciseType === key);
    setRoutine((prev) => prev.map((r) => (
      r.exerciseType === key ? { ...r, sets: r.sets.filter((s) => s.index !== setIndex) } : r
    )));
    try {
      await removeSet(athleteId, key, setIndex);
    } catch (e) {
      console.warn('[APeX] Failed to remove set:', e);
      if (prevExercise) setRoutine((prev) => prev.map((r) => (r.exerciseType === key ? prevExercise : r)));
      Alert.alert('Could not remove set', 'Something went wrong removing this set. Please try again.');
    }
  }

  async function deleteExercise(key: PipelineExerciseKey) {
    if (!athleteId) return;
    const prevRoutine = routine;
    setRoutine((prev) => prev.filter((r) => r.exerciseType !== key));
    try {
      await removeExercise(athleteId, key);
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
        <Text style={styles.title}>Daily exercises</Text>
        <Text style={styles.subtitle}>
          {readOnly
            ? "Your manager controls your routine — exercises, sets and reps are set for you."
            : 'Add exercises, then add sets and set how many reps each set needs.'}
        </Text>
        {!readOnly && availableExercises.length > 0 && (
          <PrimaryButton
            label="+ Add Exercise"
            onPress={openAddModal}
            style={styles.addBtn}
            labelStyle={styles.addBtnLabel}
          />
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
                  hit box and swallows touches meant for it. A plain label
                  never needs to intercept touches. */}
              <Text style={styles.exerciseLabel} pointerEvents="none">{exerciseLabel(entry.exerciseType)}</Text>

              {entry.sets.map((set, i) => (
                <View key={set.index} style={styles.setRow}>
                  <Text style={styles.setLabel}>SET {i + 1}</Text>
                  <View style={styles.setStepperWrap}>
                    <RepStepper
                      min={1}
                      max={10}
                      value={set.targetReps}
                      onChange={(v) => void updateSetTargetReps(entry.exerciseType, set.index, v)}
                      disabled={readOnly}
                      accentColor={accentColor}
                    />
                  </View>
                  {/* Removing an exercise's last set is blocked here — use
                      the exercise's own × below to remove the whole thing,
                      so a single tap can't silently wipe it out. */}
                  {!readOnly && entry.sets.length > 1 && (
                    <Pressable
                      hitSlop={10}
                      onPress={() => void deleteSet(entry.exerciseType, set.index)}
                      style={({ pressed }) => [styles.removeSetBtn, pressed && styles.pressed]}
                    >
                      <Text style={styles.removeSetBtnText}>Remove</Text>
                    </Pressable>
                  )}
                </View>
              ))}

              {!readOnly && (
                <Pressable
                  onPress={() => void handleAddSet(entry.exerciseType)}
                  style={({ pressed }) => [styles.addSetBtn, { borderColor: accentColor }, pressed && styles.pressed]}
                >
                  <Text style={[styles.addSetBtnText, { color: accentColor }]}>+ Add Set</Text>
                </Pressable>
              )}

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

      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={closeAddModal}>
        <Pressable style={styles.backdrop} onPress={closeAddModal} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>ADD EXERCISE</Text>

          {pickerStep === 'exercise' && (
            <Pressable
              hitSlop={10}
              onPress={() => { setPickedCategory(null); setPickerStep('category'); }}
              style={({ pressed }) => [styles.modalBackBtn, pressed && styles.pressed]}
            >
              <Text style={[styles.modalBackArrow, { color: accentColor }]}>‹</Text>
              <Text style={[styles.modalBackLabel, { color: accentColor }]}>Categories</Text>
            </Pressable>
          )}

          {pickerStep === 'category'
            ? categoriesWithAvailable.map(({ category, exercises }) => (
              <Pressable
                key={category.key}
                onPress={() => handlePickCategory(category.key, exercises)}
                style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
              >
                <Text style={styles.modalRowText}>{category.label}</Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))
            : exercisesForPickedCategory.map((ex) => (
              <Pressable
                key={ex.key}
                onPress={() => void handlePickExercise(ex.key)}
                style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
              >
                <Text style={styles.modalRowText}>{ex.label}</Text>
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
  title: { color: colors.text, fontSize: 26, fontWeight: '900', letterSpacing: 0.5 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.xs },
  loading: { marginTop: spacing.lg },
  empty: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },

  // Overrides PrimaryButton's own full-width, minHeight:56 base — this is a
  // secondary header action, not the screen's primary CTA, so it should
  // read as compact and self-sized rather than a big full-width button.
  addBtn: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    minHeight: 0,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
  },
  addBtnLabel: { fontSize: 13, letterSpacing: 0.5 },
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

  setRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  setLabel: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, width: 48 },
  // flex: 1 so it soaks up the row's remaining width, pinning the remove
  // button to the row's trailing edge, away from the stepper. Both Apple's
  // HIG ("place a potentially destructive control farther away from
  // frequently-used controls") and NN/g's stepper guidance ("give delete
  // buttons distance from primary actions to avoid accidental taps") argue
  // against the two sitting flush together — confirmed the hard way when
  // they were briefly adjacent.
  setStepperWrap: { flex: 1 },

  // Plain text label, no circle/border — hitSlop (above) carries the tap
  // target instead of a visible outline, so it reads as an unambiguous,
  // lighter-weight action rather than a third button matching the stepper's
  // own bordered +/- circles.
  removeSetBtn: {
    paddingVertical: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.md,
  },
  removeSetBtnText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  // Full-width dashed-outline row (Notion/Trello-style "+ Add" placeholder)
  // rather than a small self-start pill — reads as a clear, intentional
  // list-editor action instead of a stray floating button, and the dashed
  // border alone signals "add a new item" without needing an extra divider
  // line above it. marginTop is deliberately much larger than the spacing
  // between set rows (spacing.md) so this reads as a distinct trailing
  // action, not one more item in the list.
  addSetBtn: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addSetBtnText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },

  // Giving the text an explicit box matching the button (previous attempt)
  // backfired on iOS — textAlignVertical is Android-only, so on iOS that
  // just left the glyph top-aligned within its own now-full-size box
  // instead of centered by the parent. Reverted to letting the text size
  // naturally to its own content so the Pressable's alignItems/
  // justifyContent: 'center' actually does the centering, with
  // includeFontPadding: false (Android's extra font-metric padding around
  // text) and a small manual nudge down — × commonly sits slightly above
  // true center in most fonts' own glyph metrics.
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
  removeBtnText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '800',
    includeFontPadding: false,
    marginTop: -1,
  },

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
  // Same back-button visual language as AppBar.tsx's own backBtn/backArrow/
  // backLabel (arrow + destination name, in accentColor) — duplicated
  // locally rather than shared, this is the only other place in the app
  // that needs it and it's a handful of style values.
  modalBackBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  modalBackArrow: { fontSize: 18, fontWeight: '700' },
  modalBackLabel: { fontSize: 13, fontWeight: '700' },
  modalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  modalRowPressed: { opacity: 0.6 },
  modalRowText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  chevron: { color: colors.muted, fontSize: 18, fontWeight: '400' },
});
