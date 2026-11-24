// Saturne Browser - Electron main process
const { app, BrowserWindow, ipcMain, session, dialog, shell, clipboard, webContents, screen, net, nativeImage, safeStorage } = require('electron');
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

  // every tab gets the page helper (saved passwords); the DevTools view has no partition and gets nothing
  win.webContents.on('will-attach-webview', (_e, wp, params) => {
    delete wp.preloadURL;
    wp.contextIsolation = true;
    wp.nodeIntegration = false;
    if (params.partition) wp.preload = path.join(__dirname, 'page-preload.js');
    else delete wp.preload;
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
// every window (tabs, sign-in popups…) presents itself as a normal Chrome: Google refuses sign-in from "Electron"
app.userAgentFallback = app.userAgentFallback.replace(/\sElectron\/\S+/, '').replace(/\ssaturne-browser\/\S+/i, '').replace(/\sSaturne\/\S+/, '');
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
  if (k === 'f5' || k === 'f12' || k === 'f3' || k === 'f9') return true;
  if (i.alt && (k === 'arrowleft' || k === 'arrowright' || k === 'home')) return true;
  if (i.control && i.shift && ['t', 's', 'i', 'r', 'a', 'x'].includes(k)) return true;
  if (i.control && !i.shift && ['t', 'w', 'l', 'r', 'd', 'h', 'f', 'p', '=', '+', '-', '0'].includes(k)) return true;
  if (i.control && k === 'tab') return true;
  if (i.control && /^[1-9]$/.test(k)) return true;
  return false;
}

app.on('web-contents-created', (_e, contents) => {
  // popup windows (sign-in): links they open go to tabs, and nested popups stay popups
  if (contents.getType() === 'window') {
    followGoogleLogin(contents); // right away: the popup may already be heading to Google
    setImmediate(() => {
      if (contents.isDestroyed() || (win && contents === win.webContents)) return;
      contents.setUserAgent(GOOGLE_LOGIN.test(contents.getURL()) ? FIREFOX_UA : contents.session.getUserAgent());
      contents.setWindowOpenHandler(({ url, disposition }) => {
        if (disposition === 'new-window') return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true, parent: win || undefined } };
        if (win) win.webContents.send('tab:open', { url, background: false });
        return { action: 'deny' };
      });
    });
    return;
  }
  if (contents.getType() !== 'webview') return;
  followGoogleLogin(contents);

  // target=_blank / window.open -> open as a new tab instead of a new window
  // Ctrl+click / middle-click on a link opens it in the background
  contents.setWindowOpenHandler(({ url, disposition, features }) => {
    // sign-in popups ("Continue with Google / Apple / Microsoft…") must stay real popups: the site waits
    // for the popup to answer it (window.opener), which can't happen if it opens as a normal tab
    if (disposition === 'new-window' && win) {
      const f = Object.fromEntries(String(features || '').split(',').map((x) => x.trim().split('=')).filter((x) => x[0]));
      const width = Math.min(Math.max(Number(f.width) || 520, 360), 1200);
      const height = Math.min(Math.max(Number(f.height) || 680, 420), 1000);
      const b = win.getBounds();
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width, height,
          x: Math.round(b.x + (b.width - width) / 2), y: Math.round(b.y + Math.max(40, (b.height - height) / 2)),
          parent: win, autoHideMenuBar: true, backgroundColor: '#ffffff', title: 'Saturne',
          icon: path.join(__dirname, 'build', 'icon.ico'), minimizable: false,
          webPreferences: { preload: path.join(__dirname, 'page-preload.js'), contextIsolation: true, nodeIntegration: false },
        },
      };
    }
    if (win) win.webContents.send('tab:open', { url, background: disposition === 'background-tab' });
    return { action: 'deny' };
  });
  // a sign-in popup heading to Google must present itself as Firefox from its very first page
  contents.on('did-create-window', (child, { url }) => {
    if (GOOGLE_LOGIN.test(url || '')) child.webContents.setUserAgent(FIREFOX_UA);
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

// ---------- Google sign-in ----------
// Google refuses to sign in from browsers built on Electron ("This browser or app may not be secure"),
// whatever the Chrome version says. On its sign-in pages only, Saturne presents itself as Firefox,
// which Google accepts; everywhere else it stays a normal Chrome.
const GOOGLE_LOGIN = /^https:\/\/accounts\.google\.com\//i;
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
function setupGoogleLogin(ses) {
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://accounts.google.com/*'] }, (d, cb) => {
    const h = { ...d.requestHeaders };
    for (const k of Object.keys(h)) if (/^sec-ch-ua/i.test(k)) delete h[k]; // Firefox doesn't send these
    h['User-Agent'] = FIREFOX_UA;
    cb({ requestHeaders: h });
  });
}
// the page itself (navigator.userAgent) must agree with the headers
function followGoogleLogin(contents) {
  contents.on('did-start-navigation', (d) => {
    if (!d.isMainFrame || d.isSameDocument) return;
    const want = GOOGLE_LOGIN.test(d.url) ? FIREFOX_UA : contents.session.getUserAgent();
    if (contents.getUserAgent() !== want) contents.setUserAgent(want);
  });
}

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

