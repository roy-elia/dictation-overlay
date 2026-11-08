'use strict';
// Dictation state machine.
//
//   idle ──fn down──▶ listening(ptt) ──fn up──▶ processing ──▶ idle
//                         │  fn+Space               ▲
//                         ▼                         │ fn / stop button
//   idle ──fn+Space / double-tap fn / pill click──▶ listening(handsfree)
//   Esc / ✕ / fn+other key (early) ──▶ cancel ──▶ idle
//
// A quick fn tap (<250 ms) is not a dictation; two taps within 400 ms start
// hands-free. Esc keeps the clip for 5 s so the toast can Undo it.
const { EventEmitter } = require('events');
const { applyFormat, formatFor } = require('./formats');

const TAP_MS = 250;
const DOUBLE_TAP_MS = 400;
const MIN_SECONDS = 0.35;
const SILENCE_PEAK = 0.012;      // RMS below this for the whole clip = nothing said
const MAX_SESSION_MS = 20 * 60 * 1000;   // hard cap on one dictation
const WARN_BEFORE_MS = 60 * 1000;         // "1 minute left" warning
const UNDO_MS = 5000;                     // how long a cancelled clip can be restored
const KEY_LABEL = { fn: 'fn', rightOption: 'right ⌥', rightCommand: 'right ⌘' };

class DictationController extends EventEmitter {
  /**
   * @param {object} d
   * @param {{start(deviceId):Promise, stop():Promise<{pcm:ArrayBuffer,seconds:number,peak:number}|null>, cancel():Promise}} d.audio
   * @param {{transcribe(pcm:Int16Array, o:object):Promise<string>}} d.whisper
   * @param {(text:string)=>Promise<void>} d.insert
   * @param {{duck():Promise, restore():Promise}} d.ducker
   * @param {object} d.config
   * @param {{setRecording(b:boolean):void}} d.input
   * @param {{prompt():string, apply(text:string):{text:string, pressEnter:boolean}}} [d.vocab]
   * @param {{configured():boolean, polish(t:string):Promise<string>, command(i:string, sel:string):Promise<string>}} [d.ai]
   * @param {() => Promise<string>} [d.readSelection]
   */
  constructor(d) {
    super();
    Object.assign(this, d);
    this.log = d.log || console;
    this.state = 'idle';     // idle | listening | processing | error
    this.mode = null;        // ptt | handsfree
    this.pressedAt = 0;
    this.lastTapAt = 0;
    this.lastTranscript = '';
    this.maxTimer = null;
    this.warnTimer = null;
    this.coachTimer = null;
    this.cancelled = null;   // { clip, mode, app, at } kept for Undo
  }

  _key() { return KEY_LABEL[this.config.setting('triggerKey')] || 'fn'; }

  snapshot() { return { state: this.state, mode: this.mode, lastTranscript: this.lastTranscript }; }
  _set(state, extra = {}) {
    this.state = state;
    this.input.setRecording(state === 'listening');
    this.emit('state', { ...this.snapshot(), ...extra });
  }

  // ---- input events from the native tap / pill / menu ----
  onInput(ev) {
    if (ev.type === 'fn' && ev.down) return this._fnDown(ev.command);
    if (ev.type === 'fn' && !ev.down) return this._fnUp();
    if (ev.type === 'fnChord') {
      if (this.state === 'listening' && this.mode === 'ptt' && Date.now() - this.pressedAt < 600) {
        this.cancel(true);
        this._coach(`Dictation cancelled: hold only ${this._key()}`);
      }
      return;
    }
    if (ev.type === 'hotkey') {
      switch (ev.name) {
        case 'handsFree':
          if (this.state === 'listening') { this.mode = 'handsfree'; this._set('listening'); this.emit('sound', 'lock'); }
          else if (this.state === 'idle') this.start('handsfree');
          return;
        case 'cancel': return this.cancel();
        case 'undoCancel': return this.undoCancel();
        case 'pasteLast': return this.emit('pasteLast');
        case 'copyLast': return this.emit('copyLast');
      }
    }
  }

  _fnDown(command = false) {
    if (this.state === 'listening' && this.mode === 'handsfree') return this.finish();
    if (this.state !== 'idle') return;
    clearTimeout(this.coachTimer);
    this.pressedAt = Date.now();
    if (command) return this.start('command');
    const doubleTap = Date.now() - this.lastTapAt < DOUBLE_TAP_MS;
    this.start(doubleTap ? 'handsfree' : 'ptt');
  }

  _fnUp() {
    if (this.state !== 'listening' || (this.mode !== 'ptt' && this.mode !== 'command')) return;
    if (Date.now() - this.pressedAt < TAP_MS) {
      this.lastTapAt = Date.now();
      this.cancel(true);
      // A single short tap (no second tap follows) is almost always someone
      // expecting tap-to-talk: say how it works.
      clearTimeout(this.coachTimer);
      this.coachTimer = setTimeout(() => this._coach(`Hold ${this._key()} to talk, or double-tap for hands-free`), DOUBLE_TAP_MS + 50);
      return;
    }
    this.finish();
  }

