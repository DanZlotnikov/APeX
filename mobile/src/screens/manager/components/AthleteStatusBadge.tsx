import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../../components/ui/Text';
import { AthleteStatus } from '../../../api/types';

const STATUS_CONFIG: Record<AthleteStatus, { label: string; color: string; bg: string }> = {
  green:  { label: 'READY',  color: '#00D4BC', bg: 'rgba(0,212,188,0.12)' },
  yellow: { label: 'WATCH',  color: '#F5A623', bg: 'rgba(245,166,35,0.12)' },
  red:    { label: 'REVIEW', color: '#FF3B30', bg: 'rgba(255,59,48,0.12)' },
};

interface Props {
  status: AthleteStatus;
  compact?: boolean;
}

export default function AthleteStatusBadge({ status, compact }: Props) {
  const cfg = STATUS_CONFIG[status];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg, borderColor: cfg.color }, compact && styles.compact]}>
      <View style={[styles.dot, { backgroundColor: cfg.color }]} />
      {!compact && <Text style={[styles.label, { color: cfg.color }]}>{cfg.label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  compact: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
});
