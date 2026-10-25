import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui/Text';
import { Handedness } from '../api/profile';
import { colors, spacing } from '../theme';

interface Props {
  value: Handedness | null; // null = not chosen yet, nothing highlighted
  onChange: (hand: Handedness) => void;
  accentColor: string;
  accentOn: string;
}

const OPTIONS: { key: Handedness; letter: string; label: string }[] = [
  { key: 'right', letter: 'R', label: 'Right-handed' },
  { key: 'left', letter: 'L', label: 'Left-handed' },
];

// Which hand holds the racket — the pipeline needs it to tell a forehand from a backhand. Same
// card look as SportPicker, used at sign-up and in the athlete's Settings.
export default function HandPicker({ value, onChange, accentColor, accentOn }: Props) {
  return (
    <View style={styles.row}>
      {OPTIONS.map((o) => {
        const selected = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            style={({ pressed }) => [
              styles.card,
              selected ? { backgroundColor: accentColor, borderColor: accentColor } : { borderColor: colors.border },
              pressed && !selected && { opacity: 0.7 },
            ]}
          >
            <View style={[styles.chip, { backgroundColor: selected ? `${accentOn}22` : `${accentColor}18` }]}>
              <Text style={[styles.letter, { color: selected ? accentOn : accentColor }]}>{o.letter}</Text>
            </View>
            <Text style={[styles.label, { color: selected ? accentOn : colors.text }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 8,
  },
  chip: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  letter: { fontSize: 18, fontWeight: '900' },
  label: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
});
