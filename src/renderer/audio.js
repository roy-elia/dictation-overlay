'use strict';
// Mic capture + level metering + UI sounds, running in the pill's renderer.
// Main drives it with {op:'start'|'stop'|'cancel'} and gets 16 kHz Int16 PCM back.
(() => {
  let ctx = null, stream = null, source = null, node = null;
  let chunks = [], rate = 48000, peak = 0;
  const levelListeners = new Set(), lostListeners = new Set();
  let zeroRun = 0, restarts = 0, lastId = null;
  const DEAD_SAMPLES = 10 * 48000;   // ~10 s of exact digital silence = dead stream
  const lost = (why) => { for (const fn of lostListeners) fn(why); };

  async function start(deviceId) {
    await cancel();
    const constraints = (id) => ({ audio: {
      deviceId: id ? { exact: id } : undefined,
      channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true,
    } });
    let fellBack = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints(deviceId));
    } catch (e) {
      // Chosen mic unplugged: fall back to the system default rather than fail.
      if (!deviceId || !/Overconstrained|NotFound|NotReadable/i.test(e.name)) throw e;
      stream = await navigator.mediaDevices.getUserMedia(constraints(null));
      fellBack = true;
    }
    lastId = fellBack ? null : deviceId;
    chunks = []; peak = 0; restarts = 0;
    await wire();
    const track = stream.getAudioTracks()[0];
    return { fellBack, label: track?.label || '' };
  }

  // Build the graph on the current stream; chunks/peak carry across restarts.
  async function wire() {
    ctx = new AudioContext();
    rate = ctx.sampleRate;
    await ctx.audioWorklet.addModule('recorder-worklet.js');
    source = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, 'recorder');
    zeroRun = 0;
    const track = stream.getAudioTracks()[0];
    if (track) track.onended = () => { if (ctx) lost('disconnected'); };
    node.port.onmessage = ({ data }) => {
      chunks.push(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      zeroRun = sum === 0 ? zeroRun + data.length : 0;
      if (zeroRun > DEAD_SAMPLES * (rate / 48000)) { zeroRun = 0; restartStream(); }
      const rms = Math.sqrt(sum / data.length);
      peak = Math.max(peak, rms);
      for (const fn of levelListeners) fn(rms);
    };
    source.connect(node);
  }

  // Dead stream (driver hiccup, Bluetooth profile switch): reopen the mic up to
  // 3 times, keeping what was recorded so far; then give up and report it.
  async function restartStream() {
    if (restarts >= 3) return lost('silent');
    restarts++;
    try { source?.disconnect(); node?.disconnect(); } catch { /* gone */ }
    stream?.getTracks().forEach((t) => t.stop());
    await ctx?.close().catch(() => {});
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: lastId ? { exact: lastId } : undefined, channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
      await wire();
    } catch { lost('disconnected'); }
  }

  function resampleTo16k(input, fromRate) {
    if (fromRate === 16000) return input;
    const ratio = fromRate / 16000;
    const out = new Float32Array(Math.floor(input.length / ratio));
    for (let i = 0; i < out.length; i++) {
      // box filter over the source span = cheap anti-aliasing
      const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio));
      let s = 0;
      for (let j = a; j < b; j++) s += input[j];
      out[i] = s / Math.max(1, b - a);
    }
    return out;
  }

  async function stop() {
    if (!ctx) return null;
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    const fromRate = rate, maxLevel = peak;
    await cancel();
    const f = resampleTo16k(all, fromRate);
    const pcm = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) pcm[i] = Math.max(-1, Math.min(1, f[i])) * 0x7fff;
    return { pcm: pcm.buffer, seconds: f.length / 16000, peak: maxLevel };
  }

  async function cancel() {
    try { source?.disconnect(); node?.disconnect(); } catch { /* already gone */ }
    stream?.getTracks().forEach((t) => t.stop());
    if (ctx) await ctx.close().catch(() => {});
    ctx = stream = source = node = null;
    chunks = [];
  }

  async function listDevices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d) => ({ id: d.deviceId, label: d.label || 'Microphone' }));
  }

  // --- UI sounds: short synthesized blips, no audio assets ---
  let sfx = null;
  function blip(freqs, dur = 0.07, gain = 0.06) {
    sfx = sfx || new AudioContext();
    const t0 = sfx.currentTime;
    freqs.forEach((f, i) => {
      const o = sfx.createOscillator(), g = sfx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const s = t0 + i * dur;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(gain, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
      o.connect(g).connect(sfx.destination);
      o.start(s); o.stop(s + dur + 0.02);
    });
  }
  const SOUNDS = {
    start: () => blip([660, 880]),
    stop: () => blip([880, 660]),
    lock: () => blip([990], 0.05, 0.05),              // hands-free locked in
    cancel: () => blip([440, 330], 0.08, 0.05),
    error: () => blip([300, 220], 0.1, 0.03),
    achievement: () => blip([660, 830, 990], 0.06, 0.03),
    success: () => blip([740, 990], 0.05, 0.03),
  };

  window.rfAudio = {
    start, stop, cancel, listDevices,
    onLevel: (fn) => { levelListeners.add(fn); return () => levelListeners.delete(fn); },
    onLost: (fn) => { lostListeners.add(fn); return () => lostListeners.delete(fn); },
    play: (name) => SOUNDS[name]?.(),
  };
})();
