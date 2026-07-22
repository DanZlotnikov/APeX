# APeX · App Store Submission Plan

Status: **planning only — no code has been changed as part of this document.**
Written after a full read of the current codebase (`mobile/`, `backend/`, `supabase/`) plus
research into current Apple App Store Review Guidelines, privacy-manifest requirements, and
common rejection causes for Expo/Supabase-backed apps. Where a code change is required, it's
described precisely (file, what, why) but **not applied** — that's a follow-up task once you've
seen this plan.

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

### 1.1 In-app account deletion (Guideline 5.1.1(v)) — **not implemented, required**

Confirmed via code search: there is no account-deletion path anywhere in `mobile/src`. Any app
that lets a user create an account (this one does — `signUpAthlete`/`signUpManager` in
`mobile/src/api/auth.ts`) **must** let them delete it from inside the app, not just deactivate
it. This has been enforced since June 2022; it is not a courtesy feature, it's a review gate.

**What "delete" has to actually do**, per your schema: remove (or fully anonymize) the
`auth.users` row, `profiles`, `athlete_profiles`, `sessions`, `session_metrics`,
`athlete_routines`, `video_jobs`, and the athlete's Storage objects — i.e., a real data deletion,
not a soft flag.

**Why this can't be a plain client-side RPC like your other mutations**: deleting an
`auth.users` row requires Supabase's **admin** API (`supabase.auth.admin.deleteUser`), which
needs the **service-role key** — the same key that must never ship in the app bundle (see §1.2).
The client can't do this call directly, safely.

**Recommended implementation** (documenting, not building yet):
1. A new **Supabase Edge Function** (`delete-account`), deployed with the service-role key as a
   secret (Edge Functions run server-side inside Supabase, not on your PC or in the app — this is
   the one piece of "backend" that should live in Supabase itself, since it needs to work even
   when your PC is off).
2. The function: verifies the caller's JWT (Supabase gives you the authenticated user for free
   in an Edge Function), deletes the athlete's rows in dependency order (or relies on your
   existing `ON DELETE CASCADE`s — `athlete_profiles`, `sessions`, `session_metrics`,
   `athlete_routines`, `video_jobs` already cascade from `profiles`/`auth.users` per your
   migrations, so deleting `auth.users` via the admin API should cascade the rest automatically —
   **verify this against every table**, particularly ones added later like `athlete_routines`),
   removes the athlete's Storage objects (`raw/{id}/*`, `processed/{id}/*`), then calls
   `supabase.auth.admin.deleteUser(userId)`.
3. A "Delete Account" row in `SettingsScreen.tsx`, gated behind a confirmation dialog (you
   already have `ConfirmDialogHost`/`utils/confirm.ts` for this pattern), calling the Edge
   Function and then signing the client out / returning to the login screen.
4. Decide what happens to a **manager's** team when they delete their account (orphaned team? Or
   require the manager to transfer/delete the team first?) — a real product decision, not just
   plumbing.

This is a non-trivial feature (new Edge Function + new UI + a real decision about team
ownership), not a checkbox — budget real time for it.

### 1.2 Confirm the service-role key never ships in the client bundle

**Verified safe right now**: `SUPABASE_SERVICE_ROLE_KEY` in `mobile/.env` is **not**
`EXPO_PUBLIC_`-prefixed, so Expo does not inline it into the JS bundle (only `EXPO_PUBLIC_*` vars
get baked into what ships). Grepped `mobile/src` for any reference to it — none found. The
backend worker reads it from a real OS environment variable at process launch
(`SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python supabase_worker.py`), never from a
committed file. `.env` itself is gitignored and confirmed **not tracked** in git history.

**This is good — but it's exactly the kind of thing that regresses silently.** Add this as a
standing rule for every future session/PR: *never* add `EXPO_PUBLIC_` in front of the service
key, and never let a mobile-side file read `process.env.SUPABASE_SERVICE_ROLE_KEY`. If you build
the account-deletion Edge Function from §1.1, that's the **only** place besides your own worker
process that should ever see this key.

