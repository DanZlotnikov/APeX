import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Assessment, ExerciseResults } from '../../utils/exerciseAnalyzer';
import { MEDIAPIPE_HTML } from './html';

interface Props {
  videoUri: string;
  onExerciseResults?: (results: ExerciseResults) => void;
  onAssessment?: (assessment: Assessment) => void;
  onReady?: () => void;
  onVideoReady?: (uri: string) => void;
  onProgress?: (pct: number) => void;
}

export default function PoseView({ videoUri, onExerciseResults, onAssessment, onReady, onVideoReady, onProgress }: Props) {
  const containerRef = useRef<any>(null);

  // Keep refs to latest callbacks so the effect closure always calls the
  // current handler without needing to be in the dep array (which would
  // tear down and recreate the iframe on every parent re-render).
  const onExerciseResultsRef = useRef(onExerciseResults);
  const onAssessmentRef      = useRef(onAssessment);
  const onReadyRef           = useRef(onReady);
  const onVideoReadyRef      = useRef(onVideoReady);
  const onProgressRef        = useRef(onProgress);
  onExerciseResultsRef.current = onExerciseResults;
  onAssessmentRef.current      = onAssessment;
  onReadyRef.current           = onReady;
  onVideoReadyRef.current      = onVideoReady;
  onProgressRef.current        = onProgress;

  useEffect(() => {
    const el: HTMLElement | null = containerRef.current;
    if (!el) return;

    const blob = new Blob([MEDIAPIPE_HTML], { type: 'text/html' });
    const blobSrc = URL.createObjectURL(blob);

    const iframe = document.createElement('iframe');
    iframe.src = blobSrc;
    iframe.setAttribute('style', 'width:100%;height:100%;border:none;display:block;');
    iframe.setAttribute('allow', 'autoplay');
    el.appendChild(iframe);

    // Rendered video chunk assembly
    const chunks: string[] = [];
    let mimeType = 'video/mp4';

    function onMessage(ev: MessageEvent) {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '{}');

        if (msg.type === 'ready') {
          iframe.contentWindow?.postMessage(
            JSON.stringify({ type: 'loadVideo', uri: videoUri }),
            '*',
          );
        }
        if (msg.type === 'progress') {
          onProgressRef.current?.(msg.pct);
        }
        if (msg.type === 'exerciseResults') {
          onExerciseResultsRef.current?.(msg.results);
        }
        if (msg.type === 'assessment') {
          onAssessmentRef.current?.(msg.assessment);
          onReadyRef.current?.();
        }
        if (msg.type === 'renderedStart') {
          chunks.length = 0;
          mimeType = msg.mimeType || 'video/mp4';
        }
        if (msg.type === 'renderedChunk') {
          chunks[msg.index] = msg.data;
        }
        if (msg.type === 'renderedDone') {
          if (msg.error) { onVideoReadyRef.current?.(''); return; }
          const b64 = chunks.join('');
          chunks.length = 0;
          const bin  = atob(b64);
          const arr  = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          const outBlob = new Blob([arr], { type: mimeType });
          onVideoReadyRef.current?.(URL.createObjectURL(outBlob));
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
