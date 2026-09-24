# APeX Privacy Policy

**Effective date:** 22.07.2026

This Privacy Policy explains how APeX ("APeX," "we," "us," or "our") collects,
uses, shares, and protects information when you use the APeX mobile
application (the "App"). It applies to athletes and coaches/managers who use
the App. By creating an account, you agree to the practices described here.

If anything below doesn't match how the App actually behaves, that's a bug
in this document, not in your rights — please contact us (see "Contact Us")
and we will correct it.

---

## 1. Who This Applies To

APeX has two kinds of users:

- **Athletes**, who record short movement/exercise videos for automated
  performance and readiness analysis, either independently or as part of a
  team.
- **Coaches/Managers**, who create a team, invite athletes to join it via an
  invite code, and view their team's performance and readiness data.

An athlete may also use APeX independently, with no coach or team attached —
in that case, no one else can see their data (see Section 4).

---

## 2. Information We Collect

### 2.1 Account Information
When you create an account, we collect your **email address**, a
**password** (stored securely, hashed — we never see or store it in plain
text), your **full name**, and your **role** (athlete or coach/manager). If
you sign up as a coach, we also collect the **team name** you create; if you
sign up as an athlete joining a team, we collect the **invite code** you
enter to link your account to that team.

### 2.2 Athlete Profile Information
Athletes may provide **height, weight, playing position, and date of
birth**. This is optional and used only to personalize your readiness
tracking (e.g., unit conversion, age display) — you can leave any of it
blank.

### 2.3 Movement Videos
The core feature of APeX is recording a short (about 20 seconds or less)
video of yourself performing a movement (e.g., a few tennis swings), which
is uploaded so our system can analyze your movement. A few important specifics:

- **Video only, no audio.** Recordings made in-app are captured with audio
  explicitly disabled — we do not collect or store sound from your
  recordings.
- Videos are uploaded to secure, private cloud storage and are **not**
  publicly accessible — only you, and your coach/manager if you belong to a
  team (Section 4), can access them.
- After processing, we generate a second, **derived video** with a visual
  movement/skeleton overlay so you can review your form — this is stored
  alongside the original.
- You can **delete any individual recorded session** at any time from the
  app, which permanently removes both the original and processed video
  files from our storage, not just from your view of them.

### 2.4 Movement & Fitness Analysis Data
From each video, our system computes and stores fitness-related metrics
tied to your account, including: **repetition counts, a readiness score,
left/right balance, and range-of-motion measurements**. This data is used
to show you trends over time and, if you're on a team, to give your
coach/manager visibility into your training status (Section 4). This is the
same category of data commonly referred to as "Health & Fitness" data, and
we treat it with that sensitivity even though it does not include medical
diagnoses or records from a healthcare provider.

### 2.5 Injury Status
If you're on a team, your coach/manager can mark you as **injured** or
**recovered** within the app. This flag, and the date it was set, is
visible to you and to your coach/manager. We do not collect any medical
details beyond this simple status flag — APeX is a training/readiness tool,
not a medical diagnostic device, and this flag does not constitute medical
advice or a diagnosis.

### 2.6 Team & Coach Visibility Data
If your account is linked to a team, your coach/manager can see: your name,
profile information, recorded sessions and their videos, computed readiness
and performance history, your assigned/required exercises, and your injury
status. See Section 4 for exactly what's shared and why.

