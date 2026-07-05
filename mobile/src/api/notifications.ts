import { supabase } from './supabase';
import { NotificationViewModel } from './types';

export async function getNotifications(teamId: string): Promise<NotificationViewModel[]> {
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(30);

  return (data ?? []).map((n) => ({
    id:         n.id,
    message:    n.message,
    severity:   n.severity as 'info' | 'warning' | 'critical',
    athleteId:  n.athlete_id,
    timestamp:  formatRelative(n.created_at),
  }));
}

export async function getReadIds(managerId: string, teamId: string): Promise<Set<string>> {
  // Get all notification IDs for this team first
  const { data: notifs } = await supabase
    .from('notifications')
    .select('id')
    .eq('team_id', teamId);

  if (!notifs?.length) return new Set();
  const notifIds = notifs.map((n) => n.id);

  const { data: reads } = await supabase
    .from('notification_reads')
    .select('notification_id')
    .eq('manager_id', managerId)
    .in('notification_id', notifIds);

  return new Set((reads ?? []).map((r) => r.notification_id));
}

export async function markRead(managerId: string, notificationId: string): Promise<void> {
  await supabase.from('notification_reads').upsert({
    manager_id:      managerId,
    notification_id: notificationId,
  });
}

export async function clearAll(managerId: string, teamId: string): Promise<void> {
  const { data: notifs } = await supabase
    .from('notifications')
    .select('id')
    .eq('team_id', teamId);

  if (!notifs?.length) return;

  await supabase.from('notification_reads').upsert(
    notifs.map((n) => ({ manager_id: managerId, notification_id: n.id }))
  );
}

export async function createNotification(
  teamId: string,
  athleteId: string | null,
  message: string,
  severity: 'info' | 'warning' | 'critical',
  sessionId?: string,
): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    team_id:    teamId,
    athlete_id: athleteId,
    session_id: sessionId ?? null,
    message,
    severity,
  });
  if (error) console.warn('[APeX] createNotification failed:', error.message, error.code);
}

function formatRelative(iso: string): string {
  const ms   = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
