const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opencodeAPI', {
  getServerConfig: () => ipcRenderer.invoke('get-server-config'),
  setServerConfig: (cfg) => ipcRenderer.invoke('set-server-config', cfg),
  checkServer: () => ipcRenderer.invoke('check-server'),
  restartServer: () => ipcRenderer.invoke('restart-server'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getWorkdir: () => ipcRenderer.invoke('get-workdir'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getBuildInfo: () => ipcRenderer.invoke('get-build-info'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
