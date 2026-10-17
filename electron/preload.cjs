const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusApi', {
  platform: process.platform,
  loadLegacyProfiles: () => ipcRenderer.invoke('legacy:profiles'),
  loadLegacyData: (profileId) => ipcRenderer.invoke('legacy:data', profileId),
  loadStore: (name) => ipcRenderer.invoke('store:load', name),
  saveStore: (name, data) => ipcRenderer.invoke('store:save', name, data),
  saveStoreSync: (name, data) => ipcRenderer.sendSync('store:saveSync', name, data),
  getSyncConfig: () => ipcRenderer.invoke('sync:getConfig'),
  setSyncConfig: (input) => ipcRenderer.invoke('sync:setConfig', input),
  syncRequest: (req) => ipcRenderer.invoke('sync:request', req),
  setSimOffline: (flag) => ipcRenderer.invoke('sync:setSimOffline', flag),
  appPlatform: () => ipcRenderer.invoke('app:platform'),
  syncIdentity: () => ipcRenderer.invoke('sync:identity'),
  resetSyncIdentity: () => ipcRenderer.invoke('sync:resetIdentity'),
  backupStore: (data) => ipcRenderer.invoke('store:backup', data),
  onSyncFlush: (cb) => {
    const listener = (_e, info) => cb(info || {});
    ipcRenderer.on('sync:flush', listener);
    return () => ipcRenderer.removeListener('sync:flush', listener);
  },
  onSyncWake: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('sync:wake', listener);
    return () => ipcRenderer.removeListener('sync:wake', listener);
  },
  syncFlushed: () => ipcRenderer.send('sync:flushed'),
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
