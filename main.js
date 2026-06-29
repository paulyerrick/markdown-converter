const { app, BrowserWindow, Tray, ipcMain, dialog, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { convert, convertUrl } = require("./converter");

let tray = null;
let mainWindow = null;

// Hide dock icon -- this is a menu bar app
if (app.dock) app.dock.hide();

// Launch at login
app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 700,
    height: 600,
    show: false,
    frame: false,
    titleBarStyle: "hiddenInset",
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile("index.html");

  mainWindow.on("blur", () => {
    mainWindow.hide();
  });

  mainWindow.on("close", (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

function toggleWindow() {
  if (!mainWindow) {
    createWindow();
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    positionWindow();
    mainWindow.show();
    mainWindow.focus();
  }
}

function positionWindow() {
  if (!tray) return;
  const trayBounds = tray.getBounds();
  const windowBounds = mainWindow.getBounds();

  const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  const y = Math.round(trayBounds.y + trayBounds.height);

  mainWindow.setPosition(x, y, false);
}

app.whenReady().then(() => {
  const iconPath = path.join(__dirname, "assets", "iconTemplate.png");
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip("Markdown Converter");
  tray.on("click", toggleWindow);

  createWindow();
});

app.on("window-all-closed", (e) => {
  // Do not quit -- stay in tray
});

// --- IPC handlers (unchanged) ---

ipcMain.handle("open-file", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "Documents", extensions: ["pdf", "docx", "html", "htm", "txt", "md", "text", "csv", "json", "xml"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (canceled || !filePaths.length) return { ok: false };
  return { ok: true, filePath: filePaths[0] };
});

ipcMain.handle("convert-file", async (_event, filePath, savePath) => {
  try {
    const markdown = await convert(filePath);
    if (savePath) {
      fs.writeFileSync(savePath, markdown, "utf-8");
    }
    return { ok: true, markdown, savedPath: savePath || null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("convert-html", async (_event, html) => {
  try {
    const TurndownService = require("turndown");
    const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    return { ok: true, markdown: td.turndown(html) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("convert-url", async (_event, url) => {
  try {
    const markdown = await convertUrl(url);
    return { ok: true, markdown };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("save-file", async (_event, content, defaultName) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || "converted.md",
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, content, "utf-8");
  return { ok: true, filePath };
});
