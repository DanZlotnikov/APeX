import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import CollapsibleBanner from './CollapsibleBanner';
import ShineSweep from './ShineSweep';
import { useSettings } from '../state/SettingsContext';
import { colors, spacing } from '../theme';

interface Props {
  count: number;
  onPress: () => void;
  // Bumped whenever `count` increases — see useVideoJobs.ts's header
  // comment for why this is computed there (persistent across this
  // component's own remounts) rather than derived locally in here from
  // `count` alone, which was the original (buggy) approach.
  shineTrigger: number;
}

/**
 * "N videos processing" — see HANDOFF_video_pipeline.md section 4 item 3.
 * `count` includes optimistic uploads still in flight (see
 * state/localUploads.ts / useVideoJobs.ts's processingCount) so this
 * updates the instant the athlete confirms a recording, not once the
 * upload itself finishes. Collapses smoothly via CollapsibleBanner rather
 * than hard mounting/unmounting on `count` crossing 0 — see that
 * component's header comment for why a bare `return null` here caused a
 * reported "jitter, then only later the fade animation" the moment the
 * last processing video was saved.
 *
 * Plays a one-shot diagonal light sweep (ShineSweep) whenever the
 * processing count GOES UP — the banner first appearing (0 -> 1) and every
 * subsequent increase (1 -> 2, 2 -> 3, ...) are both just "count
 * increased," so one rule (see useVideoJobs.ts's processingIncreaseSignal)
 * covers both. Deliberately not triggered on decreases (saving/discarding
 * down to a lower count) — that direction already has its own feedback via
 * the card's own exit animation in the Processing tab, and shining on
 * removal too would blur what the sweep is meant to signal ("new
 * activity"), not to mention re-trigger constantly while several saves
 * land in quick succession.
 */
export default function ProcessingBanner({ count, onPress, shineTrigger }: Props) {
  const { accentColor } = useSettings();
  const visible = count > 0;
  // Keeps showing the last real count while collapsing after count hits 0,
  // instead of flashing "0 videos processing" for the split second before
  // the collapse finishes.
  const lastCountRef = useRef(count);
  if (count > 0) lastCountRef.current = count;
  const displayCount = count > 0 ? count : lastCountRef.current;

  return (
    <CollapsibleBanner visible={visible}>
      <Pressable
        onPress={onPress}
        disabled={!visible}
        style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
      >
        <ShineSweep trigger={shineTrigger} />
        <View style={[styles.dot, { backgroundColor: accentColor }]} />
        <Text style={styles.text}>
          {displayCount} video{displayCount === 1 ? '' : 's'} processing
        </Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
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
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden', // clips ShineSweep to the banner's rounded rect
  },
  pressed: { opacity: 0.6 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  text: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '700' },
  chevron: { color: colors.muted, fontSize: 18 },
});
