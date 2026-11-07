'use strict';
// Standard parts: auto-updater + database driver.
const path = require('path');
const { app } = require('electron');

function startUpdater(log = console) {
  if (!app.isPackaged) return null;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.logger = log;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (e) => log.warn('[updater]', e.message));
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
  return autoUpdater;
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
