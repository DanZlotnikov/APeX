import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AnalysisScreen from './src/screens/AnalysisScreen';
import CameraScreen from './src/screens/CameraScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import HomeScreen from './src/screens/HomeScreen';
import LoadingScreen from './src/screens/LoadingScreen';
import { SettingsProvider, useSettings } from './src/state/SettingsContext';
import { configureSound } from './src/utils/sound';
import { colors } from './src/theme';

type Screen = 'home' | 'camera' | 'loading' | 'analysis' | 'dashboard';

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
  const [screen, setScreen] = useState<Screen>('home');
  const [pickOnMount, setPickOnMount] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);

  // Keep the sound module in sync with the user's toggle.
  useEffect(() => { configureSound(settings.sound); }, [settings.sound]);

  // App-level overlay that covers the WebView while MediaPipe/video loads.
  // It lives here (not inside AnalysisScreen) because WKWebView renders on a
  // native layer that React Native's zIndex inside a sibling View cannot sit
  // above. Being a later sibling of AnalysisScreen in the root JSX means the
  // OS composites it on top of the WebView's UIView automatically.
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  function goToCamera(pickFirst: boolean) {
    setPickOnMount(pickFirst);
    setScreen('camera');
  }

  function handleVideoReady(uri: string) {
    overlayOpacity.setValue(1); // reset for new analysis session
    setVideoUri(uri);
    setScreen('loading');
  }

  // Called by AnalysisScreen when the video starts playing (preprocess done).
  const handlePoseReady = useCallback(() => {
    Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: 700,
      useNativeDriver: true,
    }).start();
  }, [overlayOpacity]);

  const showAnalysis = (screen === 'loading' || screen === 'analysis') && !!videoUri;

  return (
    <>
      <StatusBar style="light" />

      {screen === 'home' && (
        <FadeScreen>
          <HomeScreen
            onGoToCamera={goToCamera}
            onOpenDashboard={() => setScreen('dashboard')}
            testMode={testMode}
            onToggleTestMode={() => setTestMode(t => !t)}
          />
        </FadeScreen>
      )}

      {screen === 'dashboard' && (
        <FadeScreen>
          <DashboardScreen onExit={() => setScreen('home')} />
        </FadeScreen>
      )}

      {screen === 'camera' && (
        <FadeScreen>
          <CameraScreen
            pickOnMount={pickOnMount}
            testMode={testMode}
            onVideoReady={handleVideoReady}
            onBack={() => setScreen('home')}
          />
        </FadeScreen>
      )}

      {/* AnalysisScreen mounts during 'loading' so WebView + MediaPipe start
          loading in the background. LoadingScreen floats above it. */}
      {showAnalysis && (
        <AnalysisScreen
          videoUri={videoUri!}
          onPoseReady={handlePoseReady}
          onRecordAgain={() => { setVideoUri(null); setPickOnMount(false); setScreen('camera'); }}
          onHome={() => { setVideoUri(null); setScreen('home'); }}
        />
      )}

      {/* Dark overlay rendered AFTER AnalysisScreen so the OS composites it
          above the WKWebView. Fades to transparent when video starts playing. */}
      {showAnalysis && (
        <Animated.View
          style={[StyleSheet.absoluteFillObject, styles.overlay, { opacity: overlayOpacity }]}
          pointerEvents="none"
        />
      )}

      {/* LoadingScreen on top of everything during the 'loading' phase */}
      {screen === 'loading' && (
        <View style={StyleSheet.absoluteFillObject}>
          <LoadingScreen onReady={() => setScreen('analysis')} />
        </View>
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

const styles = StyleSheet.create({
  overlay: { backgroundColor: colors.bg },
});
