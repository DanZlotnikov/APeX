import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme';

// App-styled confirm dialog — a drop-in replacement for Alert.alert's confirm
// pattern that actually renders (react-native-web's Alert.alert silently
// no-ops on web) and matches the rest of the app instead of an OS/browser
// dialog. Call confirmAsync(...) from anywhere; <ConfirmDialogHost /> is
// mounted once at the app root (App.tsx) and does the actual rendering.

interface ConfirmOptions {
  destructive?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmRequest extends ConfirmOptions {
  title: string;
  message: string;
  resolve: (value: boolean) => void;
}

let showRequest: ((req: ConfirmRequest) => void) | null = null;

export function confirmAsync(title: string, message: string, options?: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!showRequest) {
      // Host isn't mounted (shouldn't happen — it's mounted once at the app root).
      resolve(false);
      return;
    }
    showRequest({ title, message, resolve, ...options });
  });
}

export function ConfirmDialogHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    showRequest = (req) => setRequest(req);
    return () => { showRequest = null; };
  }, []);

  useEffect(() => {
    if (!request) return;
    opacity.setValue(0);
    scale.setValue(0.95);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 9, tension: 140 }),
    ]).start();
  }, [request]);

  function respond(value: boolean) {
    request?.resolve(value);
    setRequest(null);
  }

  if (!request) return null;

  const confirmColor = request.destructive ? colors.danger : colors.primary;

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => respond(false)}>
      <Pressable style={styles.backdrop} onPress={() => respond(false)} />
      <View style={styles.center} pointerEvents="box-none">
        <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
          <Text style={styles.title}>{request.title}</Text>
          <Text style={styles.message}>{request.message}</Text>
          <View style={styles.actions}>
            <Pressable
              onPress={() => respond(false)}
              style={({ pressed }) => [styles.btn, styles.cancelBtn, pressed && styles.btnPressed]}
            >
              <Text style={styles.cancelText}>{request.cancelLabel ?? 'Cancel'}</Text>
            </Pressable>
            <Pressable
              onPress={() => respond(true)}
              style={({ pressed }) => [
                styles.btn,
                styles.confirmBtn,
                { borderColor: confirmColor, backgroundColor: `${confirmColor}1A` },
                pressed && styles.btnPressed,
              ]}
            >
              <Text style={[styles.confirmText, { color: confirmColor }]}>
                {request.confirmLabel ?? 'Confirm'}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surfaceHigh,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 24,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
  message: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: spacing.xs },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    marginTop: spacing.xs,
  },
  btn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: { opacity: 0.7 },
  cancelBtn: { borderColor: colors.border, backgroundColor: 'transparent' },
  cancelText: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  confirmBtn: {},
  confirmText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
});
