/**
 * Expo push notifications. Two directions live in this file:
 *   1. This device's OWN registration (HANDOFF_video_pipeline.md section 3.5
 *      / section 4 item 9): registers the device's Expo push token into
 *      profiles.expo_push_token so the notify-video-ready Edge Function can
 *      reach this athlete, and deep-links a tapped notification to
 *      Performance > Processing.
 *   2. Sending a push TO someone else (pokeAthlete, below) — the manager
 *      "poke" action. Unlike notify-video-ready (a Database Webhook, so it
 *      has to run server-side as an Edge Function with the service-role
 *      key), a poke is a direct manager button-tap with no DB event to hang
 *      a webhook off of, so it runs client-side instead: it reads the
 *      target athlete's own already-registered token directly (RLS already
 *      scopes profiles reads to same-team members, see migration 001's
 *      "read team profiles" policy — a manager already can't read a
 *      different team's athlete this way) and posts straight to Expo's push
 *      API, same endpoint notify-video-ready calls server-side.
 *
 * IMPORTANT (per the handoff): Expo Go dropped support for remote push
 * notifications in SDK 53 (this project is on SDK 54) — getExpoPushTokenAsync
 * will throw/no-op in Expo Go regardless of what's done here. Registration
 * is best-effort and never blocks sign-in; it will only actually succeed
 * once the app is running from an EAS development build. Local
 * notifications and the tap-response listener below are unaffected by that
 * limitation and work in Expo Go today.
 */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(userId: string): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);

    const { error } = await supabase
      .from('profiles')
      .update({ expo_push_token: data })
      .eq('id', userId);
    if (error) throw error;
  } catch (e) {
    // Expected in Expo Go (no remote push support since SDK 53) and whenever
    // there's no EAS projectId configured yet — never blocks sign-in.
    console.warn('[APeX] Push notification registration skipped:', e instanceof Error ? e.message : e);
  }
}

/** Fires when the athlete taps a notification — jobId matches notify-video-ready's payload (data.jobId). */
export function addNotificationTapListener(onTap: (jobId: string) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const jobId = response.notification.request.content.data?.jobId;
    if (typeof jobId === 'string') onTap(jobId);
  });
  return () => sub.remove();
}

/**
 * Manager "poke" — sends the athlete a real device push nudging them about
 * today's remaining routine. Deliberately NOT the in-app notifications
 * table/dropdown (api/notifications.ts) — that's the separate athlete-to-
 * manager "completed a session" pipeline; this is manager-to-athlete and
 * only ever a real push. Throws with a message safe to show the manager
 * directly (e.g. "hasn't enabled notifications yet") rather than a raw
 * Supabase/fetch error.
 */
export async function pokeAthlete(athleteId: string, missingCount: number): Promise<void> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('expo_push_token')
    .eq('id', athleteId)
    .single();
  if (error) throw error;

  const token = profile?.expo_push_token;
  if (!token) throw new Error("This athlete hasn't enabled notifications yet.");

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: token,
      title: 'Training Reminder',
      body: `You have ${missingCount} exercise${missingCount === 1 ? '' : 's'} to complete today 💪`,
      sound: 'default',
    }),
  });

  // Expo's push API returns HTTP 200 even for a per-ticket failure (e.g. a
  // stale/unregistered token) — the real result is in the response body,
  // not the status code, so both have to be checked.
  const json = await res.json().catch(() => null);
  const ticket = Array.isArray(json?.data) ? json.data[0] : json?.data;
  if (!res.ok || ticket?.status === 'error') {
    throw new Error(ticket?.message || 'Failed to send notification. Please try again.');
  }
}
