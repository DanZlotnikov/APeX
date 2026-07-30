import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import StatusBanner from '../components/StatusBanner';
import LiveCamera, { LiveCameraHandle } from '../components/LiveCamera';
import VideoPlayer from '../components/VideoPlayer';
import { useSettings } from '../state/SettingsContext';
import { colors, spacing } from '../theme';
import { normalizeVideoUri } from '../utils/video';

// Must stay in sync with VideoPlayer.native.tsx's own BOTTOM_CHROME_HEIGHT
// (branded bar + scrub hit area) — the confirm/back row below is positioned
// just above that player chrome, not importable directly since the
// VideoPlayer barrel only re-exports the default (native/web platform split).
const VIDEO_BOTTOM_CHROME_HEIGHT = 66;

const COUNTDOWN_SECONDS = 5;
// Must match App.tsx's MAX_VIDEO_DURATION_SEC — same cap, applied to a live
// recording here vs. an uploaded/picked clip there.
const RECORD_SECONDS = 20;

interface Props {
  pickOnMount: boolean;
  testMode: boolean;
  // Async pipeline: this queues the clip for upload and immediately
  // navigates away — it does NOT wait for the upload (or the exercise
  // analysis, which happens server-side later still) to finish. The
  // caller handles the actual upload in the background and surfaces a
  // failure via its own alert, since this screen will already be gone.
  onVideoConfirmed: (uri: string, durationSec: number) => void;
  onBack: () => void;
  initialVideoUri?: string; // pre-picked upload — skip picker, go straight to review
  // Duration of initialVideoUri, captured by the caller at pick time —
  // CameraScreen has no way to recover it itself for this flow (its own
  // duration tracking is either the live-recording timer, or its own
  // pickVideo(), neither of which run when a video arrives pre-picked via
  // this prop), so without this every upload silently recorded 0s regardless
  // of the clip's real length.
  initialVideoDurationSec?: number;
}

export default function CameraScreen({ pickOnMount, testMode, onVideoConfirmed, onBack, initialVideoUri, initialVideoDurationSec }: Props) {
  const { accentColor, accentOn } = useSettings();
  const insets = useSafeAreaInsets();
  const liveCamRef = useRef<LiveCameraHandle>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [countdown, setCountdown] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState<number | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(initialVideoUri ?? null);
  const [videoDurationSec, setVideoDurationSec] = useState<number | null>(initialVideoDurationSec ?? null);
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
        const asset = res.assets[0];
        const durationSec = asset.duration != null ? asset.duration / 1000 : null;
        if (durationSec != null && durationSec > RECORD_SECONDS) {
          setError(`Please choose a video ${RECORD_SECONDS} seconds or shorter.`);
          return;
        }
        setVideoUri(asset.uri);
        // duration comes back in ms for a picked video asset; undefined for
        // some platforms/formats — falls back to 0 (unknown) at upload time.
        setVideoDurationSec(durationSec);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open library.');
    } finally {
      setIsPicking(false);
    }
  }

  async function handleConfirm() {
    if (!videoUri || uploading) return;
    setUploading(true);
    setError(null);
    try {
      // The only await left here is a local, usually-instant file-URI
      // normalization (see normalizeVideoUri) — not the upload itself.
      // onVideoConfirmed is fire-and-forget: it navigates away right away
      // and runs the actual upload in the background (see App.tsx), so
      // this screen never waits on the network round-trip.
      const uri = await normalizeVideoUri(videoUri);
      onVideoConfirmed(uri, videoDurationSec ?? 0);
    } catch (e) {
      setError('Could not process video: ' + (e instanceof Error ? e.message : String(e)));
      setUploading(false);
    }
  }

  // ── clip preview ──────────────────────────────────────────────────────────
  // Full-bleed video with floating chrome. The target pill (which exercise
  // this take is for) stays up top, matching the live camera screen's own
  // top-overlay pattern. Confirm (✓) / back (✕) — no "Retry", since Back
  // already covers "I don't want this take" — sit centered just above
  // VideoPlayer's own bottom chrome (branded bar + scrub line), not up top:
  // up there they'd collide with the system status bar/clock on a full-bleed
  // screen, which is exactly why VideoPlayer's own play/pause status
  // indicator moves to sit left-aligned above that same bottom chrome for
  // avoidHomeIndicator contexts too (see VideoPlayer.native.tsx).
  if (videoUri) {
    return (
      <View style={styles.reviewScreen}>
        <View style={styles.reviewViewer}>
          <VideoPlayer videoUri={videoUri} avoidHomeIndicator />
        </View>

        {/* Full-bleed to the true top edge (not inset by the SafeAreaView
            below) — the bar's fill should reach behind the status bar, only
            its text needs to clear the notch/status bar icons. */}
        <View style={[styles.reviewHeaderBar, { paddingTop: insets.top }]} pointerEvents="box-none">
          <Text style={[styles.reviewHeaderText, { color: accentColor }]}>READY TO RUMBLE?</Text>
        </View>

        <View
          style={[styles.reviewActions, { bottom: VIDEO_BOTTOM_CHROME_HEIGHT + insets.bottom + spacing.xl }]}
          pointerEvents="box-none"
        >
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

        {error && (
          <View style={[styles.reviewErrorWrap, { top: insets.top + 16 }]}>
            <StatusBanner message={error} tone="error" />
          </View>
        )}
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

          {/* recording timer while recording */}
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
  reviewViewer: { flex: 1 },
  // 16pt gap: standard 8pt-grid spacing between two adjacent tap targets.
  reviewActions: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  // Branded header bar — mirrors VideoPlayer's own bottom "APeX" bar (same
  // colors.bg fill as the screen behind it, so it blends in rather than
  // standing out as a separate panel), text colored with the app's selected
  // accent color to match the scrub line and the confirm button. Absolutely
  // positioned (not inside the SafeAreaView below) so its fill reaches the
  // true top edge — paddingTop: insets.top is applied inline where it's used,
  // so only the text itself clears the status bar/notch.
  reviewHeaderBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: spacing.lg,
  },
  reviewHeaderText: { fontSize: 14, fontWeight: '900', letterSpacing: 3, marginTop: spacing.sm },
  // Both actions equal weight/size — no primary/secondary size hierarchy.
  reviewIconBtnSecondary: { width: 64, height: 64, borderRadius: 32 },
  reviewIconBtnPrimary:   { width: 64, height: 64, borderRadius: 32 },
  reviewIconTextSecondary: { fontSize: 26 },
  reviewIconTextPrimary:   { fontSize: 26 },
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
