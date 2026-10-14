const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the actual main-process entry point with native window APIs represented by
// their observable state. No GUI access, login settings, or real accounts needed.
async function launch({ login = false, args = [] } = {}) {
  const windows = [];
  const app = new EventEmitter();
  Object.assign(app, {
    dock: { hide() {} }, isPackaged: false,
    whenReady: () => Promise.resolve(), isReady: () => true,
    getPath: () => '/tmp/markdown-window-test',
    getLoginItemSettings: () => ({ wasOpenedAtLogin: login, wasOpenedAsHidden: login }),
    quit() { app.quitCalled = true; },
  });
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.visible = options.show;
      this.minimized = false;
      this.bounds = { x: 0, y: 0, width: options.width, height: options.height };
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      windows.push(this);
    }
    loadFile() { queueMicrotask(() => this.emit('ready-to-show')); }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    focus() { this.focused = true; }
    isVisible() { return this.visible; }
    isDestroyed() { return false; }
    isMinimized() { return this.minimized; }
    restore() { this.minimized = false; }
    getBounds() { return this.bounds; }
    setBounds(bounds) { this.bounds = bounds; }
  }
  class Tray extends EventEmitter {
    setToolTip() {}
    getBounds() { return { x: 1300, y: 0, width: 20, height: 24 }; }
  }
  const electron = {
    app, BrowserWindow: Window, Tray, Menu: { buildFromTemplate: value => value },
    ipcMain: { handle() {} }, dialog: {}, shell: {},
    nativeImage: { createFromPath: () => ({ setTemplateImage() {} }) },
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 24, width: 1440, height: 876 } }),
      getDisplayMatching: () => ({ workArea: { x: 0, y: 24, width: 1440, height: 876 } }),
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), {
    require(id) {
      if (id === 'electron') return electron;
      if (id === './conversion-runner') return {};
      if (id === './destinations') return { createDestinations: () => ({}) };
      if (id === './connections') return { createConnections: () => ({}), cancelActiveCommands() {} };
      return require(id);
    },
    __dirname: path.join(__dirname, '..'),
    process: { argv: ['electron', 'main.js', ...args], arch: 'arm64' },
  }, { filename: 'main.js' });
  await new Promise(resolve => setImmediate(resolve));
  return { app, windows };
}

test('opening the app normally displays its window without a command-line flag', async () => {
  const { windows } = await launch();
  assert.equal(windows.length, 1);
  assert.equal(windows[0].isVisible(), true, 'The app started, but its window stayed hidden');
});

test('opening an already-running app reveals the hidden window without losing it', async () => {
  const { app, windows } = await launch();
  windows[0].hide();
  app.emit('activate');
  assert.equal(windows[0].isVisible(), true, 'Finder activation did not reveal the existing window');
  assert.equal(windows.length, 1);
});

test('repeated activation keeps the window open and restores a minimized window', async () => {
  const { app, windows } = await launch({ args: ['--show'] });
  app.emit('activate');
  assert.equal(windows[0].isVisible(), true);
  windows[0].minimized = true;
  app.emit('activate');
  assert.equal(windows[0].isMinimized(), false);
});

test('login launch stays hidden until explicitly opened', async () => {
  const { app, windows } = await launch({ login: true });
  assert.equal(windows[0].isVisible(), false);
  app.emit('activate');
  assert.equal(windows[0].isVisible(), true);
});

test('--show overrides hidden login launch', async () => {
  const { windows } = await launch({ login: true, args: ['--show'] });
  assert.equal(windows[0].isVisible(), true);
});
