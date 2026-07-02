import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme';

const SCREEN_W = Dimensions.get('window').width;
const MIN_MS = 1500;

interface Props {
  onReady: () => void;
}

export default function LoadingScreen({ onReady }: Props) {
  const pulse = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade in
    Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }).start();

    // Pulsing ring
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ]),
    ).start();

    // Shimmer bar
    Animated.loop(
      Animated.timing(shimmer, { toValue: 1, duration: 1200, useNativeDriver: true }),
    ).start();

    // After minimum display time, fade out then hand off to the next screen.
    // Fading to 0 before unmounting ensures no blank flash when this View is removed.
    const timer = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 350, useNativeDriver: true }).start(() => {
        onReady();
      });
    }, MIN_MS);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 0.1, 0.5] });
  const shimmerX = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [-SCREEN_W * 0.6, SCREEN_W * 1.2],
  });

  return (
    <SafeAreaView style={styles.screen}>
      <Animated.View style={[styles.inner, { opacity: fade }]}>

        {/* pulsing ring + wordmark */}
        <View style={styles.logoWrap}>
          <Animated.View
            style={[styles.ring, { transform: [{ scale: ringScale }], opacity: ringOpacity }]}
          />
          <View style={styles.logoInner}>
            <Text style={styles.wordmark}>APeX</Text>
          </View>
        </View>

        <Text style={styles.label}>ANALYZING MOVEMENT</Text>

        {/* shimmer progress bar */}
        <View style={styles.track}>
          <Animated.View
            style={[styles.shimmerBar, { transform: [{ translateX: shimmerX }] }]}
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
    width: '60%',
    height: 2,
    backgroundColor: colors.surface,
    borderRadius: 1,
    overflow: 'hidden',
  },
  shimmerBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '60%',
    height: 2,
    backgroundColor: colors.primary,
    borderRadius: 1,
    opacity: 0.8,
  },
});
