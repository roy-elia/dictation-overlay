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
    CREATE TABLE IF NOT EXISTS dictionary (
      id INTEGER PRIMARY KEY, word TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snippets (
      id INTEGER PRIMARY KEY, trigger TEXT NOT NULL UNIQUE COLLATE NOCASE, expansion TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
      transcript TEXT NOT NULL DEFAULT '', summary TEXT, audio_path TEXT
    );
  `);
  // Additive migrations for transcripts.
  const cols = new Set(db.prepare('PRAGMA table_info(transcripts)').all().map((c) => c.name));
  for (const [c, type] of [['raw', 'TEXT'], ['seconds', 'REAL'], ['words', 'INTEGER'], ['kind', "TEXT DEFAULT 'dictation'"], ['app_name', 'TEXT']]) {
    if (!cols.has(c)) db.exec(`ALTER TABLE transcripts ADD COLUMN ${c} ${type}`);
  }

  const countWords = (t) => (t.match(/\S+/g) || []).length;
  const q = {
    insert: db.prepare('INSERT INTO transcripts (created_at, text, target_app, raw, seconds, words, kind, app_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    apps: db.prepare("SELECT target_app bundleId, app_name name, COUNT(*) n FROM transcripts WHERE target_app IS NOT NULL AND target_app != '' GROUP BY target_app ORDER BY MAX(created_at) DESC LIMIT 30"),
    byDay: db.prepare(`SELECT date(created_at / 1000, 'unixepoch', 'localtime') d, COALESCE(SUM(words),0) w, COUNT(*) n
      FROM transcripts WHERE created_at > ? GROUP BY d`),
    byApp: db.prepare(`SELECT COALESCE(NULLIF(app_name,''), target_app, 'Unknown') name, COALESCE(SUM(words),0) w
      FROM transcripts WHERE created_at > ? GROUP BY name ORDER BY w DESC LIMIT 8`),
    fixes: db.prepare("SELECT COUNT(*) n FROM transcripts WHERE kind = 'polish'"),
    recent: db.prepare('SELECT * FROM transcripts ORDER BY created_at DESC LIMIT ?'),
    search: db.prepare('SELECT * FROM transcripts WHERE text LIKE ? ORDER BY created_at DESC LIMIT ?'),
    del: db.prepare('DELETE FROM transcripts WHERE id = ?'),
    clear: db.prepare('DELETE FROM transcripts'),
    olderThan: db.prepare('DELETE FROM transcripts WHERE created_at < ?'),
    stats: db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(words),0) words, COALESCE(SUM(seconds),0) seconds,
                       COALESCE(SUM(CASE WHEN created_at >= ? THEN words END),0) week FROM transcripts WHERE kind = 'dictation'`),
    words: db.prepare('SELECT * FROM dictionary ORDER BY created_at DESC'),
    addWord: db.prepare('INSERT OR IGNORE INTO dictionary (word, created_at) VALUES (?, ?)'),
    delWord: db.prepare('DELETE FROM dictionary WHERE id = ?'),
    snippets: db.prepare('SELECT * FROM snippets ORDER BY created_at DESC'),
    upsertSnippet: db.prepare(`INSERT INTO snippets (trigger, expansion, created_at) VALUES (?, ?, ?)
                               ON CONFLICT(trigger) DO UPDATE SET expansion = excluded.expansion`),
    delSnippet: db.prepare('DELETE FROM snippets WHERE id = ?'),
    notes: db.prepare('SELECT * FROM notes ORDER BY updated_at DESC'),
    note: db.prepare('SELECT * FROM notes WHERE id = ?'),
    addNote: db.prepare('INSERT INTO notes (title, body, created_at, updated_at) VALUES (?, ?, ?, ?)'),
    updNote: db.prepare('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?'),
    delNote: db.prepare('DELETE FROM notes WHERE id = ?'),
  };

  return {
    db,
    addTranscript: (text, targetApp = null, { raw = null, seconds = null, kind = 'dictation', words = null, appName = null } = {}) =>
      q.insert.run(Date.now(), text, targetApp, raw, seconds, words ?? countWords(text), kind, appName).lastInsertRowid,
    recentApps: () => q.apps.all(),
    recentTranscripts: (n = 20) => q.recent.all(n),
    searchTranscripts: (term, n = 200) => (term ? q.search.all(`%${term}%`, n) : q.recent.all(n)),
    deleteTranscript: (id) => q.del.run(id),
    clearTranscripts: () => q.clear.run(),
    pruneTranscripts: (beforeMs) => q.olderThan.run(beforeMs).changes,
    stats: () => q.stats.get(Date.now() - 7 * 864e5),
    insights: (days = 140) => {
      const since = Date.now() - days * 864e5;
      return { days: q.byDay.all(since), apps: q.byApp.all(Date.now() - 30 * 864e5), fixes: q.fixes.get().n, stats: q.stats.get(Date.now() - 7 * 864e5) };
    },
    deleteCategory: (what) => {
      const tables = { transcripts: ['transcripts'], meetings: ['meetings'], notes: ['notes'], vocab: ['dictionary', 'snippets'] }[what];
      if (!tables) throw new Error(`unknown category ${what}`);
      for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
    },
    words: () => q.words.all(),
    addWord: (w) => q.addWord.run(w.trim(), Date.now()),
    deleteWord: (id) => q.delWord.run(id),
    snippets: () => q.snippets.all(),
    saveSnippet: (trigger, expansion) => q.upsertSnippet.run(trigger.trim(), expansion, Date.now()),
    deleteSnippet: (id) => q.delSnippet.run(id),
    notes: () => q.notes.all(),
    saveNote: ({ id, title = '', body = '' }) => {
      const now = Date.now();
      if (id) q.updNote.run(String(title), String(body), now, id);
      else id = Number(q.addNote.run(String(title), String(body), now, now).lastInsertRowid);
      return q.note.get(id);
    },
    deleteNote: (id) => q.delNote.run(id),
  };
}

module.exports = { startUpdater, openDatabase };
