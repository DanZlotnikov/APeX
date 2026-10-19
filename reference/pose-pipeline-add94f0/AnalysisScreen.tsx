import React, { useCallback, useRef, useState } from 'react';
import { Dimensions, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import PoseView from '../components/PoseView';
import PrimaryButton from '../components/PrimaryButton';
import AssessmentPanel from '../components/AssessmentPanel';
import { Assessment } from '../utils/exerciseAnalyzer';
import { useSettings } from '../state/SettingsContext';
import { appendEntry, loadHistory, makeId } from '../utils/history';
import { saveVideo } from '../utils/storage';
import { compareToHistory, Comparison } from '../utils/stats';
import { playChime } from '../utils/sound';
import { colors, spacing } from '../theme';

interface Props {
  videoUri: string;
  onPoseReady: () => void;
  onRecordAgain: () => void;
  onHome: () => void;
}

// The video keeps a fixed, prominent height; the assessment report scrolls in
// beneath it once analysis completes.
const VIEWER_H = Math.round(Dimensions.get('window').height * 0.5);

export default function AnalysisScreen({ videoUri, onPoseReady, onRecordAgain, onHome }: Props) {
  const { settings } = useSettings();
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const savedRef = useRef(false); // guard: persist this session's result only once

  const handleAssessment = useCallback(
    async (a: Assessment) => {
      setAssessment(a);
      if (savedRef.current) return;
      savedRef.current = true;

      // Compare against PRIOR history (before this session is saved), then persist.
      try {
        const prior = await loadHistory();
        setComparison(compareToHistory(a, prior, settings.windowDays));
        void playChime();

        const id = makeId();
        const videoFile = await saveVideo(videoUri, id);
        await appendEntry({ id, dateISO: new Date().toISOString(), videoFile, assessment: a });
      } catch {
        // comparison/persistence are best-effort; the report still shows
      }
    },
    [settings.windowDays, videoUri],
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>MOVEMENT ANALYSIS</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.viewer, { height: VIEWER_H }]}>
          <PoseView videoUri={videoUri} onReady={onPoseReady} onAssessment={handleAssessment} />
        </View>

        {assessment && <AssessmentPanel assessment={assessment} comparison={comparison} />}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Record Again" onPress={onRecordAgain} />
        <Pressable
          onPress={onHome}
          style={({ pressed }) => [styles.homeBtn, pressed && styles.homeBtnPressed]}
        >
          <Text style={styles.homeBtnText}>MAIN MENU</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  header: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2.5,
  },

  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  viewer: { width: '100%', backgroundColor: '#0B1220' },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.xs,
  },
  homeBtn: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  homeBtnPressed: { opacity: 0.4 },
  homeBtnText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2.5,
  },
});
