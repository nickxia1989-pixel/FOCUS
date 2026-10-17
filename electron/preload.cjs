const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusApi', {
  platform: process.platform,
  loadProfiles: () => ipcRenderer.invoke('profiles:load'),
  saveProfiles: (data) => ipcRenderer.invoke('profiles:save', data),
  archiveProfile: (profileId) => ipcRenderer.invoke('profiles:archive', profileId),
  load: (profileId) => ipcRenderer.invoke('data:load', profileId),
  save: (profileId, data) => ipcRenderer.invoke('data:save', profileId, data),
  saveSync: (profileId, data) => ipcRenderer.sendSync('data:saveSync', profileId, data),
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
