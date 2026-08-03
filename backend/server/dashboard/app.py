"""
APeX Backend Dashboard — local monitoring UI for supabase_worker.py.

IMPORTANT: this is a pure supervisor/observer. It never imports, calls, or
modifies anything in supabase_worker.py or the pipeline it drives — it
starts that script as a child process exactly the way run_backend.ps1 used
to invoke it directly (same wsl.exe/bash/flock/.env-sourcing command,
byte-for-byte), captures its stdout for the live log view, and separately
queries Supabase's REST API (read-only from this process's point of view —
it never writes to video_jobs/sessions) for job/session data. The worker
itself is completely unaware this exists.

Run via run_backend.ps1, not directly — that script sets up this app's own
(separate, disposable) venv and passes the starting mode.
"""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
import threading
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

APP_DIR = Path(__file__).resolve().parent
SERVER_DIR = APP_DIR.parent  # backend/server
LOG_FILE = SERVER_DIR / "backend_run.log"
ENV_FILE = SERVER_DIR / ".env"

WSL_DISTRO = "Ubuntu-22.04"
WSL_SERVER_DIR = "/mnt/c/Users/Admin/repos/APeX/backend/server"

ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

# Query-string cache-buster, fixed per process lifetime. Cache-Control
# headers alone aren't reliably enough — a browser tab that already loaded
# /static/style.css or app.js under the old URL can keep serving it from
# disk cache regardless of what headers a *later* request gets. Appending
# ?v=<boot time> makes every server restart a genuinely different URL, so
# there's nothing stale to possibly serve.
BOOT_VERSION = str(int(time.time()))

app = FastAPI(title="APeX Backend Dashboard")


# ── Worker process supervision ───────────────────────────────────────────
# Spawned via subprocess.Popen with a list (not shell=True), so this string
# goes to `bash -c` as one literal argument — no intermediate shell
# re-parses/re-quotes it the way PowerShell's `wsl ... bash -c "$cmd"` did
# (that's what caused the nested-quote bug fixed earlier in run_backend.ps1;
# this path doesn't have that problem at all).
class WorkerSupervisor:
    def __init__(self) -> None:
        self.process: Optional[subprocess.Popen] = None
        self.mode: str = "continuous"
        self.started_at: Optional[str] = None
        self._lock = threading.Lock()

    @staticmethod
    def _bash_command(mode: str) -> str:
        py_args = "--interval-minutes 30" if mode == "30min" else ""
        return (
            f"cd {WSL_SERVER_DIR} && "
            "source ../GENMO/.venv/bin/activate && "
            "set -a && source <(tr -d '\\r' < .env) && set +a && "
            f"flock .worker.lock python -u supabase_worker.py {py_args}"
        ).strip()

    def start(self, mode: Optional[str] = None) -> None:
        with self._lock:
            if self.process is not None:
                return
            mode = mode or self.mode
            self.mode = mode
            cmd = ["wsl.exe", "-d", WSL_DISTRO, "bash", "-c", self._bash_command(mode)]
            self.process = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1, encoding="utf-8", errors="replace",
            )
            self.started_at = datetime.now(timezone.utc).isoformat()
            threading.Thread(target=self._read_output, args=(self.process,), daemon=True).start()
            log_event("system", f"Worker started ({mode} mode)")

    def stop(self) -> None:
        with self._lock:
            proc, self.process = self.process, None
        if proc is None:
            return
        # Belt and suspenders: kill the actual process inside WSL first (the
        # thing really holding the GPU/flock), then the wsl.exe wrapper on
        # the Windows side — terminating wsl.exe alone doesn't reliably
        # propagate down to what it launched.
        subprocess.run(
            ["wsl.exe", "-d", WSL_DISTRO, "bash", "-c", "pkill -f supabase_worker.py"],
            capture_output=True,
        )
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        log_event("system", "Worker stopped")

    def set_mode(self, mode: str) -> None:
        """Switches mode. If currently running, restarts into the new mode
        immediately; if stopped, just remembers it for the next Start.
        """
        was_running = self.process is not None
        if was_running:
            self.stop()
            time.sleep(1)
            self.start(mode)
        else:
            self.mode = mode

    def _read_output(self, proc: subprocess.Popen) -> None:
        if proc.stdout is None:
            return
        for line in proc.stdout:
            log_event("log", ANSI_RE.sub("", line.rstrip("\n")))
        log_event("system", "Worker process exited")


