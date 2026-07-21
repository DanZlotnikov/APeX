<#
.SYNOPSIS
    Runs the Expo dev server and the async backend worker together.
    Ctrl+C (or closing this window) stops both.

.DESCRIPTION
    Starts:
      - backend/server/supabase_worker.py, in WSL (needs the GPU, which is
        only visible there) -- the persistent worker that polls Supabase for
        queued video_jobs and processes them. Not app.py/uvicorn -- that's a
        separate manual dev-testing entrypoint, not part of the app's real flow.
      - the Expo dev server (`npm start` in mobile/).

    Supabase credentials are read from mobile/.env (EXPO_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY) rather than duplicated here -- see
    HANDOFF_video_pipeline.md for why the worker needs the service-role key.

.USAGE
    powershell -File .\run-dev.ps1
#>

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot

function ConvertTo-WslPath([string]$WinPath) {
    $p = $WinPath -replace '\\', '/'
    if ($p -match '^([A-Za-z]):(.*)$') {
        return "/mnt/$($matches[1].ToLower())$($matches[2])"
    }
    return $p
}

# -- Pull Supabase creds out of mobile/.env ----------------------------------
$envFile = Join-Path $repoRoot 'mobile\.env'
if (-not (Test-Path $envFile)) {
    Write-Error "mobile\.env not found -- expected Supabase creds there. See HANDOFF_video_pipeline.md."
    exit 1
}
$envLines = Get-Content $envFile
$supabaseUrl = ($envLines | Where-Object { $_ -match '^EXPO_PUBLIC_SUPABASE_URL=' }) -replace '^[^=]*=', ''
$serviceKey  = ($envLines | Where-Object { $_ -match '^SUPABASE_SERVICE_ROLE_KEY=' }) -replace '^[^=]*=', ''
if (-not $supabaseUrl -or -not $serviceKey) {
    Write-Error "mobile\.env is missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    exit 1
}

$repoRootWsl = ConvertTo-WslPath $repoRoot

# Written to a plain script file and invoked by path (bash <path>, no -c)
# rather than passed as a Start-Process -ArgumentList string: PowerShell's
# native-argument-to-command-line conversion mangles complex strings with
# embedded quotes/&&/secrets (confirmed empirically -- the command silently
# never ran when passed this way), and a bare file path needs no quoting at
# all, sidestepping that entirely. LF line endings only (WriteAllText, not
# Set-Content) -- a CRLF-terminated script confuses bash (stray \r on every
# line, e.g. "source ...\r": No such file or directory).
$backendScriptPath = Join-Path $env:TEMP 'apex-backend-worker.sh'
$backendScriptLines = @(
    "cd '$repoRootWsl/backend/server'",
    "source ../GENMO/.venv/bin/activate",
    "export SUPABASE_URL='$supabaseUrl'",
    "export SUPABASE_SERVICE_ROLE_KEY='$serviceKey'",
    "python -u supabase_worker.py"  # -u: unbuffered stdout, so progress prints live
                                     # in this window instead of sitting in a buffer
                                     # across the WSL/Windows console boundary until
                                     # it fills or the process exits.
)
[System.IO.File]::WriteAllText($backendScriptPath, ($backendScriptLines -join "`n") + "`n", [System.Text.Encoding]::ASCII)
$backendScriptPathWsl = ConvertTo-WslPath $backendScriptPath

$mobileDir = Join-Path $repoRoot 'mobile'

Write-Host "Starting backend worker (WSL) ..." -ForegroundColor Cyan
$backendProc = Start-Process -FilePath 'wsl.exe' -ArgumentList @('-e', 'bash', '-l', $backendScriptPathWsl) -PassThru -NoNewWindow

Write-Host "Starting Expo dev server ..." -ForegroundColor Cyan
$expoProc = Start-Process -FilePath 'npm.cmd' -ArgumentList @('start') -WorkingDirectory $mobileDir -PassThru -NoNewWindow

# NOTE: $backendProc is the Windows-side wsl.exe launcher, not the actual
# worker. WSL can detach the launcher from the real process within seconds
# of starting it (confirmed empirically -- the launcher PID reports exited
# while `python supabase_worker.py` keeps running fine inside the VM), so
# $backendProc.HasExited is NOT a reliable "did it crash" signal and isn't
# used as one below. Actual liveness is checked via pgrep inside WSL instead.
function Test-BackendAlive {
    $out = & wsl.exe -e pgrep -f supabase_worker.py 2>$null
    return [bool]$out
}

Write-Host "`nBoth running. Ctrl+C to stop everything.`n" -ForegroundColor Green
Write-Host "(The backend takes ~90s to load models on first run -- its own output" -ForegroundColor DarkGray
Write-Host " prints to this window as it goes.)`n" -ForegroundColor DarkGray

# Grace period before checking backend liveness at all -- venv activation +
# the python process actually starting takes a few seconds, during which
# pgrep would find nothing and falsely look like a crash.
Start-Sleep -Seconds 15

try {
    while (-not $expoProc.HasExited -and (Test-BackendAlive)) {
        Start-Sleep -Seconds 2
    }
    if ($expoProc.HasExited) {
        Write-Host "`nExpo dev server exited -- shutting down the backend worker too." -ForegroundColor Yellow
    } else {
        Write-Host "`nBackend worker exited unexpectedly (check this window's output above)." -ForegroundColor Red
    }
}
finally {
    Write-Host "`nShutting down ..." -ForegroundColor Yellow

    # npm.cmd spawns a process tree (cmd -> npm -> node/metro) -- a plain
    # Stop-Process on the top PID leaves orphans behind on Windows, so tree-kill it.
    if ($expoProc -and -not $expoProc.HasExited) {
        Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/PID', $expoProc.Id, '/T', '/F') -NoNewWindow -Wait -ErrorAction SilentlyContinue
    }

    # The wsl.exe launcher PID may already be gone (see the note above) --
    # this is the actual reliable way to stop the worker, not Stop-Process
    # on $backendProc.
    wsl.exe -e pkill -f supabase_worker.py 2>$null

    Write-Host "Stopped." -ForegroundColor Yellow
}
