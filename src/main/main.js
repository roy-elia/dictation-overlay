'use strict';
const path = require('path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const IPC = require('../shared/ipc');
const { Config } = require('./config');
const { AudioDucker } = require('./audio/audioDucker');
const { Permissions } = require('./permissions');
const { JabraOnHead } = require('./jabra');
const { startUpdater, openDatabase } = require('./infra');
const { preventActivation } = require('panel-activation');

const log = console;
let overlay = null;
let config, ducker, permissions, store, jabra = null;
const state = { recording: false };

// ---------- overlay window ----------
function createOverlay() {
  const { workArea } = screen.getPrimaryDisplay();
  const W = 220, H = 56;
  overlay = new BrowserWindow({
    title: 'DictationPill',
    type: 'panel',               // NSPanel on macOS
    width: W, height: H,
    x: Math.round(workArea.x + (workArea.width - W) / 2),
    y: workArea.y + workArea.height - H - 24,
    frame: false, transparent: true, hasShadow: false, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false,
    focusable: false,            // never becomes key
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  overlay.setAlwaysOnTop(true, 'floating');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));

  overlay.once('ready-to-show', () => {
    applyPreventActivation();
    overlay.showInactive();      // show without activating our app
  });
}

function applyPreventActivation() {
  const res = preventActivation(overlay.getNativeWindowHandle(), {
    allowOnMacOS27: config.flag('panelPreventActivationMacOS27'),
  });
  log.info('[focus] preventActivation:', res);
}

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
}

// ---------- dictation lifecycle ----------
async function startDictation() {
  if (state.recording) return state;
  state.recording = true;
  broadcast(IPC.EV_DICTATION_STATE, state);
  if (config.setting('muteAudioWhileDictating')) await ducker.duck().catch((e) => log.warn(e));
  return state;
}

async function stopDictation() {
  if (!state.recording) return state;
  state.recording = false;
  broadcast(IPC.EV_DICTATION_STATE, state);
  await ducker.restore().catch((e) => log.warn(e));
  return state;
}

// ---------- Jabra (setting + flag) ----------
async function syncJabra() {
  const want = JabraOnHead.enabled(config);
  if (want && !jabra) {
    jabra = new JabraOnHead({ partnerKey: process.env.JABRA_PARTNER_KEY, log });
    jabra.on('on-head', (onHead) => {
      broadcast(IPC.EV_JABRA, { onHead });
      if (onHead === false && state.recording) stopDictation();
    });
    jabra.on('device', (d) => broadcast(IPC.EV_JABRA, { device: d }));
    try { await jabra.start(); } catch (e) { log.warn('[jabra] disabled:', e.message); jabra = null; }
  } else if (!want && jabra) {
    await jabra.stop(); jabra = null;
  }
}

// ---------- IPC ----------
function trusted(event) {
  // Only our own bundled pages may call privileged handlers.
  const url = event.senderFrame?.url || '';
  return url.startsWith('file://') && url.includes('/src/renderer/');
}
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error(`blocked IPC ${channel}`);
    return fn(...args);
  });
}

function registerIpc() {
  handle(IPC.DICTATION_START, startDictation);
  handle(IPC.DICTATION_STOP, stopDictation);
  handle(IPC.SETTINGS_GET, () => ({ settings: config.settings, flags: config.flags }));
  handle(IPC.SETTINGS_SET, (key, value) => { config.set('settings', key, value); return config.settings; });
  handle(IPC.PERMISSIONS_STATUS, () => permissions.refresh());
  handle(IPC.PERMISSIONS_GUIDE, (panels) => {
    if (!config.flag('permissionGuideOverlay')) return { error: 'flag-off' };
    return permissions.walkThrough(panels);
  });
  handle(IPC.TRANSCRIPT_ADD, (text, targetApp) => store.addTranscript(String(text), targetApp));
  handle(IPC.TRANSCRIPT_RECENT, (n) => store.recentTranscripts(Number(n) || 20));
}

// ---------- boot ----------
app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.hide(); // accessory-style app
  config = new Config();
  ducker = new AudioDucker({ log });
  permissions = new Permissions();
  store = openDatabase();

  registerIpc();
  createOverlay();
  startUpdater(log);

  permissions.on('granted', (p) => broadcast(IPC.EV_PERMISSIONS, { granted: p, all: permissions.last }));
  permissions.on('relaunch-required', () => { app.relaunch(); app.exit(0); });
  config.on('change', (c) => {
    broadcast(IPC.EV_SETTINGS, c);
    if (c.key.startsWith('jabra')) syncJabra();
    if (c.key === 'panelPreventActivationMacOS27' && overlay) applyPreventActivation();
  });
  await syncJabra();

  if (process.env.DICTATION_SELFTEST) await selfTest();
});

// DICTATION_SELFTEST=1 npm start — exercises the pillars headlessly, then quits.
async function selfTest() {
  const systemVolume = require('./audio/systemVolume');
  const mediaRemote = require('./audio/mediaRemote');
  const t0 = Date.now();
  log.info('[selftest] permissions', permissions.refresh());
  log.info('[selftest] mediaremote available', mediaRemote.available(), 'nowPlaying', await mediaRemote.getNowPlaying().catch((e) => e.message));
  log.info('[selftest] volume before', await systemVolume.read());
  await startDictation();
  log.info('[selftest] ducked', ducker.state, await systemVolume.read(), `${Date.now() - t0}ms`);
  await stopDictation();
  log.info('[selftest] restored', await systemVolume.read(), `${Date.now() - t0}ms`);
  store.addTranscript('selftest', 'selftest');
  log.info('[selftest] db rows', store.recentTranscripts(1).length);
  app.quit();
}

let quitting = false;
app.on('before-quit', (e) => {
  permissions?.closeGuide();
  if (quitting || !state.recording) return;
  // Never leave the user's audio muted/paused: hold the quit until restored.
  e.preventDefault();
  quitting = true;
  state.recording = false;
  ducker.restore().catch(() => {}).finally(() => app.quit());
});
app.on('window-all-closed', (e) => e.preventDefault()); // overlay app keeps running