// ---------- Ad blocker ----------
const AB = require('./adblock');
const abPath = () => path.join(profileDir(), 'saturne-adblock.json');
let ab = null; // { enabled, allow: [host] }
const loadAb = () => {
  if (ab) return ab;
  try { ab = JSON.parse(fs.readFileSync(abPath(), 'utf8')); } catch { ab = null; }
  if (!ab || typeof ab !== 'object') ab = {};
  if (typeof ab.enabled !== 'boolean') ab.enabled = true;
  if (!Array.isArray(ab.allow)) ab.allow = [];
  return ab;
};
const saveAb = () => fs.promises.writeFile(abPath(), JSON.stringify(ab)).catch(() => {});
const abCounts = new Map(); // tab webContents id -> ads blocked on the current page
let abTotal = 0;
// is blocking active for this page (top-level address)?
const abActiveFor = (pageUrl) => {
  const hst = AB.hostOf(pageUrl);
  if (!loadAb().enabled || !hst) return false;
  return !AB.matches(hst, AB.SKIP_SITES) && !AB.matches(hst, ab.allow);
};
let abSendT = null;
const abSend = (wcId) => {
  clearTimeout(abSendT);
  abSendT = setTimeout(() => { if (win) win.webContents.send('adblock:count', { wcId, count: abCounts.get(wcId) || 0, total: abTotal }); }, 250);
};
function setupAdblock(ses) {
  loadAb();
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (d, cb) => {
    if (!ab.enabled || d.resourceType === 'mainFrame') return cb({});
    const hst = AB.hostOf(d.url);
    if (!hst || !AB.matches(hst, AB.BLOCKED)) return cb({});
    const wc = d.webContentsId ? webContents.fromId(d.webContentsId) : null;
    if (!wc || wc.isDestroyed() || wc.getType() !== 'webview' || !abActiveFor(wc.getURL())) return cb({});
    abCounts.set(wc.id, (abCounts.get(wc.id) || 0) + 1);
    abTotal++;
    abSend(wc.id);
    // a blocked tracking pixel would show as a broken image: give it an empty one instead
    if (d.resourceType === 'image') return cb({ redirectURL: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' });
    cb({ cancel: true });
  });
}
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;
  contents.on('did-start-navigation', (d) => {
    if (d.isMainFrame && !d.isSameDocument) { abCounts.set(contents.id, 0); abSend(contents.id); }
  });
  contents.on('dom-ready', () => { if (abActiveFor(contents.getURL())) contents.insertCSS(AB.COSMETIC).catch(() => {}); });
  contents.once('destroyed', () => abCounts.delete(contents.id));
});
ipcMain.on('adblock:get', (e, wcId) => {
  const wc = wcId ? webContents.fromId(wcId) : null;
  const url = wc && !wc.isDestroyed() ? wc.getURL() : '';
  const hst = AB.hostOf(url);
  e.returnValue = {
    enabled: loadAb().enabled, count: abCounts.get(wcId) || 0, total: abTotal, host: hst.replace(/^www\./, ''),
    allowed: !!hst && AB.matches(hst, ab.allow), skipped: !!hst && AB.matches(hst, AB.SKIP_SITES),
  };
});
ipcMain.on('adblock:set', (e, enabled) => { if (!fromUI(e)) return; loadAb().enabled = !!enabled; saveAb(); });
ipcMain.on('adblock:allow', (e, host, allow) => {
  if (!fromUI(e) || typeof host !== 'string' || !host) return;
  loadAb();
  const hst = host.toLowerCase().replace(/^www\./, '');
  ab.allow = ab.allow.filter((x) => x !== hst);
  if (allow) ab.allow.push(hst);
  saveAb();
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
  setupAdblock(ses);
  setupGoogleLogin(ses);

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
    title: 'Choose a wallpaper (image, GIF or video)',
    properties: ['openFile'],
    filters: [
      { name: 'Images, GIFs & videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'mp4', 'webm', 'm4v', 'ogv', 'mov'] },
      { name: 'Videos', extensions: ['mp4', 'webm', 'm4v', 'ogv', 'mov'] },
    ],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const src = res.filePaths[0];
  if ((await fs.promises.stat(src)).size > 1024 * 1024 * 1024) return { error: 'This file is too big (1 GB max).' };
  const dir = path.join(app.getPath('userData'), 'wallpapers');
  await fs.promises.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `wallpaper-${Date.now()}${path.extname(src).toLowerCase()}`);
  await fs.promises.copyFile(src, dest);
  return pathToFileURL(dest).href;
});

