import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import LineTrend from '../../components/charts/LineTrend';
import DeltaChip from '../../components/DeltaChip';
import { useSettings } from '../../state/SettingsContext';
import { HistoryEntry, loadHistory, mean, readinessSeries } from '../../utils/history';
import { StatDelta } from '../../utils/stats';
import { formatHeight, formatWeight } from '../../utils/units';
import { colors, spacing } from '../../theme';

export default function OverviewScreen() {
  const { profile, settings, accentColor } = useSettings();
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadHistory().then((h) => active && setHistory(h));
      return () => { active = false; };
    }, []),
  );

  const series = readinessSeries(history).map((p) => p.value);
  const latest = series.length ? series[series.length - 1] : null;
  const prior = series.slice(0, -1);
  const avgPrior = mean(prior);
  const best = series.length ? Math.max(...series) : null;
  const avgAll = mean(series);

  // readiness delta vs prior average (informational overview chip)
  const delta: StatDelta | null =
    latest != null && avgPrior != null && Math.abs(avgPrior) > 1e-6
      ? {
          vsAvg: Math.round(((latest - avgPrior) / Math.abs(avgPrior)) * 100),
          vsRecent: null,
          direction: latest > avgPrior ? 'up' : latest < avgPrior ? 'down' : 'flat',
          good: latest >= avgPrior,
        }
      : null;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <Text style={styles.kicker}>OVERVIEW</Text>
        <Text style={styles.name}>{profile.name?.trim() ? profile.name : 'Athlete'}</Text>

        <View style={styles.profileRow}>
          <ProfileStat label="HEIGHT" value={formatHeight(profile.heightCm, settings.units)} />
          <ProfileStat label="WEIGHT" value={formatWeight(profile.weightKg, settings.units)} />
          <ProfileStat label="SESSIONS" value={String(history.length)} />
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>READINESS TREND</Text>
            {delta && <DeltaChip delta={delta} />}
          </View>

          {latest != null ? (
            <>
              <View style={styles.bigRow}>
                <Text style={[styles.big, { color: accentColor }]}>{latest}</Text>
                <Text style={[styles.bigPct, { color: accentColor }]}>%</Text>
              </View>
              <LineTrend data={series} color={accentColor} min={0} max={100} height={130}
                startLabel={`${series.length} sessions`} endLabel="latest" />
              <View style={styles.miniStats}>
                <MiniStat label="BEST" value={`${best}%`} />
                <MiniStat label="AVERAGE" value={`${avgAll != null ? Math.round(avgAll) : '—'}%`} />
                <MiniStat label="WINDOW" value={`${settings.windowDays}d`} />
              </View>
            </>
          ) : (
            <Text style={styles.empty}>No sessions yet. Analyze a movement to start tracking your readiness over time.</Text>
          )}
        </View>

      </ScrollView>
    </View>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.pStat}>
      <Text style={styles.pStatValue}>{value}</Text>
      <Text style={styles.pStatLabel}>{label}</Text>
    </View>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.mStat}>
      <Text style={styles.mStatValue}>{value}</Text>
      <Text style={styles.mStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },

  kicker: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2.5, marginBottom: spacing.xs },
  name: { color: colors.text, fontSize: 26, fontWeight: '900', letterSpacing: 0.5 },

  profileRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
  },
  pStat: { flex: 1, alignItems: 'center' },
  pStatValue: { color: colors.text, fontSize: 18, fontWeight: '800' },
  pStatLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginTop: 4 },

  card: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2 },

  bigRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.sm },
  big: { fontSize: 52, fontWeight: '900', lineHeight: 56 },
  bigPct: { fontSize: 20, fontWeight: '800', marginTop: 4, marginLeft: 2 },

  miniStats: { flexDirection: 'row', marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  mStat: { flex: 1, alignItems: 'center' },
  mStatValue: { color: colors.text, fontSize: 15, fontWeight: '800' },
  mStatLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 3 },

  empty: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
});
