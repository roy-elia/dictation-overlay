'use strict';
// Meeting recorder (runs in the pill renderer). Mixes the mic with system
// audio (ScreenCaptureKit loopback via getDisplayMedia, needs Screen
// Recording) and hands 16 kHz PCM chunks to main every CHUNK_S seconds,
// cut at a quiet moment when possible so words aren't split.
(() => {
  const CHUNK_S = 30, MAX_EXTRA_S = 8;
  let ctx = null, streams = [], node = null, buf = [], rate = 48000, timer = null, onChunk = null;
  let sinceQuiet = 0;

  function toPcm16(chunks, fromRate) {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    const ratio = fromRate / 16000, out = new Int16Array(Math.floor(all.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const a = Math.floor(i * ratio), b = Math.min(all.length, Math.floor((i + 1) * ratio));
      let s = 0; for (let j = a; j < b; j++) s += all[j];
      out[i] = Math.max(-1, Math.min(1, s / Math.max(1, b - a))) * 0x7fff;
    }
    return out;
  }

  function flush(final = false) {
    if (!buf.length) return;
    const pcm = toPcm16(buf, rate);
    buf = [];
    onChunk?.({ pcm: pcm.buffer, seconds: pcm.length / 16000, final });
  }

  async function start({ deviceId, systemAudio }, cb) {
    await stop(false);
    onChunk = cb;
    ctx = new AudioContext();
    rate = ctx.sampleRate;
    await ctx.audioWorklet.addModule('recorder-worklet.js');
    const mix = ctx.createGain();
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true },
    });
    streams.push(mic);
    ctx.createMediaStreamSource(mic).connect(mix);
    let gotSystem = false;
    if (systemAudio) {
      try {
        const disp = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
        disp.getVideoTracks().forEach((t) => t.stop());
        if (disp.getAudioTracks().length) {
          streams.push(disp);
          ctx.createMediaStreamSource(new MediaStream(disp.getAudioTracks())).connect(mix);
          gotSystem = true;
        }
      } catch (e) { console.warn('system audio unavailable:', e.message); }
    }
    node = new AudioWorkletNode(ctx, 'recorder');
    node.port.onmessage = ({ data }) => {
      buf.push(data);
      let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      sinceQuiet = Math.sqrt(sum / data.length) < 0.01 ? sinceQuiet + data.length : 0;
    };
    mix.connect(node);
    // Every second: cut once we're past CHUNK_S and in a ~0.3 s pause (or MAX_EXTRA_S late).
    timer = setInterval(() => {
      const seconds = buf.reduce((n, c) => n + c.length, 0) / rate;
      if (seconds >= CHUNK_S && (sinceQuiet / rate > 0.3 || seconds >= CHUNK_S + MAX_EXTRA_S)) flush();
    }, 1000);
    return { systemAudio: gotSystem };
  }

  async function stop(final = true) {
    clearInterval(timer); timer = null;
    if (final) flush(true);
    try { node?.disconnect(); } catch { /* gone */ }
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams = []; node = null; buf = [];
    if (ctx) await ctx.close().catch(() => {});
    ctx = null;
  }

  window.rfMeeting = { start, stop };
})();
