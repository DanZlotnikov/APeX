import * as FileSystem from 'expo-file-system/legacy';
import React, { useCallback, useRef } from 'react';
import { StyleSheet } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import { Assessment, ExerciseResults } from '../../utils/exerciseAnalyzer';
import { MEDIAPIPE_HTML } from './html';

interface Props {
  videoUri: string;
  onExerciseResults?: (results: ExerciseResults) => void;
  onAssessment?: (assessment: Assessment) => void;
  /** Called once real 1× playback starts (skeleton now visible to the user). */
  onReady?: () => void;
  /** 0–1 progress of the silent analysis pass preceding visible playback. */
  onProgress?: (pct: number) => void;
}

// iOS WKWebView blocks <video> from file:// URIs, and data: URIs fail for
// large files. Instead we inject the video in 1.5 MB chunks, reassemble as a
// Uint8Array inside the WebView, then create a blob: URL.
const CHUNK_BYTES = 1.5 * 1024 * 1024;

async function injectVideoChunked(
  webViewRef: React.RefObject<WebView>,
  videoUri: string,
) {
  const ext  = videoUri.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'mp4';
  const mime = ext === 'mov' ? 'video/quicktime' : 'video/mp4';

  const info = await FileSystem.getInfoAsync(videoUri, { size: true });
  const fileSize: number = (info as any).size ?? 0;
  if (!info.exists || fileSize === 0) return;

  const numChunks = Math.ceil(fileSize / CHUNK_BYTES);

  if (!webViewRef.current) return;
  webViewRef.current.injectJavaScript(`window.__vc=[];window.__vm='${mime}';true;`);

  for (let i = 0; i < numChunks; i++) {
    const wv = webViewRef.current;
    if (!wv) return;

    const position = i * CHUNK_BYTES;
    const length   = Math.min(CHUNK_BYTES, fileSize - position);
    const b64 = await FileSystem.readAsStringAsync(videoUri, {
      encoding: FileSystem.EncodingType.Base64,
      position,
      length,
    });

    wv.injectJavaScript(
      `(function(){var s=atob('${b64}');var a=new Uint8Array(s.length);for(var j=0;j<s.length;j++)a[j]=s.charCodeAt(j);window.__vc.push(a)})();true;`,
    );
  }

  const wv = webViewRef.current;
  if (!wv) return;

  wv.injectJavaScript(
    `(function(){` +
      `var b=new Blob(window.__vc,{type:window.__vm});` +
      `window.__vc=null;` +
      `var m={type:'loadVideo',uri:URL.createObjectURL(b)};` +
      `document.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(m)}));` +
    `})();true;`,
  );
}

// Module-level constant so the reference never changes across renders.
// react-native-webview reloads the page if the `source` prop reference changes,
// which was happening every time AnalysisScreen re-rendered (e.g. on setResults).
const WEBVIEW_SOURCE = { html: MEDIAPIPE_HTML, baseUrl: 'file://' };

export default function PoseView({ videoUri, onExerciseResults, onAssessment, onReady, onProgress }: Props) {
  const webViewRef  = useRef<WebView>(null);
  const videoUriRef = useRef(videoUri);
  videoUriRef.current = videoUri;

  // Keep refs to latest callbacks — onMessage is stable (no deps) but always
  // calls the current handler, preventing WebView remounts on parent re-renders.
  const onExerciseResultsRef = useRef(onExerciseResults);
  const onAssessmentRef      = useRef(onAssessment);
  const onReadyRef           = useRef(onReady);
  const onProgressRef        = useRef(onProgress);
  onExerciseResultsRef.current = onExerciseResults;
  onAssessmentRef.current      = onAssessment;
  onReadyRef.current           = onReady;
  onProgressRef.current        = onProgress;

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(e.nativeEvent.data);

        if (msg.type === 'ready') {
          void injectVideoChunked(webViewRef, videoUriRef.current);
        }
        if (msg.type === 'progress') {
          onProgressRef.current?.(msg.pct);
        }
        if (msg.type === 'playing') {
          onReadyRef.current?.();
        }
        if (msg.type === 'exerciseResults') {
          onExerciseResultsRef.current?.(msg.results);
        }
        if (msg.type === 'assessment') {
          onAssessmentRef.current?.(msg.assessment);
        }
      } catch {}
    },
    [], // stable — callbacks accessed via refs
  );

  return (
    <WebView
      ref={webViewRef}
      source={WEBVIEW_SOURCE}
      onMessage={onMessage}
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      // Restricts top-level *navigation* only (e.g. if injected/compromised
      // CDN JS ever tried `window.location = ...`) — unrelated to the
      // allowUniversalAccessFromFileURLs/allowFileAccess pair below, which
      // is what the MediaPipe CDN fetch/import actually needs and stays as
      // permissive as required. This page only ever needs to stay on its
      // own bundled file:// document, so there's no reason to allow
      // navigating anywhere else.
      originWhitelist={['file://*']}
      javaScriptEnabled
      domStorageEnabled
      cacheEnabled
      // Required on iOS: WKWebView blocks cross-origin fetches (CDN imports)
      // from a file:// base URL without this flag.
      allowUniversalAccessFromFileURLs
      allowFileAccess
      style={styles.webview}
    />
  );
}

const styles = StyleSheet.create({
  webview: { flex: 1, backgroundColor: '#0B1220' },
});
