import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/ui/Text';
import { useVideoJobsContext } from '../../state/VideoJobsContext';
import { colors, spacing } from '../../theme';
import HistoryDetailScreen from './HistoryDetailScreen';
import HistoryScreen from './HistoryScreen';
import ProcessingScreen from './ProcessingScreen';

const Stack = createNativeStackNavigator();

function HistoryStack({ userId }: { userId?: string }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="HistoryList">
        {() => <HistoryScreen userId={userId} />}
      </Stack.Screen>
      <Stack.Screen name="HistoryDetail">
        {() => <HistoryDetailScreen userId={userId} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

export type PerformanceSub = 'history' | 'processing';

interface Props {
  userId?: string;
  teamId?: string;
  sub: PerformanceSub;
  onSubChange: (sub: PerformanceSub) => void;
}

// Renamed from the old standalone "History" tab (HANDOFF_video_pipeline.md
// section 4 item 4) — now a single tab hosting two sub-views: the
// new-pipeline session History (HistoryScreen/HistoryDetailScreen) and the
// live Processing queue. `sub` is lifted to DashboardScreen so the "N videos
// processing" banner can jump straight to the Processing sub-view, not just
// the Performance tab.
export default function PerformanceScreen({ userId, teamId, sub, onSubChange }: Props) {
  const { processingCount } = useVideoJobsContext();

  return (
    <View style={styles.root}>
      <View style={styles.switcher}>
        <Pressable
          onPress={() => onSubChange('history')}
          style={[styles.switchItem, sub === 'history' && styles.switchItemOn]}
        >
          <Text style={[styles.switchText, sub === 'history' && styles.switchTextOn]}>HISTORY</Text>
        </Pressable>
        <Pressable
          onPress={() => onSubChange('processing')}
          style={[styles.switchItem, sub === 'processing' && styles.switchItemOn]}
        >
          <Text style={[styles.switchText, sub === 'processing' && styles.switchTextOn]}>
            PROCESSING{processingCount > 0 ? ` (${processingCount})` : ''}
          </Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        {sub === 'history' ? <HistoryStack userId={userId} /> : <ProcessingScreen userId={userId} teamId={teamId} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },

  switcher: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  switchItem: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8 },
  switchItemOn: { backgroundColor: colors.surfaceHigh },
  switchText: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  switchTextOn: { color: colors.text },
});
