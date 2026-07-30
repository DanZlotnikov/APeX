/**
 * Single shared instance of useVideoJobs, provided via Context so every
 * consumer (the app-wide banner, the Performance tab's "PROCESSING (N)"
 * label, the Processing tab's own list, the Overview screen's Today's
 * Routine card) reads the exact same state instead of each running its own
 * independent useVideoJobs() call.
 *
 * Confirmed in production: with 3-4 of those call sites all mounted at once
 * (React Navigation's bottom-tabs keeps inactive tab screens mounted, not
 * unmounted), each held its own Realtime subscription to the identical
 * table+filter — and after a discard, some of them picked up the change
 * while others (the banner, the tab label) kept showing stale counts
 * indefinitely. One shared subscription removes the possibility of that
 * class of bug entirely: there's only one source of truth to go stale.
 */
import React, { createContext, useContext } from 'react';
import { useVideoJobs } from '../hooks/useVideoJobs';
import { VideoJob } from '../api/videoJobs';
import { LocalUpload } from './localUploads';

interface VideoJobsContextValue {
  jobs: VideoJob[];
  loading: boolean;
  // Includes both real "live" video_jobs rows and any upload still in
  // flight (see state/localUploads.ts) — the count the banner/tab label show.
  processingCount: number;
  refetch: () => Promise<void>;
  // Instantly excludes a job from processingCount (but not from `jobs`
  // itself — see useVideoJobs.ts) the moment an action is taken, without
  // waiting on the real Realtime round-trip. Call this from any
  // Save/Discard/Remove handler.
  markPendingRemoval: (jobId: string) => void;
  // Reverts markPendingRemoval if the action's RPC actually failed.
  unmarkPendingRemoval: (jobId: string) => void;
  // Confirmed removal — splices a job out of the shared `jobs` array. Only
  // call after the action's RPC has actually succeeded.
  removeJobLocally: (jobId: string) => void;
  // Optimistic client-side uploads not yet (or never) turned into a real
  // video_jobs row — see state/localUploads.ts. Includes both 'uploading'
  // and 'failed' entries; ProcessingScreen renders 'uploading' ones as a
  // loader placeholder, DashboardScreen's failed-upload banner reads
  // failedUploads below.
  localUploads: LocalUpload[];
  failedUploads: LocalUpload[];
  // Bumped whenever processingCount increases — see useVideoJobs.ts's
  // header comment on why this lives here rather than as banner-local
  // state (DashboardScreen/ProcessingBanner remounts when navigating to/
  // from the camera screen; this provider does not).
  processingIncreaseSignal: number;
}

const VideoJobsContext = createContext<VideoJobsContextValue | null>(null);

export function VideoJobsProvider({ athleteId, children }: { athleteId: string | undefined; children: React.ReactNode }) {
  const value = useVideoJobs(athleteId);
  return <VideoJobsContext.Provider value={value}>{children}</VideoJobsContext.Provider>;
}

export function useVideoJobsContext(): VideoJobsContextValue {
  const ctx = useContext(VideoJobsContext);
  if (!ctx) throw new Error('useVideoJobsContext() must be used within a VideoJobsProvider');
  return ctx;
}
