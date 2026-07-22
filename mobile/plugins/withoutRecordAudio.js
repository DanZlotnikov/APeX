/**
 * expo-camera's compiled Android module unconditionally bundles
 * android.permission.RECORD_AUDIO in its own native AndroidManifest.xml
 * (node_modules/expo-camera/android/src/main/AndroidManifest.xml) —
 * unlike iOS, where NSMicrophoneUsageDescription is purely app-level and
 * fully controlled by expo-camera's JS config plugin (recordAudioAndroid:
 * false in app.json already suppresses that side). Recording in this app
 * is always muted (mute: true, see src/components/LiveCamera/
 * LiveCamera.native.tsx) — no audio is ever requested or used — so this
 * permission is unused collateral from the library, not something the app
 * needs. Android's manifest merger supports removing a permission a
 * dependency declares via tools:node="remove"; this plugin adds that
 * override to the app's own manifest so the final merged manifest omits it.
 */
const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

const RECORD_AUDIO = 'android.permission.RECORD_AUDIO';

module.exports = function withoutRecordAudio(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    AndroidConfig.Manifest.ensureToolsAvailable(manifest);

    manifest.manifest['uses-permission'] = (manifest.manifest['uses-permission'] ?? [])
      .filter((entry) => entry.$['android:name'] !== RECORD_AUDIO);

    manifest.manifest['uses-permission'].push({
      $: { 'android:name': RECORD_AUDIO, 'tools:node': 'remove' },
    });

    return config;
  });
};
