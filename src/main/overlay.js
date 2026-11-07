'use strict';
// The pill window: transparent, non-activating NSPanel, click-through except
// over the pill itself. Docked to the bottom, left or right screen edge; the
// user drags it along/between edges and it snaps to the nearest one.
const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { preventActivation } = require('panel-activation');

// Window size per edge: room for the bubble, the toolbar and side tooltips.
const SIZE = { left: [340, 300], right: [340, 300], bottom: [460, 120] };
const MARGIN = 0;

function createOverlay({ config, log = console }) {
  const win = new BrowserWindow({
    title: 'RoyFlowPill',
    type: 'panel',
    width: SIZE.left[0], height: SIZE.left[1],
    frame: false, transparent: true, hasShadow: false, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, focusable: false, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true }); // renderer flips this on hover
  win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));

  const display = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;

  function place(edge = config.setting('pillEdge'), offset = config.setting('pillOffset')) {
    const a = display();
    const o = Math.max(0, Math.min(1, offset));
    const [W, H] = SIZE[edge] || SIZE.left;
    let x, y;
    if (edge === 'left') { x = a.x + MARGIN; y = a.y + o * (a.height - H); }
    else if (edge === 'right') { x = a.x + a.width - W - MARGIN; y = a.y + o * (a.height - H); }
    else { x = a.x + o * (a.width - W); y = a.y + a.height - H - MARGIN; }
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: W, height: H });
    win.webContents.send('ev:pill-edge', edge);
  }

  win.once('ready-to-show', () => {
    log.info('[focus] preventActivation:', preventActivation(win.getNativeWindowHandle(), {
      allowOnMacOS27: config.flag('panelPreventActivationMacOS27'),
    }));
    place();
    if (!config.setting('hidePill')) win.showInactive();
  });
  screen.on('display-metrics-changed', () => place());

  // --- drag: renderer reports screen coords; we follow, then snap on drop ---
  let grab = null;
  function drag({ phase, x, y }) {
    if (phase === 'start') { const b = win.getBounds(); grab = { dx: x - b.x, dy: y - b.y }; return; }
    if (!grab) return;
    if (phase === 'move') { win.setPosition(Math.round(x - grab.dx), Math.round(y - grab.dy)); return; }
    grab = null;
    const a = display(), b = win.getBounds();
    const p = screen.getCursorScreenPoint(); // where the bubble was dropped
    const cx = p.x, cy = p.y;
    const dist = { left: cx - a.x, right: a.x + a.width - cx, bottom: a.y + a.height - cy };
    const edge = Object.entries(dist).sort((p, q) => p[1] - q[1])[0][0];
    const [W, H] = SIZE[edge];
    const offset = edge === 'bottom' ? (cx - W / 2 - a.x) / (a.width - W) : (cy - H / 2 - a.y) / (a.height - H);
    config.set('settings', 'pillOffset', Math.max(0, Math.min(1, offset)));
    config.set('settings', 'pillEdge', edge); // triggers place()
  }

  return {
    win,
    place,
    drag,
    setInteractive: (on) => win.setIgnoreMouseEvents(!on, { forward: true }),
    setVisible: (v) => (v ? win.showInactive() : win.hide()),
  };
}

module.exports = { createOverlay };
