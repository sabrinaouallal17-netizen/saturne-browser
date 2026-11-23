// Saturne Browser - safe bridge between the UI and the main process
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('saturne', {
  partition: ipcRenderer.sendSync('profile:partition'),

  // CustomIMG widget (home page pictures & GIFs)
  pickHomeImages: () => ipcRenderer.invoke('homeimg:pick'),
  importHomeImages: (files) => ipcRenderer.invoke('homeimg:import', Array.from(files || []).map((f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } })),
  deleteHomeImage: (url) => ipcRenderer.send('homeimg:delete', url),

  // ad blocker
  adblock: (wcId) => ipcRenderer.sendSync('adblock:get', wcId),
  setAdblock: (on) => ipcRenderer.send('adblock:set', on),
  allowAds: (host, allow) => ipcRenderer.send('adblock:allow', host, allow),
  onAdblockCount: on('adblock:count'),

  // screenshots & translation
  screenshot: (wcId, mode, rect) => ipcRenderer.invoke('shot:take', wcId, mode, rect),
  translate: (texts, to) => ipcRenderer.invoke('tr:texts', texts, to),

  // saved passwords
  onPasswordOffer: on('pw:offer'),
  answerPassword: (id, action) => ipcRenderer.send('pw:answer', id, action),
  passwords: () => ipcRenderer.invoke('pw:all'),
  revealPassword: (origin, u) => ipcRenderer.invoke('pw:reveal', origin, u),
  deletePassword: (origin, u) => ipcRenderer.send('pw:delete', origin, u),

  // Chrome extensions
  extensions: () => ipcRenderer.invoke('ext:list'),
  installExtension: (input) => ipcRenderer.invoke('ext:install', input),
  loadUnpackedExtension: () => ipcRenderer.invoke('ext:unpacked'),
  toggleExtension: (key, on) => ipcRenderer.invoke('ext:toggle', key, on),
  removeExtension: (key) => ipcRenderer.invoke('ext:remove', key),

  // first-run screen: bookmarks from other browsers
  importBrowsers: () => ipcRenderer.invoke('import:browsers'),
  importBookmarks: (key) => ipcRenderer.invoke('import:bookmarks', key),

  // default browser
  isDefaultBrowser: () => ipcRenderer.invoke('browser:is-default'),
  makeDefaultBrowser: () => ipcRenderer.invoke('browser:make-default'),

  // profiles
  profiles: () => ipcRenderer.sendSync('profile:list'),
  saveProfile: (p) => ipcRenderer.invoke('profile:save', p),
  createProfile: (p) => ipcRenderer.invoke('profile:create', p),
  switchProfile: (id) => ipcRenderer.invoke('profile:switch', id),
  deleteProfile: (id) => ipcRenderer.invoke('profile:delete', id),

  // updates
  updateStatus: () => ipcRenderer.sendSync('update:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: on('update:status'),
  changelog: () => ipcRenderer.invoke('update:changelog'),

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

  // site permissions
  onPermission: on('perm:ask'),
  answerPermission: (id, allow, remember) => ipcRenderer.send('perm:answer', id, allow, remember),
  listPermissions: () => ipcRenderer.sendSync('perm:list'),
  forgetPermission: (origin, key) => ipcRenderer.send('perm:forget', origin, key),
});
