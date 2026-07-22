# Manager Module Audit — Legacy vs. Current Pipeline

Research only. No code was changed while producing this document.

## Context

The manager module (`mobile/src/screens/manager/**`, `mobile/src/api/athletes.ts`,
`mobile/src/api/exercises.ts`) was built against the **original on-device
pipeline**: MediaPipe pose landmarks processed live on the phone
(`mobile/src/utils/exerciseAnalyzer.ts`), 3 hardcoded exercises
(squat/jump/pullup), and a manager-owned "required exercises" config
(`team_exercises` / `athlete_exercise_assignments`).

Since then the app moved to a **server-side GEM-based pipeline**
(`backend/GENMO`, `video_jobs` table, migration 009 onward) that supports 6
exercises (squat, deadlift, vertical_jump, pull_up, push_up, ab_crunch) and
introduced a separate, athlete-owned **routine system**
(`athlete_routines`, migration 014, `mobile/src/api/routine.ts`).

The manager module was never updated to match. Below is every concrete
discrepancy found, ordered roughly by severity/impact.

---

## 1. Two disconnected exercise-configuration systems

There are now **two separate, non-communicating** "which exercises matter"
systems:

| | Manager system (old) | Routine system (new) |
|---|---|---|
| Tables | `team_exercises`, `athlete_exercise_assignments` | `athlete_routines` |
| Exercises covered | squat, jump, pullup only | all 6 pipeline exercises |
| Who edits it | manager (`ExercisesScreen.tsx`) | athlete only (individual/teamless athletes; team athletes are read-only — see migration 014 RLS) |
| Who reads it | manager dashboard, athlete-monitoring table | `OverviewScreen`'s "Today's Tasks", `RoutineScreen` |
| Manager visibility | full | **none** — migration 014's own comment says *"No manager-side editor exists yet — this just keeps the read side consistent/future-proof."* RLS lets a manager `SELECT` a team athlete's routine, but no screen ever calls it. |

A manager configures "required tests" in one system; an athlete (if
individual) configures their actual daily routine in a completely different
one. For team athletes, neither the manager nor the athlete can see the
other's exercise expectations reconciled anywhere.

**Files:** `mobile/src/api/exercises.ts`, `mobile/src/screens/manager/ExercisesScreen.tsx`, `mobile/src/api/routine.ts`, `supabase/migrations/014_athlete_routines.sql`

---

## 2. Manager is hardcoded to 3 of the pipeline's 6 exercises — and silently blind to the other 3

`ExerciseKey` (`mobile/src/utils/exerciseMetrics.ts:14`) is:

```ts
export type ExerciseKey = 'squat' | 'jump' | 'pullup';
```

This type flows through the entire manager stack: `TeamExerciseConfig`,
`AthleteViewModel.perExerciseReadiness`, `ExerciseColumn`,
`DbSession.exercise_type` in `mobile/src/api/types.ts`. But
`sessions.exercise_type`'s DB CHECK constraint (migration 009) allows
`'squat','jump','pullup','deadlift','push_up','ab_crunch'` — i.e. the type
declaration is simply wrong/stale for 3 of the 6 values the column can
actually hold.

Concretely, in `buildViewModel` (`mobile/src/api/athletes.ts:149`):

```ts
const activeExercises = EXERCISE_KEYS.filter((k) => assignedKeys.has(k));
```

`EXERCISE_KEYS` is `['squat','jump','pullup']` — a `deadlift`/`push_up`/
`ab_crunch` session is never in `activeExercises`, so it:

- never appears as a column in `AthleteMonitoringTable`
- never contributes to `readiness`, `missingTests`, or `compliancePct`
- never affects `perExerciseReadiness` / pass-fail status

**Confusing failure scenario:** `lastTestDate` (`athletes.ts:188`,
`sessions[0]`) is computed from *all* sessions regardless of exercise type,
so a manager sees "Last test: Today" for an athlete who only did push-ups —
but every exercise column and the readiness score show `—`/no data, making
it look like the athlete did nothing, when they did.

**Files:** `mobile/src/utils/exerciseMetrics.ts`, `mobile/src/api/athletes.ts`, `mobile/src/api/types.ts`

---

## 3. Manager readiness/compliance math assumes one session per exercise per day — no longer true

`buildViewModel` collapses sessions to "latest per exercise type":

```ts
const latestByExercise = new Map<ExerciseKey, any>();
for (const s of sessions) {
  const key = s.exercise_type as ExerciseKey;
  if (!latestByExercise.has(key)) latestByExercise.set(key, s);
}
```

