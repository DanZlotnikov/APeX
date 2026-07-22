# APeX · App Store Submission Plan

Status: **in progress — most of §1 (hard blockers) is now implemented.** Originally written as
planning-only; updated after several follow-up sessions that implemented account deletion,
`app.json`/`eas.json`, the Privacy Policy draft, and the microphone-permission removal. Every
item below is now tagged ✅ **Done**, 🟡 **Partial / needs a decision**, or 🔴 **Not started** so
this doc stays a reliable single source of truth for what's actually left — update the tag
whenever you change something, don't just add new prose underneath stale tags.

## Current status at a glance

| # | Item | Status |
|---|---|---|
| 1.1 | In-app account deletion | ✅ Done — Edge Function deployed, UI live in both Settings screens |
| 1.2 | Service-role key isolation | ✅ Done — re-verified against the actual built bundle, not just source |
| 1.3 | `app.json` / `eas.json` fields | ✅ Done — bundle IDs, icon, version strategy all set |
| 1.4 | Privacy Policy | 🟡 Partial — drafted and accurate, **not yet hosted at a public URL**, 2 fields still unfilled |
| 2.1 | Worker cadence during review | 🔴 Not started — still manual 1-2x/day, still the single biggest risk |
| 2.2 | Health/fitness disclaimer copy | 🔴 Not started — no in-app disclaimer exists yet |
| 2.3 | Sign in with Apple | ✅ N/A — confirmed still not required, no change needed |
| 2.4 | Unnecessary microphone permission | ✅ Done — removed at every layer, including one not originally anticipated |
| 2.5 | `userInterfaceStyle` light/dark mismatch | 🔴 Not started — still a one-line fix sitting untouched |
| Phase C/D/E | Build, TestFlight, metadata, submit | 🔴 Not started |

**The three things standing between here and submission, in order:** finish the Privacy Policy
(host it, fill in contact info — 30 minutes of your own time, nothing left for me to do), decide
the worker-cadence approach (§2.1 — this is a product decision, not code), then knock out the two
remaining one-line/one-paragraph fixes (§2.2, §2.5) before starting Phase C.

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

### 1.4 Privacy Policy — 🟡 **Drafted, not yet publishable as-is**

`PRIVACY_POLICY.md` is written and accurate to the app's real behavior (verified against actual
code, not assumed): what's collected (account info, optional profile fields, muted video-only
recordings, derived readiness/balance/ROM data, injury status, push tokens), that Supabase/Expo
are named sub-processors, that a coach/manager can see their team athletes' data (and an
individual athlete's data is visible to no one else), retention and the real account-deletion
mechanism from §1.1, and a 13+ children's-privacy clause matching how signup actually works
(direct self-registration, no age gate). Also published as a shareable Artifact with a design
pass (branded, both light/dark themes, section-jump navigation) for easy review.

**Two things you still need to do before this can go live**:
1. Fill in Section 11 ("Contact Us") — a real support/privacy email and your developer/legal
   entity name. Left as visibly-flagged placeholders rather than guessed, since fabricating
   contact info in a legal document is worse than an obvious blank.
2. **Host it at a public URL** — App Store Connect requires a Privacy Policy *URL* in metadata,
   not just a document. The Artifact link is private by default (shareable from its own page, or
   you can host the Markdown/HTML anywhere else you prefer — GitHub Pages, your own site, etc.).

Also recommended, stated in the document itself: have a lawyer review it before publishing,
especially for GDPR/CCPA-specific language if you'll operate in the EU/UK or California.

---

## 2. Serious risks — not automatic rejections, but genuinely likely to cause one

### 2.1 Manually running the backend 1-2x/day, during App Review — 🔴 **Not started — still the single biggest risk here**

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

### 2.2 Health/fitness "risk" framing may draw enhanced scrutiny (Guideline 1.4.1 / 5.1.3) — 🔴 **Not started**

No in-app disclaimer exists yet — the Privacy Policy (§1.4) touches on it briefly for the injury
flag specifically ("does not constitute medical advice or a diagnosis"), but that's not the same
as the dedicated, reachable-from-the-main-flow disclaimer this section recommends. Still open.

Your own biomechanics code — confirmed by reading `backend/GENMO/scripts/biomechanics/` — is
explicitly framed around clinical/injury-risk literature: `at_risk` joint-check severity,
research citations like *"ACL return-to-sport... >10-15% deficit = elevated re-injury risk,"*
and a "READINESS" score presented to the athlete as Ready/Caution/High Risk. That's legitimate,
well-researched sports-science work — but to Apple's review process, it reads as exactly the
kind of health-measurement/injury-risk claim that Guideline 1.4.1 says must "clearly disclose
data and methodology" and that gets "enhanced review scrutiny" once an app is categorized as
Health & Fitness.

