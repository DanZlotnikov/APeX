/**
 * Single shared instance of useVideoJobs, provided via Context so every
 * consumer (the app-wide banner, the Performance tab's "PROCESSING (N)"
 * label, the Processing tab's own list, Today's Tasks) reads the exact same
 * state instead of each running its own independent useVideoJobs() call.
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

interface VideoJobsContextValue {
  jobs: VideoJob[];
  loading: boolean;
  processingCount: number;
  refetch: () => Promise<void>;
  // Instantly excludes a job from processingCount (but not from `jobs`
  // itself — see useVideoJobs.ts) the moment an action is taken, without
  // waiting on the real Realtime round-trip. Call this from any
  // Save/Discard/Remove handler.
  markPendingRemoval: (jobId: string) => void;
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