supervisor = WorkerSupervisor()


# ── Log broadcasting ──────────────────────────────────────────────────────

LOG_BUFFER: deque = deque(maxlen=1000)
WS_CLIENTS: set[WebSocket] = set()
MAIN_LOOP: Optional[asyncio.AbstractEventLoop] = None


def log_event(kind: str, message: str) -> None:
    event = {"type": kind, "message": message, "ts": datetime.now(timezone.utc).isoformat()}
    LOG_BUFFER.append(event)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"{event['ts']} [{kind}] {message}\n")
    except Exception:
        pass
    if MAIN_LOOP is not None:
        asyncio.run_coroutine_threadsafe(_broadcast(event), MAIN_LOOP)


async def _broadcast(event: dict) -> None:
    dead = []
    for ws in WS_CLIENTS:
        try:
            await ws.send_json(event)
        except Exception:
            dead.append(ws)
    for ws in dead:
        WS_CLIENTS.discard(ws)


@app.on_event("startup")
async def on_startup() -> None:
    global MAIN_LOOP
    MAIN_LOOP = asyncio.get_event_loop()
    supervisor.start(os.environ.get("APEX_INITIAL_MODE", "continuous"))


@app.on_event("shutdown")
async def on_shutdown() -> None:
    supervisor.stop()


@app.websocket("/ws/logs")
async def ws_logs(websocket: WebSocket) -> None:
    await websocket.accept()
    WS_CLIENTS.add(websocket)
    for event in list(LOG_BUFFER):
        await websocket.send_json(event)
    try:
        while True:
            await websocket.receive_text()  # client sends nothing; just keeps the socket alive
    except WebSocketDisconnect:
        WS_CLIENTS.discard(websocket)


# ── Status / mode control ──────────────────────────────────────────────────

class ModeRequest(BaseModel):
    mode: str


@app.get("/api/status")
async def get_status() -> dict:
    return {"mode": supervisor.mode, "running": supervisor.process is not None, "started_at": supervisor.started_at}


@app.post("/api/start")
async def start_worker() -> dict:
    supervisor.start()
    return {"mode": supervisor.mode, "running": supervisor.process is not None}


@app.post("/api/stop")
async def stop_worker() -> dict:
    supervisor.stop()
    return {"mode": supervisor.mode, "running": supervisor.process is not None}


@app.post("/api/set-mode")
async def set_mode(req: ModeRequest) -> dict:
    if req.mode not in ("continuous", "30min"):
        return {"error": "invalid mode"}
    supervisor.set_mode(req.mode)
    return {"mode": supervisor.mode, "running": supervisor.process is not None}


# ── Supabase job/session data (read-only queries, separate from the worker) ─

def _supabase_config() -> tuple[Optional[str], Optional[str]]:
    url = key = None
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip().rstrip("\r")
            if line.startswith("SUPABASE_URL="):
                url = line.split("=", 1)[1].strip()
            elif line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
                key = line.split("=", 1)[1].strip()
    return url, key


async def _fetch(client: httpx.AsyncClient, url: str, key: str, table: str, params: dict) -> list[dict]:
    resp = await client.get(
        f"{url}/rest/v1/{table}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        params=params, timeout=15.0,
    )
    resp.raise_for_status()
    return resp.json()


