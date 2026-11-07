'use strict';
// Menu-bar item + the pill's right-click menu. RoyFlow hides its Dock icon,
// so this is the main way in: dictation, last transcript, mic, languages,
// options, settings, updates, quit.
const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');

// Whisper language codes offered in the menu (full list lives in Settings).
const LANGUAGES = [
  ['en', 'English'], ['fr', 'French'], ['es', 'Spanish'], ['de', 'German'], ['it', 'Italian'],
  ['pt', 'Portuguese'], ['ar', 'Arabic'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['hi', 'Hindi'],
];

function preview(text, n = 40) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function updateItem(updater) {
  switch (updater.status) {
    case 'ready': return { label: `Restart to Install ${updater.version}`, click: () => updater.installNow() };
    case 'downloading': return { label: `Downloading ${updater.version}…`, enabled: false };
    case 'checking': return { label: 'Checking for Updates…', enabled: false };
    case 'error': return { label: 'Update Failed — Try Again', click: () => updater.check() };
    case 'disabled': return { label: 'Updates Off (dev build)', enabled: false };
    default: return { label: 'Check for Updates', click: () => updater.check() };
  }
}

function createTray({ app, config, updater, dictation, overlay, ctx, onSettings, onPermissions, onPasteLast, onCopyLast }) {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'trayTemplate.png'));
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  tray.setToolTip('RoyFlow');

  const set = (k, v) => config.set('settings', k, v);

  function micMenu() {
    const sel = config.setting('micDeviceId');
    return [
      { label: 'System Default', type: 'radio', checked: !sel, click: () => set('micDeviceId', null) },
      ...ctx.devices.map((d) => ({ label: d.label, type: 'radio', checked: sel === d.id, click: () => set('micDeviceId', d.id) })),
    ];
  }

  function languageMenu() {
    const langs = config.setting('languages') || [];
    return [
      { label: 'Detect Automatically', type: 'checkbox', checked: langs.length === 0, click: () => set('languages', []) },
      { type: 'separator' },
      ...LANGUAGES.map(([code, name]) => ({
        label: name, type: 'checkbox', checked: langs.includes(code),
        click: () => set('languages', langs.includes(code) ? langs.filter((c) => c !== code) : [code, ...langs]),
      })),
      { type: 'separator' },
      { label: 'More Languages…', click: () => onSettings('general') },
    ];
  }

  function dictationItems() {
    const { state } = dictation;
    const last = dictation.lastTranscript;
    return [
      state === 'listening'
        ? { label: 'Finish Dictation', click: () => dictation.finish() }
        : { label: 'Start Hands-Free Dictation', enabled: state === 'idle', click: () => dictation.start('handsfree') },
      { type: 'separator' },
      { label: 'Paste Last Transcript', accelerator: 'Cmd+Ctrl+V', registerAccelerator: false, enabled: !!last, click: onPasteLast },
      { label: 'Copy Last Transcript', accelerator: 'Cmd+Ctrl+C', registerAccelerator: false, enabled: !!last, click: onCopyLast },
      ...(last ? [{ label: `“${preview(last)}”`, toolTip: last, enabled: false }] : []),
    ];
  }

  function render() {
    const hotkeyWarning = ctx.hotkeysOk === false
      ? [{ label: '⚠︎ fn shortcut needs Accessibility…', click: onPermissions }, { type: 'separator' }]
      : [];
    tray.setContextMenu(Menu.buildFromTemplate([
      ...hotkeyWarning,
      ...dictationItems(),
      { type: 'separator' },
      { label: 'Microphone', submenu: micMenu() },
      { label: 'Languages', submenu: languageMenu() },
      {
        label: 'Options', submenu: [
          { label: 'Show Dictation Pill', type: 'checkbox', checked: !config.setting('hidePill'), click: (i) => set('hidePill', !i.checked) },
          { label: 'Play Sounds', type: 'checkbox', checked: !!config.setting('soundsEnabled'), click: (i) => set('soundsEnabled', i.checked) },
          { label: 'Mute Audio While Dictating', type: 'checkbox', checked: !!config.setting('muteAudioWhileDictating'), click: (i) => set('muteAudioWhileDictating', i.checked) },
          { label: '“Press Enter” Voice Command', type: 'checkbox', checked: !!config.setting('pressEnterCommand'), click: (i) => set('pressEnterCommand', i.checked) },
          { type: 'separator' },
          { label: 'Launch at Login', type: 'checkbox', checked: !!config.setting('launchAtLogin'), enabled: app.isPackaged, click: (i) => set('launchAtLogin', i.checked) },
          { label: 'Show in Dock', type: 'checkbox', checked: !!config.setting('showInDock'), click: (i) => set('showInDock', i.checked) },
        ],
      },
      { type: 'separator' },
      { label: 'History…', click: () => onSettings('history') },
      { label: 'Dictionary & Snippets…', click: () => onSettings('vocab') },
      { label: 'Settings…', accelerator: 'Cmd+,', registerAccelerator: false, click: () => onSettings('general') },
      { type: 'separator' },
      updateItem(updater),
      { label: `RoyFlow ${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      { label: 'Quit RoyFlow', accelerator: 'Cmd+Q', registerAccelerator: false, click: () => app.quit() },
    ]));
  }

  // Right-click on the pill: the short version.
  function pillMenu() {
    return Menu.buildFromTemplate([
      ...dictationItems(),
      { type: 'separator' },
      { label: 'Microphone', submenu: micMenu() },
      { label: 'Languages', submenu: languageMenu() },
      { type: 'separator' },
      { label: 'Hide Pill', click: () => set('hidePill', true) },
      { label: 'Settings…', click: () => onSettings('general') },
    ]);
  }

  render();
  updater.on('change', render);
  return { tray, render, pillMenu };
}

module.exports = { createTray, LANGUAGES };
