import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import LineTrend from '../../components/charts/LineTrend';
import { AthleteViewModel } from '../../api/types';
import { colors, spacing } from '../../theme';

interface Props {
  athlete: AthleteViewModel;
}

export default function AthleteDetailPreview({ athlete }: Props) {
  const readinessColor =
    athlete.readiness >= 80 ? '#00D4BC' :
    athlete.readiness >= 65 ? '#F5A623' : '#FF3B30';

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

        {/* ── Readiness trend ── */}
        {history.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>READINESS TREND</Text>
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
          </View>
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
  cardHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
});
