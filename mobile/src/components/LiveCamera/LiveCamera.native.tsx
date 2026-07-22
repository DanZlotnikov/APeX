import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
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
      return (
        <View style={styles.placeholder}>
          <Text style={styles.hint}>Tap "Start Recording" — you'll be asked for camera permission.</Text>
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
