import { DarkTheme, NavigationContainer, useNavigation } from '@react-navigation/native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import LineTrend from '../../components/charts/LineTrend';
import FloatingTabBar from '../../components/FloatingTabBar';
import { markAthleteInjured, markAthleteRecovered } from '../../api/athletes';
import { AthleteViewModel } from '../../api/types';
import { colors, spacing } from '../../theme';
import { confirmAsync } from '../../utils/confirm';
import { readinessColor as colorForReadiness } from '../../utils/readiness';
import HistoryDetailScreen from '../dashboard/HistoryDetailScreen';
import HistoryScreen from '../dashboard/HistoryScreen';
import ReadinessScreen from '../dashboard/ReadinessScreen';
import IndividualRoutineScreen from '../IndividualRoutineScreen';

const Tab = createMaterialTopTabNavigator();
const HistoryStackNav = createNativeStackNavigator();
const ProfileStackNav = createNativeStackNavigator();

// ︎ = variation selector-15: forces text rendering, prevents iOS emoji substitution
// Routine reuses the same glyph as the athlete-side Routine tab
// (DashboardScreen.tsx) for visual consistency across both surfaces.
const GLYPH: Record<string, string> = { Profile: '◉︎', History: '≡︎', Routine: '☑︎' };

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.surface, border: colors.border, text: colors.text },
};

interface Props {
  athlete: AthleteViewModel;
  onStatusChanged: () => void;
}

