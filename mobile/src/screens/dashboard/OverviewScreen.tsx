import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getAthleteById } from '../../api/athletes';
import { getTeamExercises } from '../../api/exercises';
import { AthleteViewModel, TargetExercise } from '../../api/types';
import LineTrend from '../../components/charts/LineTrend';
import DeltaChip from '../../components/DeltaChip';
import { useSettings } from '../../state/SettingsContext';
import { HistoryEntry, loadHistory, mean } from '../../utils/history';
import { ExerciseKey } from '../../utils/exerciseMetrics';
import { StatDelta } from '../../utils/stats';
import { formatHeight, formatWeight } from '../../utils/units';
import { colors, spacing } from '../../theme';

interface Props {
  userId?: string;
  teamId?: string;
  onSelectTask: (target: TargetExercise) => void;
}

export default function OverviewScreen({ userId, teamId, onSelectTask }: Props) {
  const { profile, settings, accentColor } = useSettings();
  const [history, setHistory]         = useState<HistoryEntry[]>([]);
  const [athlete, setAthlete]         = useState<AthleteViewModel | null>(null);
  const [minRepsByKey, setMinRepsByKey] = useState<Partial<Record<ExerciseKey, number>>>({});
  const [loading, setLoading]         = useState(true);

  // Refetch on every focus (not just mount) so completing a task and coming
  // back from AnalysisScreen shows it as done immediately, alongside every
  // other required exercise whether it's done yet or not.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadHistory().then((h) => active && setHistory(h));

      // getAthleteById works with no team (an individual athlete just has no
      // required exercises — see buildViewModel) — only the team-exercise
      // min-reps lookup (used for the task-detail requirement) needs a team.
      if (userId) {
        Promise.all([getAthleteById(userId), teamId ? getTeamExercises(teamId) : Promise.resolve([])])
          .then(([a, exs]) => {
            if (!active) return;
            setAthlete(a);
            const m: Partial<Record<ExerciseKey, number>> = {};
            exs.forEach((e) => { m[e.exerciseKey] = e.minReps; });
            setMinRepsByKey(m);
          })
          .catch((e) => console.warn('Failed to load athlete overview', e))
          .finally(() => { if (active) setLoading(false); });
      } else {
        setLoading(false);
      }

      return () => { active = false; };
    }, [userId, teamId]),
  );

  // Readiness here is the SAME manager-derived number the team dashboard
  // shows: an average across every exercise the manager has required for
  // this athlete today, with anything not yet done counting as 0 rather
  // than being left out of the average (see api/athletes.ts buildViewModel).
  const series    = athlete?.readinessHistory ?? [];
  const latest    = series.length ? series[series.length - 1] : null;
  const prior     = series.slice(0, -1);
  const avgPrior  = mean(prior);
  const best      = series.length ? Math.max(...series) : null;
  const avgAll    = mean(series);

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

  function handleTaskPress(key: ExerciseKey, label: string) {
    onSelectTask({ key, label, requiredRepsByKey: minRepsByKey });
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <Text style={styles.kicker}>OVERVIEW</Text>
        <Text style={styles.name}>{athlete?.name ?? (profile.name?.trim() ? profile.name : 'Athlete')}</Text>

        <View style={styles.profileRow}>
          <ProfileStat label="HEIGHT" value={formatHeight(profile.heightCm, settings.units)} />
          <ProfileStat label="WEIGHT" value={formatWeight(profile.weightKg, settings.units)} />
          <ProfileStat label="SESSIONS" value={String(history.length)} />
        </View>

        {!!athlete?.perExerciseReadiness.length && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>TODAY'S TASKS</Text>
            {athlete.perExerciseReadiness.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => handleTaskPress(t.key, t.label)}
                style={({ pressed }) => [styles.taskRow, pressed && styles.taskRowPressed]}
              >
                <View style={[styles.taskDot, t.testedToday && styles.taskDotDone]} />
                <Text style={styles.taskLabel} numberOfLines={1}>{t.label}</Text>
                <Text style={styles.taskStatus}>
                  {t.testedToday ? `Completed · ${t.readiness}%` : 'Not completed yet'}
                </Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>READINESS TREND</Text>
            {delta && <DeltaChip delta={delta} />}
          </View>

          {loading ? (
            <ActivityIndicator color={accentColor} style={styles.loading} />
          ) : latest != null ? (
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
            <Text style={styles.empty}>No sessions yet. Complete a required exercise to start tracking your readiness.</Text>
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
  cardTitle: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: spacing.xs },

  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  taskRowPressed: { opacity: 0.6 },
  taskDot: {
    width: 9, height: 9, borderRadius: 5,
    borderWidth: 1.5, borderColor: colors.muted,
    marginRight: spacing.sm,
  },
  taskDotDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  taskLabel: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  taskStatus: { color: colors.muted, fontSize: 12, fontWeight: '600', marginRight: spacing.xs },
  chevron: { color: colors.muted, fontSize: 18, fontWeight: '400' },

  bigRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.sm },
  big: { fontSize: 52, fontWeight: '900', lineHeight: 56 },
  bigPct: { fontSize: 20, fontWeight: '800', marginTop: 4, marginLeft: 2 },

  miniStats: { flexDirection: 'row', marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  mStat: { flex: 1, alignItems: 'center' },
  mStatValue: { color: colors.text, fontSize: 15, fontWeight: '800' },
  mStatLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 3 },

  empty: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  loading: { marginTop: spacing.md },
});
