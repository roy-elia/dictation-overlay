# RoyFlow

A personal macOS dictation pill built with Electron. It has four native pillars.

| Pillar | Code | Gate |
|---|---|---|
| Focus: the pill never steals focus | `native/panel_activation` (`preventActivation`) | Always on before macOS 27. On macOS 27+ it needs the flag `panelPreventActivationMacOS27`. |
| Audio ducking | `src/main/audio/*` | Setting `muteAudioWhileDictating` |
| Permission guide (macOS 26+) | `permission-guide/` → `PermissionGuide.app`, driven by `src/main/permissions.js` | Flag `permissionGuideOverlay` |
| Jabra on-head sensor | `src/main/jabra.js` | Setting `jabraOnHeadDetection` **and** flag `jabraOnHead` (both off by default) |

These standard parts are in `src/main/infra.js`: `electron-updater` for updates and `better-sqlite3` for the database. IPC channels are listed in `src/shared/ipc.js`. The renderer only sees `window.dictation`, which `src/preload/preload.js` exposes. That preload runs sandboxed, and the main process checks every IPC sender.

## Build

```bash
brew install cmake                 # needed for mediaremote-adapter
npm install                        # builds panel-activation and better-sqlite3 against Electron
npm run build:mediaremote          # clones and builds ungive/mediaremote-adapter v0.7.7 into vendor/
npm run build:guide                # SwiftPM, then wraps PermissionGuide.app (ad-hoc signed)
npm start
DICTATION_SELFTEST=1 npm start   # runs the permission check, mute/restore and a DB write, then quits
```

To use Jabra, run `JABRA_PARTNER_KEY=... npm start` and turn on both the setting and the flag. To use a different on-head property, set `JABRA_ONHEAD_PROPERTY`.

## Menu bar

RoyFlow has no Dock icon. Its microphone icon in the menu bar has these items:
- Start or Stop Dictation
- Show Dictation Pill
- Permissions…
- the update state: Check for Updates, Downloading…, or **Restart to Install x.y.z**
- **Quit RoyFlow**

Quitting normally (including with `kill`, since SIGTERM and SIGINT go through `app.quit()`) restores your audio and lets Squirrel.Mac install an update that has already downloaded. To regenerate the icon, run `swift scripts/make-tray-icon.swift "$PWD"`.

## Packaging, signing and updates

```bash
npm run dist      # arm64 + x64 → DMG and zip in dist/, plus latest-mac.yml
npm run release   # same, then uploads them to GitHub Releases (needs GH_TOKEN)
swift scripts/make-icon.swift "$PWD"   # regenerates build/icon.icns
```

- **Signing:** [`scripts/sign.js`](scripts/sign.js) runs as electron-builder's `afterSign` hook. `mac.identity` is set to `null` because electron-builder won't use a self-signed certificate. The hook signs everything inside out with `$CODESIGN_IDENTITY`. If that isn't set, it uses `Clipper Local Signing` when it's in your keychain, and ad-hoc signing otherwise. Signing with a certificate makes the app's identity `identifier "dev.personal.dictation-overlay" and certificate leaf = …`, so permission grants survive rebuilds, and Squirrel.Mac accepts updates signed with the same certificate.
- **Updates:** `electron-updater` checks GitHub Releases on `roy-elia/dictation-overlay`. On macOS it installs from the `-mac.zip` files. The repo has to exist and be public, otherwise checks return 404. A private repo would need a token available when the app runs.
- **Gatekeeper:** only files with the quarantine flag get checked, which means files downloaded through a browser. A DMG you build locally opens without a prompt. A copy downloaded from Releases needs a right-click and Open, because the certificate isn't notarized.
- **Intel:** the native add-ons are rebuilt for each architecture during packaging, and `MediaRemoteAdapter.framework` and `PermissionGuide.app` are universal. `npm run dist` runs `build:native` afterwards so `npm start` gets the arm64 add-ons back.

## How the pieces work

**Focus.** The overlay is an `NSPanel` (`type: 'panel'`) with `focusable: false` and is shown with `showInactive()`. The addon gets the `NSWindow` from `getNativeWindowHandle()`, or by window title. Before calling `-_setPreventsActivation:YES` it checks that the method has the expected shape:
- the selector exists
- it takes 3 arguments
- it returns `v`
- its argument type is `B` or `c`

If any check fails, it returns `{applied:false, reason}` instead of crashing.

**Ducking.** It reads now-playing info through `/usr/bin/perl mediaremote-adapter.pl MediaRemoteAdapter.framework get`.
- Since macOS 15.4, only Apple-signed processes may read now-playing info. Running inside Apple's own `perl` gets around this.
- If a known player (`KNOWN_PLAYERS`) is playing, it sends `send 1` to pause, then `send 0` to resume, but only if the same app is still paused.
- Otherwise it mutes the system output through CoreAudio. On Bluetooth output it re-applies the mute for 500 ms, polling every 20 ms, because opening the mic switches the headset to HFP and gives it a new device id. Before unmuting, it waits up to 500 ms for the device id to change back (A2DP).
- Quitting the app always restores audio first.

**Permission guide.** The app is launched as `PermissionGuide <panel> <hostAppPath>`.
- It prints `READY`.
- It accepts `SHOW <panel>`, `GRANTED <panel>` and `CLOSE` on stdin.
- It exits after 10 minutes, on `CLOSE`, at stdin EOF, or when its parent process exits.

Grant detection happens in the helper, because TCC can only say whether the process that is asking has been granted. Each permission is detected differently:
- **Accessibility:** the `com.apple.accessibility.api` distributed notification, then `isTrustedAccessibilityClient(false)`. This updates live.
- **Screen Recording:** polls `getMediaAccessStatus('screen')`. After a grant the app relaunches, because capture only works in a new process.
- **App Management:** there is no API, so it tries writing a probe file into a target bundle. This only means something for a bundle signed by a different developer team.

The helper also re-checks once a second while the guide is open, and whenever the app becomes active again.

## Caveats
- `_setPreventsActivation:` is private API and may break in any macOS release. That is why macOS 27 has a flag.
- Jabra: the packages are `@gnaudio/jabra-js` 4.4.4, `@gnaudio/jabra-js-properties` and `@gnaudio/jabra-properties-definition`. The sensor is the `onHeadDetectionStatus` property, which reports `leftOn`, `leftOff`, `rightOn` or `rightOff`. The headset counts as worn when either cup is on. This hasn't been tested with a real headset.
- Mute and volume go through `native/audio_control`, a CoreAudio addon that responds in under a millisecond and reports the device id and transport. If that addon is missing, or the device has no mute it can set, the app falls back to AppleScript (about 240 ms per call). The 500 ms Bluetooth window only applies when the output is Bluetooth or the transport is unknown.
- The AppleScript fallback needs the Apple Events permission (described in `NSAppleEventsUsageDescription`).
