import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import AnalysisScreen from './src/screens/AnalysisScreen';
import CameraScreen from './src/screens/CameraScreen';
import HomeScreen from './src/screens/HomeScreen';
import LoadingScreen from './src/screens/LoadingScreen';

type Screen = 'home' | 'camera' | 'loading' | 'analysis';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [pickOnMount, setPickOnMount] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);

  function goToCamera(pickFirst: boolean) {
    setPickOnMount(pickFirst);
    setScreen('camera');
  }

  function handleVideoReady(uri: string) {
    setVideoUri(uri);
    setScreen('loading');
  }

  return (
    <>
      <StatusBar style="light" />
      {screen === 'home' && (
        <HomeScreen
          onGoToCamera={goToCamera}
          testMode={testMode}
          onToggleTestMode={() => setTestMode(t => !t)}
        />
      )}
      {screen === 'camera' && (
        <CameraScreen
          pickOnMount={pickOnMount}
          testMode={testMode}
          onVideoReady={handleVideoReady}
          onBack={() => setScreen('home')}
        />
      )}
      {screen === 'loading' && (
        <LoadingScreen onReady={() => setScreen('analysis')} />
      )}
      {screen === 'analysis' && videoUri && (
        <AnalysisScreen
          videoUri={videoUri}
          onRecordAgain={() => { setVideoUri(null); setScreen('camera'); }}
          onHome={() => { setVideoUri(null); setScreen('home'); }}
        />
      )}
    </>
  );
}
