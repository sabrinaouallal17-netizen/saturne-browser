// Saturne Browser - Electron main process
const { app, BrowserWindow, ipcMain, session, dialog, shell, clipboard, webContents, screen, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

let win = null;

// ---------- Profiles ----------
// Each profile has its own saved state (spaces, tabs, home page, theme), its own cookies/logins and its own
// site permissions. The first profile ("default") keeps the files Saturne used before profiles existed.
// Switching profile restarts Saturne on the other profile.
const profilesPath = () => path.join(app.getPath('userData'), 'saturne-profiles.json');
let profiles = null;
function loadProfiles() {
  if (profiles) return profiles;
  try { profiles = JSON.parse(fs.readFileSync(profilesPath(), 'utf8')); } catch { profiles = null; }
  if (!profiles || !Array.isArray(profiles.list) || !profiles.list.length) {
    profiles = { active: 'default', list: [{ id: 'default', name: 'Me', avatar: '', banner: '', color: '#8fb0ff', created: Date.now() }] };
  }
  if (!profiles.list.find((p) => p.id === profiles.active)) profiles.active = profiles.list[0].id;
  return profiles;
}
const saveProfiles = () => {
  const tmp = profilesPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(profiles));
  fs.renameSync(tmp, profilesPath());
};
let ACTIVE = null; // profile used by this run (fixed until restart)
const activeProfile = () => ACTIVE || (ACTIVE = loadProfiles().active);
const profileDir = (id = activeProfile()) => {
  const d = id === 'default' ? app.getPath('userData') : path.join(app.getPath('userData'), 'profiles', id);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const partitionFor = (id = activeProfile()) => (id === 'default' ? 'persist:saturne' : `persist:saturne-${id}`);
const PARTITION_NOW = () => partitionFor();

const statePath = () => path.join(profileDir(), 'saturne-state.json');

// ---------- Window size & position are remembered ----------
const winStatePath = () => path.join(app.getPath('userData'), 'saturne-window.json');
function loadWinState() {
  try {
    const s = JSON.parse(fs.readFileSync(winStatePath(), 'utf8'));
    // only reuse a position that is still on a connected screen
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return s.x + 100 < a.x + a.width && s.x + s.width - 100 > a.x && s.y >= a.y - 10 && s.y + 40 < a.y + a.height;
    });
    return visible ? s : { width: s.width, height: s.height, maximized: s.maximized };
  } catch { return { width: 1440, height: 860 }; }
}
let winSaveT = null;
function saveWinState() {
  clearTimeout(winSaveT);
  winSaveT = setTimeout(() => {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const b = win.getNormalBounds();
    fs.promises.writeFile(winStatePath(), JSON.stringify({ ...b, maximized: win.isMaximized() })).catch(() => {});
  }, 400);
}

