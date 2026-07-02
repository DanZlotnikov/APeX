import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import DashHeader from './DashHeader';
import { useDashboard } from './DashboardContext';
import { HistoryEntry, loadHistory } from '../../utils/history';
import { colors, riskColor, spacing } from '../../theme';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function statusOf(readiness: number): 'green' | 'yellow' | 'red' {
  return readiness >= 80 ? 'green' : readiness >= 55 ? 'yellow' : 'red';
}

export default function HistoryScreen() {
  const { onExit } = useDashboard();
  const navigation = useNavigation<any>();
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadHistory().then((h) => active && setHistory(h.slice().reverse())); // newest first
      return () => { active = false; };
    }, []),
  );

  return (
    <View style={styles.screen}>
      <DashHeader title="HISTORY" onExit={onExit} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {history.length === 0 ? (
          <Text style={styles.empty}>No sessions saved yet. Every analysis you run is stored here.</Text>
        ) : (
          history.map((e) => {
            const color = riskColor(statusOf(e.assessment.readiness));
            const names = e.assessment.perExercise.map((x) => x.label).join(' · ');
            return (
              <Pressable
                key={e.id}
                onPress={() => navigation.navigate('HistoryDetail', { id: e.id })}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={[styles.readiness, { borderColor: color }]}>
                  <Text style={[styles.readinessNum, { color }]}>{e.assessment.readiness}</Text>
                </View>
                <View style={styles.rowMid}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{names || 'Session'}</Text>
                  <Text style={styles.rowDate}>{fmtDate(e.dateISO)}</Text>
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
