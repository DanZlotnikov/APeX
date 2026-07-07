import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AthleteViewModel } from '../../api/types';
import { useSettings } from '../../state/SettingsContext';
import { colors } from '../../theme';
import ExercisesScreen from './ExercisesScreen';
import ManagerDashboard from './ManagerDashboard';

const Tab = createBottomTabNavigator();

// ︎ = variation selector-15: forces text rendering, prevents iOS emoji substitution
const GLYPH: Record<string, string> = { Athletes: '◉︎', Exercises: '▤︎' };

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.surface, border: colors.border, text: colors.text },
};

interface Props {
  teamId: string;
  onAthleteSelect: (athlete: AthleteViewModel) => void;
}

export default function ManagerHome({ teamId, onAthleteSelect }: Props) {
  const { accentColor } = useSettings();
  const insets = useSafeAreaInsets();

  const tabBarStyle = [styles.tabBar, { marginBottom: (insets.bottom || 0) + 12 }];

  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: accentColor,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle,
          tabBarItemStyle: styles.tabItem,
          tabBarLabelStyle: styles.tabLabel,
          tabBarLabelPosition: 'below-icon',
          tabBarIcon: ({ color }) => (
            <Text style={[styles.glyph, { color }]}>{GLYPH[route.name] ?? '•'}</Text>
          ),
        })}
      >
        <Tab.Screen name="Athletes">
          {() => <ManagerDashboard teamId={teamId} onAthleteSelect={onAthleteSelect} />}
        </Tab.Screen>
        <Tab.Screen name="Exercises">
          {() => <ExercisesScreen teamId={teamId} />}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
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
