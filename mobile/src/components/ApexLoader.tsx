import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSettings } from '../state/SettingsContext';
import { colors } from '../theme';

interface Props {
  /** Diameter of the inner circle — the pulsing ring scales proportionally. */
  size?: number;
}

/**
 * Compact version of LoadingScreen's pulsing-ring "APeX" mark, for inline use
 * anywhere a video is still loading (Processing tab cards, History detail) —
 * same brand animation, just sized to sit inside a card/box instead of
 * filling the whole screen.
 */
export default function ApexLoader({ size = 56 }: Props) {
  const { accentColor } = useSettings();
  const pulse = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    loopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loopRef.current.start();
    return () => loopRef.current?.stop();
  }, [pulse]);

  const ringScale   = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 0.1, 0.5] });
  const ringSize    = Math.round(size * 1.27); // matches LoadingScreen's ring:inner ratio (140/110)

  return (
    <View style={styles.wrap}>
      <Animated.View
        style={[
          styles.ring,
          { borderColor: accentColor, width: ringSize, height: ringSize, borderRadius: ringSize / 2, transform: [{ scale: ringScale }], opacity: ringOpacity },
        ]}
      />
      <View style={[styles.inner, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={[styles.wordmark, { color: accentColor, fontSize: size * 0.24 }]}>APeX</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  inner: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  wordmark: {
    color: colors.primary,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
});
