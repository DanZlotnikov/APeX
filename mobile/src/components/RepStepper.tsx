import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme';

interface Props {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  accentColor?: string;
}

// Replaces an earlier PanResponder-based drag slider: confirmed unreliable
// in practice ("sometimes it goes to the right place, sometimes it
// doesn't") — RN's touch `locationX` is measured relative to whichever
// nested view actually received the touch, which isn't consistent across a
// track/fill/thumb stack of absolutely-positioned children, so the same
// drag could resolve to different values depending on exactly what got
// touched. A +/- stepper has no positional math at all — every tap is a
// plain onPress — so this whole class of bug can't happen here.
export default function RepStepper({ min, max, value, onChange, disabled, accentColor = colors.primary }: Props) {
  const canDecrement = !disabled && value > min;
  const canIncrement = !disabled && value < max;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onChange(value - 1)}
        disabled={!canDecrement}
        style={({ pressed }) => [styles.btn, { borderColor: accentColor }, !canDecrement && styles.btnDisabled, pressed && styles.pressed]}
      >
        <Text style={[styles.btnText, { color: accentColor }]}>−</Text>
      </Pressable>

      <Text style={styles.value}>{value}</Text>

      <Pressable
        onPress={() => onChange(value + 1)}
        disabled={!canIncrement}
        style={({ pressed }) => [styles.btn, { borderColor: accentColor }, !canIncrement && styles.btnDisabled, pressed && styles.pressed]}
      >
        <Text style={[styles.btnText, { color: accentColor }]}>+</Text>
      </Pressable>
    </View>
  );
}

const BTN_SIZE = 36;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  btn: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.35 },
  btnText: { fontSize: 20, fontWeight: '800', lineHeight: 22 },
  value: { color: colors.text, fontSize: 20, fontWeight: '900', width: 44, textAlign: 'center' },
  pressed: { opacity: 0.6 },
});
