import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { lookupTeamByCode, signUpAthlete, signUpManager } from '../api/auth';
import { getProfile } from '../api/auth';
import SportPicker from '../components/SportPicker';
import { useSettings } from '../state/SettingsContext';
import { ACCENTS, colors, spacing } from '../theme';

const PRIVACY_POLICY_URL = 'https://danzlotnikov.github.io/APeX/privacy-policy.html';

interface Props {
  onSuccess: (userId: string, teamId: string | null, role: 'athlete' | 'manager', name: string) => void;
  onBack: () => void;
}

type Role = 'manager' | 'athlete';
type Step = 'role' | 'sport' | 'form';

export default function SignUpScreen({ onSuccess, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const { accentColor, accentOn } = useSettings();
  const fade   = useRef(new Animated.Value(0)).current;
  // Manager's role color is an intentional fixed violet, distinct from the
  // athlete's accent-following color — this is the correct-contrast text for
  // it, same as accentOn is for accentColor.
  const managerOn = ACCENTS.violet.on;

  const [step,        setStep]        = useState<Step>('role');
  const [role,        setRole]        = useState<Role | null>(null);
  const [sportKey,    setSportKey]    = useState('general_fitness');
  const [name,        setName]        = useState('');
  const [teamName,    setTeamName]    = useState('');
  const [inviteCode,  setInviteCode]  = useState('');
  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [codePreview, setCodePreview] = useState<string | null>(null);
  const codeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);

  function selectRole(r: Role) {
    setRole(r);
    setStep('sport');
    setError('');
  }

  function handleCodeChange(code: string) {
    setInviteCode(code);
    setCodePreview(null);
    if (codeTimer.current) clearTimeout(codeTimer.current);
    if (code.trim().length >= 4) {
      codeTimer.current = setTimeout(async () => {
        const team = await lookupTeamByCode(code);
        setCodePreview(team ? team.teamName : '');
      }, 500);
    }
  }

  async function handleSubmit() {
    if (!role || !name.trim() || !email.trim() || !password) return;
    setError('');
    setLoading(true);
    try {
      let user;
      if (role === 'manager') {
        if (!teamName.trim()) { setError('Enter a team name.'); setLoading(false); return; }
        user = await signUpManager(email.trim(), password, name.trim(), teamName.trim(), sportKey);
      } else {
        // Invite code is optional — blank means "sign up as an individual
        // athlete, no team." A code that IS entered still has to be valid
        // (checked inside signUpAthlete); a typo shouldn't silently fall
        // through to an individual signup.
        user = await signUpAthlete(email.trim(), password, name.trim(), inviteCode.trim() || undefined, sportKey);
      }

      const profile = await getProfile(user.id);
      if (!profile) throw new Error('Profile not created. Try logging in.');
      onSuccess(user.id, profile.team_id, role, profile.full_name);
    } catch (e: any) {
      setError(e?.message ?? 'Sign-up failed. Please try again.');
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
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Pressable onPress={onBack} style={({ pressed }) => [styles.back, pressed && { opacity: 0.5 }]}>
            <Text style={[styles.backArrow, { color: accentColor }]}>←</Text>
            <Text style={[styles.backLabel, { color: accentColor }]}>Sign in</Text>
          </Pressable>
          <Text style={styles.title}>CREATE ACCOUNT</Text>
          <View style={styles.back} />
        </View>

        <Animated.View style={[styles.content, { opacity: fade }]}>

          {/* ── Step 1: Role selection ── */}
          {step === 'role' && (
            <View style={styles.roleSection}>
              <Text style={styles.rolePrompt}>I am joining as a…</Text>

              <View style={styles.roleRow}>
                <RoleCard
                  label="MANAGER"
                  description="Create a team and monitor athlete readiness"
                  icon="⊞"
                  color="#B794F6"
                  onPress={() => selectRole('manager')}
                />
                <RoleCard
                  label="ATHLETE"
                  description="Join a team and track your movement data"
                  icon="◉"
                  color={accentColor}
                  onPress={() => selectRole('athlete')}
                />
              </View>
            </View>
          )}

          {/* ── Step 2: Main sport ── */}
          {step === 'sport' && role && (
            <View style={styles.roleSection}>
              <Text style={styles.rolePrompt}>What's your main sport?</Text>
              <Text style={styles.sportSubtitle}>
                {role === 'manager'
                  ? "Sets your team's default — athletes without their own override inherit this."
                  : 'You can change this later in Settings.'}
              </Text>

              <SportPicker
                value={sportKey}
                onChange={setSportKey}
                accentColor={role === 'manager' ? '#B794F6' : accentColor}
                accentOn={role === 'manager' ? managerOn : accentOn}
              />

              <Pressable
                onPress={() => setStep('form')}
                style={({ pressed }) => [
                  styles.submitBtn,
                  { backgroundColor: role === 'manager' ? '#B794F6' : accentColor },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={[styles.submitBtnText, { color: role === 'manager' ? managerOn : accentOn }]}>
                  CONTINUE
                </Text>
              </Pressable>
              <Pressable onPress={() => { setStep('role'); setError(''); }} style={styles.sportBack}>
                <Text style={styles.changeRole}>← Back</Text>
              </Pressable>
            </View>
          )}

          {/* ── Step 3: Form ── */}
          {step === 'form' && role && (
            <View style={styles.formSection}>
              {/* Role badge */}
              <View style={styles.roleBadge}>
                <Text style={[styles.roleBadgeText, { color: role === 'manager' ? '#B794F6' : accentColor }]}>
                  {role === 'manager' ? '⊞  MANAGER' : '◉  ATHLETE'}
                </Text>
                <Pressable onPress={() => { setStep('role'); setError(''); }}>
                  <Text style={styles.changeRole}>Change</Text>
                </Pressable>
              </View>

              <Field label="FULL NAME" value={name} onChange={setName} placeholder="Your name" />

              {role === 'manager' && (
                <Field label="TEAM NAME" value={teamName} onChange={setTeamName} placeholder="e.g. Wingate U21" />
              )}

              {role === 'athlete' && (
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>INVITE CODE (OPTIONAL)</Text>
                  <TextInput
                    style={[styles.input, codePreview === '' && styles.inputError]}
                    value={inviteCode}
                    onChangeText={handleCodeChange}
                    placeholder="From your manager — leave blank to train solo"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    selectionColor={accentColor}
                    maxLength={8}
                  />
                  {codePreview === null && inviteCode.length >= 4 && (
                    <Text style={styles.codeHint}>Checking…</Text>
                  )}
                  {codePreview !== null && codePreview !== '' && (
                    <Text style={styles.codeValid}>✓  {codePreview}</Text>
                  )}
                  {codePreview === '' && inviteCode.length >= 4 && (
                    <Text style={styles.codeInvalid}>Code not found</Text>
                  )}
                  <Text style={styles.codeNote}>
                    {inviteCode.trim()
                      ? 'Ask your manager or coach for this code.'
                      : 'No code? No problem — you can train as an individual, no team required.'}
                  </Text>
                </View>
              )}

              <Field label="EMAIL" value={email} onChange={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
              <Field label="PASSWORD" value={password} onChange={setPassword} placeholder="8+ characters" secureTextEntry />

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Text style={styles.disclaimer}>
                APeX provides training feedback from computer-vision movement analysis — it is
                not a medical device and does not diagnose or treat any condition. Consult a
                physician before starting a new exercise program.
              </Text>
              <Text style={styles.disclaimer}>
                By creating an account, you agree to our{' '}
                <Text style={[styles.disclaimerLink, { color: accentColor }]} onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}>
                  Privacy Policy
                </Text>.
              </Text>

              <Pressable
                onPress={handleSubmit}
                disabled={loading}
                style={({ pressed }) => [
                  styles.submitBtn,
                  { backgroundColor: role === 'manager' ? '#B794F6' : accentColor },
                  loading && styles.submitBtnDisabled,
                  pressed && !loading && { opacity: 0.8 },
                ]}
              >
                {loading
                  ? <ActivityIndicator color={role === 'manager' ? managerOn : accentOn} size="small" />
                  : <Text style={[styles.submitBtnText, { color: role === 'manager' ? managerOn : accentOn }]}>
                      {role === 'manager' ? 'CREATE TEAM' : inviteCode.trim() ? 'JOIN TEAM' : 'CREATE ACCOUNT'}
                    </Text>}
              </Pressable>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function RoleCard({ label, description, icon, color, onPress }: {
  label: string; description: string; icon: string; color: string; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.roleCard,
        { borderColor: `${color}55` },
        pressed && { opacity: 0.75, transform: [{ scale: 0.97 }] },
      ]}
    >
      <View style={[styles.roleIcon, { backgroundColor: `${color}18` }]}>
        <Text style={[styles.roleIconText, { color }]}>{icon}</Text>
      </View>
      <Text style={[styles.roleLabel, { color }]}>{label}</Text>
      <Text style={styles.roleDesc}>{description}</Text>
    </Pressable>
  );
}

function Field({
  label, value, onChange, placeholder, keyboardType, autoCapitalize, secureTextEntry,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
  keyboardType?: any; autoCapitalize?: any; secureTextEntry?: boolean;
}) {
  const { accentColor } = useSettings();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize ?? 'words'}
        autoCorrect={false}
        secureTextEntry={secureTextEntry}
        selectionColor={accentColor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  back:      { width: 80, flexDirection: 'row', alignItems: 'center', gap: 4 },
  backArrow: { fontSize: 18, fontWeight: '700' },
  backLabel: { fontSize: 13, fontWeight: '700' },
  title:     { color: colors.text, fontSize: 13, fontWeight: '900', letterSpacing: 2.5 },

  content: { gap: spacing.lg },

  // ── Role selection ──────────────────────────────────────────────────────────
  roleSection: { gap: spacing.lg, paddingTop: spacing.lg },
  rolePrompt: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  sportSubtitle: { color: colors.muted, fontSize: 12, fontWeight: '500', textAlign: 'center', marginTop: -spacing.md, lineHeight: 17 },
  sportBack: { alignItems: 'center', paddingVertical: spacing.xs },

  roleRow: { flexDirection: 'row', gap: spacing.md },
  roleCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
  },
  roleIcon:     { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  roleIconText: { fontSize: 22, fontWeight: '600', lineHeight: 24 },
  roleLabel:    { fontSize: 13, fontWeight: '900', letterSpacing: 2 },
  roleDesc:     { color: colors.muted, fontSize: 11, fontWeight: '500', textAlign: 'center', lineHeight: 16 },

  // ── Form ───────────────────────────────────────────────────────────────────
  formSection: { gap: spacing.md },

  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  roleBadgeText: { fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  changeRole:    { color: colors.muted, fontSize: 12, fontWeight: '600' },

  field:      { gap: 6 },
  fieldLabel: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
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
  inputError: { borderColor: '#FF3B30' },

  codeHint:    { color: colors.muted, fontSize: 11, fontWeight: '500' },
  codeValid:   { color: '#00D4BC', fontSize: 11, fontWeight: '700' },
  codeInvalid: { color: '#FF3B30', fontSize: 11, fontWeight: '700' },
  codeNote:    { color: colors.muted, fontSize: 10, fontWeight: '500', fontStyle: 'italic' },

  errorText: { color: '#FF3B30', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  disclaimer: { color: colors.muted, fontSize: 10.5, fontWeight: '500', lineHeight: 15, textAlign: 'center', marginTop: spacing.xs },
  disclaimerLink: { fontWeight: '700', textDecorationLine: 'underline' },

  submitBtn: {
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText:     { fontSize: 14, fontWeight: '900', letterSpacing: 2 },
});
