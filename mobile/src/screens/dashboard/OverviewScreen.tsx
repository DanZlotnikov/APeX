import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../components/ui/Text';
import { getAthleteById } from '../../api/athletes';
import { getRoutine, RoutineExercise } from '../../api/routine';
import { getSessionHistory, SessionHistoryEntry } from '../../api/sessions';
import { AthleteViewModel } from '../../api/types';
import LineTrend from '../../components/charts/LineTrend';
import DeltaChip from '../../components/DeltaChip';
import { useSettings } from '../../state/SettingsContext';
import { useVideoJobsContext } from '../../state/VideoJobsContext';
import { mean } from '../../utils/history';
import { computeRoutineProgress } from '../../utils/routineProgress';
import { StatDelta } from '../../utils/stats';
import { formatHeight, formatWeight } from '../../utils/units';
import { colors, spacing } from '../../theme';

interface Props {
  userId?: string;
}

export default function OverviewScreen({ userId }: Props) {
  const navigation = useNavigation<any>();
  const { profile, settings, accentColor } = useSettings();
  const [sessions, setSessions]       = useState<SessionHistoryEntry[]>([]);
  const [routine, setRoutine]         = useState<RoutineExercise[]>([]);
  const [athlete, setAthlete]         = useState<AthleteViewModel | null>(null);
  const [loading, setLoading]         = useState(true);
  const { jobs } = useVideoJobsContext();

  const todayUtc = new Date().toISOString().slice(0, 10);
  const todaysSessions = sessions.filter((s) => s.recordedAt.startsWith(todayUtc));
  const todaysCompletedJobs = jobs.filter((j) => j.status === 'completed' && j.recordedAt.startsWith(todayUtc));
  const routineProgress = computeRoutineProgress(routine, todaysSessions, todaysCompletedJobs);

  // Refetch on every focus (not just mount) so completing an exercise and
  // coming back from AnalysisScreen updates today's routine progress and
  // readiness trend immediately.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (userId) {
        getSessionHistory(userId)
          .then((s) => active && setSessions(s))
          .catch((e) => console.warn('[APeX] Failed to load session history:', e));
        getRoutine(userId)
          .then((r) => active && setRoutine(r))
          .catch((e) => console.warn('[APeX] Failed to load routine:', e));
      } else {
        setSessions([]);
        setRoutine([]);
      }

      if (userId) {
        getAthleteById(userId)
          .then((a) => { if (active) setAthlete(a); })
          .catch((e) => console.warn('Failed to load athlete overview', e))
          .finally(() => { if (active) setLoading(false); });
      } else {
        setLoading(false);
      }

      return () => { active = false; };
    }, [userId]),
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

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <Text style={styles.kicker}>OVERVIEW</Text>
        <Text style={styles.name}>{athlete?.name ?? (profile.name?.trim() ? profile.name : 'Athlete')}</Text>

        <View style={styles.profileRow}>
          <ProfileStat label="HEIGHT" value={formatHeight(profile.heightCm, settings.units)} />
          <ProfileStat label="WEIGHT" value={formatWeight(profile.weightKg, settings.units)} />
          <ProfileStat label="SESSIONS" value={String(sessions.length)} />
        </View>

        {/* Tap through to the full per-exercise Readiness screen
            (screens/dashboard/ReadinessScreen.tsx) — this card itself is
            unchanged, just now an entry point. */}
        <Pressable
          onPress={() => navigation.navigate('Readiness')}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        >
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>READINESS TREND</Text>
            <View style={styles.cardHeadRight}>
              {delta && <DeltaChip delta={delta} />}
              <Text style={styles.cardChevron}>›</Text>
            </View>
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
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>TODAY'S ROUTINE</Text>
          {routineProgress.requiredCount === 0 ? (
            <Text style={styles.empty}>No exercises in your routine yet. Set one up in the Routine tab.</Text>
          ) : (
            <>
              <View style={styles.bigRow}>
                <Text style={[
                  styles.big,
                  { color: routineProgress.completedCount >= routineProgress.requiredCount ? accentColor : colors.text },
                ]}>
                  {routineProgress.completedCount}
                </Text>
                <Text style={[styles.big, { color: accentColor }]}>/{routineProgress.requiredCount}</Text>
              </View>
              <Text style={styles.routineSub}>exercises completed today</Text>

              <View style={styles.routineHeaderRow}>
                <Text style={[styles.routineHeaderCell, styles.routineExerciseCol]}>EXERCISE</Text>
                <Text style={[styles.routineHeaderCell, styles.routineSetsCol]}>SETS</Text>
                <Text style={[styles.routineHeaderCell, styles.routineReadinessCol]}>READINESS</Text>
              </View>
              {routineProgress.rows.map((row) => (
                <View key={row.exerciseType} style={styles.routineRow}>
                  <View style={styles.routineExerciseCol}>
                    <View style={[styles.taskDot, row.completed && { backgroundColor: accentColor, borderColor: accentColor }]} />
                    <Text style={styles.routineExerciseLabel} numberOfLines={1}>{row.label}</Text>
                  </View>
                  <Text style={[styles.routineCell, styles.routineSetsCol]}>{row.completedSets}/{row.requiredSets}</Text>
                  <Text style={[styles.routineCell, styles.routineReadinessCol]}>
                    {row.readinessPct != null ? `${row.readinessPct}%` : '—'}
                  </Text>
                </View>
              ))}
            </>
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
  cardPressed: { opacity: 0.7 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardChevron: { color: colors.muted, fontSize: 18, fontWeight: '400' },
  cardTitle: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: spacing.xs },

  taskDot: {
    width: 9, height: 9, borderRadius: 5,
    borderWidth: 1.5, borderColor: colors.muted,
    marginRight: spacing.sm,
  },

  bigRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.sm },
  big: { fontSize: 52, fontWeight: '900', lineHeight: 56 },
  bigPct: { fontSize: 20, fontWeight: '800', marginTop: 4, marginLeft: 2 },

  routineSub: { color: colors.muted, fontSize: 12, fontWeight: '600', marginTop: 2, marginBottom: spacing.sm },
  routineHeaderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border,
  },
  routineHeaderCell: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  routineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  routineCell: { color: colors.text, fontSize: 13, fontWeight: '700' },
  routineExerciseCol: { flex: 2, flexDirection: 'row', alignItems: 'center' },
  routineExerciseLabel: { color: colors.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  routineSetsCol: { flex: 1, textAlign: 'center' },
  routineReadinessCol: { flex: 1, textAlign: 'right' },

  miniStats: { flexDirection: 'row', marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  mStat: { flex: 1, alignItems: 'center' },
  mStatValue: { color: colors.text, fontSize: 15, fontWeight: '800' },
  mStatLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 3 },

  empty: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  loading: { marginTop: spacing.md },
});
