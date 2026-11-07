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
// hands-free.
const { EventEmitter } = require('events');

const TAP_MS = 250;
const DOUBLE_TAP_MS = 400;
const MIN_SECONDS = 0.35;
const SILENCE_PEAK = 0.012;      // RMS below this for the whole clip = nothing said
const MAX_HANDSFREE_MS = 6 * 60 * 1000;

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
  }

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
      if (this.state === 'listening' && this.mode === 'ptt' && Date.now() - this.pressedAt < 600) this.cancel(true);
      return;
    }
    if (ev.type === 'hotkey') {
      switch (ev.name) {
        case 'handsFree':
          if (this.state === 'listening') { this.mode = 'handsfree'; this._set('listening'); this._armMax(); }
          else if (this.state === 'idle') this.start('handsfree');
          return;
        case 'cancel': return this.cancel();
        case 'pasteLast': return this.emit('pasteLast');
        case 'copyLast': return this.emit('copyLast');
      }
    }
  }

  _fnDown(command = false) {
    if (this.state === 'listening' && this.mode === 'handsfree') return this.finish();
    if (this.state !== 'idle') return;
    this.pressedAt = Date.now();
    if (command) return this.start('command');
    const doubleTap = Date.now() - this.lastTapAt < DOUBLE_TAP_MS;
    this.start(doubleTap ? 'handsfree' : 'ptt');
  }

  _fnUp() {
    if (this.state !== 'listening' || (this.mode !== 'ptt' && this.mode !== 'command')) return;
    if (Date.now() - this.pressedAt < TAP_MS) {
      this.lastTapAt = Date.now();
      return this.cancel(true);
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
    // Command mode grabs the selection first, while it is surely still selected.
    if (mode === 'command') this.selectionP = this.readSelection().catch(() => '');
    this._set('listening');
    this.emit('sound', 'start');
    if (mode === 'handsfree') this._armMax();
    try {
      await Promise.all([
        this.audio.start(this.config.setting('micDeviceId')),
        this.config.setting('muteAudioWhileDictating') ? this.ducker.duck() : null,
      ]);
    } catch (e) {
      this._fail(/allow microphone/i.test(e.message) ? e.message : `Microphone unavailable: ${e.message}`);
    }
  }

  async cancel(silent = false) {
    if (this.state !== 'listening') return;
    clearTimeout(this.maxTimer);
    this.pressedAt = 0;
    this._set('idle');
    if (!silent) this.emit('sound', 'cancel');
    await this.audio.cancel().catch(() => {});
    await this.ducker.restore().catch(() => {});
  }

  async finish() {
    if (this.state !== 'listening') return;
    clearTimeout(this.maxTimer);
    this.pressedAt = 0;
    this._set('processing');
    this.emit('sound', 'stop');
    let clip = null;
    try { clip = await this.audio.stop(); } finally { this.ducker.restore().catch(() => {}); }

    if (!clip || clip.seconds < MIN_SECONDS || clip.peak < SILENCE_PEAK) {
      return this._set('idle', { notice: 'No speech heard' });
    }
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
      if (!text) return this._set('idle', { notice: 'No speech heard' });

      let kind = 'dictation', notice = null;
      if (this.mode === 'command') {
        const selection = await this.selectionP;
        this._set('processing', { stage: 'command' });
        text = await this.ai.command(text, selection);
        kind = 'command';
      } else if (this.config.setting('aiAutoPolish') && this.ai?.configured()) {
        this._set('processing', { stage: 'polish' });
        try { text = await this.ai.polish(text); kind = 'polish'; }
        catch (e) { notice = `Pasted unpolished: ${e.message}`; }
      }

      this.lastTranscript = text;
      await this.insert(text);
      if (pressEnter) this.emit('pressEnter');
      this.emit('transcript', { text, raw, seconds: clip.seconds, kind });
      this._set('idle', notice ? { notice } : {});
    } catch (e) {
      this._fail(e.message);
    }
  }

  _language() {
    const langs = this.config.setting('languages') || [];
    return langs.length === 1 ? langs[0] : 'auto';
  }

  _armMax() {
    clearTimeout(this.maxTimer);
    this.maxTimer = setTimeout(() => this.finish(), MAX_HANDSFREE_MS);
  }

  _fail(message) {
    this.log.warn('[dictation]', message);
    this.audio.cancel().catch(() => {});
    this.ducker.restore().catch(() => {});
    this.emit('sound', 'error');
    this._set('error', { notice: message });
    setTimeout(() => { if (this.state === 'error') this._set('idle'); }, 2500);
  }
}

module.exports = { DictationController };
