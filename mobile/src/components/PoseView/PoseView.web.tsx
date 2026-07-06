import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
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

export default function PoseView({ videoUri, onExerciseResults, onAssessment, onReady, onProgress }: Props) {
  const containerRef = useRef<any>(null);

  // Keep refs to latest callbacks so the effect closure always calls the
  // current handler without needing to be in the dep array (which would
  // tear down and recreate the iframe on every parent re-render).
  const onExerciseResultsRef = useRef(onExerciseResults);
  const onAssessmentRef      = useRef(onAssessment);
  const onReadyRef           = useRef(onReady);
  const onProgressRef        = useRef(onProgress);
  onExerciseResultsRef.current = onExerciseResults;
  onAssessmentRef.current      = onAssessment;
  onReadyRef.current           = onReady;
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
