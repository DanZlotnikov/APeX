import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '../../state/SettingsContext';
import { colors, spacing } from '../../theme';

interface Props {
  onRecord: () => void;
  onUpload: () => void;
  onLogout: () => void;
}

export default function AppBar({ onRecord, onUpload, onLogout }: Props) {
  const insets = useSafeAreaInsets();
  const { accentColor, accentOn } = useSettings();

  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.actions}>
        <Pressable
          onPress={onRecord}
          style={({ pressed }) => [styles.btn, { backgroundColor: accentColor }, pressed && styles.pressed]}
        >
          <View style={styles.recDot} />
          <Text style={[styles.btnLabel, { color: accentOn }]}>RECORD</Text>
        </Pressable>

        <Pressable
          onPress={onUpload}
          style={({ pressed }) => [styles.btnOutline, pressed && styles.pressed]}
        >
          <Text style={[styles.upIcon, { color: accentColor }]}>↑</Text>
          <Text style={styles.btnOutlineLabel}>UPLOAD</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={onLogout}
        style={({ pressed }) => [styles.logoutBtn, pressed && styles.pressed]}
        hitSlop={8}
      >
        <Text style={styles.logoutIcon}>⏻</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  recDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.danger },
  btnLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },

  btnOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  upIcon: { fontSize: 15, fontWeight: '900', lineHeight: 16 },
  btnOutlineLabel: { color: colors.text, fontSize: 12, fontWeight: '800', letterSpacing: 1 },

  logoutBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutIcon: { color: colors.muted, fontSize: 15, lineHeight: 17 },

  pressed: { opacity: 0.6 },
});
