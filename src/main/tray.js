'use strict';
// Menu-bar item. RoyFlow hides its Dock icon, so this is the only way to quit
// it, and quitting normally is what lets Squirrel.Mac install a downloaded update.
const path = require('path');
const { Tray, Menu, nativeImage, app } = require('electron');

function updateItem(updater) {
  switch (updater.status) {
    case 'ready': return { label: `Restart to Install ${updater.version}`, click: () => updater.installNow() };
    case 'downloading': return { label: `Downloading ${updater.version}…`, enabled: false };
    case 'checking': return { label: 'Checking for Updates…', enabled: false };
    case 'disabled': return { label: 'Updates Off (dev build)', enabled: false };
    default: return { label: 'Check for Updates', click: () => updater.check() };
  }
}

function createTray({ state, overlay, updater, onToggleDictation, onPermissions }) {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'trayTemplate.png'));
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  tray.setToolTip('RoyFlow');

  const render = () => {
    const win = overlay();
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `RoyFlow ${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      { label: state.recording ? 'Stop Dictation' : 'Start Dictation', click: onToggleDictation },
      {
        label: 'Show Dictation Pill', type: 'checkbox', checked: !!win?.isVisible(),
        click: (item) => { if (!win) return; item.checked ? win.showInactive() : win.hide(); },
      },
      { label: 'Permissions…', click: onPermissions },
      { type: 'separator' },
      updateItem(updater),
      { type: 'separator' },
      { label: 'Quit RoyFlow', accelerator: 'Command+Q', click: () => app.quit() },
    ]));
  };

  render();
  updater.on('change', render);
  return { tray, render };
}

module.exports = { createTray };