# Same formula as save_video_job (SQL, migration 016/018) and mobile's
# readinessPctFromAnalysis (pipelineExercise.ts) — average of L/R balance and
# range-of-motion percentages, whichever is present. A video_jobs row has
# this in analysis_json well before it graduates to a sessions row (which
# stores it directly as readiness_score/rep_count instead); reusing the same
# math here is what lets a completed-but-not-yet-saved job show real numbers
# instead of "—" in this table.
def _readiness_from_analysis(analysis: Optional[dict]) -> Optional[float]:
    if not analysis:
        return None
    analyses = analysis.get("analyses") or {}
    balance_pct = (analyses.get("balance") or {}).get("overall_balance_pct")
    rom_pct = (analyses.get("rom") or {}).get("overall_rom_pct")
    if balance_pct is not None and rom_pct is not None:
        return round((balance_pct + rom_pct) / 2)
    if balance_pct is not None:
        return round(balance_pct)
    if rom_pct is not None:
        return round(rom_pct)
    return None


def _rep_count_from_analysis(analysis: Optional[dict]) -> Optional[int]:
    return analysis.get("rep_count") if analysis else None


@app.get("/api/jobs")
async def get_jobs() -> dict:
    url, key = _supabase_config()
    if not url or not key:
        return {"error": "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set in .env", "jobs": []}

    async with httpx.AsyncClient() as client:
        video_jobs, sessions = await asyncio.gather(
            _fetch(client, url, key, "video_jobs", {"select": "*", "order": "created_at.desc", "limit": "200"}),
            _fetch(client, url, key, "sessions", {"select": "*", "order": "recorded_at.desc", "limit": "200"}),
        )

        athlete_ids = {j["athlete_id"] for j in video_jobs} | {s["athlete_id"] for s in sessions}
        profiles: dict[str, str] = {}
        if athlete_ids:
            rows = await _fetch(
                client, url, key, "profiles",
                {"select": "id,full_name", "id": f"in.({','.join(athlete_ids)})"},
            )
            profiles = {r["id"]: r["full_name"] for r in rows}

    items = []
    for j in video_jobs:
        analysis = j.get("analysis_json")
        items.append({
            "id": j["id"], "kind": "video_job", "status": j["status"],
            "athlete_id": j["athlete_id"], "athlete_name": profiles.get(j["athlete_id"], "Unknown"),
            "exercise_type": j.get("exercise_type") or j.get("target_exercise_key"),
            "recorded_at": j.get("recorded_at"), "created_at": j.get("created_at"),
            "started_at": j.get("started_at"), "completed_at": j.get("completed_at"),
            "error_message": j.get("error_message"), "analysis_json": analysis,
            "readiness_score": _readiness_from_analysis(analysis),
            "rep_count": _rep_count_from_analysis(analysis),
            "duration_sec": j.get("duration_sec"),
        })
    for s in sessions:
        items.append({
            "id": s["id"], "kind": "session", "status": "saved",
            "athlete_id": s["athlete_id"], "athlete_name": profiles.get(s["athlete_id"], "Unknown"),
            "exercise_type": s.get("exercise_type"),
            "recorded_at": s.get("recorded_at"), "created_at": s.get("created_at"),
            "started_at": None, "completed_at": s.get("recorded_at"),
            "error_message": None,
            "analysis_json": s.get("biomechanics_json") or s.get("analysis_json"),
            "readiness_score": s.get("readiness_score"), "rep_count": s.get("rep_count"),
            "duration_sec": s.get("duration_sec"),
        })

    items.sort(key=lambda x: x.get("created_at") or x.get("recorded_at") or "", reverse=True)
    return {"jobs": items}


# ── Static frontend ──────────────────────────────────────────────────────
# This is actively edited and reloaded during development — browsers caching
# a stale index.html/app.js/style.css (FastAPI's StaticFiles sets no
# explicit cache policy, so the browser default applies) has already caused
# a real "the UI doesn't match what was just changed" confusion once. A
# local single-user tool has nothing to gain from caching these anyway.
@app.middleware("http")
async def no_cache(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return response


app.mount("/static", StaticFiles(directory=str(APP_DIR / "static")), name="static")


@app.get("/")
async def index() -> HTMLResponse:
    html = (APP_DIR / "static" / "index.html").read_text(encoding="utf-8")
    html = html.replace('href="/static/style.css"', f'href="/static/style.css?v={BOOT_VERSION}"')
    html = html.replace('src="/static/app.js"', f'src="/static/app.js?v={BOOT_VERSION}"')
    return HTMLResponse(html)
