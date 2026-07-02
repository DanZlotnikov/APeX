# APeX — Athletic Performance Excellence

Skeleton MVP for an AI athlete-movement-assessment platform.

**This first step does one thing end-to-end:** record (or pick) a short movement
video → process it with **MediaPipe Pose Landmarker** → play back a video with the
pose skeleton drawn on the athlete.

It is intentionally minimal: no auth, no database, no profiles, no readiness scores,
no injury prediction, no cloud. Just a clean, working record → process → display pipeline.

---

## Architecture (and why)

```
APeX/
├── mobile/     Expo + TypeScript app (UI, camera, video pick, playback)
└── backend/    Python FastAPI + MediaPipe + OpenCV (pose processing)
```

We use **Option A** from the brief: a React Native (Expo) app + a local Python
backend that runs MediaPipe.

**Why a backend instead of on-device MediaPipe?**

- There is no clean, well-maintained React Native binding that runs the official
  MediaPipe Pose Landmarker *and* re-encodes a skeleton-overlaid MP4 on-device.
- MediaPipe's **Python Tasks API + OpenCV** is mature and reliable for exactly this:
  read frames → detect pose → draw landmarks + connections → write a new MP4.
- This keeps the mobile app simple (record/pick/upload/play) and puts the fragile,
  compute-heavy work in a robust, easy-to-run service.

**Output choice:** the backend **bakes the skeleton into a new MP4** and the app just
plays that file. This is simpler and far more reliable than streaming landmark JSON to
the client and trying to keep an overlay perfectly synced to playback frame-by-frame.
(The backend can also return JSON landmarks later — see TODO.)

**Why Expo (managed) and not bare React Native?**
All heavy processing is server-side, so we never need custom native modules. Expo gives
us camera recording, image/video picking, and video playback out of the box, and runs
from VS Code in a browser/emulator with zero native build setup.

---

## Two ways to test

### 1. Dev mode (recommended first — runs from VS Code, no phone)
- Webcam-inside-a-mobile-emulator is unreliable, so the primary dev workflow is the
  **"Choose Test Video"** button: pick any local `.mp4`/`.mov`, process it, see the result.
- Run the app on **web** (`w` in Expo) or an emulator and exercise the full
  pick → process → play pipeline against your local backend.

### 2. Real phone mode
- Open the app in **Expo Go** on your phone (same Wi-Fi as your PC).
- **"Start Recording"** uses the real camera, records a clip, then processes it.
- Point the app's API URL at your PC's LAN IP (see `mobile/src/config.ts`).

---

## Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.10–3.12 (verified on 3.12)
- **ffmpeg** on your PATH (for H.264 output + the webcam recorder). Verify with `ffmpeg -version`.
- The **Expo Go** app on your phone (optional, for real-device testing)

---

## Setup & run

### A) Backend (start this first)

```bash
cd backend
python -m venv .venv

# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

- On first run it auto-downloads the `pose_landmarker_lite.task` model (~10 MB).
- Health check: open http://localhost:8000/ → `{"status":"ok"}`.
- Processed videos are served from `http://<host>:8000/videos/...`.

### B) Mobile app

```bash
cd mobile
npm install
npx expo install        # aligns native package versions to the Expo SDK
npm start               # then press: w (web), a (Android), i (iOS), or scan QR in Expo Go
```

> If `npx expo install` reports version mismatches, run `npx expo install --fix`.

### C) Point the app at your backend

Edit [`mobile/src/config.ts`](mobile/src/config.ts):

| Where you run the app            | API base URL                          |
|----------------------------------|---------------------------------------|
| Web browser (same PC)            | `http://localhost:8000`               |
| Android emulator                 | `http://10.0.2.2:8000`                |
| iOS simulator                    | `http://localhost:8000`               |
| **Physical phone (Expo Go)**     | `http://<your-PC-LAN-IP>:8000`        |

The default auto-selects per platform. For a physical phone, set `MANUAL_API_URL`
to your computer's LAN IP (e.g. `http://192.168.1.20:8000`) and make sure the backend
is started with `--host 0.0.0.0`.

---

## Using the app

1. **Home** — title, subtitle, two buttons.
2. **Start Recording** → camera screen → record / stop → preview → **Process Video**.
3. **Choose Test Video** → pick a local clip → **Process Video** (great for PC dev).
4. A loading indicator shows while the backend processes frames.
5. **Result** — plays the processed video with the skeleton overlay + **Record Again**.