### 1.3 `app.json` is missing fields EAS Build requires for a production submission

Current `mobile/app.json` has no `ios.bundleIdentifier`, no `android.package`, no app `icon`, and
no explicit `ios.buildNumber`/`android.versionCode`. `expo-camera` and `expo-notifications` are
plugin-configured correctly, but the build itself can't be produced without these:

- `expo.ios.bundleIdentifier` — e.g. `"com.yourcompany.apex"` (must match what you register in
  App Store Connect / your Apple Developer account; reverse-DNS, can't be changed later without
  creating a new app).
- `expo.android.package` — same idea, only relevant if/when you also target Android, but cheap to
  set now.
- `expo.icon` — a 1024×1024 PNG; without it EAS Build will fail (or generate a placeholder you
  don't want live).
- Version numbering — either set `ios.buildNumber` manually per build, or use EAS's
  `cli.appVersionSource: "remote"` + `eas build --auto-increment` so it's handled for you. Decide
  once, don't mix strategies.
- `eas.json` doesn't exist yet — created by running `eas build:configure` (defines build
  profiles: `development`, `preview`, `production`).

### 1.4 No Privacy Policy anywhere (required field in App Store Connect, and best practice in-app)

App Store Connect **will not let you submit** without a Privacy Policy URL in the app's metadata.
Grepped the app for any privacy/terms reference — none exists, in-app or otherwise. Given this
app records video of the athlete's body, stores biomechanical/fitness data, and creates
identifiable accounts, this needs to be a real, accurate document, not boilerplate — it has to
actually describe: what's collected (video, derived pose/joint data, exercise counts, readiness
scores, email, name, height/weight if provided), that it's stored in Supabase (a sub-processor,
name it), that raw video currently also transits your own PC for processing, retention (does a
discarded/failed video's data really get deleted? — yes, per your Storage RLS/RPCs, good, say
so), and how a user deletes their data (link back to §1.1's feature). This can be a simple static
page (GitHub Pages, Notion public page, etc.) — it doesn't need to be fancy, but it needs to be
**true**, since Apple's privacy nutrition label (see §3.3) has to match what the policy says.

---

## 2. Serious risks — not automatic rejections, but genuinely likely to cause one

### 2.1 Manually running the backend 1-2x/day, during App Review — **the single biggest risk here**

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

### 2.2 Health/fitness "risk" framing may draw enhanced scrutiny (Guideline 1.4.1 / 5.1.3)

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

### 2.3 Sign in with Apple — confirmed **not required** for you, worth stating explicitly so it doesn't get "fixed" unnecessarily later

Checked `mobile/src/api/auth.ts`: the app only offers Supabase email/password
(`signInWithPassword`/`auth.signUp`), no Google/Facebook/other third-party OAuth. Apple's rule
(Guideline 4.8) only requires an Apple/privacy-preserving login *alternative* when you **do**
offer a third-party login service — an app using solely its own account system is exempt. No
action needed here. Just don't add "Sign in with Google" later without also adding Sign in with
Apple in the same release.

### 2.4 Requesting microphone permission for a silent, pose-only analysis pipeline

`app.json` requests `NSMicrophoneUsageDescription`/Android `RECORD_AUDIO`, and the description
text implies audio is actually used ("Audio is recorded alongside the movement video"). Nothing
in the GEM/pose pipeline reads or uses audio at all — it's 100% visual. Requesting a permission
you don't use is a real (if minor) Guideline 5.1.1 smell ("apps should only request access to
data relevant to the core functionality"), and it's one more permission prompt in the way of a
new user's first recording. Recommended fix (documented, not applied): record video **muted**
(expo-camera supports disabling audio capture) and drop the microphone permission/description
entirely, unless you have a concrete future use for audio.

### 2.5 `userInterfaceStyle: "light"` on an app that's entirely dark-navy-themed

`app.json` sets `"userInterfaceStyle": "light"`, but every screen in this app (per `theme.ts`
and every screen file) is a fixed dark navy (`#07101C`) design — not actually responsive to
system light/dark mode at all. This mismatch can cause native OS chrome (system alerts, the
keyboard, activity indicators, share sheets) to render in light styling against your dark app,
which looks unpolished and is an easy, cheap fix: set this to `"dark"` to match what the app
actually always looks like (simplest correct fix, since the app doesn't currently support a real
light mode), or build real light/dark support if that's ever wanted. Low severity, pure polish,
but free to fix.

---

## 3. Step-by-step plan

### Phase A — Apple account & project setup (can start today, in parallel with code work)

1. Enroll in the **Apple Developer Program** ($99/yr) if not already done — individual
   enrollment is usually same-day to a couple of days; organization enrollment (needs a D-U-N-S
   number) can take substantially longer. **Start this first**, since it gates everything else
   and has the least predictable timeline.
2. In App Store Connect, create the app record: name, primary language, bundle ID (must match
   what you decide in §1.3), SKU.
3. Decide and register the real `bundleIdentifier` — you cannot change it later without creating
   a new App Store listing from scratch.

### Phase B — Required code/config changes (this is the "fix the blockers" phase)

Do these in whatever order suits you, but none of them can be skipped:

4. Implement account deletion end-to-end (§1.1): Edge Function + Settings UI + verify cascade
   deletes cover every table, including newer ones (`athlete_routines`) that postdate the
   original schema.
5. Fill in `app.json`: `bundleIdentifier`, `android.package`, `icon`, version/build numbering
   strategy. Run `eas build:configure` to generate `eas.json`.
6. Decide on and implement the mic-permission removal (§2.4) if you agree with the
   recommendation, or leave it and be ready to justify it if asked.
7. Fix `userInterfaceStyle` (§2.5) — one-line change.
8. Write the real Privacy Policy (§1.4) and host it somewhere stable; add its URL to
   `app.json`'s… actually App Store Connect metadata (not an app.json field) — just make sure you
   have the URL ready for Phase D. Consider also linking it from the sign-up screen.
9. Add the health-disclaimer copy (§2.2) somewhere reachable in the app.
10. Decide your worker-cadence approach for launch (§2.1) and, if you're changing it from manual
    1-2x/day, build whatever minimal automation you land on (even a simple scheduled task running
    the existing `supabase_worker.py` on a loop — no architecture change needed, just cadence).

### Phase C — Build & internal testing

11. `eas login`, then `eas build --platform ios --profile production` (or `preview` first for
    your own device testing via ad-hoc distribution).
12. Set up push notification credentials: run through EAS's prompt to generate an APNs key when
    building (or `eas credentials`) — required for `expo-notifications` to actually deliver in a
    production/TestFlight build; it silently no-ops in Expo Go and did during this whole dev
    cycle, so **this is the first time it'll be truly exercised** — test it for real on a
    TestFlight build before assuming it works.
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
15. Test account deletion for real, on this build. Confirm the data is actually gone in Supabase
    afterward, not just that the button doesn't error.

### Phase D — App Store Connect metadata

16. App Privacy questionnaire (the "nutrition label"): declare **User Content** (the recorded
    videos — "Data Linked to You," since they're tied to an account) and **Health & Fitness**
    data (derived readiness/rep/joint data). Be accurate, not minimal — Apple has rejected apps
    for mismatches between the declared label and actual app behavior discovered during review.
    Declare Supabase as a data processor if the flow in App Store Connect asks for that level of
    detail.
17. Age rating questionnaire.
18. Screenshots for the required device sizes (currently the largest iPhone size, 6.9"/6.7"
    class, is mandatory at minimum — check current App Store Connect requirements at submission
    time, this changes periodically).
19. App description, keywords, support URL, marketing URL (support URL is mandatory; marketing
    URL is optional).
20. Privacy Policy URL (§1.4/§8).
21. "App Review Information": demo account credentials + the reviewer notes from §2.1 option 3.

### Phase E — Submit

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
  deliberately), but this is worth one dedicated pass specifically framed as "assume a hostile
  client with only the anon key" before launch, not just "does the happy path work."
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
