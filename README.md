# APeX — Athletic Performance Excellence

An AI-powered athlete movement assessment platform built with React Native (Expo).
Record or upload a movement clip → MediaPipe analyzes every frame on-device →
skeleton and rep counters are baked permanently into the video → a readiness
assessment with per-rep charts is shown.

**No backend. No cloud. Everything runs in a WebView on the device.**

---

## What it does end-to-end

1. **Record** a movement clip with the camera, or **upload** an existing video.
2. **Preview** the clip on the Review Clip screen, then tap **Analyze Movement**.
3. A **BakeLoader** (APeX logo + progress bar + percentage) is shown while:
   - MediaPipe Pose Landmarker analyzes every frame at 8× speed (preprocess pass).
   - Exercise detection (squat / deadlift / jump / pull-up) identifies reps.
   - A readiness assessment with per-rep metrics is computed.
   - Skeleton + rep counter are baked frame-by-frame into an output video using
     WebCodecs `VideoEncoder` (seek-based, ~5–10 s for a 30 s clip).
     Falls back to MediaRecorder on Android, then returns the original video on iOS.
4. The **Analysis Screen** reveals: the baked video with skeleton overlay, and
   the full assessment panel with readiness score, per-rep sparklines, risk factors,
   and historical comparison deltas (▲/▼ vs all-time average).
5. Sessions are **saved to local storage** (JSON + copied video file) and browsable
   in the **History** tab of the dashboard.

---

## Architecture

```
APeX/
└── mobile/                     Expo + TypeScript app (target: iOS, Android, Web)
    ├── App.tsx                  State-machine navigator: dashboard | camera | analysis
    ├── src/
    │   ├── components/
    │   │   ├── PoseView/
    │   │   │   ├── html.ts              The entire analysis pipeline (WebView HTML+JS)
    │   │   │   ├── PoseView.native.tsx  React Native WebView host
    │   │   │   └── PoseView.web.tsx     Web iframe host
    │   │   ├── AssessmentPanel.tsx      Readiness + per-rep charts
    │   │   ├── VideoPlayer/             Cross-platform video player with SVG controls
    │   │   └── charts/LineTrend.tsx     Custom SVG sparkline
    │   ├── screens/
    │   │   ├── AnalysisScreen.tsx       BakeLoader → baked video + assessment reveal
    │   │   ├── CameraScreen.tsx         Record / review clip flow
    │   │   ├── DashboardScreen.tsx      Bottom-tab dashboard shell
    │   │   └── dashboard/
    │   │       ├── OverviewScreen.tsx   Athlete profile + readiness trend
    │   │       ├── HistoryScreen.tsx    List of past sessions
    │   │       ├── HistoryDetailScreen  Replay saved session
    │   │       └── SettingsScreen.tsx   Accent color, units, sound, comparison window
    │   ├── utils/
    │   │   ├── exerciseAnalyzer.ts      EXERCISE_ANALYZER_JS injected into WebView
    │   │   ├── history.ts               Session CRUD + aggregation helpers
    │   │   ├── storage.ts               Cross-platform JSON + video file persistence
    │   │   └── stats.ts                 Historical comparison engine
    │   └── state/SettingsContext.tsx    Theme, units, sound — persisted settings
    └── samples/                 Test videos (squat, deadlift)
```

### Why WebView for pose estimation?

MediaPipe's JavaScript Tasks API runs natively in a browser context. Wrapping it
in a WebView lets us ship a fully on-device pipeline with zero native modules — it
runs identically on iOS, Android, and web.

### The bake pipeline (`html.ts`)

All analysis + rendering lives in a single self-contained HTML document
(`MEDIAPIPE_HTML` exported from `html.ts`) that is loaded in a hidden WebView:

**Phase 1 — Preprocess (8× speed)**
- Video plays at 8× (`playbackRate = 8`).
- Every rAF tick calls `runInference(videoEl, timestamp)` → 33 MediaPipe landmarks.
- Landmarks stored in `landmarkHistory` / `timeHistory` arrays.
- `sendProgress(pct)` posts throttled progress messages to React Native.

**Phase 2 — Render (bake)**
- `lookupLandmarks(t)` does binary search + linear interpolation in the precomputed arrays.
- `drawCompositeAt(t)` draws: video frame + skeleton connections + rep counter overlay.
- **Fast path** (Chrome/Android): WebCodecs `VideoEncoder` + `webm-muxer` — seeks
  frame-by-frame, encodes without real-time constraint (~5–10 s for 30 s clip).
- **Slow path** (fallback): MediaRecorder captures `canvas.captureStream(30)` at 1× playback.
- **iOS fallback**: WKWebView has no `captureStream` → returns the original video URI.

**Inference engine abstraction** — swap-point is three functions only:
```javascript
async function initInferenceEngine()          // load model
function runInference(videoEl, timestampMs)   // → NormalizedLandmark[] | null
function warmupInference(videoEl)             // optional warm-up call
```
Replacing MediaPipe with a custom model = reimplement these three functions.

**Exercise detection** (`exerciseAnalyzer.ts` → `EXERCISE_ANALYZER_JS`)
- Squat: knee angle + hip/ankle alignment, ROM, depth per rep.
- Deadlift: torso lean angle (hinge quality) per rep.
- Vertical jump: ankle rise during flight phase.
- Pull-up: elbow angle at peak contraction per rep.
- Outputs: `perRepDepth[]`, `perRepDurationSec[]`, ROM, avgRepSec, readiness 0–100.

### Messaging protocol (WebView ↔ React Native)

