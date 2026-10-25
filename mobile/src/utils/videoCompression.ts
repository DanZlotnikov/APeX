/**
 * Shrinks a recording on the phone so it always fits Supabase's per-file upload limit (50 MB on the
 * free plan — a bigger file is rejected with 413 EntityTooLarge and the athlete just sees "upload
 * failed"). Athletes can film or pick whatever they like: a 20 s clip at 4K/60fps is 200+ MB.
 *
 * Clips already under DIRECT_UPLOAD_BYTES are uploaded untouched, exactly as before. Bigger ones are
 * re-encoded to at most 1280 px on the long edge (the pose pipeline works on a person crop of a few
 * hundred pixels, and the server resamples to 30 fps itself, so nothing it measures is lost) at a
 * bitrate chosen from the clip's length so the result lands near TARGET_BYTES. Audio is dropped; the
 * pipeline never reads it.
 *
 * Native only (react-native-compressor needs an EAS build, not Expo Go). If compression can't run,
 * a file that still fits the limit is uploaded as it is; one that doesn't is refused with a message
 * that says what to do, instead of failing at the server.
 */
import { Platform } from 'react-native';

const MB = 1024 * 1024;

/** The server's per-file limit is 50 MB; stay clear of it. */
export const MAX_UPLOAD_BYTES = 48 * MB;
/** At or below this, upload the file as recorded. */
export const DIRECT_UPLOAD_BYTES = 30 * MB;
/** What a compressed clip should come out around. */
export const TARGET_BYTES = 24 * MB;

export const MAX_EDGE_PX = 1280;
const BITRATE_MAX = 8_000_000; // plenty for 720p sport footage; a short clip never needs more
const BITRATE_MIN = 700_000;
const MUXING_MARGIN = 0.92; // encoders overshoot a requested bitrate a little, and the container adds some
/** Used when the clip's length is unknown (some library picks): assume a long one. */
const ASSUMED_DURATION_SEC = 30;
/** Past this even the minimum bitrate can't be trusted to fit; ask for a shorter clip. */
export const MAX_DURATION_SEC = 240;

export type CompressionPlan =
  | { action: 'direct' }
  | { action: 'compress'; bitrate: number }
  | { action: 'reject'; reason: string };

/** Bits per second that bring a clip of this length to about TARGET_BYTES. */
export function bitrateFor(durationSec: number, targetBytes = TARGET_BYTES): number {
  const secs = durationSec > 0 ? durationSec : ASSUMED_DURATION_SEC;
  const bitrate = Math.floor((targetBytes * 8 * MUXING_MARGIN) / secs);
  return Math.max(BITRATE_MIN, Math.min(BITRATE_MAX, bitrate));
}

export function planCompression(sizeBytes: number, durationSec: number): CompressionPlan {
  if (sizeBytes <= DIRECT_UPLOAD_BYTES) return { action: 'direct' };
  if (durationSec > MAX_DURATION_SEC) {
    return { action: 'reject', reason: 'This video is too long to upload. Please choose a shorter clip of a few swings.' };
  }
  return { action: 'compress', bitrate: bitrateFor(durationSec) };
}

export const TOO_LARGE_MESSAGE =
  'This video is too large to upload and could not be made smaller. Please record a shorter clip.';

export interface PreparedVideo {
  uri: string;
  /** True when `uri` is a temporary compressed copy the caller should delete once it's done with it. */
  isTemporary: boolean;
}

function fs() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
}

async function sizeOf(uri: string): Promise<number | null> {
  try {
    const info = await fs().getInfoAsync(uri);
    return info.exists && typeof info.size === 'number' ? info.size : null;
  } catch {
    return null;
  }
}

export async function deleteTemporaryVideo(video: PreparedVideo): Promise<void> {
  if (!video.isTemporary) return;
  try {
    await fs().deleteAsync(video.uri, { idempotent: true });
  } catch {
    // a leftover cache file is harmless; the OS clears the cache directory
  }
}

/**
 * Returns a file to upload that fits the server's limit. Throws an Error whose message is safe to
 * show the athlete when it can't.
 */
export async function prepareVideoForUpload(
  uri: string,
  durationSec: number,
  onStatus?: (status: 'compressing') => void,
): Promise<PreparedVideo> {
  if (Platform.OS === 'web') return { uri, isTemporary: false }; // the web build has no native encoder

  const original = await sizeOf(uri);
  if (original == null) return { uri, isTemporary: false }; // can't tell; the upload itself will say

  const plan = planCompression(original, durationSec);
  if (plan.action === 'direct') return { uri, isTemporary: false };
  if (plan.action === 'reject') throw new Error(plan.reason);

  onStatus?.('compressing');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Video } = require('react-native-compressor') as typeof import('react-native-compressor');
    let bitrate = plan.bitrate;
    for (let attempt = 0; attempt < 2; attempt++) {
      const out = await Video.compress(uri, {
        compressionMethod: 'manual',
        maxSize: MAX_EDGE_PX,
        bitrate,
        minimumFileSizeForCompress: 0, // we already decided; never let the library skip it
        stripAudio: true,
      });
      const size = await sizeOf(out);
      if (size != null && size <= MAX_UPLOAD_BYTES) {
        // Re-encoding can't make an already-small clip better; keep the original if it fits.
        if (size >= original && original <= MAX_UPLOAD_BYTES) {
          await deleteTemporaryVideo({ uri: out, isTemporary: true });
          return { uri, isTemporary: false };
        }
        return { uri: out, isTemporary: true };
      }
      await deleteTemporaryVideo({ uri: out, isTemporary: true });
      bitrate = Math.max(Math.floor(bitrate / 2), 400_000); // came out too big: once more at half
    }
  } catch (e) {
    console.warn('[APeX] Video compression failed:', e);
  }

  // Compression didn't happen or didn't get under the limit. Upload the original only if it fits.
  if (original <= MAX_UPLOAD_BYTES) return { uri, isTemporary: false };
  throw new Error(TOO_LARGE_MESSAGE);
}
