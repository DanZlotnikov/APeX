import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  cancelVideoJob, deleteJobStorage, deleteLocalRawVideo, discardVideoJob,
  getLocalRawVideoUri, getSignedVideoUrl, saveVideoJob, VideoJob,
} from '../../api/videoJobs';
import ApexLoader from '../../components/ApexLoader';
import BiomechanicsReport from '../../components/BiomechanicsReport';
import VideoPlayer from '../../components/VideoPlayer';
import { useSettings } from '../../state/SettingsContext';
import { useVideoJobsContext } from '../../state/VideoJobsContext';
import { colors, spacing } from '../../theme';

interface Props {
  userId?: string;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// A short, subtle fade + scale-down on Save/Discard/Remove — a card
// shouldn't just vanish. Kept deliberately simple (no bounce/slide/color
// flash): a quick, clean dismiss reads as "handled it" rather than drawing
// attention to itself. The backend call fires immediately in parallel (see
// each handler below); only removing the card from the list waits for this
// to finish, so the tap still feels instant.
function useCardExitAnimation() {
  const progress = useRef(new Animated.Value(1)).current;

  function playExit(onDone: () => void) {
    Animated.timing(progress, {
      toValue: 0,
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => { if (finished) onDone(); });
  }

  const animatedStyle = {
    opacity: progress,
    transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) }],
  };

  return { animatedStyle, playExit };
}

// A synchronous reentrancy guard for Save/Discard/Remove — confirmed in
// production that the `useState`-based `busy` flag alone isn't enough: state
// updates aren't synchronous, so two invocations close together (a fast
// double-tap, or the card's own 200ms exit animation still rendering it with
// a not-yet-flushed `busy`) can both read busy === false before either
// update is visible, firing the backend call twice for the same tap. `busy`
// state stays, for the button's visual disabled look; this ref is what
// actually prevents a second call. reset() re-arms it after a failed action
// so the athlete can retry the same tap.
function useActionGuard() {
  const started = useRef(false);
  const guard = () => {
    if (started.current) return false;
    started.current = true;
    return true;
  };
  const reset = () => { started.current = false; };
  return { guard, reset };
}

// Postgres's default SQLSTATE for a bare `RAISE EXCEPTION '...'` (no
// explicit code) is P0001 — cancel_video_job/discard_video_job/
// save_video_job (migrations 009-010) all raise exactly that for their "not
// found" guard. Confirmed in production: a save_video_job call surfaced this
// after a legitimate first call had already succeeded (session created,
// video_jobs row deleted) — a second, redundant call landing on an
// already-resolved job_id, not an actual failure. Only THIS specific code
// should be swallowed quietly; any other error (network, auth, a real
// pipeline problem) still warns as before.
function isAlreadyHandledError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P0001';
}

// Processing tab: every video_jobs row for this athlete, in every state
// (queued/processing/completed/failed) — see HANDOFF_video_pipeline.md
// section 4, items 4-7. Saving/discarding/removing all delete the row
// server-side; each card only disappears once its own action's RPC has
// actually confirmed success (see removeJobLocally in useVideoJobs.ts) —
// never optimistically. `jobs` itself is the single, shared, persistent
// source of truth for what's rendered here (no screen-local "hidden ids"
// state), so this list is correct even if the tab remounts mid-action —
// confirmed in production as the cause of a saved job reappearing here after
// switching to History and back: the old local `removedIds` reset on
// remount while the underlying `jobs` array (fed by a Realtime DELETE event
// that was silently dropped for RLS reasons — see migration 013) still had
// the row.
export default function ProcessingScreen({ userId }: Props) {
  const { jobs, loading, refetch } = useVideoJobsContext();

  // Backstop refetch, independent of Realtime: catches the moment this tab
  // becomes visible again (e.g. switching History -> Processing in
  // PerformanceScreen, which mounts/unmounts this screen via a plain
  // ternary rather than a real navigation screen, so useFocusEffect
  // wouldn't fire here — a plain mount effect is the equivalent for that
  // switch). Mirrors HistoryScreen's useFocusEffect-based refetch.
  useEffect(() => { void refetch(); }, [refetch]);

  if (!userId) return null;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>PROCESSING</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : jobs.length === 0 ? (
          <Text style={styles.empty}>Nothing in progress. Record or upload a video to get started.</Text>
        ) : (
          jobs.map((job) => <JobCard key={job.id} job={job} userId={userId} />)
        )}
      </ScrollView>
    </View>
  );
}

interface CardProps {
  job: VideoJob;
  userId: string;
}

function JobCard({ job, userId }: CardProps) {
  if (job.status === 'completed') return <CompletedCard job={job} userId={userId} />;
  if (job.status === 'failed') return <FailedCard job={job} userId={userId} />;
  return <PendingCard job={job} userId={userId} />;
}

