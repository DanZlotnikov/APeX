import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { VIDEO_PLAYER_HTML } from './html';

interface Props {
  videoUri: string;
}

export default function VideoPlayer({ videoUri }: Props) {
  const containerRef = useRef<any>(null);

  useEffect(() => {
    const el: HTMLElement | null = containerRef.current;
    if (!el) return;

    const blob = new Blob([VIDEO_PLAYER_HTML], { type: 'text/html' });
    const blobSrc = URL.createObjectURL(blob);

    const iframe = document.createElement('iframe');
    iframe.src = blobSrc;
    iframe.setAttribute('style', 'width:100%;height:100%;border:none;display:block;');
    iframe.setAttribute('allow', 'autoplay');
    el.appendChild(iframe);

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
  container: { flex: 1, backgroundColor: '#07101C' },
});
