# APeX · App Store Submission Plan

Status: **in progress — §1 and §2 are fully done or built; ready for Phase C.**
Originally written as planning-only; updated after several follow-up sessions that implemented
account deletion, `app.json`/`eas.json`, the Privacy Policy (drafted, hosted, and linked from the
app), the microphone-permission removal, the health/fitness disclaimer + risk-framing wording
pass, the `userInterfaceStyle` fix, the splash-screen logo mark, and the worker-cadence automation
for beta (Windows Task Scheduler + WSL2, §2.1 — still needs `backend/server/.env` filled in and
one verified manual run before trusting it unattended). Every item below is
tagged ✅ **Done**, 🟡 **Partial / needs a decision**, or 🔴 **Not started** so this doc stays a
reliable single source of truth for what's actually left — update the tag whenever you change
something, don't just add new prose underneath stale tags.

## Current status at a glance

| # | Item | Status |
|---|---|---|
| 1.1 | In-app account deletion | ✅ Done — Edge Function deployed, UI live in both Settings screens |
| 1.2 | Service-role key isolation | ✅ Done — re-verified against the actual built bundle, not just source |
| 1.3 | `app.json` / `eas.json` fields | ✅ Done — bundle IDs, icon, version strategy all set |
| 1.4 | Privacy Policy | ✅ Done — live at danzlotnikov.github.io/APeX/privacy-policy.html, linked from signup + both Settings screens; legal review still recommended |
| 2.1 | Worker cadence during review | 🟡 Built + verified, currently **disabled by request** — credentials are set, re-enable with `Enable-ScheduledTask -TaskName "APeX Worker Drain"` when ready |
| 2.2 | Health/fitness risk framing | ✅ Done — risk wording removed app-wide, disclaimer added at signup and in both Settings screens |
| 2.3 | Sign in with Apple | ✅ N/A — confirmed still not required, no change needed |
| 2.4 | Unnecessary microphone permission | ✅ Done — removed at every layer, including one not originally anticipated |
| 2.5 | `userInterfaceStyle` light/dark mismatch | ✅ Done — set to `"dark"` |
| Phase C/D/E | Build, TestFlight, metadata, submit | 🔴 Not started |

**Nothing left blocking Phase C.** §2.1's worker cadence is built and verified (30-min scheduled
task on the local PC, via WSL2, real credentials in place) but currently disabled at your request —
re-enable it whenever you want the 30-min cadence running again; revisit the cadence itself before
submitting for full App Store Review, not before starting
Phase C/TestFlight.

---

## 0. Architecture recap (so the rest of this doc makes sense)

```
[iPhone app]  --(HTTPS, Supabase Storage + Postgres + Realtime)-->  [Supabase project]
                                                                          ^
                                                                          | (poll/claim job, download raw video,
                                                                          |  upload result video, update row)
                                                                          v
                                                              [Your PC, run manually 1-2x/day]
                                                              backend/server/supabase_worker.py
                                                              (GPU pose estimation, GEM model)
```

The phone **never talks to your PC directly** — everything goes through Supabase (Storage
bucket `exercise-videos`, `video_jobs`/`sessions` tables, Realtime). Your worker only needs
outbound internet access to Supabase; it doesn't need a public IP, a domain, TLS certs, or to be
reachable from the internet. This is architecturally sound and Apple has no visibility into or
opinion about your backend infrastructure — only the **app's** behavior is reviewed. That said,
the *fact* that your backend is manually run 1-2x/day has real, direct consequences for App
Review — see §2.1, the single biggest risk in this plan.

---

## 1. Hard blockers — must be fixed before you can submit at all

These aren't judgment calls; Apple's tooling and/or guidelines will not let a submission through
without them.

### 1.1 In-app account deletion (Guideline 5.1.1(v)) — ✅ **Done**

Implemented: `supabase/functions/delete-account/index.ts` (Edge Function, deployed), a
`deleteAccount()` client call in `mobile/src/api/auth.ts`, and a destructive-confirm "Delete
Account" row in both `SettingsScreen.tsx` (athlete) and `ManagerSettings.tsx` (manager), gated by
`confirmAsync(..., { destructive: true })` and signing the user out on success.

