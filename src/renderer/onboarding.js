'use strict';
const rf = window.royflow;
const $ = (id) => document.getElementById(id);
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const row = (t, sub, right) => h('div', { class: 'row' }, h('div', { class: 't' }, t, sub ? h('small', {}, sub) : null), right);
const pill = (kind, text) => h('span', { class: `pill ${kind}` }, text);
const KEYS = [['fn', 'fn / 🌐 (recommended)'], ['rightOption', 'Right ⌥ Option'], ['rightCommand', 'Right ⌘ Command']];
const keyLabel = (k) => ({ fn: 'fn', rightOption: 'right ⌥', rightCommand: 'right ⌘' }[k] || 'fn');

let step = 0, S = {}, st = null, tried = false;

const PAGES = [
  // 0 welcome
  () => [
    h('img', { class: 'icon', src: '../assets/icon.png', alt: '' }),
    h('h1', {}, 'Welcome to RoyFlow'),
    h('p', { class: 'sub' }, 'Hold a key, talk, let go: your words appear wherever you’re typing. Speech is transcribed on this Mac.'),
    h('div', { class: 'card' },
      row('Dictate anywhere', 'Mail, Slack, docs, the browser — any text field.', ''),
      row('Your vocabulary', 'Names, jargon and snippets, learned once.', ''),
      row('Optional AI polish & meeting notes', 'With your own Claude API key.', '')),
  ],
  // 1 permissions
  () => [
    h('h1', {}, 'Two permissions'),
    h('p', { class: 'sub' }, 'RoyFlow needs to hear you, and to watch for your dictation key and paste the result.'),
    h('div', { class: 'card' },
      row('Microphone', 'Only while you dictate.',
        st.microphone === 'granted' ? pill('ok', 'Allowed') : h('button', { class: 'primary', onclick: async () => { await rf.call('app:request-mic'); refresh(); } }, 'Allow')),
      row('Accessibility', 'To detect your dictation key and paste text.',
        st.accessibility ? pill('ok', 'Allowed') : h('button', { class: 'primary', onclick: () => rf.call('permissions:guide', ['accessibility']) }, 'Open Settings…'))),
    h('p', { class: 'note' }, 'After you switch on RoyFlow under Accessibility, come back here; this page updates by itself.'),
  ],
  // 2 model
  () => {
    const w = st.whisper, p = w.progress;
    const mb = (n) => `${Math.round(n / 1e6)} MB`;
    let right;
    if (w.hasModel && !w.downloading) right = pill('ok', w.running ? 'Ready' : 'Loading…');
    else if (w.downloading && p?.total) right = pill('warn', `${p.phase === 'coreml' ? 'Encoder' : 'Model'} ${mb(p.done)} / ${mb(p.total)}`);
    else if (w.downloading) right = pill('warn', 'Starting…');
    else right = h('button', { class: 'primary', onclick: async () => { await rf.call('app:download-model'); refresh(); } }, 'Download');
    return [
      h('h1', {}, 'Speech model'),
      h('p', { class: 'sub' }, 'A one-time download so transcription runs on your Mac: about 574 MB, plus a 1.2 GB Neural Engine encoder on Apple silicon for speed.'),
      h('div', { class: 'card' }, row('Whisper large-v3-turbo', p?.phase === 'error' ? `Failed: ${p.error}` : 'Accurate, multilingual.', right)),
      h('p', { class: 'note' }, 'You can continue while it downloads.'),
    ];
  },
  // 3 key
  () => {
    const sel = h('select', {}, KEYS.map(([v, l]) => h('option', { value: v }, l)));
    sel.value = S.triggerKey || 'fn';
    sel.addEventListener('change', async () => { S = await rf.call('settings:set', 'triggerKey', sel.value); render(); });
    const k = keyLabel(S.triggerKey);
    return [
      h('h1', {}, 'Your dictation key'),
      h('p', { class: 'sub' }, `Hold ${k} to talk and let go to paste. Press ${k}+Space (or double-tap) for hands-free, and Esc to cancel.`),
      h('div', { class: 'card' }, row('Dictation key', null, sel)),
      (S.triggerKey || 'fn') === 'fn'
        ? h('p', { class: 'note' }, 'Using fn? In System Settings › Keyboard, set “Press 🌐 key to” to “Do Nothing”, so it doesn’t also open the emoji picker.')
        : null,
    ];
  },
  // 4 try it
  () => {
    const ta = h('textarea', { id: 'try', placeholder: `Click here, hold ${keyLabel(S.triggerKey)}, and say “Hello from RoyFlow”.` });
    setTimeout(() => ta.focus(), 50);
    return [
      h('h1', {}, tried ? 'You’re all set' : 'Try it'),
      h('p', { class: 'sub' }, tried ? 'That’s it. RoyFlow lives in your menu bar and as a small handle on the edge of your screen.' : 'Your words will appear in the box below.'),
      ta,
      h('p', { class: 'note' }, 'Tip: right-click the handle for quick options, or open Settings from the menu bar icon.'),
    ];
  },
];

function render() {
  $('steps').replaceChildren(...PAGES.map((_, i) => h('i', { class: i <= step ? 'on' : '' })));
  $('page').replaceChildren(...PAGES[step]().filter(Boolean));
  $('back').style.visibility = step ? 'visible' : 'hidden';
  $('next').textContent = step === PAGES.length - 1 ? 'Finish' : 'Continue';
}
async function refresh() {
  [st, S] = await Promise.all([rf.call('app:state'), rf.call('settings:get').then((r) => r.settings)]);
  const dark = (S.theme || 'system') === 'dark' || ((S.theme || 'system') === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (step !== 4) render(); // don't wipe the try-it box
}
$('next').onclick = async () => {
  if (step < PAGES.length - 1) { step++; render(); return; }
  await rf.call('settings:set', 'onboarded', true);
  rf.call('app:close-onboarding');
};
$('back').onclick = () => { if (step) { step--; render(); } };
rf.on('ev:app-state', refresh);
rf.on('ev:transcript', () => { if (step === 4 && !tried) { tried = true; const v = $('try').value; render(); $('try').value = v; } });
setInterval(() => { if (step === 1) refresh(); }, 1500); // pick up permission changes
refresh().then(render);
