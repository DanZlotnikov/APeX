/**
 * Live view of the current athlete's video_jobs rows — backs the
 * "N videos processing" banner, the Performance tab's "PROCESSING (N)"
 * label, the Processing tab's own list, and Today's Tasks (see
 * HANDOFF_video_pipeline.md section 4, items 3-8). Realtime-driven, not
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { getVideoJobs, subscribeToVideoJobs, VideoJob } from '../api/videoJobs';

export function useVideoJobs(athleteId: string | undefined) {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [loading, setLoading] = useState(true);
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
  // been optimistically marked pending removal (see markPendingRemoval above).
  const processingCount = jobs.filter((j) => !pendingRemovalIds.has(j.id)).length;

  return { jobs, loading, processingCount, refetch, markPendingRemoval };
}
