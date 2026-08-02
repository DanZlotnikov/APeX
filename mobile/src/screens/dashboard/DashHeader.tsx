import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSettings } from '../../state/SettingsContext';
import { colors, spacing } from '../../theme';

interface Props {
  title: string;
  onBack?: () => void; // shows a back chevron (detail / pushed screens)
  /** Shown as "‹ {backLabel}" instead of a bare chevron — the name of the
   * screen Back actually returns to, iOS-style. Omit for the existing bare-
   * chevron look (unchanged for every current caller). */
  backLabel?: string;
}

/** Header for pushed dashboard screens (e.g. session detail): back + title. */
export default function DashHeader({ title, onBack, backLabel }: Props) {
  const { accentColor, fontScale } = useSettings();
  return (
    <View style={styles.bar}>
      <View style={[styles.side, !!backLabel && styles.sideAuto]}>
        {onBack && (
          <Pressable hitSlop={10} onPress={onBack} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
            <Text style={[styles.icon, { color: accentColor }]}>‹</Text>
            {backLabel && (
              <Text style={[styles.backLabelText, { color: accentColor }]} numberOfLines={1}>{backLabel}</Text>
            )}
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
  sideAuto: { width: undefined, maxWidth: '42%' },
  backBtn: { flexDirection: 'row', alignItems: 'center' },
  backLabelText: { fontSize: 15, fontWeight: '600', marginLeft: 1, marginTop: 1 },
  right: { alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center', color: colors.text, fontWeight: '800', letterSpacing: 2 },
  icon: { fontSize: 30, fontWeight: '300', lineHeight: 30 },
  close: { color: colors.muted, fontSize: 18, fontWeight: '500' },
  pressed: { opacity: 0.4 },
});
