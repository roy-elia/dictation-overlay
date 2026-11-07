'use strict';
// Sandboxed preload. Renderers get `window.royflow`:
//   call(channel, ...args)  -> ipcRenderer.invoke, only for allowlisted channel prefixes
//   on(event, cb)           -> main->renderer events (prefix "ev:")
// plus a few named helpers for the pill. Main re-checks every sender.
const { contextBridge, ipcRenderer } = require('electron');

const CALL_PREFIXES = ['settings:', 'app:', 'permissions:', 'history:', 'vocab:', 'ai:', 'meetings:', 'pill:', 'audio:'];
const SEND = new Set(['pill:hover', 'pill:drag', 'pill:menu', 'audio:devices']);

function on(event, cb) {
  if (!event.startsWith('ev:')) throw new Error(`not an event channel: ${event}`);
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(event, fn);
  return () => ipcRenderer.removeListener(event, fn);
}
function call(channel, ...args) {
  if (!CALL_PREFIXES.some((p) => channel.startsWith(p))) throw new Error(`blocked channel: ${channel}`);
  return ipcRenderer.invoke(channel, ...args);
}
function send(channel, payload) {
  if (!SEND.has(channel)) throw new Error(`blocked channel: ${channel}`);
  ipcRenderer.send(channel, payload);
}

contextBridge.exposeInMainWorld('royflow', {
  call,
  on,
  // pill helpers
  onPillState: (cb) => on('ev:pill-state', cb),
  onPillEdge: (cb) => on('ev:pill-edge', cb),
  onSound: (cb) => on('ev:sound', cb),
  onAudioCommand: (cb) => on('ev:audio-cmd', cb),
  audioResult: (id, result) => call('audio:result', id, result),
  devicesChanged: (list) => send('audio:devices', list),
  pillHover: (on_) => send('pill:hover', !!on_),
  pillDrag: (d) => send('pill:drag', d),
  pillMenu: () => send('pill:menu'),
  pillAction: (name) => call('pill:action', name),
});
