import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import Svg, { Circle, Line, Path, Polyline } from 'react-native-svg';
import { colors } from '../../theme';

interface Props {
  data: number[];
  color?: string;      // line/marker color (defaults to accent-neutral teal)
  height?: number;
  min?: number;        // optional fixed domain (e.g. 0..100 for readiness)
  max?: number;
  startLabel?: string; // small captions under the ends of the axis
  endLabel?: string;
}

/**
 * Minimal line trend with a soft area fill and an accented last-point marker.
 * Self-measures its width via onLayout so it fills whatever container it's in.
 */
export default function LineTrend({
  data, color = colors.primary, height = 120, min, max, startLabel, endLabel,
}: Props) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  if (!data.length) {
    return (
      <View style={[styles.empty, { height }]} onLayout={onLayout}>
        <Text style={styles.emptyText}>No data yet</Text>
      </View>
    );
  }

  // Axis-label captions need real space below the plot; without them (compact
  // usage, e.g. a table-row sparkline) that space would otherwise just eat
  // into the plot area — at small heights (~28px) the old fixed 12/18 padding
  // left ~-2px of vertical range, flattening every point to the same y and
  // making genuinely varied data render as a straight line.
  const hasAxisLabels = !!(startLabel || endLabel);
  const pad = { l: 10, r: 10, t: hasAxisLabels ? 12 : 6, b: hasAxisLabels ? 18 : 6 };
  const H = height, W = w || 0;
  const iw = Math.max(0, W - pad.l - pad.r);
  const ih = Math.max(0, H - pad.t - pad.b);

  const lo = min != null ? min : Math.min(...data);
  const hiRaw = max != null ? max : Math.max(...data);
  const hi = hiRaw === lo ? lo + 1 : hiRaw;

  const xs = (i: number) => pad.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const ys = (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;

  const pts = data.map((v, i) => `${xs(i)},${ys(v)}`).join(' ');
  const areaPath =
    `M ${xs(0)},${pad.t + ih} ` +
    data.map((v, i) => `L ${xs(i)},${ys(v)}`).join(' ') +
    ` L ${xs(data.length - 1)},${pad.t + ih} Z`;

  const lastX = xs(data.length - 1), lastY = ys(data[data.length - 1]);

  return (
    <View onLayout={onLayout}>
      {W > 0 && (
        <Svg width={W} height={H}>
          {/* baseline */}
          <Line x1={pad.l} y1={pad.t + ih} x2={pad.l + iw} y2={pad.t + ih} stroke={colors.border} strokeWidth={1} />
          {/* soft area */}
          <Path d={areaPath} fill={color} fillOpacity={0.12} />
          {/* line */}
          {data.length > 1 && (
            <Polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {/* last-point marker */}
          <Circle cx={lastX} cy={lastY} r={4.5} fill={color} />
          <Circle cx={lastX} cy={lastY} r={8} fill={color} fillOpacity={0.18} />
        </Svg>
      )}
      {(startLabel || endLabel) && (
        <View style={styles.axis}>
          <Text style={styles.axisText}>{startLabel ?? ''}</Text>
          <Text style={styles.axisText}>{endLabel ?? ''}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.muted, fontSize: 12 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -14, paddingHorizontal: 10 },
  axisText: { color: colors.muted, fontSize: 9, fontWeight: '600' },
});