// ---------- Links opened from other apps (Saturne as default browser) ----------
function urlFromArgs(argv) {
  const skip = new Set([process.execPath.toLowerCase(), app.getAppPath().toLowerCase()]);
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith('-') || skip.has(path.resolve(a).toLowerCase()) || a === '.') continue;
    if (/^(https?|ftp):\/\//i.test(a)) return a;
    if (/^[a-z]:[\\/]|^\\\\/i.test(a) && /\.(html?|xhtml|svg|txt|pdf)$/i.test(a) && fs.existsSync(a)) return pathToFileURL(a).href;
  }
  return null;
}
let pendingUrl = urlFromArgs(process.argv);
// restart without the link Saturne may have been opened with (so it isn't opened twice)
const relaunchClean = () => app.relaunch({ args: process.argv.slice(1).filter((x) => !/^(https?|ftp):\/\//i.test(x) && !/\.(html?|xhtml|svg|txt|pdf)$/i.test(x)) });
const openExternalUrl = (url) => { if (url && win) win.webContents.send('tab:open', { url, background: false }); };

function createWindow() {
  const ws = loadWinState();
  win = new BrowserWindow({
    width: ws.width || 1440,
    height: ws.height || 860,
    ...(ws.x != null && ws.y != null ? { x: ws.x, y: ws.y } : {}),
    minWidth: 820,
    minHeight: 520,
    frame: false,
    backgroundColor: '#2b2b2b',
    title: 'Saturne',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => { if (ws.maximized) win.maximize(); win.show(); });
  win.webContents.once('did-finish-load', () => { if (pendingUrl) { openExternalUrl(pendingUrl); pendingUrl = null; } });
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, saveWinState);
  // mouse side buttons (back / forward)
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') win.webContents.send('app:shortcut', { key: 'ArrowLeft', alt: true });
    else if (cmd === 'browser-forward') win.webContents.send('app:shortcut', { key: 'ArrowRight', alt: true });
  });

  const sendMax = () => win && win.webContents.send('win:maximized', win.isMaximized());
  win.on('maximize', sendMax);
  win.on('unmaximize', sendMax);
  win.on('enter-full-screen', sendMax);
  win.on('leave-full-screen', sendMax);
  win.on('closed', () => { win = null; });

  // Debug helper: SATURNE_SCREENSHOT=<file.png> saves a screenshot and quits (used for testing)
  if (process.env.SATURNE_SCREENSHOT) {
    win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`));
    win.webContents.once('did-finish-load', () => {
      const run = async () => {
        if (process.env.SATURNE_EVAL) {
          try { await win.webContents.executeJavaScript(process.env.SATURNE_EVAL); } catch (err) { console.log('[eval error]', err.message); }
          await new Promise((r) => setTimeout(r, Number(process.env.SATURNE_EVAL_WAIT || 1500)));
        }
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.SATURNE_SCREENSHOT, img.toPNG());
        app.quit();
      };
      setTimeout(run, Number(process.env.SATURNE_DELAY || 3000));
    });
  }
}

if (process.env.SATURNE_USERDATA) app.setPath('userData', process.env.SATURNE_USERDATA);
app.setName('Saturne');
if (process.platform === 'win32') app.setAppUserModelId('Saturne.Browser');

// only one Saturne window at a time: launching again focuses the existing one
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  openExternalUrl(urlFromArgs(argv)); // a link clicked in another app
});

// ---------- Default browser (Windows) ----------
// Registers Saturne in the user's registry like other browsers, then opens Windows' "Default apps" page on it.
const REG = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
const regAdd = (key, name, value) => run(REG, ['add', key, ...(name == null ? ['/ve'] : ['/v', name]), '/t', 'REG_SZ', '/d', value, '/f']);
function launchCommand(arg) {
  const exe = `"${process.execPath}"`;
  const app_ = app.isPackaged ? '' : ` "${app.getAppPath()}"`;
  return exe + app_ + (arg ? ` ${arg}` : '');
}
async function registerBrowser() {
  const icon = `${process.execPath},0`;
  const cls = 'HKCU\\Software\\Classes\\SaturneHTML';
  const cl = 'HKCU\\Software\\Clients\\StartMenuInternet\\Saturne';
  await regAdd(cls, null, 'Saturne HTML Document');
  await regAdd(cls, 'AppUserModelId', 'Saturne.Browser');
  await regAdd(`${cls}\\DefaultIcon`, null, icon);
  await regAdd(`${cls}\\shell\\open\\command`, null, launchCommand('"%1"'));
  await regAdd(cl, null, 'Saturne');
  await regAdd(`${cl}\\DefaultIcon`, null, icon);
  await regAdd(`${cl}\\shell\\open\\command`, null, launchCommand());
  await regAdd(`${cl}\\Capabilities`, 'ApplicationName', 'Saturne');
  await regAdd(`${cl}\\Capabilities`, 'ApplicationDescription', 'Saturne web browser');
  await regAdd(`${cl}\\Capabilities`, 'ApplicationIcon', icon);
  await regAdd(`${cl}\\Capabilities\\StartMenu`, 'StartMenuInternet', 'Saturne');
  for (const p of ['http', 'https']) await regAdd(`${cl}\\Capabilities\\URLAssociations`, p, 'SaturneHTML');
  for (const x of ['.htm', '.html', '.xhtml', '.svg']) await regAdd(`${cl}\\Capabilities\\FileAssociations`, x, 'SaturneHTML');
  await regAdd('HKCU\\Software\\RegisteredApplications', 'Saturne', 'Software\\Clients\\StartMenuInternet\\Saturne\\Capabilities');
}
const isDefaultBrowser = () => new Promise((resolve) =>
  execFile(REG, ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId'],
    { windowsHide: true }, (err, out) => resolve(!err && /SaturneHTML/.test(String(out)))));
ipcMain.handle('browser:is-default', () => isDefaultBrowser());
ipcMain.handle('browser:make-default', async () => {
  try {
    await registerBrowser();
    // Windows only lets the user pick the default browser: open the settings page for Saturne
    await shell.openExternal('ms-settings:defaultapps?registeredAppUser=Saturne');
    return { ok: true, packaged: app.isPackaged };
  } catch (err) { return { error: err.message }; }
});

// ---------- Shortcuts that must work even when a web page has focus ----------
function isAppShortcut(i) {
  if (i.type !== 'keyDown') return false;
  const k = i.key.toLowerCase();
  if (k === 'f5' || k === 'f12' || k === 'f3') return true;
  if (i.alt && (k === 'arrowleft' || k === 'arrowright' || k === 'home')) return true;
  if (i.control && i.shift && ['t', 's', 'i', 'r'].includes(k)) return true;
  if (i.control && !i.shift && ['t', 'w', 'l', 'r', 'd', 'h', 'f', 'p', '=', '+', '-', '0'].includes(k)) return true;
  if (i.control && k === 'tab') return true;
  if (i.control && /^[1-9]$/.test(k)) return true;
  return false;
}

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;

  // target=_blank / window.open -> open as a new tab instead of a new window
  // Ctrl+click / middle-click on a link opens it in the background
  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (win) win.webContents.send('tab:open', { url, background: disposition === 'background-tab' });
    return { action: 'deny' };
  });

  contents.on('context-menu', (_ev, p) => {
    if (!win) return;
    // exact cursor position inside the window, so the menu opens right next to the pointer
    const pt = screen.getCursorScreenPoint();
    const b = win.getContentBounds();
    win.webContents.send('page:context-menu', {
      wcId: contents.id,
      x: p.x, y: p.y,
      cursorX: pt.x - b.x, cursorY: pt.y - b.y,
      linkURL: p.linkURL,
      srcURL: p.srcURL,
      mediaType: p.mediaType,
      selectionText: p.selectionText,
      isEditable: p.isEditable,
      editFlags: p.editFlags,
      canGoBack: contents.navigationHistory ? contents.navigationHistory.canGoBack() : contents.canGoBack(),
      canGoForward: contents.navigationHistory ? contents.navigationHistory.canGoForward() : contents.canGoForward(),
    });
  });

  contents.on('before-input-event', (ev, input) => {
    if (!win) return;
    if (isAppShortcut(input)) {
      ev.preventDefault();
      win.webContents.send('app:shortcut', {
        key: input.key, control: input.control, shift: input.shift, alt: input.alt,
      });
    }
  });
});

// ---------- Stay signed in ----------
// Many sites keep you logged in with "session" cookies, which Chromium deletes when the browser closes.
// Like Chrome's "Continue where you left off", Saturne turns them into cookies that last 30 days.
const KEEP_DAYS = 30;
function setupCookies(ses) {
  ses.cookies.on('changed', (_e, c, _cause, removed) => {
    if (removed || !c.session) return;
    const domain = (c.domain || '').replace(/^\./, '');
    if (!domain) return;
    const details = {
      url: `${c.secure ? 'https' : 'http'}://${domain}${c.path || '/'}`,
      name: c.name, value: c.value, path: c.path, secure: c.secure, httpOnly: c.httpOnly,
      expirationDate: Date.now() / 1000 + KEEP_DAYS * 86400,
    };
    if (c.sameSite && c.sameSite !== 'unspecified') details.sameSite = c.sameSite;
    if (!c.hostOnly) details.domain = c.domain; // __Host- cookies must stay host-only
    ses.cookies.set(details).catch(() => {});
  });
  app.on('before-quit', () => { ses.cookies.flushStore().catch(() => {}); });
}

