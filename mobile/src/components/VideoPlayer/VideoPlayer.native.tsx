import { AVPlaybackStatus, ResizeMode, Video } from 'expo-av';
import React, { useCallback, useRef, useState } from 'react';
import { GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme';

// Native implementation uses expo-av Video directly — no WebView, no base64.
// This handles any file:// URI on iOS regardless of size.

interface Props {
  videoUri: string;
}

function fmtMs(ms: number): string {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

const IC_PLAY   = '▶';
const IC_PAUSE  = '⏸';
const IC_REPLAY = '↺';

export default function VideoPlayer({ videoUri }: Props) {
  const videoRef     = useRef<Video>(null);
  const hideTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barWidth     = useRef(0);

  const [status,  setStatus]  = useState<AVPlaybackStatus | null>(null);
  const [ctrlsOn, setCtrlsOn] = useState(false);

  const loaded   = status?.isLoaded === true;
  const playing  = loaded && (status as any).isPlaying  === true;
  const finished = loaded && (status as any).didJustFinish === true;
  const posMs    = loaded ? ((status as any).positionMillis ?? 0) : 0;
  const durMs    = loaded ? ((status as any).durationMillis ?? 1) : 1;
  const pct      = Math.min(1, Math.max(0, posMs / durMs));

  function showCtrls(sticky = false) {
    setCtrlsOn(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!sticky) hideTimer.current = setTimeout(() => setCtrlsOn(false), 3000);
  }

  const onStatusUpdate = useCallback((s: AVPlaybackStatus) => {
    setStatus(s);
    if (s.isLoaded && s.didJustFinish) showCtrls(true);
  }, []);

  async function togglePlay() {
    const v = videoRef.current;
    if (!v || !loaded) return;
    if (finished) {
      await v.replayAsync();
    } else if (playing) {
      await v.pauseAsync();
    } else {
      await v.playAsync();
    }
    showCtrls();
  }

  function handleSeek(e: GestureResponderEvent) {
    if (!loaded || !barWidth.current) return;
    const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / barWidth.current));
    videoRef.current?.setPositionAsync(ratio * durMs);
    showCtrls();
  }

  const icon = finished ? IC_REPLAY : playing ? IC_PAUSE : IC_PLAY;

  return (
    <View style={styles.root}>
      {/* video — fills the container, native decoder handles any file size */}
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

      {/* controls overlay — shown on tap, auto-hides after 3 s */}
      {ctrlsOn && (
        <View style={styles.overlay} pointerEvents="box-none">
          <View style={styles.cbar} pointerEvents="box-none">
            <Pressable onPress={togglePlay} style={styles.pbtn}>
              <Text style={styles.pbtnText}>{icon}</Text>
            </Pressable>

            {/* seek bar: tap to jump to position */}
            <Pressable
              style={styles.track}
              onLayout={e => { barWidth.current = e.nativeEvent.layout.width; }}
              onPress={handleSeek}
            >
              <View style={styles.trackBg} />
              <View style={[styles.trackFill, { width: `${Math.round(pct * 100)}%` as any }]} />
              <View style={[styles.thumb, { left: `${Math.round(pct * 100)}%` as any }]} />
            </Pressable>

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
    background: undefined, // RN doesn't support CSS gradients; use a dark cbar bg instead
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
  pbtnText: {
    color: '#fff',
    fontSize: 14,
  },

  track: {
    flex: 1,
    height: 20,
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
    top: 3,
  },

  time: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    minWidth: 36,
    textAlign: 'right',
  },
});
