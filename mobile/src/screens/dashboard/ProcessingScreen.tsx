import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  cancelVideoJob, deleteJobStorage, deleteLocalRawVideo, discardVideoJob,
  getLocalRawVideoUri, getSignedVideoUrl, saveVideoJob, VideoJob,
} from '../../api/videoJobs';
import ApexLoader from '../../components/ApexLoader';
import BiomechanicsReport from '../../components/BiomechanicsReport';
import VideoPlayer from '../../components/VideoPlayer';
import { useVideoJobs } from '../../hooks/useVideoJobs';
import { colors, spacing } from '../../theme';

interface Props {
  userId?: string;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Processing tab: every video_jobs row for this athlete, in every state
// (queued/processing/completed/failed) — see HANDOFF_video_pipeline.md
// section 4, items 4-7. Saving/discarding/removing all delete the row
// server-side, so a job simply disappears from this list once one of those
// completes (via the same Realtime subscription useVideoJobs uses).
export default function ProcessingScreen({ userId }: Props) {
  const { jobs, loading } = useVideoJobs(userId);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  // Optimistic removal: hide a card the instant its action is tapped rather
  // than waiting for the row to actually disappear — cancelling a
  // 'processing' job is eventually-consistent (the worker deletes the row
  // once it next checks cancel_requested), not instant. If removedIds grows
  // stale (row never actually got removed, e.g. a network failure), the next
  // real Realtime event still reconciles `jobs` — this only ever hides rows
  // that are still present, never fabricates ones that aren't.
  const visibleJobs = jobs.filter((j) => !removedIds.has(j.id));

  function markRemoved(id: string) {
    setRemovedIds((prev) => new Set(prev).add(id));
  }

  if (!userId) return null;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>PROCESSING</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : visibleJobs.length === 0 ? (
          <Text style={styles.empty}>Nothing in progress. Record or upload a video to get started.</Text>
        ) : (
          visibleJobs.map((job) => (
            <JobCard key={job.id} job={job} userId={userId} onRemoved={() => markRemoved(job.id)} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function JobCard({ job, userId, onRemoved }: { job: VideoJob; userId: string; onRemoved: () => void }) {
  if (job.status === 'completed') return <CompletedCard job={job} userId={userId} onRemoved={onRemoved} />;
  if (job.status === 'failed') return <FailedCard job={job} userId={userId} onRemoved={onRemoved} />;
  return <PendingCard job={job} userId={userId} onRemoved={onRemoved} />;
}

// queued/processing — HANDOFF item 5: raw, unmodified video only, never the
// two-panel render (it doesn't exist yet).
function PendingCard({ job, userId, onRemoved }: { job: VideoJob; userId: string; onRemoved: () => void }) {
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const local = await getLocalRawVideoUri(userId, job.id);
      if (local) { if (active) setVideoUri(local); return; }
      const signed = await getSignedVideoUrl(job.rawVideoPath);
      if (active) setVideoUri(signed);
    })();
    return () => { active = false; };
  }, [job.id, job.rawVideoPath, userId]);

  async function handleRemove() {
    if (busy) return;
    setBusy(true);
    onRemoved();
    try {
      // 'queued': cancel_video_job deletes the row immediately and the
      // worker never touches this job at all — nothing else will ever clean
      // up its raw video object, so the app must delete it here. 'processing':
      // cancel_video_job only flags cancel_requested and leaves the row (and
      // its storage object) for the worker to remove once it notices — the
      // worker may still be actively reading raw_video_path, so deleting it
      // client-side right now would risk a race with that in-flight read.
      const wasQueued = job.status === 'queued';
      await cancelVideoJob(job.id);
      if (wasQueued) await deleteJobStorage(job);
      await deleteLocalRawVideo(userId, job.id);
    } catch (e) {
      console.warn('[APeX] Failed to remove video job:', e);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.video}>
        {videoUri ? <VideoPlayer videoUri={videoUri} fitContainer /> : <ApexLoader />}
      </View>
      <View style={styles.cardBody}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, job.status === 'processing' && styles.statusDotActive]} />
          <Text style={styles.statusText}>{job.status === 'processing' ? 'Processing…' : 'Queued'}</Text>
        </View>
        <Text style={styles.meta}>{Math.round(job.durationSec)}s · {fmtDate(job.recordedAt)}</Text>
        <Pressable onPress={handleRemove} disabled={busy} style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}>
          <Text style={styles.removeBtnText}>REMOVE EXERCISE</Text>
        </Pressable>
      </View>
    </View>
  );
}

