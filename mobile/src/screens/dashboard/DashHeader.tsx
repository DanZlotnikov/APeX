import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSettings } from '../../state/SettingsContext';
import { colors, spacing } from '../../theme';

interface Props {
  title: string;
  onBack?: () => void; // shows a back chevron (detail / pushed screens)
}

/** Header for pushed dashboard screens (e.g. session detail): back + title. */
export default function DashHeader({ title, onBack }: Props) {
  const { accentColor, fontScale } = useSettings();
  return (
    <View style={styles.bar}>
      <View style={styles.side}>
        {onBack && (
          <Pressable hitSlop={10} onPress={onBack} style={({ pressed }) => pressed && styles.pressed}>
            <Text style={[styles.icon, { color: accentColor }]}>‹</Text>
          </Pressable>
        )}
      </View>
      <Text style={[styles.title, { fontSize: 13 * fontScale }]} numberOfLines={1}>{title}</Text>
      <View style={styles.side} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  side: { width: 40, justifyContent: 'center' },
  right: { alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center', color: colors.text, fontWeight: '800', letterSpacing: 2 },
  icon: { fontSize: 30, fontWeight: '300', lineHeight: 30 },
  close: { color: colors.muted, fontSize: 18, fontWeight: '500' },
  pressed: { opacity: 0.4 },
});
