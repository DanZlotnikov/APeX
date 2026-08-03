/**
 * Async server-side video pipeline — see HANDOFF_video_pipeline.md at the
 * repo root. The app no longer analyzes video on-device: it uploads the raw
 * clip to Supabase Storage, inserts a `video_jobs` row, and a separate
 * worker process (backend/, a different codebase) picks it up, runs the
 * pose/exercise pipeline, and writes the result back.
 */
import { decode as decodeBase64 } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { deleteVideo, readJSON, resolveVideo, saveVideo, writeJSON } from '../utils/storage';
import { supabase } from './supabase';

export type VideoJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface JointCheckRep {
  rep: number;
  frame: number;
  l_value: number;
  r_value: number;
  asymmetry_pct: number;
  balance_pct: number;
  severity: 'ok' | 'watch' | 'at_risk';
}

export interface JointCheck {
  id: string;
  label: string;
  joints: string[];
  metric: 'lsi' | 'tilt';
  informational: boolean;
  balance_pct: number;
  mean_asymmetry_pct: number;
  severity: 'ok' | 'watch' | 'at_risk';
  watch_threshold_pct: number;
  at_risk_threshold_pct: number;
  description: string;
  research: string[];
  reps: JointCheckRep[];
}

export interface BalanceReport {
  method: string;
  overall_balance_pct: number;
  rep_count: number;
  joint_checks: JointCheck[];
  at_risk_joints: unknown[];
}

export interface JointRomCheckRep {
  rep: number;
  start_frame: number;
  end_frame: number;
  l_deg: number;
  r_deg: number;
  achieved_deg: number;
  rom_pct: number;
  severity: 'ok' | 'watch' | 'at_risk';
}

// Mirrors JointCheck's shape (see biomechanics/rom.py, a sibling analyzer
// to balance.py) but scores achieved-vs-expected range of motion for one
// joint (bilateral average) rather than an L/R symmetry comparison — there's
// no `joints` pair or `metric`/`asymmetry_pct` here since this isn't an
// interlimb comparison, and severity runs the opposite direction (higher
// rom_pct = better, so LOWER values are what trip watch/at_risk).
export interface JointRomCheck {
  id: string;
  label: string;
  joint: string;
  informational: boolean;
  target_rom_deg: number;
  rom_pct: number;
  severity: 'ok' | 'watch' | 'at_risk';
  watch_threshold_pct: number;
  at_risk_threshold_pct: number;
  description: string;
  research: string[];
  reps: JointRomCheckRep[];
}

export interface RomReport {
  method: string;
  overall_rom_pct: number;
  rep_count: number;
  joint_checks: JointRomCheck[];
  limited_joints: unknown[];
}

export interface JointFixationCheckRep {
  rep: number;
  start_frame: number;
  end_frame: number;
  l_deviation: number;
  r_deviation: number;
  achieved_deviation: number;
  fixation_pct: number;
  severity: 'ok' | 'watch' | 'at_risk';
}

// Mirrors JointRomCheck's shape (see biomechanics/fixation.py, a third
// sibling analyzer to balance.py/rom.py) but scores how STEADY a joint
// stayed across the whole rep window rather than how far it traveled —
// LESS deviation is better (e.g. Padel Stroke's arm should stay close to
// fixed while the shoulder leads), the opposite goal from ROM's "achieve
// enough range." `max_deviation` has no "_deg" suffix since the underlying
// signal's unit varies (degrees for an angle signal, meters for a position
// signal like wrist height) — see fixation_thresholds.py.
export interface JointFixationCheck {
  id: string;
  label: string;
  joint: string;
  informational: boolean;
  max_deviation: number;
  fixation_pct: number;
  severity: 'ok' | 'watch' | 'at_risk';
  watch_threshold_pct: number;
  at_risk_threshold_pct: number;
  description: string;
  research: string[];
  reps: JointFixationCheckRep[];
}

export interface FixationReport {
  method: string;
  overall_fixation_pct: number;
  rep_count: number;
  joint_checks: JointFixationCheck[];
  unstable_joints: unknown[];
}

export interface RepWindow {
  rep: number;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
}

export interface VideoJobAnalysis {
  exercise: string | null;
  rep_count: number;
  analyses: {
    balance?: BalanceReport;
    rom?: RomReport;
    fixation?: FixationReport;
  };
  // Canonical per-rep timing, independent of which analysis method ran —
  // see backend/GENMO/scripts/biomechanics/analysis.py's
  // run_biomechanical_analysis. Optional: absent on any session saved
  // before this field existed.
  reps?: RepWindow[];
}

export interface VideoJob {
  id: string;
  athleteId: string;
  status: VideoJobStatus;
  cancelRequested: boolean;
  rawVideoPath: string;
  resultVideoPath: string | null;
  exerciseType: string | null;
  analysis: VideoJobAnalysis | null;
  durationSec: number;
  recordedAt: string;
  errorMessage: string | null;
  createdAt: string;
}

