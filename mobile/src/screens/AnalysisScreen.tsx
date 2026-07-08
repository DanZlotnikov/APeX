import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import PoseView from '../components/PoseView';
import PrimaryButton from '../components/PrimaryButton';
import AssessmentPanel from '../components/AssessmentPanel';
import { Assessment } from '../utils/exerciseAnalyzer';
import { useSettings } from '../state/SettingsContext';
import { saveTodayEntry, loadHistory, makeId } from '../utils/history';
import { compareToHistory, Comparison } from '../utils/stats';
import { playChime } from '../utils/sound';
import { colors, spacing } from '../theme';
import { createSession } from '../api/sessions';
import { TargetExercise } from '../api/types';
import { EXERCISE_LABELS, ExerciseKey } from '../utils/exerciseMetrics';

interface Props {
  videoUri: string;
  onHome: () => void;
  userId?: string;
  teamId?: string;
  athleteName?: string;
  /** Set when the athlete tapped a required task on the dashboard, rather than free-recording. */
  targetExercise?: TargetExercise | null;
  /** Re-enter the camera for another attempt at the same target exercise. */
  onRecordAgain?: () => void;
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const VIDEO_H = Math.round(SCREEN_H * 0.56);
const TRACK_W  = SCREEN_W * 0.55;
const BAR_W    = TRACK_W * 0.38;

function BakeLoader({ label, progress }: { label: string; progress: number }) {
  const pulse    = useRef(new Animated.Value(0)).current;
  const fillAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    pulseLoop.start();
    return () => pulseLoop.stop();
  }, []);

  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: progress,
      duration: 120,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const ringScale   = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 0.1, 0.5] });
  const fillWidth   = fillAnim.interpolate({ inputRange: [0, 1], outputRange: [0, TRACK_W] });
  const pct         = Math.round(progress * 100);

  return (
    <View style={loaderStyles.wrap}>
      <View style={loaderStyles.logoWrap}>
        <Animated.View style={[loaderStyles.ring, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
        <View style={loaderStyles.logoInner}>
          <Text style={loaderStyles.wordmark}>APeX</Text>
        </View>
      </View>

      <Text style={loaderStyles.label}>{label}</Text>

      <View style={[loaderStyles.track, { width: TRACK_W }]}>
        <Animated.View style={[loaderStyles.bar, { width: fillWidth }]} />
      </View>

      <Text style={loaderStyles.pct}>{pct}%</Text>
    </View>
  );
}

const loaderStyles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

  logoWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl },
  ring: {
    position: 'absolute',
    width: 140, height: 140, borderRadius: 70,
    borderWidth: 1.5, borderColor: colors.primary,
  },
  logoInner: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  wordmark: { color: colors.primary, fontSize: 28, fontWeight: '900', letterSpacing: 4 },

  label: {
    color: colors.muted, fontSize: 11, fontWeight: '600',
    letterSpacing: 3, marginBottom: spacing.xl,
  },
  track: { height: 2, backgroundColor: colors.surface, borderRadius: 1, overflow: 'hidden' },
  bar: {
    position: 'absolute', top: 0, left: 0,
    height: 2, backgroundColor: colors.primary,
    borderRadius: 1, opacity: 0.85,
  },
  pct: {
    color: colors.muted, fontSize: 10, fontWeight: '700',
    letterSpacing: 1, marginTop: 10,
  },
});

