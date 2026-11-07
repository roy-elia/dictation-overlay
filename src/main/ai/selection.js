'use strict';
// Read the focused app's current selection by sending ⌘C, then put the
// user's clipboard back. Returns '' when nothing is selected.
const { clipboard } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MARKER = '⁣royflow-selection-probe⁣';

async function readSelection(input, { timeoutMs = 350 } = {}) {
  const saved = clipboard.availableFormats().map((format) => ({ format, data: clipboard.readBuffer(format) }));
  clipboard.writeText(MARKER);
  input.pressKey('c', { cmd: true });
  let text = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(25);
    const now = clipboard.readText();
    if (now !== MARKER) { text = now; break; }
  }
  clipboard.clear();
  for (const { format, data } of saved) clipboard.writeBuffer(format, data);
  return text;
}

module.exports = { readSelection };
