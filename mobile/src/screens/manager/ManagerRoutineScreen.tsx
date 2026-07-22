import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getTeamAthletes } from '../../api/athletes';
import {
  getAssignmentOverrides,
  getTeamRoutine,
  setAssignmentOverride,
  setTeamRoutineExercise,
  TeamRoutineSetting,
} from '../../api/teamRoutine';
import RepStepper from '../../components/RepStepper';
import Toggle from '../../components/Toggle';
import { useSettings } from '../../state/SettingsContext';
import { colors, spacing } from '../../theme';
import { exerciseLabel, PipelineExerciseKey } from '../../utils/pipelineExercise';

interface Props {
  teamId: string;
}

interface AthleteRow {
  id: string;
  name: string;
}

// Manager's "Routine" tab — replaces the old squat/jump/pullup-only
// Exercises tab and its per-metric thresholds (see MANAGER_MODULE_AUDIT.md
// sections 1, 2, 6). Same enabled/target-reps shape an individual athlete
// sets for themselves (dashboard/RoutineScreen.tsx) — this is the team-wide
// default every team athlete sees read-only on their own Routine screen. The
// assignment table below lets the manager flip individual athletes on/off
// per exercise, same as before, just widened to all 6 pipeline exercises.
export default function ManagerRoutineScreen({ teamId }: Props) {
  const { accentColor } = useSettings();
  const [routine,    setRoutine]    = useState<TeamRoutineSetting[] | null>(null);
  const [athletes,   setAthletes]   = useState<AthleteRow[] | null>(null);
  const [overrides,  setOverrides]  = useState<Map<string, Map<PipelineExerciseKey, boolean>>>(new Map());

  useEffect(() => {
    void load();
  }, [teamId]);

  async function load() {
    try {
      const rt = await getTeamRoutine(teamId);
      setRoutine(rt);
      const roster = await getTeamAthletes(teamId);
      const rows = roster.map((a) => ({ id: a.id, name: a.name }));
      setAthletes(rows);
      const ov = await getAssignmentOverrides(rows.map((a) => a.id));
      setOverrides(ov);
    } catch (e) {
      console.warn('Failed to load team routine', e);
      setRoutine([]);
      setAthletes([]);
    }
  }

  function patchRoutine(key: PipelineExerciseKey, patch: Partial<Pick<TeamRoutineSetting, 'enabled' | 'targetReps'>>) {
    setRoutine((prev) => prev?.map((r) => (r.exerciseType === key ? { ...r, ...patch } : r)) ?? prev);
    const current = routine?.find((r) => r.exerciseType === key);
    if (!current) return;
    const next = { ...current, ...patch };
    void setTeamRoutineExercise(teamId, key, next.enabled, next.targetReps)
      .catch((e) => console.warn('Failed to update team routine', e));
  }

  // Explicit per-athlete override wins; otherwise the current team default
  // applies — recomputed live off `routine`/`overrides` state (not a cached
  // resolved snapshot), so flipping a team default above immediately
  // updates every athlete row that doesn't have its own override.
  function isChecked(athleteId: string, key: PipelineExerciseKey): boolean {
    const override = overrides.get(athleteId)?.get(key);
    if (override !== undefined) return override;
    return routine?.find((r) => r.exerciseType === key)?.enabled ?? false;
  }

  function toggleAssignment(athleteId: string, key: PipelineExerciseKey, next: boolean) {
    setOverrides((prev) => {
      const copy = new Map(prev);
      const m = new Map(copy.get(athleteId) ?? []);
      m.set(key, next);
      copy.set(athleteId, m);
      return copy;
    });
    void setAssignmentOverride(athleteId, key, next).catch((e) => console.warn('Failed to update assignment', e));
  }

  if (routine === null || athletes === null) {
    return <View style={styles.root} />;
  }

  const enabledExercises = routine.filter((r) => r.enabled);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>TEAM ROUTINE</Text>
        {routine.map((cfg) => (
          <RoutineCard
            key={cfg.exerciseType}
            config={cfg}
            accentColor={accentColor}
            onChange={(patch) => patchRoutine(cfg.exerciseType, patch)}
          />
        ))}

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
              isChecked={isChecked}
              onToggle={toggleAssignment}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ── Team-default card ────────────────────────────────────────────────────────

function RoutineCard({
  config,
  accentColor,
  onChange,
}: {
  config: TeamRoutineSetting;
  accentColor: string;
  onChange: (patch: Partial<Pick<TeamRoutineSetting, 'enabled' | 'targetReps'>>) => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={[styles.exerciseTitle, !config.enabled && styles.exerciseTitleOff]}>
          {exerciseLabel(config.exerciseType)}
        </Text>
        <Toggle value={config.enabled} onValueChange={(v) => onChange({ enabled: v })} accentColor={accentColor} />
      </View>

      {config.enabled && (
        <View style={styles.stepperBlock}>
          <RepStepper
            min={1}
            max={10}
            value={config.targetReps}
            onChange={(v) => onChange({ targetReps: v })}
            accentColor={accentColor}
          />
          <Text style={styles.repsCaption}>REPS / DAY</Text>
        </View>
      )}
    </View>
  );
}

// ── Assignments table (athlete name column stays fixed while exercise ───────
// columns scroll horizontally) ────────────────────────────────────────────────

const ROW_H = 44;
const HEADER_H = 28;

function AssignmentTable({
  athletes,
  exercises,
  isChecked,
  onToggle,
}: {
  athletes: AthleteRow[];
  exercises: TeamRoutineSetting[];
  isChecked: (athleteId: string, key: PipelineExerciseKey) => boolean;
  onToggle: (athleteId: string, key: PipelineExerciseKey, next: boolean) => void;
}) {
  return (
    <View style={styles.tableWrap}>
      {/* Fixed name column — a plain, non-scrolling sibling of the
          horizontal ScrollView below, so it never scrolls away. Both share
          the outer vertical scroll (ManagerRoutineScreen's ScrollView), so
          row alignment stays correct with no separate scroll-sync needed. */}
      <View style={styles.stickyCol}>
        <View style={styles.stickyHeaderCell}>
          <Text style={styles.stickyHeaderText}>ATHLETE</Text>
        </View>
        {athletes.map((a) => (
          <View key={a.id} style={styles.stickyRow}>
            <Text style={styles.nameText} numberOfLines={1}>{a.name}</Text>
          </View>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.tableHeader}>
            {exercises.map((e) => (
              <Text key={e.exerciseType} style={styles.th}>{exerciseLabel(e.exerciseType).toUpperCase()}</Text>
            ))}
          </View>
          {athletes.map((a) => (
            <View key={a.id} style={styles.tableRow}>
              {exercises.map((e) => {
                const checked = isChecked(a.id, e.exerciseType);
                return (
                  <Pressable
                    key={e.exerciseType}
                    style={styles.checkboxCell}
                    onPress={() => onToggle(a.id, e.exerciseType, !checked)}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bg },
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
  exerciseTitleOff: { color: colors.muted },

  stepperBlock: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  repsCaption: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginLeft: spacing.sm },

  emptyText: { color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.sm },

  tableWrap: { flexDirection: 'row' },

  stickyCol: {
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingRight: spacing.sm,
    marginRight: spacing.sm,
  },
  stickyHeaderCell: {
    height: HEADER_H,
    width: 110,
    justifyContent: 'flex-end',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
    marginBottom: 2,
  },
  stickyHeaderText: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  stickyRow: {
    height: ROW_H,
    width: 110,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(28,46,64,0.5)',
  },
  nameText: { color: colors.text, fontWeight: '700', fontSize: 13 },

  tableHeader: {
    flexDirection: 'row',
    height: HEADER_H,
    alignItems: 'flex-end',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
    marginBottom: 2,
  },
  th: { width: 90, color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1, textAlign: 'center' },
  tableRow: {
    flexDirection: 'row',
    height: ROW_H,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(28,46,64,0.5)',
  },
  checkboxCell: { width: 90, alignItems: 'center', justifyContent: 'center' },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { color: colors.bg, fontSize: 13, fontWeight: '900' },
});
