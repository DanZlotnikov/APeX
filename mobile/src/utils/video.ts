import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

/**
 * Ensures the video is at a file:// path inside the app sandbox that the
 * WKWebView (iOS) and WebView (Android) can load without security errors.
 *
 * iOS: WKWebView only allows <video> to load files that are under its baseURL
 * directory. Copying to cacheDirectory (which we also use as baseURL) fixes this.
 * Android: expo-image-picker can return content:// URIs that WebView can't read.
 */
export async function normalizeVideoUri(uri: string): Promise<string> {
  const ext = uri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'mp4';
  const dest = `${FileSystem.cacheDirectory}pose_input_${Date.now()}.${ext}`;

  if (Platform.OS === 'ios' || (Platform.OS === 'android' && uri.startsWith('content://'))) {
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  }
  return uri;
}
