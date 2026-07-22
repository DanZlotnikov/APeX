import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

interface Props {
  visible: boolean;
  // Comfortably larger than whatever's inside — an animated CEILING, not a
  // forced exact height. See ProcessingBanner's header comment for why:
  // animating to a measured exact height (via onLayout) previously clipped
  // the banner's own content due to a re-render/animation race. maxHeight
  // sidesteps that entirely since it only ever caps, never forces, height.
  maxHeight?: number;
  durationMs?: number;
  children: React.ReactNode;
}

/**
 * Shared collapse/expand wrapper for the small pill-banners stacked above
 * the dashboard's tab content (ProcessingBanner, UploadFailedBanner) — a
 * bare conditional `return null` on any of them causes everything below to
 * jump the instant it mounts/unmounts, since they're rendered directly
 * above the tab content rather than as an overlay. This keeps that
 * transition smooth instead.
 */
export default function CollapsibleBanner({ visible, maxHeight = 80, durationMs = 220, children }: Props) {
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: durationMs,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false, // animating height can't use the native driver
    }).start();
  }, [visible, progress, durationMs]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        overflow: 'hidden',
        maxHeight: progress.interpolate({ inputRange: [0, 1], outputRange: [0, maxHeight] }),
      }}
    >
      {children}
    </Animated.View>
  );
}