// ---------- Site permissions (camera, microphone, location, notifications…) ----------
const ALWAYS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
const ASK = new Set(['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'midiSysex', 'idle-detection', 'window-management']);
const permPath = () => path.join(profileDir(), 'saturne-permissions.json');
let perms = null; // { "https://site.com": { "camera": true, "notifications": false } }
const loadPerms = () => {
  if (perms) return perms;
  try { perms = JSON.parse(fs.readFileSync(permPath(), 'utf8')) || {}; } catch { perms = {}; }
  return perms;
};
const savePerms = () => fs.promises.writeFile(permPath(), JSON.stringify(perms, null, 1)).catch(() => {});
const originOf = (u) => { try { return new URL(u).origin; } catch { return ''; } };
// "media" covers camera and/or microphone: each is remembered on its own
const permKeys = (permission, details) => {
  if (permission !== 'media') return [permission];
  const t = (details && details.mediaTypes) || [];
  const keys = [];
  if (t.includes('video')) keys.push('camera');
  if (t.includes('audio')) keys.push('microphone');
  return keys.length ? keys : ['camera', 'microphone'];
};
const pending = new Map();
let permSeq = 0;

function setupPermissions(ses) {
  loadPerms();
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    if (ALWAYS.has(permission)) return cb(true);
    if (!ASK.has(permission)) return cb(false);
    const origin = originOf((details && details.requestingUrl) || (wc && wc.getURL()));
    if (!origin || !/^https?:/.test(origin) || !win) return cb(false);
    const keys = permKeys(permission, details);
    const saved = keys.map((k) => perms[origin] && perms[origin][k]);
    if (saved.every((v) => v === true)) return cb(true);
    if (saved.some((v) => v === false)) return cb(false);
    const id = ++permSeq;
    pending.set(id, { cb, origin, keys });
    win.webContents.send('perm:ask', { id, wcId: wc ? wc.id : null, origin, keys });
  });
  ses.setPermissionCheckHandler((_wc, permission, origin, details) => {
    if (ALWAYS.has(permission)) return true;
    const o = originOf(origin || (details && details.requestingUrl));
    const keys = permission === 'media' ? permKeys('media', { mediaTypes: details && details.mediaType ? [details.mediaType] : [] }) : [permission];
    return keys.every((k) => perms[o] && perms[o][k] === true);
  });
}
ipcMain.on('perm:answer', (_e, id, allow, remember) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (remember) {
    perms[p.origin] = perms[p.origin] || {};
    for (const k of p.keys) perms[p.origin][k] = !!allow;
    savePerms();
  }
  p.cb(!!allow);
});
ipcMain.on('perm:list', (e) => { e.returnValue = loadPerms(); });
ipcMain.on('perm:forget', (_e, origin, key) => {
  loadPerms();
  if (!perms[origin]) return;
  if (key) delete perms[origin][key]; else delete perms[origin];
  if (perms[origin] && !Object.keys(perms[origin]).length) delete perms[origin];
  savePerms();
});

