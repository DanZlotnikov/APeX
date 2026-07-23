# APeX · Security & App Store Readiness Audit

Full review across mobile, backend, Supabase RLS/schema, and Edge Functions, done specifically
against a "assume a hostile client with only the anon key" adversarial lens (the standing item
from `APP_STORE_SUBMISSION_PLAN.md` §4), plus a general Apple-rejection-risk pass. Every finding
below was verified against the actual code (not assumed) — several by empirically checking the
real behavior (a built bundle, the vendored `httpx` source, `py_compile`), not just reading it.

**Status: the critical and high findings are fixed and validated in this same pass.** One item
needs action only you can take (see "Required manual step" below) — nothing else is blocking.

---

## Critical (fixed)

### 1. `profiles.role` / `profiles.team_id` were freely client-updatable — full privilege escalation

The only UPDATE policy on `profiles` (`001_schema.sql`) was `USING (id = auth.uid()) WITH CHECK
(id = auth.uid())` — that only stops you from hijacking someone *else's* row, it does nothing to
stop you rewriting your **own** row's `role`/`team_id`. Since every other table's access control
(`my_team_id()`, the manager-role checks in `mark_athlete_injured`/`recovered`, `team_routines`,
`athlete_exercise_assignments`, `notifications`) trusts these two columns as ground truth, this
was a complete authorization bypass: any authenticated user could run

```sql
UPDATE profiles SET role = 'manager', team_id = '<any-team-uuid>' WHERE id = auth.uid()
```

directly via the Supabase client and become a manager of an arbitrary team with zero invite code
or authorization — full read access to that team's athletes' sessions, injury status, biomechanics
data, everything.

**Fix**: `supabase/migrations/019_security_hardening.sql` adds a `BEFORE UPDATE` trigger that
hard-blocks any change to `role`/`team_id` after creation. No legitimate code path ever updates
either column post-signup (both are set once, at INSERT time, by `create_manager_team`/
`join_team_as_athlete`/`create_individual_athlete`), so this has zero functional impact. A
trigger (not an RLS `WITH CHECK` subquery) was used deliberately to avoid any old-vs-new-row
ambiguity, and because it also applies to service-role writes — a second backstop against a buggy
admin script, not just client requests.

### 2. `video_jobs.raw_video_path` was unsanitized, attacker-controlled input reaching a service-role Storage call — IDOR + path traversal/SSRF

The client sets this value itself before INSERT (`mobile/src/api/videoJobs.ts`), and the only
INSERT policy checks `athlete_id = auth.uid()` but never validates what `raw_video_path` actually
*is*. `backend/server/supabase_client.py`'s `download_object`/`delete_object` build a Storage URL
by directly interpolating this string (`f"{url}/storage/v1/object/{bucket}/{storage_path}"`) and
call it with the **service-role key**. Two confirmed, exploitable consequences:

- **IDOR**: set `raw_video_path` to another athlete's real object path — the worker downloads and
  fully processes a stranger's private video and serves the result back to the attacker.
  Cancelling that job additionally **deletes the victim's file**.
