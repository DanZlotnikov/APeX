import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { deleteSession, getSessionById, SessionHistoryEntry } from '../../api/sessions';
import { getSignedVideoUrl } from '../../api/videoJobs';
import ApexLoader from '../../components/ApexLoader';
import BiomechanicsReport from '../../components/BiomechanicsReport';
import VideoPlayer from '../../components/VideoPlayer';
import { colors, spacing } from '../../theme';
import DashHeader from './DashHeader';

const VIDEO_H = Math.round(Dimensions.get('window').height * 0.4);

interface Props {
  userId?: string;
}

export default function HistoryDetailScreen({ userId }: Props) {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const id: string = route.params?.id;

  const [entry, setEntry]       = useState<SessionHistoryEntry | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getSessionById(id)
      .then(async (s) => {
        if (!active) return;
        setEntry(s);
        if (s?.resultVideoPath) {
          const url = await getSignedVideoUrl(s.resultVideoPath);
          if (active) setVideoUrl(url);
        }
      })
      .catch((e) => console.warn('[APeX] Failed to load session:', e))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  async function handleDelete() {
    if (!entry || deleting) return;
    setDeleting(true);
    try {
      await deleteSession(entry);
      navigation.goBack();
    } catch (e) {
      console.warn('[APeX] Failed to delete session:', e);
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <DashHeader title="SESSION" onBack={() => navigation.goBack()} />
        <View style={styles.loading}><ApexLoader /></View>
      </View>
    );
  }

  if (!entry) {
    return (
      <View style={styles.screen}>
        <DashHeader title="SESSION" onBack={() => navigation.goBack()} />
        <Text style={styles.missing}>Session not found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <DashHeader title="SESSION" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {videoUrl ? (
          <VideoPlayer videoUri={videoUrl} fitContainer />
        ) : (
          <View style={[styles.video, styles.noVideo, { height: VIDEO_H }]}>
            <Text style={styles.noVideoText}>Video unavailable</Text>
          </View>
        )}

        <View style={styles.reportSpacer}>
          <BiomechanicsReport
            analysis={entry.biomechanics}
            fallbackExerciseType={entry.exerciseType}
            repCount={entry.repCount}
          />
        </View>

        <Pressable onPress={handleDelete} disabled={deleting} style={({ pressed }) => [styles.delete, pressed && styles.pressed]}>
          <Text style={styles.deleteText}>{deleting ? 'DELETING…' : 'DELETE SESSION'}</Text>
        </Pressable>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: spacing.xxl },
  missing: { color: colors.muted, fontSize: 14, padding: spacing.lg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  video:      { width: '100%', backgroundColor: '#0B1220' },
  noVideo:    { alignItems: 'center', justifyContent: 'center' },
  noVideoText: { color: colors.muted, fontSize: 13 },

  reportSpacer: { marginTop: spacing.lg, paddingHorizontal: spacing.lg },

  delete: {
    marginHorizontal: spacing.lg, marginTop: spacing.lg,
    borderWidth: 1, borderColor: colors.danger, borderRadius: 12,
    alignItems: 'center', paddingVertical: spacing.md,
  },
  pressed:    { opacity: 0.5 },
  deleteText: { color: colors.danger, fontSize: 12, fontWeight: '800', letterSpacing: 2 },
});
