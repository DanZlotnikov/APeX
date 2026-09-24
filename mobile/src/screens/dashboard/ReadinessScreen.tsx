import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '../../components/ui/Text';
import { getExercisesWithHistory, getReadinessTrend, ReadinessPoint, ReadinessWindowDays } from '../../api/readiness';
import { getSessionHistoryPage, SessionHistoryEntry } from '../../api/sessions';
import ExercisePicker, { ExercisePickerOption } from '../../components/ExercisePicker';
import LineTrend from '../../components/charts/LineTrend';
import { useSettings } from '../../state/SettingsContext';
import { colors, spacing } from '../../theme';
import { exerciseLabel } from '../../utils/pipelineExercise';
import { formatDuration, formatSessionDateTime } from '../../utils/format';
import { readinessColor } from '../../utils/readiness';
import DashHeader from './DashHeader';

const PAGE_SIZE = 3;
const SCROLL_LOAD_THRESHOLD = 200; // px from the bottom that triggers the next page

const WINDOW_OPTIONS: { days: ReadinessWindowDays; label: string }[] = [
  { days: 7, label: '7D' },
  { days: 30, label: '30D' },
  { days: 90, label: '90D' },
  { days: 365, label: '1Y' },
];

interface Props {
  athleteId?: string;
  /** Origin screen's name — "Overview" (athlete's own tab) or "Profile"
   * (manager's per-athlete tab) — shown on the back button. */
  backLabel: string;
}

