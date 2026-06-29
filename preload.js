const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("api", {
  openFile: () => ipcRenderer.invoke("open-file"),
  convertFile: (filePath, savePath) => ipcRenderer.invoke("convert-file", filePath, savePath),
  convertHtml: (html) => ipcRenderer.invoke("convert-html", html),
  convertUrl: (url) => ipcRenderer.invoke("convert-url", url),
  saveFile: (content, defaultName) => ipcRenderer.invoke("save-file", content, defaultName),
  getFilePath: (file) => webUtils.getPathForFile(file),
});
