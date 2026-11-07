'use strict';
const pill = document.getElementById('pill');
const label = document.getElementById('label');
const head = document.getElementById('head');
let recording = false;

function render(s) {
  recording = s.recording;
  pill.classList.toggle('rec', recording);
  label.textContent = recording ? 'Listening…' : 'Click to dictate';
}

// Clicking here must NOT steal focus from the text field you're dictating into:
// the window is a non-focusable NSPanel with _setPreventsActivation:YES.
pill.addEventListener('mousedown', async (e) => {
  e.preventDefault();
  render(recording ? await window.dictation.stop() : await window.dictation.start());
});

window.dictation.onState(render);
window.dictation.onJabra(({ onHead, device }) => {
  if (device) head.textContent = device.connected ? device.name : '';
  if (onHead !== undefined) head.textContent = onHead === null ? '' : onHead ? '🎧 on' : '🎧 off';
});

window.dictation.permissionStatus().then((st) => {
  const missing = Object.entries(st).filter(([, v]) => v === false).map(([k]) => k);
  if (missing.length) window.dictation.openPermissionGuide(missing);
});