// ---------- Session setup (user agent, permissions, downloads) ----------
function setupSession() {
  const ses = session.fromPartition(PARTITION_NOW());

  // Remove "Electron" & app name tokens so sites treat us like a normal Chromium browser
  const ua = ses.getUserAgent()
    .replace(/\sElectron\/\S+/, '')
    .replace(/\ssaturne-browser\/\S+/i, '');
  ses.setUserAgent(ua);

  setupCookies(ses);
  setupPermissions(ses);

  let dlId = 0;
  const items = new Map();
  ses.on('will-download', (_e, item) => {
    const id = ++dlId;
    const dir = app.getPath('downloads');
    const parsed = path.parse(item.getFilename());
    let target = path.join(dir, parsed.base);
    let n = 1;
    while (fs.existsSync(target)) target = path.join(dir, `${parsed.name} (${n++})${parsed.ext}`);
    item.setSavePath(target);
    items.set(id, item);

    const send = (state) => {
      if (!win) return;
      win.webContents.send('download:update', {
        id,
        filename: path.basename(target),
        path: target,
        url: item.getURL(),
        total: item.getTotalBytes(),
        received: item.getReceivedBytes(),
        state: state || item.getState(),
        paused: item.isPaused(),
      });
    };
    item.on('updated', () => send());
    item.once('done', (_ev, state) => { send(state); items.delete(id); });
    send('progressing');
  });

  ipcMain.on('download:cancel', (_e, id) => { const it = items.get(id); if (it) it.cancel(); });
}