- **Path traversal / SSRF**: verified directly against the vendored `httpx` source
  (`_urlparse.py`'s `normalize_path()`, confirmed it performs RFC 3986 dot-segment collapsing) —
  a `raw_video_path` containing `../` segments gets normalized *before* the request is sent,
  meaning a crafted value can escape the intended `/storage/v1/object/{bucket}/` prefix entirely
  and reach **arbitrary REST/Storage/Auth-admin endpoints on the same Supabase project,
  authenticated with the service-role key**.

**Fix, two layers**:
- **DB (authoritative)**: `019_security_hardening.sql` adds a CHECK constraint requiring
  `raw_video_path` to exactly match `^raw/<own athlete_id>/[safe-charset].{ext}$` — anchored
  start-to-end, so neither another athlete's path nor a traversal payload can ever be stored,
  regardless of which code path ever inserts a row (present or future).
- **Worker (defense-in-depth)**: `backend/server/supabase_worker.py` now validates `raw_path`
  against the same pattern before touching Storage at all, and refuses (marking the job failed
  with a generic message) if it doesn't match — so the worker is safe even if migration 019
  hasn't been applied yet, or the constraint is ever accidentally weakened later.

### 3. Hardcoded dev-login credentials shipped live, reachable in the app UI

`DEV_CREDENTIALS` (`mobile/src/api/auth.ts`) — two real, seeded Supabase Auth accounts
(`daniel.cohen@apex.dev` / `coach@apex.dev`, both password `apex_dev_123`) — had no `__DEV__` or
environment gate anywhere. The "DEV" quick-login section in `LoginScreen.tsx` was collapsed by
default but always rendered and tappable in the actual shipped binary, and the credential strings
were present in the JS bundle regardless of whether anyone tapped it. This is both a real
account-takeover vector and a near-certain App Review red flag if a reviewer finds it.

**Fix**: the entire dev-login UI section in `LoginScreen.tsx` is now wrapped in `{__DEV__ && (...)}`
(React Native's build-time global, statically `false` in any release build). Separately —
**verified this mattered**: exporting a bundle and grepping it showed the credential strings
*still present* even with the UI gated, because `DEV_CREDENTIALS` was an unconditional top-level
export in `auth.ts`, and Metro doesn't reliably tree-shake unused named exports across module
boundaries the way it dead-code-eliminates a local `if (__DEV__)` branch. Fixed by making the
export itself conditional (`__DEV__ ? {...} : undefined`) — re-exported, re-built, re-checked:
**zero matches** for any of the three credential strings in the fresh bundle.

**⚠️ Required manual step — only you can do this**: gating the code does **not** invalidate the
underlying Supabase Auth accounts. Anyone who already has (or later extracts from an older build,
git history, or this document) `daniel.cohen@apex.dev` / `coach@apex.dev` / `apex_dev_123` can
still sign in directly via the public Supabase Auth API — this has nothing to do with the app's
UI or code at all. **Delete these two accounts (or rotate their passwords to something not
hardcoded anywhere) in your Supabase dashboard before beta.** I don't have Supabase auth-admin
access to do this myself.

---

## High (fixed)

### 4. `notifications`: any team member could insert arbitrary fabricated notifications

The INSERT policy only checked `team_id = my_team_id()` — nothing validated `message`, `severity`,
or that a supplied `athlete_id`/`session_id` belonged to the caller. Any authenticated team member
could spoof a notification impersonating someone else, fake a `severity: 'critical'` alert, or
reference another athlete's session. The one legitimate creation path (`save_video_job`, `SECURITY
DEFINER`) doesn't use this client-facing policy at all — it bypasses RLS — and the client-side
function that did (`createNotification` in `mobile/src/api/notifications.ts`) is confirmed dead
code, only reachable from the retired on-device flow.

**Fix**: `019_security_hardening.sql` drops the "team notifications insert" policy outright — safe
given nothing legitimate depends on it.

### 5. Raw backend exception text was surfaced verbatim to the athlete

`supabase_worker.py`'s `mark_failed(...)` calls interpolated `str(exception)` directly into
`video_jobs.error_message`, which `ProcessingScreen.tsx` renders as-is. An athlete who uploads a
malformed video could read back internal exception text — potentially including temp-file paths
or library internals — in the app UI. Not itself a data breach, but a real information-disclosure
hygiene gap for a client-facing error channel.

**Fix**: every `mark_failed` call site now passes a generic, athlete-safe message ("Could not
download the uploaded video. Please try again.", etc.); the full exception detail still goes to
the server-side log (`print`/`traceback.print_exc()`) for your own debugging, it just no longer
reaches the client.

### 6. `sessions` / `session_metrics`: athletes had full client-side write access, not just read/delete

Left over from before `save_video_job` (SECURITY DEFINER) became the only legitimate way to create
a session, both tables had a `FOR ALL` policy letting an athlete INSERT/UPDATE their own rows
directly — meaning an athlete could fabricate their own readiness data via a raw API call,
bypassing the pipeline entirely. This is a self-data-integrity issue (an athlete can only lie
about *themselves*, not touch anyone else's data), not a cross-account breach, but worth closing
while everything else was being tightened, at zero legitimate-functionality cost (nothing
client-side inserts/updates either table directly anymore).

**Fix**: `019_security_hardening.sql` replaces the `FOR ALL` policies with SELECT + DELETE only
(DELETE is real, used functionality — `mobile/src/api/sessions.ts`'s `deleteSession`).

---

## Medium (fixed)

### 7. WebView `originWhitelist={['*']}` wider than needed

`PoseView.native.tsx`'s WebView (loads a locally-bundled MediaPipe HTML page that fetches
scripts/WASM/models from `cdn.jsdelivr.net`/`storage.googleapis.com`) had `originWhitelist={['*']}`,
which controls top-level *navigation*, not the CDN fetches themselves (those are legitimately
enabled by `allowUniversalAccessFromFileURLs`/`allowFileAccess`, both left untouched since they're
required for the pose pipeline to work on iOS). The page never legitimately needs to navigate
anywhere else, so `['*']` was unnecessary latitude — if the CDN JS were ever compromised and tried
a top-level redirect, nothing was stopping it.

**Fix**: narrowed to `originWhitelist={['file://*']}` — matches the page's own `baseUrl`, blocks
navigation anywhere else, doesn't touch the CDN-fetch mechanism at all.

### 8. `backend/server/app.py`'s dev `/process` endpoint documented with a network-reachable bind

This endpoint has no auth and accepts any absolute local filesystem path with no allowlist — by
design, as a documented "manual/dev-testing entrypoint" (it's not what `supabase_worker.py` uses
in production). But its documented run command was `--host 0.0.0.0`, which would make an
unauthenticated arbitrary-local-file-read/processing endpoint reachable from your whole network
if literally run as documented.

**Fix**: changed the documented command to `--host 127.0.0.1` (localhost-only) with an explanatory
comment. No functionality lost for legitimate same-machine testing; just removes the accidental
network-exposure footgun. `supabase_worker.py` (the production path) has no listening port at all,
so this doesn't affect it.

---

## Reviewed and confirmed safe (no change needed)

- `delete-account` Edge Function — caller identity always derived from their own verified JWT,
  never client-supplied; correctly re-verified in this pass.
- `mark_athlete_injured`/`mark_athlete_recovered`, `cancel_video_job`/`discard_video_job`/
  `save_video_job` RPCs — all correctly scope the target row to the caller (`auth.uid()` or a
  verified team match), confirmed by reading every version across every migration.
- Storage RLS (`raw/`/`processed/` folder-prefix ownership via `auth.uid()::text`) — sound,
  can't be spoofed since it's derived server-side from the JWT.
- `athlete_profiles` (DOB/height/weight) — correctly private to the athlete + their own manager
  only, no teammate-read policy exists.
- No hardcoded secrets/API keys anywhere in `backend/` or `mobile/src` beyond the dev credentials
  above (checked JWT-shaped strings, AWS-style keys, Stripe-style keys, literal service-role key
  assignments — all clean).
- `mobile/.env` (holds the service-role key) confirmed still gitignored and never committed.
- Backend `subprocess`/`eval`/`exec`/`pickle` usage — every instance found is either not
  shell-injectable (argv-list form, no `shell=True`) or confirmed unreachable from the athlete-video
  pipeline (training scripts, dataset loaders, ONNX export tools — traced the full import graph
  from `supabase_worker.py` to confirm).
- Temp file/directory cleanup in the actual per-job hot path (`supabase_worker.py`) — correctly
  wrapped in `try/finally`, cleaned up on every exit path including exceptions.

## Noted, not fixed — lower priority / needs a judgment call from you

- **In-process video decoding of untrusted input**: PyAV decodes athlete-uploaded video directly
  in the same GPU worker process that holds the service-role key in its environment. A
  memory-corruption bug in libav's demuxer (a recurring CVE class) would be a higher-value target
  here than a typical crash. This is architectural, not a specific line-level bug — worth knowing
  about, not something this pass fixes (would mean sandboxing/isolating the decode step, a bigger
  change than this audit's scope).
- **`notify-video-ready` Edge Function has no shared-secret check** on its caller, relying entirely
  on Supabase's platform-level JWT gate. Low severity (the message text is fixed, not
  attacker-controlled; worst case is spamming a push notification to a guessed athlete UUID), but
  worth adding a shared-secret header check eventually — needs a matching change in the Database
  Webhook config, so I didn't do it unprompted in this pass.
- **Raw `console.warn(..., e)` of full error objects** in several mobile screens (not
  auth/session-specific, but logs Supabase error payloads to device logs). Low severity, worth a
  cleanup pass eventually, not urgent.

---

## What I need from you (things I can't verify without Supabase dashboard access)

Please check/confirm these in the Supabase dashboard — none of them are visible from the
migration files alone:

1. **Run `019_security_hardening.sql`** — same manual step as every other migration this session
   (SQL Editor or `supabase db push`). Nothing above is actually fixed until this runs.
2. **Auth settings** (Authentication → Providers/Policies): is email confirmation required at
   signup? Is "Leaked Password Protection" (checks against HaveIBeenPwned) enabled? Any rate
   limiting on the auth endpoints? None of this is controlled by the migrations.
3. **Realtime replication**: confirm it's enabled (Database → Replication) for every table the app
   subscribes to live — `video_jobs`, `sessions`, `notifications`, `team_routines`,
   `athlete_exercise_assignments`. Several code comments across the app note this is a manual
   dashboard toggle, not something a migration can set.
4. **Storage bucket `exercise-videos`** — confirm it's still set private (migrations create it
   that way, but a dashboard toggle could have changed it since), and check whether a file-size/
   MIME-type limit is configured — RLS controls *who* can write to which folder, not *what* they
   upload.
5. **Confirm you're running the numbered migrations in order**, not `combined_for_paste.sql` — that
   file is a hand-merged, manually-kept-in-sync snapshot (flagged as a drift risk in
   `MANAGER_MODULE_AUDIT.md`) and I can't verify it's not what's actually deployed.
6. **Delete or rotate the two dev accounts** — see Critical finding #3 above, this is the one
   item that's genuinely required, not just a nice-to-have confirmation.

---

## Validation performed

- `tsc --noEmit` — clean except the two pre-existing, unrelated `PoseView.native.tsx` errors
  (present before this session, not touched by any of these changes).
- `npx expo export --platform web` — bundles cleanly, twice (before and after the `DEV_CREDENTIALS`
  export fix), with the second export empirically confirmed to contain zero occurrences of any of
  the three dev-credential strings.
- `python -m py_compile` on every edited backend file (`supabase_worker.py`, `app.py`) — no syntax
  errors.
- The `httpx` path-normalization claim underlying finding #2 was verified by reading the actual
  vendored source (`_urlparse.py`), not taken on faith from the audit sub-agent that first
  flagged it.

## Relationship to `APP_STORE_SUBMISSION_PLAN.md`

This audit fulfills §4's standing "worth one dedicated pass... assume a hostile client" item —
that plan will be updated to point here rather than duplicate this content. Nothing in this audit
changes anything else in that plan's status (Privacy Policy, worker cadence, etc. are unaffected).
