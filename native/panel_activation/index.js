'use strict';
let binding = null;
if (process.platform === 'darwin') {
  try { binding = require('./build/Release/panel_activation.node'); }
  catch (e) { console.warn('[panel-activation] native module not built:', e.message); }
}

/**
 * @param {Buffer|string} target  BrowserWindow.getNativeWindowHandle() or window title
 * @param {{allowOnMacOS27?: boolean}} [options]
 * @returns {{applied: boolean, reason: string}}
 */
function preventActivation(target, options = {}) {
  if (!binding) return { applied: false, reason: 'unavailable' };
  return binding.preventActivation(target, options);
}

module.exports = { preventActivation };
