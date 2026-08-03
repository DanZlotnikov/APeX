import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { JointCheck, JointFixationCheck, JointRomCheck, VideoJobAnalysis } from '../api/videoJobs';
import { exerciseLabel, readinessPctFromAnalysis } from '../utils/pipelineExercise';
import { colors, riskColor, spacing } from '../theme';
import MetricInfoModal from './MetricInfoModal';
import ReadinessGauge from './ReadinessGauge';
import RepBreakdownModal from './RepBreakdownModal';

interface Props {
  analysis: VideoJobAnalysis | null;
  fallbackExerciseType?: string | null;
  repCount: number;
}

interface BreakdownTarget {
  kind: 'balance' | 'rom' | 'fixation';
  check: JointCheck | JointRomCheck | JointFixationCheck;
}

interface InfoTarget {
  label: string;
  description: string;
  research: string[];
}

function severityStatus(s: 'ok' | 'watch' | 'at_risk'): 'green' | 'yellow' | 'red' {
  return s === 'ok' ? 'green' : s === 'watch' ? 'yellow' : 'red';
}

// Readiness decision (see migration 016): averages L/R balance and range of
// motion when both are present for this exercise — an athlete who's
// perfectly symmetric but barely dipping (poor ROM), or vice versa,
// shouldn't read as "Good" on one score alone. Computed the same way
// client-side here as save_video_job computes it server-side, so a
// completed-but-not-yet-saved job (this component's data straight from
// video_jobs.analysis_json) shows the identical number it'll have once
// saved into sessions.readiness_score — never a value that changes the
// moment Save is tapped. Falls back to whichever single score is present
// if only one analyzer produced a result (e.g. 0 reps). Same Good/Fair/Low
// bands ReadinessGauge already uses for its color (>=80/>=55/below).
function readinessLabelFor(pct: number): string {
  return pct >= 80 ? 'Good' : pct >= 55 ? 'Fair' : 'Low';
}

/**
 * Renders one video_jobs/sessions analysis_json report (see
 * HANDOFF_video_pipeline.md section 1): the balance (L/R symmetry), ROM
 * (range-of-motion), and fixation (steadiness — e.g. Padel Stroke's arm
 * fixation) breakdowns, each exercise's own separately-titled but
 * identically-styled block, whichever of the three this exercise actually
 * has profiles for — "readiness" is now derived from whichever are present,
 * see readinessLabelFor above / pipelineExercise.ts's
 * readinessPctFromAnalysis. Shared by the Processing tab's completed-job
 * card and Performance > History's session detail — same shape, same
 * rendering either way.
 *
 * Each metric row is tappable two ways: the row itself opens a per-rep
 * breakdown (RepBreakdownModal), and its "?" badge opens an explainer
 * (MetricInfoModal) — both full-screen/popup Modals rather than pushed nav
 * screens, since this component is rendered from several independent
 * navigation stacks (Processing tab, and every History-stack duplicate) and
 * a Modal works identically regardless of which one currently hosts it.
 */