This is very unlikely to be an outright rejection on its own, but it raises your odds of a
reviewer asking follow-up questions or requesting substantiation. Mitigate with:
- A clear, visible disclaimer somewhere reachable from the main flow (e.g., Settings/About, and
  ideally a one-time acknowledgment at signup): *"APeX provides training feedback based on
  computer-vision movement analysis. It is not a medical device, is not a diagnostic tool, and
  is not a substitute for professional medical advice. Consult a physician before beginning any
  exercise program."*
- Keep this disclaimer's existence in mind, not necessarily its exact wording — get real legal
  language if this app is going to be marketed with health claims at all, this is not legal
  advice.

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

### 2.5 `userInterfaceStyle: "light"` on an app that's entirely dark-navy-themed — 🔴 **Not started**

Still exactly as originally described — a one-line fix (`"dark"` instead of `"light"` in
`app.json`) that hasn't been made yet. Cheap to do whenever; low severity, pure polish.

---

## 3. Step-by-step plan

### Phase A — Apple account & project setup (can start today, in parallel with code work)

1. 🔴 Enroll in the **Apple Developer Program** ($99/yr) if not already done — individual
   enrollment is usually same-day to a couple of days; organization enrollment (needs a D-U-N-S
   number) can take substantially longer. **Start this first**, since it gates everything else
   and has the least predictable timeline. *(Only you can do this — it's your Apple account.)*
2. 🔴 In App Store Connect, create the app record: name, primary language, bundle ID (`com.
   apexathletics.app`, per §1.3), SKU.
3. 🔴 Register the `com.apexathletics.app` bundle identifier in your Apple Developer account
   (Certificates, Identifiers & Profiles) — decided and set in code (§1.3), just not yet
   registered with Apple. Cannot be changed later without a new App Store listing.

### Phase B — Required code/config changes (this is the "fix the blockers" phase)

4. ✅ Implement account deletion end-to-end (§1.1) — done, deployed, verified.
5. ✅ Fill in `app.json` + `eas.json` (§1.3) — done.
6. ✅ Mic-permission removal (§2.4) — done, including the native-manifest layer.
7. 🔴 Fix `userInterfaceStyle` (§2.5) — one-line change, still not done.
8. 🟡 Privacy Policy (§1.4) — drafted and accurate; still needs hosting at a public URL and the
   two contact-info fields filled in. Also still worth linking from the sign-up screen once
   hosted (not yet done).
9. 🔴 Add the health-disclaimer copy (§2.2) somewhere reachable in the app — not started.
10. 🔴 Decide your worker-cadence approach for launch (§2.1) and, if changing it from manual
    1-2x/day, build whatever minimal automation you land on — not started, still the biggest
    open risk in this whole plan.

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
20. Privacy Policy URL — ready to fill in once §1.4's two remaining items are done.
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

- **RLS is now your entire security boundary** for a production, public app — it already looks
  well-built from this session's work (every table's policies were built and iterated on
  deliberately, and the new `team_routines`/`athlete_exercise_assignments` tables added since this
  plan was written follow the same established manager/athlete visibility pattern as everything
  else), but this is worth one dedicated pass specifically framed as "assume a hostile client with
  only the anon key" before launch, not just "does the happy path work." Still not done as a
  distinct pass.
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
- Account deletion (§1.1), `app.json`/`eas.json` (§1.3), and the microphone permission (§2.4) —
  all done and verified; don't re-open these unless something actually regresses.

## 6. What's left, in the order it actually needs to happen

1. **You**: fill in Privacy Policy contact info + host it publicly (§1.4) — the only remaining
   piece of that item, nothing left for me to draft.
2. **You**: decide the worker-cadence approach for launch (§2.1) — a product call, not code; tell
   me what you land on and I can help build whatever automation it needs.
3. **Either of us, quick**: `userInterfaceStyle` fix (§2.5) and the health-disclaimer copy (§2.2)
   — both small, both still open.
4. **You**: Apple Developer Program enrollment + registering the bundle ID (Phase A) — gates
   everything after it, has the least predictable timeline, worth starting in parallel with 1-3.
5. Then Phase C onward (build, TestFlight, metadata, submit) — none of it started yet.
