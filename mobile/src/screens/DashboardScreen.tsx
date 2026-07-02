import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { DashboardContext } from './dashboard/DashboardContext';
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

const GLYPH: Record<string, string> = { Overview: '◉', History: '≡', Settings: '⚙' };

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.surface, border: colors.border, text: colors.text },
};

interface Props {
  onExit: () => void;
}

export default function DashboardScreen({ onExit }: Props) {
  const { accentColor } = useSettings();

  return (
    <DashboardContext.Provider value={{ onExit }}>
      <NavigationContainer theme={navTheme}>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor: accentColor,
            tabBarInactiveTintColor: colors.muted,
            tabBarStyle: styles.tabBar,
            tabBarLabelStyle: styles.tabLabel,
            tabBarIcon: ({ color }) => (
              <Text style={[styles.glyph, { color }]}>{GLYPH[route.name] ?? '•'}</Text>
            ),
          })}
        >
          <Tab.Screen name="Overview" component={OverviewScreen} />
          <Tab.Screen name="History" component={HistoryStack} />
          <Tab.Screen name="Settings" component={SettingsScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </DashboardContext.Provider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    height: 62,
    paddingTop: 6,
    paddingBottom: 8,
  },
  tabLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  glyph: { fontSize: 18, lineHeight: 22 },
});