export default function BiomechanicsReport({ analysis, fallbackExerciseType, repCount }: Props) {
  const balance = analysis?.analyses?.balance ?? null;
  const rom = analysis?.analyses?.rom ?? null;
  const fixation = analysis?.analyses?.fixation ?? null;
  const exerciseType = analysis?.exercise ?? fallbackExerciseType ?? null;
  const repWindows = analysis?.reps ?? [];

  const [breakdownFor, setBreakdownFor] = useState<BreakdownTarget | null>(null);
  const [infoFor, setInfoFor] = useState<InfoTarget | null>(null);

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

              {balance.joint_checks.map((jc) => (
                <JointRow
                  key={jc.id}
                  check={jc}
                  pctValue={jc.balance_pct}
                  color={riskColor(severityStatus(jc.severity))}
                  onPressRow={() => setBreakdownFor({ kind: 'balance', check: jc })}
                  onPressInfo={() => setInfoFor({ label: jc.label, description: jc.description, research: jc.research })}
                />
              ))}
            </View>
          )}

          {rom && (
            <View style={styles.balanceCard}>
              <View style={styles.balanceHead}>
                <Text style={styles.balanceTitle}>RANGE OF MOTION</Text>
                <Text style={styles.balanceScore}>{Math.round(rom.overall_rom_pct)}%</Text>
              </View>

              {rom.joint_checks.map((jc) => (
                <JointRow
                  key={jc.id}
                  check={jc}
                  pctValue={jc.rom_pct}
                  color={riskColor(severityStatus(jc.severity))}
                  onPressRow={() => setBreakdownFor({ kind: 'rom', check: jc })}
                  onPressInfo={() => setInfoFor({ label: jc.label, description: jc.description, research: jc.research })}
                />
              ))}
            </View>
          )}

          {fixation && (
            <View style={styles.balanceCard}>
              <View style={styles.balanceHead}>
                <Text style={styles.balanceTitle}>ARM FIXATION</Text>
                <Text style={styles.balanceScore}>{Math.round(fixation.overall_fixation_pct)}%</Text>
              </View>

              {fixation.joint_checks.map((jc) => (
                <JointRow
                  key={jc.id}
                  check={jc}
                  pctValue={jc.fixation_pct}
                  color={riskColor(severityStatus(jc.severity))}
                  onPressRow={() => setBreakdownFor({ kind: 'fixation', check: jc })}
                  onPressInfo={() => setInfoFor({ label: jc.label, description: jc.description, research: jc.research })}
                />
              ))}
            </View>
          )}
        </>
      ) : (
        <View style={styles.noData}>
          <Text style={styles.noDataText}>No readiness data for this exercise yet.</Text>
        </View>
      )}

      {breakdownFor && (
        <RepBreakdownModal
          visible
          onClose={() => setBreakdownFor(null)}
          kind={breakdownFor.kind}
          check={breakdownFor.check}
          reps={repWindows}
        />
      )}
      {infoFor && (
        <MetricInfoModal
          visible
          onClose={() => setInfoFor(null)}
          label={infoFor.label}
          description={infoFor.description}
          research={infoFor.research}
        />
      )}
    </View>
  );
}

function JointRow({
  check, pctValue, color, onPressRow, onPressInfo,
}: {
  check: JointCheck | JointRomCheck | JointFixationCheck;
  pctValue: number;
  color: string;
  onPressRow: () => void;
  onPressInfo: () => void;
}) {
  return (
    <Pressable
      onPress={onPressRow}
      style={({ pressed }) => [
        styles.jointRow,
        check.informational && styles.jointRowInformational,
        pressed && styles.jointRowPressed,
      ]}
    >
      <View style={styles.jointTop}>
        <Text style={styles.jointLabel} numberOfLines={1}>{check.label}</Text>
        {/* Nested Pressable — RN's responder system gives the touch to
            this one, not the row's own onPress, when tapped directly. */}
        <Pressable
          hitSlop={8}
          onPress={onPressInfo}
          style={({ pressed }) => [styles.infoBadge, pressed && styles.pressed]}
        >
          <Text style={styles.infoBadgeText}>?</Text>
        </Pressable>
      </View>
      <View style={styles.jointBottom}>
        <Text style={[styles.jointPct, { color }]}>{Math.round(pctValue)}%</Text>
        <View style={styles.jointTrack}>
          <View style={[styles.jointFill, { width: `${Math.max(0, Math.min(100, pctValue))}%`, backgroundColor: color }]} />
        </View>
      </View>
    </Pressable>
  );
}

const INFO_BADGE_SIZE = 18;

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

  jointRow: { marginTop: spacing.lg },
  jointRowPressed: { opacity: 0.7 },
  jointRowInformational: { opacity: 0.6 },
  jointTop: { flexDirection: 'row', alignItems: 'center' },
  jointLabel: { flexShrink: 1, color: colors.text, fontSize: 13, fontWeight: '600' },
  jointBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6 },
  jointPct: { fontSize: 13, fontWeight: '800' },
  jointTrack: { flex: 1, height: 4, backgroundColor: colors.surfaceHigh, borderRadius: 2, overflow: 'hidden' },
  jointFill: { height: 4, borderRadius: 2 },
  informationalNote: { color: colors.muted, fontSize: 10, marginTop: 3, fontStyle: 'italic' },

  pressed: { opacity: 0.5 },
  infoBadge: {
    width: INFO_BADGE_SIZE, height: INFO_BADGE_SIZE, borderRadius: INFO_BADGE_SIZE / 2,
    borderWidth: 1.5, borderColor: colors.muted, marginLeft: spacing.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  infoBadgeText: { color: colors.muted, fontSize: 11, fontWeight: '800', includeFontPadding: false, marginTop: -1 },
});