// Same floating pill tab bar as ManagerHome/DashboardScreen (see their own
// copies of this exact styling) — Profile is the identity/injury-status view
// that used to be this whole screen; History reuses the athlete-facing
// History/HistoryDetail screens verbatim, just pointed at this athlete's id
// instead of the signed-in user's own, since both already take an explicit
// userId param rather than assuming "self" (see HANDOFF/manager module audit).
export default function AthleteDetailPreview({ athlete, onStatusChanged }: Props) {
  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        tabBarPosition="bottom"
        tabBar={(props) => <FloatingTabBar {...props} glyphs={GLYPH} />}
        screenOptions={{
          lazy: true,
          swipeEnabled: false,
          animationEnabled: true,
        }}
      >
        <Tab.Screen name="Profile">
          {() => <AthleteProfileStack athlete={athlete} onStatusChanged={onStatusChanged} />}
        </Tab.Screen>
        <Tab.Screen name="History">
          {() => <AthleteHistoryTab athleteId={athlete.id} />}
        </Tab.Screen>
        <Tab.Screen name="Routine">
          {() => <IndividualRoutineScreen athleteId={athlete.id} readOnly={false} />}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function AthleteHistoryTab({ athleteId }: { athleteId: string }) {
  return (
    <HistoryStackNav.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <HistoryStackNav.Screen name="HistoryList">
        {() => <HistoryScreen userId={athleteId} />}
      </HistoryStackNav.Screen>
      <HistoryStackNav.Screen name="HistoryDetail">
        {() => <HistoryDetailScreen userId={athleteId} canDelete={false} />}
      </HistoryStackNav.Screen>
    </HistoryStackNav.Navigator>
  );
}

// Wraps AthleteProfileTab in its own local stack (same pattern
// AthleteHistoryTab above already uses) so tapping its "READINESS TREND"
// card can push a Readiness screen while Profile stays a peer of the other
// top-tabs. HistoryDetail is duplicated here rather than shared cross-stack
// with History's own copy — same duplication already established above.
function AthleteProfileStack({ athlete, onStatusChanged }: Props) {
  return (
    <ProfileStackNav.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <ProfileStackNav.Screen name="ProfileMain">
        {() => <AthleteProfileTab athlete={athlete} onStatusChanged={onStatusChanged} />}
      </ProfileStackNav.Screen>
      <ProfileStackNav.Screen name="Readiness">
        {() => <ReadinessScreen athleteId={athlete.id} backLabel="Profile" />}
      </ProfileStackNav.Screen>
      <ProfileStackNav.Screen name="HistoryDetail">
        {() => <HistoryDetailScreen userId={athlete.id} canDelete={false} />}
      </ProfileStackNav.Screen>
    </ProfileStackNav.Navigator>
  );
}

function AthleteProfileTab({ athlete, onStatusChanged }: Props) {
  const navigation = useNavigation<any>();
  const readinessColor = colorForReadiness(athlete.readiness);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);

  async function handleMarkInjured() {
    const ok = await confirmAsync(
      'Mark as injured?',
      'Are you sure? Injury pipeline will reset all stats.',
      { destructive: true },
    );
    if (!ok) return;

    setMarking(true);
    setMarkError(null);
    try {
      await markAthleteInjured(athlete.id);
      onStatusChanged();
    } catch (e) {
      setMarkError(e instanceof Error ? e.message : 'Failed to mark athlete as injured.');
    } finally {
      setMarking(false);
    }
  }

  async function handleMarkRecovered() {
    const ok = await confirmAsync(
      'End injury tracking?',
      'Are you sure? This returns the player to the regular roster and resets stats, starting a new tracking period from now.',
    );
    if (!ok) return;

    setMarking(true);
    setMarkError(null);
    try {
      await markAthleteRecovered(athlete.id);
      onStatusChanged();
    } catch (e) {
      setMarkError(e instanceof Error ? e.message : 'Failed to mark athlete as recovered.');
    } finally {
      setMarking(false);
    }
  }

  const history       = athlete.readinessHistory;
  const best          = history.length > 0 ? Math.max(...history) : 0;
  const avg           = history.length > 0
    ? Math.round(history.reduce((a, b) => a + b, 0) / history.length)
    : 0;
  const trend         = history.length >= 2
    ? history[history.length - 1] - history[history.length - 2]
    : 0;
  const trendPositive = trend >= 0;
  const trendColor    = trendPositive ? '#00D4BC' : '#FF3B30';
  const trendLabel    = `${trendPositive ? '+' : ''}${trend}%`;

  const lastTestFull  = athlete.lastTestTime
    ? `${athlete.lastTestDate} · ${athlete.lastTestTime}`
    : athlete.lastTestDate;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Identity ── */}
        <View>
          <Text style={styles.kicker}>ATHLETE PROFILE</Text>
          <Text style={styles.name}>{athlete.name}</Text>
        </View>

        {/* ── Profile row ── */}
        <View style={styles.profileCard}>
          <ProfileCell label="POSITION" value={athlete.profile.position} />
          <ProfileCell label="HEIGHT"   value={`${athlete.profile.heightCm} cm`} />
          <ProfileCell label="WEIGHT"   value={`${athlete.profile.weightKg} kg`} />
          <ProfileCell label="AGE"      value={String(athlete.profile.age)} />
        </View>

        {/* ── Readiness trend — tap through to the full per-exercise
            Readiness screen (screens/dashboard/ReadinessScreen.tsx); this
            card itself is unchanged, just now an entry point. ── */}
        {history.length > 0 && (
          <Pressable
            onPress={() => navigation.navigate('Readiness')}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>READINESS TREND</Text>
              <View style={styles.cardHeadRight}>
                {history.length >= 2 && (
                  <View style={[
                    styles.trendBadge,
                    {
                      borderColor:       trendColor,
                      backgroundColor:   trendPositive ? 'rgba(0,212,188,0.08)' : 'rgba(255,59,48,0.08)',
                    },
                  ]}>
                    <Text style={[styles.trendBadgeText, { color: trendColor }]}>{trendLabel} vs prev</Text>
                  </View>
                )}
                <Text style={styles.cardChevron}>›</Text>
              </View>
            </View>

            <View style={styles.trendMiniStats}>
              <TrendStat label="LATEST"   value={`${athlete.readiness}%`}       color={readinessColor} />
              <TrendStat label="BEST"     value={`${best}%`}                     color={colors.text} />
              <TrendStat label="AVG"      value={`${avg}%`}                      color={colors.text} />
              <TrendStat label="SESSIONS" value={String(athlete.totalSessions)}  color={colors.text} />
            </View>

            <LineTrend
              data={history}
              color={readinessColor}
              min={50}
              max={100}
              height={120}
              startLabel="Last 30 days"
              endLabel="Today"
            />
          </Pressable>
        )}

        {/* ── Last test ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>LAST TEST</Text>
          <Text style={styles.cardValue}>{lastTestFull}</Text>
          {athlete.missingTests > 0 && (
            <View style={styles.missingRow}>
              <Text style={styles.missingIcon}>!</Text>
              <Text style={styles.missingText}>
                {athlete.missingTests} required test{athlete.missingTests > 1 ? 's' : ''} not completed today
              </Text>
            </View>
          )}
        </View>

        {/* ── Injury status ── */}
        {athlete.injured ? (
          <>
            <View style={styles.injuredBanner}>
              <View style={styles.injuredIconWrap}>
                <Text style={styles.injuredIcon}>+</Text>
              </View>
              <Text style={styles.injuredText}>
                Marked injured on {athlete.injuryStartedAt ? new Date(athlete.injuryStartedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'} — stats reset from this point.
              </Text>
            </View>
            <View style={styles.injuryAction}>
              <Pressable
                onPress={handleMarkRecovered}
                disabled={marking}
                style={({ pressed }) => [styles.recoverBtn, (pressed || marking) && styles.recoverBtnPressed]}
              >
                {marking
                  ? <ActivityIndicator color={colors.primary} size="small" />
                  : <Text style={styles.recoverBtnText}>MARK AS RECOVERED</Text>}
              </Pressable>
              {markError && <Text style={styles.injuryError}>{markError}</Text>}
            </View>
          </>
        ) : (
          <View style={styles.injuryAction}>
            <Pressable
              onPress={handleMarkInjured}
              disabled={marking}
              style={({ pressed }) => [styles.injuryBtn, (pressed || marking) && styles.injuryBtnPressed]}
            >
              {marking
                ? <ActivityIndicator color="#FF3B30" size="small" />
                : <Text style={styles.injuryBtnText}>MARK AS INJURED</Text>}
            </Pressable>
            {markError && <Text style={styles.injuryError}>{markError}</Text>}
          </View>
        )}

      </ScrollView>
    </View>
  );
}

function ProfileCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.profileCell}>
      <Text style={styles.profileValue}>{value}</Text>
      <Text style={styles.profileLabel}>{label}</Text>
    </View>
  );
}

function TrendStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.trendStat}>
      <Text style={[styles.trendStatValue, { color }]}>{value}</Text>
      <Text style={styles.trendStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 80 },

  kicker: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2.5, marginBottom: 2 },
  name:   { color: colors.text,  fontSize: 28, fontWeight: '900', letterSpacing: 0.3 },

  profileCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
  },
  profileCell:  { flex: 1, alignItems: 'center' },
  profileValue: { color: colors.text, fontSize: 13, fontWeight: '800' },
  profileLabel: { color: colors.muted, fontSize: 8, fontWeight: '700', letterSpacing: 1.2, marginTop: 3 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardPressed: { opacity: 0.7 },
  cardHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardChevron: { color: colors.muted, fontSize: 18, fontWeight: '400' },
  cardTitle: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  cardValue: { color: colors.text,  fontSize: 15, fontWeight: '700' },

  trendBadge:     { borderRadius: 6, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  trendBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },

  trendMiniStats: { flexDirection: 'row' },
  trendStat:      { flex: 1, alignItems: 'center' },
  trendStatValue: { fontSize: 15, fontWeight: '800' },
  trendStatLabel: { color: colors.muted, fontSize: 8, fontWeight: '700', letterSpacing: 1.2, marginTop: 2 },

  missingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,59,48,0.08)',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.25)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 2,
  },
  missingIcon: { color: '#FF3B30', fontSize: 13, fontWeight: '900' },
  missingText: { color: colors.text, fontSize: 12, fontWeight: '500', flex: 1 },

  injuryAction: { alignItems: 'center', marginTop: spacing.sm },
  injuryBtn: {
    borderWidth: 1.5,
    borderColor: '#FF3B30',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 200,
  },
  injuryBtnPressed: { backgroundColor: 'rgba(255,59,48,0.1)' },
  injuryBtnText: { color: '#FF3B30', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  injuryError: { color: '#FF3B30', fontSize: 11, textAlign: 'center', marginTop: spacing.sm },

  recoverBtn: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 200,
  },
  recoverBtnPressed: { backgroundColor: 'rgba(0,212,188,0.1)' },
  recoverBtnText: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },

  injuredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(59,130,246,0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.3)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  injuredIconWrap: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 1, borderColor: '#3B82F6',
    alignItems: 'center', justifyContent: 'center',
  },
  injuredIcon: {
    color: '#3B82F6', fontSize: 13, fontWeight: '900', lineHeight: 15,
  },
  injuredText: { color: colors.text, fontSize: 12, fontWeight: '500', flex: 1, lineHeight: 17 },
});
