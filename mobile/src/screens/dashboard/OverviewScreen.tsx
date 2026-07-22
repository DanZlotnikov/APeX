import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getAthleteById } from '../../api/athletes';
import { getTeamExercises } from '../../api/exercises';
import { getRoutine, RoutineSetting } from '../../api/routine';
import { getSessionHistory, SessionHistoryEntry } from '../../api/sessions';
import { AthleteViewModel, ExerciseReadiness, TargetExercise } from '../../api/types';
import { VideoJob } from '../../api/videoJobs';
import LineTrend from '../../components/charts/LineTrend';
import DeltaChip from '../../components/DeltaChip';
import { useSettings } from '../../state/SettingsContext';
import { useVideoJobsContext } from '../../state/VideoJobsContext';
import { mean } from '../../utils/history';
import { ExerciseKey } from '../../utils/exerciseMetrics';
import { exerciseLabel, readinessPctFromAnalysis } from '../../utils/pipelineExercise';
import { computeRoutineProgress } from '../../utils/routineProgress';
import { StatDelta } from '../../utils/stats';
import { formatHeight, formatWeight } from '../../utils/units';
import { colors, spacing } from '../../theme';

// Today's Tasks redesign for the async pipeline (HANDOFF_video_pipeline.md
// section 4 item 8): a task can no longer just be "done"/"not done" from
// sessions alone, since a save now happens well after recording. Layering
// today's live video_jobs (matched by target_exercise_key) on top of the
// DB-driven ExerciseReadiness gives the in-between states — pending while
// the pipeline runs, resolved to met/mismatched the moment the job
// completes (per the handoff, this resolves on job completion, not on the
// athlete tapping Save in the Processing tab).
type TaskStatus =
  | { kind: 'done'; readinessPct: number | null }
  | { kind: 'pending' }
  | { kind: 'mismatch'; actualLabel: string }
  | { kind: 'failed' }
  | { kind: 'not_done' };

function resolveTaskStatus(key: ExerciseKey, dbState: ExerciseReadiness, todaysJobs: VideoJob[]): TaskStatus {
  const job = todaysJobs.find((j) => j.targetExerciseKey === key);
  if (job) {
    if (job.status === 'queued' || job.status === 'processing') return { kind: 'pending' };
    if (job.status === 'failed') return { kind: 'failed' };
    if (job.status === 'completed') {
      const legacy = job.analysis?.analyses?.legacy_metrics;
      const readinessPct = readinessPctFromAnalysis(job.analysis);
      const actualKey = legacy?.legacy_exercise_key ?? job.exerciseType;
      // "Readiness" is the balance+ROM average, not the legacy formula's
      // score — see migration 016 / pipelineExercise's readinessPctFromAnalysis.
      if (actualKey === key) return { kind: 'done', readinessPct: readinessPct != null ? Math.round(readinessPct) : null };
      return { kind: 'mismatch', actualLabel: exerciseLabel(actualKey) };
    }
  }
  // dbState.readiness reads sessions.readiness_score, which save_video_job
  // (migration 011) now populates from balance too, so this is consistent
  // with the 'completed'-but-unsaved branch above.
  if (dbState.testedToday) return { kind: 'done', readinessPct: dbState.readiness };
  return { kind: 'not_done' };
}

interface Props {
  userId?: string;
  teamId?: string;
  onSelectTask: (target: TargetExercise) => void;
}

