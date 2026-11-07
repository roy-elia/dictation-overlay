'use strict';
let binding = null;
if (process.platform === 'darwin') {
  try { binding = require('./build/Release/input_control.node'); }
  catch (e) { console.warn('[input-control] native module not built:', e.message); }
}
const noop = () => false;
module.exports = binding
  ? { available: () => true, ...binding }
  : { available: noop, start: noop, stop: noop, setRecording: noop, paste: noop, pressKey: noop, isTrusted: noop };
