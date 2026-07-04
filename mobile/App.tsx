import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AnalysisScreen from './src/screens/AnalysisScreen';
import CameraScreen from './src/screens/CameraScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import { SettingsProvider, useSettings } from './src/state/SettingsContext';
import { configureSound } from './src/utils/sound';

type Screen = 'dashboard' | 'camera' | 'analysis';

// Simple fade-in wrapper for screen transitions (250 ms).
function FadeScreen({ children }: { children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, []);
  return <Animated.View style={{ flex: 1, opacity }}>{children}</Animated.View>;
}

function AppInner() {
  const { settings } = useSettings();
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [uploadedUri, setUploadedUri] = useState<string | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [testMode] = useState(false);

  useEffect(() => { configureSound(settings.sound); }, [settings.sound]);

  // For recording: navigate to camera immediately.
  function goToCamera() {
    setUploadedUri(null);
    setScreen('camera');
  }

  // For uploads: run the picker while staying on the dashboard, then
  // navigate to the camera review screen only after a video is selected.
  async function handleUpload() {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 1,
      });
      if (!res.canceled && res.assets?.[0]?.uri) {
        setUploadedUri(res.assets[0].uri);
        setScreen('camera');
      }
    } catch {}
  }

  function handleVideoReady(uri: string) {
    setVideoUri(uri);
    setScreen('analysis');
  }

  const showAnalysis = screen === 'analysis' && !!videoUri;

  return (
    <>
      <StatusBar style="light" />

      {screen === 'dashboard' && (
        <FadeScreen>
          <DashboardScreen
            onRecord={goToCamera}
            onUpload={() => void handleUpload()}
          />
        </FadeScreen>
      )}

      {screen === 'camera' && (
        <FadeScreen>
          <CameraScreen
            pickOnMount={false}
            testMode={testMode}
            initialVideoUri={uploadedUri ?? undefined}
            onVideoReady={handleVideoReady}
            onBack={() => { setUploadedUri(null); setScreen('dashboard'); }}
          />
        </FadeScreen>
      )}

      {/* AnalysisScreen mounts during 'loading' so the WebView + MediaPipe begin
          initialising while LoadingScreen is still visible above it. */}
      {showAnalysis && (
        <AnalysisScreen
          videoUri={videoUri!}
          onHome={() => { setVideoUri(null); setScreen('dashboard'); }}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <AppInner />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({});