and then checks `session.rep_count >= cfg.minReps` against only that one
row. This was correct when `sessions` enforced one row per
(athlete, exercise, day) — but **migration 017
(`017_sessions_no_same_day_merge.sql`) explicitly reverted that**: "every
saved video is its own permanent, separate session, full stop." An athlete
can now have 3 separate `pullup` sessions today.

The athlete-facing side was fixed for this (`mobile/src/utils/routineProgress.ts`,
comment: *"Every attempt today is its own separate session row (migration
017) — sum across ALL of them, not just the first/only match"*) — the
manager side (`athletes.ts`) was **not**. Result: a manager can see a
"missing test" / failed-threshold status for an athlete who actually passed
on an earlier attempt today, because only the chronologically-latest attempt
is consulted, and vice versa (an early good attempt can mask a later bad
one).

**Files:** `mobile/src/api/athletes.ts` (`buildViewModel`), contrast with `mobile/src/utils/routineProgress.ts`, `supabase/migrations/017_sessions_no_same_day_merge.sql`

---

## 4. Manager has zero visibility into the new pipeline's actual output

The athlete side now has, per completed exercise: the processed two-panel
video (`result_video_path`), a full biomechanics report
(`biomechanics_json`: L/R balance %, range-of-motion %, per-joint detail —
see `HistoryDetailScreen.tsx` / `BiomechanicsReport`). None of this reaches
the manager module: `AthleteDetailPreview.tsx` shows only a readiness
number, a 30-day trend line, last-test date, and the injury toggle — no
video, no balance/ROM breakdown, nothing from `biomechanics_json`.

A manager reviewing a flagged athlete cannot watch what they actually did or
see which joint/side was the problem — only a bare pass/fail number derived
from the legacy bridge (see §6).

**Files:** `mobile/src/screens/manager/AthleteDetailPreview.tsx` (no `result_video_path`/`biomechanics_json` reads anywhere in `mobile/src/screens/manager/**`)

---

## 5. Dead on-device recording path still present, exported, and importable

`mobile/App.tsx` only wires `CameraScreen` → the new upload/`video_jobs`
flow. `AnalysisScreen.tsx` and `ResultScreen.tsx` (the old on-device
capture → MediaPipe analysis → save flow) are **not reachable from any
navigation path** — the only remaining references to them in the live code
are stale comments (`App.tsx:149`, `App.tsx:184`).

But the code they depend on is still live and exported:

- `mobile/src/api/sessions.ts:createSession()` — writes a `sessions` row with
  `analysis_json` (not `biomechanics_json`), still imports and calls
  `mobile/src/utils/exerciseAnalyzer.ts` (the retired MediaPipe-based
  `computeAssessment`) and `mobile/src/api/notifications.ts:createNotification()`.
- `getSessionHistory()` in the same file explicitly filters these out for the
  athlete's own History tab: `.not('biomechanics_json', 'is', null)`.
- **`mobile/src/api/athletes.ts` has no such filter** — if `createSession`
  were ever accidentally re-wired (or called from a leftover/experimental
  screen), it would silently create sessions the manager dashboard ingests
  (readiness, compliance, monitoring table) but that never appear in the
  athlete's own history — an invisible-to-athlete, visible-to-manager data
  split.

This is currently unreachable, so not an active bug, but it's dead weight
that both increases bundle size and is a landmine for the next person who
touches recording/analysis code.

**Files:** `mobile/src/screens/AnalysisScreen.tsx`, `mobile/src/screens/ResultScreen.tsx`, `mobile/src/utils/exerciseAnalyzer.ts`, `mobile/src/api/sessions.ts` (`createSession`), `mobile/src/api/notifications.ts` (`createNotification`)

---

## 6. The manager's threshold system depends on a manually-synced Python reimplementation of retired TypeScript

`backend/GENMO/scripts/biomechanics/legacy_metrics.py` exists *solely* to
keep the manager module's threshold config (`exerciseMetrics.ts`'s
depth/symmetry/fatigue/landing/flightTime formulas) working against the new
GEM 3D-joint pipeline, by hand-reproducing the exact formulas from the now-
deleted-from-the-runtime `exerciseAnalyzer.ts`. Its own docstring is explicit
about the risk: *"optimizes for staying byte-faithful to a formula it
doesn't own... a future balance.py threshold tweak silently drifts the
manager module's numbers."*

Consequences:
- It only covers squat/vertical_jump/pull_up — *"push_up, deadlift, and
  ab_crunch never existed in the old analyzer, so there's nothing to bridge
  for them yet"* — which is the root cause of §2's 3-of-6 blindness; it's not
  fixable by widening `ExerciseKey` alone, the backend would need genuinely
  new metric definitions for the other 3 exercises.
