import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEV_CREDENTIALS } from '../api/auth';
import { colors, spacing } from '../theme';

export type LoginRole = 'athlete' | 'manager';

interface Props {
  onLogin: (email: string, password: string) => Promise<void>;
  onSignUp: () => void;
}

export default function LoginScreen({ onLogin, onSignUp }: Props) {
  const insets = useSafeAreaInsets();
  const fade   = useRef(new Animated.Value(0)).current;
  const slideY = useRef(new Animated.Value(20)).current;

  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [devOpen,   setDevOpen]   = useState(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade,   { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideY, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  async function handleLogin() {
    if (!email.trim() || !password) return;
    setError('');
    setLoading(true);
    try {
      await onLogin(email.trim(), password);
    } catch (e: any) {
      setError(e?.message ?? 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDevLogin(role: LoginRole) {
    const creds = DEV_CREDENTIALS[role];
    setEmail(creds.email);
    setPassword(creds.password);
    setError('');
    setLoading(true);
    try {
      await onLogin(creds.email, creds.password);
    } catch (e: any) {
      setError(e?.message ?? 'Dev login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.root,
          { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Brand ─────────────────────────────────────────────── */}
        <Animated.View style={[styles.brand, { opacity: fade, transform: [{ translateY: slideY }] }]}>
          <Text style={styles.wordmark}>APeX</Text>
          <Text style={styles.tagline}>ATHLETIC PERFORMANCE EXCELLENCE</Text>
          <View style={styles.divider} />
          <Text style={styles.sub}>Movement analysis · Readiness tracking · Balance and range insights</Text>
        </Animated.View>

        {/* ── Login form ────────────────────────────────────────── */}
        <Animated.View style={[styles.form, { opacity: fade }]}>
          <View style={styles.field}>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              selectionColor={colors.primary}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.muted}
              secureTextEntry
              selectionColor={colors.primary}
              onSubmitEditing={handleLogin}
              returnKeyType="go"
            />
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            onPress={handleLogin}
            disabled={loading || !email.trim() || !password}
            style={({ pressed }) => [
              styles.loginBtn,
              (loading || !email.trim() || !password) && styles.loginBtnDisabled,
              pressed && !loading && styles.loginBtnPressed,
            ]}
          >
            {loading
              ? <ActivityIndicator color={colors.bg} size="small" />
              : <Text style={styles.loginBtnText}>LOG IN</Text>}
          </Pressable>

          <Pressable onPress={onSignUp} style={styles.signUpLink}>
            <Text style={styles.signUpLinkText}>
              Don't have an account? <Text style={styles.signUpLinkAccent}>Create one</Text>
            </Text>
          </Pressable>
        </Animated.View>

        {/* ── Dev section ───────────────────────────────────────── */}
        <Animated.View style={[styles.devSection, { opacity: fade }]}>
          <Pressable onPress={() => setDevOpen((v) => !v)} style={styles.devToggle}>
            <View style={styles.devLine} />
            <Text style={styles.devToggleText}>DEV  {devOpen ? '▲' : '▼'}</Text>
            <View style={styles.devLine} />
          </Pressable>

          {devOpen && (
            <View style={styles.devButtons}>
              <DevBtn label="ATHLETE" sub="daniel.cohen@apex.dev" color={colors.primary} onPress={() => void handleDevLogin('athlete')} />
              <DevBtn label="MANAGER" sub="coach@apex.dev"         color="#B794F6"       onPress={() => void handleDevLogin('manager')} />
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function DevBtn({ label, sub, color, onPress }: { label: string; sub: string; color: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.devBtn, { borderColor: `${color}44` }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.devBtnDot, { backgroundColor: `${color}22` }]}>
        <View style={[styles.devBtnDotInner, { backgroundColor: color }]} />
      </View>
      <View>
        <Text style={[styles.devBtnLabel, { color }]}>{label}</Text>
        <Text style={styles.devBtnSub}>{sub}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: spacing.lg,
    gap: spacing.xl,
  },

  brand: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  wordmark: { color: colors.primary, fontSize: 64, fontWeight: '900', letterSpacing: 6 },
  tagline:  { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 3, textAlign: 'center' },
  divider:  { width: 40, height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  sub:      { color: colors.muted, fontSize: 12, fontWeight: '500', textAlign: 'center', lineHeight: 18, opacity: 0.7 },

  form: { gap: spacing.md },

  field: { gap: 6 },
  label: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },

  errorText: {
    color: '#FF3B30',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },

  loginBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  loginBtnDisabled: { opacity: 0.45 },
  loginBtnPressed:  { opacity: 0.8 },
  loginBtnText:     { color: colors.bg, fontSize: 14, fontWeight: '900', letterSpacing: 2 },

  signUpLink: { alignItems: 'center', paddingVertical: spacing.sm },
  signUpLinkText:   { color: colors.muted, fontSize: 13, fontWeight: '500' },
  signUpLinkAccent: { color: colors.primary, fontWeight: '700' },

  devSection: { gap: spacing.sm },
  devToggle:  { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  devLine:    { flex: 1, height: 1, backgroundColor: colors.border },
  devToggleText: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 2 },

  devButtons: { flexDirection: 'row', gap: spacing.md },
  devBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  devBtnDot:      { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  devBtnDotInner: { width: 10, height: 10, borderRadius: 5 },
  devBtnLabel:    { fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  devBtnSub:      { color: colors.muted, fontSize: 9, fontWeight: '600', marginTop: 2 },
});
