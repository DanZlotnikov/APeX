import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSettings } from '../state/SettingsContext';
import { colors, spacing } from '../theme';

export interface ExercisePickerOption {
  key: string;
  label: string;
}

interface Props {
  options: ExercisePickerOption[];
  value: string | null; // null = the "all/overall" option
  onChange: (value: string | null) => void;
  /** Label for the first, no-filter option — "Overall" (Readiness screen's
   * trend) or "All Exercises" (History's filter). */
  allLabel: string;
}

// Reuses IndividualRoutineScreen.tsx's "+ Add Exercise" backdrop+modal-list
// pattern — this app's one established dropdown idiom — as a generic,
// reusable picker: ReadinessScreen's exercise trend selector and
// HistoryScreen's filter both use this same component.
export default function ExercisePicker({ options, value, onChange, allLabel }: Props) {
  const { accentColor } = useSettings();
  const [open, setOpen] = useState(false);
  const selectedLabel = value == null ? allLabel : options.find((o) => o.key === value)?.label ?? value;

  function pick(next: string | null) {
    onChange(next);
    setOpen(false);
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <Text style={styles.triggerText} numberOfLines={1}>{selectedLabel}</Text>
        <View style={styles.caret} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>SELECT EXERCISE</Text>
          <PickerRow label={allLabel} active={value == null} onPress={() => pick(null)} accentColor={accentColor} />
          {options.map((o) => (
            <PickerRow key={o.key} label={o.label} active={value === o.key} onPress={() => pick(o.key)} accentColor={accentColor} />
          ))}
        </View>
      </Modal>
    </>
  );
}

function PickerRow({ label, active, onPress, accentColor }: { label: string; active: boolean; onPress: () => void; accentColor: string }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
    >
      <Text style={[styles.modalRowText, active && { color: accentColor }]}>{label}</Text>
      {active && <Text style={[styles.check, { color: accentColor }]}>✓</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  pressed: { opacity: 0.6 },
  triggerText: { color: colors.text, fontSize: 14, fontWeight: '700', maxWidth: 200 },
  // A drawn triangle (zero-size box + border trick) instead of a Unicode
  // glyph (⌄/▾/etc.) — those render inconsistently thin/misaligned across
  // system fonts; this renders identically and cleanly on every platform,
  // the standard technique for a native-looking dropdown caret.
  caret: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderTopWidth: 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: colors.muted,
    marginTop: 2,
  },

  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalCard: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    top: '25%',
    maxHeight: '50%',
    backgroundColor: colors.surfaceHigh,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  modalTitle: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: spacing.sm },
  modalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  modalRowPressed: { opacity: 0.6 },
  modalRowText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  check: { fontSize: 15, fontWeight: '900' },
});
