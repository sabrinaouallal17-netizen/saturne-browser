// Saturne Browser - safe bridge between the UI and the main process
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('saturne', {
  partition: 'persist:saturne',

  // window controls
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.sendSync('win:is-maximized'),
  onMaximized: on('win:maximized'),

  // persistence
  loadState: () => ipcRenderer.sendSync('state:load'),
  saveState: (data) => ipcRenderer.invoke('state:save', data),

  // features
  pickWallpaper: () => ipcRenderer.invoke('wallpaper:pick'),
  capture: (wcId) => ipcRenderer.invoke('page:capture', wcId),
  copyText: (text) => ipcRenderer.send('clipboard:write', text),
  openPath: (p) => ipcRenderer.send('shell:open-path', p),
  showItem: (p) => ipcRenderer.send('shell:show-item', p),
  openDownloadsFolder: () => ipcRenderer.send('shell:open-downloads'),
  cancelDownload: (id) => ipcRenderer.send('download:cancel', id),
  faviconData: (url) => ipcRenderer.invoke('favicon:data', url),
  navHistory: (wcId) => ipcRenderer.invoke('nav:history', wcId),
  goToIndex: (wcId, i) => ipcRenderer.send('nav:go-index', wcId, i),
  attachDevTools: (targetId, devtoolsId) => ipcRenderer.invoke('devtools:attach', targetId, devtoolsId),
  closeDevTools: (targetId) => ipcRenderer.send('devtools:close', targetId),
  inspectAt: (targetId, x, y) => ipcRenderer.send('devtools:inspect', targetId, x, y),
  readClipboard: () => ipcRenderer.sendSync('clipboard:read'),

  // events from main
  onOpenTab: on('tab:open'),
  onContextMenu: on('page:context-menu'),
  onShortcut: on('app:shortcut'),
  onDownload: on('download:update'),
});
