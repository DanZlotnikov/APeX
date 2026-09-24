import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../../components/ui/Text';
import { deleteAccount } from '../../api/auth';
import { getEffectiveSport, updateMainSport } from '../../api/profile';
import { getTeamInviteCode, getTeamName, regenerateInviteCode } from '../../api/teams';
import SportPicker from '../../components/SportPicker';
import { useSettings } from '../../state/SettingsContext';
import { ACCENTS, AccentKey, colors, FontScaleKey, spacing } from '../../theme';
import { confirmAsync } from '../../utils/confirm';

const PRIVACY_POLICY_URL = 'https://danzlotnikov.github.io/APeX/privacy-policy.html';

// Exercise-related routine settings (which exercises, sets, target reps per
// set) are now per-athlete — set on each athlete's own "Routine" tab in
// AthleteDetailPreview.tsx, backed by athlete_routine_sets (see
// supabase/migrations/022_routine_sets.sql) — not this screen.

const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[];
const FONT_OPTS: { key: FontScaleKey; label: string }[] = [
  { key: 'S', label: 'Small' }, { key: 'M', label: 'Medium' }, { key: 'L', label: 'Large' },
];
const WINDOW_OPTS = [7, 14, 30, 90];

interface Props {
  teamId: string;
  userId?: string;
  onLogout: () => void;
}

