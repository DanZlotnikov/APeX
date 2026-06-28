import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import PrimaryButton from '../components/PrimaryButton';
import { colors, spacing } from '../theme';

interface Props {
  onGoToCamera: (pickFirst: boolean) => void;
  testMode: boolean;
  onToggleTestMode: () => void;
}

export default function HomeScreen({ onGoToCamera, testMode, onToggleTestMode }: Props) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.inner}>

        <View style={styles.brand}>
          <Text style={styles.wordmark}>APeX</Text>
          <Text style={styles.wordmarkSub}>ATHLETIC PERFORMANCE EXCELLENCE</Text>
          <View style={styles.divider} />
          <Text style={styles.tagline}>
            AI movement analysis{'\n'}built for elite athletes.
          </Text>
        </View>

        <View style={styles.actions}>
          <PrimaryButton
            label="Start Recording"
            onPress={() => onGoToCamera(false)}
          />
          <PrimaryButton
            label="Upload Video"
            variant="secondary"
            onPress={() => onGoToCamera(true)}
            style={{ marginTop: spacing.sm }}
          />
          <View style={styles.testRow}>
            <Pressable onPress={onToggleTestMode} style={styles.testBtn}>
              <View style={[styles.testDot, { backgroundColor: testMode ? colors.primary : colors.muted }]} />
              <Text style={styles.testLabel}>TEST MODE {testMode ? 'ON' : 'OFF'}</Text>
            </Pressable>
          </View>
        </View>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  inner: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },

  brand: {
    flex: 1,
    justifyContent: 'center',
  },
  wordmark: {
    color: colors.primary,
    fontSize: 64,
    fontWeight: '900',
    letterSpacing: 6,
    lineHeight: 68,
  },
  wordmarkSub: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 3,
    marginTop: spacing.xs,
  },
  divider: {
    width: 40,
    height: 2,
    backgroundColor: colors.primary,
    marginVertical: spacing.lg,
    borderRadius: 1,
  },
  tagline: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '300',
    lineHeight: 32,
    letterSpacing: 0.3,
  },

  actions: {},
  testRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: spacing.md,
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  testDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  testLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.5,
  },
});
