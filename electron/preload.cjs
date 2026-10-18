const { contextBridge, ipcRenderer } = require('electron');

// 界面按哪个系统画：通常就是 process.platform，开发时可被 FOCUS_FORCE_PLATFORM 改写（见 main.cjs）
let uiPlatform = process.platform;
try {
  uiPlatform = ipcRenderer.sendSync('app:uiPlatform') || process.platform;
} catch {}

contextBridge.exposeInMainWorld('focusApi', {
  platform: process.platform,
  uiPlatform,
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
  // AI agent 本地接口（见 electron/agent.cjs）
  agentReady: () => ipcRenderer.send('agent:ready'),
  onAgentRequest: (cb) => {
    const listener = (_e, req) => cb(req);
    ipcRenderer.on('agent:request', listener);
    return () => ipcRenderer.removeListener('agent:request', listener);
  },
  agentRespond: (msg) => ipcRenderer.send('agent:response', msg),
  readAgentOutbox: () => ipcRenderer.invoke('agent:readOutbox'),
  onAgentOutbox: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('agent:outbox', listener);
    return () => ipcRenderer.removeListener('agent:outbox', listener);
  },
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  setThemeSource: (source) => ipcRenderer.invoke('app:setTheme', source),
  version: () => ipcRenderer.invoke('app:version'),
});
