import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import StatusBanner from '../components/StatusBanner';
import LiveCamera, { LiveCameraHandle } from '../components/LiveCamera';
import VideoPlayer from '../components/VideoPlayer';
import { useSettings } from '../state/SettingsContext';
import { colors, spacing } from '../theme';
import { normalizeVideoUri } from '../utils/video';

const COUNTDOWN_SECONDS = 5;
const RECORD_SECONDS = 30;

interface Props {
  pickOnMount: boolean;
  testMode: boolean;
  // Async pipeline: this uploads the clip and queues a video_jobs row (see
  // api/videoJobs.ts) rather than running any on-device analysis — the
  // promise resolves once the upload + row insert succeed, not once the
  // exercise has actually been analyzed (that happens server-side, later).
  onVideoConfirmed: (uri: string, durationSec: number) => Promise<void>;
  onBack: () => void;
  initialVideoUri?: string; // pre-picked upload — skip picker, go straight to review
  targetLabel?: string; // set when recording for a specific required task (e.g. "Squat")
}

export default function CameraScreen({ pickOnMount, testMode, onVideoConfirmed, onBack, initialVideoUri, targetLabel }: Props) {
  const { accentColor, accentOn } = useSettings();
  const liveCamRef = useRef<LiveCameraHandle>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [countdown, setCountdown] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState<number | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(initialVideoUri ?? null);
  const [videoDurationSec, setVideoDurationSec] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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
    setVideoDurationSec(elapsed);
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
        // duration comes back in ms for a picked video asset; undefined for
        // some platforms/formats — falls back to 0 (unknown) at upload time.
        setVideoDurationSec(res.assets[0].duration != null ? res.assets[0].duration / 1000 : null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open library.');
    } finally {
      setIsPicking(false);
    }
  }

  async function handleConfirm() {
    if (!videoUri) return;
    setUploading(true);
    setError(null);
    try {
      const uri = await normalizeVideoUri(videoUri);
      await onVideoConfirmed(uri, videoDurationSec ?? 0);
    } catch (e) {
      setError('Could not upload video: ' + (e instanceof Error ? e.message : String(e)));
      setUploading(false);
    }
  }

  // ── clip preview ──────────────────────────────────────────────────────────
  // Full-bleed video with floating chrome, matching the live camera screen's
  // own top-overlay pattern (back/flip icon buttons + a target pill) rather
  // than a separate title bar + a stacked column of full-width buttons below
  // the video. Only two actions: confirm (✓) or back (✕) — no "Retry", since
  // Back already covers "I don't want this take" (re-record/re-pick from
  // scratch). Both icons anchor top-left specifically so they never sit near
  // VideoPlayer's own bottom scrub-bar overlay.
  if (videoUri) {
    return (
      <View style={styles.reviewScreen}>
        <View style={styles.reviewViewer}>
          <VideoPlayer videoUri={videoUri} avoidHomeIndicator />
        </View>

        <SafeAreaView style={styles.topOverlay} pointerEvents="box-none">
          <View style={[styles.topBar, styles.reviewTopBar]}>
            <View style={styles.reviewActions}>
              <Pressable
                onPress={onBack}
                disabled={uploading}
                style={({ pressed }) => [styles.iconBtn, styles.reviewIconBtnSecondary, pressed && styles.pressed]}
              >
                <Text style={[styles.iconText, styles.reviewIconTextSecondary]}>✕</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirm}
                disabled={uploading}
                style={({ pressed }) => [styles.iconBtn, styles.reviewIconBtnPrimary, { backgroundColor: accentColor }, pressed && styles.pressed]}
              >
                {uploading ? <ActivityIndicator size="small" color={accentOn} /> : <Text style={[styles.iconText, styles.reviewIconTextPrimary, { color: accentOn }]}>✓</Text>}
              </Pressable>
            </View>

            {targetLabel && (
              <View style={styles.targetPill}>
                <Text style={styles.targetPillText}>{targetLabel.toUpperCase()}</Text>
              </View>
            )}
          </View>

          {error && (
            <View style={styles.reviewErrorWrap}>
              <StatusBanner message={error} tone="error" />
            </View>
          )}
        </SafeAreaView>
      </View>
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

          {/* recording timer, or which required task this is while not yet recording */}
          {isRecording && recordingTime !== null ? (
            <View style={styles.timerPill}>
              <View style={styles.recDot} />
              <Text style={styles.timerText}>{fmt(RECORD_SECONDS - recordingTime)}</Text>
            </View>
          ) : targetLabel ? (
            <View style={styles.targetPill}>
              <Text style={styles.targetPillText}>{targetLabel.toUpperCase()}</Text>
            </View>
          ) : null}

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
  reviewViewer: { flex: 1 },
  // 16pt gap: standard 8pt-grid spacing between two adjacent tap targets.
  reviewActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // Lower and closer to the left edge than the live camera screen's back/flip
  // icons — this screen has no recording timer competing for the same top
  // strip, so the buttons can sit in a more relaxed, easier-to-reach spot
  // instead of hugging the very top corner. paddingLeft: spacing.md (16pt) is
  // the standard iOS/Material screen-edge content margin, not an arbitrary number.
  reviewTopBar: { paddingTop: spacing.xl, paddingLeft: spacing.md },
  // ✕ (back, secondary) at 44pt: Apple HIG's minimum recommended tap target.
  // ✓ (confirm, primary) at 56dp: Material Design's standard FAB size — a
  // deliberately larger primary action, the same size-hierarchy convention
  // FABs use everywhere.
  reviewIconBtnSecondary: { width: 44, height: 44, borderRadius: 22 },
  reviewIconBtnPrimary:   { width: 56, height: 56, borderRadius: 28 },
  reviewIconTextSecondary: { fontSize: 18 },
  reviewIconTextPrimary:   { fontSize: 24 },
  reviewErrorWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  pressed: { opacity: 0.6 },

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
  targetPill: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  targetPillText: { color: colors.primary, fontSize: 12, fontWeight: '700', letterSpacing: 1 },

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
