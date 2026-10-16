const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusApi', {
  platform: process.platform,
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  saveSync: (data) => ipcRenderer.sendSync('data:saveSync', data),
  minimize: () => ipcRenderer.invoke('win:minimize'),
  close: () => ipcRenderer.invoke('win:close'),
  getAlwaysOnTop: () => ipcRenderer.invoke('win:getAlwaysOnTop'),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('win:setAlwaysOnTop', flag),
  onAlwaysOnTop: (cb) => {
    const listener = (_e, flag) => cb(flag);
    ipcRenderer.on('win:alwaysOnTop', listener);
    return () => ipcRenderer.removeListener('win:alwaysOnTop', listener);
  },
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  version: () => ipcRenderer.invoke('app:version'),
});
