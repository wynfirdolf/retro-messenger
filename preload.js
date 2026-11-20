const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('rm', {
  platform: process.platform,
  lang: ipcRenderer.sendSync('lang'),
  getState: () => ipcRenderer.invoke('state'),
  updateProfile: (patch) => ipcRenderer.invoke('profile:update', patch),
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  createChat: (opts) => ipcRenderer.invoke('chat:create', opts),
  newChat: (provider) => ipcRenderer.invoke('chat:new', provider),
  getChat: (id) => ipcRenderer.invoke('chat:get', id),
  updateChat: (id, patch) => ipcRenderer.invoke('chat:update', id, patch),
  deleteChat: (id) => ipcRenderer.invoke('chat:delete', id),
  openChat: (id) => ipcRenderer.invoke('chat:open', id),
  openImport: () => ipcRenderer.invoke('history:open'),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  listSessions: () => ipcRenderer.invoke('history:list'),
  importSession: (sessionId) => ipcRenderer.invoke('history:import', sessionId),
  send: (id, text, style, files) => ipcRenderer.invoke('chat:send', id, text, style, files),
  pickFiles: () => ipcRenderer.invoke('file:pick'),
  describeFiles: (paths) => ipcRenderer.invoke('file:describe', paths),
  savePasted: (name, bytes) => ipcRenderer.invoke('file:save-pasted', name, bytes),
  openFile: (p) => ipcRenderer.invoke('file:open', p),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openUrl: (u) => ipcRenderer.invoke('url:open', u),
  // Dropped and pasted File objects only reveal their path through webUtils.
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  stop: (id) => ipcRenderer.invoke('chat:stop', id),
  nudge: (id) => ipcRenderer.invoke('chat:nudge', id),
  answerPermission: (id, requestId, decision) => ipcRenderer.invoke('perm:answer', id, requestId, decision),
  reveal: (id) => ipcRenderer.invoke('chat:reveal', id),
  exportChat: (id) => ipcRenderer.invoke('chat:export', id),
  newSession: (id) => ipcRenderer.invoke('chat:new-session', id),
  contextMenu: (id) => ipcRenderer.send('chat:context-menu', id),
  toastClick: (id) => ipcRenderer.send('toast:click', id),
  win: (action) => ipcRenderer.send('win', action),
  on: (channel, fn) => {
    const handler = (_e, ...args) => fn(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
