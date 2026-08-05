import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getCachedExercisesSync } from '../../api/exercises';
import { getEffectiveSport, updateMainSport } from '../../api/profile';
import {
  cancelVideoJob, deleteJobStorage, deleteLocalRawVideo, discardVideoJob,
  getLocalRawVideoUri, getSignedVideoUrl, saveVideoJob, VideoJob,
} from '../../api/videoJobs';
import ApexLoader from '../../components/ApexLoader';
import BiomechanicsReport from '../../components/BiomechanicsReport';
import VideoPlayer from '../../components/VideoPlayer';
import { LocalUpload } from '../../state/localUploads';
import { useSettings } from '../../state/SettingsContext';
import { useVideoJobsContext } from '../../state/VideoJobsContext';
import { colors, spacing } from '../../theme';
import { categoryLabel, resolveJobExerciseKey } from '../../utils/pipelineExercise';

interface Props {
  userId?: string;
  teamId?: string;
}

// Categories whose exercises this pipeline can't yet tell apart from pose
// data alone (see exercises.py's sport_key filter) — a completed job in one
// of these, recorded by a general-fitness athlete, is exactly the ambiguous
// case the "which sport was that?" prompt below exists to resolve.
const AMBIGUOUS_SPORT_CATEGORIES = ['padel', 'tennis'];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// A short, subtle fade + scale-down on Save/Discard/Remove — a card
// shouldn't just vanish. Kept deliberately simple (no bounce/slide/color
// flash): a quick, clean dismiss reads as "handled it" rather than drawing
// attention to itself.
//
// animatedStyle MUST be memoized (stable object + stable interpolate() node
// for the component's whole lifetime), not recomputed every render — every
// card shares one VideoJobsContext whose value object is recreated on any
// state change anywhere in the video-jobs system, and save/discard/cancel's
// own row DELETE triggers a Realtime-driven refetch that lands squarely
// inside this animation's ~180ms window. Confirmed as the cause of a
// reported "weird, laggy" fade: recreating the style object (and therefore
// a brand-new interpolation node) on every one of those incidental
// re-renders forced the native side to re-bind mid-flight instead of
// playing the animation through untouched, producing a visible stutter.
function useCardExitAnimation() {
  const progress = useRef(new Animated.Value(1)).current;

  function playTo(target: number, onDone?: () => void) {
    Animated.timing(progress, {
      toValue: target,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => { if (finished && onDone) onDone(); });
  }

  const playExit = (onDone: () => void) => playTo(0, onDone);
  // Reverses the exit — Animated.timing always animates from wherever
  // `progress` currently is, so calling this mid-exit smoothly reverses
  // course rather than jumping; no separate "how far did it get" tracking
  // needed.
  const playEnter = () => playTo(1);

  const animatedStyle = useMemo(() => ({
    opacity: progress,
    transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
  }), [progress]);

  return { animatedStyle, playExit, playEnter };
}

// Starts the exit animation THE INSTANT it's called — not gated on
// `action` (the Save/Discard/Remove RPC) resolving first — so the tap
// feels immediate rather than pausing for a network round-trip before
// anything visibly happens. The animation and the RPC run on independent
// timelines and are only reconciled at the end: onSuccess fires once BOTH
// the animation has finished playing AND `action` has resolved
// successfully, whichever finishes last. That means a fast RPC can never
// truncate the animation (removeJobLocally never fires before the card has
// actually finished visually fading), and a slow RPC never sits waiting on
// an already-finished animation either. On failure, the animation reverses
// immediately (fades back in, from wherever it currently is) rather than
// leaving the card looking gone while an error alert pops up separately —
// exactly the inconsistent-looking state an earlier fix in this file
// already eliminated for the "wait for RPC first" version; this preserves
// that guarantee while making the common (success) path feel instant.
function runExitAnimation(
  playExit: (onDone: () => void) => void,
  playEnter: () => void,
  action: () => Promise<void>,
  onSuccess: () => void,
  onFailure: (e: unknown) => void,
) {
  let animDone = false;
  let actionOk = false;

  playExit(() => {
    animDone = true;
    if (actionOk) onSuccess();
  });

  action()
    .then(() => {
      actionOk = true;
      if (animDone) onSuccess();
    })
    .catch((e) => {
      playEnter();
      onFailure(e);
    });
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
// server-side. Each card's own exit animation starts the instant it's
// tapped (see runExitAnimation) — but the card is only actually spliced
// out of the shared `jobs` array (removeJobLocally in useVideoJobs.ts)
// once its RPC has confirmed success, never optimistically: on failure the
// animation reverses instead. `jobs` itself is the single, shared,
// persistent source of truth for what's rendered here (no screen-local
// "hidden ids" state), so this list is correct even if the tab remounts
// mid-action —
// confirmed in production as the cause of a saved job reappearing here after
// switching to History and back: the old local `removedIds` reset on
// remount while the underlying `jobs` array (fed by a Realtime DELETE event
// that was silently dropped for RLS reasons — see migration 013) still had
// the row.
export default function ProcessingScreen({ userId, teamId }: Props) {
  const { accentColor } = useSettings();
  const { jobs, loading, refetch, localUploads } = useVideoJobsContext();
  const uploadingLocalUploads = localUploads.filter((u) => u.status === 'uploading');

  // Backstop refetch, independent of Realtime: catches the moment this tab
  // becomes visible again (e.g. switching History -> Processing in
  // PerformanceScreen, which mounts/unmounts this screen via a plain
  // ternary rather than a real navigation screen, so useFocusEffect
  // wouldn't fire here — a plain mount effect is the equivalent for that
  // switch). Mirrors HistoryScreen's useFocusEffect-based refetch.
  useEffect(() => { void refetch(); }, [refetch]);

  if (!userId) return null;

  const isEmpty = !loading && jobs.length === 0 && uploadingLocalUploads.length === 0;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>PROCESSING</Text>
        {loading ? (
          <ActivityIndicator color={accentColor} style={styles.loading} />
        ) : isEmpty ? (
          <Text style={styles.empty}>Nothing in progress. Record or upload a video to get started.</Text>
        ) : (
          <>
            {/* Always newest, so these sit above every real job — an
                upload just started is necessarily more recent than
                anything already in `jobs`. Swaps out for the real
                PendingCard automatically once the upload lands (see
                useVideoJobs.ts's refetch reconciliation / App.tsx's
                handleVideoConfirmed) — same id, so React treats it as the
                same list slot rather than a remove+insert. */}
            {uploadingLocalUploads.map((u) => <UploadingCard key={u.id} upload={u} />)}
            {jobs.map((job) => <JobCard key={job.id} job={job} userId={userId} teamId={teamId} />)}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// Optimistic placeholder for a video still uploading — no video_jobs row
// exists yet, so there's nothing to preview or act on, just a loading
// state until the real row (and the regular PendingCard for it) appears.
function UploadingCard({ upload }: { upload: LocalUpload }) {
  return (
    <View style={styles.card}>
      <View style={styles.video}>
        <ApexLoader />
      </View>
      <View style={styles.cardBody}>
        <View style={styles.statusRow}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>Uploading…</Text>
        </View>
        <Text style={styles.meta}>{Math.round(upload.durationSec)}s</Text>
      </View>
    </View>
  );
}

interface CardProps {
  job: VideoJob;
  userId: string;
  teamId?: string;
}

function JobCard({ job, userId, teamId }: CardProps) {
  if (job.status === 'completed') return <CompletedCard job={job} userId={userId} teamId={teamId} />;
  if (job.status === 'failed') return <FailedCard job={job} userId={userId} />;
  return <PendingCard job={job} userId={userId} />;
}

// queued/processing — HANDOFF item 5: raw, unmodified video only, never the
// two-panel render (it doesn't exist yet).
function PendingCard({ job, userId }: CardProps) {
  const { accentColor } = useSettings();
  const { markPendingRemoval, unmarkPendingRemoval, removeJobLocally } = useVideoJobsContext();
  const { animatedStyle, playExit, playEnter } = useCardExitAnimation();
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

  function handleRemove() {
    if (!guard()) return;
    setBusy(true);
    // Instant, optimistic — updates the shared processingCount immediately,
    // independent of the RPC below.
    markPendingRemoval(job.id);

    runExitAnimation(
      playExit, playEnter,
      async () => {
        try {
          await cancelVideoJob(job.id);
        } catch (e) {
          // Already gone server-side (a prior call already succeeded) — treat as success.
          if (!isAlreadyHandledError(e)) throw e;
        }
      },
      () => {
        removeJobLocally(job.id);
        // Best-effort cleanup — a failure here doesn't change what the
        // athlete sees, so it's not worth surfacing as an error.
        void (async () => {
          try {
            // 'queued': cancel_video_job deletes the row immediately and the
            // worker never touches this job at all — nothing else will ever
            // clean up its raw video object, so the app must delete it here.
            // 'processing': cancel_video_job only flags cancel_requested and
            // leaves the row (and its storage object) for the worker to
            // remove once it notices — the worker may still be actively
            // reading raw_video_path, so deleting it client-side right now
            // would risk a race with that in-flight read.
            if (job.status === 'queued') await deleteJobStorage(job);
            await deleteLocalRawVideo(userId, job.id);
          } catch (e) {
            console.warn('[APeX] Cleanup after removing video job failed:', e);
          }
        })();
      },
      () => {
        unmarkPendingRemoval(job.id);
        setBusy(false);
        reset();
        Alert.alert('Could not remove', 'Something went wrong removing this exercise. Please try again.');
      },
    );
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
  const { animatedStyle, playExit, playEnter } = useCardExitAnimation();
  const { guard, reset } = useActionGuard();
  const [busy, setBusy] = useState(false);

  function handleRemove() {
    if (!guard()) return;
    setBusy(true);
    markPendingRemoval(job.id);

    runExitAnimation(
      playExit, playEnter,
      async () => {
        try {
          await cancelVideoJob(job.id);
        } catch (e) {
          if (!isAlreadyHandledError(e)) throw e;
        }
      },
      () => {
        removeJobLocally(job.id);
        void (async () => {
          try {
            await deleteLocalRawVideo(userId, job.id);
            await deleteJobStorage(job);
          } catch (e) {
            console.warn('[APeX] Cleanup after removing failed job failed:', e);
          }
        })();
      },
      () => {
        unmarkPendingRemoval(job.id);
        setBusy(false);
        reset();
        Alert.alert('Could not remove', 'Something went wrong removing this exercise. Please try again.');
      },
    );
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
function CompletedCard({ job, userId, teamId }: CardProps) {
  const { accentColor, accentOn } = useSettings();
  const { markPendingRemoval, unmarkPendingRemoval, removeJobLocally } = useVideoJobsContext();
  const { animatedStyle, playExit, playEnter } = useCardExitAnimation();
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

  function doSave() {
    setBusy(true);
    markPendingRemoval(job.id);

    runExitAnimation(
      playExit, playEnter,
      async () => {
        try {
          await saveVideoJob(job.id);
        } catch (e) {
          if (!isAlreadyHandledError(e)) throw e;
        }
      },
      () => {
        removeJobLocally(job.id);
        void (async () => {
          try {
            await deleteLocalRawVideo(userId, job.id);
          } catch (e) {
            console.warn('[APeX] Cleanup after saving video job failed:', e);
          }
        })();
      },
      () => {
        unmarkPendingRemoval(job.id);
        setBusy(false);
        reset();
        Alert.alert('Could not save', 'Something went wrong saving this exercise. Please try again.');
      },
    );
  }

  // Padel and tennis strokes are pose-indistinguishable (see exercises.py) —
  // when the athlete's sport is unknown (general_fitness) and this job's
  // exercise falls in one of those categories, ask which sport it actually
  // was before saving, so future clips resolve correctly. Only offered to
  // athletes who can self-edit their own sport (team_id IS NULL) — a team
  // athlete's sport is their manager's call (see SettingsScreen.tsx), so
  // this never fires for them. One-shot by construction: triggered from the
  // deliberate Save tap, not on mount/re-render.
  async function handleSave() {
    if (!guard()) return;

    if (!teamId) {
      const bridgedKey = resolveJobExerciseKey({ exerciseType: job.exerciseType });
      const categoryKey = getCachedExercisesSync().find((e) => e.key === bridgedKey)?.categoryKey;
      if (categoryKey && AMBIGUOUS_SPORT_CATEGORIES.includes(categoryKey)) {
        try {
          const currentSport = await getEffectiveSport(userId);
          if (currentSport === 'general_fitness') {
            const chosen = await new Promise<string | null>((resolve) => {
              Alert.alert(
                'Which sport was that?',
                'That swing could be padel or tennis — set your main sport so we can score it correctly.',
                [
                  { text: 'Padel', onPress: () => resolve('padel') },
                  { text: 'Tennis', onPress: () => resolve('tennis') },
                  { text: 'Not now', style: 'cancel', onPress: () => resolve(null) },
                ],
              );
            });
            if (chosen) {
              try { await updateMainSport(chosen); } catch (e) { console.warn('[APeX] Failed to update main sport:', e); }
            }
          }
        } catch (e) {
          console.warn('[APeX] Failed to check main sport:', e);
        }
      }
    }

    doSave();
  }

  function handleDiscard() {
    if (!guard()) return;
    setBusy(true);
    markPendingRemoval(job.id);

    runExitAnimation(
      playExit, playEnter,
      async () => {
        try {
          await discardVideoJob(job.id);
        } catch (e) {
          if (!isAlreadyHandledError(e)) throw e;
        }
      },
      () => {
        removeJobLocally(job.id);
        void (async () => {
          try {
            await deleteJobStorage(job);
            await deleteLocalRawVideo(userId, job.id);
          } catch (e) {
            console.warn('[APeX] Cleanup after discarding video job failed:', e);
          }
        })();
      },
      () => {
        unmarkPendingRemoval(job.id);
        setBusy(false);
        reset();
        Alert.alert('Could not discard', 'Something went wrong discarding this exercise. Please try again.');
      },
    );
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
          <Pressable onPress={handleSave} disabled={busy} style={({ pressed }) => [styles.saveBtn, { backgroundColor: accentColor }, pressed && styles.pressed]}>
            <Text style={[styles.saveText, { color: accentOn }]}>SAVE</Text>
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
    flex: 1, borderRadius: 10,
    alignItems: 'center', paddingVertical: spacing.sm + 2,
  },
  saveText: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },

  pressed: { opacity: 0.6 },
});
