import { AVPlaybackStatus, ResizeMode, Video } from 'expo-av';
import React, { useCallback, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors } from '../../theme';

function PlayIcon() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="white">
      <Path d="M5 3l14 9-14 9V3z" />
    </Svg>
  );
}
function PauseIcon() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="white">
      <Rect x="4" y="3" width="5" height="18" rx="1.5" />
      <Rect x="15" y="3" width="5" height="18" rx="1.5" />
    </Svg>
  );
}
function ReplayIcon() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="white">
      <Path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
    </Svg>
  );
}

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
  // Adds the device's bottom safe-area inset as clearance under the scrub
  // bar — only meaningful when this player's own bottom edge IS the physical
  // screen edge (e.g. CameraScreen's full-bleed review), where the bar would
  // otherwise sit flush against the home indicator on notch-less iPhones.
  // Left off (default) for Processing/History's cards, which aren't at the
  // screen edge and shouldn't gain extra padding they don't need.
  avoidHomeIndicator?: boolean;
}

function fmtMs(ms: number): string {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export default function VideoPlayer({ videoUri, fitContainer = false, avoidHomeIndicator = false }: Props) {
  const insets    = useSafeAreaInsets();
  const videoRef  = useRef<Video>(null);
  const barWidth  = useRef(0);
  // The playhead ratio (0-1) at the moment the current drag started — the
  // seek target while dragging is this PLUS the gesture's cumulative dx,
  // never an absolute touch coordinate (see seekPan below).
  const dragStartRatio = useRef(0);
  // statusRef lets the stable PanResponder always read the latest playback state
  const statusRef = useRef<AVPlaybackStatus | null>(null);

  const [status,     setStatus]     = useState<AVPlaybackStatus | null>(null);
  // isFinished persists until user acts — didJustFinish is only true for one tick
  const [isFinished, setIsFinished] = useState(false);
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
    if (s.isLoaded && (s as any).didJustFinish) {
      setIsFinished(true);
    }
  }, []);

  async function togglePlay() {
    const v = videoRef.current;
    if (!v || !loaded) return;
    if (isFinished) {
      setIsFinished(false);
      await v.replayAsync();
    } else if (playing) {
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
  const seekPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: () => {
        dragAnchored.current = false;
        const s = statusRef.current;
        if (s?.isLoaded) {
          const pos = (s as any).positionMillis ?? 0;
          const dur = (s as any).durationMillis ?? 1;
          dragStartRatio.current = Math.max(0, Math.min(1, pos / dur));
          dragAnchored.current = true;
        }
        setIsFinished(false);
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

  const Icon = isFinished ? ReplayIcon : playing ? PauseIcon : PlayIcon;

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
          }}
          shouldPlay
          isMuted
        />
      </Pressable>

      {/* Always visible — not a fade-in-on-touch overlay. Tapping the video
          itself toggles play/pause (see the Pressable above); this bar is
          purely for scrubbing + a visual play/pause affordance. */}
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.cbar, avoidHomeIndicator && { paddingBottom: 14 + insets.bottom }]} pointerEvents="box-none">
          <Pressable onPress={togglePlay} style={styles.pbtn}>
            <Icon />
          </Pressable>

          <View
            style={styles.track}
            onLayout={e => { barWidth.current = e.nativeEvent.layout.width; }}
            {...seekPan.panHandlers}
          >
            <View style={styles.trackBg} />
            <View style={[styles.trackFill, { width: `${Math.round(pct * 100)}%` as any }]} />
            <View style={[styles.thumb,     { left: `${Math.round(pct * 100)}%` as any }]} />
          </View>

          <Text style={styles.time}>{fmtMs(posMs)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:      { backgroundColor: colors.bg },
  flexFill:  { flex: 1 },
  videoWrap: { flex: 1 },
  video:     { flex: 1 },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  cbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    paddingBottom: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  pbtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  track: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
  },
  trackBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  thumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primary,
    marginLeft: -7,
    top: 7,
  },

  time: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    minWidth: 36,
    textAlign: 'right',
  },
});
