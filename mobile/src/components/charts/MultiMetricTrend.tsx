import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { colors } from '../../theme';

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  // Dashed stroke for a series that's a *component* of another series on the
  // same chart (e.g. Left/Right feeding into an overall score) — solid is
  // reserved for the "main" series so it reads as the primary line.
  dashed?: boolean;
  // x = position along the shared rep axis — usually a rep index (0, 1, 2, ...)
  // but can be fractional (e.g. 0.5) for a series like rest-time that sits
  // *between* reps rather than on them. y = the series' own raw value,
  // normalized independently of every other series (see below).
  points: { x: number; y: number }[];
}

interface Props {
  series: TrendSeries[];
  height?: number;
}

/**
 * Multi-series sibling to LineTrend.tsx, for comparing several differently-
 * scaled metrics (e.g. a percentage alongside a raw degree value) on one
 * chart. Each series is min-max normalized to its OWN 0-100 range
 * independently — same "hi === lo -> hi = lo + 1" constant-series fallback
 * LineTrend already uses — so every line occupies comparable vertical space
 * regardless of its native units; this is what makes the lines "sit around
 * the same place" instead of one flatlining at the bottom while another
 * dominates the chart.
 *
 * Each series carries its own explicit color (the caller picks them so they
 * never collide with each other or the user's chosen accent) and an optional
 * `dashed` flag for series that are components of another one on the same
 * chart, rather than being told apart by stroke pattern alone.
 */
export default function MultiMetricTrend({ series, height = 160 }: Props) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  const hasData = series.some((s) => s.points.length > 0);

  if (!hasData) {
    return (
      <View style={[styles.empty, { height }]} onLayout={onLayout}>
        <Text style={styles.emptyText}>No data yet</Text>
      </View>
    );
  }

  const pad = { l: 10, r: 10, t: 10, b: 10 };
  const H = height, W = w || 0;
  const iw = Math.max(0, W - pad.l - pad.r);
  const ih = Math.max(0, H - pad.t - pad.b);

  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  const xLo = allX.length ? Math.min(...allX) : 0;
  const xHiRaw = allX.length ? Math.max(...allX) : 1;
  const xHi = xHiRaw === xLo ? xLo + 1 : xHiRaw;
  const xs = (x: number) => pad.l + ((x - xLo) / (xHi - xLo)) * iw;

  return (
    <View>
      <View onLayout={onLayout}>
        {W > 0 && (
          <Svg width={W} height={H}>
            <Line x1={pad.l} y1={pad.t + ih} x2={pad.l + iw} y2={pad.t + ih} stroke={colors.border} strokeWidth={1} />
            {series.map((s) => {
              if (s.points.length === 0) return null;
              const ys_ = s.points.map((p) => p.y);
              const lo = Math.min(...ys_);
              const hiRaw = Math.max(...ys_);
              const hi = hiRaw === lo ? lo + 1 : hiRaw;
              const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
              const pts = s.points.map((p) => `${xs(p.x)},${y(p.y)}`).join(' ');
              const dash = s.dashed ? DASHED : undefined;
              const last = s.points[s.points.length - 1];
              return (
                <React.Fragment key={s.key}>
                  {s.points.length > 1 && (
                    <Polyline
                      points={pts} fill="none" stroke={s.color} strokeWidth={2.5}
                      strokeDasharray={dash} strokeLinejoin="round" strokeLinecap="round"
                    />
                  )}
                  {s.points.map((p, pi) => (
                    <Circle key={pi} cx={xs(p.x)} cy={y(p.y)} r={p === last ? 4.5 : 3} fill={s.color} />
                  ))}
                </React.Fragment>
              );
            })}
          </Svg>
        )}
      </View>

      <View style={styles.legend}>
        {series.filter((s) => s.points.length > 0).map((s) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: s.color }]} />
            <Text style={styles.legendLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const DASHED = '7,5';

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.muted, fontSize: 12 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { color: colors.muted, fontSize: 11, fontWeight: '600' },
});
