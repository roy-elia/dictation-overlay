'use strict';
// Permission status + PermissionGuide.app driver.
//
// Grant detection (helper side — TCC only answers for the calling process, so
// the app being granted must check itself; the guide can't):
//   accessibility   isTrustedAccessibilityClient(false) — reflects changes live.
//                   Event-driven via the distributed notification
//                   "com.apple.accessibility.api", which System Settings posts
//                   whenever the AX trust list changes. Re-check ~250 ms later
//                   (TCC db write lags the notification).
//   screenRecording getMediaAccessStatus('screen') (CGPreflightScreenCaptureAccess).
//                   No change notification exists, so poll. Capture itself only
//                   works after relaunch -> we emit 'relaunch-required'.
//   appManagement   No API at all. Probe: create+delete a file inside a target
//                   bundle. EPERM => denied. Only meaningful for a bundle NOT
//                   signed by your team (same-team bundles are always writable).
// Plus: 1 s poll while the guide is open, and an immediate re-check whenever
// our app becomes active (user comes back from System Settings).
const { app, systemPreferences } = require('electron');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const PANELS = ['accessibility', 'screenRecording', 'appManagement'];

function ownBundlePath() {
  // .../X.app/Contents/MacOS/X -> .../X.app
  return path.resolve(path.dirname(process.execPath), '..', '..');
}

function guideBinary() {
  const appPath = app.isPackaged
    ? path.join(process.resourcesPath, 'PermissionGuide.app')
    : path.join(app.getAppPath(), 'permission-guide', 'build', 'PermissionGuide.app');
  return path.join(appPath, 'Contents', 'MacOS', 'PermissionGuide');
}

function probeAppManagement(targetBundle) {
  const probe = path.join(targetBundle, 'Contents', `.perm-probe-${process.pid}`);
  try {
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    return !(e.code === 'EPERM' || e.code === 'EACCES') ? null : false; // null = unknown
  }
}

class Permissions extends EventEmitter {
  constructor({ appManagementProbeTarget } = {}) {
    super();
    this.probeTarget = appManagementProbeTarget || ownBundlePath();
    this.last = {};
    this.pollTimer = null;
    this.guide = null;

    if (process.platform === 'darwin') {
      systemPreferences.subscribeNotification('com.apple.accessibility.api', () => {
        setTimeout(() => this.refresh(), 250);
      });
      app.on('browser-window-focus', () => this.refresh());
      app.on('activate', () => this.refresh());
    }
  }

  status(panel) {
    switch (panel) {
      case 'accessibility': return systemPreferences.isTrustedAccessibilityClient(false);
      case 'screenRecording': return systemPreferences.getMediaAccessStatus('screen') === 'granted';
      case 'appManagement': return probeAppManagement(this.probeTarget);
      default: throw new Error(`unknown panel ${panel}`);
    }
  }

  all() { return Object.fromEntries(PANELS.map((p) => [p, this.status(p)])); }

  refresh() {
    for (const p of PANELS) {
      const now = this.status(p);
      if (now === true && this.last[p] !== true) {
        this.emit('granted', p);
        if (p === 'screenRecording' && this.last[p] === false) this.emit('relaunch-required', p);
      }
      this.last[p] = now;
    }
    return this.last;
  }

  /**
   * Walk the user through every missing permission in `panels`, one pane at a
   * time, using a single PermissionGuide process. Resolves when all are
   * granted or the guide exits (timeout / closed).
   */
  async walkThrough(panels = PANELS) {
    this.refresh();
    const queue = panels.filter((p) => this.last[p] !== true);
    if (!queue.length) return { granted: panels, exited: 'nothing-to-do' };
    if (this.guide) this.closeGuide();

    const child = spawn(guideBinary(), [queue[0], ownBundlePath()], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.guide = child;
    const granted = [];

    const ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('PermissionGuide did not print READY')), 10_000);
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        this.emit('guide-line', line);
        if (line === 'READY') { clearTimeout(t); resolve(); }
      });
      child.once('error', reject);
    });

    const done = new Promise((resolve) => {
      child.once('exit', (code) => {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
        this.off('granted', onGranted);
        if (this.guide === child) this.guide = null;
        resolve({ granted, exited: code });
      });
    });

    const onGranted = (p) => {
      if (p !== queue[0]) return;
      granted.push(queue.shift());
      this.send(`GRANTED ${p}`);
      if (queue.length) this.send(`SHOW ${queue[0]}`);
      else this.closeGuide();
    };
    this.on('granted', onGranted);

    await ready;
    this.pollTimer = setInterval(() => this.refresh(), 1000);
    return done;
  }

  send(line) {
    if (this.guide && this.guide.stdin.writable) this.guide.stdin.write(line + '\n');
  }

  closeGuide() {
    if (!this.guide) return;
    this.send('CLOSE');
    const g = this.guide;
    setTimeout(() => { if (g.exitCode === null) g.kill('SIGTERM'); }, 2000);
  }
}

module.exports = { Permissions, PANELS };
