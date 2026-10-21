const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('AstroSkyCredentials', {
  read: () => ipcRenderer.invoke('astrosky:credential', 'read'),
  save: key => ipcRenderer.invoke('astrosky:credential', 'save', key),
  clear: () => ipcRenderer.invoke('astrosky:credential', 'clear'),
});