// ---------- IPC ----------
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:toggle-maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
ipcMain.on('win:close', () => win && win.close());
ipcMain.on('win:is-maximized', (e) => { e.returnValue = win ? win.isMaximized() : false; });

ipcMain.on('state:load', (e) => {
  try { e.returnValue = JSON.parse(fs.readFileSync(statePath(), 'utf8')); }
  catch { e.returnValue = null; }
});
ipcMain.handle('state:save', async (_e, data) => {
  const tmp = statePath() + '.tmp';
  await fs.promises.writeFile(tmp, JSON.stringify(data));
  await fs.promises.rename(tmp, statePath());
  return true;
});

ipcMain.handle('wallpaper:pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a wallpaper',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const src = res.filePaths[0];
  const dir = path.join(app.getPath('userData'), 'wallpapers');
  await fs.promises.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `wallpaper-${Date.now()}${path.extname(src).toLowerCase()}`);
  await fs.promises.copyFile(src, dest);
  return pathToFileURL(dest).href;
});

ipcMain.handle('page:capture', async (_e, wcId) => {
  try {
    const wc = webContents.fromId(wcId);
    if (!wc || wc.isDestroyed()) return null;
    const img = await wc.capturePage();
    if (img.isEmpty()) return null;
    return img.resize({ width: 480, quality: 'good' }).toDataURL();
  } catch { return null; }
});

// favicon as data URL (lets the UI read its colors without cross-origin restrictions)
const faviconCache = new Map();
ipcMain.handle('favicon:data', async (_e, url) => {
  if (!/^https?:\/\//i.test(url || '')) return null;
  if (faviconCache.has(url)) return faviconCache.get(url);
  try {
    const res = await session.fromPartition(PARTITION_NOW()).fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 512 * 1024) return null;
    const data = `data:${type};base64,${buf.toString('base64')}`;
    faviconCache.set(url, data);
    return data;
  } catch { return null; }
});

// back / forward history list for a tab
ipcMain.handle('nav:history', (_e, wcId) => {
  const wc = webContents.fromId(wcId);
  if (!wc || wc.isDestroyed()) return null;
  const nh = wc.navigationHistory;
  return { entries: nh.getAllEntries().map((x) => ({ url: x.url, title: x.title })), index: nh.getActiveIndex() };
});
ipcMain.on('nav:go-index', (_e, wcId, i) => {
  const wc = webContents.fromId(wcId);
  if (wc && !wc.isDestroyed()) wc.navigationHistory.goToIndex(i);
});

// DevTools docked inside our own panel (a <webview> in the UI)
ipcMain.handle('devtools:attach', (_e, targetId, devtoolsId) => {
  const target = webContents.fromId(targetId);
  const devtools = webContents.fromId(devtoolsId);
  if (!target || !devtools) return false;
  if (target.isDevToolsOpened()) target.closeDevTools();
  target.setDevToolsWebContents(devtools);
  target.openDevTools();
  return true;
});
ipcMain.on('devtools:close', (_e, targetId) => {
  const target = webContents.fromId(targetId);
  if (target && !target.isDestroyed() && target.isDevToolsOpened()) target.closeDevTools();
});
ipcMain.on('devtools:inspect', (_e, targetId, x, y) => {
  const target = webContents.fromId(targetId);
  if (target && !target.isDestroyed()) target.inspectElement(x, y);
});

ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(String(text || '')));
ipcMain.on('clipboard:read', (e) => { e.returnValue = clipboard.readText(); });
ipcMain.on('shell:open-path', (_e, p) => shell.openPath(p));
ipcMain.on('shell:show-item', (_e, p) => shell.showItemInFolder(p));
ipcMain.on('shell:open-downloads', () => shell.openPath(app.getPath('downloads')));

