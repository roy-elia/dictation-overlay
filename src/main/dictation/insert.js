'use strict';
// Put text into whatever field has focus: stash the clipboard, write the
// text, send ⌘V, then put the user's clipboard back.
const { clipboard } = require('electron');

const RESTORE_AFTER_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function snapshot() {
  return clipboard.availableFormats().map((format) => ({ format, data: clipboard.readBuffer(format) }));
}

function restore(items) {
  clipboard.clear();
  if (!items.length) return;
  for (const { format, data } of items) clipboard.writeBuffer(format, data);
}

function createInserter(input, log = console) {
  let busy = Promise.resolve();
  return function insert(text) {
    busy = busy.then(async () => {
      const saved = snapshot();
      clipboard.writeText(text);
      input.paste();
      await sleep(RESTORE_AFTER_MS);
      // Only restore if nothing else wrote to the clipboard meanwhile.
      if (clipboard.readText() === text) restore(saved);
    }).catch((e) => log.warn('[insert]', e.message));
    return busy;
  };
}

module.exports = { createInserter };
