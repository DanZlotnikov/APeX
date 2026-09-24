import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui/Text';
import { colors, spacing } from '../theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  label: string;
  description: string;
  research: string[];
}

// Backdrop-dismiss popup, same pattern as ExercisePicker.tsx's modal —
// content is the check's own description/research fields, sourced straight
// from the Python threshold definitions (thresholds.py / rom_thresholds.py)
// via the biomechanics report, not authored here.
export default function MetricInfoModal({ visible, onClose, label, description, research }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.card}>
        <Text style={styles.title}>{label}</Text>
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.description}>{description}</Text>
          {research.length > 0 && (
            <>
              <Text style={styles.researchKicker}>BASED ON</Text>
              {research.map((r, i) => (
                <Text key={i} style={styles.researchItem}>· {r}</Text>
              ))}
            </>
          )}
        </ScrollView>
        <Pressable onPress={onClose} style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}>
          <Text style={styles.closeBtnText}>GOT IT</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  card: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    top: '22%',
    maxHeight: '56%',
    backgroundColor: colors.surfaceHigh,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: spacing.sm },
  scroll: { flexGrow: 0 },
  description: { color: colors.text, fontSize: 13.5, lineHeight: 20 },
  researchKicker: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginTop: spacing.md, marginBottom: spacing.xs },
  researchItem: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 4 },
  closeBtn: { alignSelf: 'flex-end', marginTop: spacing.md, paddingVertical: 8, paddingHorizontal: 14 },
  pressed: { opacity: 0.6 },
  closeBtnText: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
});
