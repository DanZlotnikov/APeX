import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import LineTrend from '../../../components/charts/LineTrend';
import { AthleteViewModel } from '../../../api/types';
import { colors, spacing } from '../../../theme';
import { PipelineExerciseKey } from '../../../utils/pipelineExercise';
import { readinessColor } from '../../../utils/readiness';

export interface ExerciseColumn {
  key: PipelineExerciseKey;
  label: string;
}

// 'ranked' colors readiness/trend by the shared green/amber/red bands (used
// to judge and compare athletes). 'neutral' renders everything in one blue —
// for the injury table, where the athletes aren't being ranked against
// anything, just inspected.
type ColorMode = 'ranked' | 'neutral';
const NEUTRAL_BLUE = '#3B82F6';

function cellColor(value: number | null, colorMode: ColorMode): string {
  if (value == null) return colors.muted;
  return colorMode === 'neutral' ? NEUTRAL_BLUE : readinessColor(value);
}

interface Props {
  athletes: AthleteViewModel[];
  exerciseColumns: ExerciseColumn[];
  onSelectAthlete: (athlete: AthleteViewModel) => void;
  title?: string;
  colorMode?: ColorMode;
}

// Only surface a value once that exercise's required sets are fully
// completed today — no partial credit for an incomplete set, no falling
// back to an older session's score (see supabase/migrations/022_routine_sets.sql).
function exerciseValue(athlete: AthleteViewModel, key: PipelineExerciseKey): number | null {
  const e = athlete.perExerciseReadiness.find((ex) => ex.key === key);
  return e?.completedToday ? e.readiness : null;
}

export default function AthleteMonitoringTable({
  athletes, exerciseColumns, onSelectAthlete, title = 'ATHLETE MONITORING', colorMode = 'ranked',
}: Props) {
  const { width } = useWindowDimensions();
  const wide = width >= 600;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {wide ? (
        <TableLayout athletes={athletes} exerciseColumns={exerciseColumns} onSelectAthlete={onSelectAthlete} colorMode={colorMode} />
      ) : (
        <CardLayout athletes={athletes} exerciseColumns={exerciseColumns} onSelectAthlete={onSelectAthlete} colorMode={colorMode} />
      )}
    </View>
  );
}

function TableLayout({ athletes, exerciseColumns, onSelectAthlete, colorMode = 'ranked' }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, styles.thWide]}>ATHLETE</Text>
          {exerciseColumns.map((c) => (
            <Text key={c.key} style={styles.th}>{c.label.toUpperCase()}</Text>
          ))}
          <Text style={styles.th}>READINESS</Text>
          <Text style={styles.th}>TREND</Text>
          <Text style={styles.timeHeader}>LAST TEST</Text>
          <Text style={styles.th}> </Text>
        </View>
        {athletes.map((a) => (
          <TableRow key={a.id} athlete={a} exerciseColumns={exerciseColumns} onPress={() => onSelectAthlete(a)} colorMode={colorMode} />
        ))}
      </View>
    </ScrollView>
  );
}

function TableRow({
  athlete: a,
  exerciseColumns,
  onPress,
  colorMode,
}: {
  athlete: AthleteViewModel;
  exerciseColumns: ExerciseColumn[];
  onPress: () => void;
  colorMode: ColorMode;
}) {
  const actionLabel = a.status === 'green' ? 'View' : 'Review';
  const actionColor = a.status === 'green' ? colors.muted : colors.primary;
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [styles.tableRow, (hovered || pressed) && styles.tableRowActive]}
    >
      <Text style={[styles.td, styles.thWide, styles.nameText]} numberOfLines={1}>{a.name}</Text>
      {exerciseColumns.map((c) => {
        const v = exerciseValue(a, c.key);
        return (
          <Text key={c.key} style={[styles.td, styles.tdCenter, { color: cellColor(v, colorMode) }]}>
            {v == null ? '—' : `${v}%`}
          </Text>
        );
      })}
      <Text style={[styles.td, styles.tdCenter, styles.readinessText, { color: cellColor(a.readiness, colorMode) }]}>
        {a.readiness}%
      </Text>
      <View style={styles.trendCell}>
        <LineTrend data={a.readinessHistory} color={cellColor(a.readiness, colorMode)} min={50} max={100} height={28} />
      </View>
      <Text style={[styles.td, styles.timeText]} numberOfLines={1}>
        {a.lastTestTime ? `${a.lastTestDate} ${a.lastTestTime}` : a.lastTestDate}
      </Text>
      <View style={styles.actionBtn}>
        <Text style={[styles.actionText, { color: actionColor }]}>{actionLabel}</Text>
      </View>
    </Pressable>
  );
}

