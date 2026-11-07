'use strict';
const rf = window.royflow;
const main = document.getElementById('main');

// ---------- tiny DOM helpers ----------
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const header = (title, sub) => [h('h1', {}, title), sub ? h('p', { class: 'sub' }, sub) : null];
const row = (title, sub, control) => h('div', { class: 'row' }, h('div', { class: 't' }, title, sub ? h('small', {}, sub) : null), control);
function toggle(checked, onChange, disabled = false) {
  const i = h('input', { type: 'checkbox', disabled });
  i.checked = !!checked;
  i.addEventListener('change', () => onChange(i.checked));
  return h('label', { class: 'sw' }, i, h('span'));
}
function select(options, value, onChange) {
  const s = h('select', {}, options.map(([v, l]) => h('option', { value: v ?? '' }, l)));
  s.value = value ?? '';
  s.addEventListener('change', () => onChange(s.value || null));
  return s;
}
const keys = (...k) => h('span', { class: 'keys' }, k.flatMap((x, i) => (i ? [' + ', h('kbd', {}, x)] : [h('kbd', {}, x)])));
const status = (kind, text) => h('span', { class: `pill ${kind}` }, text);
const fmtDate = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

let S = {};           // settings snapshot
const set = async (k, v) => { S = await rf.call('settings:set', k, v); };

