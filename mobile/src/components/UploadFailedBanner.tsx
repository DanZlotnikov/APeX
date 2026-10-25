import React, { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui/Text';
import CollapsibleBanner from './CollapsibleBanner';
import { colors, spacing } from '../theme';

interface Props {
  count: number;
  /** Why the latest upload failed; shown under the count so a failure can be understood and reported. */
  reason?: string | null;
  onDismiss: () => void;
}

/**
 * "N upload(s) failed" — shown in place of (stacked with, if both are
 * simultaneously true) ProcessingBanner when a background video upload
 * (see App.tsx's handleVideoConfirmed / state/localUploads.ts) genuinely
 * fails. A failed upload never became a real video_jobs row, so there's
 * nothing to tap through to — this is informational + dismissible only,
 * unlike ProcessingBanner's tap-to-navigate chevron.
 */
export default function UploadFailedBanner({ count, reason, onDismiss }: Props) {
  const visible = count > 0;
  const lastCountRef = useRef(count);
  if (count > 0) lastCountRef.current = count;
  const displayCount = count > 0 ? count : lastCountRef.current;
  const lastReasonRef = useRef(reason);
  if (count > 0) lastReasonRef.current = reason;
  const displayReason = count > 0 ? reason : lastReasonRef.current;

  return (
    <CollapsibleBanner visible={visible}>
      <View style={styles.banner}>
        <View style={styles.dot} />
        <View style={styles.textCol}>
          <Text style={styles.text}>
            {displayCount} upload{displayCount === 1 ? '' : 's'} failed
          </Text>
          {!!displayReason && <Text style={styles.reason} numberOfLines={3}>{displayReason}</Text>}
        </View>
        <Pressable onPress={onDismiss} hitSlop={8} style={({ pressed }) => [styles.dismissBtn, pressed && styles.pressed]}>
          <Text style={styles.dismissText}>✕</Text>
        </Pressable>
      </View>
    </CollapsibleBanner>
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
    borderColor: colors.danger,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.6 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm, backgroundColor: colors.danger },
  textCol: { flex: 1 },
  text: { color: colors.text, fontSize: 13, fontWeight: '700' },
  reason: { color: colors.muted, fontSize: 11, fontWeight: '500', marginTop: 2 },
  dismissBtn: { paddingHorizontal: spacing.xs, paddingVertical: 2 },
  dismissText: { color: colors.danger, fontSize: 14, fontWeight: '800' },
});