function CardLayout({ athletes, exerciseColumns, onSelectAthlete, colorMode = 'ranked' }: Props) {
  return (
    <View style={styles.cardList}>
      {athletes.map((a) => (
        <AthleteCard key={a.id} athlete={a} exerciseColumns={exerciseColumns} onPress={() => onSelectAthlete(a)} colorMode={colorMode} />
      ))}
    </View>
  );
}

function AthleteCard({
  athlete: a,
  exerciseColumns,
  onPress,
  colorMode,
}: {
  athlete: AthleteViewModel;
  exerciseColumns: ExerciseColumn[];
  onPress: () => void;
  colorMode: ColorMode;
}) {
  const actionLabel = a.status === 'green' ? 'View' : 'Review';
  const actionColor = a.status === 'green' ? colors.muted : colors.primary;
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [styles.athleteCard, (hovered || pressed) && styles.athleteCardActive]}
    >
      <View style={styles.cardTopRow}>
        <Text style={styles.cardName} numberOfLines={1}>{a.name}</Text>
      </View>

      <View style={styles.readinessRow}>
        <MetaCell label="READINESS" value={`${a.readiness}%`} valueColor={cellColor(a.readiness, colorMode)} big />
      </View>

      <View style={styles.cardMetaRow}>
        {exerciseColumns.map((c) => {
          const v = exerciseValue(a, c.key);
          return (
            <MetaCell
              key={c.key}
              label={c.label.toUpperCase()}
              value={v == null ? '—' : `${v}%`}
              valueColor={cellColor(v, colorMode)}
            />
          );
        })}
      </View>

      <View style={styles.cardTrendRow}>
        <LineTrend data={a.readinessHistory} color={cellColor(a.readiness, colorMode)} min={50} max={100} height={32} />
      </View>

      <View style={styles.cardBottomRow}>
        <Text style={styles.lastTest}>
          {a.lastTestTime ? `${a.lastTestDate} · ${a.lastTestTime}` : a.lastTestDate}
        </Text>
        <View style={styles.actionBtn}>
          <Text style={[styles.actionText, { color: actionColor }]}>{actionLabel}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function MetaCell({
  label, value, valueColor, big,
}: { label: string; value: string; valueColor: string; big?: boolean }) {
  return (
    <View style={[styles.metaCell, big && styles.metaCellBig]}>
      <Text style={[styles.metaValue, big && styles.metaValueBig, { color: valueColor }]}>{value}</Text>
      <Text style={styles.metaLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  title: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: spacing.md,
  },

  // ── table layout ──────────────────────────────────────────────────────────
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
    marginBottom: 2,
  },
  th: {
    width: 80,
    color: colors.muted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  thWide: { width: 130, textAlign: 'left' },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(28,46,64,0.5)',
    paddingVertical: 10,
  },
  tableRowActive: {
    backgroundColor: 'rgba(0,212,188,0.06)',
    borderBottomColor: 'rgba(0,212,188,0.35)',
  },
  td: {
    width: 80,
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  tdCenter: { textAlign: 'center' },
  nameText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  readinessText: { fontWeight: '800' },
  trendCell: { width: 90, height: 28, justifyContent: 'center' },
  timeHeader: { width: 110, color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, textAlign: 'left' },
  timeText: { width: 110, color: colors.muted, fontSize: 11, textAlign: 'left' },
  actionBtn: {
    width: 68,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  actionText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  // ── card layout ───────────────────────────────────────────────────────────
  cardList: { gap: 10 },
  athleteCard: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 10,
  },
  athleteCardActive: {
    backgroundColor: 'rgba(0,212,188,0.05)',
    borderColor: 'rgba(0,212,188,0.45)',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
    marginRight: spacing.sm,
  },
  cardMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cardTrendRow: { paddingHorizontal: 4 },
  readinessRow: { flexDirection: 'row' },
  metaCell: {
    flexGrow: 1,
    flexBasis: '30%',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
  },
  metaCellBig: {
    paddingVertical: 14,
  },
  metaValue: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 18,
  },
  metaValueBig: {
    fontSize: 28,
    lineHeight: 32,
  },
  metaLabel: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 2,
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lastTest: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
  },
});
