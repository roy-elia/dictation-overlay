'use strict';
// electron-builder afterSign hook (build.afterSign; mac.identity=null so the
// builtin signer is skipped). Runs after packing, before dmg/zip are built. Signs inside-out with a
// local identity, because electron-builder refuses self-signed (untrusted)
// certs. Identity: $CODESIGN_IDENTITY, else "Clipper Local Signing" if present,
// else ad-hoc ("-").
//
// A real (even self-signed) certificate gives a stable designated requirement,
// so macOS keeps Accessibility / Screen Recording grants across rebuilds and
// Squirrel.Mac accepts updates signed by the same cert.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ENT = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');

function pickIdentity() {
  if (process.env.CODESIGN_IDENTITY) return process.env.CODESIGN_IDENTITY;
  const out = execFileSync('security', ['find-identity', '-p', 'codesigning'], { encoding: 'utf8' });
  return /"Clipper Local Signing"/.test(out) ? 'Clipper Local Signing' : '-';
}

function walk(dir, pred, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (pred(p, e)) acc.push(p);
    if (e.isDirectory()) walk(p, pred, acc);
  }
  return acc;
}

function isMachO(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, 0);
    const m = b.readUInt32BE(0);
    // thin 64/32-bit (both endians) or fat/universal
    return [0xfeedfacf, 0xcffaedfe, 0xfeedface, 0xcefaedfe, 0xcafebabe].includes(m);
  } finally { fs.closeSync(fd); }
}

module.exports = async function sign(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  const id = pickIdentity();
  const sign = (target, ent) => execFileSync('codesign', [
    '--force', '--timestamp=none', '--options', 'runtime', '--sign', id,
    ...(ent ? ['--entitlements', ENT] : []), target,
  ], { stdio: 'inherit' });

  console.log(`  • signing ${path.basename(app)} with "${id}"`);
  const C = path.join(app, 'Contents');

  // 1. Leaf binaries: native modules, dylibs, and loose Mach-O helpers inside
  //    frameworks (the x64 Electron zip ships chrome_crashpad_handler unsigned).
  const leaves = walk(C, (p, e) => e.isFile() &&
    (/\.(node|dylib)$/.test(p) || (/\/(Helpers|Libraries)\//.test(p) && isMachO(p))));
  for (const f of leaves) sign(f);
  // 2. Our nested bundles.
  for (const f of [
    path.join(C, 'Resources', 'mediaremote', 'MediaRemoteAdapter.framework'),
    path.join(C, 'Resources', 'PermissionGuide.app'),
    path.join(C, 'Resources', 'whisper', 'whisper-server'),
  ]) if (fs.existsSync(f)) sign(f);
  // 3. Electron frameworks, then helper apps (helpers need entitlements for JIT).
  const fw = path.join(C, 'Frameworks');
  for (const e of fs.readdirSync(fw)) {
    if (e.endsWith('.framework')) sign(path.join(fw, e));
  }
  for (const e of fs.readdirSync(fw)) {
    if (e.endsWith('.app')) sign(path.join(fw, e), true);
  }
  // 4. The app itself.
  sign(app, true);
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
