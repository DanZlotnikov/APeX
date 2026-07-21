# Handoff: async server-side video pipeline

**Written by:** the backend Claude (works only in `backend/`).
**For:** the application Claude (works only in `mobile/`, and owns all `supabase/` schema changes).

## Ownership boundaries — read this first

- **`backend/`** (GENMO pose pipeline, exercise detection, biomechanics, the FastAPI/Supabase-worker server) is owned by the backend Claude. Nothing here needs mobile-side code changes to work.
- **`mobile/`** (the Expo app) is owned by the application Claude. The backend Claude has not touched and will not touch this directory.
- **`supabase/`** (SQL migrations, Edge Functions, Storage bucket config, RLS policies) is owned by the application Claude. The backend Claude has **not** created any migration files or touched the Supabase project — everything under "Required Supabase changes" below is a specification the backend code depends on, not something already implemented. The application Claude must create the actual migration(s) and Edge Function(s).

The backend code in this handoff (`backend/server/supabase_client.py`, `backend/server/supabase_worker.py`) is written *against* the schema specified below and will not run until that schema exists and the right environment variables are set.

---

## 🔧 Your task checklist (application Claude — start here)

Everything below is work **you** need to build, in `mobile/` and `supabase/`. Nothing in this checklist requires touching `backend/`. Each item links to its full spec further down.

- [ ] **1. Supabase migration** — `video_jobs` table + RLS, `exercise-videos` storage bucket + RLS, the `cancel_video_job`/`discard_video_job`/`save_video_job` RPCs, `profiles.expo_push_token` column, `notify-video-ready` Edge Function + Database Webhook. Schema spec: **section 3**. Build brief: **section 4, item 1**.
- [ ] **2. Recording → upload flow**, with a review/confirm step before upload. **Section 4, item 2**.
- [ ] **3. "N videos processing" banner** via Supabase Realtime. **Section 4, item 3**.
- [ ] **4. Rename "History" → "Performance"**, add the History / Processing tabs. **Section 4, item 4**.
- [ ] **5. Processing-tab card for queued/processing jobs** (raw video, duration, recorded-at, Remove button). **Section 4, item 5**.
- [ ] **6. Processing-tab card for completed jobs** (two-panel video, analysis display, Save / Discard). **Section 4, item 6**.
- [ ] **7. Failed-job state.** **Section 4, item 7**.
- [ ] **8. "Today's Tasks" redesign** around async completion instead of instant feedback. **Section 4, item 8**.
- [ ] **9. Push notifications** — token registration + tap-to-deep-link. **Section 4, item 9**.

Sections 1-2 below are **background only** — nothing to build there, they explain what the backend already does so items 1-9 make sense. Sections 3-4 are the actual specs and task brief.

### Decisions made after the first draft of this doc (v2)

The first draft of this handoff under-specified three things the application Claude correctly pushed back on. Resolved:

