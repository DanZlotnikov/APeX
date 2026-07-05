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
import VideoPlayer from '../components/VideoPlayer';
import PrimaryButton from '../components/PrimaryButton';
import AssessmentPanel from '../components/AssessmentPanel';
import { Assessment } from '../utils/exerciseAnalyzer';
import { useSettings } from '../state/SettingsContext';
import { appendEntry, loadHistory, makeId } from '../utils/history';
import { saveVideo } from '../utils/storage';
import { compareToHistory, Comparison } from '../utils/stats';
import { playChime } from '../utils/sound';
import { colors, spacing } from '../theme';
import { createSession } from '../api/sessions';

interface Props {
  videoUri: string;
  onHome: () => void;
  userId?: string;
  teamId?: string;
  athleteName?: string;
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

export default function AnalysisScreen({ videoUri, onHome, userId, teamId, athleteName }: Props) {
  const { settings, accentColor } = useSettings();
  const [assessment, setAssessment]     = useState<Assessment | null>(null);
  const [comparison, setComparison]     = useState<Comparison | null | undefined>(undefined);
  const [renderedUri, setRenderedUri]   = useState<string | null>(null);
  const [saved, setSaved]               = useState(false);
  const [saving, setSaving]             = useState(false);
  const [saveError, setSaveError]       = useState<string | null>(null);
  const [progress, setProgress]         = useState(0);

  const loaderLabel = assessment !== null
    ? 'PREPARING VIDEO'
    : progress > 0
      ? 'ANALYZING MOVEMENT'
      : 'LOADING POSE MODEL';

  const assessmentLocked  = useRef(false);
  const videoReadyLocked  = useRef(false);
  const handleProgress    = useCallback((pct: number) => setProgress(pct), []);

  const handleAssessment = useCallback(
    async (a: Assessment) => {
      if (assessmentLocked.current) return;
      assessmentLocked.current = true;
      setAssessment(a);
      setProgress(0);
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

  const handleVideoReady = useCallback(
    (uri: string) => {
      if (videoReadyLocked.current) return;
      videoReadyLocked.current = true;
      setRenderedUri(uri || videoUri);
    },
    [videoUri],
  );

  const handleSave = useCallback(async () => {
    if (!assessment || saved || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const id        = makeId();
      const sourceUri = renderedUri || videoUri;
      const videoFile = await saveVideo(sourceUri, id);

      // Local save (always — offline capable)
      await appendEntry({ id, dateISO: new Date().toISOString(), videoFile, assessment });

      // DB sync (when authenticated and on a team)
      if (teamId) {
        await createSession(assessment, teamId, athleteName ?? 'Athlete');
      }

      setSaved(true);
    } catch (e: any) {
      const msg = e?.message ?? e?.code ?? String(e);
      console.warn('[APeX] handleSave error:', msg, e);
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [assessment, saved, saving, renderedUri, videoUri, userId, teamId, athleteName]);

  const isReady = renderedUri !== null && comparison !== undefined;

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

      <View style={styles.hidden}>
        <PoseView
          videoUri={videoUri}
          onAssessment={handleAssessment}
          onVideoReady={handleVideoReady}
          onProgress={handleProgress}
        />
      </View>

      {isReady ? (
        <>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={{ width: '100%', height: VIDEO_H }}>
              <VideoPlayer videoUri={renderedUri} />
            </View>
            {assessment && <AssessmentPanel assessment={assessment} comparison={comparison ?? null} />}
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label={saved ? 'Saved ✓' : 'Save Analysis'}
              onPress={handleSave}
              disabled={saved}
              loading={saving}
            />
            {saveError && <Text style={styles.saveError}>{saveError}</Text>}
          </View>
        </>
      ) : (
        <BakeLoader label={loaderLabel} progress={progress} />
      )}
    </SafeAreaView>
  );
}

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

  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },

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