// queued/processing — HANDOFF item 5: raw, unmodified video only, never the
// two-panel render (it doesn't exist yet).
function PendingCard({ job, userId }: CardProps) {
  const { accentColor } = useSettings();
  const { markPendingRemoval, unmarkPendingRemoval, removeJobLocally } = useVideoJobsContext();
  const { animatedStyle, playExit } = useCardExitAnimation();
  const { guard, reset } = useActionGuard();
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
    if (!guard()) return;
    setBusy(true);
    // Instant, optimistic — updates the shared processingCount immediately,
    // independent of the RPC below.
    markPendingRemoval(job.id);
    try {
      await cancelVideoJob(job.id);
    } catch (e) {
      if (!isAlreadyHandledError(e)) {
        unmarkPendingRemoval(job.id);
        setBusy(false);
        reset();
        Alert.alert('Could not remove', 'Something went wrong removing this exercise. Please try again.');
        return;
      }
      // Already gone server-side (a prior call already succeeded) — treat as success.
    }
    // Only now, with the RPC confirmed, does the card actually leave the list.
    playExit(() => removeJobLocally(job.id));
    // Best-effort cleanup — a failure here doesn't change what the athlete
    // sees, so it's not worth surfacing as an error.
    try {
      // 'queued': cancel_video_job deletes the row immediately and the
      // worker never touches this job at all — nothing else will ever clean
      // up its raw video object, so the app must delete it here. 'processing':
      // cancel_video_job only flags cancel_requested and leaves the row (and
      // its storage object) for the worker to remove once it notices — the
      // worker may still be actively reading raw_video_path, so deleting it
      // client-side right now would risk a race with that in-flight read.
      if (job.status === 'queued') await deleteJobStorage(job);
      await deleteLocalRawVideo(userId, job.id);
    } catch (e) {
      console.warn('[APeX] Cleanup after removing video job failed:', e);
    }
  }

  return (
    <Animated.View style={[styles.card, animatedStyle]}>
      <View style={styles.video}>
        {videoUri ? <VideoPlayer videoUri={videoUri} fitContainer /> : <ApexLoader />}
      </View>
      <View style={styles.cardBody}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, job.status === 'processing' && { backgroundColor: accentColor }]} />
          <Text style={styles.statusText}>{job.status === 'processing' ? 'Processing…' : 'Queued'}</Text>
        </View>
        <Text style={styles.meta}>{Math.round(job.durationSec)}s · {fmtDate(job.recordedAt)}</Text>
        <Pressable onPress={handleRemove} disabled={busy} style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}>
          <Text style={styles.removeBtnText}>REMOVE EXERCISE</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// HANDOFF item 7 — same Remove behavior as (5); cancel_video_job (fixed in
// migration 010) deletes a 'failed' row immediately, same as 'queued'.
function FailedCard({ job, userId }: CardProps) {
  const { markPendingRemoval, unmarkPendingRemoval, removeJobLocally } = useVideoJobsContext();
  const { animatedStyle, playExit } = useCardExitAnimation();
  const { guard, reset } = useActionGuard();
  const [busy, setBusy] = useState(false);

  async function handleRemove() {
    if (!guard()) return;
    setBusy(true);
    markPendingRemoval(job.id);
    try {
      await cancelVideoJob(job.id);
    } catch (e) {
      if (!isAlreadyHandledError(e)) {
        unmarkPendingRemoval(job.id);
        setBusy(false);
        reset();
        Alert.alert('Could not remove', 'Something went wrong removing this exercise. Please try again.');
        return;
      }
    }
    playExit(() => removeJobLocally(job.id));
    try {
      await deleteLocalRawVideo(userId, job.id);
      await deleteJobStorage(job);
    } catch (e) {
      console.warn('[APeX] Cleanup after removing failed job failed:', e);
    }
  }

  return (
    <Animated.View style={[styles.card, styles.failedCard, animatedStyle]}>
      <View style={styles.cardBody}>
        <Text style={styles.failedTitle}>Processing failed</Text>
        <Text style={styles.failedMessage}>{job.errorMessage ?? 'Something went wrong analyzing this video.'}</Text>
        <Pressable onPress={handleRemove} disabled={busy} style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}>
          <Text style={styles.removeBtnText}>REMOVE EXERCISE</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// HANDOFF item 6 — two-panel video + full analysis, Save/Discard.
function CompletedCard({ job, userId }: CardProps) {
  const { markPendingRemoval, unmarkPendingRemoval, removeJobLocally } = useVideoJobsContext();
  const { animatedStyle, playExit } = useCardExitAnimation();
  const { guard, reset } = useActionGuard();
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
    if (!guard()) return;
    setBusy(true);
    markPendingRemoval(job.id);
    try {
      await saveVideoJob(job.id);
    } catch (e) {
      if (!isAlreadyHandledError(e)) {
        unmarkPendingRemoval(job.id);
        setBusy(false);
        reset();
        Alert.alert('Could not save', 'Something went wrong saving this exercise. Please try again.');
        return;
      }
    }
    playExit(() => removeJobLocally(job.id));
    try {
      await deleteLocalRawVideo(userId, job.id);
    } catch (e) {
      console.warn('[APeX] Cleanup after saving video job failed:', e);
    }
  }

  async function handleDiscard() {
    if (!guard()) return;
    setBusy(true);
    markPendingRemoval(job.id);
    try {
      await discardVideoJob(job.id);
    } catch (e) {
      if (!isAlreadyHandledError(e)) {
        unmarkPendingRemoval(job.id);
        setBusy(false);
        reset();
        Alert.alert('Could not discard', 'Something went wrong discarding this exercise. Please try again.');
        return;
      }
    }
    playExit(() => removeJobLocally(job.id));
    try {
      await deleteJobStorage(job);
      await deleteLocalRawVideo(userId, job.id);
    } catch (e) {
      console.warn('[APeX] Cleanup after discarding video job failed:', e);
    }
  }

  return (
    <Animated.View style={[styles.card, animatedStyle]}>
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
    </Animated.View>
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
