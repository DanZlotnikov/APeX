import { DarkTheme, NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppBar from './dashboard/AppBar';
import OverviewScreen from './dashboard/OverviewScreen';
import PerformanceScreen, { PerformanceSub } from './dashboard/PerformanceScreen';
import RoutineScreen from './dashboard/RoutineScreen';
import SettingsScreen from './dashboard/SettingsScreen';
import { TargetExercise } from '../api/types';
import ProcessingBanner from '../components/ProcessingBanner';
import { useSettings } from '../state/SettingsContext';
import { useVideoJobsContext } from '../state/VideoJobsContext';
import { colors } from '../theme';

const Tab = createBottomTabNavigator();

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
  onSelectTask: (target: TargetExercise) => void;
  onLogout: () => void;
  /** Bumped by App.tsx when a "video ready" notification is tapped — jumps to Performance > Processing. */
  jumpToProcessingSignal?: number;
}

export default function DashboardScreen({ userId, teamId, onRecord, onUpload, onSelectTask, onLogout, jumpToProcessingSignal }: Props) {
  const { accentColor } = useSettings();
  const insets = useSafeAreaInsets();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [performanceSub, setPerformanceSub] = useState<PerformanceSub>('history');
  const navRef = useNavigationContainerRef();
  const { processingCount } = useVideoJobsContext();

  // Floating, fully-rounded tab bar lifted off the bottom edge.
  const tabBarStyle = [styles.tabBar, { marginBottom: (insets.bottom || 0) + 12 }];

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
      <ProcessingBanner count={processingCount} onPress={goToProcessing} />
      <View style={styles.body}>
        <NavigationContainer ref={navRef} theme={navTheme}>
          <Tab.Navigator
            screenOptions={({ route }) => ({
              headerShown: false,
              tabBarActiveTintColor: accentColor,
              tabBarInactiveTintColor: colors.muted,
              tabBarStyle: tabBarStyle,
              tabBarItemStyle: styles.tabItem,
              tabBarLabelStyle: styles.tabLabel,
              tabBarLabelPosition: 'below-icon',
              tabBarIcon: ({ color }) => (
                <Text style={[styles.glyph, { color }]}>{GLYPH[route.name] ?? '•'}</Text>
              ),
            })}
          >
            <Tab.Screen name="Overview">
              {() => <OverviewScreen userId={userId} teamId={teamId} onSelectTask={onSelectTask} />}
            </Tab.Screen>
            <Tab.Screen name="Performance">
              {() => <PerformanceScreen userId={userId} sub={performanceSub} onSubChange={setPerformanceSub} />}
            </Tab.Screen>
            <Tab.Screen name="Routine">
              {() => <RoutineScreen userId={userId} teamId={teamId} />}
            </Tab.Screen>
          </Tab.Navigator>
        </NavigationContainer>

        {/* Settings covers the tab area as an overlay so the tab state
            underneath survives opening/closing it. */}
        {settingsOpen && (
          <View style={styles.settingsOverlay}>
            <SettingsScreen />
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
  tabBar: {
    height: 62,
    marginHorizontal: 16,
    borderRadius: 32,
    borderWidth: 1,
    borderTopWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceHigh,
    paddingTop: 0,
    paddingBottom: 0,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  tabItem: { marginTop: 3, flex: 1, height: 60, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  tabLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: -2 },
  glyph: { fontSize: 18, lineHeight: 20 },
});
