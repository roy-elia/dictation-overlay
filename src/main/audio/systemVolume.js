'use strict';
// System output mute. Primary: CoreAudio native addon (sub-millisecond, knows
// the device id + transport so Bluetooth profile swaps are detectable).
// Fallback: AppleScript (~240 ms per call) when the addon is missing or the
// device exposes no settable mute.
const { execFile } = require('child_process');
const native = require('audio-control');

function osa(script) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script], { timeout: 1500 }, (err, out) =>
      err ? reject(err) : resolve(out.trim()));
  });
}

async function readOsa() {
  // "output volume:42, input volume:75, alert volume:100, output muted:false"
  const s = await osa('get volume settings');
  return {
    deviceId: null, transport: 'unknown',
    volume: Number(/output volume:(\d+)/.exec(s)?.[1] ?? -1),
    muted: /output muted:true/.test(s),
    source: 'osascript',
  };
}

/** @returns {Promise<{deviceId:number|null, transport:string, volume:number, muted:boolean, source:string}>} */
async function read() {
  const r = native.read();
  if (r && r.muteSupported) return { ...r, source: 'coreaudio' };
  return readOsa();
}

async function setMuted(m) {
  const r = native.read();
  if (r && r.muteSupported && native.setMuted(m)) return;
  await osa(`set volume output muted ${m ? 'true' : 'false'}`);
}

const isBluetooth = (r) => !!r && /^bluetooth/.test(r.transport);

module.exports = { read, setMuted, isBluetooth };