const SELECT_COLUMNS =
  'id, athlete_id, status, cancel_requested, raw_video_path, result_video_path, ' +
  'exercise_type, analysis_json, duration_sec, recorded_at, error_message, created_at';

function fromRow(r: any): VideoJob {
  return {
    id: r.id,
    athleteId: r.athlete_id,
    status: r.status,
    cancelRequested: r.cancel_requested,
    rawVideoPath: r.raw_video_path,
    resultVideoPath: r.result_video_path,
    exerciseType: r.exercise_type,
    analysis: r.analysis_json,
    durationSec: r.duration_sec,
    recordedAt: r.recorded_at,
    errorMessage: r.error_message,
    createdAt: r.created_at,
  };
}

// Excludes cancel_requested rows unconditionally — not just while queued/
// processing. The instant an athlete taps Remove, cancel_requested flips
// true and the row must never be shown again, regardless of what status the
// worker eventually leaves the row in —
// including 'failed', if it errors while tidying up after a cancellation.
// That backend-side tidy-up crashing and relabeling a cancelled job as
// 'failed' is a real bug (see HANDOFF follow-up), but filtering here means
// the app never surfaces it either way: cancel_requested is the one flag the
// app itself sets and can rely on immediately, independent of backend timing.
export async function getVideoJobs(athleteId: string): Promise<VideoJob[]> {
  const { data, error } = await supabase
    .from('video_jobs')
    .select(SELECT_COLUMNS)
    .eq('athlete_id', athleteId)
    .eq('cancel_requested', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

// Realtime, not polling — filtered server-side to this athlete's own rows.
// NOTE: Supabase → Database → Replication must have 'video_jobs' enabled.
//
// Topic includes a random suffix, not just athleteId: supabase.channel(topic)
// returns the SAME channel object for a repeated topic string rather than a
// new one, and .on() can't be called again after .subscribe() has already
// run on it. useVideoJobs is meant to have exactly one live instance app-wide
// (see state/VideoJobsContext.tsx — every screen reads the shared context
// instead of calling this directly), but the random suffix is cheap
// insurance against a second call with the same athleteId ever colliding on
// one shared channel, e.g. during a brief remount.
export function subscribeToVideoJobs(athleteId: string, onChange: () => void): () => void {
  const topic = `video_jobs:${athleteId}:${Math.random().toString(36).slice(2)}`;
  const channel = supabase
    .channel(topic)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'video_jobs', filter: `athlete_id=eq.${athleteId}` },
      onChange,
    )
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}

// RFC4122 v4 UUID via Math.random() — no crypto dependency needed. Not
// security-sensitive: this only ever becomes a job id.
//
// Exported so a caller can generate the id BEFORE calling
// uploadAndQueueVideoJob (see App.tsx's handleVideoConfirmed) and reuse it
// for an optimistic local-upload entry (state/localUploads.ts) — the real
// video_jobs row ends up with the exact same id, so the local entry can be
// pruned the instant the real row appears instead of needing a separate
// "which local entry does this new row correspond to" matching step.
export function generateJobId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const BUCKET = 'exercise-videos';

// ── local raw-video cache ────────────────────────────────────────────────────
// A copy of the raw clip is kept on-device (keyed by job id, per-athlete like
// history.ts's history_<userId>.json) so the Processing tab can play back a
// queued/processing job instantly, with no network round-trip — see
// HANDOFF_video_pipeline.md section 4 item 2. Purely a local cache: Storage
// (raw_video_path) is the source of truth, and getSignedVideoUrl is the
// fallback if this device never had (or has lost, e.g. reinstall) the copy.
function localVideoMapFile(athleteId: string): string {
  return `video_job_local_${athleteId}.json`;
}

export async function cacheLocalRawVideo(athleteId: string, jobId: string, localUri: string): Promise<void> {
  const token = await saveVideo(localUri, jobId);
  if (!token) return;
  const map = await readJSON<Record<string, string>>(localVideoMapFile(athleteId), {});
  map[jobId] = token;
  await writeJSON(localVideoMapFile(athleteId), map);
}

export async function getLocalRawVideoUri(athleteId: string, jobId: string): Promise<string | null> {
  const map = await readJSON<Record<string, string>>(localVideoMapFile(athleteId), {});
  return resolveVideo(map[jobId] ?? null);
}

export async function deleteLocalRawVideo(athleteId: string, jobId: string): Promise<void> {
  const map = await readJSON<Record<string, string>>(localVideoMapFile(athleteId), {});
  const token = map[jobId];
  if (!token) return;
  await deleteVideo(token);
  delete map[jobId];
  await writeJSON(localVideoMapFile(athleteId), map);
}

// video/quicktime on iOS: expo-camera records .mov there, not .mp4 — see
// storage.ts's saveVideo, which derives the local-cache filename extension
// the same way. Falls back to mp4 (Android's native recording format, and
// expo-image-picker library picks are typically mp4/mov too).
const VIDEO_MIME_BY_EXT: Record<string, string> = {
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
};