### 2.7 Push Notification Data
If you enable notifications, we store a **device push token** (provided by
Apple/Google/Expo's push infrastructure, not a message itself) so we can
alert you — for example, when your video analysis is ready. You can disable
this at any time in your device's notification settings; declining
notification permission doesn't limit any other part of the app.

### 2.8 What We Do NOT Collect
We do not run advertising or ad-tracking of any kind, we do not use
third-party analytics SDKs, we do not sell your data to anyone, and we do
not use your videos or fitness data to train any third-party AI product.

---

## 3. How We Use Your Information

We use the information above to:

- Operate your account (authentication, login, password reset).
- Process your recorded videos into movement analysis and readiness scores.
- Show you your own performance history and trends.
- Let your coach/manager (if any) monitor your team's readiness and
  compliance, exactly as described in Section 4.
- Send you optional push notifications you've enabled.
- Maintain the security and integrity of the App (e.g., preventing abuse).

We do not use your data for any purpose beyond operating the features of
the App itself.

---

## 4. How Information Is Shared

**Within a team:** if your account is linked to a team (via an invite
code), your coach/manager can view the data listed in Section 2.6. This is
a core, disclosed feature of the App, not a third-party data share — your
coach is using the same App, under the same account system, to do their
job of monitoring their athletes' training. An **individual (teamless)
athlete's data is never visible to anyone but that athlete.**

**With service providers who help us run the App**, under confidentiality
obligations, and only as needed to provide the App's functionality:

- **Supabase** — our database, authentication, and file storage provider.
  Your account data, videos, and performance data are hosted on Supabase's
  infrastructure.
- **Expo** — the push-notification relay service that delivers
  notifications to your device, if you've enabled them.
- **Our own video-processing servers** — where uploaded videos are analyzed
  to produce movement/readiness data. This processing is performed by us,
  not by a third-party AI vendor, and videos are not shared outside this
  processing pipeline.

**We do not sell your personal information, and we do not share it with
advertisers, data brokers, or any other third party for their own
marketing purposes.**

We may also disclose information if required by law, to comply with a
valid legal process, or to protect the rights, safety, or property of
APeX, our users, or the public.

---

## 5. Data Storage & Security

Your data is stored on Supabase's cloud infrastructure using
industry-standard security practices, including encryption in transit
(HTTPS/TLS) and access controls that restrict each account to its own
data (and, for team athletes, to their coach/manager — nothing more).
Video storage is private by default; no recording is ever publicly
accessible.

No method of electronic storage or transmission is 100% secure, and we
cannot guarantee absolute security, but we work to protect your
information using practices appropriate to its sensitivity.

---

## 6. Data Retention & Deletion

We retain your account and performance data for as long as your account is
active, so you (and your coach/manager, if applicable) can review your
history over time.

**You can permanently delete your account at any time** from Settings →
Delete Account, in the App. This is a full, irreversible deletion — not a
deactivation — and removes:

- Your profile and login credentials.
- Every recorded video (original and processed) from our storage.
- Your session history, readiness scores, and routine settings.
- Any notifications referencing you.

If you're a coach/manager, deleting your account removes only your own
account — it does **not** delete your team or your athletes' data, since
that data belongs to them, not to you.

Deletion typically takes effect immediately; some backup copies may persist
briefly afterward and are purged on our routine backup-rotation schedule.

---

## 7. Your Rights & Choices

Depending on where you live, you may have rights to access, correct,
export, or delete your personal information, and to object to or restrict
certain processing. You can exercise most of these directly in the App:

- **Access/correct your profile:** edit it directly in Settings.
- **Delete your account and all associated data:** Settings → Delete
  Account (see Section 6).
- **Camera/photo library permissions:** grant or revoke these at any time
  in your device's system settings; the App will ask again only when you
  try to use the related feature.
- **Notifications:** enable/disable at any time in your device's system
  settings.

For any request not covered directly in the App (e.g., a full data export,
or a request under a specific privacy law), contact us using the details in
Section 11 and we will respond within the time required by applicable law.

---

## 8. Children's Privacy

APeX is not directed at, and is not intended for use by, children under
13, and account creation requires confirming you are 13 years of age or
older. We do not knowingly collect personal information from children
under 13. If you believe a child under 13 has created an account, please
contact us so we can delete it.

---

## 9. International Users

Our service providers may store and process data in countries other than
the one you live in. Wherever your information is processed, we require
appropriate safeguards to protect it consistent with this Policy.

---

## 10. Changes to This Policy

We may update this Privacy Policy from time to time. If we make material
changes, we will update the "Effective date" above and, where required,
notify you in the App. Continued use of APeX after an update means you
accept the revised Policy.

---

## 11. Contact Us

Questions, requests, or concerns about this Privacy Policy or your data:

**Email:** danzlotnikov+apex@gmail.com
**Developer:** Dan Zlotnikov

---

*This document is a starting point drafted to match APeX's actual features
as of the effective date above. Please have it reviewed by a lawyer before
publishing, especially if you plan to operate in the EU/UK (GDPR), California
(CCPA/CPRA), or any other jurisdiction with specific statutory privacy-notice
requirements — this draft covers the general shape those laws expect
(what's collected, why, who it's shared with, retention, deletion, contact),
but doesn't cite jurisdiction-specific rights language verbatim.*