export default function ManagerSettings({ teamId, userId, onLogout }: Props) {
  const { settings, update, accentColor, accentOn } = useSettings();

  const [teamName,     setTeamName]     = useState<string | null>(null);
  const [inviteCode,   setInviteCode]   = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [deleting,     setDeleting]     = useState(false);
  // The manager's own main_sport_key IS the team default athletes inherit
  // (see effective_sport() in 028_main_sport.sql) — for a manager this is
  // always their own value (no inheritance to resolve), but fetched via the
  // same effective_sport() RPC as everywhere else so there's one source of
  // truth for "what does this profile's sport read as."
  const [mySport, setMySport] = useState<string | null>(null);
  const [sportSaving, setSportSaving] = useState(false);

  useEffect(() => {
    getTeamName(teamId)
      .then(setTeamName)
      .catch((e) => { console.warn('Failed to load team name', e); setTeamName(''); });
    getTeamInviteCode(teamId)
      .then(setInviteCode)
      .catch((e) => console.warn('Failed to load invite code', e));
  }, [teamId]);

  useEffect(() => {
    if (!userId) return;
    getEffectiveSport(userId).then(setMySport).catch(() => setMySport('general_fitness'));
  }, [userId]);

  async function handlePickSport(key: string) {
    if (!userId || sportSaving) return;
    setSportSaving(true);
    const prev = mySport;
    setMySport(key);
    try {
      await updateMainSport(key);
    } catch (e) {
      setMySport(prev);
      Alert.alert('Could not update', 'Something went wrong changing your team’s main sport. Please try again.');
    } finally {
      setSportSaving(false);
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const code = await regenerateInviteCode(teamId);
      setInviteCode(code);
    } catch (e) {
      console.warn('Failed to regenerate invite code', e);
    } finally {
      setRegenerating(false);
    }
  }

  async function handleDeleteAccount() {
    const confirmed = await confirmAsync(
      'Delete account?',
      'This permanently deletes your manager account and all of your data. Your team and its athletes are not affected. This cannot be undone.',
      { destructive: true, confirmLabel: 'Delete' },
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteAccount();
      onLogout();
    } catch (e) {
      console.warn('Failed to delete account', e);
      setDeleting(false);
      Alert.alert('Could not delete account', 'Something went wrong. Please try again.');
    }
  }

  if (teamName === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={accentColor} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>TEAM</Text>
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>TEAM NAME</Text>
            <TextInput
              style={styles.input}
              value={teamName}
              onChangeText={setTeamName}
              placeholderTextColor={colors.muted}
              selectionColor={accentColor}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ATHLETE INVITE CODE</Text>
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>SHARE THIS CODE WITH ATHLETES</Text>
            <View style={styles.codeRow}>
              <Text selectable style={[styles.codeText, { color: accentColor }]}>{inviteCode || '——'}</Text>
              <Pressable
                onPress={() => void handleRegenerate()}
                disabled={regenerating}
                style={({ pressed }) => [
                  styles.regenBtn,
                  regenerating && { opacity: 0.5 },
                  pressed && !regenerating && { opacity: 0.7 },
                ]}
              >
                {regenerating
                  ? <ActivityIndicator color={accentColor} size="small" />
                  : <Text style={styles.regenBtnText}>↺  REGENERATE</Text>}
              </Pressable>
            </View>
            <Text style={styles.codeNote}>
              Athletes enter this code when creating their account. Regenerating invalidates the old code.
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>MAIN SPORT</Text>
          <View style={styles.card}>
            <Text style={styles.sportNote}>Your team's default — athletes without their own override inherit this.</Text>
            <SportPicker value={mySport} onChange={handlePickSport} accentColor={accentColor} accentOn={accentOn} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>APPEARANCE</Text>
          <View style={styles.card}>
            <Text style={styles.rowLabel}>Accent color</Text>
            <View style={styles.swatches}>
              {ACCENT_KEYS.map((k) => {
                const on = settings.accent === k;
                return (
                  <Pressable key={k} onPress={() => update({ accent: k })}
                    style={[styles.swatch, { backgroundColor: ACCENTS[k].color }, on && styles.swatchOn]}>
                    {on && <Text style={[styles.swatchCheck, { color: ACCENTS[k].on }]}>✓</Text>}
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.divider} />
            <Text style={styles.rowLabel}>Font size</Text>
            <Segmented
              options={FONT_OPTS.map((f) => ({ key: f.key, label: f.label }))}
              value={settings.fontScale}
              onChange={(k) => update({ fontScale: k as FontScaleKey })}
              accent={accentColor}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PREFERENCES</Text>
          <View style={styles.card}>
            <Text style={styles.rowLabel}>Units</Text>
            <Segmented
              options={[{ key: 'metric', label: 'Metric' }, { key: 'imperial', label: 'Imperial' }]}
              value={settings.units}
              onChange={(k) => update({ units: k as any })}
              accent={accentColor}
            />

            <View style={styles.divider} />
            <Text style={styles.rowLabel}>Comparison window</Text>
            <Segmented
              options={WINDOW_OPTS.map((d) => ({ key: String(d), label: `${d}d` }))}
              value={String(settings.windowDays)}
              onChange={(k) => update({ windowDays: parseInt(k, 10) })}
              accent={accentColor}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ABOUT</Text>
          <View style={styles.card}>
            <Text style={styles.aboutText}>
              APeX provides training feedback based on computer-vision movement analysis — pose
              estimation, balance, and range of motion. It is not a medical device, is not a
              diagnostic tool, and is not a substitute for professional medical advice. Athletes
              should consult a physician before beginning any exercise program.
            </Text>
            <Pressable onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)} style={styles.aboutLinkRow}>
              <Text style={[styles.aboutLink, { color: accentColor }]}>Privacy Policy</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ACCOUNT</Text>
          <View style={styles.card}>
            <Pressable
              onPress={() => void handleDeleteAccount()}
              disabled={deleting}
              style={({ pressed }) => [styles.dangerRow, pressed && !deleting && { opacity: 0.7 }]}
            >
              {deleting
                ? <ActivityIndicator color={colors.danger} size="small" />
                : <Text style={styles.dangerText}>Delete Account</Text>}
            </Pressable>
          </View>
        </View>

        <View style={styles.saveNote}>
          <Text style={styles.saveNoteText}>Settings are saved automatically.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Segmented({ options, value, onChange, accent }: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (k: string) => void;
  accent: string;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.key === value));
  const anim = useRef(new Animated.Value(idx)).current;
  const [innerWidth, setInnerWidth] = useState(0);

  useEffect(() => {
    const newIdx = Math.max(0, options.findIndex((o) => o.key === value));
    Animated.spring(anim, {
      toValue: newIdx,
      useNativeDriver: false,
      tension: 130,
      friction: 16,
    }).start();
  }, [value, options]);

  const itemW = innerWidth > 0 ? innerWidth / options.length : 0;

  // Sliding highlight positioned absolutely within the padded container.
  // left = padding(3) + idx * itemWidth
  const highlightLeft = anim.interpolate({
    inputRange: options.map((_, i) => i),
    outputRange: options.map((_, i) => i * itemW),
  });

  return (
    <View
      style={styles.segment}
      onLayout={(e) => setInnerWidth(e.nativeEvent.layout.width - 6)} // 6 = 2×padding(3)
    >
      {/* Sliding pill rendered first so text sits above it */}
      {itemW > 0 && (
        <Animated.View
          style={[styles.segHighlight, { backgroundColor: accent, width: itemW, left: highlightLeft }]}
        />
      )}
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={styles.segItem}>
            <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bg },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },

  section:      { gap: spacing.sm },
  sectionTitle: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 2 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  fieldLabel: {
    color: colors.muted, fontSize: 10, fontWeight: '700',
    letterSpacing: 1.5, marginBottom: 4, marginTop: spacing.sm,
  },
  input: {
    color: colors.text, fontSize: 16, fontWeight: '700',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },

  rowLabel: { color: colors.text, fontSize: 14, fontWeight: '600', paddingVertical: spacing.sm },
  divider:  { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },

  sportNote: { color: colors.muted, fontSize: 11, fontWeight: '500', lineHeight: 16, marginBottom: spacing.sm, marginTop: spacing.sm },

  swatches:    { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.sm },
  swatch:      { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchOn:    { borderColor: colors.text },
  swatchCheck: { fontSize: 16, fontWeight: '900' },

  segment: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
    marginBottom: spacing.sm,
    position: 'relative',
  },
  segHighlight: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    borderRadius: 8,
  },
  segItem:   { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  segText:   { color: colors.muted, fontSize: 12, fontWeight: '700' },
  segTextOn: { color: colors.bg },

  saveNote:     { alignItems: 'center', paddingVertical: spacing.sm },
  saveNoteText: { color: colors.muted, fontSize: 11, fontWeight: '500', fontStyle: 'italic' },

  codeRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, marginBottom: spacing.sm },
  codeText: { fontSize: 28, fontWeight: '900', letterSpacing: 6, fontVariant: ['tabular-nums'] },
  codeNote: { color: colors.muted, fontSize: 11, fontWeight: '500', lineHeight: 16, marginBottom: spacing.sm },
  regenBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surfaceHigh,
    borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: 8,
    minWidth: 44, justifyContent: 'center',
  },
  regenBtnText: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },

  dangerRow: { paddingVertical: spacing.sm, alignItems: 'center' },
  dangerText: { color: colors.danger, fontSize: 14, fontWeight: '700' },

  aboutText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  aboutLinkRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.sm, marginTop: spacing.xs },
  aboutLink: { fontSize: 13, fontWeight: '700' },
});