// ---------- Profiles (IPC) ----------
const isImage = (s) => s === '' || (typeof s === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(s) && s.length < 3_000_000);
const cleanProfile = (p, base) => {
  const out = { ...base };
  if (typeof p.name === 'string') out.name = p.name.trim().slice(0, 32) || base.name || 'Profile';
  if (isImage(p.avatar)) out.avatar = p.avatar;
  if (isImage(p.banner) || /^g:\d{1,2}$/.test(p.banner || '')) out.banner = p.banner; // picture or preset gradient
  if (typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color)) out.color = p.color;
  return out;
};
ipcMain.on('profile:partition', (e) => { e.returnValue = PARTITION_NOW(); });
ipcMain.on('profile:list', (e) => { const p = loadProfiles(); e.returnValue = { active: activeProfile(), list: p.list }; });
ipcMain.handle('profile:save', (_e, data) => {
  const p = loadProfiles();
  const i = p.list.findIndex((x) => x.id === data.id);
  if (i < 0) return null;
  p.list[i] = cleanProfile(data, p.list[i]);
  saveProfiles();
  return p.list[i];
});
ipcMain.handle('profile:create', (_e, data) => {
  const p = loadProfiles();
  if (p.list.length >= 12) return null;
  const id = Math.random().toString(36).slice(2, 10);
  const prof = cleanProfile(data || {}, { id, name: 'Profile', avatar: '', banner: '', color: '#ff8fa3', created: Date.now() });
  p.list.push(prof);
  saveProfiles();
  return prof;
});
ipcMain.handle('profile:switch', (_e, id) => {
  const p = loadProfiles();
  if (!p.list.find((x) => x.id === id) || id === activeProfile()) return false;
  p.active = id;
  saveProfiles();
  relaunchClean();
  app.quit();
  return true;
});
ipcMain.handle('profile:delete', async (_e, id) => {
  const p = loadProfiles();
  if (id === 'default' || id === activeProfile() || !p.list.find((x) => x.id === id)) return false;
  p.list = p.list.filter((x) => x.id !== id);
  saveProfiles();
  // erase that profile's data: saved state, permissions, cookies and site storage
  try { await session.fromPartition(partitionFor(id)).clearStorageData(); } catch {}
  await fs.promises.rm(path.join(app.getPath('userData'), 'profiles', id), { recursive: true, force: true }).catch(() => {});
  return true;
});

// ---------- Updates from GitHub ----------
// Saturne compares the latest commit of the repository's main branch with the one it was installed from.
// "Update Available" installs the new files (the app is plain JavaScript, nothing to compile) and restarts.
const REPO = 'sabrinaouallal17-netizen/saturne-browser';
const BRANCH = 'main';
const KEEP_OUT = new Set(['node_modules', '.git', '.github', 'dist', 'out', '.gitignore']);
// installed commit: next to the app files once installed, in the profile folder when running from source
const buildFile = () => (app.isPackaged ? path.join(__dirname, 'saturne-build.json') : path.join(app.getPath('userData'), 'saturne-build-dev.json'));
const readBuild = () => { try { return JSON.parse(fs.readFileSync(buildFile(), 'utf8')); } catch { return {}; } };
let upd = { state: 'idle', available: null, error: null, installed: null };
const sendUpd = () => { if (win) win.webContents.send('update:status', { ...upd, canInstall: app.isPackaged }); };

async function checkUpdate() {
  if (upd.state === 'installing') return upd;
  upd.state = 'checking'; sendUpd();
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, {
      headers: { 'User-Agent': 'Saturne-Browser', Accept: 'application/vnd.github+json' },
    });
    if (res.status === 404) throw new Error('The GitHub repository is private or doesn’t exist, so Saturne can’t check it.');
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
    const c = await res.json();
    const build = readBuild();
    if (!build.sha) { // first check after installing: the current files count as this commit
      build.sha = c.sha; build.date = c.commit && c.commit.committer && c.commit.committer.date;
      fs.writeFileSync(buildFile(), JSON.stringify(build));
    }
    upd.installed = build.sha;
    upd.available = build.sha !== c.sha
      ? { sha: c.sha, message: ((c.commit && c.commit.message) || '').split('\n')[0].slice(0, 200), date: c.commit && c.commit.committer && c.commit.committer.date }
      : null;
    upd.state = upd.available ? 'available' : 'uptodate'; upd.error = null;
  } catch (err) {
    upd.state = 'error'; upd.error = err.message;
  }
  sendUpd();
  return upd;
}

