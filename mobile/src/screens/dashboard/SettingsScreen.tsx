import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { deleteAccount } from '../../api/auth';
import { getEffectiveSport, updateMainSport } from '../../api/profile';
import SportPicker from '../../components/SportPicker';
import { useSettings } from '../../state/SettingsContext';
import { ACCENTS, AccentKey, colors, FontScaleKey, spacing } from '../../theme';
import { confirmAsync } from '../../utils/confirm';
import { categoryLabel } from '../../utils/pipelineExercise';
import { heightInputToCm, weightInputToKg } from '../../utils/units';

const PRIVACY_POLICY_URL = 'https://danzlotnikov.github.io/APeX/privacy-policy.html';

const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[];
const FONT_OPTS: { key: FontScaleKey; label: string }[] = [
  { key: 'S', label: 'Small' }, { key: 'M', label: 'Medium' }, { key: 'L', label: 'Large' },
];
const WINDOW_OPTS = [7, 14, 30, 90];

interface Props {
  onLogout: () => void;
  userId?: string;
  teamId?: string;
}

export default function SettingsScreen({ onLogout, userId, teamId }: Props) {
  const { settings, profile, update, updateProfile, accentColor, accentOn, fontScale } = useSettings();

  const [name, setName] = useState(profile.name);
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Team athletes inherit their manager's sport (see effective_sport() in
  // 028_main_sport.sql) — fetched once here rather than trusting a locally
  // cached value, since the manager could have changed it since last login.
  // null = still loading; only relevant when teamId is set (the read-only
  // display below) — an individual athlete edits their own value directly
  // via SportPicker/updateMainSport instead, no fetch needed.
  const [effectiveSport, setEffectiveSport] = useState<string | null>(null);
  const [mySport, setMySport] = useState<string | null>(null);
  const [sportSaving, setSportSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    if (teamId) {
      getEffectiveSport(userId).then(setEffectiveSport).catch(() => setEffectiveSport('general_fitness'));
    } else {
      getEffectiveSport(userId).then(setMySport).catch(() => setMySport('general_fitness'));
    }
  }, [userId, teamId]);

  async function handlePickSport(key: string) {
    if (!userId || sportSaving) return;
    setSportSaving(true);
    const prev = mySport;
    setMySport(key); // optimistic — a 3-item picker should feel instant
    try {
      await updateMainSport(key);
    } catch (e) {
      setMySport(prev);
      Alert.alert('Could not update', 'Something went wrong changing your main sport. Please try again.');
    } finally {
      setSportSaving(false);
    }
  }

  async function handleDeleteAccount() {
    const confirmed = await confirmAsync(
      'Delete account?',
      'This permanently deletes your account and all of your data, including videos and session history. This cannot be undone.',
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

  useEffect(() => {
    setName(profile.name);
    if (profile.heightCm != null) {
      setHeight(String(settings.units === 'metric' ? Math.round(profile.heightCm) : Math.round(profile.heightCm / 2.54)));
    } else setHeight('');
    if (profile.weightKg != null) {
      setWeight(String(settings.units === 'metric' ? Math.round(profile.weightKg) : Math.round(profile.weightKg * 2.2046)));
    } else setWeight('');
  }, [settings.units, profile.heightCm, profile.weightKg, profile.name]);

  const commitHeight = (t: string) => {
    setHeight(t);
    const v = parseFloat(t);
    updateProfile({ heightCm: isNaN(v) ? null : Math.round(heightInputToCm(v, settings.units)) });
  };
  const commitWeight = (t: string) => {
    setWeight(t);
    const v = parseFloat(t);
    updateProfile({ weightKg: isNaN(v) ? null : Math.round(weightInputToKg(v, settings.units)) });
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <Text style={styles.kicker}>SETTINGS</Text>

        {/* ── Profile ── */}
        <Section title="ATHLETE PROFILE" fontScale={fontScale} />
        <View style={styles.card}>
          <Field label="Name">
            <TextInput
              value={name}
              onChangeText={(t) => { setName(t); updateProfile({ name: t }); }}
              placeholder="Your name"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
          </Field>
          <Field label={`Height (${settings.units === 'metric' ? 'cm' : 'in'})`}>
            <TextInput value={height} onChangeText={commitHeight} keyboardType="numeric"
              placeholder="—" placeholderTextColor={colors.muted} style={styles.input} />
          </Field>
          <Field label={`Weight (${settings.units === 'metric' ? 'kg' : 'lb'})`} last>
            <TextInput value={weight} onChangeText={commitWeight} keyboardType="numeric"
              placeholder="—" placeholderTextColor={colors.muted} style={styles.input} />
          </Field>
        </View>

        {/* ── Main sport ── */}
        <Section title="MAIN SPORT" fontScale={fontScale} />
        <View style={styles.card}>
          {teamId ? (
            <View style={styles.sportReadOnly}>
              <Text style={styles.sportReadOnlyText}>
                {effectiveSport ? categoryLabel(effectiveSport) : '—'}
              </Text>
              <Text style={styles.sportReadOnlyNote}>Set by your manager.</Text>
            </View>
          ) : (
            <View style={styles.sportPickerWrap}>
              <SportPicker value={mySport} onChange={handlePickSport} accentColor={accentColor} accentOn={accentOn} />
            </View>
          )}
        </View>

        {/* ── Appearance ── */}
        <Section title="APPEARANCE" fontScale={fontScale} />
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

        {/* ── Preferences ── */}
        <Section title="PREFERENCES" fontScale={fontScale} />
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

        {/* ── About ── */}
        <Section title="ABOUT" fontScale={fontScale} />
        <View style={styles.card}>
          <Text style={styles.aboutText}>
            APeX provides training feedback based on computer-vision movement analysis — pose
            estimation, balance, and range of motion. It is not a medical device, is not a
            diagnostic tool, and is not a substitute for professional medical advice. Consult a
            physician before beginning any exercise program.
          </Text>
          <Pressable onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)} style={styles.aboutLinkRow}>
            <Text style={[styles.aboutLink, { color: accentColor }]}>Privacy Policy</Text>
          </Pressable>
        </View>

        {/* ── Account ── */}
        <Section title="ACCOUNT" fontScale={fontScale} />
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

      </ScrollView>
    </View>
  );
}

