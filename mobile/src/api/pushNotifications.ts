/**
 * Expo push notifications for the video pipeline (HANDOFF_video_pipeline.md
 * section 3.5 / section 4 item 9): registers the device's Expo push token
 * into profiles.expo_push_token so the notify-video-ready Edge Function can
 * reach this athlete, and deep-links a tapped notification to Performance >
 * Processing.
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
