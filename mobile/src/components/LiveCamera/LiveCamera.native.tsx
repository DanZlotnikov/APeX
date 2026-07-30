import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../../theme';
import { LiveCameraHandle } from './types';

interface Props {
  onRecordingComplete: (uri: string) => void;
  onError: (msg: string) => void;
}

const LiveCamera = forwardRef<LiveCameraHandle, Props>(
  ({ onRecordingComplete, onError }, ref) => {
    const [cameraPerm, requestCameraPerm] = useCameraPermissions();
    const cameraRef = useRef<CameraView>(null);
    const [facing, setFacing] = useState<'front' | 'back'>('back');

    // Ask as soon as this screen mounts instead of waiting for the athlete
    // to tap Start Recording — matches the web version (LiveCamera.web.tsx),
    // which already requests getUserMedia immediately on mount. Only fires
    // once, on the very first visit ('undetermined' means never asked yet);
    // once the athlete has answered (granted or denied), re-mounting this
    // screen won't re-trigger the native OS prompt again.
    useEffect(() => {
      if (cameraPerm?.status === 'undetermined') {
        void requestCameraPerm();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cameraPerm?.status]);

    useImperativeHandle(ref, () => ({
      startRecording: async (maxSeconds: number) => {
        const cam = cameraPerm?.granted ? cameraPerm : await requestCameraPerm();
        if (!cam?.granted) {
          onError('Camera permission required.');
          return;
        }
        try {
          const result = await cameraRef.current?.recordAsync({ maxDuration: maxSeconds, mute: true } as any);
          if (result?.uri) onRecordingComplete(result.uri);
        } catch (e) {
          onError(e instanceof Error ? e.message : 'Recording failed.');
        }
      },
      stopRecording: () => cameraRef.current?.stopRecording(),
      flipCamera: () => setFacing(f => f === 'back' ? 'front' : 'back'),
    }));

    if (!cameraPerm?.granted) {
      const deniedForGood = cameraPerm?.status === 'denied' && !cameraPerm.canAskAgain;
      return (
        <View style={styles.placeholder}>
          <Text style={styles.hint}>
            {deniedForGood
              ? 'Camera access is off. Enable it for APeX in your device Settings to record.'
              : 'Requesting camera permission…'}
          </Text>
        </View>
      );
    }

    return <CameraView ref={cameraRef} style={styles.camera} mode="video" facing={facing} />;
  },
);

export default LiveCamera;

const styles = StyleSheet.create({
  camera: { flex: 1 },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  hint: { color: colors.muted, textAlign: 'center', fontSize: 14 },
});