1. **The manager/coach module** (Exercises tab thresholds, athlete-monitoring table, compliance %, readiness score) → **bridged**. `backend/GENMO/scripts/biomechanics/legacy_metrics.py` (new) reproduces the retired on-device analyzer's exact readiness-score/`session_metrics` formulas against the new pipeline's joints, for squat/vertical_jump/pull_up. Section 1 and 3.4 below now describe the real, implemented output shape — this is no longer an open decision for the manager-module *data*, only for how `save_video_job` wires it into `sessions` (still application Claude's call, now much narrower — see checklist item 1 / section 3.4).
2. **"Today's Tasks"** → redesign around async: a task shows "pending" once uploaded, and only resolves to met/mismatched once the job completes (the athlete may find out via the push notification rather than in the moment). This is checklist item 8.
3. **Recording → upload flow** → keeps a brief review/confirm step (checklist item 2) rather than uploading the instant recording stops.

---

## 1. Background: what already shipped in `backend/` (REFERENCE — no action needed)

Three things landed before this handoff, all already tested end-to-end on real sample videos:

1. **GEM-based pose pipeline** (`backend/GENMO/`): video → 3D pose (NVIDIA GEM) → exercise detection/rep-counting for 6 exercises (squat, deadlift, vertical_jump, pull_up, push_up, ab_crunch) → two-panel render (original | skeleton+counter).
2. **Biomechanical analysis** (`backend/GENMO/scripts/biomechanics/`): an extensible orchestrator (`analysis.py`) that currently runs two analyzers once exercise detection succeeds — `balance` (new: a left/right symmetry score, built for the new Performance/Processing UI) and `legacy_metrics` (new: the manager-module compatibility bridge, see section 3.4). Report shape (this is what ends up in `video_jobs.analysis_json`, see section 3.1):
   ```jsonc
   {
     "exercise": "squat",              // or null if nothing was confidently detected
     "rep_count": 4,
     "analyses": {
       "balance": {
         "method": "left_right_balance",
         "overall_balance_pct": 93.6,           // 0-100, higher = more symmetric
         "rep_count": 4,
         "joint_checks": [
           {
             "id": "knee_flexion", "label": "Knee flexion",
             "joints": ["L_KNEE", "R_KNEE"],
             "metric": "lsi",                    // "lsi" (limb symmetry) | "tilt" (hip/shoulder-height proxy)
             "informational": false,              // true = engineering estimate, not literature-validated — render with lower visual confidence
             "balance_pct": 94.6, "mean_asymmetry_pct": 5.4,
             "severity": "ok",                    // "ok" | "watch" | "at_risk"
             "watch_threshold_pct": 10.0, "at_risk_threshold_pct": 20.0,
             "reps": [ { "rep": 0, "frame": 40, "l_value": 48.4, "r_value": 44.6, "asymmetry_pct": 7.7, "balance_pct": 92.3, "severity": "ok" }, ... ]
           }
           // squat/deadlift: knee_flexion (+hip_flexion/hip_hinge); vertical_jump: takeoff/landing knee symmetry;
           // pull_up/push_up: elbow_flexion (+shoulder tilt, informational); ab_crunch: trunk_lift_tilt (informational only)
         ],
         "at_risk_joints": [ /* flattened list of every rep that hit "at_risk", with id/label/joints/rep/frame/asymmetry_pct */ ]
       },
       "legacy_metrics": {                       // present ONLY for squat/vertical_jump/pull_up — see section 3.4
         "legacy_exercise_key": "squat",          // "squat" | "jump" | "pullup" — already renamed to mobile's old vocabulary
         "readiness_score": 97,                   // 0-100, same weighted-average formula the old on-device analyzer used
         "readiness_label": "Ready",              // "Ready" | "Caution" | "High Risk", same bands as before
         "recommendation": null,                  // one of exerciseMetrics.ts's RecommendationKey ids, or null
         "session_metrics": [                     // {metric_key, value} pairs, ready to insert into session_metrics as-is
           { "metric_key": "squat_symmetry", "value": 2 },
           { "metric_key": "squat_depth", "value": 120 },
           { "metric_key": "squat_fatigue", "value": 13 }
         ]
       }
       // future methods (fatigue, range-of-motion) will appear as sibling keys here, same shape convention
     }
   }
   ```
   If no exercise was detected, `analyses` is `{}`. Each analyzer key is independently optional — `legacy_metrics` is absent for push_up/deadlift/ab_crunch (no legacy profile exists for those), and any analyzer can be absent for other reasons (e.g. too few reps). Always check for a key's presence rather than assuming it exists.

3. **The async job-queue worker** (`backend/server/supabase_worker.py`, `backend/server/supabase_client.py`) described in section 2 below.

The old synchronous-only flow (`POST /process` on a local FastAPI server, blocking ~40-90s, given a local filesystem path) still exists as `app.py`'s dev-testing entrypoint. **The async flow is what the app actually uses.**

---

## 2. Background: the new async architecture (REFERENCE — no action needed)

The app no longer runs any pose estimation, exercise detection, or video rendering on-device — that's fully server-side now (in `backend/`, MediaPipe-in-WebView is retired). The app's job is: record → upload → poll/get notified → view/save/discard.

**Decision: video delivery is via Supabase Storage signed URLs, not a custom stream/file endpoint.** The backend has no public HTTPS presence in beta (it runs on a local GPU box in WSL2) — the phone can't reach it directly. Routing everything through Supabase (which the app already talks to) means the backend only needs outbound internet access, not inbound. Supabase Storage already serves range requests, so `expo-av`/the existing `VideoPlayer` component can play a signed URL exactly like a local file — no custom streaming server needed for beta.

```
[app] record video
   -> upload raw video to Supabase Storage (exercise-videos/raw/{athlete_id}/{job_id}.mp4)
   -> insert video_jobs row (status='queued', duration_sec, recorded_at, raw_video_path)
   -> show "N videos processing" banner immediately (local copy of raw video also kept on-device
      so the "Processing" tab has something to show before the backend even starts)

[backend: supabase_worker.py, new — a persistent process, separate from the FastAPI dev server]
   -> polls video_jobs for status='queued', claims one (atomic compare-and-swap update)
   -> downloads raw video from Storage
   -> runs the full pipeline (same code path as /process): pose -> exercise -> biomechanics -> two-panel video
   -> uploads result video to Storage (exercise-videos/processed/{athlete_id}/{job_id}/two_panel.mp4)
   -> updates video_jobs: status='completed', result_video_path, analysis_json, exercise_type

[supabase: DB webhook + Edge Function, new]
   -> on video_jobs status -> 'completed', push-notifies the athlete via Expo push

[app]
   -> notification tap -> Performance > Processing > that job
   -> shows two_panel video (signed URL) + analysis_json (score + per-joint threshold evaluation)
   -> Save -> writes a `sessions` row (existing history table), deletes the video_jobs row
   -> Discard -> deletes video_jobs row + both storage objects, nothing saved
   -> Remove (while queued/processing) -> sets cancel_requested=true; worker checks this at two
      points (see supabase_worker.py's docstring) and deletes the row + raw object once it notices
```

### What's already implemented in `backend/` (nothing for you to build here)

- `backend/server/supabase_client.py` — raw httpx client against Supabase's REST (`/rest/v1`) and Storage (`/storage/v1`) APIs, authenticated with the **service role** key (bypasses RLS — this process needs to touch any athlete's row/files). Functions: `fetch_queued_jobs`, `claim_job` (atomic), `get_job`, `is_cancel_requested`, `mark_completed`, `mark_failed`, `delete_job`, `download_object`, `upload_object`, `delete_object`.
- `backend/server/supabase_worker.py` — the persistent worker process. Polls every 3s, claims a job, downloads, runs `pipeline.process_video_two_panel()` (the same function `app.py`'s `/process` endpoint already uses — no pipeline duplication), uploads the result, writes `analysis_json` back. Checks `cancel_requested` right after claiming and right after processing finishes (can't interrupt mid-GPU-inference; those are the two points where skipping wasted work is actually possible).
- `backend/server/app.py` (existing, unchanged) stays as a manual/dev-testing HTTP entrypoint. It is **not** what the app talks to in production — `supabase_worker.py` is.