const run = (file, args) => new Promise((resolve, reject) =>
  execFile(file, args, { windowsHide: true }, (err) => (err ? reject(err) : resolve())));

async function installUpdate() {
  if (!app.isPackaged) throw new Error('Saturne is running from its source folder: use git pull there instead.');
  const a = upd.available;
  if (!a) throw new Error('No update to install.');
  upd.state = 'installing'; sendUpd();
  const tmp = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'saturne-update-'));
  try {
    const res = await net.fetch(`https://codeload.github.com/${REPO}/zip/${a.sha}`, { headers: { 'User-Agent': 'Saturne-Browser' } });
    if (!res.ok) throw new Error(`Download failed (${res.status}).`);
    const zip = path.join(tmp, 'update.zip');
    await fs.promises.writeFile(zip, Buffer.from(await res.arrayBuffer()));
    const out = path.join(tmp, 'x');
    await fs.promises.mkdir(out);
    await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', out]);
    const [top] = await fs.promises.readdir(out);
    const root = path.join(out, top || '');
    for (const f of ['main.js', 'preload.js', 'package.json', path.join('src', 'index.html')]) {
      if (!fs.existsSync(path.join(root, f))) throw new Error(`The update is incomplete (${f} is missing).`);
    }
    // a different Electron version can't be swapped in place: that needs a fresh install
    const pkg = JSON.parse(await fs.promises.readFile(path.join(root, 'package.json'), 'utf8'));
    const want = String((pkg.devDependencies && pkg.devDependencies.electron) || (pkg.dependencies && pkg.dependencies.electron) || '').match(/\d+/);
    if (want && want[0] !== process.versions.electron.split('.')[0]) {
      throw new Error(`This update needs Electron ${want[0]} (installed: ${process.versions.electron}). Reinstall Saturne from the new version.`);
    }
    // keep a copy of the current files, then copy the new ones over them
    const backup = path.join(path.dirname(__dirname), 'app-previous');
    await fs.promises.rm(backup, { recursive: true, force: true });
    await fs.promises.cp(__dirname, backup, { recursive: true });
    for (const name of await fs.promises.readdir(root)) {
      if (KEEP_OUT.has(name)) continue;
      await fs.promises.cp(path.join(root, name), path.join(__dirname, name), { recursive: true, force: true });
    }
    fs.writeFileSync(buildFile(), JSON.stringify({ sha: a.sha, date: a.date, installedAt: new Date().toISOString() }));
  } catch (err) {
    upd.state = 'available'; upd.error = err.message; sendUpd();
    throw err;
  } finally {
    fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  relaunchClean();
  app.quit();
}
ipcMain.handle('update:check', () => checkUpdate());
ipcMain.handle('update:install', async () => {
  try { await installUpdate(); return { ok: true }; } catch (err) { return { error: err.message }; }
});
ipcMain.on('update:get', (e) => { e.returnValue = { ...upd, canInstall: app.isPackaged }; });

// ---------- App lifecycle ----------
// storage of deleted profiles can only be removed once it's no longer open: done at the next start
function sweepDeletedProfiles() {
  const ids = new Set(loadProfiles().list.map((p) => p.id));
  const dir = path.join(app.getPath('userData'), 'Partitions');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) {
    const m = /^saturne-(.+)$/.exec(n);
    if (m && !ids.has(m[1])) fs.rm(path.join(dir, n), { recursive: true, force: true }, () => {});
  }
}

app.whenReady().then(() => {
  activeProfile();
  sweepDeletedProfiles();
  setupSession();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  // look for updates shortly after starting, then every 30 minutes
  setTimeout(checkUpdate, 8000);
  setInterval(checkUpdate, 30 * 60 * 1000);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
