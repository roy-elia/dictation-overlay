'use strict';
// Meeting notes: record (mic + system audio), transcribe chunks locally with
// Whisper as they arrive, then summarize with Claude when the meeting ends.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const SUMMARY_SYSTEM = [
  'You write meeting notes from a raw speech-to-text transcript. Speakers are not labelled and the transcript may contain recognition errors; infer sensibly and never invent facts.',
  'Return Markdown with exactly these sections:',
  '## Summary — 3 to 6 sentences.',
  '## Key points — bullets.',
  '## Decisions — bullets, or "None recorded."',
  '## Action items — "- [ ] owner (if stated): task (due date if stated)", or "None recorded."',
  'Write in the language of the transcript.',
].join('\n');

class Meetings extends EventEmitter {
  constructor({ store, whisper, ai, config, sendToPill, log = console }) {
    super();
    Object.assign(this, { store, whisper, ai, config, sendToPill, log });
    this.active = null;      // { id, startedAt, title, queue, systemAudio }
    this.q = {
      insert: store.db.prepare('INSERT INTO meetings (title, started_at, transcript) VALUES (?, ?, ?)'),
      append: store.db.prepare("UPDATE meetings SET transcript = transcript || ? WHERE id = ?"),
      end: store.db.prepare('UPDATE meetings SET ended_at = ? WHERE id = ?'),
      summary: store.db.prepare('UPDATE meetings SET summary = ? WHERE id = ?'),
      title: store.db.prepare('UPDATE meetings SET title = ? WHERE id = ?'),
      list: store.db.prepare('SELECT id, title, started_at, ended_at, length(transcript) chars, summary IS NOT NULL has_summary FROM meetings ORDER BY started_at DESC'),
      get: store.db.prepare('SELECT * FROM meetings WHERE id = ?'),
      del: store.db.prepare('DELETE FROM meetings WHERE id = ?'),
    };
  }

  status() {
    return this.active ? { active: true, id: this.active.id, startedAt: this.active.startedAt, systemAudio: this.active.systemAudio } : { active: false };
  }

  async start(title) {
    if (this.active) return this.status();
    const startedAt = Date.now();
    const name = title || `Meeting ${new Date(startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
    const id = Number(this.q.insert.run(name, startedAt, '').lastInsertRowid);
    this.active = { id, startedAt, title: name, queue: Promise.resolve(), offset: 0, systemAudio: false };
    this.current = this.active;  // stays set until the final chunk is processed
    try {
      const r = await this.sendToPill('start', {
        deviceId: this.config.setting('micDeviceId'),
        systemAudio: this.config.setting('meetingSystemAudio') !== false,
      });
      this.active.systemAudio = !!r?.systemAudio;
    } catch (e) {
      this.q.del.run(id);
      this.active = this.current = null;
      throw e;
    }
    this.emit('change', this.status());
    return this.status();
  }

  /** Called with each PCM chunk from the renderer. */
  onChunk({ pcm, seconds, final }) {
    const m = this.current;
    if (!m) return;
    const at = m.offset;
    m.offset += seconds;
    m.queue = m.queue.then(async () => {
      try {
        const text = await this.whisper.transcribe(new Int16Array(pcm), { language: this._language() });
        if (text) {
          const stamp = new Date(m.startedAt + at * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
          this.q.append.run(`[${stamp}] ${text}\n`, m.id);
          this.emit('transcript', { id: m.id, text });
        }
      } catch (e) { this.log.warn('[meeting] chunk failed', e.message); }
    });
    if (final) { this.current = null; m.queue = m.queue.then(() => this._finish(m)); }
    this.lastQueue = m.queue;
  }

  async stop() {
    if (!this.active) return this.status();
    const m = this.active;
    this.active = null;            // UI goes back to normal immediately
    this.emit('change', this.status());
    await this.sendToPill('stop').catch(() => {});  // triggers the final chunk
    return { active: false, id: m.id };
  }

  async _finish(m) {
    this.q.end.run(Date.now(), m.id);
    this.emit('saved', { id: m.id });
    if (this.ai.configured() && this.config.setting('meetingAutoSummary') !== false) {
      await this.summarize(m.id).catch((e) => this.log.warn('[meeting] summary failed', e.message));
    }
  }

  async summarize(id) {
    const row = this.q.get.get(id);
    if (!row || !row.transcript.trim()) throw new Error('Nothing was transcribed');
    if (!this.ai.configured()) throw new Error('Add a Claude API key in Settings › AI');
    const { text } = await this.ai._ask(SUMMARY_SYSTEM, `<transcript>\n${row.transcript}\n</transcript>`, { maxTokens: 16000 });
    this.q.summary.run(text, id);
    this.emit('saved', { id });
    return text;
  }

  /** Resolves once the last meeting's chunks (and summary) are saved, or after maxMs. */
  whenIdle(maxMs = 60000) {
    return Promise.race([this.lastQueue || Promise.resolve(), new Promise((r) => setTimeout(r, maxMs))]);
  }

  list() { return this.q.list.all(); }
  get(id) { return this.q.get.get(id); }
  rename(id, title) { this.q.title.run(String(title).slice(0, 200), id); }
  delete(id) { this.q.del.run(id); }

  exportMarkdown(id, dir) {
    const m = this.q.get.get(id);
    if (!m) throw new Error('No such meeting');
    const when = new Date(m.started_at).toLocaleString();
    const md = `# ${m.title}\n\n_${when}_\n\n${m.summary || ''}\n\n## Transcript\n\n${m.transcript}`;
    const file = path.join(dir, `${m.title.replace(/[/\\:*?"<>|]+/g, '-')}.md`);
    fs.writeFileSync(file, md);
    return file;
  }

  _language() {
    const langs = this.config.setting('languages') || [];
    return langs.length === 1 ? langs[0] : 'auto';
  }
}

module.exports = { Meetings };
