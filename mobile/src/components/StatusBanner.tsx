import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './ui/Text';
import { colors, spacing } from '../theme';

interface Props {
  message: string;
  tone?: 'info' | 'error';
}

/** Simple inline banner for error / info messages. */
export default function StatusBanner({ message, tone = 'info' }: Props) {
  return (
    <View style={[styles.banner, tone === 'error' ? styles.error : styles.info]}>
      <Text style={[styles.text, tone === 'error' && styles.errorText]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: 10,
    padding: spacing.md,
    borderWidth: 1,
  },
  info: { backgroundColor: colors.surface, borderColor: colors.border },
  error: { backgroundColor: '#3B1D1D', borderColor: colors.danger },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
  errorText: { color: colors.danger },
});
