import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { getTeamInviteCode, getTeamSettings, regenerateInviteCode, updateRequiredTest, updateTeamSettings } from '../../api/teams';
import { TeamSettingsViewModel } from '../../api/types';
import { colors, spacing } from '../../theme';

interface Props {
  teamId: string;
}

export default function ManagerSettings({ teamId }: Props) {
  const [settings,     setSettings]     = useState<TeamSettingsViewModel | null>(null);
  const [inviteCode,   setInviteCode]   = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getTeamSettings(teamId)
      .then(setSettings)
      .catch((e) => console.warn('Failed to load team settings', e));
    getTeamInviteCode(teamId)
      .then(setInviteCode)
      .catch((e) => console.warn('Failed to load invite code', e));
  }, [teamId]);

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

  function scheduleSave(patch: Partial<Pick<TeamSettingsViewModel, 'readinessThreshold' | 'maxLRImbalance' | 'requiredTestsPerDay'>>) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void updateTeamSettings(teamId, patch);
    }, 600);
  }

  async function toggleTest(id: string, enabled: boolean) {
    if (!settings) return;
    setSettings((s) => s && {
      ...s,
      requiredTests: s.requiredTests.map((t) => t.id === id ? { ...t, enabled } : t),
    });
    await updateRequiredTest(id, enabled);
  }

  if (!settings) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
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
              value={settings.teamName}
              onChangeText={(v) => setSettings((s) => s && { ...s, teamName: v })}
              placeholderTextColor={colors.muted}
              selectionColor={colors.primary}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ATHLETE INVITE CODE</Text>
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>SHARE THIS CODE WITH ATHLETES</Text>
            <View style={styles.codeRow}>
              <Text selectable style={styles.codeText}>{inviteCode || '——'}</Text>
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
                  ? <ActivityIndicator color={colors.primary} size="small" />
                  : <Text style={styles.regenBtnText}>↺  REGENERATE</Text>}
              </Pressable>
            </View>
            <Text style={styles.codeNote}>
              Athletes enter this code when creating their account. Regenerating invalidates the old code.
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>REQUIRED DAILY TESTS</Text>
          <View style={styles.card}>
            {settings.requiredTests.map((test, i) => (
              <View
                key={test.id}
                style={[styles.switchRow, i < settings.requiredTests.length - 1 && styles.switchRowBorder]}
              >
                <Text style={styles.switchLabel}>{test.label}</Text>
                <Switch
                  value={test.enabled}
                  onValueChange={(v) => void toggleTest(test.id, v)}
                  trackColor={{ false: colors.border, true: 'rgba(0,212,188,0.3)' }}
                  thumbColor={test.enabled ? colors.primary : colors.muted}
                />
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>THRESHOLDS</Text>
          <View style={styles.card}>
            <View style={styles.sliderRow}>
              <View style={styles.sliderLabelRow}>
                <Text style={styles.fieldLabel}>READINESS THRESHOLD</Text>
                <Text style={styles.sliderValue}>{settings.readinessThreshold}%</Text>
              </View>
              <SliderBar
                value={settings.readinessThreshold}
                min={50} max={100}
                color={colors.primary}
                onChange={(v) => {
                  setSettings((s) => s && { ...s, readinessThreshold: v });
                  scheduleSave({ readinessThreshold: v });
                }}
              />
            </View>

            <View style={[styles.sliderRow, styles.sliderRowBorder]}>
              <View style={styles.sliderLabelRow}>
                <Text style={styles.fieldLabel}>MAX L/R IMBALANCE</Text>
                <Text style={styles.sliderValue}>{settings.maxLRImbalance}%</Text>
              </View>
              <SliderBar
                value={settings.maxLRImbalance}
                min={5} max={30}
                color="#F5A623"
                onChange={(v) => {
                  setSettings((s) => s && { ...s, maxLRImbalance: v });
                  scheduleSave({ maxLRImbalance: v });
                }}
              />
            </View>

            <View style={[styles.sliderRow, styles.sliderRowBorder]}>
              <View style={styles.sliderLabelRow}>
                <Text style={styles.fieldLabel}>REQUIRED TESTS PER DAY</Text>
                <Text style={styles.sliderValue}>{settings.requiredTestsPerDay}</Text>
              </View>
              <SliderBar
                value={settings.requiredTestsPerDay}
                min={1} max={6}
                color={colors.primary}
                onChange={(v) => {
                  setSettings((s) => s && { ...s, requiredTestsPerDay: v });
                  scheduleSave({ requiredTestsPerDay: v });
                }}
              />
            </View>
          </View>
        </View>

        <View style={styles.saveNote}>
          <Text style={styles.saveNoteText}>Settings are saved automatically.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function SliderBar({
  value, min, max, color, onChange,
}: {
  value: number; min: number; max: number; color: string; onChange: (v: number) => void;
}) {
  const pct = (value - min) / (max - min);
  return (
    <View style={sliderStyles.row}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        style={({ pressed }) => [sliderStyles.stepBtn, pressed && { opacity: 0.6 }]}
      >
        <Text style={sliderStyles.stepText}>−</Text>
      </Pressable>
      <View style={sliderStyles.track}>
        <View style={[sliderStyles.fill, { width: `${pct * 100}%` as any, backgroundColor: color }]} />
      </View>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 1))}
        style={({ pressed }) => [sliderStyles.stepBtn, pressed && { opacity: 0.6 }]}
      >
        <Text style={sliderStyles.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  stepBtn: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  stepText: { color: colors.text, fontSize: 16, fontWeight: '700', lineHeight: 18 },
  track: { flex: 1, height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
  fill:  { height: '100%', borderRadius: 3 },
});

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
  switchRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  switchRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  switchLabel:     { color: colors.text, fontSize: 14, fontWeight: '600' },

  sliderRow:       { paddingVertical: spacing.md },
  sliderRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  sliderLabelRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sliderValue:     { color: colors.text, fontSize: 16, fontWeight: '800' },

  saveNote:     { alignItems: 'center', paddingVertical: spacing.sm },
  saveNoteText: { color: colors.muted, fontSize: 11, fontWeight: '500', fontStyle: 'italic' },

  codeRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, marginBottom: spacing.sm },
  codeText:    { color: colors.primary, fontSize: 28, fontWeight: '900', letterSpacing: 6, fontVariant: ['tabular-nums'] },
  codeNote:    { color: colors.muted, fontSize: 11, fontWeight: '500', lineHeight: 16, marginBottom: spacing.sm },
  regenBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surfaceHigh,
    borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: 8,
    minWidth: 44, justifyContent: 'center',
  },
  regenBtnText: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
});
