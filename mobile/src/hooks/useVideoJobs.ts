/**
 * Live view of the current athlete's video_jobs rows — backs the
 * "N videos processing" banner, the Performance tab's "PROCESSING (N)"
 * label, the Processing tab's own list, and the Overview screen's Today's
 * Routine card (see HANDOFF_video_pipeline.md section 4, items 3-8). Realtime-driven, not
 * polling: any insert/update/delete on this athlete's rows triggers a
 * refetch. Rows only exist while "live" (queued/processing/completed/
 * failed) — saving or discarding a job deletes its row server-side, so it
 * simply drops out of this list on the next Realtime event.
 *
 * Call this hook itself from exactly one place — state/VideoJobsContext.tsx's
 * Provider — and have every screen read the shared context instead of
 * calling useVideoJobs() directly. Confirmed in production: with each
 * consumer running its own independent instance (React Navigation's
 * bottom-tabs keeps inactive tab screens mounted, so 3-4 of these were often
 * alive at once, all subscribed to the identical table+filter), some
 * instances would pick up a change via Realtime while others didn't, leaving
 * the banner and the Processing tab disagreeing indefinitely. One shared
 * instance removes the possibility of that class of bug outright — there's
 * only one subscription and one piece of state to go stale.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getVideoJobs, subscribeToVideoJobs, VideoJob } from '../api/videoJobs';
import { getLocalUploadsSnapshot, removeLocalUpload, subscribeLocalUploads } from '../state/localUploads';

export function useVideoJobs(athleteId: string | undefined) {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [loading, setLoading] = useState(true);
  // Optimistic uploads-in-flight, tracked entirely outside React (see
  // state/localUploads.ts — App.tsx's handleVideoConfirmed, which starts an
  // upload, isn't a descendant of VideoJobsProvider and so can't reach this
  // hook's own state setters directly). useSyncExternalStore is what makes
  // reading that external store here safe/correct under concurrent
  // rendering, same guarantee useState gives for state that DOES live here.
  const localUploads = useSyncExternalStore(subscribeLocalUploads, getLocalUploadsSnapshot);
  // Optimistic, instant "this one's already handled" — the real Realtime
  // round-trip (RPC commits -> replication notices -> Realtime pushes it ->
  // this hook refetches) is a real network path, confirmed to sometimes take
  // 5-6 seconds end to end. The count shouldn't wait on that: a consumer
  // calls markPendingRemoval() the instant the athlete taps Save/Discard/
  // Remove, and processingCount reflects it immediately. `jobs` itself is
  // left untouched (still the raw server state) so a consumer that wants an
  // ANIMATED per-card removal — see ProcessingScreen's own exit animation —
  // can still control exactly when a card visually disappears, decoupled
  // from how fast the count updates. Once the real refetch confirms a row is
  // actually gone, its id is pruned from this set — no unbounded growth, and
  // no risk of permanently hiding a row whose action actually failed
  // server-side (it just reappears on the next legitimate refetch).
  const [pendingRemovalIds, setPendingRemovalIds] = useState<Set<string>>(new Set());

  const markPendingRemoval = useCallback((jobId: string) => {
    setPendingRemovalIds((prev) => (prev.has(jobId) ? prev : new Set(prev).add(jobId)));
  }, []);

  // Reverts markPendingRemoval — call this if the action that justified it
  // (Save/Discard/Remove's RPC) actually failed, so the count doesn't stay
  // permanently wrong for a job that's still there.
  const unmarkPendingRemoval = useCallback((jobId: string) => {
    setPendingRemovalIds((prev) => {
      if (!prev.has(jobId)) return prev;
      const next = new Set(prev);
      next.delete(jobId);
      return next;
    });
  }, []);

  // Confirmed removal: splices a job straight out of the canonical `jobs`
  // array. Only call this once the backend call that removes the row has
  // actually succeeded (Save/Discard/Remove) — never optimistically. Because
  // `jobs` lives here, in the one shared instance, this survives whatever a
  // screen-local `useState` wouldn't (e.g. ProcessingScreen remounting when
  // the athlete switches History <-> Processing sub-tabs — confirmed in
  // production as the exact cause of a saved/discarded job reappearing in
  // Processing after navigating away and back). No-op if the id isn't
  // present (e.g. a redundant call after a real Realtime refetch already
  // removed it).
  const removeJobLocally = useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);
  // Guards against an out-of-order response clobbering a newer one. Two
  // Realtime events firing in quick succession (e.g. discarding two jobs
  // back to back) each trigger their own refetch(); nothing otherwise stops
  // the OLDER request's response, if it happens to resolve LAST, from
  // overwriting state a newer, faster response already set correctly —
  // confirmed in production as the banner and Processing tab disagreeing
  // after back-to-back discards (DB had 1 row; the banner was still
  // showing a stale 3 from a superseded request). Each refetch() call gets
  // an incrementing token; a response only applies if it's still the most
  // recently issued one by the time it resolves.
  const latestRequestId = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = ++latestRequestId.current;
    if (!athleteId) {
      setJobs([]);
      setLoading(false);
      return;
    }
    try {
      const rows = await getVideoJobs(athleteId);
      if (requestId === latestRequestId.current) {
        setJobs(rows);
        // Prune ids no longer present — confirmed gone from the source of
        // truth, so they no longer need optimistic masking.
        const rowIds = new Set(rows.map((r) => r.id));
        setPendingRemovalIds((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const id of prev) {
            if (!rowIds.has(id)) { next.delete(id); changed = true; }
          }
          return changed ? next : prev;
        });
        // An optimistic local upload's real row has landed — hand off from
        // the loader placeholder to the real card by dropping the local
        // entry (see state/localUploads.ts). Normally App.tsx's
        // handleVideoConfirmed already does this the instant the upload
        // call itself resolves; this is the backstop for whenever a
        // refetch/Realtime event beats that (or that promise chain never
        // gets to run, e.g. a reload mid-upload).
        for (const upload of getLocalUploadsSnapshot()) {
          if (rowIds.has(upload.id)) removeLocalUpload(upload.id);
        }
      }
    } catch (e) {
      console.warn('[APeX] Failed to load video jobs:', e instanceof Error ? e.message : e);
    } finally {
      if (requestId === latestRequestId.current) setLoading(false);
    }
  }, [athleteId]);

  useEffect(() => {
    void refetch();
    if (!athleteId) return;
    return subscribeToVideoJobs(athleteId, () => { void refetch(); });
  }, [athleteId, refetch]);

  // Total videos still in the Processing tab, not just the ones actually
  // running pose estimation right now — queued/processing (waiting on the
  // pipeline) AND completed/failed (waiting on the athlete: Save/Discard or
  // Remove). `jobs` already only ever contains rows that are still "live"
  // (saving/discarding/cancelling all delete the row server-side, and
  // getVideoJobs excludes cancel_requested rows too), so every row left here
  // is something the Processing tab still has to show — minus whatever's
  // been optimistically marked pending removal (see markPendingRemoval above)
  // — plus any upload still in flight (not yet a real row at all) so the
  // count reflects the athlete's action the instant they take it, not once
  // the upload finishes. A FAILED upload doesn't count here — it's not
  // "processing" anymore, see uploadFailedCount below.
  const uploadingCount = localUploads.filter((u) => u.status === 'uploading').length;
  const failedUploads = localUploads.filter((u) => u.status === 'failed');
  const processingCount = jobs.filter((j) => !pendingRemovalIds.has(j.id)).length + uploadingCount;

  // Bumped whenever processingCount goes UP — drives ProcessingBanner's
  // one-shot shine sweep. Deliberately tracked HERE, not as local state
  // inside ProcessingBanner itself: DashboardScreen (and therefore
  // ProcessingBanner) fully unmounts while the athlete is on the camera/
  // upload screen (App.tsx swaps between them via a plain conditional, not
  // persistent tabs) and remounts fresh on return — confirmed as the cause
  // of a reported "banner appears, but no sweep" after uploading a video:
  // by the time ProcessingBanner mounts again, the optimistic local upload
  // was already registered, so its own freshly-initialized "previous
  // count" ref was born already at the new value, with no transition left
  // to detect. This hook's instance, owned by VideoJobsProvider, does NOT
  // unmount across that same navigation, so tracking the transition here
  // instead survives it.
  const prevProcessingCountRef = useRef(processingCount);
  const [processingIncreaseSignal, setProcessingIncreaseSignal] = useState(0);
  useEffect(() => {
    if (processingCount > prevProcessingCountRef.current) {
      setProcessingIncreaseSignal((n) => n + 1);
    }
    prevProcessingCountRef.current = processingCount;
  }, [processingCount]);

  return {
    jobs, loading, processingCount, refetch, markPendingRemoval, unmarkPendingRemoval, removeJobLocally,
    localUploads, failedUploads, processingIncreaseSignal,
  };
}