  // ---- actions ----
  async start(mode) {
    if (this.state !== 'idle') return;
    if (mode === 'command' && !this.ai?.configured()) {
      return this._fail('Add a Claude API key in Settings › AI to use voice commands');
    }
    this.mode = mode;
    this.pressedAt = this.pressedAt || Date.now();
    this.selection = '';
    this.app = this.input.frontmostApp?.() || null; // the app we'll paste into
    // Command mode grabs the selection first, while it is surely still selected.
    if (mode === 'command') this.selectionP = this.readSelection().catch(() => '');
    this._set('listening');
    this.emit('sound', 'start');
    this.cancelled = null;
    this._armMax();
    try {
      const [mic] = await Promise.all([
        this.audio.start(this.config.setting('micDeviceId')),
        this.config.setting('muteAudioWhileDictating') ? this.ducker.duck(this.config.setting('duckMode') || 'auto') : null,
      ]);
      if (mic?.label && this.state === 'listening' && !mic.fellBack) this.emit('micTip', mic.label);
    } catch (e) {
      this._fail(/allow microphone/i.test(e.message) ? e.message : `Microphone unavailable: ${e.message}`);
    }
  }

  // silent = an accidental start (short tap, chord): drop the audio.
  // Otherwise keep the clip for UNDO_MS so "Undo" can still transcribe it.
  async cancel(silent = false) {
    if (this.state !== 'listening') return;
    this._clearTimers();
    this.pressedAt = 0;
    const { mode, app, selectionP } = this;
    if (silent) {
      this._set('idle');
      await this.audio.cancel().catch(() => {});
    } else {
      this._set('idle', { toast: { text: 'Transcript cancelled', action: 'undo-cancel', label: 'Undo', ms: UNDO_MS } });
      const clip = await this.audio.stop().catch(() => null);
      if (clip && clip.seconds >= MIN_SECONDS) this.cancelled = { clip, mode, app, selectionP, at: Date.now() };
    }
    await this.ducker.restore().catch(() => {});
  }

  async undoCancel() {
    const c = this.cancelled;
    this.cancelled = null;
    if (!c || Date.now() - c.at > UNDO_MS + 1000 || this.state !== 'idle') return;
    Object.assign(this, { mode: c.mode, app: c.app, selectionP: c.selectionP });
    this._set('processing');
    return this._process(c.clip);
  }

  async finish() {
    if (this.state !== 'listening') return;
    this._clearTimers();
    this.pressedAt = 0;
    this._set('processing');
    this.emit('sound', 'stop');
    let clip = null;
    try { clip = await this.audio.stop(); } finally { this.ducker.restore().catch(() => {}); }
    return this._process(clip);
  }

  async _process(clip) {
    // Nothing said: go back to rest quietly, no notice.
    if (!clip || clip.seconds < MIN_SECONDS || clip.peak < SILENCE_PEAK) return this._set('idle');
    try {
      const t0 = Date.now();
      const raw = await this.whisper.transcribe(new Int16Array(clip.pcm), {
        language: this._language(),
        prompt: this.vocab?.prompt() || '',
      });
      const applied = this.vocab ? this.vocab.apply(raw) : { text: raw, pressEnter: false };
      let { text } = applied;
      const { pressEnter } = applied;
      this.log.info(`[dictation] ${clip.seconds.toFixed(1)}s audio -> ${Date.now() - t0}ms`);
      if (!text) return this._set('idle');

      let kind = 'dictation', notice = null;
      if (this.mode === 'command') {
        const selection = await this.selectionP;
        this._set('processing', { stage: 'command' });
        text = await this.ai.command(text, selection);
        kind = 'command';
      } else {
        const format = formatFor(this.config, this.app);
        if (format === 'polish' && this.ai?.configured()) {
          this._set('processing', { stage: 'polish' });
          try { text = await this.ai.polish(text); kind = 'polish'; }
          catch (e) { notice = `Pasted unpolished: ${e.message}`; }
        } else {
          text = applyFormat(text, format);
        }
        // A transform marked "apply after every dictation" runs last.
        const auto = (this.config.setting('transforms') || []).find((t) => t.autoApply && t.prompt);
        if (auto && this.ai?.configured()) {
          this._set('processing', { stage: 'polish' });
          try { text = await this.ai.command(auto.prompt, text); kind = 'polish'; }
          catch (e) { notice = `Pasted without “${auto.name}”: ${e.message}`; }
        }
      }

      this.lastTranscript = text;
      this.lastClip = clip;
      await this.insert(text);
      if (pressEnter) this.emit('pressEnter');
      this.emit('transcript', { text, raw, seconds: clip.seconds, kind, app: this.app });
      this._set('idle', notice ? { notice } : kind === 'polish' ? { polished: true } : {});
    } catch (e) {
      this._fail(e.message);
    }
  }

  _language() {
    const langs = this.config.setting('languages') || [];
    return langs.length === 1 ? langs[0] : 'auto';
  }

  _armMax() {
    this._clearTimers();
    this.warnTimer = setTimeout(() => {
      if (this.state === 'listening') this.emit('state', { ...this.snapshot(), notice: '1 minute left in this dictation' });
    }, MAX_SESSION_MS - WARN_BEFORE_MS);
    this.maxTimer = setTimeout(() => this.finish(), MAX_SESSION_MS);
  }
  _clearTimers() { clearTimeout(this.maxTimer); clearTimeout(this.warnTimer); }

  _coach(text) {
    if (this.state === 'idle') this.emit('state', { ...this.snapshot(), notice: text });
  }

  _fail(message) {
    this.log.warn('[dictation]', message);
    this._clearTimers();
    this.audio.cancel().catch(() => {});
    this.ducker.restore().catch(() => {});
    this.emit('sound', 'error');
    this._set('error', { notice: message });
    setTimeout(() => { if (this.state === 'error') this._set('idle'); }, 2500 + 500);
  }
}

module.exports = { DictationController };
