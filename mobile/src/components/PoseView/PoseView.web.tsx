import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { MEDIAPIPE_HTML } from './html';

interface Props {
  videoUri: string;
}

/**
 * Web implementation: mounts the MediaPipe HTML page inside a programmatically
 * created <iframe> so we stay in Expo/React Native component space (no raw JSX
 * DOM elements, no TypeScript lib:dom conflicts).
 *
 * Blob URLs: the iframe is loaded from a blob: URL derived from the same origin
 * as the parent page, so the video blob: / file URI is accessible from inside.
 */
export default function PoseView({ videoUri }: Props) {
  // ref typed as `any` — we only use it as a DOM node in useEffect (web only).
  const containerRef = useRef<any>(null);

  useEffect(() => {
    const el: HTMLElement | null = containerRef.current;
    if (!el) return;

    // Create an iframe containing the full MediaPipe HTML pipeline.
    const blob = new Blob([MEDIAPIPE_HTML], { type: 'text/html' });
    const blobSrc = URL.createObjectURL(blob);

    const iframe = document.createElement('iframe');
    iframe.src = blobSrc;
    iframe.setAttribute('style', 'width:100%;height:100%;border:none;display:block;');
    iframe.setAttribute('allow', 'autoplay');
    el.appendChild(iframe);

    // Forward 'ready' from iframe → send video URI back in.
    function onMessage(ev: MessageEvent) {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '{}');
        if (msg.type === 'ready') {
          iframe.contentWindow?.postMessage(
            JSON.stringify({ type: 'loadVideo', uri: videoUri }),
            '*',
          );
        }
      } catch {}
    }
    window.addEventListener('message', onMessage);

    return () => {
      window.removeEventListener('message', onMessage);
      URL.revokeObjectURL(blobSrc);
      if (el.contains(iframe)) el.removeChild(iframe);
    };
  }, [videoUri]);

  return <View ref={containerRef} style={styles.container} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1220' },
});
