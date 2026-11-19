const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rm', {
  platform: process.platform,
  lang: ipcRenderer.sendSync('lang'),
  getState: () => ipcRenderer.invoke('state'),
  updateProfile: (patch) => ipcRenderer.invoke('profile:update', patch),
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  createChat: (opts) => ipcRenderer.invoke('chat:create', opts),
  getChat: (id) => ipcRenderer.invoke('chat:get', id),
  updateChat: (id, patch) => ipcRenderer.invoke('chat:update', id, patch),
  deleteChat: (id) => ipcRenderer.invoke('chat:delete', id),
  openChat: (id) => ipcRenderer.invoke('chat:open', id),
  send: (id, text) => ipcRenderer.invoke('chat:send', id, text),
  stop: (id) => ipcRenderer.invoke('chat:stop', id),
  nudge: (id) => ipcRenderer.invoke('chat:nudge', id),
  reveal: (id) => ipcRenderer.invoke('chat:reveal', id),
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