// Reached by tapping the "READINESS TREND" card on either the athlete's own
// Overview screen or the manager's per-athlete Profile tab — same shared-
// component-by-athleteId pattern as IndividualRoutineScreen/HistoryScreen.
// Chart is windowed (7d/30d/90d/1y) and exercise-filtered; the history list
// below it is exercise-filtered only, independent of the chart's window
// (see api/readiness.ts's getExercisesWithHistory/getReadinessTrend).
export default function ReadinessScreen({ athleteId, backLabel }: Props) {
  const navigation = useNavigation<any>();
  const { accentColor } = useSettings();

  const [exerciseOptions, setExerciseOptions] = useState<ExercisePickerOption[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState<ReadinessWindowDays>(7);

  const [trendPoints, setTrendPoints] = useState<ReadinessPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);

  const [historyRows, setHistoryRows] = useState<SessionHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const loadingMoreRef = useRef(false);

  // Exercise option list — loaded once per mount, not re-filtered by
  // window/selection (this screen is pushed fresh each visit, unlike a tab
  // that stays mounted, so a plain effect-on-mount is enough — same reason
  // HistoryDetailScreen uses a plain useEffect rather than useFocusEffect).
  useEffect(() => {
    let active = true;
    if (!athleteId) { setExerciseOptions([]); return; }
    getExercisesWithHistory(athleteId)
      .then((keys) => { if (active) setExerciseOptions(keys.map((k) => ({ key: k, label: exerciseLabel(k) }))); })
      .catch((e) => console.warn('[APeX] Failed to load exercise list:', e));
    return () => { active = false; };
  }, [athleteId]);

  useEffect(() => {
    let active = true;
    if (!athleteId) { setTrendPoints([]); setTrendLoading(false); return; }
    setTrendLoading(true);
    getReadinessTrend(athleteId, selectedExercise, windowDays)
      .then((points) => { if (active) setTrendPoints(points); })
      .catch((e) => console.warn('[APeX] Failed to load readiness trend:', e))
      .finally(() => { if (active) setTrendLoading(false); });
    return () => { active = false; };
  }, [athleteId, selectedExercise, windowDays]);

  // History list resets to page 0 whenever the exercise filter changes —
  // deliberately NOT a dependency on windowDays, the list isn't scoped to
  // the chart's time window (see this file's header comment).
  useEffect(() => {
    let active = true;
    if (!athleteId) { setHistoryRows([]); setHistoryHasMore(false); setHistoryLoading(false); return; }
    setHistoryLoading(true);
    getSessionHistoryPage(athleteId, selectedExercise, 0, PAGE_SIZE)
      .then((rows) => {
        if (!active) return;
        setHistoryRows(rows);
        setHistoryHasMore(rows.length === PAGE_SIZE);
      })
      .catch((e) => console.warn('[APeX] Failed to load session history:', e))
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [athleteId, selectedExercise]);

  const loadMoreHistory = useCallback(async () => {
    // Ref guard (checked + set synchronously, before any await) rather than
    // just the historyLoadingMore state flag — state updates are batched/
    // async, so a burst of onScroll events firing before the first re-render
    // could otherwise all pass a state-only check and kick off duplicate pages.
    if (!athleteId || loadingMoreRef.current || !historyHasMore) return;
    loadingMoreRef.current = true;
    setHistoryLoadingMore(true);
    try {
      const rows = await getSessionHistoryPage(athleteId, selectedExercise, historyRows.length, PAGE_SIZE);
      setHistoryRows((prev) => [...prev, ...rows]);
      setHistoryHasMore(rows.length === PAGE_SIZE);
    } catch (e) {
      console.warn('[APeX] Failed to load more session history:', e);
    } finally {
      loadingMoreRef.current = false;
      setHistoryLoadingMore(false);
    }
  }, [athleteId, selectedExercise, historyRows.length, historyHasMore]);

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    if (distanceFromBottom < SCROLL_LOAD_THRESHOLD) void loadMoreHistory();
  }

  if (!athleteId) return null;

  const trendSeries = trendPoints.map((p) => p.readiness);

  return (
    <View style={styles.screen}>
      <DashHeader title="READINESS" backLabel={backLabel} onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        onScroll={handleScroll}
        scrollEventThrottle={100}
        showsVerticalScrollIndicator={false}
      >
        {exerciseOptions.length > 0 && (
          <ExercisePicker
            options={exerciseOptions}
            value={selectedExercise}
            onChange={setSelectedExercise}
            allLabel="Overall"
          />
        )}

        <View style={styles.windowRow}>
          {WINDOW_OPTIONS.map((w) => (
            <Pressable
              key={w.days}
              onPress={() => setWindowDays(w.days)}
              style={[styles.windowItem, windowDays === w.days && styles.windowItemOn]}
            >
              <Text style={[styles.windowText, windowDays === w.days && styles.windowTextOn]}>{w.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.card}>
          {trendLoading ? (
            <ActivityIndicator color={accentColor} style={styles.loading} />
          ) : (
            <LineTrend
              data={trendSeries}
              color={accentColor}
              min={0}
              max={100}
              height={160}
              startLabel={`${trendSeries.length} sessions`}
              endLabel="latest"
            />
          )}
        </View>

        <Text style={styles.sectionKicker}>HISTORY</Text>
        {historyLoading ? (
          <ActivityIndicator color={accentColor} style={styles.loading} />
        ) : historyRows.length === 0 ? (
          <Text style={styles.empty}>No sessions saved yet for this selection.</Text>
        ) : (
          <>
            {historyRows.map((entry) => (
              <HistoryRow
                key={entry.id}
                entry={entry}
                onPress={() => navigation.navigate('HistoryDetail', { id: entry.id })}
              />
            ))}
            {historyLoadingMore && <ActivityIndicator color={accentColor} style={styles.loading} />}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function HistoryRow({ entry, onPress }: { entry: SessionHistoryEntry; onPress: () => void }) {
  const hasReadiness = entry.readinessScore != null;
  const color = readinessColor(entry.readinessScore);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={[styles.readiness, { borderColor: color }]}>
        <Text style={[styles.readinessNum, { color }]}>{hasReadiness ? entry.readinessScore : '—'}</Text>
      </View>
      <View style={styles.rowMid}>
        <Text style={styles.rowTitle} numberOfLines={1}>{exerciseLabel(entry.exerciseType)}</Text>
        <Text style={styles.rowMeta}>
          {formatSessionDateTime(entry.recordedAt)} · {formatDuration(entry.durationSec)}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  loading: { marginVertical: spacing.lg },
  empty: { color: colors.muted, fontSize: 13, lineHeight: 19 },

  windowRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  windowItem: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8 },
  windowItemOn: { backgroundColor: colors.surfaceHigh },
  windowText: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  windowTextOn: { color: colors.text },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },

  sectionKicker: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2.5 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  pressed: { opacity: 0.6 },
  readiness: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
  readinessNum: { fontSize: 15, fontWeight: '900' },
  rowMid: { flex: 1, marginLeft: spacing.md },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  rowMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  chevron: { color: colors.muted, fontSize: 22, fontWeight: '400' },
});