| Direction | Message type | Payload |
|-----------|-------------|---------|
| WebView → host | `ready` | model loaded |
| host → WebView | `loadVideo` | `{ uri }` blob URL |
| WebView → host | `progress` | `{ pct: 0..1 }` (throttled 150 ms) |
| WebView → host | `assessment` | full `Assessment` object |
| WebView → host | `renderedStart` | `{ mimeType, total }` |
| WebView → host | `renderedChunk` | `{ index, data }` base64 512 KB chunks |
| WebView → host | `renderedDone` | completion signal |

On native: video is injected in 1.5 MB base64 chunks via `injectJavaScript` because
iOS WKWebView cannot load `file://` or large `data:` URIs in a `<video>` element.

---

## Running the app

```bash
cd mobile
npm install
npx expo start
# press w (web browser), a (Android emulator), i (iOS simulator)
# or scan the QR in Expo Go on a real device
```

Web is the fastest dev target — opens instantly in Chrome, full WebCodecs support.

---

## Key files to know before touching anything

| File | What it does |
|------|-------------|
| `mobile/src/components/PoseView/html.ts` | Entire 800-line analysis pipeline — most sensitive file |
| `mobile/src/utils/exerciseAnalyzer.ts` | `EXERCISE_ANALYZER_JS` template string injected into WebView |
| `mobile/src/screens/AnalysisScreen.tsx` | BakeLoader, progress state, assessment/video gating |
| `mobile/src/components/AssessmentPanel.tsx` | Per-rep sparklines, readiness gauge, delta chips |
| `mobile/src/utils/storage.ts` | Native: expo-file-system documentDirectory. Web: localStorage `apex:*` |
| `mobile/App.tsx` | Screen state machine — dashboard / camera / analysis |

---

## Bugs fixed (context for next session)

### Stray identifier in WebView script
`EXERCISE_ANALYZER_JS` in `exerciseAnalyzer.ts` had a bare `DashboardScreen`
identifier at the top level of the JS template string. This caused a
`ReferenceError` at WebView load time, preventing `init()` from running, so
`ready` was never sent and analysis never started. Previously masked by Metro
bundler cache.

### WebView restart on parent re-render
`PoseView.web.tsx` had all callbacks in the `useEffect` dep array. When
`SettingsContext` rehydrated from storage (changing `settings.windowDays`),
`handleAssessment` got a new reference → effect re-fired → iframe torn down
mid-analysis. Fixed by storing all callbacks in refs and keeping only `videoUri`
as a dep. Same pattern applied to `PoseView.native.tsx`'s `useCallback`.

### Assessment stats updating after reveal
`setComparison` is async (awaits `loadHistory()`). If the bake finished before
history loaded, the panel appeared with plain stats then updated when comparison
arrived. Fixed by making `isReady` gate on both `renderedUri !== null` AND
`comparison !== undefined` — the panel only appears once both are resolved.

### Upload shows blank screen
Tapping "Upload" navigated to `CameraScreen` (blank while file picker was open).
Fixed: picker now runs from `App.tsx` without navigating. Only after a file is
selected does the app navigate to `CameraScreen` with `initialVideoUri` pre-set,
landing directly on the review screen.

### Progress bar snap-back
Shimmer animation (indeterminate) ran at `progress === 0`, then snapped back when
the first real progress arrived and the fill bar started from 0. Fixed: removed
shimmer entirely. Bar starts at 0 width and fills smoothly from the first frame.

---

## Persistence

**Native:** `expo-file-system` `documentDirectory`
- `history.json` — all session entries (date, assessment, video filename)
- `profile.json` — athlete name, height, weight
- `videos/` — baked video files copied by filename (path rebuilt at read time)

**Web:** `localStorage` keys prefixed `apex:` — best-effort, videos ephemeral.

To clear web data: `Object.keys(localStorage).filter(k => k.startsWith('apex:')).forEach(k => localStorage.removeItem(k))`

---

## Style & design language

- Dark navy background (`#07101C`), teal primary (`#00FFE0`), muted gray text
- All-caps spaced labels (`letterSpacing: 2.5`), heavy numeric weights (`800`)
- Cards with 1px teal-tinted borders on a slightly lighter surface color
- Readiness gauge (arc), LineTrend sparklines (custom SVG), DeltaChip pills (▲▼)
- Accent color is user-configurable (teal / blue / violet / amber / red)

---

## Next session prompt

> You are continuing work on **APeX**, a React Native (Expo) athlete movement
> assessment app. The codebase is at `c:\Users\Admin\repos\APeX`. Run `cd mobile && npx expo start` then press `w` to open the web version.
>
> Read the full README at the repo root before starting — it has architecture,
> key files, messaging protocol, and past bug context.
>
> The analysis pipeline lives entirely in `mobile/src/components/PoseView/html.ts`
> (MediaPipe WebView) and `mobile/src/utils/exerciseAnalyzer.ts` (exercise JS
> injected into the same WebView). The React Native layer is in `AnalysisScreen.tsx`
> and `PoseView.native.tsx` / `PoseView.web.tsx`.
>
> Current known gaps / next priorities:
> - **iOS bake**: WKWebView has no `captureStream` so the baked video falls back to
>   the original (no skeleton). A proper iOS path needs investigation — potentially
>   using a native canvas-to-video encoder or a different approach.
> - **Model swap**: the inference engine abstraction is in place (`initInferenceEngine`,
>   `runInference`, `warmupInference` in `html.ts`). The next step is replacing
>   MediaPipe with a custom ONNX/TFLite model for better accuracy and speed.
> - **Dashboard polish**: Overview readiness trend chart, History list, HistoryDetail
>   replay are wired up but need UX polish and edge-case handling.
> - **Onboarding**: no first-run experience yet. Profile (height/weight) needs to be
>   prompted before first analysis for the comparison engine to be meaningful.