// ---------- CustomIMG widget: pictures & GIFs on the home page ----------
// Files are copied into the profile folder so the saved state only keeps a short file:// link.
const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'apng'];
const homeImgDir = () => { const d = path.join(profileDir(), 'home-images'); fs.mkdirSync(d, { recursive: true }); return d; };
async function importHomeImages(paths) {
  const out = [];
  for (const src of paths.slice(0, 30)) {
    try {
      const ext = path.extname(src || '').slice(1).toLowerCase();
      if (!IMG_EXT.includes(ext)) continue;
      const st = await fs.promises.stat(src);
      if (!st.isFile() || st.size > 60 * 1024 * 1024) continue;
      const dest = path.join(homeImgDir(), `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.${ext}`);
      await fs.promises.copyFile(src, dest);
      out.push(pathToFileURL(dest).href);
    } catch {}
  }
  return out;
}
ipcMain.handle('homeimg:pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Add images or GIFs to the home page',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images & GIFs', extensions: IMG_EXT }],
  });
  return res.canceled ? [] : importHomeImages(res.filePaths);
});
ipcMain.handle('homeimg:import', (_e, paths) => importHomeImages(Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : []));
ipcMain.on('homeimg:delete', (_e, url) => {
  try {
    const p = require('url').fileURLToPath(url);
    if (path.dirname(p) === homeImgDir()) fs.promises.unlink(p).catch(() => {}); // only our own copies
  } catch {}
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
// changelog = the latest commits of the repository: title + bullet lines of each message
ipcMain.handle('update:changelog', async () => {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/commits?sha=${BRANCH}&per_page=30`, {
      headers: { 'User-Agent': 'Saturne-Browser', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
    const list = await res.json();
    const items = list.map((c) => {
      const msg = ((c.commit && c.commit.message) || '').split('\n');
      const lines = [];
      for (const l of msg.slice(1)) {
        if (/^co-authored-by:/i.test(l.trim())) continue;
        if (/^\s*[-*•]\s+/.test(l)) lines.push(l.replace(/^\s*[-*•]\s+/, '').trim());
        else if (l.trim() && lines.length) lines[lines.length - 1] += ' ' + l.trim(); // wrapped line
      }
      return { sha: c.sha, title: msg[0].slice(0, 200), lines: lines.slice(0, 15), date: c.commit && c.commit.committer && c.commit.committer.date };
    });
    return { items, installed: readBuild().sha || '' };
  } catch (err) { return { error: 'Couldn’t load the changelog: ' + err.message }; }
});
ipcMain.on('update:get', (e) => { e.returnValue = { ...upd, canInstall: app.isPackaged }; });

// only Saturne's own window may use these (never a web page)
const fromUI = (e) => !!win && e.sender === win.webContents;
const pageWc = (wcId) => { const wc = webContents.fromId(wcId); return wc && !wc.isDestroyed() && wc.getType() === 'webview' ? wc : null; };

// ---------- Screenshots ----------
// visible part, a selected area (rect in page pixels) or the whole page; saved to Pictures\Saturne and copied
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`; };
async function fullPageShot(wc) {
  const dbg = wc.debugger;
  const mine = !dbg.isAttached();
  if (mine) dbg.attach('1.3');
  try {
    const m = await dbg.sendCommand('Page.getLayoutMetrics');
    const size = m.cssContentSize || m.contentSize;
    const width = Math.ceil(size.width), height = Math.min(Math.ceil(size.height), 16000);
    const r = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, optimizeForSpeed: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
    return nativeImage.createFromBuffer(Buffer.from(r.data, 'base64'));
  } finally { if (mine) { try { dbg.detach(); } catch {} } }
}
ipcMain.handle('shot:take', async (e, wcId, mode, rect) => {
  if (!fromUI(e)) return null;
  const wc = pageWc(wcId);
  if (!wc) return { error: 'This tab isn’t loaded.' };
  try {
    let img;
    if (mode === 'full') img = await fullPageShot(wc);
    else if (mode === 'area' && rect && rect.width > 2 && rect.height > 2) {
      img = await wc.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
    } else img = await wc.capturePage();
    if (!img || img.isEmpty()) return { error: 'Nothing to capture.' };
    const dir = path.join(app.getPath('pictures'), 'Saturne');
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, `Screenshot ${stamp()}.png`);
    await fs.promises.writeFile(file, img.toPNG());
    clipboard.writeImage(img);
    const s = img.getSize();
    return { path: file, width: s.width, height: s.height };
  } catch (err) { return { error: err.message }; }
});

// ---------- Page translation (Google Translate) ----------
ipcMain.handle('tr:texts', async (e, texts, to) => {
  if (!fromUI(e) || !Array.isArray(texts) || !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(to || '')) return null;
  const body = texts.slice(0, 128).map((t) => 'q=' + encodeURIComponent(String(t).slice(0, 5000))).join('&');
  const res = await net.fetch(`https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&tl=${to}&dt=t`, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
  });
  if (!res.ok) return { error: `The translation service answered ${res.status}.` };
  const out = await res.json();
  // one text -> ["…","en"] or [["…","en"]]; several -> [["…","en"], …]
  const list = texts.length === 1 && typeof out[0] === 'string' ? [out] : out;
  return { items: list.map((x) => (Array.isArray(x) ? { text: x[0], lang: x[1] } : { text: String(x), lang: '' })) };
});

// ---------- Saved passwords ----------
// Encrypted with Windows' own protection (DPAPI) for this Windows user; one file per profile.
const pwPath = () => path.join(profileDir(), 'saturne-passwords.json');
let pw = null; // { logins: { origin: [{ u, p (encrypted, base64), t }] }, never: [origin] }
const loadPw = () => {
  if (pw) return pw;
  try { pw = JSON.parse(fs.readFileSync(pwPath(), 'utf8')); } catch { pw = null; }
  if (!pw || typeof pw !== 'object') pw = {};
  pw.logins = pw.logins || {}; pw.never = pw.never || [];
  return pw;
};
const savePw = () => { const tmp = pwPath() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(pw)); fs.renameSync(tmp, pwPath()); };
const enc = (s) => safeStorage.encryptString(s).toString('base64');
const dec = (b) => { try { return safeStorage.decryptString(Buffer.from(b, 'base64')); } catch { return ''; } };
const frameOrigin = (e) => originOf((e.senderFrame && e.senderFrame.url) || '');
const pwOffers = new Map();
let pwSeq = 0;
// from a web page (page-preload.js): only ever about that page's own site
ipcMain.handle('pw:for-page', (e) => {
  const o = frameOrigin(e);
  if (!/^https?:/.test(o) || e.sender.getType() !== 'webview') return [];
  return (loadPw().logins[o] || []).map((x) => x.u);
});
ipcMain.handle('pw:fill', (e, u) => {
  const o = frameOrigin(e);
  if (!/^https?:/.test(o) || e.sender.getType() !== 'webview') return null;
  const x = (loadPw().logins[o] || []).find((l) => l.u === u);
  return x ? dec(x.p) : null;
});
ipcMain.on('pw:candidate', (e, data) => {
  const o = frameOrigin(e);
  if (!win || !/^https?:/.test(o) || e.sender.getType() !== 'webview' || !data || typeof data.p !== 'string') return;
  if (!safeStorage.isEncryptionAvailable()) return;
  const u = String(data.u || '').slice(0, 200), p = data.p.slice(0, 500);
  if (!p) return;
  loadPw();
  if (pw.never.includes(o)) return;
  const list = pw.logins[o] || [];
  const same = list.find((l) => l.u === u);
  if (same && dec(same.p) === p) return; // already saved
  for (const [k, v] of pwOffers) if (v.wcId === e.sender.id) pwOffers.delete(k); // newest offer wins
  const id = ++pwSeq;
  pwOffers.set(id, { origin: o, u, p, wcId: e.sender.id });
  win.webContents.send('pw:offer', { id, wcId: e.sender.id, origin: o, username: u, update: !!same });
});
ipcMain.on('pw:answer', (e, id, action) => {
  if (!fromUI(e)) return;
  const x = pwOffers.get(id);
  pwOffers.delete(id);
  if (!x) return;
  loadPw();
  if (action === 'never') { if (!pw.never.includes(x.origin)) pw.never.push(x.origin); savePw(); return; }
  if (action !== 'save') return;
  const list = pw.logins[x.origin] = pw.logins[x.origin] || [];
  const i = list.findIndex((l) => l.u === x.u);
  const item = { u: x.u, p: enc(x.p), t: Date.now() };
  if (i >= 0) list[i] = item; else list.push(item);
  savePw();
});
ipcMain.handle('pw:all', (e) => {
  if (!fromUI(e)) return null;
  loadPw();
  const out = [];
  for (const [o, list] of Object.entries(pw.logins)) for (const l of list) out.push({ origin: o, u: l.u, t: l.t });
  return { logins: out, never: pw.never.slice() };
});
ipcMain.handle('pw:reveal', (e, origin, u) => {
  if (!fromUI(e)) return null;
  const x = (loadPw().logins[origin] || []).find((l) => l.u === u);
  return x ? dec(x.p) : null;
});
ipcMain.on('pw:delete', (e, origin, u) => {
  if (!fromUI(e)) return;
  loadPw();
  if (u === null) pw.never = pw.never.filter((o) => o !== origin);
  else {
    pw.logins[origin] = (pw.logins[origin] || []).filter((l) => l.u !== u);
    if (!pw.logins[origin].length) delete pw.logins[origin];
  }
  savePw();
});

