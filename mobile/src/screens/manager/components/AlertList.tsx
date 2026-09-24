import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../../components/ui/Text';
import { NotificationViewModel as MockAlert } from '../../../api/types';
import { colors, spacing } from '../../../theme';

const SEVERITY_CONFIG = {
  info:     { color: '#6B7F96', bg: 'rgba(107,127,150,0.1)',  borderColor: 'rgba(107,127,150,0.3)', icon: '●' },
  warning:  { color: '#F5A623', bg: 'rgba(245,166,35,0.08)',  borderColor: 'rgba(245,166,35,0.3)',  icon: '▲' },
  critical: { color: '#FF3B30', bg: 'rgba(255,59,48,0.08)',   borderColor: 'rgba(255,59,48,0.3)',   icon: '!' },
};

interface Props {
  alerts: MockAlert[];
}

export default function AlertList({ alerts }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>NOTIFICATIONS</Text>
      <View style={styles.list}>
        {alerts.map((alert) => {
          const cfg = SEVERITY_CONFIG[alert.severity];
          return (
            <View
              key={alert.id}
              style={[styles.row, { backgroundColor: cfg.bg, borderColor: cfg.borderColor }]}
            >
              <Text style={[styles.icon, { color: cfg.color }]}>{cfg.icon}</Text>
              <Text style={styles.message} numberOfLines={2}>{alert.message}</Text>
              {alert.timestamp && (
                <Text style={styles.time}>{alert.timestamp}</Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  title: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  list: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  icon: {
    fontSize: 11,
    fontWeight: '900',
    width: 12,
    textAlign: 'center',
  },
  message: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 17,
  },
  time: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '600',
  },
});
