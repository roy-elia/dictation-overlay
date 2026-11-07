'use strict';
// Sandboxed preload: sandboxed preloads can only require('electron') (and a
// few builtins), so channel names are inlined here; keep in sync with src/shared/ipc.js.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('dictation', {
  start: () => ipcRenderer.invoke('dictation:start'),
  stop: () => ipcRenderer.invoke('dictation:stop'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  permissionStatus: () => ipcRenderer.invoke('permissions:status'),
  openPermissionGuide: (panels) => ipcRenderer.invoke('permissions:guide', panels),
  addTranscript: (text, targetApp) => ipcRenderer.invoke('transcript:add', text, targetApp),
  recentTranscripts: (n) => ipcRenderer.invoke('transcript:recent', n),
  onState: on('ev:dictation-state'),
  onPermissions: on('ev:permissions'),
  onJabra: on('ev:jabra'),
  onSettings: on('ev:settings'),
});
