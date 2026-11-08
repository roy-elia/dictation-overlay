'use strict';
// "Mute all audio while dictating".
//  1. If a known media player is playing -> pause it, resume it afterwards.
//  2. Otherwise -> mute system output, restore afterwards. Bluetooth headsets
//     flip A2DP <-> HFP when the mic opens/closes, which swaps the output
//     device (and its mute state). We watch for up to 500 ms after each
//     transition and re-assert our desired state.
const mediaRemote = require('./mediaRemote');
const systemVolume = require('./systemVolume');

const BT_SETTLE_MS = 500;
const POLL_MS = 20; // CoreAudio reads are sub-ms, so poll tightly

const KNOWN_PLAYERS = new Set([
  'com.spotify.client',
  'com.apple.Music',
  'com.apple.podcasts',
  'org.videolan.vlc',
  'com.apple.TV',
  'com.apple.QuickTimePlayerX',
  'com.apple.iBooksX',
  'com.colliderli.iina',
  'com.tidal.desktop',
  'com.deezer.deezer-desktop',
  'com.amazon.music',
  'com.coppertino.Vox',
  'com.swinsian.Swinsian',
  'com.audirvana.Audirvana-Studio',
  'tv.plex.plexamp',
  'com.ilabs.Doppler',
  'com.pocketcasts.mac',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class AudioDucker {
  constructor({ log = console } = {}) {
    this.log = log;
    this.state = null; // {mode:'paused', bundle} | {mode:'muted'} | {mode:'noop'}
    this.busy = Promise.resolve();
  }

  // Serialise duck/restore so rapid start/stop can't interleave.
  _queue(fn) { this.busy = this.busy.then(fn, fn); return this.busy; }

  // how: 'auto' (pause a known player, else mute) | 'pause' (only pause players) | 'mute' (always mute)
  duck(how = 'auto') { return this._queue(() => this._duck(how)); }
  restore() { return this._queue(() => this._restore()); }

  async _duck(how = 'auto') {
    if (this.state) return;
    let np = null;
    if (how !== 'mute' && mediaRemote.available()) {
      try { np = await mediaRemote.getNowPlaying(); }
      catch (e) { this.log.warn('[ducker] now-playing read failed', e.message); }
    }
    const bundle = np && (np.parentApplicationBundleIdentifier || np.bundleIdentifier);

    if (np && np.playing && KNOWN_PLAYERS.has(bundle)) {
      await mediaRemote.send(mediaRemote.Command.PAUSE);
      this.state = { mode: 'paused', bundle };
      this.log.info('[ducker] paused', bundle);
      return;
    }
    if (how === 'pause') { this.state = { mode: 'noop' }; return; }

    const before = await systemVolume.read();
    if (before.muted) { this.state = { mode: 'noop' }; return; } // user already muted
    await systemVolume.setMuted(true);
    this.state = { mode: 'muted', device: before.deviceId };
    // Opening the mic flips a BT headset A2DP -> HFP, which swaps the default
    // output device and drops our mute. Re-assert while it settles.
    if (this._mayRouteSwap(before)) await this._holdState(true);
  }

  async _restore() {
    const s = this.state;
    this.state = null;
    if (!s || s.mode === 'noop') return;

    if (s.mode === 'paused') {
      // Only resume if nobody else took over / user didn't resume themselves.
      try {
        const np = await mediaRemote.getNowPlaying();
        const bundle = np && (np.parentApplicationBundleIdentifier || np.bundleIdentifier);
        if (np && !np.playing && bundle === s.bundle) await mediaRemote.send(mediaRemote.Command.PLAY);
      } catch (e) { this.log.warn('[ducker] resume failed', e.message); }
      return;
    }

    // mode === 'muted'. On BT, wait for the HFP -> A2DP swap first, otherwise
    // the unmute lands on the HFP device that is about to vanish.
    const now = await systemVolume.read().catch(() => null);
    const swap = this._mayRouteSwap(now);
    if (swap) await this._waitForDeviceChange(now);
    await systemVolume.setMuted(false);
    if (swap) await this._holdState(false);
  }

  // BT output, or a reader that can't tell (osascript fallback): assume a swap can happen.
  _mayRouteSwap(r) {
    return !r || r.deviceId == null || systemVolume.isBluetooth(r);
  }

  // Re-assert `muted` for BT_SETTLE_MS: if the device swaps under us its mute
  // state resets, so we set it again.
  async _holdState(muted) {
    const deadline = Date.now() + BT_SETTLE_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const cur = await systemVolume.read().catch(() => null);
      if (cur && cur.muted !== muted) await systemVolume.setMuted(muted);
    }
  }

  // Wait up to BT_SETTLE_MS for the default output device to change. With
  // CoreAudio we compare device ids; with osascript only the volume changes.
  async _waitForDeviceChange(start) {
    if (!start) return;
    const deadline = Date.now() + BT_SETTLE_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const cur = await systemVolume.read().catch(() => null);
      if (!cur) continue;
      if (start.deviceId != null ? cur.deviceId !== start.deviceId : cur.volume !== start.volume) return;
    }
  }
}

module.exports = { AudioDucker, KNOWN_PLAYERS };