export default function OverviewScreen({ userId, teamId, onSelectTask }: Props) {
  const { profile, settings, accentColor } = useSettings();
  const [sessions, setSessions]       = useState<SessionHistoryEntry[]>([]);
  const [routine, setRoutine]         = useState<RoutineSetting[]>([]);
  const [athlete, setAthlete]         = useState<AthleteViewModel | null>(null);
  const [minRepsByKey, setMinRepsByKey] = useState<Partial<Record<ExerciseKey, number>>>({});
  const [loading, setLoading]         = useState(true);
  const { jobs } = useVideoJobsContext();

  const todayUtc = new Date().toISOString().slice(0, 10);
  const todaysJobs = jobs.filter((j) => !!j.targetExerciseKey && j.recordedAt.startsWith(todayUtc));
  const todaysSessions = sessions.filter((s) => s.recordedAt.startsWith(todayUtc));
  const todaysCompletedJobs = jobs.filter((j) => j.status === 'completed' && j.recordedAt.startsWith(todayUtc));
  const routineProgress = computeRoutineProgress(routine, todaysSessions, todaysCompletedJobs);

  // Refetch on every focus (not just mount) so completing a task and coming
  // back from AnalysisScreen shows it as done immediately, alongside every
  // other required exercise whether it's done yet or not.
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
          <ProfileStat label="SESSIONS" value={String(sessions.length)} />
        </View>

        {!!athlete?.perExerciseReadiness.length && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>TODAY'S TASKS</Text>
            {athlete.perExerciseReadiness.map((t) => {
              const status = resolveTaskStatus(t.key, t, todaysJobs);
              return (
                <Pressable
                  key={t.key}
                  onPress={() => handleTaskPress(t.key, t.label)}
                  style={({ pressed }) => [styles.taskRow, pressed && styles.taskRowPressed]}
                >
                  <View style={[
                    styles.taskDot,
                    status.kind === 'done' && styles.taskDotDone,
                    status.kind === 'pending' && styles.taskDotPending,
                    (status.kind === 'mismatch' || status.kind === 'failed') && styles.taskDotAlert,
                  ]} />
                  <Text style={styles.taskLabel} numberOfLines={1}>{t.label}</Text>
                  <Text style={styles.taskStatus} numberOfLines={1}>
                    {status.kind === 'done' && (status.readinessPct != null ? `Completed · ${status.readinessPct}%` : 'Completed')}
                    {status.kind === 'pending' && 'Pending…'}
                    {status.kind === 'mismatch' && `Recorded ${status.actualLabel} instead`}
                    {status.kind === 'failed' && 'Processing failed'}
                    {status.kind === 'not_done' && 'Not completed yet'}
                  </Text>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              );
            })}
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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>TODAY'S ROUTINE</Text>
          {routineProgress.requiredCount === 0 ? (
            <Text style={styles.empty}>No exercises in your routine yet. Set one up in the Routine tab.</Text>
          ) : (
            <>
              <View style={styles.bigRow}>
                <Text style={[styles.big, { color: accentColor }]}>{routineProgress.completedPct}</Text>
                <Text style={[styles.bigPct, { color: accentColor }]}>%</Text>
              </View>
              <Text style={styles.routineSub}>
                {routineProgress.completedCount} of {routineProgress.requiredCount} exercises complete today
              </Text>

              <View style={styles.routineHeaderRow}>
                <Text style={[styles.routineHeaderCell, styles.routineExerciseCol]}>EXERCISE</Text>
                <Text style={[styles.routineHeaderCell, styles.routineRepsCol]}>REPS</Text>
                <Text style={[styles.routineHeaderCell, styles.routineReadinessCol]}>READINESS</Text>
              </View>
              {routineProgress.rows.map((row) => (
                <View key={row.exerciseType} style={styles.routineRow}>
                  <View style={styles.routineExerciseCol}>
                    <View style={[styles.taskDot, row.completed && styles.taskDotDone]} />
                    <Text style={styles.routineExerciseLabel} numberOfLines={1}>{row.label}</Text>
                  </View>
                  <Text style={[styles.routineCell, styles.routineRepsCol]}>{row.completedReps}/{row.targetReps}</Text>
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
  taskDotPending: { backgroundColor: colors.warning, borderColor: colors.warning },
  taskDotAlert: { backgroundColor: colors.danger, borderColor: colors.danger },
  taskLabel: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  taskStatus: { color: colors.muted, fontSize: 12, fontWeight: '600', marginRight: spacing.xs },
  chevron: { color: colors.muted, fontSize: 18, fontWeight: '400' },

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
  routineRepsCol: { flex: 1, textAlign: 'center' },
  routineReadinessCol: { flex: 1, textAlign: 'right' },

  miniStats: { flexDirection: 'row', marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  mStat: { flex: 1, alignItems: 'center' },
  mStatValue: { color: colors.text, fontSize: 15, fontWeight: '800' },
  mStatLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 3 },

  empty: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  loading: { marginTop: spacing.md },
});
