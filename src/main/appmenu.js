'use strict';
// macOS application menu (visible while a RoyFlow window is frontmost) and
// the Dock menu. Rebuilt whenever the tray is.
const { Menu, app, shell } = require('electron');

const REPO = 'https://github.com/roy-elia/dictation-overlay';

function buildAppMenu({ config, updater, dictation, stats, vocabCounts, onSettings, onPasteLast, onCopyLast, onScratchpad, meetings, micMenu, languageMenu, updateItem }) {
  const s = stats();
  const v = vocabCounts();
  const last = dictation.lastTranscript;
  const dev = !app.isPackaged;
  const m = meetings();
  const template = [
    {
      label: 'RoyFlow',
      submenu: [
        { role: 'about', label: 'About RoyFlow' },
        updateItem(updater),
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => onSettings('general') },
        { type: 'separator' },
        { role: 'hide', label: 'Hide RoyFlow' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit RoyFlow', accelerator: 'Cmd+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'Start Dictation', enabled: dictation.state === 'idle', click: () => dictation.start('handsfree') },
        m.active
          ? { label: 'Stop Meeting Notes', click: () => m.stop() }
          : { label: 'Start Meeting Notes', click: () => m.start().catch(() => {}) },
        { label: 'New Scratchpad Note', accelerator: 'Cmd+N', click: () => onScratchpad() },
        { type: 'separator' },
        { role: 'close', label: 'Close Window' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Dictation',
      submenu: [
        { label: `Words dictated: ${s.words.toLocaleString()}`, click: () => onSettings('history') },
        { type: 'separator' },
        { label: 'Paste Last Transcript', accelerator: 'Cmd+Ctrl+V', registerAccelerator: false, enabled: !!last, click: onPasteLast },
        { label: 'Copy Last Transcript', accelerator: 'Cmd+Ctrl+C', registerAccelerator: false, enabled: !!last, click: onCopyLast },
        { type: 'separator' },
        { label: 'Microphone', submenu: micMenu() },
        { label: 'Languages', submenu: languageMenu() },
      ],
    },
    {
      label: 'My Voice',
      submenu: [
        { label: `Dictionary words: ${v.words}`, click: () => onSettings('vocab') },
        { label: `Snippets: ${v.snippets}`, click: () => onSettings('vocab') },
        { type: 'separator' },
        { label: 'Add a Word to the Dictionary…', click: () => onSettings('vocab') },
        { label: 'Create a Snippet…', click: () => onSettings('vocab') },
      ],
    },
    { label: 'View', submenu: [{ role: 'reload' }, ...(dev ? [{ role: 'toggleDevTools' }] : []), { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Keyboard Shortcuts', click: () => onSettings('general') },
        { label: 'RoyFlow on GitHub', click: () => shell.openExternal(REPO) },
        { label: 'Report a Problem…', click: () => shell.openExternal(`${REPO}/issues/new`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  app.dock?.setMenu(Menu.buildFromTemplate([
    { label: 'Start Dictation', click: () => dictation.start('handsfree') },
    m.active ? { label: 'Stop Meeting Notes', click: () => m.stop() } : { label: 'Start Meeting Notes', click: () => m.start().catch(() => {}) },
    { label: 'New Scratchpad Note', click: () => onScratchpad() },
    { type: 'separator' },
    { label: 'Settings…', click: () => onSettings('general') },
  ]));
}

module.exports = { buildAppMenu };
