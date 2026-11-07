'use strict';
const api = window.royflow;
const dock = document.getElementById('dock');
const bubble = document.getElementById('bubble');
const wave = bubble.querySelector('.wave');
const tip = document.getElementById('tip');
const meetingTool = document.getElementById('t-meeting');

const BARS = 9;
for (let i = 0; i < BARS; i++) wave.appendChild(document.createElement('i'));
const bars = [...wave.children];

let model = { state: 'idle', mode: null };
let meeting = { active: false };
let hovering = false, dragging = false, notice = null, noticeTimer = null, live = false;
const edge = () => (document.body.classList.contains('edge-bottom') ? 'bottom' : document.body.classList.contains('edge-right') ? 'right' : 'left');
const clock = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(s).padStart(2, '0'); };

// ---------- render ----------
function render() {
  const { state, mode } = model;
  let cls = 'rest';
  if (state === 'listening') cls = `listening ${mode}${live ? ' live' : ''}`;
  else if (state === 'processing') cls = 'processing';
  else if (state === 'error') cls = 'error';
  else if (meeting.active) cls = 'meeting';
  else if (hovering) cls = 'ready';
  bubble.className = cls + (dragging ? ' dragging' : '');

  const idle = state === 'idle' || state === 'error';
  dock.classList.toggle('open', hovering && idle && !dragging);

  meetingTool.classList.toggle('on', meeting.active);
  meetingTool.querySelector('.disc').dataset.tip = meeting.active ? `Stop meeting notes · ${clock(Date.now() - meeting.startedAt)}` : 'Start meeting notes';
  bubble.dataset.tip = state === 'listening'
    ? (mode === 'handsfree' ? 'Press <b>fn</b> to finish and paste' : mode === 'command' ? 'Say what to do with the selection' : 'Release <b>fn</b> to paste')
    : meeting.active ? `Meeting notes · ${clock(Date.now() - meeting.startedAt)}` : 'Dictate <b>fn</b>';
  if (tipFor && !notice) showTip(tipFor);
}

// ---------- tooltip ----------
let tipFor = null, tipTimer = null, tipShown = null;
function showTip(el, html = el?.dataset.tip, kind = '') {
  if (!el || !html) return hideTip();
  tipShown = { el, html, kind };
  tip.innerHTML = html;
  tip.className = `on ${kind}`;
  const r0 = el.getBoundingClientRect();
  // Never cover the pill: cap the width to the room on our side, ellipsize the rest.
  tip.style.maxWidth = edge() === 'bottom' ? `${innerWidth - 8}px` : `${innerWidth - (r0.left + 30 + 10) - 6}px`;
  const r = r0, t = tip.getBoundingClientRect(), gap = 10;
  let x, y;
  // Use the element's settled thickness (30 pt) so a bubble that's still
  // animating out of its 6 pt rest handle doesn't put the tip on top of it.
  const thick = Math.max(30, el === bubble ? 30 : 0);
  if (edge() === 'left') { x = r.left + Math.max(r.width, thick) + gap; y = r.top + r.height / 2 - t.height / 2; }
  else if (edge() === 'right') { x = r.right - Math.max(r.width, thick) - gap - t.width; y = r.top + r.height / 2 - t.height / 2; }
  else { x = r.left + r.width / 2 - t.width / 2; y = r.bottom - Math.max(r.height, thick) - gap - t.height; }
  tip.style.left = `${edge() === 'bottom' ? Math.max(4, Math.min(innerWidth - t.width - 4, x)) : Math.max(4, x)}px`;
  tip.style.top = `${Math.max(4, y)}px`;
}
function hideTip() { tip.className = ''; tipFor = null; tipShown = null; }
// The bubble animates its size; re-anchor the tooltip once it settles.
bubble.addEventListener('transitionend', () => { if (tipShown) showTip(tipShown.el, tipShown.html, tipShown.kind); });

