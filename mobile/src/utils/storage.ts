/**
 * Cross-platform persistence for APeX.
 *
 * One tiny async API used by the whole app so callers never branch on platform:
 *   - JSON docs (profile / settings / history) via readJSON / writeJSON
 *   - analyzed videos copied into durable storage via saveVideo / resolveVideo
 *
 * Native (iOS/Android): expo-file-system legacy API. JSON lives in
 * documentDirectory; videos are copied into documentDirectory/videos and stored
 * by *filename only* — the absolute documentDirectory can change between app
 * installs/updates, so we always rebuild the full path at read time.
 *
 * Web: localStorage for JSON; videos keep their (ephemeral) object URL. Web is a
 * best-effort dev/demo target — native is the source of truth.
 */
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

// Lazily required so web bundles don't choke on the native module.
function fs() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('expo-file-system/legacy');
}

const VIDEO_DIR = 'videos/';

function docDir(): string {
  return fs().documentDirectory ?? '';
}

async function ensureVideoDir(): Promise<string> {
  const dir = docDir() + VIDEO_DIR;
  const info = await fs().getInfoAsync(dir);
  if (!info.exists) await fs().makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

// ── JSON documents ────────────────────────────────────────────────────────────

export async function readJSON<T>(name: string, fallback: T): Promise<T> {
  try {
    if (isWeb) {
      const raw = window.localStorage.getItem('apex:' + name);
      return raw ? (JSON.parse(raw) as T) : fallback;
    }
    const path = docDir() + name;
    const info = await fs().getInfoAsync(path);
    if (!info.exists) return fallback;
    const raw = await fs().readAsStringAsync(path);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function writeJSON<T>(name: string, data: T): Promise<void> {
  const raw = JSON.stringify(data);
  try {
    if (isWeb) {
      window.localStorage.setItem('apex:' + name, raw);
      return;
    }
    await fs().writeAsStringAsync(docDir() + name, raw);
  } catch {
    // best-effort; a failed write should never crash the app
  }
}

// ── videos ────────────────────────────────────────────────────────────────────

/**
 * Copy an analyzed video into durable storage. Returns a token to persist:
 * on native the filename, on web the original object URL. null on failure.
 */
export async function saveVideo(srcUri: string, id: string): Promise<string | null> {
  try {
    if (isWeb) return srcUri; // object URL; not durable, acceptable on web
    const ext = (srcUri.split('.').pop()?.split('?')[0] || 'mp4').toLowerCase();
    const filename = id + '.' + ext;
    const dir = await ensureVideoDir();
    await fs().copyAsync({ from: srcUri, to: dir + filename });
    return filename;
  } catch {
    return null;
  }
}

/** Rebuild a playable URI from a stored video token. */
export function resolveVideo(token: string | null): string | null {
  if (!token) return null;
  if (isWeb) return token;
  return docDir() + VIDEO_DIR + token;
}

export async function deleteVideo(token: string | null): Promise<void> {
  if (!token || isWeb) return;
  try {
    await fs().deleteAsync(docDir() + VIDEO_DIR + token, { idempotent: true });
  } catch {
    // ignore
  }
}
