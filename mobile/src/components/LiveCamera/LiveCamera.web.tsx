import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { LiveCameraHandle } from './types';

interface Props {
  onRecordingComplete: (uri: string) => void;
  onError: (msg: string) => void;
}

const LiveCamera = forwardRef<LiveCameraHandle, Props>(
  ({ onRecordingComplete, onError }, ref) => {
    const containerRef = useRef<any>(null);
    const videoElRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const facingRef = useRef<'user' | 'environment'>('user');

    async function startStream(facingMode: 'user' | 'environment') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoElRef.current) videoElRef.current.srcObject = stream;
      } catch (e) {
        onError('Camera access denied: ' + (e as Error).message + '. Click the camera icon in the address bar → Allow, then reload.');
      }
    }

    useEffect(() => {
      const el: HTMLElement | null = containerRef.current;
      if (!el) return;

      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('style', 'width:100%;height:100%;object-fit:contain;display:block;');
      el.appendChild(video);
      videoElRef.current = video;

      void startStream(facingRef.current);

      return () => {
        if (autoStopRef.current) clearTimeout(autoStopRef.current);
        streamRef.current?.getTracks().forEach(t => t.stop());
        if (el.contains(video)) el.removeChild(video);
        videoElRef.current = null;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(ref, () => ({
      startRecording: async (maxSeconds: number) => {
        if (!streamRef.current) {
          onError('No camera stream. Grant camera access and reload the page.');
          return;
        }
        chunksRef.current = [];
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm';
        const recorder = new MediaRecorder(streamRef.current, { mimeType });
        recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          onRecordingComplete(URL.createObjectURL(blob));
        };
        recorderRef.current = recorder;
        recorder.start(100);
        autoStopRef.current = setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop();
        }, maxSeconds * 1000);
      },
      stopRecording: () => {
        if (autoStopRef.current) clearTimeout(autoStopRef.current);
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      },
      flipCamera: () => {
        if (recorderRef.current?.state === 'recording') return;
        facingRef.current = facingRef.current === 'user' ? 'environment' : 'user';
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        void startStream(facingRef.current);
      },
    }));

    return <View ref={containerRef} style={styles.container} />;
  },
);

export default LiveCamera;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
});
