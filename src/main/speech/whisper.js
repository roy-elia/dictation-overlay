'use strict';
// Local speech-to-text via whisper.cpp's HTTP server (whisper-server), kept
// running with the model loaded so each utterance only pays inference time.
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { app } = require('electron');
const { EventEmitter } = require('events');

const DEFAULT_MODEL = 'ggml-large-v3-turbo-q5_0.bin';
const MODEL_URL = (name) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${name}`;

function serverBinary() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'whisper', 'whisper-server')
    : path.join(app.getAppPath(), 'vendor', 'whisper.cpp', 'build', 'bin', 'whisper-server');
}

// Fixed location (not userData) so self-tests with a temp profile still find the model.
const modelsDir = () => path.join(app.getPath('appData'), 'RoyFlow', 'models');
const modelPath = (name = DEFAULT_MODEL) => path.join(modelsDir(), name);

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    }).on('error', reject);
  });
}

// 16 kHz mono Int16 PCM -> WAV bytes.
function toWav(pcm16) {
  const data = Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// Things Whisper emits for silence/noise that must never be pasted.
const NOISE = /^\s*(\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE)[^\]]*\]|\((music|silence|inaudible)[^)]*\)|thank you\.?|thanks for watching!?|you)\s*$/i;

const COREML_NAME = (model) => model.replace(/\.bin$/, '').replace(/-q\d_\d$/, '') + '-encoder.mlmodelc';

/** Stream a URL to disk with progress; atomic rename at the end. */
async function download(url, dest, onProgress) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const part = `${dest}.part`;
  const out = fs.createWriteStream(part);
  let done = 0, last = 0;
  for await (const chunk of res.body) {
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    done += chunk.length;
    if (Date.now() - last > 250) { last = Date.now(); onProgress?.(done, total); }
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  fs.renameSync(part, dest);
  onProgress?.(total || done, total || done);
}

class WhisperServer extends EventEmitter {
  constructor({ log = console } = {}) {
    super();
    this.log = log;
    this.proc = null;
    this.port = null;
    this.ready = null;
    this.model = DEFAULT_MODEL;
  }

  hasModel(name = this.model) { return fs.existsSync(modelPath(name)); }
  hasCoreML(name = this.model) { return fs.existsSync(path.join(modelsDir(), COREML_NAME(name))); }

  /**
   * Download the ggml model and (Apple silicon) its Core ML encoder.
   * Emits 'download' {phase, done, total}. Restarts the server afterwards.
   */
  async downloadModel(name = this.model) {
    if (this.downloading) return this.downloading;
    this.downloading = (async () => {
      fs.mkdirSync(modelsDir(), { recursive: true });
      const report = (phase) => (done, total) => this.emit('download', { phase, done, total });
      if (!this.hasModel(name)) await download(MODEL_URL(name), modelPath(name), report('model'));
      if (process.arch === 'arm64' && !this.hasCoreML(name)) {
        const zipName = `${COREML_NAME(name)}.zip`;
        const zip = path.join(modelsDir(), zipName);
        try {
          await download(MODEL_URL(zipName), zip, report('coreml'));
          await new Promise((r, j) => require('child_process').execFile('/usr/bin/ditto', ['-x', '-k', zip, modelsDir()], (e) => (e ? j(e) : r())));
        } catch (e) {
          this.log.warn('[whisper] Core ML encoder unavailable, using Metal:', e.message);
        } finally { fs.rmSync(zip, { force: true }); }
      }
      this.emit('download', { phase: 'done' });
      this.stop();
      await this.start(name);
    })().finally(() => { this.downloading = null; });
    return this.downloading;
  }

  start(model = this.model) {
    if (this.ready && this.model === model) return this.ready;
    this.stop();
    this.model = model;
    this.ready = (async () => {
      if (!fs.existsSync(serverBinary())) throw new Error(`whisper-server missing at ${serverBinary()}`);
      if (!this.hasModel(model)) throw new Error('Download the speech model in RoyFlow Settings first');
      this.port = await freePort();
      const threads = Math.max(2, Math.min(8, require('os').cpus().length - 2));
      this.proc = spawn(serverBinary(), [
        '-m', modelPath(model), '--host', '127.0.0.1', '--port', String(this.port),
        '-t', String(threads), '--no-timestamps',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      this.proc.stderr.on('data', (d) => this.emit('log', d.toString()));
      this.proc.once('exit', (code) => {
        this.log.warn('[whisper] server exited', code);
        this.proc = null; this.ready = null;
      });
      await this._waitUntilUp(30_000);
      this.log.info('[whisper] ready on', this.port, 'model', model);
    })();
    this.ready.catch((e) => { this.log.warn('[whisper]', e.message); this.ready = null; });
    return this.ready;
  }

  async _waitUntilUp(ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (!this.proc) throw new Error('whisper-server exited during startup');
      try { const r = await fetch(`http://127.0.0.1:${this.port}/`); if (r.ok) return; } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('whisper-server did not start in time');
  }

  /**
   * @param {Int16Array} pcm16  16 kHz mono
   * @param {{language?: string, prompt?: string}} opts
   * @returns {Promise<string>}
   */
  async transcribe(pcm16, { language = 'auto', prompt = '' } = {}) {
    await this.start(this.model);
    const form = new FormData();
    form.append('file', new Blob([toWav(pcm16)], { type: 'audio/wav' }), 'audio.wav');
    form.append('response_format', 'json');
    form.append('language', language);
    form.append('temperature', '0');
    if (prompt) form.append('prompt', prompt);
    const r = await fetch(`http://127.0.0.1:${this.port}/inference`, { method: 'POST', body: form });
    if (!r.ok) throw new Error(`whisper HTTP ${r.status}`);
    const { text = '' } = await r.json();
    const clean = text.replace(/\s+/g, ' ').trim();
    return NOISE.test(clean) ? '' : clean;
  }

  stop() {
    if (this.proc) this.proc.kill('SIGTERM');
    this.proc = null; this.ready = null;
  }
}

module.exports = { WhisperServer, DEFAULT_MODEL, MODEL_URL, modelPath, toWav, COREML_NAME, download };
