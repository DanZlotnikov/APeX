import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppBar from './dashboard/AppBar';
import OverviewScreen from './dashboard/OverviewScreen';
import HistoryScreen from './dashboard/HistoryScreen';
import HistoryDetailScreen from './dashboard/HistoryDetailScreen';
import SettingsScreen from './dashboard/SettingsScreen';
import { useSettings } from '../state/SettingsContext';
import { colors } from '../theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function HistoryStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="HistoryList" component={HistoryScreen} />
      <Stack.Screen name="HistoryDetail" component={HistoryDetailScreen} />
    </Stack.Navigator>
  );
}

// ︎ = variation selector-15: forces text rendering, prevents iOS emoji substitution
const GLYPH: Record<string, string> = { Overview: '◉︎', History: '≡︎' };

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.surface, border: colors.border, text: colors.text },
};

interface Props {
  onRecord: () => void;
  onUpload: () => void;
  onLogout: () => void;
}

export default function DashboardScreen({ onRecord, onUpload, onLogout }: Props) {
  const { accentColor } = useSettings();
  const insets = useSafeAreaInsets();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Floating, fully-rounded tab bar lifted off the bottom edge.
  const tabBarStyle = [styles.tabBar, { marginBottom: (insets.bottom || 0) + 12 }];

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
      <View style={styles.body}>
        <NavigationContainer theme={navTheme}>
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
            <Tab.Screen name="Overview" component={OverviewScreen} />
            <Tab.Screen name="History" component={HistoryStack} />
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
