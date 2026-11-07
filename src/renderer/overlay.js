'use strict';
const api = window.royflow;
const pill = document.getElementById('pill');
const label = pill.querySelector('.label');
const wave = pill.querySelector('.wave');

const BARS = 14;
for (let i = 0; i < BARS; i++) wave.appendChild(document.createElement('i'));
const bars = [...wave.children];

let model = { state: 'idle', mode: null };
let hovering = false, noticeTimer = null, notice = null;

function render() {
  const { state, mode } = model;
  let cls = 'rest';
  if (notice) cls = notice.error ? 'error' : 'notice';
  else if (state === 'listening') cls = `listening ${mode}`;
  else if (state === 'processing') cls = 'processing';
  else if (hovering) cls = 'ready';
  pill.className = cls + (dragging ? ' dragging' : '');

  if (notice) label.textContent = notice.text;
  else if (state === 'processing') label.textContent = { polish: 'Polishing', command: 'Applying' }[model.stage] || 'Transcribing';
  else if (cls === 'ready') label.innerHTML = 'Hold <b>fn</b> to talk';
  else label.textContent = '';
}

function showNotice(text, error = false) {
  clearTimeout(noticeTimer);
  notice = { text, error };
  render();
  noticeTimer = setTimeout(() => { notice = null; render(); }, error ? 2500 : 1600);
}

// ---- live waveform from mic levels ----
const history = new Array(BARS).fill(0);
window.rfAudio.onLevel((rms) => {
  history.push(Math.min(1, rms * 9)); history.shift();
  bars.forEach((b, i) => { b.style.height = `${3 + Math.round(history[i] * 15)}px`; });
});

// ---- state from main ----
api.onPillState((s) => {
  model = s;
  if (s.notice) showNotice(s.notice, s.state === 'error');
  if (s.state !== 'listening') history.fill(0);
  render();
});
api.onPillEdge((edge) => { document.body.className = `edge-${edge}`; });
api.onSound((name) => window.rfAudio.play(name));

// ---- audio commands from main ----
api.onAudioCommand(async ({ id, op, deviceId }) => {
  try {
    if (op === 'start') { await window.rfAudio.start(deviceId); return api.audioResult(id, { ok: true }); }
    if (op === 'stop') return api.audioResult(id, { ok: true, clip: await window.rfAudio.stop() });
    if (op === 'cancel') { await window.rfAudio.cancel(); return api.audioResult(id, { ok: true }); }
    if (op === 'devices') return api.audioResult(id, { ok: true, devices: await window.rfAudio.listDevices() });
  } catch (e) {
    api.audioResult(id, { ok: false, error: e.message });
  }
});
navigator.mediaDevices.addEventListener('devicechange', async () => api.devicesChanged(await window.rfAudio.listDevices()));

// ---- hover = make the window clickable ----
pill.addEventListener('mouseenter', () => { hovering = true; api.pillHover(true); render(); });
pill.addEventListener('mouseleave', () => { hovering = false; if (!dragging) api.pillHover(false); render(); });

// ---- click vs drag ----
let down = null, dragging = false;
pill.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  down = { x: e.screenX, y: e.screenY, target: e.target.closest('[data-action]') };
});
window.addEventListener('mousemove', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4;
  if (!dragging && moved && model.state === 'idle') {
    dragging = true;
    api.pillDrag({ phase: 'start', x: down.x, y: down.y });
    render();
  }
  if (dragging) api.pillDrag({ phase: 'move', x: e.screenX, y: e.screenY });
});
window.addEventListener('mouseup', (e) => {
  if (!down) return;
  const d = down; down = null;
  if (dragging) {
    dragging = false;
    api.pillDrag({ phase: 'end', x: e.screenX, y: e.screenY });
    if (!hovering) api.pillHover(false);
    return render();
  }
  if (d.target) return api.pillAction(d.target.dataset.action);
  if (model.state === 'idle') api.pillAction('start');
  else if (model.state === 'listening') api.pillAction('stop');
});
pill.addEventListener('contextmenu', (e) => { e.preventDefault(); api.pillMenu(); });

render();
