import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

/**
 * Returns a file:// URI that PoseView.native.tsx can read via FileSystem.
 *
 * iOS  : file:// URIs from expo-camera and expo-image-picker are already
 *        readable. No copy needed — PoseView handles the WKWebView restriction
 *        itself by encoding the file as base64 on the RN side.
 * Android: expo-image-picker can return content:// URIs that FileSystem
 *          cannot read directly, so we copy to cacheDirectory first.
 */
export async function normalizeVideoUri(uri: string): Promise<string> {
  if (Platform.OS === 'android' && uri.startsWith('content://')) {
    const ext  = uri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'mp4';
    const dest = `${FileSystem.cacheDirectory}pose_input_${Date.now()}.${ext}`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  }
  return uri;
}
