'use strict';
// Single source of truth for IPC channel names (main + preload).
module.exports = Object.freeze({
  // renderer -> main (invoke)
  DICTATION_START: 'dictation:start',
  DICTATION_STOP: 'dictation:stop',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  PERMISSIONS_STATUS: 'permissions:status',
  PERMISSIONS_GUIDE: 'permissions:guide',
  TRANSCRIPT_ADD: 'transcript:add',
  TRANSCRIPT_RECENT: 'transcript:recent',
  // main -> renderer (events)
  EV_DICTATION_STATE: 'ev:dictation-state',
  EV_PERMISSIONS: 'ev:permissions',
  EV_JABRA: 'ev:jabra',
  EV_SETTINGS: 'ev:settings',
});
