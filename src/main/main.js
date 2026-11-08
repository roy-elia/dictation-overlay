'use strict';
const path = require('path');
const { app, BrowserWindow, ipcMain, session, systemPreferences, clipboard, desktopCapturer, shell } = require('electron');
const { Config } = require('./config');
const { AudioDucker } = require('./audio/audioDucker');
const { Permissions } = require('./permissions');
const { JabraOnHead } = require('./jabra');
const { startUpdater, openDatabase } = require('./infra');
const { createTray, updateItem } = require('./tray');
const { buildAppMenu } = require('./appmenu');
const { createOverlay } = require('./overlay');
const { WhisperServer } = require('./speech/whisper');
const { DictationController } = require('./dictation/controller');
const { createInserter } = require('./dictation/insert');
const { createVocab } = require('./dictation/vocab');
const { ClaudeAI, MODELS, STYLES } = require('./ai/claude');
const { readSelection } = require('./ai/selection');
const { Meetings } = require('./meetings');
const input = require('input-control');

app.setName('RoyFlow');
// Self-tests run against a throwaway profile so they never touch real data.
if (process.env.DICTATION_SELFTEST) {
  app.setPath('userData', require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'royflow-selftest-')));
}
const log = console;
const ctx = { devices: [] }; // shared bits the tray/settings read
let config, ducker, permissions, store, vocab, ai, meetings, updater, trayUi, overlay, whisper, dictation, settingsWin, jabra = null;

// ---------- helpers ----------
function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
}
function trusted(event) {
  const url = event.senderFrame?.url || '';
  return url.startsWith('file://') && url.includes('/src/renderer/');
}
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error(`blocked IPC ${channel}`);
    return fn(...args);
  });
}
function listen(channel, fn) {
  ipcMain.on(channel, (event, payload) => { if (trusted(event)) fn(payload); });
}

// ---------- audio bridge to the pill renderer ----------
let audioSeq = 0;
const pendingAudio = new Map();
function audioCmd(op, extra = {}, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const id = ++audioSeq;
    pendingAudio.set(id, { resolve, reject });
    overlay.win.webContents.send('ev:audio-cmd', { id, op, ...extra });
    setTimeout(() => { if (pendingAudio.delete(id)) reject(new Error(`audio ${op} timed out`)); }, timeout);
  });
}
const audio = {
  start: async (deviceId) => {
    let mic = systemPreferences.getMediaAccessStatus('microphone');
    if (mic === 'not-determined') mic = (await systemPreferences.askForMediaAccess('microphone')) ? 'granted' : 'denied';
    if (mic !== 'granted') throw new Error('Allow microphone access for RoyFlow');
    const r = await audioCmd('start', { deviceId });
    if (r.fellBack) setTimeout(() => pillNotice('Your chosen mic isn’t connected, using the default'), 300);
    return r;
  },
  stop: async () => (await audioCmd('stop')).clip,
  cancel: () => audioCmd('cancel'),
  devices: async () => (await audioCmd('devices')).devices,
};

// ---------- onboarding ----------
let onboardWin = null;
function openOnboarding() {
  if (onboardWin && !onboardWin.isDestroyed()) { onboardWin.show(); onboardWin.focus(); return; }
  onboardWin = new BrowserWindow({
    title: 'Welcome to RoyFlow', width: 640, height: 600, resizable: false, titleBarStyle: 'hiddenInset',
    show: false, backgroundColor: '#14152a',
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  onboardWin.loadFile(path.join(__dirname, '..', 'renderer', 'onboarding.html'));
  onboardWin.once('ready-to-show', () => { app.dock?.show(); onboardWin.show(); });
  onboardWin.on('closed', () => { onboardWin = null; syncDock(); });
}

// ---------- scratchpad ----------
let scratchWin = null;
function openScratchpad() {
  if (scratchWin && !scratchWin.isDestroyed()) { scratchWin.show(); scratchWin.focus(); return; }
  scratchWin = new BrowserWindow({
    title: 'Scratchpad', width: 820, height: 580, minWidth: 560, minHeight: 360,
    titleBarStyle: 'hiddenInset', show: false, backgroundColor: '#14152a',
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  scratchWin.loadFile(path.join(__dirname, '..', 'renderer', 'scratchpad.html'));
  scratchWin.once('ready-to-show', () => { app.dock?.show(); scratchWin.show(); });
  scratchWin.on('closed', () => { scratchWin = null; syncDock(); });
}

// ---------- settings window ----------
function openSettings(tab = 'general') {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('ev:settings-tab', tab);
    settingsWin.show(); settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    title: 'RoyFlow Settings', width: 760, height: 560, minWidth: 640, minHeight: 440,
    titleBarStyle: 'hiddenInset', show: false, backgroundColor: '#14152a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'), { hash: tab });
  settingsWin.once('ready-to-show', () => { app.dock?.show(); settingsWin.show(); });
  settingsWin.on('closed', () => { settingsWin = null; syncDock(); });
}

function syncDock() {
  if (process.platform !== 'darwin') return;
  if (config.setting('showInDock') || settingsWin || scratchWin || onboardWin) app.dock?.show(); else app.dock?.hide();
}
function syncLoginItem() {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!config.setting('launchAtLogin') });
}

