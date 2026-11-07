'use strict';
// Now-playing read/control via ungive/mediaremote-adapter (BSD-3-Clause).
//
// macOS 15.4 workaround: since 15.4, mediaremoted only answers now-playing
// queries from Apple-signed processes (entitlement check on the client). The
// adapter therefore never loads MediaRemote into *our* process. Instead we run
// Apple's own signed /usr/bin/perl, which DynaLoader-loads
// MediaRemoteAdapter.framework and prints JSON. perl is platform-signed, so the
// check passes. We use the same route on every OS version for one code path.
//
//   /usr/bin/perl <abs>/mediaremote-adapter.pl <abs>/MediaRemoteAdapter.framework get
//   /usr/bin/perl <abs>/mediaremote-adapter.pl <abs>/MediaRemoteAdapter.framework send <id>
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const PERL = '/usr/bin/perl'; // must be Apple's binary, never a Homebrew perl
const Command = Object.freeze({ PLAY: 0, PAUSE: 1, TOGGLE: 2 });

function adapterPaths() {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'mediaremote')
    : path.join(app.getAppPath(), 'vendor', 'mediaremote-adapter');
  const script = app.isPackaged
    ? path.join(base, 'mediaremote-adapter.pl')
    : path.join(base, 'bin', 'mediaremote-adapter.pl');
  const framework = app.isPackaged
    ? path.join(base, 'MediaRemoteAdapter.framework')
    : path.join(base, 'build', 'MediaRemoteAdapter.framework');
  return { script, framework };
}

function available() {
  const { script, framework } = adapterPaths();
  return fs.existsSync(PERL) && fs.existsSync(script) && fs.existsSync(framework);
}

function run(args, timeout = 2000) {
  const { script, framework } = adapterPaths();
  return new Promise((resolve, reject) => {
    execFile(PERL, [script, framework, ...args], { timeout }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`mediaremote-adapter ${args[0]} failed: ${stderr || err.message}`));
      resolve(stdout.trim());
    });
  });
}

/** @returns {Promise<null | {bundleIdentifier:string, parentApplicationBundleIdentifier?:string, playing:boolean, title?:string}>} */
async function getNowPlaying() {
  const out = await run(['get']);
  if (!out || out === 'null') return null;
  return JSON.parse(out);
}

async function send(commandId) {
  await run(['send', String(commandId)]);
}

module.exports = { available, getNowPlaying, send, Command };