**Deployment gotcha worth remembering**: the first deploy attempt (via the Supabase Dashboard's
inline function editor) landed under an auto-generated random slug instead of `delete-account`,
so the client's `supabase.functions.invoke('delete-account')` call 404'd with zero visible error
beyond a generic non-2xx — the dashboard's "Function name" field defaults to a placeholder
codename and doesn't auto-adopt what you typed elsewhere. Confirmed fixed by explicitly setting
the function name field before deploying. If you ever redeploy this function, double-check the
name field, not just the code.

Original requirement, still accurate for context: any app that lets a user create an account
(this one does — `signUpAthlete`/`signUpManager` in `mobile/src/api/auth.ts`) **must** let them
delete it from inside the app, not just deactivate it. Enforced since June 2022; not a courtesy
feature, a review gate.

**What "delete" actually does now**, confirmed against the deployed function: removes the
`auth.users` row via the admin API (which cascades `profiles`, `athlete_profiles`, `sessions`,
`athlete_routines`, `video_jobs`, `notification_reads` automatically per existing `ON DELETE
CASCADE`s), plus two things that do **not** cascade and needed explicit handling: a recursive
Storage walk that deletes every object under `raw/{id}/` and `processed/{id}/` in the
`exercise-videos` bucket, and an explicit `DELETE FROM notifications WHERE athlete_id = ...`
(that FK is `ON DELETE SET NULL`, not `CASCADE`, so the athlete's name baked into the
notification's `message` text would otherwise survive deletion). Storage/notification cleanup is
best-effort (logged, doesn't block) — the auth deletion itself is the one step that must succeed.

**Team-ownership decision, made and implemented**: a manager deleting their account does **not**
delete or orphan their team — `teams` has no FK back to a specific manager, and the product
decision was that a user can only ever delete their *own* data, never cascade-destroy their
athletes' data. Documented directly in the Edge Function's code comments.

### 1.2 Confirm the service-role key never ships in the client bundle — ✅ **Done, re-verified**

Re-checked more rigorously than the original pass: grepped `mobile/src`/config for any reference
(none), confirmed `SUPABASE_SERVICE_ROLE_KEY` is still not `EXPO_PUBLIC_`-prefixed, and — the
actual proof, not just inference — built a real `expo export` bundle and grepped the output JS
for the literal 219-character key value. Zero matches. As a control, the anon key's full literal
value *does* appear once, exactly as expected. Standing rule unchanged: never prefix it
`EXPO_PUBLIC_`, never read it from mobile code; the Edge Function (§1.1) and the worker process
are the only two places that should ever see it.

### 1.3 `app.json` / `eas.json` — ✅ **Done**

- `ios.bundleIdentifier` / `android.package`: `com.apexathletics.app`.
- `icon`: `./assets/icon.png` — a generated placeholder (teal "peak" mark on the app's navy
  background, via a small Pillow script kept at `mobile/assets/generate_icon.py`), good enough to
  satisfy EAS Build's requirement but **swap it for real artwork before final submission** — it's
  not final branding.
- `splash.image`: `./assets/splash-logo.png` — reproduces `LoadingScreen.tsx`'s actual in-app
  badge (ring + wordmark) as a static transparent PNG via `mobile/assets/generate_splash_logo.py`,
  since the native splash renders before any JS/React Native loads and can't use that component
  directly. `splash.backgroundColor` corrected to the theme's exact `#07101C` (was an
  approximation, `#0B1220`) so there's no visible seam at handoff to the real app background.
- Version numbering: decided on EAS remote auto-increment (`eas.json`'s `cli.appVersionSource:
  "remote"` + `build.production.autoIncrement: true`) — no `ios.buildNumber`/`android.versionCode`
  in `app.json` by design, EAS tracks and bumps it for you on every `eas build --profile
  production`.
- `eas.json` created (hand-authored to the same shape `eas build:configure` produces —
  `development`/`preview`/`production` profiles).
- Validated: `npx expo config` resolves cleanly, and `npx expo prebuild` was run once as a
  correctness check (native folders removed afterward — this stays a managed-workflow project,
  no committed `android/`/`ios/` directories).

**Still needs you specifically**: register `com.apexathletics.app` in your Apple Developer
account (Certificates, Identifiers & Profiles) before your first EAS build — that step can only
happen through Apple's own site.

### 1.4 Privacy Policy — ✅ **Done** (pending a legal review, which is yours to schedule)

`PRIVACY_POLICY.md` is written and accurate to the app's real behavior (verified against actual
code, not assumed): what's collected (account info, optional profile fields, muted video-only
recordings, derived readiness/balance/ROM data, injury status, push tokens), that Supabase/Expo
are named sub-processors, that a coach/manager can see their team athletes' data (and an
individual athlete's data is visible to no one else), retention and the real account-deletion
mechanism from §1.1, and a 13+ children's-privacy clause matching how signup actually works
(direct self-registration, no age gate).

- **Contact info** (Section 11): `danzlotnikov+apex@gmail.com` (a Gmail `+` alias — lands in the
  existing inbox, gives a distinct public-facing address without a new account to check) and
  developer name, both filled in.
- **Hosted at a public URL, confirmed live**: `https://danzlotnikov.github.io/APeX/privacy-policy.html`
  (GitHub Pages, `docs/privacy-policy.html`) — verified rendering correctly, dark theme, section
  nav working. Before enabling Pages, audited `docs/` for anything secret-shaped (grepped the
  file for Supabase URLs/keys/JWTs/tokens — the only match was the intentional contact email);
  `docs/` contains exactly this one file, and GitHub Pages only ever publishes that folder, not
  the rest of the (private) repo.
- **Linked from the app**: `SignUpScreen.tsx` (a "Privacy Policy" link next to the disclaimer,
  above the submit button) and both Settings screens' "ABOUT" section — all three point at the
  same GitHub Pages URL above.

**Still open, not code**: have a lawyer review it before publishing, especially for GDPR/CCPA-
specific language if you'll operate in the EU/UK or California — the document says so itself in
its closing note.

---

## 2. Serious risks — not automatic rejections, but genuinely likely to cause one

### 2.1 Manually running the backend 1-2x/day, during App Review — 🟡 **Built, currently disabled by request**

**Current state: the "APeX Worker Drain" scheduled task exists and is fully verified working, but
is deliberately `Disabled`** (`Disable-ScheduledTask`, not deleted — all settings/credentials are
still intact) — you asked for the 30-min runs to stop. Re-enable with:
```powershell
Enable-ScheduledTask -TaskName "APeX Worker Drain"
```
`backend/server/.env` now has real credentials (copied from `mobile/.env`'s
`EXPO_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`), so the moment it's re-enabled it should
actually process queued jobs, not just idle on the missing-credentials error described below.

**Built**: the task runs every 30 minutes and drains whatever's queued, when enabled. Concretely:
- `backend/server/supabase_worker.py` gained a `--drain` flag — instead of polling forever, it
  exits as soon as the queue is empty, so each scheduled run loads the models once, processes
  whatever's waiting, and exits (rather than idling or overlapping with the next trigger).
- `backend/server/run_worker_drain.sh` is the actual entrypoint the task calls — it `flock`s
  against overlapping runs, activates the venv, sources `backend/server/.env` for
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (gitignored, not committed — **you need to fill in
  the two blank values in that file once**, the same ones you currently type inline manually),
  runs `python supabase_worker.py --drain`, and appends everything to `worker_run.log`.
- **This backend actually runs inside WSL2 (Ubuntu-22.04)**, not native Windows Python — confirmed
  by checking `backend/GENMO/.venv`'s `pyvenv.cfg` (`home = /usr/bin`) and that its `bin/python3.10`
  is a symlink to `/usr/bin/python3.10`. The task's action is `wsl.exe -d Ubuntu-22.04 bash
  /mnt/c/Users/Admin/repos/APeX/backend/server/run_worker_drain.sh` — verified the repo is
  reachable at that `/mnt/c/...` path and that `nvidia-smi` sees the GPU from inside the distro
  before wiring this up, rather than assuming it.
- Settings: `WakeToRun` (survives sleep), `StartWhenAvailable` (catches up if a trigger was missed
  while asleep), `RestartCount 3` / `RestartInterval 5 min` (the restart-on-failure rule),
  `MultipleInstances IgnoreNew` (Task Scheduler's own overlap guard, on top of the script's flock).

**One deviation from the original plan, and why**: the task is registered with logon type
`Interactive` ("run only when logged on"), not `Password`/`S4U` ("run whether logged on or not") —
registering the latter requires an elevated (Administrator) PowerShell session, which wasn't
available in the session that built this. Practically this still covers the common case (a locked
screen still counts as "logged on" in Windows terms, and `WakeToRun` still wakes the machine from
sleep as long as you haven't fully signed out) — it just won't fire if you fully log out or reboot
to the sign-in screen and leave it there. **If you want the stronger guarantee**, open PowerShell
*as Administrator* and run:
```powershell
$p = New-ScheduledTaskPrincipal -UserId "DESKTOP-0P6RBN4\Admin" -LogonType S4U -RunLevel Limited
Set-ScheduledTask -TaskName "APeX Worker Drain" -Principal $p
```
- **Verified end-to-end, directly (bypassing Task Scheduler to get an unambiguous result)**: WSL
  launches, the venv activates, and all five models load successfully (GEM, YOLO, ViTPose-H, HMR2,
  SMPL-X — ~80-86s total, matching the documented one-time cost). It then correctly reaches the
  polling loop and correctly fails on the expected thing — `backend/server/.env` still has blank
  credentials, so `fetch_queued_jobs` raises "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be
  set."
- **Real bug found and fixed by this test**: the first version of `--drain` only exited on an
  *empty* queue, not on a *failed* fetch — a persistent error (bad credentials, Supabase
  unreachable) retried every 3 seconds forever instead of exiting, which would have hung for the
  full 4-hour execution limit on every single 30-min trigger. Fixed: in drain mode, 3 consecutive
  fetch failures now exit with a non-zero code (so Task Scheduler's restart-on-failure actually
  kicks in) instead of retrying indefinitely; continuous/manual mode is unchanged (still retries
  forever, which is correct there). Re-ran after the fix: now exits cleanly in ~90s instead of
  hanging. Also switched the wrapper to `python -u` — the first test's log was empty for several
  minutes because Python block-buffers stdout when it's not a TTY, which made a genuinely-running
  process look stuck; unbuffered output means `worker_run.log` now reflects real-time progress.
- **Still needed from you**: fill in `backend/server/.env`, then trigger it once more (`Start-
  ScheduledTask -TaskName "APeX Worker Drain"` or just re-run `run_worker_drain.sh` directly) and
  confirm `worker_run.log` shows real job(s) completing before trusting the unattended cadence
  overnight.

Free cloud-hosting alternatives (Modal, an on-demand GPU VM) were researched and are viable later,
but not needed for this phase — see the research/decision context preserved below.

This cadence is **sufficient for beta** (internal TestFlight has no Apple review at all; external
TestFlight's Beta App Review is meaningfully looser than full review and unlikely to scrutinize a
30-min processing window) — the app's own Processing-tab/push-notification UX already makes
"check back later" read as intentional, not broken. Just tell beta testers up front (release
notes or the beta description) that analysis can take up to ~30 minutes.

**Still open**: this decision does **not** extend to full App Store Review (the stricter,
one-sitting-completeness gate below) — revisit then, most likely by pairing the 30-min cadence
with the demo-account + reviewer-notes approach (options 2/3 below) rather than relying on the
cadence alone during a reviewer's live test.

---

<details>
<summary>Original research and full reasoning (kept for the full-review decision later)</summary>

This is worth being blunt about, since it's the part of your plan most likely to actually sink a
submission.

Apple's reviewers install and use your app like a real user, in one sitting, and Guideline 2.1
(App Completeness) is explicit: if a core flow doesn't work *for them, when they try it*, that's
a rejection — "App is not fully functional," or "we were unable to review your app in a
reasonable timeframe." Research on this guideline confirms backend unavailability during review
is one of the most common causes of a 2.1 rejection, and it's over 40% of all unresolved review
issues industry-wide. Your app's **entire value proposition** is record → upload → see analyzed
result. If a reviewer records a test video and your worker doesn't happen to run again for
another 10 hours, from their side the app just... never finishes. That reads exactly like a
broken/hanging app, not a slow one.

**You have three real options, not mutually exclusive:**

1. **Run the worker continuously (or on a tight schedule, e.g. every 15-30 min via Windows Task
   Scheduler) at least during the review window**, and ideally for the first few weeks post-launch
   while you still have limited signal on real-world usage patterns and Apple hasn't
   established trust in your app yet. This is the only option that makes the *actual* user
   experience good, not just the review experience — real users hitting a 10-hour wait will
   churn regardless of what Apple thinks.
2. **Give App Review a working demo account with pre-populated, already-completed sessions**
   (App Store Connect has an "App Review Information" section specifically for demo
   credentials). This lets the reviewer *see* the finished feature without needing your worker to
   process anything live during their session — but it does **not** protect you if the reviewer
   also tries the record-a-new-video flow (which they often do, since it's clearly the app's main
   CTA), so it should be paired with option 3.
3. **Add reviewer notes** (same "App Review Information" section, free-text field) explicitly
   explaining the processing model: *"Video analysis is asynchronous and can take up to a few
   hours; a demo account with completed results is provided above so this can be evaluated
   without waiting. In-app, the Processing tab clearly shows queued/processing state."* Reviewers
   do read this field, and it measurably reduces (though doesn't eliminate) 2.1 confusion-driven
   rejections.

My recommendation: **don't ship the "1-2x/day" cadence for the initial submission and the first
stretch of real usage.** Automate the worker to run frequently (even a simple loop with a few
minutes' sleep, kicked off when your PC is on) until you have a sense of real demand and either
move to something always-on or have evidence that occasional processing windows are acceptable
to your actual users. This is a recommendation, not something I've assumed you'll do — it's your
call, but it's the highest-leverage single decision in this whole plan.

</details>

### 2.2 Health/fitness "risk" framing may draw enhanced scrutiny (Guideline 1.4.1 / 5.1.3) — ✅ **Done**

Researched Apple's actual guidance before writing the disclaimer (see sources at the end of this
entry) — the consistent takeaway: a disclaimer alone doesn't reclassify a health-adjacent app,
but it's still standard, expected practice, and combined with removing risk-framed wording (below)
it substantially lowers the odds of enhanced-scrutiny follow-up. One cautionary data point from
developer forums: at least one developer's "wellness-only" disclaimer wasn't enough to avoid a
1.4.1 flag on its own — so this mitigates, it doesn't guarantee.

**Disclaimer added in two places**, matching the standard pattern for fitness apps (visible
before/at account creation, plus persistently reachable afterward — not a hard gate/checkbox,
since Apple's own language is about "reminding" users, not requiring explicit consent for a
non-diagnostic wellness app):
- `SignUpScreen.tsx` — a condensed version shown directly above the submit button, the same
  placement convention as a "by continuing you agree to..." terms line.
- `SettingsScreen.tsx` (athlete) and `ManagerSettings.tsx` (manager) — a new "ABOUT" section
  with the full disclaimer text, permanently reachable, not just seen once at signup.

Full text used in Settings: *"APeX provides training feedback based on computer-vision movement
analysis — pose estimation, balance, and range of motion. It is not a medical device, is not a
diagnostic tool, and is not a substitute for professional medical advice. Consult a physician
before beginning any exercise program."*

Also **done previously** in this same effort: reworded every user-facing string that framed the app as medical/diagnostic or
injury-risk-assessing, across both analysis pipelines (the live on-device path and the
server-rendered biomechanics report), found via a full audit rather than a spot-check:
- Login screen tagline: "Injury prevention" → "Balance and range insights".
- Readiness bands (shown on the gauge in both `exerciseAnalyzer.ts` and
  `BiomechanicsReport.tsx`): "Ready" / "Caution" / "High Risk" → "Good" / "Fair" / "Low" — same
  numeric thresholds and color logic, purely relabeled to describe the *number*, not assess risk.
- Per-factor status pill (`RiskFactorRow.tsx`): "RISK" → "LOW".
- Corrective-exercise card (`PhysioCard.tsx`) header: "RECOMMENDED CORRECTIVE" → "SUGGESTED
  DRILL".
- Exercise rationale copy (`physioLibrary.ts`): removed "re-injury risk," "ACL strain," and
  "injury risk" phrasing from the two entries that had it, replaced with plain mechanical
  descriptions (uneven load-sharing, impact force through the joint) — the underlying coaching
  content and thresholds are unchanged, only the framing.
- Confirmed backend Python (`backend/GENMO/scripts/biomechanics/*.py`) never sends its
  research-citation/clinical-language fields (`research`, `description`) to the client at all —
  those only exist in code-level dataclasses, never serialized into `analysis_json` — so no
  backend change was needed there.

**Still worth doing, not code**: get real legal language reviewed if this app is ever marketed
with explicit health claims — the disclaimer text above is not legal advice. Also worth adding
the same disclaimer language to the App Store Connect app description itself (Phase D, item 19)
once you're writing that copy, since Apple's guidance specifically calls out the description as a
place this reminder should live, not just in-app.

Sources consulted: [Apple App Store Requirements For Health Apps](https://blog.dashsdk.com/app-store-requirements-for-health-apps/),
[Guideline 1.4.1 — Safety - Physical Harm (Apple Developer Forums)](https://developer.apple.com/forums/thread/779857),
[Clarification needed: wellness-only app still flagged as medical (Apple Developer Forums)](https://developer.apple.com/forums/thread/807508),
[App Review Guidelines (Apple Developer)](https://developer.apple.com/app-store/review/guidelines/).

### 2.3 Sign in with Apple — ✅ **N/A, confirmed not required** — worth stating explicitly so it doesn't get "fixed" unnecessarily later

Checked `mobile/src/api/auth.ts`: the app only offers Supabase email/password
(`signInWithPassword`/`auth.signUp`), no Google/Facebook/other third-party OAuth. Apple's rule
(Guideline 4.8) only requires an Apple/privacy-preserving login *alternative* when you **do**
offer a third-party login service — an app using solely its own account system is exempt. No
action needed here. Just don't add "Sign in with Google" later without also adding Sign in with
Apple in the same release.

### 2.4 Requesting microphone permission for a silent, pose-only analysis pipeline — ✅ **Done**

Turned out to need more than the originally-anticipated `app.json` edit. Fixed at every layer
that actually contributed it:
- Removed `NSMicrophoneUsageDescription`, Android's `RECORD_AUDIO` permission, and the
  `expo-camera` plugin's `microphonePermission`/`recordAudioAndroid` config from `app.json`.
- Removed a live `requestMicPerm()` call in `LiveCamera.native.tsx` that was actively prompting
  for microphone access at recording time, despite recording always being muted (`mute: true`).
- Discovered — by actually running `expo prebuild` and inspecting the generated
  `AndroidManifest.xml`, not just editing config and assuming it worked — that `expo-camera`'s
  *compiled Android module* bundles `RECORD_AUDIO` in its own native manifest unconditionally,
  and `expo-av` (used legitimately for video playback/sound effects elsewhere in the app) does
  the same by default. Neither is controllable via `app.json` plugin options alone. Fixed with a
  small local config plugin (`mobile/plugins/withoutRecordAudio.js`) that adds the standard
  Android manifest-merger `tools:node="remove"` override, and an explicit `expo-av` plugin entry
  (`{"microphonePermission": false}`). Re-verified against a fresh `expo prebuild` output that
  the permission is actually gone from the generated manifest, not just from `app.json`.

### 2.5 `userInterfaceStyle: "light"` on an app that's entirely dark-navy-themed — ✅ **Done**

Changed to `"dark"` in `app.json`, matching what the app actually always looks like.

---

## 3. Step-by-step plan

### Phase A — Apple account & project setup (can start today, in parallel with code work)

1. ✅ Enroll in the **Apple Developer Program** ($99/yr) — confirmed active.
2. ✅ Register the `com.apexathletics.app` bundle identifier — done manually in Certificates,
   Identifiers & Profiles, with the Push Notifications capability enabled.
3. 🔴 In App Store Connect, create the app record: name, primary language, bundle ID (`com.
   apexathletics.app`, per §1.3), SKU.

### Phase B — Required code/config changes (this is the "fix the blockers" phase)

4. ✅ Implement account deletion end-to-end (§1.1) — done, deployed, verified.
5. ✅ Fill in `app.json` + `eas.json` (§1.3) — done.
6. ✅ Mic-permission removal (§2.4) — done, including the native-manifest layer.
7. ✅ Fix `userInterfaceStyle` (§2.5) — done.
8. ✅ Privacy Policy (§1.4) — drafted, contact info filled, hosted via GitHub Pages, linked from
   signup + both Settings screens. Only remaining piece is enabling Pages itself (your GitHub
   account) and an optional lawyer review.
9. ✅ Health/fitness risk framing (§2.2) — risky wording removed app-wide, disclaimer added at
   signup and in both Settings screens.
10. ✅ Worker cadence (§2.1) — built: local PC, Windows Task Scheduler every 30 min via WSL2,
    draining whatever's queued. Sufficient for internal/external TestFlight; revisit before full
    App Store Review (stricter one-sitting-completeness bar). **You still need to**: fill in
    `backend/server/.env` and run it once manually to confirm end-to-end before trusting the
    unattended cadence.

### Phase C — Build & internal testing — 🔴 not started

11. `eas login`, then `eas build --platform ios --profile production` (or `preview` first for
    your own device testing via ad-hoc distribution). `eas.json` profiles are ready for this now.
12. Set up push notification credentials: run through EAS's prompt to generate an APNs key when
    building (or `eas credentials`) — required for `expo-notifications` to actually deliver in a
    production/TestFlight build; it silently no-ops in Expo Go and did during this whole dev
    cycle, so **this is the first time it'll be truly exercised** — test it for real on a
    TestFlight build before assuming it works. Still not exercised.
13. `eas submit --platform ios` to push the build to App Store Connect / TestFlight (or
    `eas build --auto-submit`).
14. Install via TestFlight on a real device. Walk the **entire** golden path yourself, on a
    connection that isn't your dev machine's local network: sign up as a teamless athlete, record
    a video, confirm upload, background the app, wait for your worker to actually process it (run
    the worker for real during this test), get the push notification, save it, check History,
    check the Routine tab, check Overview's readiness trend and routine table. This is the first
    time in the whole project this flow will have run against a *real, signed, production* build
    rather than a dev client — assume something will surface that Expo Go / dev builds hid (this
    is a common source of last-minute surprises, e.g. permission prompts behaving differently,
    push tokens, deep links).
15. Test account deletion for real, on this build. The Edge Function itself has been reviewed
    carefully and matches the schema's FK cascade behavior exactly, but it has **not** been
    exercised against a real TestFlight build end-to-end yet — confirm the data is actually gone
    in Supabase afterward, not just that the button doesn't error.

### Phase D — App Store Connect metadata — 🔴 not started

16. App Privacy questionnaire (the "nutrition label"): declare **User Content** (the recorded
    videos — "Data Linked to You," since they're tied to an account) and **Health & Fitness**
    data (derived readiness/rep/joint data). Be accurate, not minimal — Apple has rejected apps
    for mismatches between the declared label and actual app behavior discovered during review.
    Declare Supabase as a data processor if the flow in App Store Connect asks for that level of
    detail. The Privacy Policy (§1.4) is written to support answering this accurately once it's
    hosted.
17. Age rating questionnaire.
18. Screenshots for the required device sizes (currently the largest iPhone size, 6.9"/6.7"
    class, is mandatory at minimum — check current App Store Connect requirements at submission
    time, this changes periodically).
19. App description, keywords, support URL, marketing URL (support URL is mandatory; marketing
    URL is optional).
20. Privacy Policy URL — `https://danzlotnikov.github.io/APeX/privacy-policy.html`, live once
    GitHub Pages is enabled (§1.4).
21. "App Review Information": demo account credentials + the reviewer notes from §2.1 option 3.

### Phase E — Submit — 🔴 not started

22. Select the TestFlight build you tested in Phase C, attach it to the version, submit for
    review.
23. **Keep your worker running (or on a tight automated cadence) for the entire review window**
    — typically 24-48 hours currently, but budget for it taking longer, and don't turn the
    automation back off the moment it's approved either — real users will hit the exact same
    "is this broken?" perception problem your reviewer would have.

---

## 4. Supabase/backend-specific items not covered above

- **RLS is now your entire security boundary** for a production, public app — the "assume a
  hostile client" pass this item called for is ✅ **done**: see `SECURITY_APP_STORE_AUDIT.md` at
  the repo root for the full write-up. Found and fixed a critical privilege-escalation hole
  (`profiles.role`/`team_id` were client-updatable) and a critical IDOR/path-traversal hole
  (`video_jobs.raw_video_path` reaching a service-role Storage call unsanitized), plus several
  lower-severity issues. Migration `019_security_hardening.sql` is confirmed run against the live
  project (2026-07-28) — the DB-level fixes are live. Still open: two dev Supabase Auth accounts
  need deleting/rotating — called out in that document.
- **Storage bucket `exercise-videos` is private** (confirmed) — good, keep it that way; signed
  URLs are the only access path, which is correct for user video content.
- **Video upload size/data cost**: raw clips upload over the user's own connection before your
  worker ever sees them — no action needed architecturally, but consider mentioning expected
  data usage somewhere in onboarding if clips can be large, especially since cellular uploads of
  20-second 4K-ish clips aren't trivial.
- **Orphaned `video_jobs` rows**: flagged earlier this session and still unresolved — a worker
  killed mid-job leaves a row permanently stuck at `status='processing'` (never reclaimed, since
  `claim_job`'s compare-and-swap only matches `status='queued'`). Low priority relative to the
  blockers above, but worth fixing before you're relying on this system for real users, since a
  manually-run worker is *more*, not less, likely to be interrupted mid-job than an always-on one.

## 5. What does NOT need to change

Worth stating plainly so nothing gets "fixed" that isn't broken:
- The Supabase-mediated, no-public-backend architecture itself — sound, no Apple objection to it.
- Email/password-only auth — no Sign in with Apple needed (§2.3).
- The service-role key handling — already correct (§1.2), just don't regress it.
- Realtime/Storage/RLS design generally — this session's extensive bug-fixing work already
  brought this to a solid, production-plausible state; this plan is about *App Store* readiness
  specifically, not a re-litigation of the whole architecture.
- Account deletion (§1.1), `app.json`/`eas.json` (§1.3), the Privacy Policy (§1.4), the
  microphone permission (§2.4), the health/fitness disclaimer and risk-framing wording (§2.2),
  and `userInterfaceStyle` (§2.5) — all done and verified; don't re-open these unless something
  actually regresses.

## 6. What's left, in the order it actually needs to happen

Phase B is fully done/built — nothing left blocking Phase C.

1. **You**: `Enable-ScheduledTask -TaskName "APeX Worker Drain"` whenever you want the 30-min
   cadence running again (§2.1) — it's built, credentialed, and verified; just currently disabled
   by request.
2. **You**: Apple Developer Program enrollment + registering the bundle ID (Phase A) — gates
   everything after it, has the least predictable timeline, worth starting in parallel with 1.
3. Then Phase C onward (build, TestFlight, metadata, submit) — none of it started yet.
4. **Before full App Store Review specifically** (not before beta): revisit §2.1 — pair the
   30-min cadence with a demo account + reviewer notes (options 2/3 in that section) rather than
   relying on the cadence alone during a reviewer's live test.
