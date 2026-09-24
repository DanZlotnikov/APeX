import { MaterialTopTabBarProps } from '@react-navigation/material-top-tabs';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '../state/SettingsContext';
import { colors } from '../theme';

interface Props extends MaterialTopTabBarProps {
  /** Route name -> glyph character. ︎ = variation selector-15 in the glyph
   * itself forces text rendering, prevents iOS emoji substitution. */
  glyphs: Record<string, string>;
}

// Same floating, fully-rounded pill every tab bar in this app already used
// under createBottomTabNavigator — rebuilt as a custom material-top-tabs
// tabBar (see DashboardScreen.tsx / AthleteDetailPreview.tsx) so those
// navigators' pager can drive an actual slide transition between screens
// (bottom-tabs has no such thing — it only ever instantly swaps), while the
// bar itself looks and behaves exactly as before.
export default function FloatingTabBar({ state, descriptors, navigation, glyphs }: Props) {
  const { accentColor } = useSettings();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.tabBar, { marginBottom: (insets.bottom || 0) + 12 }]}>
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const color = isFocused ? accentColor : colors.muted;

        function onPress() {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        }

        return (
          <Pressable key={route.key} onPress={onPress} style={styles.tabItem}>
            <Text style={[styles.glyph, { color }]}>{glyphs[route.name] ?? '•'}</Text>
            <Text style={[styles.tabLabel, { color }]}>{route.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    height: 62,
    marginHorizontal: 16,
    borderRadius: 32,
    borderWidth: 1,
    borderTopWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceHigh,
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
