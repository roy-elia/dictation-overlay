'use strict';
// Standard parts: auto-updater + database driver.
const path = require('path');
const { app } = require('electron');

// Returns an EventEmitter with a small status model the tray menu renders:
//   status: 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'error' | 'disabled'
// The update is applied on the next normal quit (Squirrel.Mac's ShipIt runs
// when the app terminates), or immediately via installNow().
function startUpdater(log = console) {
  const { EventEmitter } = require('events');
  const ev = new EventEmitter();
  ev.status = 'disabled';
  ev.version = null;
  ev.check = () => {};
  ev.installNow = () => {};
  if (!app.isPackaged) return ev;

  const { autoUpdater } = require('electron-updater');
  const set = (status, version = ev.version) => { ev.status = status; ev.version = version; ev.emit('change'); };
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set('checking'));
  autoUpdater.on('update-available', (i) => set('downloading', i.version));
  autoUpdater.on('update-not-available', () => set('up-to-date', null));
  autoUpdater.on('update-downloaded', (i) => set('ready', i.version));
  autoUpdater.on('error', (e) => { log.warn('[updater]', e.message); set('error'); });

  ev.check = () => autoUpdater.checkForUpdates().catch(() => {});
  ev.installNow = () => { if (ev.status === 'ready') autoUpdater.quitAndInstall(); };
  ev.check();
  setInterval(ev.check, 6 * 60 * 60 * 1000);
  return ev;
}

function openDatabase() {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(app.getPath('userData'), 'dictation.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS transcripts (
      id INTEGER PRIMARY KEY,
      created_at INTEGER NOT NULL,
      text TEXT NOT NULL,
      target_app TEXT
    );
  `);
  const insert = db.prepare('INSERT INTO transcripts (created_at, text, target_app) VALUES (?, ?, ?)');
  const recent = db.prepare('SELECT * FROM transcripts ORDER BY created_at DESC LIMIT ?');
  return {
    db,
    addTranscript: (text, targetApp = null) => insert.run(Date.now(), text, targetApp).lastInsertRowid,
    recentTranscripts: (n = 20) => recent.all(n),
  };
}

module.exports = { startUpdater, openDatabase };
