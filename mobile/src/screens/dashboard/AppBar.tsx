import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '../../state/SettingsContext';
import { colors, spacing } from '../../theme';

interface Props {
  onRecord: () => void;
  onUpload: () => void;
  onLogout: () => void;
  onSettings: () => void;
  /** When true the bar shows a back button instead of the record/upload actions. */
  settingsOpen: boolean;
  onBack: () => void;
}

export default function AppBar({ onRecord, onUpload, onLogout, onSettings, settingsOpen, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const { accentColor, accentOn } = useSettings();

  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing.md }]}>
      {settingsOpen ? (
        <Pressable onPress={onBack} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
          <Text style={[styles.backArrow, { color: accentColor }]}>←</Text>
          <Text style={[styles.backLabel, { color: accentColor }]}>Dashboard</Text>
        </Pressable>
      ) : (
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
      )}

      <View style={styles.iconRow}>
        <Pressable
          onPress={onSettings}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          hitSlop={8}
        >
          <GearIcon color={settingsOpen ? accentColor : colors.muted} size={16} />
        </Pressable>

        <Pressable
          onPress={onLogout}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          hitSlop={8}
        >
          <Text style={styles.logoutIcon}>⏻</Text>
        </Pressable>
      </View>
    </View>
  );
}

function GearIcon({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
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

  backBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backArrow: { fontSize: 18, fontWeight: '700' },
  backLabel: { fontSize: 13, fontWeight: '700' },

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

  iconRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBtn: {
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
