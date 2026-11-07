'use strict';
let binding = null;
if (process.platform === 'darwin') {
  try { binding = require('./build/Release/audio_control.node'); }
  catch (e) { console.warn('[audio-control] native module not built:', e.message); }
}
module.exports = {
  available: () => binding !== null,
  read: () => (binding ? binding.read() : null),
  setMuted: (m) => (binding ? binding.setMuted(Boolean(m)) : false),
};
