import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import PoseView from '../components/PoseView';
import { colors, spacing } from '../theme';

interface Props {
  videoUri: string;
  onRecordAgain: () => void;
  onHome: () => void;
}

export default function AnalysisScreen({ videoUri, onRecordAgain, onHome }: Props) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>MOVEMENT ANALYSIS</Text>
        <View style={styles.badge}>
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>LIVE SKELETON</Text>
        </View>
      </View>

      <View style={styles.viewer}>
        <PoseView videoUri={videoUri} />
      </View>

      <View style={styles.footer}>
        <Pressable onPress={onRecordAgain} style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}>
          <Text style={styles.btnText}>↺  RECORD AGAIN</Text>
        </Pressable>
        <Pressable onPress={onHome} style={({ pressed }) => [styles.btn, styles.btnHome, pressed && styles.btnPressed]}>
          <Text style={styles.btnText}>⌂  MAIN MENU</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2.5,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  badgeText: {
    color: colors.primary,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
  },

  viewer: { flex: 1 },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  btn: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnHome: { borderColor: 'transparent' },
  btnPressed: { opacity: 0.6 },
  btnText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
  },
});
