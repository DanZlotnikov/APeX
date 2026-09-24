import { AVPlaybackStatus, ResizeMode, Video } from 'expo-av';
import React, { useCallback, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import { useSettings } from '../../state/SettingsContext';
import { colors } from '../../theme';
import ApexLoader from '../ApexLoader';

function PlayIcon() {
  return (
    <Svg width={13} height={13} viewBox="0 0 24 24" fill="white">
      <Path d="M5 3l14 9-14 9V3z" />
    </Svg>
  );
}
function PauseIcon() {
  return (
    <Svg width={13} height={13} viewBox="0 0 24 24" fill="white">
      <Rect x="4" y="3" width="5" height="18" rx="1.5" />
      <Rect x="15" y="3" width="5" height="18" rx="1.5" />
    </Svg>
  );
}

// Height of the branded bottom strip (the "APeX" bar the scrub line sits
// above) — exported so a consumer positioning its own overlay near the
// bottom of this player (e.g. CameraScreen's confirm/back buttons) can place
// itself just above this chrome without guessing its height.
export const BOTTOM_CHROME_HEIGHT = 26 + 40; // branded bar + scrub hit area

interface Props {
  videoUri: string;
  // false (default): fills whatever box the parent gives it (flex: 1) and
  // lets the inner <Video resizeMode="contain"> fit within that — correct
  // for a variable-height container (e.g. CameraScreen's review screen,
  // where the available space depends on the header/footer around it; a
  // portrait recording sizing itself from width+aspectRatio there could
  // exceed the available flex space and overflow past the footer).
  // true: sizes itself to the video's own aspect ratio (width: 100% +
  // aspectRatio) so a fixed-width card never letterboxes — correct for
  // Processing/History's cards, which have no competing flex siblings.
  fitContainer?: boolean;
  // True only when this player's own edges ARE the physical screen edges
  // (currently just CameraScreen's full-bleed review) — adds the real
  // bottom safe-area inset as clearance under the bottom bar/scrub line
  // (otherwise flush against the home indicator on notch-less iPhones), and
  // moves the status indicator from its default top-left corner to sit
  // left-aligned just above that bottom chrome instead — up top it would
  // collide with the system status bar/clock on a full-bleed screen. Left
  // off (default) for Processing/History's cards, which are never near a
  // physical screen edge and shouldn't gain padding/repositioning they
  // don't need.
  avoidHomeIndicator?: boolean;
}

export default function VideoPlayer({ videoUri, fitContainer = false, avoidHomeIndicator = false }: Props) {
  const { accentColor } = useSettings();
  const insets    = useSafeAreaInsets();
  const videoRef  = useRef<Video>(null);
  const barWidth  = useRef(0);
  // The playhead ratio (0-1) at the moment the current drag started — the
  // seek target while dragging is this PLUS the gesture's cumulative dx,
  // never an absolute touch coordinate (see seekPan below).
  const dragStartRatio = useRef(0);
  // statusRef lets the stable PanResponder always read the latest playback state
  const statusRef = useRef<AVPlaybackStatus | null>(null);

  const [status,  setStatus]  = useState<AVPlaybackStatus | null>(null);
  // Set once the first real frame is decoded (onReadyForDisplay) — until
  // then an ApexLoader overlay covers the (otherwise blank) video area, so
  // there's never a gap between "loader disappears" and "picture appears".
  const [isReady, setIsReady] = useState(false);
  // Sized from the video's own natural dimensions (onReadyForDisplay) rather
  // than assumed — the container fits the video exactly (no letterbox bars)
  // instead of forcing it into an externally fixed height/AR box. Falls back
  // to 16:9 before the first frame reports its real size.
  const [aspectRatio, setAspectRatio] = useState(16 / 9);

  const loaded  = status?.isLoaded === true;
  const playing = loaded && (status as any).isPlaying === true;
  const posMs   = loaded ? ((status as any).positionMillis ?? 0) : 0;
  const durMs   = loaded ? ((status as any).durationMillis ?? 1) : 1;
  const pct     = Math.min(1, Math.max(0, posMs / durMs));

  const onStatusUpdate = useCallback((s: AVPlaybackStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  async function togglePlay() {
    const v = videoRef.current;
    if (!v || !loaded) return;
    if (playing) {
      await v.pauseAsync();
    } else {
      await v.playAsync();
    }
  }

  // Whether dragStartRatio has been anchored for the CURRENT touch — reset on
  // every grant, then set the first time we see a loaded status (which may
  // not be at grant time: a large picked/uploaded video can still be loading
  // when the user first touches down, unlike a small just-recorded clip that
  // loads near-instantly).
  const dragAnchored = useRef(false);

  // PanResponder is created once — reads statusRef.current to avoid stale
  // closures. Seeks by ratio-at-anchor + gestureState.dx (cumulative drag
  // distance since the gesture began), never an absolute touch coordinate.
  // Two coordinate-based approaches were tried and both broke in practice:
  // nativeEvent.locationX is relative to whichever descendant view actually
  // received the raw touch (not the track the responder is attached to) — the
  // absolutely-positioned `thumb` sitting on top of the track meant touching
  // on/near it reported locationX relative to the thumb's own few-px width,
  // collapsing the ratio to ~0 every time. Reading the track's absolute
  // screen position via ref.measure() (to pair with gestureState's
  // screen-absolute x0/moveX) was no more reliable in practice either.
  // gestureState.dx sidesteps both entirely: it's a plain relative delta with
  // no dependency on any view's measured position.
  //
  // The anchor itself isn't always captured at grant: confirmed in practice
  // that scrubbing worked fine right after recording but reset to ~0 for an
  // uploaded/picked video specifically — those are typically much larger
  // files that can still be mid-load (isLoaded still false) at the exact
  // moment the user touches down, whereas a small just-recorded clip loads
  // near-instantly. Grant used to force dragStartRatio to 0 in that case and
  // never revisit it, so the whole drag seeked relative to a false "start of
  // video" baseline. Now grant only anchors opportunistically; if it can't,
  // the first onPanResponderMove that sees a loaded status anchors instead,
  // backing out however much dx already accumulated so the seek math stays
  // continuous (no jump) once it does.
  // ...*Capture (not just onStartShouldSetPanResponder/onMoveShouldSetPanResponder)
  // is required here: both Processing and History render this inside a
  // ScrollView, and without claiming the gesture in the capture phase the
  // ancestor ScrollView's own pan handling can steal part of a real diagonal
  // finger drag before this responder gets it — confirmed in practice as
  // "can only scrub to ~0% or ~66%", i.e. a truncated, non-continuous dx
  // sequence rather than smooth per-pixel movement. Claiming capture here
  // makes this the definitive owner of the gesture the instant it starts.
  const seekPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture:  () => true,
      onPanResponderTerminationRequest: () => false, // don't yield back to the ScrollView mid-drag
      onPanResponderGrant: () => {
        dragAnchored.current = false;
        const s = statusRef.current;
        if (s?.isLoaded) {
          const pos = (s as any).positionMillis ?? 0;
          const dur = (s as any).durationMillis ?? 1;
          dragStartRatio.current = Math.max(0, Math.min(1, pos / dur));
          dragAnchored.current = true;
        }
      },
      onPanResponderMove: (_e, gestureState) => {
        const s = statusRef.current;
        if (!s?.isLoaded || !barWidth.current) return;
        const dur = (s as any).durationMillis ?? 1;
        if (!dragAnchored.current) {
          const pos = (s as any).positionMillis ?? 0;
          const curRatio = Math.max(0, Math.min(1, pos / dur));
          dragStartRatio.current = curRatio - gestureState.dx / barWidth.current;
          dragAnchored.current = true;
        }
        const ratio = Math.max(0, Math.min(1, dragStartRatio.current + gestureState.dx / barWidth.current));
        videoRef.current?.setPositionAsync(ratio * dur);
      },
    }),
  ).current;

  return (
    <View style={[styles.root, fitContainer ? { width: '100%', aspectRatio } : styles.flexFill]}>
      <Pressable style={styles.videoWrap} onPress={togglePlay}>
        <Video
          ref={videoRef}
          source={{ uri: videoUri }}
          style={styles.video}
          resizeMode={ResizeMode.CONTAIN}
          useNativeControls={false}
          onPlaybackStatusUpdate={onStatusUpdate}
          onReadyForDisplay={(e) => {
            const { width, height } = e.naturalSize;
            if (width > 0 && height > 0) setAspectRatio(width / height);
            setIsReady(true);
          }}
          shouldPlay
          isLooping
          isMuted
        />
      </Pressable>

      {!isReady && (
        <View style={styles.loaderOverlay} pointerEvents="none">
          <ApexLoader />
        </View>
      )}

      {isReady && (
        <>
          {/* Status indicator only, not a tap target — per the design, the
              whole video is what toggles play/pause (see the Pressable
              above). Shows the icon for what a tap would currently do,
              matching the play/pause convention. Only shifted for
              avoidHomeIndicator contexts, it sits left-aligned just above
              this player's own bottom chrome instead — up top it would
              collide with the system status bar/clock on a full-bleed
              screen. Processing/History's cards keep the plain top-left
              corner position unchanged. */}
          <View
            style={[
              styles.statusIndicator,
              avoidHomeIndicator
                ? { bottom: 26 + 40 + insets.bottom - 12, left: 10 } // above the (enlarged) scrub hit area
                : { top: 10, left: 10 },
            ]}
            pointerEvents="none"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </View>

          {/* Branded bar is CameraScreen's review-screen chrome only — the
              scrub line has nothing to sit above in Processing/History's
              cards, so it just sits flush at the bottom there instead. */}
          {avoidHomeIndicator && (
            <View style={[styles.bottomBar, { paddingBottom: insets.bottom }]} pointerEvents="none">
              <View style={styles.bottomBarRow}>
                <Text style={[styles.bottomBarText, { color: accentColor }]}>APeX</Text>
              </View>
            </View>
          )}

          <View
            style={[styles.scrubHitArea, avoidHomeIndicator && { bottom: 26 + insets.bottom }]}
            onLayout={e => { barWidth.current = e.nativeEvent.layout.width; }}
            {...seekPan.panHandlers}
          >
            <View style={styles.scrubTrack}>
              <View style={styles.scrubBg} />
              <View style={[styles.scrubFill, { width: `${Math.round(pct * 100)}%` as any, backgroundColor: accentColor }]} />
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root:      { backgroundColor: colors.bg },
  flexFill:  { flex: 1 },
  videoWrap: { flex: 1 },
  video:     { flex: 1 },

  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Play/pause status indicator, YouTube-Shorts-style — small, subtle, never
  // the tap target itself. Position (top-left, or left-aligned above the
  // bottom chrome) is applied per-instance, not here — see the JSX.
  statusIndicator: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Branded strip at the very bottom — purely decorative, gives the scrub
  // line above it a deliberate margin from the true bottom edge instead of
  // an empty/arbitrary gap. NOT a fixed height: for avoidHomeIndicator this
  // grows via paddingBottom (a safe-area spacer strictly BELOW the visible
  // row), rather than a taller fixed height + padding together, which was
  // eating into the centering space and pushing the text toward the top.
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg, // matches the screen behind it, not a distinct panel color
  },
  // The actual visible row — always exactly this tall regardless of safe-area
  // padding on the parent, so the text is centered within a fixed, known box.
  bottomBarRow: {
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBarText: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 3,
    includeFontPadding: false, // Android: strips extra top padding that pushes text off-center
    marginTop: 5, // ~20% of bottomBarRow's 26px height — direct empirical
                  // nudge down; flex centering alone still read as too high
  },

  // A thin full-width progress line sitting just above the branded bar, not
  // a chunky control bar — the invisible hit area is taller than the visible
  // line so it's still comfortably draggable.
  scrubHitArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0, // avoidHomeIndicator overrides this to sit above the branded bar
    height: 40,
    justifyContent: 'flex-end',
  },
  scrubTrack: { height: 3, justifyContent: 'center' },
  scrubBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  scrubFill: {
    position: 'absolute',
    left: 0,
    height: 3,
  },
});
