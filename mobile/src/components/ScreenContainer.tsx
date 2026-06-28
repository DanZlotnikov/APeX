import React from 'react';
import { SafeAreaView, StyleSheet, View } from 'react-native';
import { colors, spacing } from '../theme';

/** Consistent dark, padded screen wrapper. */
export default function ScreenContainer({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.inner}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, padding: spacing.lg },
});
