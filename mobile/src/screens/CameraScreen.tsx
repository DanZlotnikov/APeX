import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import PrimaryButton from '../components/PrimaryButton';
import StatusBanner from '../components/StatusBanner';
import LiveCamera, { LiveCameraHandle } from '../components/LiveCamera';
import VideoPlayer from '../components/VideoPlayer';
import { colors, spacing } from '../theme';
import { normalizeVideoUri } from '../utils/video';

const COUNTDOWN_SECONDS = 5;
const RECORD_SECONDS = 10;

interface Props {
  pickOnMount: boolean;
  testMode: boolean;
  onVideoReady: (uri: string) => void;
  onBack: () => void;
}

export default function CameraScreen({ pickOnMount, testMode, onVideoReady, onBack }: Props) {
  const liveCamRef = useRef<LiveCameraHandle>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [countdown, setCountdown] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState<number | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  // True while the image picker is open — suppresses camera view to avoid a
  // brief camera flash before the system picker appears.
  const [isPicking, setIsPicking] = useState(pickOnMount);

  useEffect(() => {
    if (pickOnMount) void pickVideo();
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRecordPress() {
    if (isRecording) {
      stopRecording();
    } else if (countdown !== null) {
      cancelCountdown();
    } else if (testMode) {
      void startActualRecording();
    } else {
      startCountdown();
    }
  }

  function startCountdown() {
    setError(null);
    let count = COUNTDOWN_SECONDS;
    setCountdown(count);
    countdownRef.current = setInterval(() => {
      count -= 1;
      if (count === 0) {
        clearInterval(countdownRef.current!);
        countdownRef.current = null;
        setCountdown(null);
        void startActualRecording();
      } else {
        setCountdown(count);
      }
    }, 1000);
  }

  function cancelCountdown() {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    setCountdown(null);
  }

  async function startActualRecording() {
    setIsRecording(true);
    let elapsed = 0;
    setRecordingTime(elapsed);
    recordTimerRef.current = setInterval(() => {
      elapsed += 1;
      setRecordingTime(elapsed);
    }, 1000);

    await liveCamRef.current?.startRecording(RECORD_SECONDS);

    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    setRecordingTime(null);
    setIsRecording(false);
  }

  function stopRecording() {
    liveCamRef.current?.stopRecording();
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    setRecordingTime(null);
    setIsRecording(false);
  }

  async function pickVideo() {
    setError(null);
    setIsPicking(true);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 1,
      });
      if (!res.canceled && res.assets?.[0]?.uri) {
        setVideoUri(res.assets[0].uri);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open library.');
    } finally {
      setIsPicking(false);
    }
  }

  async function handleAnalyze() {
    if (!videoUri) return;
    setPreparing(true);
    try {
      const uri = await normalizeVideoUri(videoUri);
      onVideoReady(uri);
    } catch (e) {
      setError('Could not prepare video: ' + (e instanceof Error ? e.message : String(e)));
      setPreparing(false);
    }
  }

  // ── clip preview ──────────────────────────────────────────────────────────
  if (videoUri) {
    return (
      <SafeAreaView style={styles.reviewScreen}>
        <View style={styles.reviewHeader}>
          <Text style={styles.reviewTitle}>REVIEW CLIP</Text>
        </View>

        <View style={styles.reviewViewer}>
          <VideoPlayer videoUri={videoUri} />
        </View>

        <View style={styles.reviewFooter}>
          {error && <StatusBanner message={error} tone="error" />}
          <PrimaryButton label="Analyze Movement" onPress={handleAnalyze} loading={preparing} disabled={preparing} />
          <PrimaryButton
            label="Retry"
            variant="secondary"
            onPress={() => pickOnMount ? void pickVideo() : setVideoUri(null)}
            disabled={preparing}
            style={{ marginTop: spacing.sm }}
          />
          <PrimaryButton label="Back" variant="secondary" onPress={onBack} disabled={preparing} style={{ marginTop: spacing.sm }} />
        </View>
      </SafeAreaView>
    );
  }

  // ── blank screen while picker is open ────────────────────────────────────
  if (isPicking) {
    return <View style={[styles.screen, { backgroundColor: colors.bg }]} />;
  }

  // ── live camera ───────────────────────────────────────────────────────────
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <View style={styles.screen}>
      <View style={styles.cameraWrap}>
        <LiveCamera
          ref={liveCamRef}
          onRecordingComplete={(uri: string) => setVideoUri(uri)}
          onError={(msg: string) => { setIsRecording(false); setCountdown(null); setError(msg); }}
        />
      </View>

      {/* countdown overlay */}
      {countdown !== null && (
        <View style={styles.countdownOverlay} pointerEvents="none">
          <Text style={styles.countdownText}>{countdown}</Text>
        </View>
      )}

      {/* top overlay: back + recording timer + flip */}
      <SafeAreaView style={styles.topOverlay} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable onPress={onBack} style={styles.iconBtn} disabled={isRecording || countdown !== null}>
            <Text style={styles.iconText}>←</Text>
          </Pressable>

          {/* recording timer */}
          {isRecording && recordingTime !== null && (
            <View style={styles.timerPill}>
              <View style={styles.recDot} />
              <Text style={styles.timerText}>{fmt(RECORD_SECONDS - recordingTime)}</Text>
            </View>
          )}

          <Pressable onPress={() => liveCamRef.current?.flipCamera()} style={styles.iconBtn} disabled={isRecording || countdown !== null}>
            <Text style={styles.iconText}>⇄</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {/* error */}
      {error && (
        <View style={styles.errorOverlay}>
          <StatusBanner message={error} tone="error" />
        </View>
      )}

      {/* bottom overlay: record button */}
      <SafeAreaView style={styles.bottomOverlay} pointerEvents="box-none">
        <View style={styles.bottomBar}>
          <Pressable onPress={handleRecordPress} style={styles.recordOuter}>
            <View style={[styles.recordInner, (isRecording || countdown !== null) && styles.recordInnerStop]} />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── live camera ────────────────────────────────────────────────────────────
  screen: { flex: 1, backgroundColor: '#000' },
  cameraWrap: { flex: 1 },

  // ── review clip ────────────────────────────────────────────────────────────
  reviewScreen: { flex: 1, backgroundColor: colors.bg },
  reviewHeader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reviewTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2.5,
  },
  reviewViewer: { flex: 1 },
  reviewFooter: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },

  // countdown
  countdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  countdownText: {
    color: '#fff',
    fontSize: 120,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },

  // top bar
  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { color: '#fff', fontSize: 20 },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 6,
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  timerText: { color: '#fff', fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },

  // error
  errorOverlay: {
    position: 'absolute',
    top: 80,
    left: spacing.lg,
    right: spacing.lg,
  },

  // bottom bar
  bottomOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  bottomBar: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  recordOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#EF4444',
  },
  recordInnerStop: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
});