function Section({ title, fontScale }: { title: string; fontScale: number }) {
  return <Text style={[styles.section, { fontSize: 11 * fontScale }]}>{title}</Text>;
}

function Field({ label, last, children }: { label: string; last?: boolean; children: React.ReactNode }) {
  return (
    <View style={[styles.field, !last && styles.fieldBorder]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
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
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },

  kicker: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2.5 },
  section: { color: colors.muted, fontWeight: '700', letterSpacing: 2, marginTop: spacing.lg, marginBottom: spacing.sm },

  card: {
    backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },

  field: { paddingVertical: spacing.sm },
  fieldBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  fieldLabel: { color: colors.muted, fontSize: 11, fontWeight: '600', marginBottom: 4 },
  input: { color: colors.text, fontSize: 16, fontWeight: '600', paddingVertical: 4 },

  rowLabel: { color: colors.text, fontSize: 14, fontWeight: '600', paddingVertical: spacing.sm },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },

  sportPickerWrap: { paddingVertical: spacing.sm },
  sportReadOnly: { paddingVertical: spacing.sm },
  sportReadOnlyText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sportReadOnlyNote: { color: colors.muted, fontSize: 11, fontWeight: '500', marginTop: 2 },

  swatches: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.sm },
  swatch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: colors.text },
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
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  segText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  segTextOn: { color: colors.bg },

  dangerRow: { paddingVertical: spacing.sm, alignItems: 'center' },
  dangerText: { color: colors.danger, fontSize: 14, fontWeight: '700' },

  aboutText: { color: colors.muted, fontSize: 12, lineHeight: 18, paddingVertical: spacing.sm },
  aboutLinkRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.sm },
  aboutLink: { fontSize: 13, fontWeight: '700' },
});
