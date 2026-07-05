import { AVPlaybackStatus, ResizeMode, Video } from 'expo-av';
import React, { useCallback, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
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
}

function fmtMs(ms: number): string {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export default function VideoPlayer({ videoUri }: Props) {
  const videoRef  = useRef<Video>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barWidth  = useRef(0);
  // statusRef lets the stable PanResponder always read the latest playback state
  const statusRef = useRef<AVPlaybackStatus | null>(null);

  const [status,     setStatus]     = useState<AVPlaybackStatus | null>(null);
  const [ctrlsOn,    setCtrlsOn]    = useState(false);
  // isFinished persists until user acts — didJustFinish is only true for one tick
  const [isFinished, setIsFinished] = useState(false);

  const loaded  = status?.isLoaded === true;
  const playing = loaded && (status as any).isPlaying === true;
  const posMs   = loaded ? ((status as any).positionMillis ?? 0) : 0;
  const durMs   = loaded ? ((status as any).durationMillis ?? 1) : 1;
  const pct     = Math.min(1, Math.max(0, posMs / durMs));

  function showCtrls(sticky = false) {
    setCtrlsOn(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!sticky) hideTimer.current = setTimeout(() => setCtrlsOn(false), 3000);
  }

  // Ref so the PanResponder (created once) always calls the current showCtrls
  const showCtrlsRef = useRef(showCtrls);
  showCtrlsRef.current = showCtrls;

  const onStatusUpdate = useCallback((s: AVPlaybackStatus) => {
    statusRef.current = s;
    setStatus(s);
    if (s.isLoaded && (s as any).didJustFinish) {
      setIsFinished(true);
      showCtrlsRef.current(true);
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
    showCtrls();
  }

  // PanResponder is created once — reads statusRef.current to avoid stale closures
  const seekPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: (e) => {
        const s = statusRef.current;
        if (!s?.isLoaded || !barWidth.current) return;
        const dur   = (s as any).durationMillis ?? 1;
        const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / barWidth.current));
        videoRef.current?.setPositionAsync(ratio * dur);
        setIsFinished(false);
        showCtrlsRef.current();
      },
      onPanResponderMove: (e) => {
        const s = statusRef.current;
        if (!s?.isLoaded || !barWidth.current) return;
        const dur   = (s as any).durationMillis ?? 1;
        const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / barWidth.current));
        videoRef.current?.setPositionAsync(ratio * dur);
      },
    }),
  ).current;

  const Icon = isFinished ? ReplayIcon : playing ? PauseIcon : PlayIcon;

  return (
    <View style={styles.root}>
      <Pressable style={styles.videoWrap} onPress={() => showCtrls()}>
        <Video
          ref={videoRef}
          source={{ uri: videoUri }}
          style={styles.video}
          resizeMode={ResizeMode.CONTAIN}
          useNativeControls={false}
          onPlaybackStatusUpdate={onStatusUpdate}
          shouldPlay
          isMuted
        />
      </Pressable>

      {ctrlsOn && (
        <View style={styles.overlay} pointerEvents="box-none">
          <View style={styles.cbar} pointerEvents="box-none">
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: colors.bg },
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
