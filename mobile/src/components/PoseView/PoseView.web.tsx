import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Assessment, ExerciseResults } from '../../utils/exerciseAnalyzer';
import { MEDIAPIPE_HTML } from './html';

interface Props {
  videoUri: string;
  onExerciseResults?: (results: ExerciseResults) => void;
  onAssessment?: (assessment: Assessment) => void;
  onReady?: () => void;
}

export default function PoseView({ videoUri, onExerciseResults, onAssessment, onReady }: Props) {
  const containerRef = useRef<any>(null);

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

    function onMessage(ev: MessageEvent) {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '{}');
        if (msg.type === 'ready') {
          iframe.contentWindow?.postMessage(
            JSON.stringify({ type: 'loadVideo', uri: videoUri }),
            '*',
          );
        }
        if (msg.type === 'playing') {
          onReady?.();
        }
        if (msg.type === 'exerciseResults' && onExerciseResults) {
          onExerciseResults(msg.results);
        }
        if (msg.type === 'assessment' && onAssessment) {
          onAssessment(msg.assessment);
        }
      } catch {}
    }
    window.addEventListener('message', onMessage);

    return () => {
      window.removeEventListener('message', onMessage);
      URL.revokeObjectURL(blobSrc);
      if (el.contains(iframe)) el.removeChild(iframe);
    };
  }, [videoUri, onExerciseResults, onAssessment, onReady]);

  return <View ref={containerRef} style={styles.container} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1220' },
});
