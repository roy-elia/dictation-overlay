'use strict';
// Jabra on-head detection (GN Audio Jabra JavaScript SDK 4.4.4, Node/USB).
// Gated twice: user setting `jabraOnHeadDetection` AND feature flag `jabraOnHead`.
// Only Evolve3 75 / 85 are watched. Emits 'on-head' (true/false/null) and 'device'.
//
// Packages (verified against the installed SDK):
//   @gnaudio/jabra-js                   createApi / start / deviceAdded / deviceRemoved
//   @gnaudio/jabra-js-properties        PropertyModule -> factory -> properties.get(name).watch()
//   @gnaudio/jabra-properties-definition properties.json
// Property: `onHeadDetectionStatus`, a string enum per ear cup:
//   leftOn | leftOff | rightOn | rightOff
// Worn = either cup reports "on".
const { EventEmitter } = require('events');

const SUPPORTED = /evolve\s*3\s*(75|85)/i;
const PROPERTY = process.env.JABRA_ONHEAD_PROPERTY || 'onHeadDetectionStatus';

class JabraOnHead extends EventEmitter {
  constructor({ partnerKey, appId = 'royflow', appName = 'RoyFlow', log = console } = {}) {
    super();
    Object.assign(this, { partnerKey, appId, appName, log });
    this.sdk = null;
    this.subs = [];
    this.devices = new Map(); // key -> {sub, cups:{left,right}}
    this.onHead = null;
  }

  static enabled(config) {
    return config.setting('jabraOnHeadDetection') === true && config.flag('jabraOnHead');
  }

  async start() {
    if (this.sdk) return;
    if (!this.partnerKey) throw new Error('Jabra partner key missing (set JABRA_PARTNER_KEY)');

    const { createApi } = require('@gnaudio/jabra-js');
    const { PropertyModule } = require('@gnaudio/jabra-js-properties');
    const definition = require('@gnaudio/jabra-properties-definition/properties.json');

    // Node: omit `transport`; the SDK talks USB HID via its bundled jabra-device-connector.
    this.sdk = await createApi({ partnerKey: this.partnerKey, appId: this.appId, appName: this.appName });
    this.factory = await new PropertyModule().createPropertyFactory(definition);

    this.subs.push(this.sdk.deviceAdded.subscribe((d) =>
      this._attach(d).catch((e) => this.log.warn('[jabra] attach failed:', e.message))));
    this.subs.push(this.sdk.deviceRemoved.subscribe((d) => this._detach(d)));
    await this.sdk.start();
  }

  _key(device) { return `${device.productId}:${device.serialNumber ?? device.name}`; }

  async _attach(device) {
    if (!SUPPORTED.test(device.name || '')) return;
    const properties = await this.factory.createProperties(device, [PROPERTY]);
    const entry = { cups: { left: null, right: null }, sub: null };
    entry.sub = properties.get(PROPERTY).watch().subscribe({
      next: (v) => {
        const m = /^(left|right)(On|Off)$/.exec(String(v));
        if (m) entry.cups[m[1]] = m[2] === 'On';
        else if (typeof v === 'boolean') entry.cups.left = entry.cups.right = v;
        this._recompute();
      },
      error: (e) => this.log.warn('[jabra] watch error', e?.message ?? e),
    });
    this.devices.set(this._key(device), entry);
    this.emit('device', { name: device.name, productId: device.productId, connected: true });
  }

  _detach(device) {
    const entry = this.devices.get(this._key(device));
    if (!entry) return;
    entry.sub.unsubscribe();
    this.devices.delete(this._key(device));
    this.emit('device', { name: device.name, productId: device.productId, connected: false });
    this._recompute();
  }

  _recompute() {
    let v = null;
    for (const { cups } of this.devices.values()) {
      if (cups.left || cups.right) { v = true; break; }
      if (cups.left === false || cups.right === false) v = false;
    }
    if (v === this.onHead) return;
    this.onHead = v;
    this.emit('on-head', v);
  }

  async stop() {
    for (const { sub } of this.devices.values()) sub.unsubscribe();
    this.devices.clear();
    for (const s of this.subs) s.unsubscribe();
    this.subs = [];
    this.sdk = null;
    this._recompute();
  }
}

module.exports = { JabraOnHead, PROPERTY };
