import * as FileSystem from 'expo-file-system/legacy';
import React, { useCallback, useRef } from 'react';
import { StyleSheet } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import { ExerciseResults } from '../../utils/exerciseAnalyzer';
import { MEDIAPIPE_HTML } from './html';

interface Props {
  videoUri: string;
  onExerciseResults?: (results: ExerciseResults) => void;
}

export default function PoseView({ videoUri, onExerciseResults }: Props) {
  const ref = useRef<WebView>(null);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(e.nativeEvent.data);
        if (msg.type === 'ready') {
          // iOS WKWebView blocks <video> from loading file:// URIs regardless of
          // allowFileAccess flags. Read as base64 on the RN side and inject as a
          // data URI — no origin restrictions apply to data URIs.
          const ext = videoUri.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'mp4';
          const mime = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
          FileSystem.readAsStringAsync(videoUri, {
            encoding: FileSystem.EncodingType.Base64,
          }).then(base64 => {
            ref.current?.injectJavaScript(
              `(function(){document.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'loadVideo',uri:'data:${mime};base64,${base64}'})}))})();true;`,
            );
          });
        }
        if (msg.type === 'exerciseResults' && onExerciseResults) {
          onExerciseResults(msg.results);
        }
      } catch {}
    },
    [videoUri, onExerciseResults],
  );

  return (
    <WebView
      ref={ref}
      source={{ html: MEDIAPIPE_HTML, baseUrl: 'file://' }}
      onMessage={onMessage}
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      cacheEnabled
      style={styles.webview}
    />
  );
}

const styles = StyleSheet.create({
  webview: { flex: 1, backgroundColor: '#0B1220' },
});
