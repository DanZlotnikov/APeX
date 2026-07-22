import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { VideoJobAnalysis } from '../api/videoJobs';
import { exerciseLabel, readinessPctFromAnalysis } from '../utils/pipelineExercise';
import { colors, riskColor, spacing } from '../theme';
import ReadinessGauge from './ReadinessGauge';

interface Props {
  analysis: VideoJobAnalysis | null;
  fallbackExerciseType?: string | null;
  repCount: number;
}

function severityStatus(s: 'ok' | 'watch' | 'at_risk'): 'green' | 'yellow' | 'red' {
  return s === 'ok' ? 'green' : s === 'watch' ? 'yellow' : 'red';
}

// Readiness decision (see migration 016): averages L/R balance and range of
// motion when both are present for this exercise — an athlete who's
// perfectly symmetric but barely dipping (poor ROM), or vice versa,
// shouldn't read as "Ready" on one score alone. Computed the same way
// client-side here as save_video_job computes it server-side, so a
// completed-but-not-yet-saved job (this component's data straight from
// video_jobs.analysis_json) shows the identical number it'll have once
// saved into sessions.readiness_score — never a value that changes the
// moment Save is tapped. Falls back to whichever single score is present
// if only one analyzer produced a result (e.g. 0 reps). Same Ready/Caution/
// High Risk bands ReadinessGauge already uses for its color (>=80/>=55/below).
function readinessLabelFor(pct: number): string {
  return pct >= 80 ? 'Ready' : pct >= 55 ? 'Caution' : 'High Risk';
}

/**
 * Renders one video_jobs/sessions analysis_json report (see
 * HANDOFF_video_pipeline.md section 1): the balance (L/R symmetry) and ROM
 * (range-of-motion) breakdowns, each exercise's own separately-titled but
 * identically-styled block, which "readiness" is now derived from — see
 * readinessLabelFor above. Shared by the Processing tab's completed-job
 * card and Performance > History's session detail — same shape, same
 * rendering either way.
 */
export default function BiomechanicsReport({ analysis, fallbackExerciseType, repCount }: Props) {
  const balance = analysis?.analyses?.balance ?? null;
  const rom = analysis?.analyses?.rom ?? null;
  const exerciseType = analysis?.exercise ?? fallbackExerciseType ?? null;

  const readinessPct = readinessPctFromAnalysis(analysis);

  return (
    <View>
      <View style={styles.headRow}>
        <Text style={styles.exercise}>{exerciseLabel(exerciseType)}</Text>
        <Text style={styles.reps}>{repCount} rep{repCount === 1 ? '' : 's'}</Text>
      </View>

      {readinessPct != null ? (
        <>
          <ReadinessGauge readiness={Math.round(readinessPct)} label={readinessLabelFor(readinessPct)} />

          {balance && (
            <View style={styles.balanceCard}>
              <View style={styles.balanceHead}>
                <Text style={styles.balanceTitle}>L/R BALANCE</Text>
                <Text style={styles.balanceScore}>{Math.round(balance.overall_balance_pct)}%</Text>
              </View>

              {balance.joint_checks.map((jc) => {
                const color = riskColor(severityStatus(jc.severity));
                return (
                  <View key={jc.id} style={[styles.jointRow, jc.informational && styles.jointRowInformational]}>
                    <View style={styles.jointTop}>
                      <Text style={styles.jointLabel} numberOfLines={1}>{jc.label}</Text>
                      <Text style={[styles.jointPct, { color }]}>{Math.round(jc.balance_pct)}%</Text>
                    </View>
                    <View style={styles.jointTrack}>
                      <View style={[styles.jointFill, { width: `${Math.max(0, Math.min(100, jc.balance_pct))}%`, backgroundColor: color }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {rom && (
            <View style={styles.balanceCard}>
              <View style={styles.balanceHead}>
                <Text style={styles.balanceTitle}>RANGE OF MOTION</Text>
                <Text style={styles.balanceScore}>{Math.round(rom.overall_rom_pct)}%</Text>
              </View>

              {rom.joint_checks.map((jc) => {
                const color = riskColor(severityStatus(jc.severity));
                return (
                  <View key={jc.id} style={[styles.jointRow, jc.informational && styles.jointRowInformational]}>
                    <View style={styles.jointTop}>
                      <Text style={styles.jointLabel} numberOfLines={1}>{jc.label}</Text>
                      <Text style={[styles.jointPct, { color }]}>{Math.round(jc.rom_pct)}%</Text>
                    </View>
                    <View style={styles.jointTrack}>
                      <View style={[styles.jointFill, { width: `${Math.max(0, Math.min(100, jc.rom_pct))}%`, backgroundColor: color }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </>
      ) : (
        <View style={styles.noData}>
          <Text style={styles.noDataText}>No readiness data for this exercise yet.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  exercise: { color: colors.text, fontSize: 18, fontWeight: '800' },
  reps: { color: colors.muted, fontSize: 13, fontWeight: '600' },

  noData: { alignItems: 'center', paddingVertical: spacing.lg },
  noDataText: { color: colors.muted, fontSize: 13 },

  balanceCard: {
    marginTop: spacing.md,
    backgroundColor: colors.surfaceHigh,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  balanceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  balanceTitle: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  balanceScore: { color: colors.text, fontSize: 16, fontWeight: '900' },

  jointRow: { marginTop: spacing.sm },
  jointRowInformational: { opacity: 0.6 },
  jointTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jointLabel: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600' },
  jointPct: { fontSize: 13, fontWeight: '800', marginLeft: spacing.sm },
  jointTrack: { height: 4, backgroundColor: colors.surfaceHigh, borderRadius: 2, overflow: 'hidden', marginTop: 6 },
  jointFill: { height: 4, borderRadius: 2 },
  informationalNote: { color: colors.muted, fontSize: 10, marginTop: 3, fontStyle: 'italic' },
});
