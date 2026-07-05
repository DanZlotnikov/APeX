import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AthleteViewModel as MockAthlete } from '../../../api/types';
import { colors, spacing } from '../../../theme';
import AthleteStatusBadge from './AthleteStatusBadge';

interface Props {
  athletes: MockAthlete[];
  onSelectAthlete: (athlete: MockAthlete) => void;
}

const IMBALANCE_THRESHOLD = 15;

export default function AthleteMonitoringTable({ athletes, onSelectAthlete }: Props) {
  const { width } = useWindowDimensions();
  const wide = width >= 600;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>ATHLETE MONITORING</Text>
      {wide ? (
        <TableLayout athletes={athletes} onSelectAthlete={onSelectAthlete} />
      ) : (
        <CardLayout athletes={athletes} onSelectAthlete={onSelectAthlete} />
      )}
    </View>
  );
}

function TableLayout({ athletes, onSelectAthlete }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        <View style={styles.tableHeader}>
          {['ATHLETE', 'STATUS', 'READINESS', 'L/R', 'LAST TEST', 'MISSING', ''].map((h) => (
            <Text key={h} style={[styles.th, h === 'ATHLETE' ? styles.thWide : undefined]}>{h}</Text>
          ))}
        </View>
        {athletes.map((a) => (
          <TableRow key={a.id} athlete={a} onPress={() => onSelectAthlete(a)} />
        ))}
      </View>
    </ScrollView>
  );
}

function TableRow({ athlete: a, onPress }: { athlete: MockAthlete; onPress: () => void }) {
  const lrHigh = a.lrImbalance >= IMBALANCE_THRESHOLD;
  const actionLabel = a.status === 'green' ? 'View' : 'Review';
  const actionColor = a.status === 'green' ? colors.muted : '#F5A623';

  return (
    <View style={styles.tableRow}>
      <Text style={[styles.td, styles.thWide, styles.nameText]} numberOfLines={1}>{a.name}</Text>
      <View style={[styles.cell, styles.cellCenter]}>
        <AthleteStatusBadge status={a.status} />
      </View>
      <Text style={[styles.td, styles.tdCenter, styles.readinessText]}>{a.readiness}%</Text>
      <Text style={[styles.td, styles.tdCenter, { color: lrHigh ? '#F5A623' : colors.muted }]}>{a.lrImbalance}%</Text>
      <Text style={[styles.td, styles.timeText]} numberOfLines={1}>
        {a.lastTestTime ? `${a.lastTestDate} ${a.lastTestTime}` : a.lastTestDate}
      </Text>
      <Text style={[styles.td, styles.tdCenter, { color: a.missingTests > 0 ? '#FF3B30' : colors.muted }]}>
        {a.missingTests}
      </Text>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.6 }]}>
        <Text style={[styles.actionText, { color: actionColor }]}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

function CardLayout({ athletes, onSelectAthlete }: Props) {
  return (
    <View style={styles.cardList}>
      {athletes.map((a) => (
        <AthleteCard key={a.id} athlete={a} onPress={() => onSelectAthlete(a)} />
      ))}
    </View>
  );
}

function AthleteCard({ athlete: a, onPress }: { athlete: MockAthlete; onPress: () => void }) {
  const lrHigh = a.lrImbalance >= IMBALANCE_THRESHOLD;
  const actionLabel = a.status === 'green' ? 'View' : 'Review';
  const actionColor = a.status === 'green' ? colors.muted : '#F5A623';

  return (
    <View style={styles.athleteCard}>
      <View style={styles.cardTopRow}>
        <Text style={styles.cardName} numberOfLines={1}>{a.name}</Text>
        <AthleteStatusBadge status={a.status} />
      </View>

      <View style={styles.cardMetaRow}>
        <MetaCell label="READINESS" value={`${a.readiness}%`} valueColor={colors.text} />
        <MetaCell label="L/R" value={`${a.lrImbalance}%`} valueColor={lrHigh ? '#F5A623' : colors.muted} />
        <MetaCell
          label="MISSING"
          value={String(a.missingTests)}
          valueColor={a.missingTests > 0 ? '#FF3B30' : colors.muted}
        />
      </View>

      <View style={styles.cardBottomRow}>
        <Text style={styles.lastTest}>
          {a.lastTestTime ? `${a.lastTestDate} · ${a.lastTestTime}` : a.lastTestDate}
        </Text>
        <Pressable onPress={onPress} style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.6 }]}>
          <Text style={[styles.actionText, { color: actionColor }]}>{actionLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MetaCell({ label, value, valueColor }: { label: string; value: string; valueColor: string }) {
  return (
    <View style={styles.metaCell}>
      <Text style={[styles.metaValue, { color: valueColor }]}>{value}</Text>
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
  td: {
    width: 80,
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  tdCenter: { textAlign: 'center' },
  cell: { width: 80, alignItems: 'center' as const },
  cellCenter: { justifyContent: 'center' as const },
  nameText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  readinessText: { color: colors.text, fontWeight: '800' },
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
    gap: spacing.sm,
  },
  metaCell: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
  },
  metaValue: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 18,
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
