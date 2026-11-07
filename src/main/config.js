'use strict';
// User settings + feature flags, persisted as JSON in userData.
// Settings = user-facing toggles. Flags = rollout/kill switches (could be fed remotely).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { EventEmitter } = require('events');

const DEFAULT_SETTINGS = {
  // audio + system
  muteAudioWhileDictating: true,
  soundsEnabled: true,
  micDeviceId: null,          // null = system default input
  launchAtLogin: false,
  showInDock: false,
  // dictation
  languages: [],              // [] = auto-detect; one code = force it; several = auto among them
  whisperModel: 'ggml-large-v3-turbo-q5_0.bin',
  pressEnterCommand: false,   // "press enter" at the end of a dictation sends Return
  triggerKey: 'fn',           // fn | rightOption | rightCommand
  defaultFormat: 'formatted', // formatted | casual | lowercase | raw | polish
  appFormats: [],             // [{bundleId, name, format}]
  theme: 'system',            // system | light | dark (Settings, Scratchpad)
  onboarded: false,
  // AI (Claude, user's own key)
  aiAutoPolish: false,        // polish every dictation before pasting
  aiStyle: 'cleanup',         // cleanup | polished | formal | casual | concise | custom
  aiCustomInstructions: '',
  aiModel: 'claude-opus-5-5',
  aiEffort: 'low',
  // meetings
  meetingSystemAudio: true,   // also record other participants (needs Screen Recording)
  meetingAutoSummary: true,   // summarize with Claude when a meeting ends
  // pill
  hidePill: false,
  pillEdge: 'left',           // left | right | bottom
  pillOffset: 0.5,            // 0..1 along that edge
  // history / privacy
  historyRetention: 'forever', // forever | 24h | never
  // hardware
  jabraOnHeadDetection: false, // off by default
};

const DEFAULT_FLAGS = {
  // _setPreventsActivation: is private. On macOS 27+ it is only called when this is on.
  panelPreventActivationMacOS27: false,
  jabraOnHead: false,
  permissionGuideOverlay: true,
};

class Config extends EventEmitter {
  constructor() {
    super();
    this.file = path.join(app.getPath('userData'), 'config.json');
    this.data = { settings: { ...DEFAULT_SETTINGS }, flags: { ...DEFAULT_FLAGS } };
    try {
      const disk = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      Object.assign(this.data.settings, disk.settings);
      Object.assign(this.data.flags, disk.flags);
    } catch { /* first run */ }
  }
  get settings() { return { ...this.data.settings }; }
  get flags() { return { ...this.data.flags }; }
  setting(k) { return this.data.settings[k]; }
  flag(k) { return !!this.data.flags[k]; }
  set(kind, key, value) {
    const bag = kind === 'flags' ? this.data.flags : this.data.settings;
    if (!(key in bag)) throw new Error(`unknown ${kind} key: ${key}`);
    bag[key] = value;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    this.emit('change', { kind, key, value });
  }
}

module.exports = { Config };
