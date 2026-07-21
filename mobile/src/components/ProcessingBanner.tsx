import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSettings } from '../state/SettingsContext';
import { colors, spacing } from '../theme';

interface Props {
  count: number;
  onPress: () => void;
}

/** "N videos processing" — see HANDOFF_video_pipeline.md section 4 item 3. */
export default function ProcessingBanner({ count, onPress }: Props) {
  const { accentColor } = useSettings();
  if (count <= 0) return null;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.banner, pressed && styles.pressed]}>
      <View style={[styles.dot, { backgroundColor: accentColor }]} />
      <Text style={styles.text}>
        {count} video{count === 1 ? '' : 's'} processing
      </Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.6 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  text: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '700' },
  chevron: { color: colors.muted, fontSize: 18 },
});
