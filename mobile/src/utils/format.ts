/** "Jan 5 · 3:42 PM" — used by History-style session rows (HistoryScreen,
 * ReadinessScreen). */
export function formatSessionDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "1:42" (m:ss) — null (no duration captured, e.g. a session saved before
 * migration 024 added the column) renders as "—". */
export function formatDuration(sec: number | null): string {
  if (sec == null) return '—';
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
