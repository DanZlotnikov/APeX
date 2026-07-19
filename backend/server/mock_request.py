"""
Sends a real HTTP request to a running APeX pose server for the squat
sample video, waiting for the server's /health endpoint to report the
models are loaded first (startup takes ~90s).

Usage (server already running in another terminal):
    python mock_request.py [video_path]
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

BASE_URL = "http://127.0.0.1:8000"
DEFAULT_VIDEO = "/mnt/c/Users/Admin/repos/APeX/samples/squat2.mp4"


def get_json(url: str, timeout: float = 5.0):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read())


def post_json(url: str, payload: dict, timeout: float = 900.0):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, json.loads(resp.read())


def wait_for_server(timeout_s: float = 300.0) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            health = get_json(f"{BASE_URL}/health")
            if health.get("models_loaded"):
                return True
        except (urllib.error.URLError, ConnectionRefusedError, TimeoutError):
            pass
        time.sleep(3)
    return False


def main() -> None:
    video_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_VIDEO

    print(f"Waiting for server at {BASE_URL} to finish loading models ...")
    if not wait_for_server():
        print("Server did not become ready in time.")
        sys.exit(1)
    print("Server ready.")

    print(f"POST /process video_path={video_path}")
    t0 = time.time()
    try:
        status, body = post_json(f"{BASE_URL}/process", {"video_path": video_path})
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}")
        sys.exit(1)
    print(f"Response in {time.time() - t0:.1f}s (HTTP {status}):")
    print(json.dumps(body, indent=2))


if __name__ == "__main__":
    main()