// ---------- Chrome extensions ----------
// Installed from the Chrome Web Store (the .crx is unpacked into the profile) or loaded from a folder.
// Electron supports part of the extension APIs: content scripts and simple popups work best.
const extDir = () => { const d = path.join(profileDir(), 'extensions'); fs.mkdirSync(d, { recursive: true }); return d; };
const extListPath = () => path.join(profileDir(), 'saturne-extensions.json');
let exts = null; // [{ key, path, enabled, source }]
const loadExtList = () => {
  if (exts) return exts;
  try { exts = JSON.parse(fs.readFileSync(extListPath(), 'utf8')); } catch { exts = []; }
  if (!Array.isArray(exts)) exts = [];
  return exts;
};
const saveExtList = () => fs.writeFileSync(extListPath(), JSON.stringify(exts, null, 1));
const extSession = () => session.fromPartition(PARTITION_NOW());
const extApi = () => { const s = extSession(); return s.extensions || s; };
async function loadOneExtension(x) {
  const ext = await extApi().loadExtension(x.path, { allowFileAccess: false });
  x.id = ext.id;
  return ext;
}
async function loadExtensions() {
  for (const x of loadExtList()) {
    if (!x.enabled) continue;
    try { await loadOneExtension(x); } catch (err) { x.error = err.message; }
  }
}
function extIcon(ext) {
  const m = ext.manifest || {};
  const icons = m.icons || (m.action && m.action.default_icon) || (m.browser_action && m.browser_action.default_icon) || {};
  const list = typeof icons === 'string' ? [[128, icons]] : Object.entries(icons).sort((a, b) => Number(b[0]) - Number(a[0]));
  for (const [, rel] of list) {
    try {
      const file = path.join(ext.path, String(rel).replace(/^\//, ''));
      const img = nativeImage.createFromPath(file);
      if (!img.isEmpty()) return img.resize({ width: 32 }).toDataURL();
    } catch {}
  }
  return '';
}
const extMsg = (ext, s) => { // "__MSG_name__" -> localized string
  const m = /^__MSG_(\w+)__$/.exec(s || '');
  if (!m) return s;
  for (const loc of ['fr', 'en', 'en_US', (ext.manifest && ext.manifest.default_locale) || 'en']) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ext.path, '_locales', loc, 'messages.json'), 'utf8'));
      const k = Object.keys(j).find((x) => x.toLowerCase() === m[1].toLowerCase());
      if (k) return j[k].message;
    } catch {}
  }
  return s;
};
function extInfo() {
  const loaded = new Map(extApi().getAllExtensions().map((x) => [x.path, x]));
  return loadExtList().map((x) => {
    const ext = loaded.get(x.path);
    let manifest = ext && ext.manifest;
    if (!manifest) { try { manifest = JSON.parse(fs.readFileSync(path.join(x.path, 'manifest.json'), 'utf8')); } catch { manifest = {}; } }
    const e2 = ext || { path: x.path, manifest };
    const popup = (manifest.action && manifest.action.default_popup) || (manifest.browser_action && manifest.browser_action.default_popup) || '';
    const options = manifest.options_page || (manifest.options_ui && manifest.options_ui.page) || '';
    return {
      key: x.key, id: ext ? ext.id : x.id || '', enabled: !!x.enabled && !!ext, source: x.source,
      name: extMsg(e2, manifest.name) || x.key, version: manifest.version || '', description: extMsg(e2, manifest.description) || '',
      icon: extIcon(e2), popup: ext && popup ? `${ext.url}${popup.replace(/^\//, '')}` : '',
      options: ext && options ? `${ext.url}${options.replace(/^\//, '')}` : '', error: x.error || '',
    };
  });
}
async function addExtension(dir, key, source) {
  const list = loadExtList();
  let x = list.find((e) => e.key === key);
  if (x && x.enabled) { try { const old = extApi().getAllExtensions().find((e) => e.path === x.path); if (old) extApi().removeExtension(old.id); } catch {} }
  if (!x) { x = { key, path: dir, enabled: true, source }; list.push(x); }
  x.path = dir; x.enabled = true; delete x.error;
  try { await loadOneExtension(x); } catch (err) { list.splice(list.indexOf(x), 1); saveExtList(); throw err; }
  saveExtList();
}
// Chrome Web Store: link or 32-letter id -> download the .crx, drop its header, unzip it
async function installFromStore(input) {
  const m = /([a-p]{32})/.exec(String(input || ''));
  if (!m) throw new Error('Paste a Chrome Web Store link (or the extension’s 32-letter id).');
  const id = m[1];
  const url = process.env.SATURNE_CRX_URL // tests only: a local package server
    ? process.env.SATURNE_CRX_URL.replace('{id}', id)
    : `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${process.versions.chrome}&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
  const res = await net.fetch(url, { headers: { 'User-Agent': extSession().getUserAgent() } });
  if (!res.ok) throw new Error(`The Chrome Web Store answered ${res.status}.`);
  const buf = Buffer.from(await res.arrayBuffer());
  await unpackCrx(buf, path.join(extDir(), id));
  await addExtension(path.join(extDir(), id), id, 'store');
  return id;
}
async function unpackCrx(buf, dest) {
  if (buf.length < 16 || buf.toString('latin1', 0, 4) !== 'Cr24') throw new Error('This isn’t an extension package (it may not exist or not be available for your browser).');
  const ver = buf.readUInt32LE(4);
  const start = ver === 3 ? 12 + buf.readUInt32LE(8) : 16 + buf.readUInt32LE(8) + buf.readUInt32LE(12);
  const tmp = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'saturne-crx-'));
  try {
    const zip = path.join(tmp, 'ext.zip');
    await fs.promises.writeFile(zip, buf.subarray(start));
    const out = path.join(tmp, 'x');
    await fs.promises.mkdir(out);
    await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', out]);
    if (!fs.existsSync(path.join(out, 'manifest.json'))) throw new Error('The package has no manifest.json.');
    await fs.promises.rm(path.join(out, '_metadata'), { recursive: true, force: true }); // Chrome's signature files
    await fs.promises.rm(dest, { recursive: true, force: true });
    await fs.promises.cp(out, dest, { recursive: true });
  } finally { fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}
ipcMain.handle('ext:list', (e) => (fromUI(e) ? extInfo() : null));
ipcMain.handle('ext:install', async (e, input) => {
  if (!fromUI(e)) return null;
  try { await installFromStore(input); return { ok: true, list: extInfo() }; } catch (err) { return { error: err.message }; }
});
ipcMain.handle('ext:unpacked', async (e) => {
  if (!fromUI(e)) return null;
  const r = await dialog.showOpenDialog(win, { title: 'Choose an unpacked extension folder (with a manifest.json)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { cancelled: true };
  const dir = r.filePaths[0];
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) return { error: 'This folder has no manifest.json.' };
  try { await addExtension(dir, 'folder:' + dir.toLowerCase(), 'folder'); return { ok: true, list: extInfo() }; } catch (err) { return { error: err.message }; }
});
ipcMain.handle('ext:toggle', async (e, key, on) => {
  if (!fromUI(e)) return null;
  const x = loadExtList().find((v) => v.key === key);
  if (!x) return extInfo();
  const ext = extApi().getAllExtensions().find((v) => v.path === x.path);
  if (!on && ext) extApi().removeExtension(ext.id);
  if (on && !ext) { try { await loadOneExtension(x); delete x.error; } catch (err) { x.error = err.message; } }
  x.enabled = !!on;
  saveExtList();
  return extInfo();
});
ipcMain.handle('ext:remove', async (e, key) => {
  if (!fromUI(e)) return null;
  const list = loadExtList();
  const x = list.find((v) => v.key === key);
  if (!x) return extInfo();
  const ext = extApi().getAllExtensions().find((v) => v.path === x.path);
  if (ext) extApi().removeExtension(ext.id);
  list.splice(list.indexOf(x), 1);
  saveExtList();
  if (x.source === 'store' && path.dirname(x.path) === extDir()) await fs.promises.rm(x.path, { recursive: true, force: true }).catch(() => {});
  return extInfo();
});

// ---------- Import bookmarks from other browsers (first-run screen) ----------
const BROWSERS = [
  { key: 'chrome', name: 'Google Chrome', dir: ['LOCALAPPDATA', 'Google', 'Chrome', 'User Data'] },
  { key: 'edge', name: 'Microsoft Edge', dir: ['LOCALAPPDATA', 'Microsoft', 'Edge', 'User Data'] },
  { key: 'brave', name: 'Brave', dir: ['LOCALAPPDATA', 'BraveSoftware', 'Brave-Browser', 'User Data'] },
  { key: 'vivaldi', name: 'Vivaldi', dir: ['LOCALAPPDATA', 'Vivaldi', 'User Data'] },
  { key: 'opera', name: 'Opera', dir: ['APPDATA', 'Opera Software', 'Opera Stable'], flat: true },
  { key: 'operagx', name: 'Opera GX', dir: ['APPDATA', 'Opera Software', 'Opera GX Stable'], flat: true },
];
const bookmarksFile = (b) => {
  const base = process.env[b.dir[0]];
  return base ? path.join(base, ...b.dir.slice(1), ...(b.flat ? [] : ['Default']), 'Bookmarks') : '';
};
function readBookmarks(b) {
  const j = JSON.parse(fs.readFileSync(bookmarksFile(b), 'utf8'));
  const out = [], seen = new Set();
  const walk = (n) => {
    if (!n || out.length >= 300) return;
    if (n.type === 'url' && /^https?:\/\//i.test(n.url || '') && !seen.has(n.url)) { seen.add(n.url); out.push({ title: String(n.name || '').slice(0, 200), url: n.url }); }
    (n.children || []).forEach(walk);
  };
  const r = j.roots || {};
  walk(r.bookmark_bar); walk(r.other); walk(r.synced);
  return out;
}
ipcMain.handle('import:browsers', (e) => {
  if (!fromUI(e)) return null;
  const out = [];
  for (const b of BROWSERS) {
    try { const n = readBookmarks(b).length; if (n) out.push({ key: b.key, name: b.name, count: n }); } catch {}
  }
  return out;
});
ipcMain.handle('import:bookmarks', (e, key) => {
  if (!fromUI(e)) return null;
  const b = BROWSERS.find((x) => x.key === key);
  try { return b ? readBookmarks(b) : []; } catch { return []; }
});

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
  loadExtensions().catch(() => {}).finally(createWindow);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  // look for updates shortly after starting, then every 30 minutes
  setTimeout(checkUpdate, 8000);
  setInterval(checkUpdate, 30 * 60 * 1000);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
