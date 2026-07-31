import { DarkTheme, NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import AppBar from './dashboard/AppBar';
import IndividualRoutineScreen from './IndividualRoutineScreen';
import OverviewScreen from './dashboard/OverviewScreen';
import PerformanceScreen, { PerformanceSub } from './dashboard/PerformanceScreen';
import SettingsScreen from './dashboard/SettingsScreen';
import FloatingTabBar from '../components/FloatingTabBar';
import ProcessingBanner from '../components/ProcessingBanner';
import UploadFailedBanner from '../components/UploadFailedBanner';
import { removeLocalUploadsByStatus } from '../state/localUploads';
import { useVideoJobsContext } from '../state/VideoJobsContext';
import { colors } from '../theme';

const Tab = createMaterialTopTabNavigator();

// ︎ = variation selector-15: forces text rendering, prevents iOS emoji substitution
const GLYPH: Record<string, string> = { Overview: '◉︎', Performance: '≡︎', Routine: '☑︎' };

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.surface, border: colors.border, text: colors.text },
};

interface Props {
  userId?: string;
  teamId?: string;
  onRecord: () => void;
  onUpload: () => void;
  onLogout: () => void;
  /** Bumped by App.tsx when a "video ready" notification is tapped — jumps to Performance > Processing. */
  jumpToProcessingSignal?: number;
}

export default function DashboardScreen({ userId, teamId, onRecord, onUpload, onLogout, jumpToProcessingSignal }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [performanceSub, setPerformanceSub] = useState<PerformanceSub>('history');
  const navRef = useNavigationContainerRef();
  const { processingCount, failedUploads, processingIncreaseSignal } = useVideoJobsContext();

  function goToProcessing() {
    setPerformanceSub('processing');
    navRef.current?.navigate('Performance' as never);
  }

  // Skip the initial mount (signal starts at 0/undefined) — only react to it
  // actually changing, i.e. a real notification tap.
  const isFirstSignal = React.useRef(true);
  useEffect(() => {
    if (isFirstSignal.current) { isFirstSignal.current = false; return; }
    goToProcessing();
  }, [jumpToProcessingSignal]);

  return (
    <View style={styles.root}>
      <AppBar
        onRecord={onRecord}
        onUpload={onUpload}
        onLogout={onLogout}
        onSettings={() => setSettingsOpen(true)}
        settingsOpen={settingsOpen}
        onBack={() => setSettingsOpen(false)}
      />
      <ProcessingBanner count={processingCount} onPress={goToProcessing} shineTrigger={processingIncreaseSignal} />
      <UploadFailedBanner count={failedUploads.length} onDismiss={() => removeLocalUploadsByStatus('failed')} />
      <View style={styles.body}>
        <NavigationContainer ref={navRef} theme={navTheme}>
          <Tab.Navigator
            tabBarPosition="bottom"
            tabBar={(props) => <FloatingTabBar {...props} glyphs={GLYPH} />}
            screenOptions={{
              lazy: true,
              swipeEnabled: false,
              animationEnabled: true,
            }}
          >
            <Tab.Screen name="Overview">
              {() => <OverviewScreen userId={userId} />}
            </Tab.Screen>
            <Tab.Screen name="Performance">
              {() => <PerformanceScreen userId={userId} sub={performanceSub} onSubChange={setPerformanceSub} />}
            </Tab.Screen>
            <Tab.Screen name="Routine">
              {() => <IndividualRoutineScreen athleteId={userId} readOnly={!!teamId} />}
            </Tab.Screen>
          </Tab.Navigator>
        </NavigationContainer>

        {/* Settings covers the tab area as an overlay so the tab state
            underneath survives opening/closing it. */}
        {settingsOpen && (
          <View style={styles.settingsOverlay}>
            <SettingsScreen onLogout={onLogout} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  settingsOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg },
});
