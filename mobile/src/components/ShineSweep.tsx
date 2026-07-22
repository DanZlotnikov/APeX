import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

interface Props {
  // Bump this to play the sweep again — a counter, not a boolean, so
  // re-triggering on the same value (e.g. 1 -> 2 -> back to 1 -> 2) still
  // replays it rather than being a no-op React prop "change."
  trigger: number;
  color?: string;
}

const SWEEP_MS = 650;
// Generously wider than any realistic banner (which spans screen width
// minus margins, ~300-430pt on real phones) rather than measuring the
// parent via onLayout — a fixed, deliberately-oversized range can only
// ever sweep slightly further than strictly necessary at the very end,
// never come up short or need a second render pass to correct itself once
// a real measurement lands (see CollapsibleBanner's own header comment for
// why a prior measure-then-apply approach in this exact banner stack
// caused a real clipping bug).
const START_X = -140;
const END_X = 520;

/**
 * A single left-to-right diagonal light sweep across whatever it's placed
 * inside (the parent must have overflow:'hidden' so this gets clipped to
 * its bounds). Fires once per `trigger` change and then stops — NOT a
 * looping shimmer. A continuous shimmer reads as a loading skeleton
 * (Facebook/LinkedIn-style placeholder content); this is meant to read as
 * a discrete "something just happened" acknowledgment instead, which is
 * why ProcessingBanner only bumps `trigger` when the processing count
 * goes UP, never down.
 */
export default function ShineSweep({ trigger, color = 'rgba(255,255,255,0.35)' }: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return; // don't play on initial mount with trigger=0 — only on real bumps
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: SWEEP_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [trigger, progress]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [START_X, END_X] });
  // Fades in, holds briefly, fades out — softer than a hard-edged band.
  const opacity = progress.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 1, 1, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.band,
        { backgroundColor: color, opacity, transform: [{ translateX }, { rotate: '20deg' }] },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    top: -20,
    bottom: -20,
    width: 50,
  },
});