Errors (no backend, bad file, no pose found) surface as a simple banner.

---

## Bundled sample (see a skeleton on the first run)

`samples/` contains a ready-to-use clip so you don't have to source your own:

- **`samples/sample_movement.mp4`** — a public-domain squat demo. In the app, tap
  **Choose Test Video** → pick this file → **Process Video**. (Pose is detected in
  all 213 frames.)
- **`samples/sample_movement_posed.mp4`** — the **expected output**; open it directly
  to see what a correct skeleton overlay looks like before running anything.

---

## Simulation mode on PC + record from the webcam

This is the recommended flow to validate the whole pipeline on your computer, no phone.

1. **Start the backend** (Terminal 1):
   ```bash
   cd backend && .venv\Scripts\Activate.ps1
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```

2. **Start the app on web** (Terminal 2):
   ```bash
   cd mobile && npm start      # then press  w  to open the web app
   ```
   `config.ts` already points the web app at `http://localhost:8000`.

3. **Get a clip from your PC camera.** Two options:

   - **A) In-app (may work in Chrome):** click **Start Recording**. The browser asks
     for camera permission. *Web video recording is browser-dependent, so if it fails
     or the preview won't play, use option B.*

   - **B) Reliable webcam recorder (recommended):** in the backend terminal run
     ```bash
     python record_webcam.py --seconds 8
     ```
     A preview window opens and records ~8 s (press `q` to stop early), saving
     `samples/my_recording.mp4` as H.264. Then in the web app: **Choose Test Video**
     → pick `samples/my_recording.mp4` → **Process Video**.

4. **See the result.** The app uploads the clip, the backend draws the pose skeleton
   on every frame, and the **Result** screen plays it back with the overlay.

> Tip: stand back far enough that your **full body** is visible and well lit — that's
> what gives the cleanest skeleton.

---

## Important files

**Mobile**
- [`mobile/App.tsx`](mobile/App.tsx) — tiny state-based navigator (Home/Camera/Result).
- [`mobile/src/screens/HomeScreen.tsx`](mobile/src/screens/HomeScreen.tsx)
- [`mobile/src/screens/CameraScreen.tsx`](mobile/src/screens/CameraScreen.tsx) — record / pick / process.
- [`mobile/src/screens/ResultScreen.tsx`](mobile/src/screens/ResultScreen.tsx) — processed playback.
- [`mobile/src/services/api.ts`](mobile/src/services/api.ts) — uploads to `POST /process-video`.
- [`mobile/src/hooks/useVideoProcessor.ts`](mobile/src/hooks/useVideoProcessor.ts) — upload/processing state machine.
- [`mobile/src/config.ts`](mobile/src/config.ts) — API URL config.

**Backend**
- [`backend/main.py`](backend/main.py) — FastAPI app, CORS, `POST /process-video`, static serving.
- [`backend/pose_processor.py`](backend/pose_processor.py) — MediaPipe Pose Landmarker + OpenCV drawing, H.264 output via ffmpeg.
- [`backend/record_webcam.py`](backend/record_webcam.py) — dev helper to record a clip from the PC webcam.

**Samples**
- [`samples/sample_movement.mp4`](samples/sample_movement.mp4) — input demo clip.
- [`samples/sample_movement_posed.mp4`](samples/sample_movement_posed.mp4) — expected skeleton output.

---

## Limitations (by design, for this MVP)

- **Local network only.** No deployment/HTTPS; the phone must reach your PC on LAN.
- **Single person.** `num_poses = 1`.
- **Skeleton baked into MP4** (not an interactive/synced overlay).
- **Output is H.264** (transcoded via ffmpeg) for broad browser/mobile playback. If
  `ffmpeg` isn't on PATH the backend falls back to `mp4v`, which some browsers won't play.
- **No frame caching / queue.** One video at a time; large/long videos take longer.
- **Web recording** in some browsers is limited — prefer "Choose Test Video" on web.

---

## TODO — next phases

1. **Extract joint trajectories** (return per-frame landmark JSON alongside the video).
2. **Segment jump / squat / hop phases** from the trajectories.
3. **Compute basic movement metrics** (joint angles, ROM, symmetry, tempo).
4. **Add personal baseline** (per-athlete reference once profiles exist).
5. **Add cloud model refinement** (server-side model + deployment).
