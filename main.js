const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage, screen, shell } = require('electron');
const path = require('node:path');
const { startConversion } = require('./conversion-runner');
const { createDestinations } = require('./destinations');
const { createConnections, cancelActiveCommands } = require('./connections');

let tray = null;
let mainWindow = null;
let activeConversion = null;
let destinations;
let connections;
let saving = false;
let quitting = false;
let dialogOpen = false;
let windowReady = false;
let showWhenReady = false;

if (app.dock) app.dock.hide();
if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });

function createWindow() {
  windowReady = false;
  const area = screen.getPrimaryDisplay().workArea;
  mainWindow = new BrowserWindow({
    width: Math.min(1040, area.width),
    height: Math.min(820, area.height),
    minWidth: 640,
    minHeight: 540,
    show: false,
    titleBarStyle: 'hiddenInset',
    skipTaskbar: true,
    resizable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.once('ready-to-show', () => {
    windowReady = true;
    if (showWhenReady) showWindow();
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  // Keep the preview visible when users switch apps or a native sheet takes focus.
  mainWindow.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    if (!dialogOpen) mainWindow.hide();
  });
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('render-process-gone', () => activeConversion?.cancel());
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (!windowReady) {
    showWhenReady = true;
    return;
  }
  showWhenReady = false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) positionWindow();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (dialogOpen) { mainWindow.focus(); return; }
  if (mainWindow?.isVisible() && !mainWindow.isMinimized()) mainWindow.hide();
  else showWindow();
}

function positionWindow() {
  if (!tray) return;
  const trayBounds = tray.getBounds();
  const area = screen.getDisplayMatching(trayBounds).workArea;
  const bounds = mainWindow.getBounds();
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  const x = Math.max(area.x, Math.min(Math.round(trayBounds.x + trayBounds.width / 2 - width / 2), area.x + area.width - width));
  const y = Math.max(area.y, Math.min(trayBounds.y + trayBounds.height, area.y + area.height - height));
  mainWindow.setBounds({ x, y, width, height });
}

app.whenReady().then(() => {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'iconTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Markdown Converter');
  tray.on('click', toggleWindow);
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate([
    { label: 'Show / hide converter', click: toggleWindow },
    { type: 'separator' },
    { label: 'Quit Markdown Converter', click: () => app.quit() },
  ])));
  destinations = createDestinations({
    settingsPath: path.join(app.getPath('userData'), 'destinations.json'),
    home: app.getPath('home'),
    documents: app.getPath('documents'),
    dialog,
    getWindow: () => mainWindow,
  });
  connections = createConnections({
    settingsPath: path.join(app.getPath('userData'), 'connections.json'),
    cacheDir: path.join(app.getPath('userData'), 'composio'),
    openExternal: url => shell.openExternal(url),
    executable: app.isPackaged ? path.join(process.resourcesPath, 'composio', 'composio') : path.join(__dirname, 'vendor', `composio-darwin-${process.arch}`, 'composio'),
  });
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  // A Finder launch should open the editor. Only automatic login launches stay
  // in the menu bar until the user explicitly opens the app.
  const { wasOpenedAtLogin, wasOpenedAsHidden } = app.getLoginItemSettings();
  if (process.argv.includes('--show') || (!wasOpenedAtLogin && !wasOpenedAsHidden)) showWindow();
});

app.on('activate', () => {
  if (app.isReady()) showWindow();
});
app.on('window-all-closed', () => {});
app.on('before-quit', () => { quitting = true; activeConversion?.cancel(); cancelActiveCommands(); });

async function withDialog(action) {
  if (dialogOpen) return { ok: false, error: 'Finish the open dialog first.' };
  dialogOpen = true;
  try { return await action(); }
  catch (error) { return { ok: false, error: error.message }; }
  finally { dialogOpen = false; }
}

ipcMain.handle('open-file', () => withDialog(async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Documents', extensions: ['pdf', 'docx', 'html', 'htm', 'txt', 'md', 'markdown', 'text', 'csv', 'json', 'xml'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return canceled || !filePaths.length ? { ok: false, canceled: true } : { ok: true, filePath: filePaths[0] };
}));

async function runConversion(kind, input) {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, error: 'Choose a file or paste some content first.' };
  if (activeConversion) return { ok: false, error: 'Wait for the current conversion or cancel it first.' };
  const job = startConversion(kind, input);
  activeConversion = job;
  try { return await job.promise; }
  finally { if (activeConversion === job) activeConversion = null; }
}
ipcMain.handle('convert-file', (_event, filePath) => runConversion('file', filePath));
ipcMain.handle('convert-html', (_event, html) => runConversion('html', html));
ipcMain.handle('convert-url', (_event, url) => runConversion('url', url));
ipcMain.handle('cancel-conversion', () => { activeConversion?.cancel(); return { ok: true }; });
ipcMain.handle('list-destinations', async () => {
  try { return { ok: true, destinations: await destinations.list() }; }
  catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('choose-destination', (_event, id) => withDialog(() => destinations.choose(id)));
ipcMain.handle('save-file', async (_event, content, defaultName, destination) => {
  if (saving) return { ok: false, error: 'A save is already in progress.' };
  saving = true;
  try {
    if (typeof content !== 'string') throw new Error('There is no Markdown to save.');
    const name = path.basename(defaultName || 'converted.md').replace(/[\x00-\x1f:]/g, '-');
    if (['google-drive', 'notion'].includes(destination)) return await connections.save(destination, content, name);
    return await withDialog(() => destinations.save(content, name, destination));
  } catch (error) { return { ok: false, error: error.message }; }
  finally { saving = false; }
});
async function connectionAction(action) {
  try { return { ok: true, ...await action() }; }
  catch (error) { return { ok: false, error: error.message }; }
}
ipcMain.handle('connection-status', () => connectionAction(async () => ({ connections: await connections.status() })));
ipcMain.handle('connect-account', (_event, provider) => connectionAction(() => connections.connect(provider)));
ipcMain.handle('configure-account', (_event, provider, account, target) => connectionAction(() => connections.configure(provider, account, target)));
ipcMain.handle('open-saved-link', async (_event, value) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['drive.google.com', 'www.notion.so', 'notion.so', 'www.notion.com', 'notion.com', 'app.notion.com'].includes(url.hostname)) throw new Error('Invalid saved-document link.');
    await shell.openExternal(url.toString());
    return { ok: true };
  } catch (error) { return { ok: false, error: error.message }; }
});

ipcMain.handle('login-composio', () => connectionAction(() => connections.login()));
ipcMain.handle('reopen-composio-login', () => connectionAction(() => connections.reopenLogin()));
ipcMain.handle('cancel-composio-login', () => connectionAction(() => connections.cancelLogin()));
ipcMain.handle('list-account-locations', (_event, provider, account, query, cursor) => connectionAction(() => connections.locations(provider, account, query, cursor)));