// HANDOFF item 7 — same Remove behavior as (5); cancel_video_job (fixed in
// migration 010) deletes a 'failed' row immediately, same as 'queued'.
function FailedCard({ job, userId, onRemoved }: { job: VideoJob; userId: string; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false);

  async function handleRemove() {
    if (busy) return;
    setBusy(true);
    onRemoved();
    try {
      await cancelVideoJob(job.id);
      await deleteLocalRawVideo(userId, job.id);
      await deleteJobStorage(job);
    } catch (e) {
      console.warn('[APeX] Failed to remove failed job:', e);
    }
  }

  return (
    <View style={[styles.card, styles.failedCard]}>
      <View style={styles.cardBody}>
        <Text style={styles.failedTitle}>Processing failed</Text>
        <Text style={styles.failedMessage}>{job.errorMessage ?? 'Something went wrong analyzing this video.'}</Text>
        <Pressable onPress={handleRemove} disabled={busy} style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}>
          <Text style={styles.removeBtnText}>REMOVE EXERCISE</Text>
        </Pressable>
      </View>
    </View>
  );
}

// HANDOFF item 6 — two-panel video + full analysis, Save/Discard.
function CompletedCard({ job, userId, onRemoved }: { job: VideoJob; userId: string; onRemoved: () => void }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (job.resultVideoPath) {
      getSignedVideoUrl(job.resultVideoPath).then((url) => { if (active) setVideoUrl(url); });
    }
    return () => { active = false; };
  }, [job.resultVideoPath]);

  async function handleSave() {
    if (busy) return;
    setBusy(true);
    onRemoved();
    try {
      await saveVideoJob(job.id);
      await deleteLocalRawVideo(userId, job.id);
    } catch (e) {
      console.warn('[APeX] Failed to save video job:', e);
    }
  }

  async function handleDiscard() {
    if (busy) return;
    setBusy(true);
    onRemoved();
    try {
      await discardVideoJob(job.id);
      await deleteJobStorage(job);
      await deleteLocalRawVideo(userId, job.id);
    } catch (e) {
      console.warn('[APeX] Failed to discard video job:', e);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.video}>
        {videoUrl ? <VideoPlayer videoUri={videoUrl} fitContainer /> : <ApexLoader />}
      </View>
      <View style={styles.cardBody}>
        <BiomechanicsReport
          analysis={job.analysis}
          fallbackExerciseType={job.exerciseType}
          repCount={job.analysis?.rep_count ?? 0}
        />
        <View style={styles.actionsRow}>
          <Pressable onPress={handleDiscard} disabled={busy} style={({ pressed }) => [styles.discardBtn, pressed && styles.pressed]}>
            <Text style={styles.discardText}>DISCARD</Text>
          </Pressable>
          <Pressable onPress={handleSave} disabled={busy} style={({ pressed }) => [styles.saveBtn, pressed && styles.pressed]}>
            <Text style={styles.saveText}>SAVE</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  kicker: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2.5, marginBottom: spacing.md },
  empty: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  loading: { marginVertical: spacing.lg },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  failedCard: { borderColor: colors.danger },
  // No fixed height — VideoPlayer sizes itself to the video's real aspect
  // ratio (see VideoPlayer.native.tsx) so it fits its box exactly instead of
  // being letterboxed inside an arbitrarily-chosen fixed height. minHeight is
  // just for the brief loading-placeholder state before a uri is resolved.
  video: { width: '100%', minHeight: 160, backgroundColor: '#0B1220', alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: spacing.md },

  statusRow: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.muted, marginRight: spacing.sm },
  statusDotActive: { backgroundColor: colors.warning },
  statusText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 12, marginTop: 4 },

  failedTitle: { color: colors.danger, fontSize: 14, fontWeight: '800' },
  failedMessage: { color: colors.muted, fontSize: 12, marginTop: 4, lineHeight: 17 },

  removeBtn: {
    marginTop: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    alignItems: 'center', paddingVertical: spacing.sm + 2,
  },
  removeBtnText: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },

  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  discardBtn: {
    flex: 1, borderWidth: 1, borderColor: colors.danger, borderRadius: 10,
    alignItems: 'center', paddingVertical: spacing.sm + 2,
  },
  discardText: { color: colors.danger, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  saveBtn: {
    flex: 1, backgroundColor: colors.primary, borderRadius: 10,
    alignItems: 'center', paddingVertical: spacing.sm + 2,
  },
  saveText: { color: colors.primaryText, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },

  pressed: { opacity: 0.6 },
});
