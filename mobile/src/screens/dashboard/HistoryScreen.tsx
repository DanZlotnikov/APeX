import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getSessionHistory, SessionHistoryEntry } from '../../api/sessions';
import { exerciseLabel } from '../../utils/pipelineExercise';
import { colors, riskColor, spacing } from '../../theme';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function statusOf(readiness: number): 'green' | 'yellow' | 'red' {
  return readiness >= 80 ? 'green' : readiness >= 55 ? 'yellow' : 'red';
}

interface Props {
  userId?: string;
}

// Only sessions from the new server-side pipeline (biomechanics_json set)
// ever appear here — see api/sessions.ts's getSessionHistory. No fallback to
// the old on-device Assessment shape; that history is retired for this screen.
export default function HistoryScreen({ userId }: Props) {
  const navigation = useNavigation<any>();
  const [sessions, setSessions] = useState<SessionHistoryEntry[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (userId) {
        getSessionHistory(userId)
          .then((s) => active && setSessions(s))
          .catch((e) => console.warn('[APeX] Failed to load session history:', e));
      } else {
        setSessions([]);
      }
      return () => { active = false; };
    }, [userId]),
  );

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>HISTORY</Text>
        {sessions.length === 0 ? (
          <Text style={styles.empty}>No sessions saved yet. Every analysis you save is stored here.</Text>
        ) : (
          sessions.map((s) => {
            const hasReadiness = s.readinessScore != null;
            const color = hasReadiness ? riskColor(statusOf(s.readinessScore!)) : colors.muted;
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
                  <Text style={styles.rowDate}>{fmtDate(s.recordedAt)}</Text>
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