// Uploads the raw clip, then inserts the video_jobs row (the id is generated
// client-side so the storage path can be built before the row exists — the
// bucket layout is raw/{athleteId}/{jobId}.<ext>, matching the RLS policies
// in migration 009; the backend worker always downloads to a fixed local
// filename regardless of this extension, so it's safe to reflect the
// clip's real container here rather than hardcoding .mp4). jobId: pass a
// pre-generated one (see generateJobId) to reuse across an optimistic
// local-upload entry and this call's real row; omitted/undefined generates
// a fresh one as before.
export async function uploadAndQueueVideoJob(params: {
  athleteId: string;
  localUri: string;
  durationSec: number;
  jobId?: string;
}): Promise<VideoJob> {
  const { athleteId, localUri, durationSec } = params;
  const jobId = params.jobId ?? generateJobId();
  const ext = (localUri.split('.').pop()?.split('?')[0] || 'mp4').toLowerCase();
  const contentType = VIDEO_MIME_BY_EXT[ext] ?? 'video/mp4';
  const path = `raw/${athleteId}/${jobId}.${ext}`;

  // ── read the file ──────────────────────────────────────────────────────────
  // NOT `fetch(localUri).then(r => r.blob())` + upload(blob, ...): confirmed
  // in production that this silently uploads 0-byte files on native. RN's
  // Blob is a lightweight reference into the native BlobModule, not real
  // in-JS binary data — when handed to supabase-js's storage upload (which
  // does a fetch()/XHR POST with the blob as the body to Supabase's REST
  // endpoint, an origin other than where the blob itself lives), the bridge
  // does not reliably materialize its bytes into the outgoing request body.
  // The request still succeeds (Storage accepts a 0-byte body as a valid,
  // if empty, upload) — no error anywhere, just silently missing content.
  // This bit us three separate times (different recordings, different
  // extensions/content-types, full app reloads in between) before the
  // pattern was clear enough to be sure it wasn't the camera or the reload.
  //
  // Reading the file as base64 via FileSystem and decoding to a real
  // ArrayBuffer avoids the native Blob bridge entirely — the bytes live in
  // JS memory the whole way through, exactly the workaround Supabase's own
  // React Native storage docs recommend. Web is unaffected (browsers' fetch
  // Blob is a real, spec-compliant Blob, not a bridge reference), so it
  // keeps the simpler fetch().blob() path.
  let uploadBody: ArrayBuffer | Blob;
  if (Platform.OS === 'web') {
    const response = await fetch(localUri);
    uploadBody = await response.blob();
    if (!(uploadBody as Blob).size) {
      throw new Error('This recording appears to be empty. Please try recording again.');
    }
  } else {
    const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
    if (!base64) {
      throw new Error('This recording appears to be empty. Please try recording again.');
    }
    uploadBody = decodeBase64(base64);
    if (uploadBody.byteLength === 0) {
      throw new Error('This recording appears to be empty. Please try recording again.');
    }
  }

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, uploadBody, { contentType, upsert: true });
  if (uploadErr) throw uploadErr;

  const { data, error: insertErr } = await supabase
    .from('video_jobs')
    .insert({
      id: jobId,
      athlete_id: athleteId,
      raw_video_path: path,
      duration_sec: durationSec,
      recorded_at: new Date().toISOString(),
    })
    .select(SELECT_COLUMNS)
    .single();
  if (insertErr) throw insertErr;

  // Best-effort — a failure here just means the Processing tab falls back to
  // a signed URL for this job instead of the instant local copy.
  await cacheLocalRawVideo(athleteId, jobId, localUri);

  return fromRow(data);
}

// queued -> deleted immediately (worker never touched it); processing ->
// cancel_requested flag, worker deletes it once it notices (see the RPC).
export async function cancelVideoJob(jobId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_video_job', { p_job_id: jobId });
  if (error) throw error;
}

// Deletes the video_jobs row (must be 'completed'); the two storage objects
// are deleted separately by the caller (see deleteJobStorage) — RLS permits
// an athlete to delete their own raw/processed objects directly.
export async function discardVideoJob(jobId: string): Promise<void> {
  const { error } = await supabase.rpc('discard_video_job', { p_job_id: jobId });
  if (error) throw error;
}

// Inserts the `sessions` row (+ session_metrics + manager notification, if
// any) from the completed job and deletes the video_jobs row — all inside
// the RPC, see migration 009. Returns the new session id.
export async function saveVideoJob(jobId: string): Promise<string> {
  const { data, error } = await supabase.rpc('save_video_job', { p_job_id: jobId });
  if (error) throw error;
  return data as string;
}

export async function deleteJobStorage(job: Pick<VideoJob, 'rawVideoPath' | 'resultVideoPath'>): Promise<void> {
  const paths = [job.rawVideoPath, job.resultVideoPath].filter((p): p is string => !!p);
  if (!paths.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) console.warn('[APeX] Failed to delete video_jobs storage objects:', error.message);
}

export async function getSignedVideoUrl(path: string, expiresInSec = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSec);
  if (error) {
    console.warn('[APeX] Failed to sign video URL:', error.message);
    return null;
  }
  return data.signedUrl;
}
