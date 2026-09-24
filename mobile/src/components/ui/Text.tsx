import React, { forwardRef } from 'react';
import { Text as RNText, TextInput as RNTextInput, StyleSheet, TextInputProps, TextProps } from 'react-native';

// Every screen imports Text/TextInput from here, never from 'react-native',
// so text renders the same on every phone:
//  - One bundled typeface (Inter, embedded by the expo-font plugin in app.json
//    with all the weights the app uses) instead of the system font, which is
//    SF Pro on iPhone, Roboto on Pixels, and on Samsung whatever font the user
//    picked in Settings.
//  - The system text-size setting is still honored (accessibility), but capped
//    so the largest settings can't push text out of cards, buttons and tables.
// Text.defaultProps can't do this: React 19 ignores defaultProps on function
// components, which Text and TextInput are.
export const FONT_FAMILY = 'Inter';
export const MAX_FONT_SIZE_MULTIPLIER = 1.3;

export const Text = forwardRef<React.ComponentRef<typeof RNText>, TextProps>(function Text(
  { style, maxFontSizeMultiplier = MAX_FONT_SIZE_MULTIPLIER, ...rest },
  ref,
) {
  return <RNText ref={ref} {...rest} maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.font, style]} />;
});

export const TextInput = forwardRef<React.ComponentRef<typeof RNTextInput>, TextInputProps>(function TextInput(
  { style, maxFontSizeMultiplier = MAX_FONT_SIZE_MULTIPLIER, ...rest },
  ref,
) {
  return <RNTextInput ref={ref} {...rest} maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.font, style]} />;
});

const styles = StyleSheet.create({
  font: { fontFamily: FONT_FAMILY },
});
