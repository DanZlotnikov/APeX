/**
 * Live view of the current athlete's video_jobs rows — backs both the
 * "N videos processing" banner and the Processing tab (see
 * HANDOFF_video_pipeline.md section 4, items 3-7). Realtime-driven, not
 * polling: any insert/update/delete on this athlete's rows triggers a
 * refetch. Rows only exist while "live" (queued/processing/completed/
 * failed) — saving or discarding a job deletes its row server-side, so it
 * simply drops out of this list on the next Realtime event.
 */
import { useCallback, useEffect, useState } from 'react';
import { getVideoJobs, subscribeToVideoJobs, VideoJob } from '../api/videoJobs';

export function useVideoJobs(athleteId: string | undefined) {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!athleteId) {
      setJobs([]);
      setLoading(false);
      return;
    }
    try {
      const rows = await getVideoJobs(athleteId);
      setJobs(rows);
    } catch (e) {
      console.warn('[APeX] Failed to load video jobs:', e instanceof Error ? e.message : e);
    } finally {
      setLoading(false);
    }
  }, [athleteId]);

  useEffect(() => {
    void refetch();
    if (!athleteId) return;
    return subscribeToVideoJobs(athleteId, () => { void refetch(); });
  }, [athleteId, refetch]);

  const processingCount = jobs.filter((j) => j.status === 'queued' || j.status === 'processing').length;

  return { jobs, loading, processingCount, refetch };
}