- Two independent implementations (dead TS, live Python) of the same
  scoring formulas exist with no shared source of truth and no test
  asserting they agree — verified only by "byte-faithful" intent in a
  comment, not by code.

**Files:** `backend/GENMO/scripts/biomechanics/legacy_metrics.py`, `mobile/src/utils/exerciseMetrics.ts`, `mobile/src/utils/exerciseAnalyzer.ts` (retired)

---

## 7. "Team Readiness ... vs last week" is a permanently fake metric

`ManagerDashboard.tsx`'s `computeTeamStats()`:

```ts
return {
  ...
  readinessTrend:  0,
  ...
};
```

`readinessTrend` is hardcoded to `0` and never computed from anything.
`TeamReadinessCard.tsx` renders it as a live trend badge: `+0% vs last
week`, always, for every team, forever. This reads as a real (flat) trend to
a manager, not as "not implemented."

**Files:** `mobile/src/screens/manager/ManagerDashboard.tsx:42`, `mobile/src/screens/manager/components/TeamReadinessCard.tsx`

---

## 8. Notification severity system: two of its three states are unreachable

`notifications.severity` supports `'info' | 'warning' | 'critical'`, and
`ManagerTopBar.tsx` has real UI for all three (distinct colors/icons, plus a
`hasCritical` red badge-highlight). But **every** `save_video_job` SQL
function, across every migration revision (009 through 017), inserts
notifications with severity hardcoded to `'info'`. There is currently no
code path anywhere that produces `'warning'` or `'critical'` — the icon/color
logic for those and the critical-badge highlight are unreachable.

(This looks like it was meant for "athlete failed thresholds" /
"athlete marked injured" style alerts that were never wired up to actually
insert at those severities.)

**Files:** `mobile/src/screens/manager/ManagerTopBar.tsx` (`SEVERITY_CONFIG`, `hasCritical`), every `save_video_job` definition in `supabase/migrations/`

---

## 9. Orphaned/unused manager UI components

- `mobile/src/screens/manager/components/AlertList.tsx` — not imported
  anywhere. `ManagerTopBar.tsx` reimplements the same notification-row UI
  inline (`NotificationsDropdown`) instead of using this component.
- `mobile/src/screens/manager/components/AthleteStatusBadge.tsx` — not
  imported anywhere; `AthleteMonitoringTable.tsx` renders its own status
  text (`View`/`Review`) instead.

Both appear to predate `ManagerTopBar`'s dropdown / the monitoring table's
current design and were left behind when those were rebuilt inline.

---

## 10. Dead `team_settings.readiness_threshold`

`DbTeamSettings` (`mobile/src/api/types.ts:50`) declares
`readiness_threshold`, and `team_settings` rows are created for every new
team (`create_manager_team`). No manager screen reads or writes this value —
`ManagerSettings.tsx` has no such field, and no other file queries
`team_settings` at all. It's a fully vestigial table/column at the
application layer (schema-only).

---

## 11. Migration directory has a hand-merged duplicate file

`supabase/migrations/combined_for_paste.sql` sits alongside the numbered
migrations and duplicates large chunks of their content (e.g. the
`notifications` table definition, multiple `save_video_job` versions) in one
merged file, presumably for pasting into the Supabase SQL editor in one go.
It has no automatic relationship to the numbered files — nothing keeps it in
sync — so it's a drift risk anytime a new migration is added but this file
isn't regenerated. Not manager-specific, but it lives in the same
directory the manager-relevant migrations (003, 005, 009, 014) are in and is
easy to mistake for authoritative.

---

## Summary table

| # | Issue | Severity | Type |
|---|---|---|---|
| 1 | Two disconnected exercise-config systems (manager vs. routine) | High | Architecture gap |
| 2 | Manager blind to 3 of 6 pipeline exercises | High | Data visibility bug |
| 3 | Readiness/compliance uses only latest same-day session (stale post-migration-017 assumption) | High | Correctness bug |
| 4 | No manager visibility into video/biomechanics detail | Medium | Feature gap |
| 5 | Dead on-device recording path still live in the bundle | Medium | Dead code / landmine |
| 6 | Threshold system depends on a hand-synced Python/TS formula duplicate, capped at 3 exercises | Medium | Maintenance risk |
| 7 | Fake "vs last week" readiness trend (always 0) | Medium | Misleading UI |
| 8 | Notification severity: warning/critical unreachable | Low | Dead code path |
| 9 | Orphaned components (`AlertList`, `AthleteStatusBadge`) | Low | Dead code |
| 10 | Dead `team_settings.readiness_threshold` | Low | Dead schema |
| 11 | `combined_for_paste.sql` drift risk | Low | Housekeeping |

No code was modified. This is a research document only.