document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (!el || el === tipFor || notice || dragging) return;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => { tipFor = el; showTip(el); }, el === bubble ? 150 : 60);
});
document.addEventListener('mouseout', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el && !el.contains(e.relatedTarget)) { clearTimeout(tipTimer); if (!notice) hideTip(); }
});

function showNotice(text, error = false) {
  clearTimeout(noticeTimer);
  notice = text;
  showTip(bubble, text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])), error ? 'error' : 'notice');
  noticeTimer = setTimeout(() => { notice = null; hideTip(); }, error ? 2800 : 1800);
}

// ---------- live waveform ----------
const history = new Array(BARS).fill(0);
const vertical = () => edge() !== 'bottom';
window.rfAudio.onLevel((rms) => {
  if (!live) { live = true; render(); }
  history.push(Math.min(1, rms * 10)); history.shift();
  // symmetric: loudest in the middle bar
  bars.forEach((b, i) => {
    const w = history[(i + BARS - 1) % BARS] * (1 - Math.abs(i - (BARS - 1) / 2) / BARS);
    const px = `${3 + Math.round(w * 15)}px`;
    if (vertical()) { b.style.width = px; b.style.height = ''; } else { b.style.height = px; b.style.width = ''; }
  });
});

// ---------- state from main ----------
api.onPillState((s) => {
  if (s.state === 'listening' && model.state !== 'listening') live = false;
  model = s;
  if (s.state !== 'listening') { history.fill(0); bars.forEach((b) => { b.style.width = b.style.height = ''; }); }
  render();
  if (s.notice) showNotice(s.notice, s.state === 'error');
});
api.onPillEdge((e) => { document.body.className = `edge-${e}`; render(); });
api.onSound((name) => window.rfAudio.play(name));
api.on('ev:pill-meeting', (m) => { meeting = m; render(); });
setInterval(() => { if (meeting.active) render(); }, 1000);

// ---------- audio commands from main ----------
api.onAudioCommand(async ({ id, op, deviceId, ...opts }) => {
  try {
    if (op === 'start') { await window.rfAudio.start(deviceId); return api.audioResult(id, { ok: true }); }
    if (op === 'stop') return api.audioResult(id, { ok: true, clip: await window.rfAudio.stop() });
    if (op === 'cancel') { await window.rfAudio.cancel(); return api.audioResult(id, { ok: true }); }
    if (op === 'devices') return api.audioResult(id, { ok: true, devices: await window.rfAudio.listDevices() });
    if (op === 'meeting-start') {
      const r = await window.rfMeeting.start(opts, (chunk) => api.call('meetings:chunk', chunk));
      return api.audioResult(id, { ok: true, ...r });
    }
    if (op === 'meeting-stop') { await window.rfMeeting.stop(true); return api.audioResult(id, { ok: true }); }
  } catch (e) {
    api.audioResult(id, { ok: false, error: e.message });
  }
});
navigator.mediaDevices.addEventListener('devicechange', async () => api.devicesChanged(await window.rfAudio.listDevices()));

// ---------- hover = clickable window ----------
dock.addEventListener('mouseenter', () => { hovering = true; api.pillHover(true); render(); });
dock.addEventListener('mouseleave', () => { hovering = false; if (!dragging) { api.pillHover(false); if (!notice) hideTip(); } render(); });

// ---------- clicks + dragging the bubble ----------
let down = null;
dock.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  down = { x: e.screenX, y: e.screenY, action: e.target.closest('[data-action]')?.dataset.action, onBubble: !!e.target.closest('#bubble') };
});
window.addEventListener('mousemove', (e) => {
  if (!down) return;
  if (!dragging && down.onBubble && !down.action && model.state === 'idle' && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
    dragging = true; hideTip();
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
  if (d.action) { hideTip(); return api.pillAction(d.action); }
  if (!d.onBubble) return;
  if (meeting.active && model.state === 'idle') return api.pillAction('meetings');
  if (model.state === 'idle') api.pillAction('start');
  else if (model.state === 'listening') api.pillAction('stop');
});
dock.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.pillAction(e.target.closest('#t-polish') ? 'polish-menu' : 'menu');
});

render();