// ---------- hotkeys ----------
function startHotkeys() {
  input.setTrigger(config.setting('triggerKey'));
  const ok = input.start((ev) => dictation.onInput(ev));
  log.info('[input] event tap', ok ? 'running' : 'NOT running (needs Accessibility)');
  ctx.hotkeysOk = ok;
  trayUi?.render();
  return ok;
}

// ---------- Jabra (setting + flag) ----------
async function syncJabra() {
  const want = JabraOnHead.enabled(config);
  if (want && !jabra) {
    jabra = new JabraOnHead({ partnerKey: process.env.JABRA_PARTNER_KEY, log });
    jabra.on('on-head', (onHead) => {
      broadcast('ev:jabra', { onHead });
      if (onHead === false && dictation.state === 'listening') dictation.cancel();
    });
    try { await jabra.start(); } catch (e) { log.warn('[jabra] disabled:', e.message); jabra = null; }
  } else if (!want && jabra) {
    await jabra.stop(); jabra = null;
  }
}

// ---------- IPC ----------
function registerIpc() {
  handle('audio:result', (id, r) => {
    const p = pendingAudio.get(id);
    if (!p) return;
    pendingAudio.delete(id);
    r.ok ? p.resolve(r) : p.reject(new Error(r.error));
  });
  listen('audio:devices', (list) => { ctx.devices = list; trayUi?.render(); broadcast('ev:app-state', appState()); });

  handle('pill:action', (name) => {
    if (name === 'start') return dictation.start('handsfree');
    if (name === 'stop') return dictation.finish();
    if (name === 'cancel') return dictation.cancel();
    if (name === 'meeting-stop') return meetings.stop();
    if (name === 'meeting') return meetings.active ? meetings.stop() : meetings.start().catch((e) => pillNotice(e.message, true));
    if (name === 'meetings') return openSettings('meetings');
    if (name === 'history') return openSettings('history');
    if (name === 'see-changes') return openDiff();
    if (name === 'scratchpad') return openScratchpad();
    if (name === 'polish') return polishSelection(null);
    if (name === 'polish-menu') return trayUi.polishMenu().popup({ window: overlay.win });
    if (name === 'menu') return trayUi.pillMenu().popup({ window: overlay.win });
  });
  listen('pill:hover', (on) => overlay.setInteractive(on));
  listen('pill:drag', (d) => overlay.drag(d));
  listen('pill:menu', () => trayUi.pillMenu().popup({ window: overlay.win }));

  handle('app:request-mic', async () => {
    const ok = await systemPreferences.askForMediaAccess('microphone');
    broadcast('ev:app-state', appState());
    return ok;
  });
  handle('app:close-onboarding', () => onboardWin?.close());
  handle('app:notes-list', () => store.notes());
  handle('app:notes-save', (n) => store.saveNote(n || {}));
  handle('app:notes-delete', (id) => store.deleteNote(Number(id)));
  handle('app:notes-polish', (text) => {
    if (!ai.configured()) throw new Error('Add a Claude API key in Settings › AI Polish first');
    return ai.polish(String(text));
  });
  handle('pill:diff-data', () => lastPolish);
  handle('pill:diff-action', async (what) => {
    if (what === 'close') return diffWin?.close();
    if (!lastPolish) return;
    if (what === 'copy') return clipboard.writeText(lastPolish.before);
    if (what === 'undo') {
      // The diff panel never takes focus, so ⌘Z lands in the app we pasted into.
      input.pressKey('z', { cmd: true });
      if (lastPolish.kind === 'dictation') setTimeout(() => insertFn(lastPolish.before), 180);
    }
  });
  handle('settings:get', () => ({ settings: config.settings, flags: config.flags }));
  handle('settings:set', (key, value) => { config.set('settings', key, value); return config.settings; });
  handle('app:state', () => appState());
  handle('app:open-settings', (tab) => openSettings(tab));
  handle('app:download-model', () => { whisper.downloadModel(config.setting('whisperModel')).catch((e) => { ctx.download = { phase: 'error', error: e.message }; broadcast('ev:app-state', appState()); }); return true; });
  handle('permissions:status', () => permissions.refresh());

  // history
  handle('history:list', (term) => store.searchTranscripts(String(term || '').trim(), 300));
  handle('history:stats', () => store.stats());
  handle('history:apps', () => store.recentApps());
  handle('history:delete', (id) => store.deleteTranscript(Number(id)));
  handle('history:clear', () => store.clearTranscripts());
  handle('history:copy', (text) => clipboard.writeText(String(text)));

  // AI
  handle('ai:status', () => ({ configured: ai.configured(), savedKey: ai.hasSavedKey(), envKey: !!process.env.ANTHROPIC_API_KEY, models: MODELS, styles: Object.keys(STYLES) }));
  handle('ai:save-key', (k) => { if (!/^sk-ant-/.test(String(k).trim())) throw new Error('That doesn’t look like an Anthropic API key'); ai.saveKey(k); return true; });
  handle('ai:clear-key', () => { ai.clearKey(); return true; });
  handle('ai:test', () => ai.test());

  // meetings
  handle('meetings:chunk', (chunk) => meetings.onChunk(chunk));
  handle('meetings:status', () => meetings.status());
  handle('meetings:start', (title) => meetings.start(title));
  handle('meetings:stop', () => meetings.stop());
  handle('meetings:list', () => meetings.list());
  handle('meetings:get', (id) => meetings.get(Number(id)));
  handle('meetings:rename', (id, t) => meetings.rename(Number(id), t));
  handle('meetings:delete', (id) => meetings.delete(Number(id)));
  handle('meetings:summarize', (id) => meetings.summarize(Number(id)));
  handle('meetings:export', (id) => { const f = meetings.exportMarkdown(Number(id), app.getPath('downloads')); shell.showItemInFolder(f); return f; });
  handle('meetings:copy', (text) => clipboard.writeText(String(text)));

  // dictionary + snippets
  const vocabChanged = () => { vocab.invalidate(); broadcast('ev:vocab', null); trayUi?.render(); };
  handle('vocab:list', () => ({ words: store.words(), snippets: store.snippets() }));
  handle('vocab:add-word', (w) => { if (String(w).trim()) store.addWord(String(w)); vocabChanged(); });
  handle('vocab:delete-word', (id) => { store.deleteWord(Number(id)); vocabChanged(); });
  handle('vocab:save-snippet', (t, e) => { if (String(t).trim() && String(e)) store.saveSnippet(String(t), String(e)); vocabChanged(); });
  handle('vocab:delete-snippet', (id) => { store.deleteSnippet(Number(id)); vocabChanged(); });
  handle('permissions:guide', (panels) => permissions.walkThrough(panels));
}

