import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../components/ui/Text';
import { getSessionHistory, SessionHistoryEntry } from '../../api/sessions';
import { getExercisesWithHistory } from '../../api/readiness';
import ExercisePicker, { ExercisePickerOption } from '../../components/ExercisePicker';
import { exerciseLabel } from '../../utils/pipelineExercise';
import { formatSessionDateTime } from '../../utils/format';
import { readinessColor } from '../../utils/readiness';
import { colors, spacing } from '../../theme';

interface Props {
  userId?: string;
}

// Only sessions from the new server-side pipeline (biomechanics_json set)
// ever appear here — see api/sessions.ts's getSessionHistory. No fallback to
// the old on-device Assessment shape; that history is retired for this screen.
//
// Shared verbatim between the athlete's own Performance > History tab
// (PerformanceScreen.tsx) and the manager's per-athlete History tab
// (AthleteDetailPreview.tsx) via the same userId-prop pattern every other
// shared screen in this app uses — the exercise filter below applies to
// both surfaces for free.
export default function HistoryScreen({ userId }: Props) {
  const navigation = useNavigation<any>();
  const [sessions, setSessions] = useState<SessionHistoryEntry[]>([]);
  const [exerciseOptions, setExerciseOptions] = useState<ExercisePickerOption[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (userId) {
        getSessionHistory(userId)
          .then((s) => active && setSessions(s))
          .catch((e) => console.warn('[APeX] Failed to load session history:', e));
        getExercisesWithHistory(userId)
          .then((keys) => active && setExerciseOptions(keys.map((k) => ({ key: k, label: exerciseLabel(k) }))))
          .catch((e) => console.warn('[APeX] Failed to load exercise list:', e));
      } else {
        setSessions([]);
        setExerciseOptions([]);
      }
      return () => { active = false; };
    }, [userId]),
  );

  const filteredSessions = useMemo(
    () => (selectedExercise ? sessions.filter((s) => s.exerciseType === selectedExercise) : sessions),
    [sessions, selectedExercise],
  );

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>HISTORY</Text>

        {exerciseOptions.length > 0 && (
          <View style={styles.filterRow}>
            <ExercisePicker
              options={exerciseOptions}
              value={selectedExercise}
              onChange={setSelectedExercise}
              allLabel="All Exercises"
            />
          </View>
        )}

        {filteredSessions.length === 0 ? (
          <Text style={styles.empty}>
            {sessions.length === 0
              ? 'No sessions saved yet. Every analysis you save is stored here.'
              : 'No sessions for this exercise yet.'}
          </Text>
        ) : (
          filteredSessions.map((s) => {
            const hasReadiness = s.readinessScore != null;
            const color = readinessColor(s.readinessScore);
            return (
              <Pressable
                key={s.id}
                onPress={() => navigation.navigate('HistoryDetail', { id: s.id })}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={[styles.readiness, { borderColor: color }]}>
                  <Text style={[styles.readinessNum, { color }]}>{hasReadiness ? s.readinessScore : '—'}</Text>
                </View>
                <View style={styles.rowMid}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{exerciseLabel(s.exerciseType)}</Text>
                  <Text style={styles.rowDate}>{formatSessionDateTime(s.recordedAt)}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  kicker: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2.5, marginBottom: spacing.md },
  filterRow: { marginBottom: spacing.md },
  empty: { color: colors.muted, fontSize: 13, lineHeight: 19 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.6 },
  readiness: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
  readinessNum: { fontSize: 15, fontWeight: '900' },
  rowMid: { flex: 1, marginLeft: spacing.md },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  rowDate: { color: colors.muted, fontSize: 11, marginTop: 3 },
  chevron: { color: colors.muted, fontSize: 22, fontWeight: '400' },
});
