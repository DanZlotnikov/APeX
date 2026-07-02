/**
 * Optional UI feedback sound (a soft two-note chime), gated by the Settings
 * "sound" toggle. The audio is a tiny WAV synthesized once and embedded as a
 * base64 data-URI, so there's no binary asset to ship and it plays on native
 * and web alike via expo-av.
 */
import { Audio } from 'expo-av';

const CHIME_B64 =
  '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';

const CHIME_URI = 'data:audio/wav;base64,' + CHIME_B64;

let enabled = true;
let sound: Audio.Sound | null = null;
let loading: Promise<void> | null = null;

/** Called by SettingsProvider so the module reflects the user's toggle. */
export function configureSound(on: boolean): void {
  enabled = on;
}

async function ensureLoaded(): Promise<void> {
  if (sound) return;
  if (!loading) {
    loading = (async () => {
      try {
        const { sound: s } = await Audio.Sound.createAsync({ uri: CHIME_URI }, { volume: 0.5 });
        sound = s;
      } catch {
        // audio may be unavailable (e.g. autoplay-blocked web); fail silently
      }
    })();
  }
  return loading;
}

/** Play the chime if the user has sound enabled. Never throws. */
export async function playChime(): Promise<void> {
  if (!enabled) return;
  try {
    await ensureLoaded();
    if (sound) await sound.replayAsync();
  } catch {
    // ignore
  }
}