// ---------- General ----------
const LANGS = [
  ['en', 'English'], ['fr', 'French'], ['es', 'Spanish'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'],
  ['nl', 'Dutch'], ['ar', 'Arabic'], ['he', 'Hebrew'], ['tr', 'Turkish'], ['ru', 'Russian'], ['uk', 'Ukrainian'],
  ['pl', 'Polish'], ['sv', 'Swedish'], ['no', 'Norwegian'], ['da', 'Danish'], ['fi', 'Finnish'], ['el', 'Greek'],
  ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['hi', 'Hindi'], ['ur', 'Urdu'], ['fa', 'Persian'],
  ['vi', 'Vietnamese'], ['th', 'Thai'], ['id', 'Indonesian'], ['ms', 'Malay'], ['tl', 'Tagalog'], ['ro', 'Romanian'],
];

function modelRow(st) {
  const w = st.whisper, p = w.progress;
  const mb = (n) => `${Math.round(n / 1e6)} MB`;
  let sub = `${w.model}${w.coreml ? ' · Neural Engine' : ''}`;
  let right;
  if (w.downloading && p && p.total) {
    sub = `Downloading ${p.phase === 'coreml' ? 'Neural Engine encoder' : 'speech model'}: ${mb(p.done)} of ${mb(p.total)}`;
    right = status('warn', `${Math.floor((p.done / p.total) * 100)}%`);
  } else if (w.downloading) {
    right = status('warn', 'Starting…');
  } else if (!w.hasModel) {
    sub = 'Needs a one-time download (~574 MB, plus ~1.2 GB Neural Engine encoder on Apple silicon). Stays on this Mac.';
    right = h('button', { class: 'primary', onclick: async () => { await rf.call('app:download-model'); render(); } }, 'Download');
  } else {
    right = status(w.running ? 'ok' : 'warn', w.running ? 'Loaded' : 'Loading…');
  }
  if (p?.phase === 'error') sub = `Download failed: ${p.error}`;
  return row('Speech model', sub, right);
}

const FORMATS = [['formatted', 'Formatted'], ['casual', 'Casual: no final period, lowercase start'], ['lowercase', 'lowercase'], ['raw', 'Raw: no punctuation'], ['polish', 'AI polish (Claude)']];
const TRIGGERS = [['fn', 'fn / 🌐'], ['rightOption', 'Right ⌥ Option'], ['rightCommand', 'Right ⌘ Command']];

async function outputSection() {
  const apps = await rf.call('history:apps');
  const rules = S.appFormats || [];
  const saveRules = (r) => set('appFormats', r).then(render);
  const known = new Set(rules.map((r) => r.bundleId));
  const candidates = apps.filter((a) => !known.has(a.bundleId));
  const add = select([[null, candidates.length ? 'Add a rule for an app…' : 'Dictate into an app to add a rule for it'], ...candidates.map((a) => [a.bundleId, a.name || a.bundleId])], null, (id) => {
    const a = candidates.find((c) => c.bundleId === id);
    if (a) saveRules([...rules, { bundleId: a.bundleId, name: a.name || a.bundleId, format: 'casual' }]);
  });
  return [
    h('h2', {}, 'Output'),
    h('div', { class: 'card' },
      row('Default format', 'How dictated text is written, unless an app has its own rule.', select(FORMATS, S.defaultFormat || 'formatted', (v) => set('defaultFormat', v))),
      ...rules.map((r, i) => row(r.name, r.bundleId,
        h('div', { style: 'display:flex;gap:6px;align-items:center' },
          select(FORMATS, r.format, (v) => saveRules(rules.map((x, j) => (j === i ? { ...x, format: v } : x)))),
          h('button', { class: 'danger', onclick: () => saveRules(rules.filter((_, j) => j !== i)) }, 'Remove')))),
      h('div', { class: 'row' }, add)),
    h('p', { class: 'note' }, 'Example: Casual for Slack and Messages, AI polish for Mail.'),
  ];
}

async function renderGeneral() {
  const st = await rf.call('app:state');
  const key = { fn: 'fn', rightOption: 'right ⌥', rightCommand: 'right ⌘' }[S.triggerKey] || 'fn';
  const langs = S.languages || [];
  const chips = h('div', { class: 'chips' },
    h('span', { class: `chip ${langs.length ? '' : 'on'}`, onclick: async () => { await set('languages', []); render(); } }, 'Detect automatically'),
    LANGS.map(([c, n]) => h('span', {
      class: `chip ${langs.includes(c) ? 'on' : ''}`,
      onclick: async () => { await set('languages', langs.includes(c) ? langs.filter((x) => x !== c) : [...langs, c]); render(); },
    }, n)));

  return [
    ...header('General', 'Dictate anywhere: hold fn, speak, let go.'),
    h('h2', {}, 'Status'),
    h('div', { class: 'card' },
      row('Keyboard shortcut', st.hotkeysOk ? 'The fn key is being watched.' : 'Needs Accessibility permission to watch the fn key.',
        st.hotkeysOk ? status('ok', 'Working') : h('button', { onclick: () => rf.call('permissions:guide', ['accessibility']) }, 'Grant Access…')),
      row('Microphone access', null, status(st.microphone === 'granted' ? 'ok' : 'bad', st.microphone === 'granted' ? 'Allowed' : 'Not allowed')),
      modelRow(st)),

    h('h2', {}, 'Shortcuts'),
    h('div', { class: 'card' },
      row('Dictation key', 'Hold it to talk.', select(TRIGGERS, S.triggerKey || 'fn', async (v) => { await set('triggerKey', v); render(); })),
      row('Push to talk', 'Hold, speak, release to paste.', keys(key)),
      row('Hands-free', `Or double-tap ${key}. Press it again to finish.`, keys(key, 'Space')),
      row('Voice command', 'Edit the selected text by voice (needs AI).', keys('⌃', key)),
      row('Cancel', 'While dictating.', keys('Esc')),
      row('Paste last transcript', null, keys('⌘', '⌃', 'V')),
      row('Copy last transcript', null, keys('⌘', '⌃', 'C'))),
    h('p', { class: 'note' }, 'Tip: in System Settings › Keyboard, set “Press 🌐 key to” to “Do Nothing” so fn doesn’t also open the emoji picker.'),

    h('h2', {}, 'Microphone'),
    h('div', { class: 'card' },
      row('Input device', null, select([[null, 'System default'], ...st.devices.map((d) => [d.id, d.label])], S.micDeviceId, (v) => set('micDeviceId', v)))),

    h('h2', {}, 'Languages'),
    h('div', { class: 'card' }, chips),
    h('p', { class: 'note' }, 'Pick one language to lock it in (faster, more accurate). Pick none to detect automatically.'),

    ...(await outputSection()),

    h('h2', {}, 'Behaviour'),
    h('div', { class: 'card' },
      row('Play sounds', 'Short tones when dictation starts and stops.', toggle(S.soundsEnabled, (v) => set('soundsEnabled', v))),
      row('Mute audio while dictating', 'Pauses music players, otherwise mutes system output.', toggle(S.muteAudioWhileDictating, (v) => set('muteAudioWhileDictating', v))),
      row('“Press enter” voice command', 'End a dictation with “press enter” to send it.', toggle(S.pressEnterCommand, (v) => set('pressEnterCommand', v)))),

    h('h2', {}, 'Appearance & System'),
    h('div', { class: 'card' },
      row('Show dictation pill', null, toggle(!S.hidePill, (v) => set('hidePill', !v))),
      row('Pill position', 'You can also drag the pill to any edge.', select([['bottom', 'Bottom'], ['left', 'Left edge'], ['right', 'Right edge']], S.pillEdge, (v) => set('pillEdge', v))),
      row('Launch at login', null, toggle(S.launchAtLogin, (v) => set('launchAtLogin', v))),
      row('Show in Dock', null, toggle(S.showInDock, (v) => set('showInDock', v))),
      row('Appearance', 'For Settings and Scratchpad.', select([['system', 'Match system'], ['dark', 'Dark'], ['light', 'Light']], S.theme || 'system', async (v) => { await set('theme', v); applyTheme(); }))),
  ];
}

// Other tabs register themselves here (vocab.js, history.js, ai.js, meetings.js).
const TABS = { general: renderGeneral };
window.rfSettings = { TABS, h, row, toggle, select, status, header, set, fmtDate, get S() { return S; }, render: () => render() };

function applyTheme() {
  const t = S.theme || 'system';
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
window.rfSettings.applyTheme = applyTheme;

let current = (location.hash || '#general').slice(1);
function go(tab) {
  const [name, arg] = String(tab).split(':');
  current = name;
  window.rfSettings.arg = arg ? Number(arg) : null;
}
go(current);
async function render() {
  S = (await rf.call('settings:get')).settings;
  applyTheme();
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.dataset.tab === current));
  const fn = TABS[current] || (() => [...header('Coming soon')]);
  const nodes = await fn();
  main.replaceChildren(...nodes.filter(Boolean));
}
document.querySelectorAll('nav a').forEach((a) => a.addEventListener('click', () => { current = a.dataset.tab; render(); }));
rf.on('ev:settings-tab', (tab) => { go(tab); render(); });
rf.on('ev:app-state', () => { if (current === 'general') render(); });
rf.call('app:state').then((st) => { document.getElementById('version').textContent = `Version ${st.version}`; });
// Defer first render so tab scripts loaded after this one can register.
window.addEventListener('DOMContentLoaded', render);
