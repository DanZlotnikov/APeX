(function () {
  'use strict';

  const logStream   = document.getElementById('logStream');
  const logCount    = document.getElementById('logCount');
  const connInd     = document.getElementById('connIndicator');
  const connLabel   = document.getElementById('connLabel');
  const serverActionBtn   = document.getElementById('serverActionBtn');
  const serverActionLabel = document.getElementById('serverActionLabel');
  const serverDot         = document.getElementById('serverDot');
  const modeDropdownToggle = document.getElementById('modeDropdownToggle');
  const modeCurrentLabel   = document.getElementById('modeCurrentLabel');
  const modeDropdownMenu   = document.getElementById('modeDropdownMenu');
  const jobsBody    = document.getElementById('jobsBody');
  const jobCount    = document.getElementById('jobCount');
  const searchInput = document.getElementById('searchInput');
  const statusFilter   = document.getElementById('statusFilter');
  const exerciseFilter = document.getElementById('exerciseFilter');
  const sortSelect  = document.getElementById('sortSelect');
  const detailOverlay = document.getElementById('detailOverlay');
  const detailTitle = document.getElementById('detailTitle');
  const detailBody  = document.getElementById('detailBody');
  const detailClose = document.getElementById('detailClose');

  let logLineCount = 0;
  let autoScroll = true;
  let allJobs = [];
  let knownExercises = new Set();

  // ── Live log via WebSocket, auto-reconnect ─────────────────────────────

  function classifyLine(kind, message) {
    if (kind === 'system') return 'log-system';
    const m = message.toLowerCase();
    if (m.includes('traceback') || m.includes('failed') || m.includes('error')) return 'log-error';
    if (m.includes('warning')) return 'log-warn';
    if (m.includes('completed') || m.includes('ready')) return 'log-success';
    return '';
  }

  function appendLog(event) {
    const cls = classifyLine(event.type, event.message);
    const line = document.createElement('div');
    line.className = 'log-line ' + cls;
    const time = new Date(event.ts).toLocaleTimeString('en-GB');
    line.innerHTML = '<span class="log-time">' + time + '</span>' + escapeHtml(event.message);
    logStream.appendChild(line);
    logLineCount++;
    logCount.textContent = logLineCount + ' line' + (logLineCount === 1 ? '' : 's');

    // Cap DOM size so a long-running session doesn't slowly balloon memory.
    while (logStream.children.length > 2000) logStream.removeChild(logStream.firstChild);

    if (autoScroll) logStream.scrollTop = logStream.scrollHeight;
  }

  logStream.addEventListener('scroll', () => {
    const nearBottom = logStream.scrollHeight - logStream.scrollTop - logStream.clientHeight < 40;
    autoScroll = nearBottom;
  });

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  let ws = null;
  function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws/logs');

    ws.onopen = () => {
      connInd.className = 'conn-indicator connected';
      connLabel.textContent = 'Live';
    };
    ws.onclose = () => {
      connInd.className = 'conn-indicator error';
      connLabel.textContent = 'Reconnecting…';
      setTimeout(connectWebSocket, 1500);
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
    ws.onmessage = (evt) => {
      try { appendLog(JSON.parse(evt.data)); } catch (e) {}
    };
  }
  connectWebSocket();

  // ── Server start/stop + mode dropdown ───────────────────────────────

  let currentMode = 'continuous';
  let currentlyRunning = false;

  async function refreshStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      currentMode = data.mode;
      currentlyRunning = data.running;

      serverActionBtn.disabled = false;
      serverActionBtn.className = 'server-action-btn ' + (data.running ? 'running' : 'stopped');
      serverActionLabel.textContent = data.running ? 'Stop Server' : 'Start Server';

      modeDropdownToggle.disabled = false;
      modeCurrentLabel.textContent = data.mode === '30min' ? 'Every 30 min' : 'Continuous';
      document.querySelectorAll('.mode-option').forEach((opt) => {
        opt.classList.toggle('active', opt.getAttribute('data-mode') === data.mode);
      });
    } catch (e) {
      serverActionBtn.disabled = true;
      modeDropdownToggle.disabled = true;
    }
  }

  serverActionBtn.addEventListener('click', async () => {
    serverActionBtn.disabled = true;
    const wasRunning = currentlyRunning;
    serverActionLabel.textContent = wasRunning ? 'Stopping…' : 'Starting…';
    try {
      await fetch(wasRunning ? '/api/stop' : '/api/start', { method: 'POST' });
    } catch (e) {}
    setTimeout(refreshStatus, 800);
  });

  modeDropdownToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    modeDropdownMenu.classList.toggle('open');
  });

  document.querySelectorAll('.mode-option').forEach((opt) => {
    opt.addEventListener('click', async () => {
      modeDropdownMenu.classList.remove('open');
      const mode = opt.getAttribute('data-mode');
      if (mode === currentMode) return;
      modeCurrentLabel.textContent = 'Switching…';
      try {
        await fetch('/api/set-mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: mode }),
        });
      } catch (e) {}
      setTimeout(refreshStatus, 800);
    });
  });

  document.addEventListener('click', () => modeDropdownMenu.classList.remove('open'));

  refreshStatus();
  setInterval(refreshStatus, 5000);

  // ── Jobs table ───────────────────────────────────────────────────────

  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
           d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  // mm:ss between two ISO timestamps (processing time); if `endIso` is
  // missing, measures up to now (a still-processing job) — paired with the
  // 1s ticker below, this reads as a live-counting timer rather than a
  // value stuck until the next 4s poll.
  function fmtDuration(startIso, endIso) {
    if (!startIso) return '—';
    const start = new Date(startIso).getTime();
    const end = endIso ? new Date(endIso).getTime() : Date.now();
    const totalSec = Math.max(0, Math.floor((end - start) / 1000));
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    return String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }

  // mm:ss from a plain seconds count (video_jobs.duration_sec — the length
  // of the recorded clip itself, known at upload time; unrelated to how
  // long the worker took to process it).
  function fmtVideoLength(seconds) {
    if (seconds == null) return '—';
    const totalSec = Math.max(0, Math.round(seconds));
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    return String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }

  function exerciseLabel(key) {
    const labels = {
      squat: 'Squat', jump: 'Vertical Jump', vertical_jump: 'Vertical Jump',
      pullup: 'Pull-Up', pull_up: 'Pull-Up',
      push_up: 'Push-Up', ab_crunch: 'Ab Crunch',
    };
    return labels[key] || key || '—';
  }

  async function fetchJobs() {
    try {
      const res = await fetch('/api/jobs');
      const data = await res.json();
      allJobs = data.jobs || [];
      allJobs.forEach((j) => { if (j.exercise_type) knownExercises.add(j.exercise_type); });
      syncExerciseFilterOptions();
      renderJobs();
    } catch (e) {
      // transient — next poll will retry
    }
  }

  function syncExerciseFilterOptions() {
    const current = exerciseFilter.value;
    const existing = new Set(Array.from(exerciseFilter.options).map((o) => o.value));
    knownExercises.forEach((ex) => {
      if (!existing.has(ex)) {
        const opt = document.createElement('option');
        opt.value = ex;
        opt.textContent = exerciseLabel(ex);
        exerciseFilter.appendChild(opt);
      }
    });
    exerciseFilter.value = current;
  }

  function renderJobs() {
    const q = searchInput.value.trim().toLowerCase();
    const statusF = statusFilter.value;
    const exerciseF = exerciseFilter.value;
    const sortBy = sortSelect.value;

    let filtered = allJobs.filter((j) => {
      if (statusF && j.status !== statusF) return false;
      if (exerciseF && j.exercise_type !== exerciseF) return false;
      if (q) {
        const hay = [j.athlete_name, j.exercise_type, j.id, j.status].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'time_asc':  return (a.created_at || '').localeCompare(b.created_at || '');
        case 'athlete':   return (a.athlete_name || '').localeCompare(b.athlete_name || '');
        case 'exercise':  return (a.exercise_type || '').localeCompare(b.exercise_type || '');
        case 'status':    return (a.status || '').localeCompare(b.status || '');
        default:          return (b.created_at || '').localeCompare(a.created_at || ''); // time_desc
      }
    });

    jobCount.textContent = filtered.length + ' request' + (filtered.length === 1 ? '' : 's');
    jobsBody.innerHTML = '';

    if (filtered.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      tr.innerHTML = '<td colspan="9">No requests match the current filters.</td>';
      jobsBody.appendChild(tr);
      return;
    }

    for (const j of filtered) {
      const tr = document.createElement('tr');
      const isLive = j.status === 'processing' && j.started_at;
      const procCell = isLive
        ? '<td class="muted live-duration" data-started="' + j.started_at + '">' + fmtDuration(j.started_at, null) + '</td>'
        : '<td class="muted">' + fmtDuration(j.started_at, j.completed_at) + '</td>';
      tr.innerHTML =
        '<td><span class="status-pill ' + j.status + '"><span class="status-dot"></span>' + j.status + '</span></td>' +
        '<td class="athlete">' + escapeHtml(j.athlete_name || 'Unknown') + '</td>' +
        '<td>' + escapeHtml(exerciseLabel(j.exercise_type)) + '</td>' +
        '<td class="muted">' + (j.rep_count != null ? j.rep_count : '—') + '</td>' +
        '<td class="muted">' + (j.readiness_score != null ? j.readiness_score + '%' : '—') + '</td>' +
        '<td class="muted">' + fmtVideoLength(j.duration_sec) + '</td>' +
        procCell +
        '<td class="muted">' + fmtTime(j.recorded_at) + '</td>' +
        '<td class="muted">' + fmtTime(j.completed_at || j.started_at || j.created_at) + '</td>';
      tr.addEventListener('click', () => openDetail(j));
      jobsBody.appendChild(tr);
    }
  }

  // Ticks live-duration cells every second between polls, so a currently-
  // processing job's Process Time column counts up smoothly instead of
  // only refreshing every 4s. Cheap — only touches the specific cells
  // still marked live, no table re-render.
  setInterval(() => {
    document.querySelectorAll('.live-duration[data-started]').forEach((cell) => {
      cell.textContent = fmtDuration(cell.getAttribute('data-started'), null);
    });
  }, 1000);

  searchInput.addEventListener('input', renderJobs);
  statusFilter.addEventListener('change', renderJobs);
  exerciseFilter.addEventListener('change', renderJobs);
  sortSelect.addEventListener('change', renderJobs);

  fetchJobs();
  setInterval(fetchJobs, 4000);

  // ── Detail modal ─────────────────────────────────────────────────────

  function openDetail(job) {
    detailTitle.textContent = exerciseLabel(job.exercise_type) + ' — ' + (job.athlete_name || 'Unknown');
    const rows = [
      ['Status', job.status],
      ['Athlete', job.athlete_name],
      ['Exercise', exerciseLabel(job.exercise_type)],
      ['Reps', job.rep_count != null ? job.rep_count : '—'],
      ['Readiness', job.readiness_score != null ? job.readiness_score + '%' : '—'],
      ['Video length', fmtVideoLength(job.duration_sec)],
      ['Process time', fmtDuration(job.started_at, job.completed_at)],
      ['Recorded', fmtTime(job.recorded_at)],
      ['Created', fmtTime(job.created_at)],
      ['Started', fmtTime(job.started_at)],
      ['Completed', fmtTime(job.completed_at)],
      ['ID', job.id],
    ];
    let html = '<dl>';
    for (const [k, v] of rows) {
      html += '<dt>' + k + '</dt><dd>' + escapeHtml(String(v == null ? '—' : v)) + '</dd>';
    }
    html += '</dl>';

    if (job.error_message) {
      html += '<dt style="color:var(--danger);margin-bottom:0.4rem;">Error</dt><pre style="border-color:var(--danger);color:var(--danger)">' +
              escapeHtml(job.error_message) + '</pre>';
    }
    if (job.analysis_json) {
      html += '<div style="color:var(--muted);font-size:0.75rem;margin:0.8rem 0 0.4rem;">Analysis / biomechanics</div><pre>' +
              escapeHtml(JSON.stringify(job.analysis_json, null, 2)) + '</pre>';
    }

    detailBody.innerHTML = html;
    detailOverlay.classList.add('open');
  }

  detailClose.addEventListener('click', () => detailOverlay.classList.remove('open'));
  detailOverlay.addEventListener('click', (e) => {
    if (e.target === detailOverlay) detailOverlay.classList.remove('open');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') detailOverlay.classList.remove('open');
  });
})();
