import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as notifApi from '../../api/notifications';
import { supabase } from '../../api/supabase';
import { NotificationViewModel } from '../../api/types';
import * as teamsApi from '../../api/teams';
import { colors, spacing } from '../../theme';

const SEVERITY_CONFIG = {
  info:     { color: '#6B7F96', bg: 'rgba(107,127,150,0.1)',  borderColor: 'rgba(107,127,150,0.3)', icon: '●' },
  warning:  { color: '#F5A623', bg: 'rgba(245,166,35,0.08)',  borderColor: 'rgba(245,166,35,0.3)',  icon: '▲' },
  critical: { color: '#FF3B30', bg: 'rgba(255,59,48,0.08)',   borderColor: 'rgba(255,59,48,0.3)',   icon: '!' },
};

interface Props {
  screen: 'manager-dashboard' | 'manager-athlete' | 'manager-settings';
  onBack: () => void;
  teamId: string;
  managerId: string;
  onNotifNavigate: (athleteId: string | null) => void;
  onSettings: () => void;
  onLogout: () => void;
}

export default function ManagerTopBar({
  screen, onBack, teamId, managerId, onNotifNavigate, onSettings, onLogout,
}: Props) {
  const insets = useSafeAreaInsets();
  const [notifOpen,  setNotifOpen]  = useState(false);
  const [teamName,   setTeamName]   = useState('');
  const [notifs,     setNotifs]     = useState<NotificationViewModel[]>([]);
  const [readIds,    setReadIds]    = useState<Set<string>>(new Set());

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const unreadCount = notifs.filter((n) => !readIds.has(n.id)).length;
  const hasCritical = notifs.some((n) => !readIds.has(n.id) && n.severity === 'critical');
  const onDashboard = screen === 'manager-dashboard';

  const loadNotifs = useCallback(async () => {
    try {
      const [fetchedNotifs, fetchedReads] = await Promise.all([
        notifApi.getNotifications(teamId),
        notifApi.getReadIds(managerId, teamId),
      ]);
      setNotifs(fetchedNotifs);
      setReadIds(fetchedReads);
    } catch (e) {
      console.warn('Failed to load notifications', e);
    }
  }, [teamId, managerId]);

  useEffect(() => {
    void teamsApi.getTeamName(teamId).then(setTeamName).catch(() => {});
    void loadNotifs();

    // Realtime: no server-side filter (requires special Supabase publication setup);
    // filter client-side instead so it works on any plan.
    // Topic includes managerId, not just teamId: supabase.channel(topic) reuses
    // an existing channel object for a matching topic string rather than
    // creating a new one (confirmed the hard way elsewhere in this app — see
    // videoJobs.ts/VideoJobsContext.tsx) — a team-only topic would collide
    // across every manager viewing the same team simultaneously, or across a
    // fast unmount/remount of this same component racing removeChannel's
    // async teardown.
    const channel = supabase
      .channel(`notif:${teamId}:${managerId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const n = payload.new as any;
          if (n.team_id !== teamId) return;
          setNotifs((prev) => {
            if (prev.some((x) => x.id === n.id)) return prev; // dedup
            const vm: NotificationViewModel = {
              id:        n.id,
              message:   n.message,
              severity:  n.severity,
              athleteId: n.athlete_id,
              timestamp: 'Just now',
            };
            return [vm, ...prev];
          });
        },
      )
      .subscribe();

    // Polling fallback — catches notifications if Realtime isn't enabled in the publication
    const poll = setInterval(() => { void loadNotifs(); }, 3_000);

    return () => {
      void supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [loadNotifs, teamId]);

  async function handleNotifPress(notif: NotificationViewModel) {
    setNotifOpen(false);
    // Optimistic update
    setReadIds((prev) => new Set([...prev, notif.id]));
    void notifApi.markRead(managerId, notif.id);
    if (notif.athleteId) {
      onNotifNavigate(notif.athleteId);
    }
  }

  async function handleClearAll() {
    const allIds = new Set(notifs.map((n) => n.id));
    setReadIds(allIds);
    void notifApi.clearAll(managerId, teamId);
  }

  return (
    <View style={[styles.wrapper, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        {onDashboard ? (
          <View style={styles.barLeft}>
            <Text style={styles.teamName}>{teamName || 'Loading…'}</Text>
            <Text style={styles.date}>{today}</Text>
          </View>
        ) : (
          <Pressable onPress={onBack} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
            <Text style={styles.backArrow}>←</Text>
            <Text style={styles.backLabel}>Dashboard</Text>
          </Pressable>
        )}

        <View style={styles.barRight}>
          <Pressable onPress={onSettings} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
            <GearIcon color={colors.muted} size={17} />
          </Pressable>

          <Pressable onPress={() => setNotifOpen(true)} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
            <BellIcon color={colors.muted} size={17} />
            {unreadCount > 0 && (
              <View style={[styles.badge, hasCritical ? styles.badgeCritical : styles.badgeInfo]}>
                <Text style={styles.badgeText}>{unreadCount}</Text>
              </View>
            )}
          </Pressable>

          <Pressable onPress={onLogout} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
            <PowerIcon color={colors.muted} size={17} />
          </Pressable>
        </View>
      </View>

      <NotificationsDropdown
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        insetTop={insets.top}
        notifs={notifs}
        readIds={readIds}
        onNotifPress={handleNotifPress}
        onClearAll={handleClearAll}
      />
    </View>
  );
}

// ── Notifications dropdown ─────────────────────────────────────────────────────

interface DropdownProps {
  open: boolean;
  onClose: () => void;
  insetTop: number;
  notifs: NotificationViewModel[];
  readIds: Set<string>;
  onNotifPress: (n: NotificationViewModel) => void;
  onClearAll: () => void;
}

function NotificationsDropdown({ open, onClose, insetTop, notifs, readIds, onNotifPress, onClearAll }: DropdownProps) {
  const translateY = useRef(new Animated.Value(-20)).current;
  const opacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(opacity,    { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else {
      translateY.setValue(-20);
      opacity.setValue(0);
    }
  }, [open]);

  if (!open) return null;

  const BAR_HEIGHT = insetTop + 64;
  const allRead    = notifs.length > 0 && notifs.every((n) => readIds.has(n.id));

  return (
    <Modal transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />

      <Animated.View style={[styles.dropdown, { top: BAR_HEIGHT, transform: [{ translateY }], opacity }]}>
        <View style={styles.dropdownHeader}>
          <Text style={styles.dropdownTitle}>NOTIFICATIONS</Text>
          <View style={styles.dropdownHeaderActions}>
            <TouchableOpacity
              onPress={onClearAll}
              disabled={allRead}
              style={[styles.dropdownAction, allRead && styles.dropdownActionDisabled]}
              hitSlop={8}
            >
              <Text style={[styles.closeBtn, allRead && styles.dropdownActionIconDisabled]}>✓✓</Text>
            </TouchableOpacity>
            <View style={styles.dropdownActionDivider} />
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView style={styles.dropdownScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.alertList}>
            {notifs.length === 0 ? (
              <Text style={styles.emptyText}>No notifications</Text>
            ) : notifs.map((n) => {
              const isRead  = readIds.has(n.id);
              const cfg     = SEVERITY_CONFIG[n.severity];
              const hasLink = !!n.athleteId;

              return (
                <Pressable
                  key={n.id}
                  onPress={() => onNotifPress(n)}
                  style={({ pressed }) => [
                    styles.alertRow,
                    {
                      backgroundColor: isRead ? 'rgba(28,46,64,0.3)' : cfg.bg,
                      borderColor:     isRead ? colors.border          : cfg.borderColor,
                      opacity:         pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.alertIcon, { color: isRead ? colors.muted : cfg.color }]}>
                    {isRead ? '✓' : cfg.icon}
                  </Text>
                  <View style={styles.alertBody}>
                    <Text style={[styles.alertMessage, isRead && styles.alertMessageRead]} numberOfLines={2}>
                      {n.message}
                    </Text>
                    {hasLink && !isRead && (
                      <Text style={styles.alertLink}>Tap to view athlete →</Text>
                    )}
                  </View>
                  {n.timestamp && (
                    <Text style={[styles.alertTime, isRead && styles.alertTimeRead]}>
                      {n.timestamp}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

function GearIcon({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function BellIcon({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M13.73 21a2 2 0 0 1-3.46 0"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function PowerIcon({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M18.36 6.64a9 9 0 1 1-12.73 0"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 2v10"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  wrapper: { backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border },
  bar: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  barLeft:   { flex: 1 },
  teamName:  { color: colors.text, fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  date:      { color: colors.muted, fontSize: 11, fontWeight: '600', marginTop: 2 },
  backBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  backArrow: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  backLabel: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  barRight:  { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  iconBtn: {
    width: 38, height: 38, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },

  badge: {
    position: 'absolute', top: -4, right: -4,
    width: 16, height: 16, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeCritical: { backgroundColor: '#FF3B30' },
  badgeInfo:     { backgroundColor: '#F5A623' },
  badgeText:     { color: '#fff', fontSize: 9, fontWeight: '900' },

  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  dropdown: {
    position: 'absolute', right: spacing.lg,
    width: 320, maxHeight: 420,
    backgroundColor: colors.surfaceHigh,
    borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 }, elevation: 16,
  },

  dropdownHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  dropdownTitle:              { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 2 },
  dropdownHeaderActions:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dropdownAction:             { padding: 3 },
  dropdownActionDisabled:     { opacity: 0.3 },
  dropdownActionIconDisabled: { opacity: 0.4 },
  dropdownActionDivider:      { width: 1, height: 14, backgroundColor: colors.border },
  closeBtn:                   { color: colors.muted, fontSize: 13, fontWeight: '700' },

  dropdownScroll: { maxHeight: 360 },
  alertList:      { padding: spacing.sm, gap: 6 },

  alertRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 9,
    borderRadius: 9, borderWidth: 1,
  },
  alertIcon:        { fontSize: 11, fontWeight: '900', width: 14, textAlign: 'center' },
  alertBody:        { flex: 1, gap: 2 },
  alertMessage:     { color: colors.text, fontSize: 12, fontWeight: '500', lineHeight: 16 },
  alertMessageRead: { color: colors.muted },
  alertLink:        { color: colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  alertTime:        { color: colors.muted, fontSize: 10, fontWeight: '600' },
  alertTimeRead:    { opacity: 0.5 },

  emptyText: { color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.md },
});
