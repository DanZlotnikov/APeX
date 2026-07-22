import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getTeamAthletes } from '../../api/athletes';
import Toggle from '../../components/Toggle';
import { getEffectiveAssignments, getTeamExercises, setAssignmentOverride, TeamExerciseConfig, updateTeamExercise } from '../../api/exercises';
import { colors, spacing } from '../../theme';
import { EXERCISE_KEYS, EXERCISE_LABELS, EXERCISE_METRICS, ExerciseKey } from '../../utils/exerciseMetrics';

interface Props {
  teamId: string;
}

interface AthleteRow {
  id: string;
  name: string;
}

export default function ExercisesScreen({ teamId }: Props) {
  const [configs,     setConfigs]     = useState<TeamExerciseConfig[] | null>(null);
  const [athletes,    setAthletes]    = useState<AthleteRow[] | null>(null);
  const [assignments, setAssignments] = useState<Map<string, Set<ExerciseKey>>>(new Map());

  useEffect(() => {
    void load();
  }, [teamId]);

  async function load() {
    try {
      const cfgs = await getTeamExercises(teamId);
      setConfigs(cfgs);
      const roster = await getTeamAthletes(teamId);
      const rows = roster.map((a) => ({ id: a.id, name: a.name }));
      setAthletes(rows);
      const assign = await getEffectiveAssignments(teamId, rows.map((a) => a.id), cfgs);
      setAssignments(assign);
    } catch (e) {
      console.warn('Failed to load exercise config', e);
      setConfigs([]);
      setAthletes([]);
    }
  }

  function patchConfig(key: ExerciseKey, patch: Partial<TeamExerciseConfig>) {
    setConfigs((prev) => prev?.map((c) => (c.exerciseKey === key ? { ...c, ...patch } : c)) ?? prev);
    void updateTeamExercise(teamId, key, {
      enabled:    patch.enabled,
      minReps:    patch.minReps,
      thresholds: patch.thresholds,
    }).catch((e) => console.warn('Failed to update exercise config', e));
  }

  async function toggleAssignment(athleteId: string, key: ExerciseKey, next: boolean) {
    setAssignments((prev) => {
      const copy = new Map(prev);
      const set = new Set(copy.get(athleteId) ?? []);
      if (next) set.add(key); else set.delete(key);
      copy.set(athleteId, set);
      return copy;
    });
    try {
      await setAssignmentOverride(athleteId, key, next);
    } catch (e) {
      console.warn('Failed to update assignment', e);
    }
  }

  if (configs === null || athletes === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const enabledExercises = configs.filter((c) => c.enabled);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>EXERCISES</Text>
        {EXERCISE_KEYS.map((key) => {
          const cfg = configs.find((c) => c.exerciseKey === key);
          if (!cfg) return null;
          return <ExerciseCard key={key} config={cfg} onChange={(patch) => patchConfig(key, patch)} />;
        })}

        <Text style={[styles.sectionTitle, { marginTop: spacing.md }]}>ASSIGNMENTS</Text>
        <View style={styles.card}>
          {athletes.length === 0 ? (
            <Text style={styles.emptyText}>No athletes on this team yet.</Text>
          ) : enabledExercises.length === 0 ? (
            <Text style={styles.emptyText}>Enable an exercise above to assign it.</Text>
          ) : (
            <AssignmentTable
              athletes={athletes}
              exercises={enabledExercises}
              assignments={assignments}
              onToggle={toggleAssignment}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ── Exercise card ──────────────────────────────────────────────────────────────

function ExerciseCard({
  config,
  onChange,
}: {
  config: TeamExerciseConfig;
  onChange: (patch: Partial<TeamExerciseConfig>) => void;
}) {
  const metrics = EXERCISE_METRICS[config.exerciseKey];
  const [minReps, setMinReps] = useState(String(config.minReps));
  const [thresholds, setThresholds] = useState<Record<string, string>>(() =>
    Object.fromEntries(metrics.map((m) => [m.id, String(config.thresholds[m.id] ?? m.defaultThreshold)])),
  );

  function commitMinReps() {
    const n = Math.max(1, Math.round(Number(minReps)) || config.minReps);
    setMinReps(String(n));
    if (n !== config.minReps) onChange({ minReps: n });
  }

  function commitThreshold(metricId: string) {
    const raw = thresholds[metricId];
    const n = Number(raw);
    const fallback = metrics.find((m) => m.id === metricId)!.defaultThreshold;
    const value = Number.isFinite(n) ? n : fallback;
    setThresholds((prev) => ({ ...prev, [metricId]: String(value) }));
    if (value !== (config.thresholds[metricId] ?? fallback)) {
      onChange({ thresholds: { ...config.thresholds, [metricId]: value } });
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.exerciseTitle}>{EXERCISE_LABELS[config.exerciseKey]}</Text>
        <Toggle
          value={config.enabled}
          onValueChange={(v) => onChange({ enabled: v })}
        />
      </View>

      {config.enabled && (
        <>
          <View style={styles.divider} />

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>MINIMUM REPS</Text>
            <TextInput
              style={styles.numInput}
              value={minReps}
              onChangeText={setMinReps}
              onBlur={commitMinReps}
              onEndEditing={commitMinReps}
              keyboardType="number-pad"
              selectionColor={colors.primary}
            />
          </View>

          {metrics.map((m) => (
            <View key={m.id} style={styles.metricBlock}>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>{m.label.toUpperCase()} ({m.direction === 'min' ? '≥' : '≤'} {m.unit})</Text>
                <TextInput
                  style={styles.numInput}
                  value={thresholds[m.id]}
                  onChangeText={(v) => setThresholds((prev) => ({ ...prev, [m.id]: v }))}
                  onBlur={() => commitThreshold(m.id)}
                  onEndEditing={() => commitThreshold(m.id)}
                  keyboardType="decimal-pad"
                  selectionColor={colors.primary}
                />
              </View>
              <Text style={styles.research}>{m.research}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

// ── Assignments table ────────────────────────────────────────────────────────────

function AssignmentTable({
  athletes,
  exercises,
  assignments,
  onToggle,
}: {
  athletes: AthleteRow[];
  exercises: TeamExerciseConfig[];
  assignments: Map<string, Set<ExerciseKey>>;
  onToggle: (athleteId: string, key: ExerciseKey, next: boolean) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, styles.thWide]}>ATHLETE</Text>
          {exercises.map((e) => (
            <Text key={e.exerciseKey} style={styles.th}>{EXERCISE_LABELS[e.exerciseKey].toUpperCase()}</Text>
          ))}
        </View>
        {athletes.map((a) => (
          <View key={a.id} style={styles.tableRow}>
            <Text style={[styles.td, styles.thWide]} numberOfLines={1}>{a.name}</Text>
            {exercises.map((e) => {
              const checked = assignments.get(a.id)?.has(e.exerciseKey) ?? false;
              return (
                <Pressable
                  key={e.exerciseKey}
                  style={styles.checkboxCell}
                  onPress={() => onToggle(a.id, e.exerciseKey, !checked)}
                  hitSlop={8}
                >
                  <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                    {checked && <Text style={styles.checkboxMark}>✓</Text>}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bg },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },

  sectionTitle: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 2 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exerciseTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 2 },

  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  fieldLabel: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, flex: 1 },
  numInput: {
    width: 70,
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  metricBlock: { gap: 3, marginTop: 2 },
  research: { color: colors.muted, fontSize: 10, fontWeight: '500', lineHeight: 14 },

  emptyText: { color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.sm },

  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
    marginBottom: 2,
  },
  th: { width: 90, color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1, textAlign: 'center' },
  thWide: { width: 130, textAlign: 'left' },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(28,46,64,0.5)',
    paddingVertical: 10,
  },
  td: { color: colors.text, fontSize: 13, fontWeight: '700' },
  checkboxCell: { width: 90, alignItems: 'center', justifyContent: 'center' },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { color: colors.bg, fontSize: 13, fontWeight: '900' },
});
