import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, SafeAreaView, StyleSheet, View } from 'react-native';
import { Text } from '../components/ui/Text';
import { colors, spacing } from '../theme';

const SCREEN_W = Dimensions.get('window').width;
// Track is 60% of screen. Bar is 38% of track — sweeps end-to-end with no dead gap.
const TRACK_W = SCREEN_W * 0.6;
const BAR_W = TRACK_W * 0.38;

interface Props {
  /** Flip to true when MediaPipe is ready; triggers the fade-out. */
  ready: boolean;
  /** Called after the fade-out animation completes. */
  onDismissed: () => void;
}

export default function LoadingScreen({ ready, onDismissed }: Props) {
  const pulse = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  // Keep stable refs for the loop handles so we can stop them on unmount.
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  const shimmerLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }).start();

    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    pulseLoop.current.start();

    // Shimmer sweeps from just off-screen left to just off-screen right with no pause.
    // outputRange covers exactly one bar-width beyond each track edge so the bar
    // is always partially visible during the middle of the sweep and invisible only
    // at the instant of reset — which happens off-screen and is imperceptible.
    shimmerLoop.current = Animated.loop(
      Animated.timing(shimmer, { toValue: 1, duration: 1100, useNativeDriver: true }),
    );
    shimmerLoop.current.start();

    return () => {
      pulseLoop.current?.stop();
      shimmerLoop.current?.stop();
    };
  }, []);

  // When MediaPipe signals ready, fade this screen out then hand off.
  useEffect(() => {
    if (!ready) return;
    pulseLoop.current?.stop();
    shimmerLoop.current?.stop();
    Animated.timing(fade, { toValue: 0, duration: 350, useNativeDriver: true }).start(() => {
      onDismissed();
    });
  }, [ready]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 0.1, 0.5] });
  // Sweep: bar enters from left edge, exits at right edge — no invisible dwell period.
  const shimmerX = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [-BAR_W, TRACK_W],
  });

  return (
    <SafeAreaView style={styles.screen}>
      <Animated.View style={[styles.inner, { opacity: fade }]}>

        <View style={styles.logoWrap}>
          <Animated.View
            style={[styles.ring, { transform: [{ scale: ringScale }], opacity: ringOpacity }]}
          />
          <View style={styles.logoInner}>
            <Text style={styles.wordmark}>APeX</Text>
          </View>
        </View>

        <Text style={styles.label}>ANALYZING MOVEMENT</Text>

        <View style={[styles.track, { width: TRACK_W }]}>
          <Animated.View
            style={[styles.shimmerBar, { width: BAR_W, transform: [{ translateX: shimmerX }] }]}
          />
        </View>

      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },

  logoWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl },
  ring: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  logoInner: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  wordmark: {
    color: colors.primary,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 4,
  },

  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 3,
    marginBottom: spacing.xl,
  },

  track: {
    height: 2,
    backgroundColor: colors.surface,
    borderRadius: 1,
    overflow: 'hidden',
  },
  shimmerBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 2,
    backgroundColor: colors.primary,
    borderRadius: 1,
    opacity: 0.85,
  },
});
