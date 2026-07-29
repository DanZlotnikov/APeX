<#
.SYNOPSIS
  Launches the APeX backend dashboard - a local web UI (http://localhost:8787)
  that supervises the Supabase video-processing worker (supabase_worker.py)
  and shows live logs plus a searchable/filterable table of requests
  (queued/processing/completed/failed), including full analysis JSON.

  The worker itself is started and managed BY the dashboard (backend/server/
  dashboard/app.py) exactly the way this script used to launch it directly -
  same wsl.exe/bash/flock/.env-sourcing command - so worker behavior is
  unchanged; only how you observe and control it is new. supabase_worker.py
  is never modified.

.PARAMETER Mode
  Starting mode, changeable afterward from the dashboard's "Toggle Mode" button.
  'continuous' - worker checks for new jobs every few seconds, forever.
  '30min'      - worker checks for new jobs every 30 minutes, forever. Same
                 cadence as the "APeX Worker Drain" Windows Task Scheduler
                 task - don't run both at once (they share the same lock
                 file, so whichever runs second just skips its cycle rather
                 than double-processing).

.EXAMPLE
  .\run_backend.ps1 continuous
.EXAMPLE
  .\run_backend.ps1 30min
#>
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('continuous', '30min')]
    [string]$Mode
)

$DashboardDir = Join-Path $PSScriptRoot "dashboard"
$VenvDir      = Join-Path $DashboardDir ".venv"
$VenvPython   = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
    Write-Host "First run: setting up the dashboard's (separate, disposable) Python environment..." -ForegroundColor Yellow
    python -m venv $VenvDir
    & $VenvPython -m pip install --quiet --upgrade pip
    & $VenvPython -m pip install --quiet -r (Join-Path $DashboardDir "requirements.txt")
}

$env:APEX_INITIAL_MODE = $Mode

Write-Host "Starting APeX backend dashboard ($Mode mode)..." -ForegroundColor Cyan
Write-Host "Opening http://localhost:8787 - press Ctrl+C here to stop everything." -ForegroundColor Cyan

Start-Job -ScriptBlock {
    Start-Sleep -Seconds 2
    Start-Process "http://localhost:8787"
} | Out-Null

& $VenvPython -m uvicorn app:app --host 127.0.0.1 --port 8787 --app-dir $DashboardDir