export default function AnalysisScreen({
  videoUri, onHome, userId, teamId, athleteName, targetExercise, onRecordAgain,
}: Props) {
  const { settings, accentColor } = useSettings();
  const [assessment, setAssessment]     = useState<Assessment | null>(null);
  const [comparison, setComparison]     = useState<Comparison | null | undefined>(undefined);
  const [saved, setSaved]               = useState(false);
  const [saving, setSaving]             = useState(false);
  const [saveError, setSaveError]       = useState<string | null>(null);
  const [progress, setProgress]         = useState(0);

  const loaderLabel = progress > 0 ? 'ANALYZING MOVEMENT' : 'LOADING POSE MODEL';

  const assessmentLocked  = useRef(false);
  const handleProgress    = useCallback((pct: number) => setProgress(pct), []);

  const handleAssessment = useCallback(
    async (a: Assessment) => {
      if (assessmentLocked.current) return;
      assessmentLocked.current = true;
      setAssessment(a);
      try {
        const prior = await loadHistory();
        setComparison(compareToHistory(a, prior, settings.windowDays));
      } catch {
        setComparison(null);
      }
      void playChime();
    },
    [settings.windowDays],
  );

  // What the athlete actually did is the source of truth for what gets
  // saved — perExercise only ever contains exercises with reps > 0, so its
  // first entry is "the" exercise for this clip (a clip containing more than
  // one is a rare edge case we don't try to split into separate sessions).
  const actual        = assessment?.perExercise[0] ?? null;
  const actualKey: ExerciseKey | null = actual?.key ?? null;
  const effectiveKey: ExerciseKey | null = actualKey ?? targetExercise?.key ?? null;
  const mismatched     = !!(targetExercise && actualKey && actualKey !== targetExercise.key);
  const requiredReps   = targetExercise && effectiveKey ? targetExercise.requiredRepsByKey[effectiveKey] : undefined;
  const completedReps  = actual?.reps ?? 0;
  const meetsRequirement = requiredReps == null ? true : completedReps >= requiredReps;
  const showRequirement = !!targetExercise;

  const handleSave = useCallback(async () => {
    if (!assessment || saved || saving) return;
    if (showRequirement && !meetsRequirement) return; // Record Again is the only action in this state
    setSaving(true);
    setSaveError(null);
    try {
      const id = makeId();
      const keyToSave: ExerciseKey = effectiveKey ?? 'squat';

      // Local save (always — offline capable). No video file is persisted —
      // the skeleton is drawn live over the original clip, never baked to a
      // separate file, and replaying past sessions is a separate future task.
      // Replaces any earlier session for this exercise recorded today.
      await saveTodayEntry({ id, dateISO: new Date().toISOString(), videoFile: null, assessment }, keyToSave);

      // DB sync (when authenticated and on a team) — also replaces today's
      // earlier session for this exercise, if any.
      if (teamId) {
        await createSession(assessment, teamId, athleteName ?? 'Athlete', keyToSave);
      }

      setSaved(true);
    } catch (e: any) {
      const msg = e?.message ?? e?.code ?? String(e);
      console.warn('[APeX] handleSave error:', msg, e);
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [assessment, saved, saving, teamId, athleteName, showRequirement, meetsRequirement, effectiveKey]);

  const isReady = comparison !== undefined;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          onPress={onHome}
          hitSlop={12}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Text style={[styles.backIcon, { color: accentColor }]}>‹</Text>
        </Pressable>
        <Text style={styles.title}>MOVEMENT ANALYSIS</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Always mounted (drives the analysis from the start) — style toggles
            between hidden (1×1, while analyzing) and the visible video area
            (once ready) so it's never remounted mid-analysis. Living inside
            the ScrollView (rather than as a fixed sibling above it) means the
            video scrolls away with the rest of the page instead of staying
            pinned in place. */}
        <View style={isReady ? styles.videoVisible : styles.hidden}>
          <PoseView
            videoUri={videoUri}
            onAssessment={handleAssessment}
            onProgress={handleProgress}
          />
        </View>

        {isReady
          ? assessment && <AssessmentPanel assessment={assessment} comparison={comparison ?? null} />
          : <BakeLoader label={loaderLabel} progress={progress} />}
      </ScrollView>

      {isReady && (
        <View style={styles.footer}>
          {showRequirement && (
            <RequirementCard
              activeLabel={effectiveKey ? EXERCISE_LABELS[effectiveKey] : '—'}
              targetLabel={targetExercise!.label}
              completedReps={completedReps}
              requiredReps={requiredReps}
              meetsRequirement={meetsRequirement}
              mismatched={mismatched}
            />
          )}

          {showRequirement && !meetsRequirement ? (
            <PrimaryButton label="Record Again" onPress={() => onRecordAgain?.()} />
          ) : (
            <PrimaryButton
              label={saved ? 'Saved ✓' : 'Save Analysis'}
              onPress={handleSave}
              disabled={saved}
              loading={saving}
            />
          )}
          {saveError && <Text style={styles.saveError}>{saveError}</Text>}
        </View>
      )}
    </SafeAreaView>
  );
}

function RequirementCard({
  activeLabel, targetLabel, completedReps, requiredReps, meetsRequirement, mismatched,
}: {
  activeLabel: string;
  targetLabel: string;
  completedReps: number;
  requiredReps: number | undefined;
  meetsRequirement: boolean;
  mismatched: boolean;
}) {
  return (
    <View style={reqStyles.card}>
      {mismatched && (
        <Text style={reqStyles.note}>
          You performed <Text style={reqStyles.noteStrong}>{activeLabel}</Text> instead of {targetLabel} — this will be saved as {activeLabel}.
        </Text>
      )}
      <View style={reqStyles.row}>
        <Text style={reqStyles.exercise}>{activeLabel.toUpperCase()}</Text>
        <Text style={reqStyles.reps}>
          {requiredReps != null ? `${completedReps} of ${requiredReps} reps` : `${completedReps} reps`}
        </Text>
      </View>
      <Text style={[reqStyles.status, meetsRequirement && reqStyles.statusDone]}>
        {requiredReps == null ? 'Recorded' : meetsRequirement ? 'Completed' : 'Not completed yet — keep going'}
      </Text>
    </View>
  );
}

const reqStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 6,
  },
  note: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  noteStrong: { color: colors.text, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exercise: { color: colors.text, fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  reps: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  status: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  statusDone: { color: colors.primary },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back:     { width: 32, justifyContent: 'center' },
  backIcon: { fontSize: 30, fontWeight: '300', lineHeight: 30 },
  pressed:  { opacity: 0.4 },
  title: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2.5,
  },

  hidden:       { position: 'absolute', width: 1, height: 1, opacity: 0 },
  videoVisible: { width: '100%', height: VIDEO_H },

  scroll:        { flex: 1 },
  scrollContent: { flexGrow: 1 },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  saveError: {
    color: colors.danger,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
