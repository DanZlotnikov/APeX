/** "Jan 5 · 3:42 PM" — used by History-style session rows (HistoryScreen,
 * ReadinessScreen). */
export function formatSessionDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function ordinalSuffix(day: number): string {
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/** "Aug 3rd · 3:42 PM" — same as formatSessionDateTime but with an ordinal
 * day suffix, for the session detail header title. */
export function formatSessionDateTimeOrdinal(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleDateString(undefined, { month: 'short' });
  const day = d.getDate();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${month} ${day}${ordinalSuffix(day)} · ${time}`;
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

/** "2.3s" — one decimal place, for per-rep/rest durations (RepBreakdownModal)
 * where they're short enough that whole-second rounding hides real variation
 * between reps. null renders as "—". */
export function formatDurationPrecise(sec: number | null): string {
  if (sec == null) return '—';
  return `${Math.max(0, sec).toFixed(1)}s`;
}