function appState() {
  return {
    version: app.getVersion(),
    devices: ctx.devices,
    hotkeysOk: !!ctx.hotkeysOk,
    accessibility: input.isTrusted(false),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    whisper: { model: whisper.model, hasModel: whisper.hasModel(), coreml: whisper.hasCoreML(), running: !!whisper.proc, downloading: !!whisper.downloading, progress: ctx.download || null },
    lastTranscript: dictation.lastTranscript,
  };
}

function applyRetention() {
  const r = config.setting('historyRetention');
  if (r === '24h') store.pruneTranscripts(Date.now() - 864e5);
  if (r === 'never') store.db.prepare("UPDATE transcripts SET text = '', raw = NULL WHERE text != ''").run();
}

// ---------- boot ----------
app.whenReady().then(async () => {
  config = new Config();
  syncDock();
  syncLoginItem();
  ducker = new AudioDucker({ log });
  permissions = new Permissions();
  store = openDatabase();
  vocab = createVocab({ store, config });
  ai = new ClaudeAI({ config, log });
  ctx.stats = () => store.stats();
  whisper = new WhisperServer({ log });
  let lastBroadcast = 0;
  whisper.on('download', (d) => {
    ctx.download = d;
    if (d.phase === 'done' || Date.now() - lastBroadcast > 500) { lastBroadcast = Date.now(); broadcast('ev:app-state', appState()); }
  });
  applyRetention();
  setInterval(applyRetention, 60 * 60 * 1000);

  // The pill renderer captures the mic: allow media for our own pages only.
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media' && wc.getURL().startsWith('file://')));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'media');
  systemPreferences.askForMediaAccess('microphone').catch(() => false);

  overlay = createOverlay({ config, log });
  const insert = createInserter(input, log);
  insertFn = insert;
  dictation = new DictationController({
    audio, whisper, insert, ducker, config, input, vocab, ai, log,
    readSelection: () => readSelection(input),
  });

  meetings = new Meetings({
    store, whisper, ai, config, log,
    sendToPill: (op, opts = {}) => audioCmd(`meeting-${op}`, opts, 30000),
  });
  meetings.on('change', (st) => { overlay.win.webContents.send('ev:pill-meeting', st); broadcast('ev:meetings', st); trayUi?.render(); });
  meetings.on('saved', (m) => { broadcast('ev:meetings', m); trayUi?.render(); });
  meetings.on('transcript', (m) => broadcast('ev:meetings', m));
  // System audio for meeting notes: ScreenCaptureKit loopback, no picker.
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const [screen] = await desktopCapturer.getSources({ types: ['screen'] });
    cb(screen ? { video: screen, audio: 'loopback' } : {});
  });

  // Polish whatever is selected in the focused app, in place.
  polishSelection = async (style = null) => {
    if (dictation.state !== 'idle') return;
    if (!ai.configured()) return pillNotice('Add a Claude API key in Settings › AI', true);
    const sel = await readSelection(input);
    if (!sel.trim()) return pillNotice('Select some text first');
    overlay.win.webContents.send('ev:pill-state', { state: 'processing', stage: 'polish' });
    try {
      const out = await ai.polish(sel, style);
      await insert(out);
      const app = input.frontmostApp();
      lastPolish = { before: sel, after: out, app: app?.name || null, kind: 'selection' };
      if (config.setting('historyRetention') !== 'never') store.addTranscript(out, app?.bundleId || null, { raw: sel, kind: 'polish', appName: app?.name });
      overlay.win.webContents.send('ev:pill-state', { state: 'idle', polished: true });
    } catch (e) {
      pillNotice(e.message, true);
    }
  };

  dictation.on('state', (s) => { overlay.win.webContents.send('ev:pill-state', s); trayUi?.render(); if (s.state === 'listening') diffWin?.close(); });
  dictation.on('sound', (name) => { if (config.setting('soundsEnabled')) overlay.win.webContents.send('ev:sound', name); });
  dictation.on('pasteLast', () => dictation.lastTranscript && insert(dictation.lastTranscript));
  dictation.on('copyLast', () => dictation.lastTranscript && clipboard.writeText(dictation.lastTranscript));
  dictation.on('pressEnter', () => setTimeout(() => input.pressKey('return'), 120));
  dictation.on('transcript', ({ text, raw, seconds, kind, app }) => {
    if (kind === 'polish') lastPolish = { before: raw, after: text, app: app?.name || null, kind: 'dictation' };
    if (config.setting('historyRetention') !== 'never') store.addTranscript(text, app?.bundleId || null, { raw, seconds, kind, appName: app?.name || null });
    else store.addTranscript('', null, { seconds, words: (text.match(/\S+/g) || []).length }); // stats only, no text
    broadcast('ev:transcript', { text, seconds });
    trayUi?.render();
  });

  registerIpc();
  updater = startUpdater(log);
  trayUi = createTray({
    app, config, updater, dictation, overlay, ctx,
    onSettings: openSettings,
    onPermissions: () => permissions.walkThrough(['accessibility']).catch((e) => log.warn('[permissions]', e.message)),
    onPasteLast: () => dictation.lastTranscript && insert(dictation.lastTranscript),
    onCopyLast: () => dictation.lastTranscript && clipboard.writeText(dictation.lastTranscript),
    onPolishSelection: (style) => polishSelection(style),
    meetings: () => meetings,
    aiReady: () => ai.configured(),
    onScratchpad: () => openScratchpad(),
    onRender: () => trayUi && buildAppMenu({
      config, updater, dictation, meetings: () => meetings,
      stats: () => store.stats(),
      vocabCounts: () => ({ words: store.words().length, snippets: store.snippets().length }),
      onSettings: openSettings, onScratchpad: () => openScratchpad(),
      onPasteLast: () => dictation.lastTranscript && insert(dictation.lastTranscript),
      onCopyLast: () => dictation.lastTranscript && clipboard.writeText(dictation.lastTranscript),
      micMenu: trayUi.micMenu, languageMenu: trayUi.languageMenu, updateItem,
    }),
  });
  trayUi.render(); // first render happened before trayUi existed; build the app menu now

  // Hotkeys need Accessibility; walk the user there if missing, start once granted.
  if (!startHotkeys()) {
    if (config.setting('onboarded')) permissions.walkThrough(['accessibility']).catch(() => {});
    permissions.on('granted', (p) => { if (p === 'accessibility' && !ctx.hotkeysOk) startHotkeys(); });
  }
  permissions.on('relaunch-required', () => { app.relaunch(); app.exit(0); });

  const TRIGGER_LABEL = { fn: 'fn', rightOption: 'right ⌥', rightCommand: 'right ⌘' };
  const sendTrigger = () => overlay.win.webContents.send('ev:pill-trigger', TRIGGER_LABEL[config.setting('triggerKey')] || 'fn');
  config.on('change', (c) => { if (c.key === 'triggerKey') sendTrigger(); });
  overlay.win.webContents.once('did-finish-load', async () => {
    sendTrigger();
    ctx.devices = await audio.devices().catch(() => []);
    trayUi.render();
  });

  config.on('change', (c) => {
    broadcast('ev:settings', c);
    if (c.key.startsWith('jabra')) syncJabra();
    if (c.key === 'showInDock') syncDock();
    if (c.key === 'launchAtLogin') syncLoginItem();
    if (c.key === 'hidePill') overlay.setVisible(!c.value);
    if (c.key === 'triggerKey') input.setTrigger(c.value);
    if (c.key === 'pillEdge' && !c.fromDrag) overlay.place();
    if (c.key === 'historyRetention') applyRetention();
    if (c.key === 'whisperModel') whisper.start(c.value).catch(() => {});
    trayUi.render();
  });

  if (whisper.hasModel(config.setting('whisperModel'))) whisper.start(config.setting('whisperModel')).catch(() => {});
  if (!process.env.DICTATION_SELFTEST && (!config.setting('onboarded') || !whisper.hasModel(config.setting('whisperModel')))) openOnboarding();
  await syncJabra();
  if (process.env.DICTATION_SELFTEST) await selfTest();
});

