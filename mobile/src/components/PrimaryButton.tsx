import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextStyle, ViewStyle } from 'react-native';
import { Text } from './ui/Text';
import { useSettings } from '../state/SettingsContext';
import { colors, spacing } from '../theme';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  labelStyle?: TextStyle;
}

export default function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  labelStyle,
}: Props) {
  const isSecondary = variant === 'secondary';
  const { accentColor, accentOn } = useSettings();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        isSecondary ? styles.secondary : [styles.primary, { backgroundColor: accentColor }],
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isSecondary ? colors.text : accentOn} />
      ) : (
        <Text style={[styles.label, isSecondary ? styles.secondaryLabel : { color: accentOn }, labelStyle]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 14,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  primary: { backgroundColor: colors.primary },
  // A literally transparent fill reads as a broken/ghost element against the
  // app's solid dark background (just a floating outline) — surface + a
  // subtle border reads as an actual button, matching AppBar's outline
  // button (e.g. "UPLOAD").
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
  label: {
    color: colors.primaryText,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  secondaryLabel: { color: colors.muted },
});
