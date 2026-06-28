import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import PoseView from '../components/PoseView';
import PrimaryButton from '../components/PrimaryButton';
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
      </View>

      <View style={styles.viewer}>
        <PoseView videoUri={videoUri} />
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="Record Again" onPress={onRecordAgain} />
        <Pressable onPress={onHome} style={({ pressed }) => [styles.homeBtn, pressed && styles.homeBtnPressed]}>
          <Text style={styles.homeBtnText}>MAIN MENU</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  header: {
    alignItems: 'center',
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

  viewer: { flex: 1 },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.xs,
  },
  homeBtn: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  homeBtnPressed: { opacity: 0.4 },
  homeBtnText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2.5,
  },
});