**Not implemented, and out of scope for the backend Claude:** the actual Supabase migration (table/policies/bucket/Edge Function), and all mobile UI. Both are the application Claude's job — see the checklist above and sections 3-5.

### Environment variables the worker needs (informational — this is run/deployed outside of what you build)

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key, NEVER the anon key>
SUPABASE_JOBS_TABLE=video_jobs        # optional, this is the default
SUPABASE_STORAGE_BUCKET=exercise-videos  # optional, this is the default
```
Run with: `cd backend/server && source ../GENMO/.venv/bin/activate && python supabase_worker.py`

---

## 3. 🔧 Supabase schema you must create (ACTION REQUIRED — checklist item 1)

### 3.1 New table: `video_jobs`

```sql
create type video_job_status as enum ('queued', 'processing', 'completed', 'failed');

create table public.video_jobs (
  id                 uuid primary key default gen_random_uuid(),
  athlete_id         uuid not null references auth.users(id) on delete cascade,
  status             video_job_status not null default 'queued',
  cancel_requested   boolean not null default false,
  raw_video_path     text not null,        -- storage path within the bucket below, e.g. raw/{athlete_id}/{id}.mp4
  result_video_path  text,                 -- set by the worker when status='completed'
  exercise_type      text,                 -- set by the worker: squat|deadlift|vertical_jump|pull_up|push_up|ab_crunch
  analysis_json      jsonb,                -- set by the worker — see the shape documented in section 1
  duration_sec       numeric not null,     -- known at upload time, set by the app
  recorded_at        timestamptz not null, -- known at upload time, set by the app
  error_message      text,
  created_at         timestamptz not null default now(),
  started_at         timestamptz,
  completed_at        timestamptz
);
```

There is deliberately no `'cancelled'` or `'discarded'` status — cancelling a queued/processing job or discarding a completed one both just **delete the row** (see 3.3). A row only ever exists while it's live; nothing downstream needs to distinguish "cancelled" from "never existed."

**RLS**: athletes can `select`/`insert` their own rows (`athlete_id = auth.uid()`). Athletes should **not** be able to directly `update` arbitrary columns (they shouldn't be able to write their own `analysis_json` or flip `status` to `'completed'`) — route all athlete-initiated writes through the RPCs in 3.3 instead, and don't grant a general `update` policy to the `authenticated` role. The service-role key (used only by `supabase_worker.py`) bypasses RLS entirely, which is how the worker updates rows.

### 3.2 New Storage bucket: `exercise-videos` (private)

Layout: `raw/{athlete_id}/{job_id}.mp4` (uploaded by the app), `processed/{athlete_id}/{job_id}/two_panel.mp4` (uploaded by the worker, service role).

Storage RLS: athletes can `insert`/`select`/`delete` objects under `raw/{their own athlete_id}/...` and `select`/`delete` (not `insert`) under `processed/{their own athlete_id}/...` — the standard Supabase Storage pattern of matching the first path segment after the prefix against `auth.uid()`. This lets the app both play back and directly delete both raw and processed files for its own jobs without needing another RPC for storage cleanup.

### 3.3 RPCs (security-definer Postgres functions, called by the app with the user's own session)

- `cancel_video_job(job_id uuid)` — verifies `athlete_id = auth.uid()`. If `status = 'queued'`, deletes the row immediately (the worker hasn't touched it yet, nothing to signal). If `status = 'processing'`, sets `cancel_requested = true` and leaves the row for the worker to delete once it notices (see the two-checkpoint cancellation behavior in `supabase_worker.py`). The app should optimistically hide rows with `cancel_requested = true` from its UI rather than waiting for the row to actually disappear.
- `discard_video_job(job_id uuid)` — verifies ownership and `status = 'completed'`, deletes the row. (The app deletes the two storage objects itself via the Storage RLS in 3.2 — no need for this RPC to touch storage.)
- `save_video_job(job_id uuid)` — verifies ownership and `status = 'completed'`, inserts a `sessions` row from the job's data (see 3.4 for exactly which fields, now resolved), then deletes the `video_jobs` row.

A single `remove_video_job(job_id uuid)` that branches internally on the row's current status (queued/processing → same as `cancel_video_job`; completed/failed → same as `discard_video_job`) is a reasonable simplification if you'd rather the app call one function regardless of which tab triggered it — your call.

### 3.4 Reconciling with the existing `sessions` table

`public.sessions` (from `001_schema.sql`) already exists and is what today's manager module (Exercises tab thresholds, athlete-monitoring table, compliance %, readiness score) reads: `athlete_id`, `exercise_type`, `rep_count`, `readiness_score`, `analysis_json jsonb`, `recorded_at`, plus `session_metrics` rows keyed `${exerciseKey}_${metricId}`. That module is built entirely on numbers the old on-device analyzer produced — this was flagged as a hole in the first draft of this handoff (retiring on-device analysis silently breaks it), and is now bridged:

**Now implemented in `backend/`**: `backend/GENMO/scripts/biomechanics/legacy_metrics.py` reproduces the old on-device analyzer's exact formulas (`asymPct`, `ramp`, and the depth/fatigue/landing definitions from `mobile/src/utils/exerciseAnalyzer.ts`) against the new GEM-based joints. For squat/vertical_jump/pull_up, `video_jobs.analysis_json.analyses.legacy_metrics` (shape in section 1) gives you `readiness_score`, `readiness_label`, `recommendation`, and a ready-to-insert `session_metrics` array using the exact same `metric_key`s `mobile/src/utils/exerciseMetrics.ts` already defines thresholds for (`squat_depth`, `squat_symmetry`, `squat_fatigue`, `jump_landing`, `jump_symmetry`, `jump_flightTime`, `pullup_depth`, `pullup_symmetry`, `pullup_fatigue`). `save_video_job` should copy these fields directly into `sessions.readiness_score` and `session_metrics` rows — no scoring logic needs to be reimplemented in SQL or TypeScript.

**Still yours to decide** — narrower than the first draft, but real:

1. **push_up / deadlift / ab_crunch have no legacy profile** (they never existed in the old analyzer, so there's nothing to bridge). `analyses.legacy_metrics` is simply absent for these — `save_video_job` should leave `sessions.readiness_score` null and insert no `session_metrics` rows, and the manager UI needs to render that gracefully ("no readiness data for this session") rather than assuming every session has one. Extending the manager module to score these 3 exercises for real is out of scope for this pass.
2. **`sessions.analysis_json` shape mismatch.** It currently stores the old on-device `Assessment` type in full (`perExercise[].factors/metrics`, including per-rep trend data like `perRepDepth`/`romDeg` that feed the athlete's own historical charts in `HistoryDetailScreen.tsx`) — `legacy_metrics` does **not** reconstruct that full shape, only the readiness score + flat `session_metrics` the manager table needs. Recommend adding a new column, e.g. `sessions.biomechanics_json jsonb`, storing the *new* pipeline's full report (section 1) there, and leaving `sessions.analysis_json` null for sessions created via this new pipeline — meaning any UI that renders old-style per-rep trend charts from `analysis_json` will have nothing to show for new sessions until/unless that's built out separately. That's a real, visible gap for this pass, not silently papered over — surface it as "detailed trends not yet available" in `HistoryDetailScreen.tsx` rather than crashing on a missing shape.
3. **`exercise_type` vocabulary**, only for push_up/deadlift/ab_crunch now (squat/vertical_jump/pull_up are already handled: `legacy_metrics.legacy_exercise_key` gives you the renamed `squat`/`jump`/`pullup` directly). Store the new pipeline's raw key (`push_up`/`deadlift`/`ab_crunch`) in `sessions.exercise_type` for those, and make sure nothing in the dashboard/history list crashes on an `exercise_type` it doesn't have a label/icon for — a generic fallback label is enough for this pass.

### 3.5 Push notifications: `video_jobs` completion → Expo push

1. Add `expo_push_token text` to `public.profiles`.
2. Mobile registers for notification permissions on launch/login (`expo-notifications`, not currently a dependency — needs adding), gets the Expo push token, upserts it into `profiles`.
3. New Supabase **Database Webhook** on `video_jobs`, `UPDATE` event, pointing at a new **Edge Function** (e.g. `notify-video-ready`). The webhook payload includes both `record` and `old_record`; the Edge Function should no-op unless `record.status === 'completed' && old_record.status !== 'completed'` (Database Webhooks don't filter on a column *transition* natively — do that check inside the function). On a real transition: look up `profiles.expo_push_token` for `record.athlete_id`, POST to `https://exp.host/--/api/v2/push/send` with `{ to: token, title: "Your video is ready", body: "...", data: { jobId: record.id } }`.
4. Mobile handles the notification tap (`expo-notifications` response listener) by deep-linking to Performance → Processing → that `jobId`.

