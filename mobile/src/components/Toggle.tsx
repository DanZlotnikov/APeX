import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme';

interface Props {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accentColor?: string;
}

const TRACK_W = 52;
const TRACK_H = 32;
const THUMB_SIZE = 26;
const THUMB_MARGIN = (TRACK_H - THUMB_SIZE) / 2;

// Replaces React Native's built-in Switch: its off-track color isn't fully
// controllable via `trackColor.false` on iOS (that platform leans on a
// separate `ios_backgroundColor` prop for the true off-state background,
// and even then the result is inconsistent) — confirmed in production as
// the cause of the routine screen's "off" toggles rendering as a dark,
// muddy blob regardless of what trackColor was set to, not the intended
// light gray. A plain custom track+thumb has no such native quirk to fight
// — its color is just a style, guaranteed to render exactly as specified
// on every platform. Mirrors RepStepper's own reasoning for replacing a
// native slider earlier in this app.
export default function Toggle({ value, onValueChange, disabled, accentColor = colors.primary }: Props) {
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // animating backgroundColor can't use the native driver
    }).start();
  }, [value, progress]);

  const trackColor = progress.interpolate({ inputRange: [0, 1], outputRange: [colors.toggleOff, accentColor] });
  const thumbTranslateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [THUMB_MARGIN, TRACK_W - THUMB_SIZE - THUMB_MARGIN],
  });

  return (
    <Pressable
      onPress={() => { if (!disabled) onValueChange(!value); }}
      disabled={disabled}
      hitSlop={8}
      style={disabled && styles.disabled}
    >
      <Animated.View style={[styles.track, { backgroundColor: trackColor }]}>
        <Animated.View style={[styles.thumb, { transform: [{ translateX: thumbTranslateX }] }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  disabled: { opacity: 0.5 },
});
