import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { VideoJobAnalysis } from '../api/videoJobs';
import { exerciseLabel } from '../utils/pipelineExercise';
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

// Stopgap readiness decision (see migration 011): the legacy formula's
// readiness_score (squat/jump/pullup only) and the new pipeline's balance
// score are independently computed and can disagree for the same session —
// e.g. legacy=100 while balance=93 — confusing to show side by side. Until a
// more precise unified assessment is built, "readiness" everywhere is just
// overall_balance_pct, rounded, using the same Ready/Caution/High Risk bands
// ReadinessGauge already uses for its color (>=80/>=55/below).
function readinessLabelFor(pct: number): string {
  return pct >= 80 ? 'Ready' : pct >= 55 ? 'Caution' : 'High Risk';
}

/**
 * Renders one video_jobs/sessions analysis_json report (see
 * HANDOFF_video_pipeline.md section 1): the balance/joint-symmetry
 * breakdown, which every exercise has (and which "readiness" is now derived
 * from — see readinessLabelFor above). Shared by the Processing tab's
 * completed-job card and Performance > History's session detail — same
 * shape, same rendering either way.
 */
export default function BiomechanicsReport({ analysis, fallbackExerciseType, repCount }: Props) {
  const balance = analysis?.analyses?.balance ?? null;
  const exerciseType = analysis?.exercise ?? fallbackExerciseType ?? null;

  return (
    <View>
      <View style={styles.headRow}>
        <Text style={styles.exercise}>{exerciseLabel(exerciseType)}</Text>
        <Text style={styles.reps}>{repCount} rep{repCount === 1 ? '' : 's'}</Text>
      </View>

      {balance ? (
        <>
          <ReadinessGauge readiness={Math.round(balance.overall_balance_pct)} label={readinessLabelFor(balance.overall_balance_pct)} />

          <View style={styles.balanceCard}>
            <View style={styles.balanceHead}>
              <Text style={styles.balanceTitle}>BALANCE</Text>
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
                  {jc.informational && <Text style={styles.informationalNote}>Engineering estimate — not literature-validated</Text>}
                </View>
              );
            })}
          </View>
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
