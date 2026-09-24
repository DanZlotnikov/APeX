import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Text } from './ui/Text';
import { colors, spacing } from '../theme';

interface Props {
  readiness: number;   // 0-100
  label: string;       // 'Good' | 'Fair' | 'Low'
}

const SEGMENTS = 20;

function colorFor(readiness: number): string {
  return readiness >= 80 ? colors.primary : readiness >= 55 ? colors.warning : colors.danger;
}

/**
 * Headline readiness score: a big count-up percentage plus a segmented bar that
 * fills to the score. Uses RN Animated only (no SVG), matching the app's minimal
 * shimmer-track aesthetic from the loading screen.
 */
export default function ReadinessGauge({ readiness, label }: Props) {
  const anim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);
  const color = colorFor(readiness);

  useEffect(() => {
    const id = anim.addListener(({ value }) => setShown(Math.round(value)));
    Animated.timing(anim, {
      toValue: readiness,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    return () => anim.removeListener(id);
  }, [readiness, anim]);

  const litSegments = Math.round((shown / 100) * SEGMENTS);

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>OVERALL READINESS</Text>

      <View style={styles.scoreRow}>
        <Text style={[styles.score, { color }]}>{shown}</Text>
        <Text style={[styles.pct, { color }]}>%</Text>
      </View>

      <View style={styles.segments}>
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.seg,
              { backgroundColor: i < litSegments ? color : colors.surfaceHigh },
            ]}
          />
        ))}
      </View>

      <Text style={[styles.label, { color }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: spacing.md },
  heading: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 2.5 },

  scoreRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.xs },
  score: { fontSize: 64, fontWeight: '900', lineHeight: 68 },
  pct: { fontSize: 24, fontWeight: '800', marginTop: 6, marginLeft: 2 },

  segments: {
    flexDirection: 'row',
    gap: 3,
    marginTop: spacing.sm,
    width: '86%',
  },
  seg: { flex: 1, height: 8, borderRadius: 2 },

  label: { fontSize: 12, fontWeight: '800', letterSpacing: 3, marginTop: spacing.sm },
});
