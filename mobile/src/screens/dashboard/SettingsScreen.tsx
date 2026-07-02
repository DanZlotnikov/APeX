import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import DashHeader from './DashHeader';
import { useDashboard } from './DashboardContext';
import { useSettings } from '../../state/SettingsContext';
import { ACCENTS, AccentKey, colors, FontScaleKey, spacing } from '../../theme';
import { heightInputToCm, weightInputToKg } from '../../utils/units';

const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[];
const FONT_OPTS: { key: FontScaleKey; label: string }[] = [
  { key: 'S', label: 'Small' }, { key: 'M', label: 'Medium' }, { key: 'L', label: 'Large' },
];
const WINDOW_OPTS = [7, 14, 30, 90];

export default function SettingsScreen() {
  const { onExit } = useDashboard();
  const { settings, profile, update, updateProfile, accentColor, fontScale } = useSettings();

  // profile text kept local so typing isn't fought by re-derivation
  const [name, setName] = useState(profile.name);
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');

  useEffect(() => {
    setName(profile.name);
    if (profile.heightCm != null) {
      setHeight(String(settings.units === 'metric' ? Math.round(profile.heightCm) : Math.round(profile.heightCm / 2.54)));
    } else setHeight('');
    if (profile.weightKg != null) {
      setWeight(String(settings.units === 'metric' ? Math.round(profile.weightKg) : Math.round(profile.weightKg * 2.2046)));
    } else setWeight('');
  // re-derive when units change or profile identity changes
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
      <DashHeader title="SETTINGS" onExit={onExit} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

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
          <View style={styles.switchRow}>
            <Text style={styles.rowLabel}>Sound effects</Text>
            <Switch
              value={settings.sound}
              onValueChange={(v) => update({ sound: v })}
              trackColor={{ true: accentColor, false: colors.surfaceHigh }}
              thumbColor="#fff"
            />
          </View>

          <View style={styles.divider} />
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
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)}
            style={[styles.segItem, on && { backgroundColor: accent }]}>
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
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },

  swatches: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.sm },
  swatch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: colors.text },
  swatchCheck: { fontSize: 16, fontWeight: '900' },

  segment: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3, marginBottom: spacing.sm },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  segText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  segTextOn: { color: colors.bg },
});