---

## 4. 🔧 Full build brief (ACTION REQUIRED — checklist items 1-9, in prompt form)

Everything below this line is meant to be handed to a fresh Claude session working in `mobile/` (and `supabase/`) as its task brief. It's self-contained — it doesn't assume that Claude has read the rest of this document, though pointing it at this file too is fine.

> You're working on the APeX athlete-assessment app, in `mobile/` (Expo/React Native) and `supabase/` (SQL migrations + Edge Functions). Do **not** modify anything under `backend/` — that's owned by a separate backend engineer/session; treat it as a black box you integrate with, not code you edit. Full context and the exact API/schema contract you're building against is in `HANDOFF_video_pipeline.md` at the repo root — read it before starting, especially section 3 (the Supabase schema you need to create, including 3.4's now-resolved manager-module bridge) and section 1 (the exact JSON shape `analysis_json` will contain).
>
> **The big picture**: today, the app does pose estimation and exercise analysis on-device (MediaPipe in a WebView — see `mobile/src/hooks/useVideoProcessor.ts`, already stubbed out, and `mobile/src/components/PoseView/`). That's being retired — but **leave that code in place, just unrouted, for this pass**; don't delete `PoseView/`, `exerciseAnalyzer.ts`, etc. yet, since it's a large, hard-to-undo deletion and actual removal should be its own follow-up once the new flow is proven in production. From now on, the app only records video, uploads it, and displays results the backend computed. The backend already exists and works — you're building the plumbing (Supabase schema + the app's upload/poll/notify/review UI) between "user records a video" and "user sees their two-panel analysis video with a balance score."
>
> **On push notifications (item 9 below) and Expo Go**: this project is on Expo SDK 54, and Expo Go dropped support for remote push notifications in SDK 53 — `expo-notifications` registration will no-op in whatever environment you've been testing in so far. Getting push actually working requires an EAS development build. Build everything else (1-8 below) fully testable in Expo Go/web first; stub the push-token registration and defer wiring the actual send until a dev build is available.
>
> **What you own and need to build:**
>
> 1. **Supabase migration** implementing section 3 of the handoff doc: the `video_jobs` table, the `exercise-videos` storage bucket with its RLS policies, the `cancel_video_job`/`discard_video_job`/`save_video_job` RPCs (or a unified `remove_video_job`), the `profiles.expo_push_token` column, and the `notify-video-ready` Edge Function + Database Webhook. Section 3.4's manager-module bridge is now implemented backend-side (`analysis_json.analyses.legacy_metrics` gives you a ready-to-insert `readiness_score` + `session_metrics` array for squat/vertical_jump/pull_up) — `save_video_job` just needs to copy those fields in; make your own call on the three narrower open items listed at the end of 3.4 (push_up/deadlift/ab_crunch having no readiness data, the `sessions.analysis_json` vs. a new `biomechanics_json` column, and the `exercise_type` vocabulary for the 3 new exercises), leave a comment explaining each, don't leave them ambiguous.
>
> 2. **Recording → upload flow.** Keep a brief review/confirm step after recording — the athlete sees the clip and taps something like "Use this take" (same shape as today's flow, just without an "Analyze" button, since there's no synchronous result anymore). On confirm: compute `duration_sec` and `recorded_at`, generate a `job_id`, upload the raw video to `exercise-videos/raw/{athlete_id}/{job_id}.mp4` via `supabase.storage`, keep a local copy too (reuse `mobile/src/utils/storage.ts`'s `saveVideo`, so the video is viewable even before/without any network round-trip), and insert the `video_jobs` row.
>
> 3. **"N videos processing" banner**, visible anywhere relevant in the app (not just the Performance screen) — live count of the current athlete's `video_jobs` rows with `status in ('queued','processing')`. Use a Supabase Realtime subscription on `video_jobs` filtered to the athlete, not polling — `@supabase/supabase-js` is already a dependency and used elsewhere in the app (see `mobile/src/api/`).
>
> 4. **Rename "History" → "Performance"**, with two tabs:
>    - **History**: existing `sessions`-backed list, essentially unchanged.
>    - **Processing**: `video_jobs` rows with `status in ('queued','processing','completed','failed')` for the current athlete (i.e., everything not yet saved or discarded — saving/discarding both delete the row, see the RPCs). Live via the same Realtime subscription as the banner.
>
> 5. **Processing-tab card, while `status` is `queued`/`processing`** (result not back yet): show `duration_sec`, `recorded_at`, and the **raw, unmodified** recorded video (play the local copy from `storage.ts` if present, else a signed URL to `raw_video_path`) — never the two-panel/annotated video, since it doesn't exist yet. Include a **"Remove exercise"** button that calls `cancel_video_job` (or your unified RPC), deletes the local video copy, and optimistically removes the card from the list (don't wait for the row to actually disappear server-side if `status` was `processing` — see the handoff doc's note on why that's eventually-consistent, not instant).
>
> 6. **Processing-tab card, once `status = 'completed'`**: show the two-panel video (signed URL to `result_video_path` via `supabase.storage.from('exercise-videos').createSignedUrl(...)`, played through the existing `mobile/src/components/VideoPlayer`) and render `analysis_json` (shape is in section 1 of the handoff doc) — the overall balance score, and each `joint_checks[]` entry with its label, `balance_pct`, and `severity` (style `ok`/`watch`/`at_risk` distinctly; visually de-emphasize entries where `informational: true`). Two actions:
>    - **Save**: calls `save_video_job`. That RPC inserts the `sessions` row — for squat/vertical_jump/pull_up, populate `readiness_score` and `session_metrics` directly from `analysis_json.analyses.legacy_metrics` (no rescoring logic needed on your side); for push_up/deadlift/ab_crunch, `legacy_metrics` won't be present, so leave `readiness_score` null and insert no `session_metrics` rows — the manager's athlete-monitoring table needs to render that as "no readiness data" rather than crashing or showing a false 0. Moves the job to the History tab.
>    - **Discard**: calls `discard_video_job`, then deletes both storage objects via `supabase.storage.from('exercise-videos').remove([...])` — RLS from section 3.2 permits this for the athlete's own files.
>
> 7. **`status = 'failed'`**: show an error state with `error_message` and the same Remove button as (5) (routes to the same delete-the-row behavior, since `failed` isn't `queued`/`processing`).
>
> 8. **"Today's Tasks" redesign.** The required-exercise flow currently gives instant feedback (rep count vs. requirement, "Record Again") right after recording, using the on-device analyzer — that can't work with async processing (the job may finish after the athlete has left the app). Redesign it around the new flow: a required task shows "pending" once its video is uploaded, and only resolves to met/mismatched once the corresponding `video_jobs` row completes (the athlete may learn about a mismatch via the push notification rather than in the moment, once push is wired up).
>
> 9. **Push notifications**: add `expo-notifications`, request permission and register the Expo push token into `profiles.expo_push_token` on launch/login, and handle a tapped notification by deep-linking into Performance → Processing, scrolled/highlighted to `data.jobId`. See the Expo Go note above — this is likely the last piece you can fully verify.
>
> Work incrementally and verify each piece — e.g. get the upload + `video_jobs` insert working and confirm a row appears (you can watch it get picked up if the backend engineer has `supabase_worker.py` running against the same project) before building the notification plumbing on top of it.
