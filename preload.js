const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('open-file'),
  convertFile: filePath => ipcRenderer.invoke('convert-file', filePath),
  convertHtml: html => ipcRenderer.invoke('convert-html', html),
  convertUrl: url => ipcRenderer.invoke('convert-url', url),
  cancelConversion: () => ipcRenderer.invoke('cancel-conversion'),
  listDestinations: () => ipcRenderer.invoke('list-destinations'),
  chooseDestination: id => ipcRenderer.invoke('choose-destination', id),
  saveFile: (content, defaultName, destination) => ipcRenderer.invoke('save-file', content, defaultName, destination),
  loginComposio: () => ipcRenderer.invoke('login-composio'),
  reopenComposioLogin: () => ipcRenderer.invoke('reopen-composio-login'),
  cancelComposioLogin: () => ipcRenderer.invoke('cancel-composio-login'),
  listAccountLocations: (provider, account, query, cursor) => ipcRenderer.invoke('list-account-locations', provider, account, query, cursor),
  connectionStatus: () => ipcRenderer.invoke('connection-status'),
  connectAccount: provider => ipcRenderer.invoke('connect-account', provider),
  configureAccount: (provider, account, target) => ipcRenderer.invoke('configure-account', provider, account, target),
  openSavedLink: url => ipcRenderer.invoke('open-saved-link', url),
  getFilePath: file => webUtils.getPathForFile(file),
});