// DICTATION_SELFTEST=1 npm start — headless checks, then quits.
async function selfTest() {
  const fs = require('fs');
  const t0 = Date.now();
  log.info('[selftest] state', appState());
  await whisper.start(config.setting('whisperModel'));
  log.info('[selftest] whisper up', `${Date.now() - t0}ms`);
  const wav = process.env.DICTATION_SELFTEST_WAV;
  if (wav && fs.existsSync(wav)) {
    const pcm = new Int16Array(fs.readFileSync(wav).buffer.slice(44));
    const t1 = Date.now();
    log.info('[selftest] transcript', JSON.stringify(await whisper.transcribe(pcm)), `${Date.now() - t1}ms`);
  }
  store.addTranscript('selftest', 'selftest');
  log.info('[selftest] db rows', store.recentTranscripts(1).length);

  // Meeting pipeline with the pill's audio stubbed: two chunks, then stop.
  if (wav && fs.existsSync(wav)) {
    const pcm = new Int16Array(fs.readFileSync(wav).buffer.slice(44));
    const realSend = meetings.sendToPill;
    meetings.sendToPill = async (op) => {
      if (op === 'stop') setTimeout(() => meetings.onChunk({ pcm: pcm.buffer.slice(0), seconds: pcm.length / 16000, final: true }), 50);
      return { systemAudio: false };
    };
    const st = await meetings.start('Self-test meeting');
    meetings.onChunk({ pcm: pcm.buffer.slice(0), seconds: pcm.length / 16000, final: false });
    await meetings.stop();
    await new Promise((r) => setTimeout(r, 200));
    await meetings.whenIdle(30000);
    const m = meetings.get(st.id);
    log.info('[selftest] meeting', JSON.stringify({ title: m.title, ended: !!m.ended_at, transcript: m.transcript }));
    meetings.sendToPill = realSend;
  }

  // DICTATION_SELFTEST_SHOTS=dir: render each pill state and save PNGs.
  const shots = process.env.DICTATION_SELFTEST_SHOTS;
  if (shots) {
    const wc = overlay.win.webContents;
    const states = [
      ['rest', { state: 'idle' }], ['listening-ptt', { state: 'listening', mode: 'ptt' }],
      ['listening-handsfree', { state: 'listening', mode: 'handsfree' }], ['processing', { state: 'processing' }],
      ['error', { state: 'error', notice: 'Allow microphone access for RoyFlow' }],
    ];
    for (const [name, s] of states) {
      wc.send('ev:pill-state', s);
      await new Promise((r) => setTimeout(r, 450));
      fs.writeFileSync(path.join(shots, `pill-${name}.png`), (await wc.capturePage()).toPNG());
    }
    wc.send('ev:pill-state', { state: 'idle' });
    await new Promise((r) => setTimeout(r, 3000)); // let the error notice clear
    await wc.executeJavaScript(`document.getElementById('dock').dispatchEvent(new MouseEvent('mouseenter'))`);
    await new Promise((r) => setTimeout(r, 450));
    fs.writeFileSync(path.join(shots, 'pill-ready.png'), (await wc.capturePage()).toPNG());
    for (const [name, sel] of [['tip-bubble', '#bubble'], ['tip-polish', '#t-polish .disc'], ['tip-meeting', '#t-meeting .disc']]) {
      await wc.executeJavaScript(`document.querySelector('${sel}').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
      await new Promise((r) => setTimeout(r, 400));
      fs.writeFileSync(path.join(shots, `pill-${name}.png`), (await wc.capturePage()).toPNG());
      await wc.executeJavaScript(`document.querySelector('${sel}').dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))`);
    }
    await wc.executeJavaScript(`document.getElementById('dock').dispatchEvent(new MouseEvent('mouseleave'))`);
    // Settings tabs (seeds a little sample data first).
    store.addWord('RoyFlow'); store.addWord('Dominic Bouffard');
    store.saveSnippet('my email', 'roy@example.com');
    store.addTranscript('Can we move the RoyFlow review to Thursday at 3pm? Thanks!', null, { seconds: 5.8 });
    vocab.invalidate();
    openSettings('general');
    await new Promise((r) => settingsWin.once('ready-to-show', r));
    for (const tab of ['general', 'vocab', 'history', 'ai', 'meetings']) {
      settingsWin.webContents.send('ev:settings-tab', tab);
      await new Promise((r) => setTimeout(r, 700));
      fs.writeFileSync(path.join(shots, `settings-${tab}.png`), (await settingsWin.webContents.capturePage()).toPNG());
    }
    // Pill toolbar + "Done · See changes"
    await wc.executeJavaScript(`document.getElementById('dock').dispatchEvent(new MouseEvent('mouseenter'))`);
    await new Promise((r) => setTimeout(r, 400));
    fs.writeFileSync(path.join(shots, 'pill-toolbar.png'), (await wc.capturePage()).toPNG());
    await wc.executeJavaScript(`document.getElementById('dock').dispatchEvent(new MouseEvent('mouseleave'))`);
    wc.send('ev:pill-state', { state: 'idle', polished: true });
    await new Promise((r) => setTimeout(r, 400));
    fs.writeFileSync(path.join(shots, 'pill-done.png'), (await wc.capturePage()).toPNG());

    // Diff popover
    lastPolish = { before: 'um so can we move the review to like thursday at 3', after: 'Can we move the review to Thursday at 3 PM?', app: 'Mail', kind: 'dictation' };
    openDiff();
    await new Promise((r) => diffWin.once('ready-to-show', r));
    await new Promise((r) => setTimeout(r, 500));
    fs.writeFileSync(path.join(shots, 'diff.png'), (await diffWin.webContents.capturePage()).toPNG());

    // Scratchpad (with a sample note)
    store.saveNote({ title: 'Ideas', body: 'Ship RoyFlow 0.3 with per-app formats.\nAsk Dominic about the review.' });
    openScratchpad();
    await new Promise((r) => scratchWin.once('ready-to-show', r));
    await new Promise((r) => setTimeout(r, 700));
    fs.writeFileSync(path.join(shots, 'scratchpad.png'), (await scratchWin.webContents.capturePage()).toPNG());

    // Onboarding pages
    openOnboarding();
    await new Promise((r) => onboardWin.once('ready-to-show', r));
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 600));
      fs.writeFileSync(path.join(shots, `onboarding-${i}.png`), (await onboardWin.webContents.capturePage()).toPNG());
      if (i < 4) await onboardWin.webContents.executeJavaScript(`document.getElementById('next').click()`);
    }
    log.info('[selftest] pill + settings screenshots in', shots);
  }
  app.quit();
}

// `kill`/launchd stop the app with SIGTERM; route it through a normal quit so
// audio is restored and Squirrel.Mac can install a downloaded update.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => app.quit());

let quitting = false;
let polishSelection = async () => {};
let lastPolish = null, diffWin = null, insertFn = () => {};
function openDiff() {
  if (!lastPolish) return;
  if (diffWin && !diffWin.isDestroyed()) { diffWin.webContents.send('ev:diff-refresh'); return diffWin.showInactive(); }
  const b = overlay.win.getBounds(), edge = config.setting('pillEdge');
  const W = 460, H = 280;
  const x = edge === 'right' ? b.x + b.width - W - 50 : edge === 'bottom' ? b.x + b.width / 2 - W / 2 : b.x + 50;
  const y = edge === 'bottom' ? b.y - H : b.y + 60;
  diffWin = new BrowserWindow({
    x: Math.round(x), y: Math.round(y), width: W, height: H, type: 'panel', frame: false, transparent: true,
    hasShadow: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  diffWin.setAlwaysOnTop(true, 'floating');
  diffWin.setHiddenInMissionControl(true);
  diffWin.loadFile(path.join(__dirname, '..', 'renderer', 'diff.html'));
  diffWin.once('ready-to-show', () => diffWin.showInactive());
  diffWin.on('closed', () => { diffWin = null; });
}
function pillNotice(notice, error = false) {
  overlay?.win.webContents.send('ev:pill-state', { state: error ? 'error' : 'idle', notice });
  if (error) setTimeout(() => overlay?.win.webContents.send('ev:pill-state', { state: 'idle' }), 2600);
}
app.on('before-quit', (e) => {
  permissions?.closeGuide();
  if (meetings?.active) {
    // Save the meeting first: stop capture, then wait for the last chunk + summary.
    e.preventDefault();
    return meetings.stop().then(() => new Promise((r) => setTimeout(r, 500))).then(() => meetings.whenIdle(45000)).finally(() => app.quit());
  }
  whisper?.stop();
  input.stop();
  if (quitting || dictation?.state !== 'listening') return;
  e.preventDefault(); // never leave audio muted/paused
  quitting = true;
  dictation.cancel(true).finally(() => app.quit());
});
app.on('window-all-closed', (e) => e.preventDefault()); // menu-bar app keeps running
