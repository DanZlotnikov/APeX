import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import DashHeader from './DashHeader';
import AssessmentPanel from '../../components/AssessmentPanel';
import VideoPlayer from '../../components/VideoPlayer';
import LineTrend from '../../components/charts/LineTrend';
import { useSettings } from '../../state/SettingsContext';
import {
  deleteEntry, exerciseSeries, ExerciseKey, HistoryEntry, loadHistory,
} from '../../utils/history';
import { resolveVideo } from '../../utils/storage';
import { colors, spacing } from '../../theme';

const VIDEO_H = Math.round(Dimensions.get('window').height * 0.4);

export default function HistoryDetailScreen() {
  const { accentColor } = useSettings();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const id: string = route.params?.id;

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [entry, setEntry]     = useState<HistoryEntry | null>(null);

  useEffect(() => {
    loadHistory().then((h) => {
      setHistory(h);
      setEntry(h.find((e) => e.id === id) ?? null);
    });
  }, [id]);

  async function handleDelete() {
    await deleteEntry(id);
    navigation.goBack();
  }

  if (!entry) {
    return (
      <View style={styles.screen}>
        <DashHeader title="SESSION" onBack={() => navigation.goBack()} />
        <Text style={styles.missing}>Session not found.</Text>
      </View>
    );
  }

  const videoUri = resolveVideo(entry.videoFile);
  const upto  = history.filter((e) => e.dateISO <= entry.dateISO);
  const exKeys = entry.assessment.perExercise.map((x) => x.key);

  return (
    <View style={styles.screen}>
      <DashHeader title="SESSION" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {videoUri ? (
          <View style={[styles.video, { height: VIDEO_H }]}>
            <VideoPlayer videoUri={videoUri} />
          </View>
        ) : (
          <View style={[styles.video, styles.noVideo, { height: VIDEO_H }]}>
            <Text style={styles.noVideoText}>Video unavailable</Text>
          </View>
        )}

        <AssessmentPanel assessment={entry.assessment} />

        {exKeys.length > 0 && upto.length > 1 && (
          <View style={styles.trends}>
            <Text style={styles.trendsTitle}>PROGRESS OVER TIME</Text>
            {exKeys.map((k) => {
              const rom = exerciseSeries(upto, k as ExerciseKey, 'romDeg').map((p) => p.value);
              if (rom.length < 2) return null;
              const label = entry.assessment.perExercise.find((x) => x.key === k)?.label ?? k;
              return (
                <View key={k} style={styles.trendCard}>
                  <Text style={styles.trendLabel}>{label} · RANGE OF MOTION</Text>
                  <LineTrend data={rom} color={accentColor} height={100}
                    startLabel={`${rom.length} sessions`} endLabel={`${rom[rom.length - 1]}°`} />
                </View>
              );
            })}
          </View>
        )}

        <Pressable onPress={handleDelete} style={({ pressed }) => [styles.delete, pressed && styles.pressed]}>
          <Text style={styles.deleteText}>DELETE SESSION</Text>
        </Pressable>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: spacing.xxl },
  missing: { color: colors.muted, fontSize: 14, padding: spacing.lg },

  video:      { width: '100%', backgroundColor: '#0B1220' },
  noVideo:    { alignItems: 'center', justifyContent: 'center' },
  noVideoText: { color: colors.muted, fontSize: 13 },

  trends:      { paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  trendsTitle: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: spacing.sm },
  trendCard: {
    backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  trendLabel: { color: colors.text, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: spacing.xs },

  delete: {
    marginHorizontal: spacing.lg, marginTop: spacing.lg,
    borderWidth: 1, borderColor: colors.danger, borderRadius: 12,
    alignItems: 'center', paddingVertical: spacing.md,
  },
  pressed:    { opacity: 0.5 },
  deleteText: { color: colors.danger, fontSize: 12, fontWeight: '800', letterSpacing: 2 },
});
