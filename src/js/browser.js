// Saturne — browser core: spaces, tabs, webviews, unloading, previews, menus
(function () {
  const S = Store.state;
  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const HOME = 'saturne://home';
  const ERR_PREFIX = 'data:text/html;charset=utf-8,%3C!--saturne-error';

  /** runtime data per tab id: { wv, loading, lastActive, thumb, audible, wcId, zoom, failedUrl, cssKey } */
  const rt = new Map();
  let currentTabId = null;
  const downloads = new Map();

  const isHome = (t) => !t || t.url === HOME;
  const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url || ''; } };
  const R = (id) => { if (!rt.has(id)) rt.set(id, { lastActive: Date.now(), zoom: 0 }); return rt.get(id); };
  // loadURL rejects when a navigation is aborted/redirected; errors are handled by did-fail-load
  const load = (wv, url) => wv.loadURL(url).catch(() => {});
  const isLoaded = (t) => isHome(t) || !!(rt.get(t.id) && rt.get(t.id).wv);

  // ======================= lookups =======================
  const space = (id = S.activeSpaceId) => S.spaces.find((s) => s.id === id);

  function flatTabs(sp) {
    const out = [];
    sp.items.forEach((it) => { if (it.type === 'tab') out.push(it); else it.children.forEach((c) => out.push(c)); });
    return out;
  }

  /** where a tab lives: { tab, list, index, folder, space, fav } */
  function locate(id) {
    for (const sp of S.spaces) {
      for (let i = 0; i < sp.items.length; i++) {
        const it = sp.items[i];
        if (it.id === id) return { tab: it, item: it, list: sp.items, index: i, folder: null, space: sp };
        if (it.type === 'folder') {
          const j = it.children.findIndex((c) => c.id === id);
          if (j >= 0) return { tab: it.children[j], item: it.children[j], list: it.children, index: j, folder: it, space: sp };
        }
      }
    }
    const f = S.favorites.find((x) => x.tab && x.tab.id === id);
    if (f) return { tab: f.tab, fav: f, space: null };
    return null;
  }
  const currentTab = () => (currentTabId ? (locate(currentTabId) || {}).tab : null);
  const currentWv = () => (currentTabId && rt.get(currentTabId) ? rt.get(currentTabId).wv : null);

  // ======================= theme & settings =======================
  function applyTheme() {
    const st = document.documentElement.style;
    for (const [k, v] of Object.entries(S.theme)) st.setProperty('--' + k, v);
  }
  let booted = false;
  function applySettings() {
    const wasCompact = app.classList.contains('compact');
    app.classList.toggle('compact', !S.settings.sidebarOpen); // collapsed sidebar = icon rail
    app.classList.toggle('no-bookmarks', !S.settings.showBookmarks);
    if (booted && wasCompact !== app.classList.contains('compact')) renderSidebar();
  }
  function toggleSidebar() { S.settings.sidebarOpen = !S.settings.sidebarOpen; applySettings(); Store.save(); }

  // ---------- favorite card color = icon color, darker & more saturated ----------
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  async function dominantColor(dataUrl) {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    let r = 0, gg = 0, b = 0, w = 0, colorful = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 140) continue;
      const [, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      if (l > 0.93 || l < 0.07) continue;
      if (s > 0.25) colorful++;
      const wt = s * s + 0.02;
      r += d[i] * wt; gg += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
    }
    if (colorful < 12 || !w) return null; // black / white / gray icon -> keep the default card
    const [h, s, l] = rgbToHsl(r / w, gg / w, b / w);
    const s2 = Math.min(1, s * 1.15 + 0.1);
    const l2 = UI.clamp(l * 0.72, 0.2, 0.42);
    return `hsl(${Math.round(h * 360)} ${Math.round(s2 * 100)}% ${Math.round(l2 * 100)}%)`;
  }
  const tinting = new Set();
  async function tintFavorite(f, src) {
    if (tinting.has(f.id)) return;
    tinting.add(f.id);
    try {
      const data = await window.saturne.faviconData(src);
      f.color = data ? (await dominantColor(data)) || '' : '';
      f.colorFor = src;
      Store.save();
      renderFavorites();
    } catch { /* ignore */ } finally { tinting.delete(f.id); }
  }

  // ======================= webviews =======================
  const SCROLLBAR_CSS = `
    ::-webkit-scrollbar{width:11px;height:11px}
    ::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}
    ::-webkit-scrollbar-thumb{background:rgba(128,128,128,.45);border:3px solid transparent;background-clip:padding-box;border-radius:10px}
    ::-webkit-scrollbar-thumb:hover{background-color:rgba(128,128,128,.75)}`;

  function errorPage(url, desc) {
    const html = `<!--saturne-error--><html><head><title>Can't reach this page</title><style>
      body{margin:0;height:100vh;display:grid;place-items:center;background:#2b2b2b;color:#ededed;font:14px "Segoe UI",system-ui,sans-serif}
      .b{max-width:460px;padding:24px}h1{font-size:22px;font-weight:600;margin:0 0 10px}p{color:#a5a5a5;line-height:1.5;margin:0 0 6px}
      code{color:#8fb0ff}button{margin-top:16px;height:34px;padding:0 16px;border:0;border-radius:8px;background:#8fb0ff;color:#111;font:inherit;font-weight:600}
      </style></head><body><div class="b"><h1>This site can't be reached</h1>
      <p><b>${UI.esc(host(url))}</b> did not respond.</p><p><code>${UI.esc(desc)}</code></p>
      <button onclick="location.href=${UI.esc(JSON.stringify(url))}">Try again</button></div></body></html>`;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  }

  function createWebview(tab) {
    const r = R(tab.id);
    if (r.wv) return r.wv;
    const wv = document.createElement('webview');
    wv.setAttribute('partition', window.saturne.partition);
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('src', tab.url);
    wv.dataset.tab = tab.id;
    r.wv = wv; r.loading = true; r.lastActive = Date.now(); r.failedUrl = null;

    wv.addEventListener('dom-ready', async () => {
      r.wcId = wv.getWebContentsId();
      if (r.zoom) wv.setZoomLevel(r.zoom);
      if (S.settings.webScrollbars) { try { r.cssKey = await wv.insertCSS(SCROLLBAR_CSS); } catch {} }
    });
    wv.addEventListener('did-start-loading', () => { r.loading = true; refreshTab(tab.id); });
    wv.addEventListener('did-stop-loading', () => {
      r.loading = false; refreshTab(tab.id);
      if (tab.id === currentTabId) setTimeout(() => captureThumb(tab.id), 400);
    });
    wv.addEventListener('did-navigate', (e) => {
      if (e.url.startsWith(ERR_PREFIX)) return;
      r.failedUrl = null;
      tab.url = e.url;
      Store.addHistory(e.url, tab.title, tab.favicon);
      Store.save(); refreshTab(tab.id); Home.refreshRecent();
      if (DevTools.tabId === tab.id) DevTools.layout();
    });
    wv.addEventListener('did-navigate-in-page', (e) => {
      if (!e.isMainFrame) return;
      tab.url = e.url; Store.save(); refreshTab(tab.id);
    });
    wv.addEventListener('page-title-updated', (e) => {
      if (r.failedUrl) return;
      tab.title = e.title; Store.updateHistoryTitle(tab.url, e.title); Store.save(); refreshTab(tab.id);
    });
    wv.addEventListener('page-favicon-updated', (e) => {
      if (!e.favicons || !e.favicons[0]) return;
      tab.favicon = e.favicons[0]; Store.updateHistoryTitle(tab.url, null, tab.favicon); Store.save(); refreshTab(tab.id);
    });
    wv.addEventListener('did-fail-load', (e) => {
      if (!e.isMainFrame || e.errorCode === -3) return;
      r.failedUrl = e.validatedURL || tab.url;
      load(wv, errorPage(r.failedUrl, e.errorDescription || 'ERR_FAILED'));
    });
    wv.addEventListener('media-started-playing', () => { r.audible = true; refreshTab(tab.id); });
    wv.addEventListener('media-paused', () => { r.audible = false; refreshTab(tab.id); });
    wv.addEventListener('enter-html-full-screen', () => document.body.classList.add('page-fullscreen'));
    wv.addEventListener('leave-html-full-screen', () => document.body.classList.remove('page-fullscreen'));
    wv.addEventListener('focus', () => {
      Menu.closeAll();
      // split view: clicking into the other side makes it the current tab (address bar, shortcuts…)
      const sv = shownSplit();
      if (sv && tab.id !== currentTabId && (tab.id === sv.a || tab.id === sv.b)) activateTab(tab.id, { focus: false });
    });
    wv.addEventListener('found-in-page', (e) => Find.result(tab.id, e.result));
    // page process crashed or frozen: Saturne shows its own screen with a Reload button
    wv.addEventListener('render-process-gone', (e) => {
      const reason = (e.details && e.details.reason) || e.reason || 'crashed';
      if (reason !== 'clean-exit' && r.wv === wv) Crash.mark(tab.id, 'crashed');
    });
    wv.addEventListener('unresponsive', () => { if (r.wv === wv && !r.crashed) Crash.mark(tab.id, 'frozen'); });
    wv.addEventListener('responsive', () => { if (r.wv === wv && r.crashed === 'frozen') Crash.mark(tab.id, null); });

    $('views').append(wv);
    return wv;
  }

  async function captureThumb(id) {
    const r = rt.get(id);
    if (!r || !r.wv || !r.wcId) return null;
    const data = await window.saturne.capture(r.wcId);
    if (data) r.thumb = data;
    return data;
  }

  function unloadTab(id) {
    const r = rt.get(id);
    if (!r || !r.wv) return;
    if (DevTools.tabId === id) DevTools.close(false);
    r.wv.remove();
    Object.assign(r, { wv: null, wcId: null, loading: false, audible: false, thumb: null, cssKey: null, crashed: null, muted: false });
    refreshTab(id);
  }

  // auto-unload: tabs not used for N minutes are discarded (they turn gray)
  setInterval(() => {
    const mins = Number(S.settings.unloadMinutes);
    if (!mins) return;
    const now = Date.now();
    for (const [id, r] of rt) {
      if (!r.wv || id === currentTabId || r.audible) continue;
      const sv = shownSplit();
      if (sv && (id === sv.a || id === sv.b)) continue; // both sides of the visible split view
      if (now - r.lastActive > mins * 60000) unloadTab(id);
    }
  }, 5000);
  // keep a fresh thumbnail of the visible tab
  setInterval(() => { if (currentTabId) captureThumb(currentTabId); }, 30000);

  // ======================= tab actions =======================
  function showView() {
    const t = currentTab();
    const sv = shownSplit();
    for (const [id, r] of rt) {
      if (!r.wv) continue;
      const inSplit = !!sv && (id === sv.a || id === sv.b);
      r.wv.classList.toggle('visible', inSplit || (!sv && id === currentTabId && !isHome(t)));
      r.wv.classList.toggle('split-a', inSplit && id === sv.a);
      r.wv.classList.toggle('split-b', inSplit && id === sv.b);
    }
    Split.layout(sv);
    Home.show(!sv && isHome(t));
    document.body.classList.remove('page-fullscreen');
    Find.sync(); Crash.sync(); Perms.sync();
    if (window.Features) Features.sync();
  }

  // ======================= split view (two tabs side by side) =======================
  // saved per space: { a, b, ratio }. It shows whenever one of its two tabs is the current tab.
  const splitOk = (sp, id) => { const l = locate(id); return !!l && l.space === sp && !isHome(l.tab); };
  function shownSplit() {
    const sp = space();
    const s = sp && sp.split;
    if (!s || (currentTabId !== s.a && currentTabId !== s.b)) return null;
    if (!splitOk(sp, s.a) || !splitOk(sp, s.b)) return null;
    return s;
  }
  const inAnySplit = (id) => S.spaces.some((sp) => sp.split && (sp.split.a === id || sp.split.b === id));
  function unsplitTab(id) {
    let changed = false;
    for (const sp of S.spaces) if (sp.split && (sp.split.a === id || sp.split.b === id)) { delete sp.split; changed = true; }
    if (changed) { Store.save(); showView(); paintAll(); }
    return changed;
  }
  function openSplit(otherId) {
    const t = currentTab();
    const other = locate(otherId);
    if (!other || other.fav || isHome(other.tab) || otherId === currentTabId) return;
    const sp = other.space;
    let a = currentTabId;
    if (!t || isHome(t) || !splitOk(sp, a)) a = null;
    if (!a) { activateTab(otherId); return UI.toast('Open a web page in this tab first, then split it with another one'); }
    unsplitTab(a); unsplitTab(otherId);
    sp.split = { a, b: otherId, ratio: 0.5 };
    if (!rt.get(otherId) || !rt.get(otherId).wv) createWebview(other.tab);
    activateTab(otherId);
  }
  function closeSplit() {
    const sp = space();
    if (!sp.split) return;
    delete sp.split;
    showView(); paintAll(); Store.save();
  }
  function pickSplit() {
    const t = currentTab();
    if (!t || isHome(t) || !locate(t.id) || locate(t.id).fav) return UI.toast('Open a web page first, then choose the tab to put next to it');
    TabSearch.open({ pick: true });
  }
  const Split = {
    el: null,
    build() {
      if (this.el) return;
      const close = UI.h('button.split-x', { html: Icons.x, 'data-tip': 'Close split view', onclick: closeSplit });
      const swap = UI.h('button.split-x', { html: Icons.swap, 'data-tip': 'Swap sides', onclick: () => { const s = space().split; if (s) { [s.a, s.b] = [s.b, s.a]; Store.save(); showView(); } } });
      this.el = UI.h('div#split-divider', null, UI.h('div.split-grip'), UI.h('div.split-tools', null, swap, close));
      this.el.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        e.preventDefault();
        const s = space().split;
        if (!s) return;
        document.body.classList.add('resizing', 'ew');
        const shield = $('drag-shield');
        const rect = $('views').getBoundingClientRect();
        const move = (ev) => { s.ratio = UI.clamp((ev.clientX - rect.left) / rect.width, 0.2, 0.8); this.layout(s); };
        const up = () => {
          document.body.classList.remove('resizing', 'ew');
          shield.removeEventListener('pointermove', move); shield.removeEventListener('pointerup', up);
          Store.save();
        };
        shield.addEventListener('pointermove', move);
        shield.addEventListener('pointerup', up);
      });
      $('views').append(this.el);
    },
    layout(sv) {
      $('content').classList.toggle('split', !!sv);
      if (!sv) return;
      this.build();
      $('content').style.setProperty('--split', sv.ratio || 0.5);
      for (const [id, r] of rt) if (r.wv) r.wv.classList.toggle('split-focus', id === currentTabId && (id === sv.a || id === sv.b));
    },
  };

  function activateTab(id, { focus = true } = {}) {
    const loc = locate(id);
    if (!loc) return;
    if (currentTabId && currentTabId !== id && rt.get(currentTabId)) {
      rt.get(currentTabId).lastActive = Date.now();
      captureThumb(currentTabId);
    }
    let spaceChanged = false;
    if (loc.space && loc.space.id !== S.activeSpaceId) { S.activeSpaceId = loc.space.id; spaceChanged = true; }
    if (loc.folder && !loc.folder.open) { loc.folder.open = true; spaceChanged = true; }
    space().activeTabId = id;
    currentTabId = id;
    const r = R(id);
    r.lastActive = Date.now();
    if (!isHome(loc.tab) && !r.wv) createWebview(loc.tab);
    const sv = shownSplit();
    if (sv) for (const x of [sv.a, sv.b]) { const l = locate(x); if (l && !R(x).wv) createWebview(l.tab); R(x).lastActive = Date.now(); }
    showView();
    DevTools.follow();
    if (spaceChanged) renderSidebar(true); else paintAll();
    updateChrome();
    Store.save();
    if (focus) {
      if (isHome(loc.tab)) setTimeout(() => $('url-input').focus(), 20);
      else if (r.wv) r.wv.focus();
    }
  }

  function showNothing() {
    if (currentTabId && rt.get(currentTabId)) rt.get(currentTabId).lastActive = Date.now();
    currentTabId = null;
    space().activeTabId = null;
    showView(); DevTools.follow(); paintAll(); updateChrome(); Store.save();
  }

  function newTab(url = HOME, { background = false, folderId = null, title } = {}) {
    const tab = Store.mkTab(url, title || (url === HOME ? 'New Tab' : host(url)));
    const sp = space();
    const folder = folderId && sp.items.find((x) => x.id === folderId);
    (folder ? folder.children : sp.items).push(tab);
    if (folder) folder.open = true;
    R(tab.id);
    enterIds.add(tab.id);
    if (background) { createWebview(tab); renderSidebar(); Store.save(); }
    else { renderSidebar(); activateTab(tab.id); }
    return tab;
  }

  function closeTab(id) {
    const loc = locate(id);
    if (!loc) return;
    if (loc.fav) { // closing a favorite just unloads it
      unloadTab(id);
      if (currentTabId === id) pickNeighbor(null);
      renderFavorites();
      return;
    }
    const order = flatTabs(loc.space);
    const pos = order.findIndex((t) => t.id === id);
    // closing one side of a split view: the other side stays open
    const sp0 = loc.space.split;
    const partner = sp0 && (sp0.a === id ? sp0.b : sp0.b === id ? sp0.a : null);
    unsplitTab(id);
    loc.list.splice(loc.index, 1);
    if (!isHome(loc.tab)) {
      S.closed.unshift({ url: loc.tab.url, title: loc.tab.title, spaceId: loc.space.id });
      S.closed.length = Math.min(S.closed.length, 25);
    }
    const r = rt.get(id);
    if (DevTools.tabId === id) DevTools.close(false);
    if (r && r.wv) r.wv.remove();
    rt.delete(id);
    if (currentTabId === id) {
      currentTabId = null;
      const rest = order.filter((t) => t.id !== id);
      pickNeighbor((partner && locate(partner) && locate(partner).tab) || rest[pos] || rest[pos - 1] || null);
    } else if (loc.space.activeTabId === id) loc.space.activeTabId = null;
    renderSidebar(); Store.save();
  }

  // close with a short slide-out animation
  function closeTabAnimated(id) {
    const row = document.querySelector(`#tab-list .row.tab[data-id="${id}"]`);
    if (!row || row.classList.contains('row-leave')) { if (!row) closeTab(id); return; }
    row.classList.add('row-leave');
    setTimeout(() => closeTab(id), 180);
  }

  // Home button: turn the current tab back into the home page
  function goHome() {
    const t = currentTab();
    const loc = t && locate(t.id);
    if (!t || (loc && loc.fav)) { newTab(); return; }
    if (isHome(t)) { $('url-input').focus(); return; }
    unsplitTab(t.id);
    if (DevTools.tabId === t.id) DevTools.close(false);
    const r = rt.get(t.id);
    if (r && r.wv) { r.wv.remove(); Object.assign(r, { wv: null, wcId: null, loading: false, audible: false, thumb: null, failedUrl: null, muted: false }); }
    t.url = HOME; t.title = 'New Tab'; t.favicon = '';
    showView(); refreshTab(t.id); updateChrome(); Store.save();
    setTimeout(() => $('url-input').focus(), 20);
  }

  function pickNeighbor(tab) {
    if (tab) activateTab(tab.id); else showNothing();
  }

  function reopenClosed() {
    const c = S.closed.shift();
    if (!c) return UI.toast('No recently closed tabs');
    if (c.spaceId && space(c.spaceId) && c.spaceId !== S.activeSpaceId) switchSpace(c.spaceId);
    newTab(c.url, { title: c.title });
  }

  function navigate(url, { newTab: inNew = false } = {}) {
    if (!url) return;
    const t = currentTab();
    if (inNew || !t) { newTab(url); return; }
    if (isHome(t)) {
      t.url = url; t.title = host(url); t.favicon = Store.faviconFor(url);
      createWebview(t); showView(); refreshTab(t.id); updateChrome();
      setTimeout(() => rt.get(t.id).wv && rt.get(t.id).wv.focus(), 30);
      Store.save();
      return;
    }
    const wv = currentWv();
    if (wv) { load(wv, url); wv.focus(); }
    else { t.url = url; createWebview(t); showView(); }
  }

  function moveTabToSpace(id, spaceId) {
    const loc = locate(id);
    if (!loc || loc.fav || !space(spaceId) || loc.space.id === spaceId) return;
    unsplitTab(id);
    loc.list.splice(loc.index, 1);
    if (loc.space.activeTabId === id) loc.space.activeTabId = null;
    space(spaceId).items.push(loc.tab);
    if (currentTabId === id) { currentTabId = null; switchSpace(spaceId); activateTab(id); }
    else renderSidebar();
    Store.save();
  }

  function moveItem(dragId, targetId, pos) {
    const sp = space();
    const dragged = locate(dragId) || (() => {
      const i = sp.items.findIndex((x) => x.id === dragId);
      return i >= 0 ? { item: sp.items[i], list: sp.items, index: i } : null;
    })();
    if (!dragged || dragged.fav || dragId === targetId) return;
    const item = dragged.item;
    dragged.list.splice(dragged.index, 1);

    if (targetId === '__end') sp.items.push(item);
    else {
      const tFolderIdx = sp.items.findIndex((x) => x.id === targetId);
      const tFolder = tFolderIdx >= 0 && sp.items[tFolderIdx].type === 'folder' ? sp.items[tFolderIdx] : null;
      if (pos === 'into' && tFolder && item.type === 'tab') { tFolder.children.push(item); tFolder.open = true; }
      else {
        let tl = locate(targetId);
        if (!tl && tFolder) tl = { list: sp.items, index: tFolderIdx, folder: null };
        if (!tl) { sp.items.push(item); }
        else {
          // folders can only live at the root
          if (item.type === 'folder' && tl.folder) tl = { list: sp.items, index: sp.items.indexOf(tl.folder) };
          tl.list.splice(tl.index + (pos === 'after' ? 1 : 0), 0, item);
        }
      }
    }
    renderSidebar(); Store.save();
  }

  /** new folder, placed below the given folder (or below the last folder, e.g. under "Socials") */
  function newFolder(after = null) {
    const sp = space();
    const f = { type: 'folder', id: Store.uid(), name: 'New Folder', icon: 'folder', open: true, children: [] };
    let idx = after ? sp.items.indexOf(after) : -1;
    if (idx < 0) sp.items.forEach((x, i) => { if (x.type === 'folder') idx = i; });
    sp.items.splice(idx + 1, 0, f);
    Store.save();
    startRename(f.id);
    return f;
  }

  function chooseFolderIcon(folder) {
    let icon = folder.icon || 'folderCode';
    let color = folder.color || '';
    UI.modal({
      title: `Icon for “${folder.name}”`,
      body(box, close) {
        const grid = h('div.icon-grid');
        const paint = () => grid.querySelectorAll('.icon-pick').forEach((b) => {
          b.classList.toggle('on', b.dataset.icon === icon);
          b.style.color = color || '';
        });
        FOLDER_ICONS.forEach((k) => {
          const b = h('button.icon-pick', { html: Icons[k], dataset: { icon: k } });
          b.onclick = () => { icon = k; paint(); };
          b.ondblclick = () => { icon = k; save(); };
          grid.append(b);
        });
        box.append(grid, h('label', { text: 'Color' }));
        const row = h('div.color-row');
        ['', ...Store.SPACE_COLORS].forEach((c) => {
          const chip = h('button.color-chip' + (c ? '' : '.none') + (c === color ? '.on' : ''), { style: c ? { background: c } : {}, 'data-tip': c ? c : 'Default' });
          chip.onclick = () => { color = c; row.querySelectorAll('.color-chip').forEach((x) => x.classList.toggle('on', x === chip)); paint(); };
          row.append(chip);
        });
        box.append(row);
        const save = () => { folder.icon = icon; folder.color = color; Store.save(); renderSidebar(); close(); };
        box.append(h('div.actions', null, h('button.s-btn.ghost', { text: 'Cancel', onclick: close }), h('button.s-btn.primary', { text: 'Save', onclick: save })));
        paint();
      },
    });
  }

  // ======================= spaces =======================
  function switchSpace(id) {
    if (id === S.activeSpaceId || !space(id)) return;
    if (currentTabId && rt.get(currentTabId)) { rt.get(currentTabId).lastActive = Date.now(); captureThumb(currentTabId); }
    S.activeSpaceId = id;
    const sp = space();
    if (sp.activeTabId && locate(sp.activeTabId)) { currentTabId = null; activateTab(sp.activeTabId, { focus: false }); }
    else { currentTabId = null; showView(); DevTools.follow(); updateChrome(); }
    renderSidebar(true);
    Store.save();
  }

  function colorPicker(initial) {
    let color = initial;
    return (box) => {
      box.append(h('label', { text: 'Color' }));
      const row = h('div.color-row');
      Store.SPACE_COLORS.forEach((c) => {
        const chip = h('button.color-chip' + (c === color ? '.on' : ''), { style: { background: c } });
        chip.onclick = () => { color = c; row.querySelectorAll('.color-chip').forEach((x) => x.classList.toggle('on', x === chip)); };
        row.append(chip);
      });
      box.append(row);
      return { get: () => ({ color }) };
    };
  }

  async function newSpace() {
    const res = await UI.prompt({
      title: 'New space', ok: 'Create',
      fields: [{ key: 'name', label: 'Name', placeholder: 'e.g. School, Work, Personal', value: `Space ${S.spaces.length + 1}` }],
      extra: colorPicker(Store.SPACE_COLORS[S.spaces.length % Store.SPACE_COLORS.length]),
    });
    if (!res) return;
    const sp = { id: Store.uid(), name: res.name || 'Space', color: res.color, items: [], activeTabId: null };
    S.spaces.push(sp);
    switchSpace(sp.id);
    UI.toast(`Space “${sp.name}” created`);
  }

  async function editSpace() {
    const sp = space();
    const res = await UI.prompt({ title: 'Edit space', fields: [{ key: 'name', label: 'Name', value: sp.name }], extra: colorPicker(sp.color) });
    if (!res) return;
    sp.name = res.name || sp.name; sp.color = res.color;
    renderSidebar(); Store.save();
  }

  async function deleteSpace() {
    if (S.spaces.length < 2) return;
    const sp = space();
    const ok = await UI.confirm({ title: `Delete “${sp.name}”?`, message: 'All tabs and folders in this space will be closed.', ok: 'Delete space', danger: true });
    if (!ok) return;
    flatTabs(sp).forEach((t) => { const r = rt.get(t.id); if (r && r.wv) r.wv.remove(); rt.delete(t.id); });
    const i = S.spaces.indexOf(sp);
    S.spaces.splice(i, 1);
    currentTabId = null;
    S.activeSpaceId = '';
    switchSpace(S.spaces[Math.max(0, i - 1)].id);
  }

  // ======================= favorites =======================
  function renderFavorites() {
    const box = $('favorites');
    box.innerHTML = '';
    S.favorites.forEach((f) => {
      const card = h('button.fav', { dataset: { fav: f.id } });
      if (f.url) {
        const src = f.favicon || Store.faviconFor(f.url);
        if (f.colorFor === src) { if (f.color) { card.style.backgroundColor = f.color; card.classList.add('tinted'); } }
        else tintFavorite(f, src);
        const img = h('img', { src });
        img.onerror = () => { img.replaceWith(h('span', { html: Icons.globe, style: { color: '#777', width: '20px' } })); };
        card.append(img);
        card.dataset.tip = f.title || host(f.url);
      } else {
        card.append(h('span.plus', { html: Icons.plus }));
        card.dataset.tip = 'Add favorite';
      }
      if (f.tab) {
        card.classList.toggle('active', f.tab.id === currentTabId);
        card.classList.toggle('unloaded', !isLoaded(f.tab));
        bindPreview(card, () => f.tab);
      }
      card.onclick = () => (f.url ? openFavorite(f) : editFavorite(f));
      card.onauxclick = (e) => { if (e.button === 1 && f.url) newTab(f.url); };
      card.oncontextmenu = (e) => { e.preventDefault(); favoriteMenu(f, e); };
      // drop a tab on a card to make it a favorite
      card.ondragover = (e) => { if (e.dataTransfer.types.includes('text/saturne-tab')) { e.preventDefault(); card.classList.add('drop-target'); } };
      card.ondragleave = () => card.classList.remove('drop-target');
      card.ondrop = (e) => {
        e.preventDefault(); card.classList.remove('drop-target');
        const loc = locate(e.dataTransfer.getData('text/saturne-tab'));
        if (loc && !isHome(loc.tab)) setFavorite(f, loc.tab.url, loc.tab.title, loc.tab.favicon);
      };
      box.append(card);
    });
  }

  function setFavorite(f, url, title, favicon) {
    if (f.tab) { const r = rt.get(f.tab.id); if (r && r.wv) r.wv.remove(); rt.delete(f.tab.id); if (currentTabId === f.tab.id) showNothing(); }
    f.url = url; f.title = title || host(url); f.favicon = favicon || Store.faviconFor(url); f.tab = null;
    renderFavorites(); Store.save();
    UI.toast(`Added “${f.title}” to favorites`);
  }

  function openFavorite(f) {
    if (!f.tab) f.tab = { type: 'tab', id: Store.uid(), url: f.url, title: f.title || host(f.url), favicon: f.favicon, fav: true };
    if (currentTabId === f.tab.id) {
      const wv = currentWv();
      if (wv && f.tab.url !== f.url) load(wv, f.url); // re-click goes back to the favorite's home URL
      return;
    }
    activateTab(f.tab.id);
  }

  async function editFavorite(f) {
    const t = currentTab();
    const res = await UI.prompt({
      title: f.url ? 'Edit favorite' : 'Add favorite',
      fields: [
        { key: 'url', label: 'Address', icon: Icons.link, placeholder: 'https://…', value: f.url || (t && !isHome(t) ? t.url : '') },
        { key: 'title', label: 'Name', placeholder: 'Optional', value: f.title || '' },
      ],
    });
    if (!res || !res.url) return;
    const url = Store.resolveInput(res.url);
    setFavorite(f, url, res.title || host(url));
  }

  function addToFavorites(tab) {
    let f = S.favorites.find((x) => !x.url);
    if (!f) { f = { id: Store.uid(), url: '' }; S.favorites.push(f); }
    setFavorite(f, tab.url, tab.title, tab.favicon);
  }

  function favoriteMenu(f, e) {
    const items = f.url ? [
      { label: 'Open', icon: Icons.open, onClick: () => openFavorite(f) },
      { label: 'Open in new tab', icon: Icons.plus, onClick: () => newTab(f.url) },
      { label: 'Unload', icon: Icons.unload, disabled: !f.tab || !isLoaded(f.tab) || f.tab.id === currentTabId, onClick: () => { unloadTab(f.tab.id); renderFavorites(); } },
      { label: 'Edit…', icon: Icons.pencil, onClick: () => editFavorite(f) },
      { label: 'Copy link', icon: Icons.copy, onClick: () => { window.saturne.copyText(f.url); UI.toast('Link copied'); } },
      { sep: true },
      { label: 'Add favorite slot', icon: Icons.plus, onClick: () => { S.favorites.push({ id: Store.uid(), url: '' }); renderFavorites(); Store.save(); } },
      { label: 'Remove from favorites', icon: Icons.trash, danger: true, onClick: () => clearFavorite(f) },
    ] : [
      { label: 'Add favorite…', icon: Icons.plus, onClick: () => editFavorite(f) },
      { label: 'Add favorite slot', icon: Icons.plus, onClick: () => { S.favorites.push({ id: Store.uid(), url: '' }); renderFavorites(); Store.save(); } },
      { label: 'Remove slot', icon: Icons.trash, danger: true, disabled: S.favorites.length <= 3, onClick: () => { S.favorites.splice(S.favorites.indexOf(f), 1); renderFavorites(); Store.save(); } },
    ];
    Menu.open({ x: e.clientX, y: e.clientY, items });
  }

  function clearFavorite(f) {
    if (f.tab) { const r = rt.get(f.tab.id); if (r && r.wv) r.wv.remove(); rt.delete(f.tab.id); if (currentTabId === f.tab.id) showNothing(); }
    if (S.favorites.length > 3) S.favorites.splice(S.favorites.indexOf(f), 1);
    else Object.assign(f, { url: '', title: '', favicon: '', tab: null });
    renderFavorites(); Store.save();
  }

  // ======================= sidebar =======================
  function tabIcon(tab) {
    const r = rt.get(tab.id);
    if (r && r.loading && r.wv) return h('span.spinner');
    if (isHome(tab)) return h('span', { html: Icons.saturn, style: { width: '17px', height: '17px', display: 'grid' } });
    if (tab.favicon) {
      const img = h('img', { src: tab.favicon });
      img.onerror = () => img.replaceWith(h('span', { html: Icons.globe, style: { width: '16px', height: '16px', display: 'grid' } }));
      return img;
    }
    return h('span', { html: Icons.globe, style: { width: '16px', height: '16px', display: 'grid' } });
  }

  function paintRow(row, tab) {
    const r = rt.get(tab.id);
    row.classList.toggle('active', tab.id === currentTabId);
    row.classList.toggle('unloaded', !isLoaded(tab));
    const sv = shownSplit();
    row.classList.toggle('split-pair', !!sv && tab.id !== currentTabId && (tab.id === sv.a || tab.id === sv.b));
    row.classList.toggle('in-split', inAnySplit(tab.id));
    const ri = row.querySelector('.ri');
    const key = (r && r.loading && r.wv ? 'L' : '') + (isHome(tab) ? 'H' : tab.favicon);
    if (ri.dataset.key !== key) { ri.dataset.key = key; ri.innerHTML = ''; ri.append(tabIcon(tab)); }
    const title = isHome(tab) ? 'New Tab' : (tab.title || tab.url);
    const rt_ = row.querySelector('.rt');
    if (rt_.textContent !== title) rt_.textContent = title;
    if (app.classList.contains('compact')) row.dataset.tip = title; else delete row.dataset.tip;
    let au = row.querySelector('.audio');
    const showAudio = r && r.wv && (r.audible || r.muted);
    if (showAudio && !au) {
      au = h('button.audio', { html: Icons.speaker });
      au.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(tab.id); });
      row.querySelector('.rx').before(au);
    }
    if (!showAudio && au) au.remove();
    if (showAudio) { au.classList.toggle('muted', !!r.muted); au.dataset.tip = r.muted ? 'Unmute tab' : 'Mute tab'; }
  }

  // click the speaker of a tab to mute / unmute it
  function toggleMute(id) {
    const r = rt.get(id);
    if (!r || !r.wv) return;
    r.muted = !r.muted;
    try { r.wv.setAudioMuted(r.muted); } catch {}
    refreshTab(id);
  }

  function tabRow(tab) {
    const row = h('div.row.tab', { draggable: 'true', dataset: { id: tab.id } },
      h('span.ri'), h('span.rt'), h('button.rx', { html: Icons.x, 'data-tip': 'Close tab' }));
    if (enterIds.delete(tab.id)) row.classList.add('row-enter');
    paintRow(row, tab);
    row.addEventListener('click', (e) => { if (!e.target.closest('.rx')) activateTab(tab.id); });
    row.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); closeTabAnimated(tab.id); } });
    row.querySelector('.rx').addEventListener('click', (e) => { e.stopPropagation(); hidePreview(); closeTabAnimated(tab.id); });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); hidePreview(); tabMenu(tab, e); });
    bindPreview(row, () => locate(tab.id) && locate(tab.id).tab);
    bindDrag(row, tab.id, 'tab');
    return row;
  }

  const FOLDER_ICONS = ['folderCode', 'folder', 'star', 'heart', 'music', 'game', 'book', 'briefcase', 'code', 'camera',
    'cart', 'chat', 'film', 'cap', 'sparkle', 'bolt', 'globe', 'palette', 'home', 'saturn', 'image', 'history', 'pin', 'space'];
  const enterIds = new Set(); // tabs that should play the "appear" animation

  function folderIconEl(folder) {
    const el = h('span.ri', { html: Icons[folder.icon] || Icons.folderCode });
    if (folder.color) el.style.color = folder.color;
    return el;
  }

  function toggleFolder(folder, force) {
    folder.open = force === undefined ? !folder.open : force;
    const row = document.querySelector(`#tab-list .row.folder[data-id="${folder.id}"]`);
    const kids = document.querySelector(`#tab-list .folder-kids[data-folder="${folder.id}"]`);
    if (row) row.classList.toggle('open', folder.open);
    if (kids) kids.classList.toggle('open', folder.open);
    Store.save();
  }

  function folderRow(folder) {
    const row = h('div.row.folder' + (folder.open ? '.open' : ''), { draggable: 'true', dataset: { id: folder.id } },
      folderIconEl(folder), h('span.rt', { text: folder.name }), h('span.fchev', { html: Icons.chevRight }));
    if (app.classList.contains('compact')) row.dataset.tip = folder.name;
    row.addEventListener('click', () => { if (!row.classList.contains('renaming')) toggleFolder(folder); });
    row.addEventListener('dblclick', (e) => { e.preventDefault(); startRename(folder.id); });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); hidePreview(); folderMenu(folder, e); });
    bindDrag(row, folder.id, 'folder');
    return row;
  }

  function folderKids(folder) {
    const inner = h('div.fk-inner');
    folder.children.forEach((c, i) => { const r = tabRow(c); r.style.setProperty('--i', Math.min(i, 8)); inner.append(r); });
    if (!folder.children.length) inner.append(h('div.empty-hint', { text: 'Drag tabs here' }));
    return h('div.folder-kids' + (folder.open ? '.open' : ''), { dataset: { folder: folder.id } }, inner);
  }

  function renderSidebar(animate = false) {
    renderFavorites();
    const sp = space();
    $('space-name').querySelector('.label').textContent = sp.name;
    $('space-name').querySelector('.initial').textContent = (sp.name.trim()[0] || 'S').toUpperCase();
    $('space-name').style.setProperty('--space-color', sp.color || 'var(--accent)');
    if (app.classList.contains('compact')) $('space-name').dataset.tip = sp.name; else delete $('space-name').dataset.tip;
    const list = $('tab-list');
    list.innerHTML = '';
    // folders first, then a separator, then the loose tabs
    const folders = sp.items.filter((x) => x.type === 'folder');
    const tabs = sp.items.filter((x) => x.type === 'tab');
    folders.forEach((f) => { list.append(folderRow(f)); list.append(folderKids(f)); });
    if (folders.length) list.append(h('div.list-sep'));
    tabs.forEach((t) => list.append(tabRow(t)));
    const nt = h('div.row.newtab', { dataset: { id: '__end' } },
      h('span.ri.small', { html: Icons.plus }), h('span.rt', { text: 'New Tab' }));
    if (app.classList.contains('compact')) nt.dataset.tip = 'New Tab  (Ctrl+T)';
    nt.onclick = () => newTab();
    bindDrop(nt, '__end');
    list.append(nt);
    if (animate) { list.classList.remove('space-anim'); void list.offsetWidth; list.classList.add('space-anim'); }
    renderSpaceDots();
  }

  function paintAll() {
    document.querySelectorAll('#tab-list .row.tab').forEach((row) => {
      const loc = locate(row.dataset.id);
      if (loc) paintRow(row, loc.tab);
    });
    renderFavorites();
  }

  function refreshTab(id) {
    const row = document.querySelector(`#tab-list .row.tab[data-id="${id}"]`);
    const loc = locate(id);
    if (row && loc) paintRow(row, loc.tab);
    if (loc && loc.fav) renderFavorites();
    if (id === currentTabId) updateChrome();
  }

  function renderSpaceDots() {
    const box = $('space-dots');
    box.innerHTML = '';
    if (S.spaces.length < 2) return;
    S.spaces.forEach((sp, i) => {
      const d = h('button.space-dot' + (sp.id === S.activeSpaceId ? '.active' : ''), { 'data-tip': `${sp.name}  (Ctrl+${i + 1})` }, h('i'));
      d.querySelector('i').style.background = sp.id === S.activeSpaceId ? sp.color : '';
      d.onclick = () => switchSpace(sp.id);
      d.ondragover = (e) => { if (e.dataTransfer.types.includes('text/saturne-tab')) e.preventDefault(); };
      d.ondrop = (e) => { e.preventDefault(); moveTabToSpace(e.dataTransfer.getData('text/saturne-tab'), sp.id); };
      box.append(d);
    });
  }

  function startRename(folderId) {
    renderSidebar();
    const row = document.querySelector(`#tab-list .row.folder[data-id="${folderId}"]`);
    const f = space().items.find((x) => x.id === folderId);
    if (!row || !f) return;
    row.classList.add('renaming');
    row.draggable = false;
    const input = h('input.rename-input', { value: f.name });
    const rtEl = row.querySelector('.rt');
    rtEl.innerHTML = ''; rtEl.append(input);
    input.focus(); input.select();
    let done = false;
    const finish = (save) => {
      if (done) return; done = true;
      if (save && input.value.trim()) f.name = input.value.trim();
      Store.save(); renderSidebar();
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  // ---------- drag & drop ----------
  let dragId = null, dragKind = null;
  function clearDropMarks() { document.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into')); }
  function bindDrag(row, id, kind) {
    row.addEventListener('dragstart', (e) => {
      hidePreview();
      dragId = id; dragKind = kind;
      e.dataTransfer.setData(kind === 'tab' ? 'text/saturne-tab' : 'text/saturne-folder', id);
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => row.classList.add('dragging'));
    });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); clearDropMarks(); dragId = null; });
    bindDrop(row, id);
  }
  function bindDrop(row, id) {
    // tabs: reorder among tabs or drop INTO a folder · folders: reorder among folders
    const zone = (e) => {
      const r = row.getBoundingClientRect();
      const half = (e.clientY - r.top) / r.height < 0.5 ? 'before' : 'after';
      if (row.classList.contains('folder')) return dragKind === 'tab' ? 'into' : half;
      if (dragKind === 'folder') return null;
      if (id === '__end') return 'before';
      return half;
    };
    row.addEventListener('dragover', (e) => {
      if (!dragId || dragId === id) return;
      const z = zone(e);
      if (!z) return;
      e.preventDefault();
      clearDropMarks();
      row.classList.add('drop-' + z);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after', 'drop-into'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const z = zone(e);
      clearDropMarks();
      if (z && dragId && dragId !== id) moveItem(dragId, id, z);
    });
  }

  // ======================= hover preview (after 3 s) =======================
  let pvTimer = null, pvEl = null;
  function bindPreview(el, getTab) {
    el.addEventListener('mouseenter', () => {
      clearTimeout(pvTimer);
      pvTimer = setTimeout(() => { const t = getTab(); if (t && document.contains(el)) showPreview(t, el); }, (S.settings.previewDelay || 3) * 1000);
    });
    el.addEventListener('mouseleave', hidePreview);
    el.addEventListener('mousedown', hidePreview);
  }
  function hidePreview() { clearTimeout(pvTimer); if (pvEl) { pvEl.remove(); pvEl = null; } }

  async function showPreview(tab, anchor) {
    hidePreview();
    const r = rt.get(tab.id);
    const unloaded = !isLoaded(tab);
    const img = h('div.pv-img');
    let badge = '';
    if (isHome(tab)) {
      img.style.background = getComputedStyle($('home-wallpaper')).background;
      img.append(h('span', { text: 'New Tab', style: { color: '#fff', fontWeight: 600, textShadow: '0 1px 8px rgba(0,0,0,.5)' } }));
      badge = tab.id === currentTabId ? 'Current' : '';
    } else if (unloaded) {
      img.classList.add('black'); // unloaded tab -> black screen
      badge = 'Unloaded';
    } else {
      badge = tab.id === currentTabId ? 'Current' : unloadBadge(r);
      if (r && r.thumb) img.style.backgroundImage = `url("${r.thumb}")`;
      else if (tab.favicon) img.append(h('img.fav', { src: tab.favicon }));
    }
    pvEl = h('div.preview', null, img,
      h('div.pv-title', { text: isHome(tab) ? 'New Tab' : tab.title || tab.url }),
      h('div.pv-url', null, h('span', { text: isHome(tab) ? 'Home' : host(tab.url), style: { overflow: 'hidden', textOverflow: 'ellipsis' } }),
        badge ? h('span.pv-badge', { text: badge }) : null));
    $('layer').append(pvEl);
    const a = anchor.getBoundingClientRect();
    const sb = $('sidebar').getBoundingClientRect();
    const left = Math.max(a.right, sb.right) + 10;
    const top = UI.clamp(a.top + a.height / 2 - pvEl.offsetHeight / 2, 8, window.innerHeight - pvEl.offsetHeight - 8);
    pvEl.style.left = left + 'px';
    pvEl.style.top = top + 'px';

    // live capture for loaded tabs
    if (!unloaded && !isHome(tab) && r && r.wcId) {
      const me = pvEl;
      const data = await captureThumb(tab.id);
      if (data && me === pvEl) { img.innerHTML = ''; img.style.backgroundImage = `url("${data}")`; }
    }
  }
  function unloadBadge(r) {
    const mins = Number(S.settings.unloadMinutes);
    if (!mins || !r) return 'Loaded';
    const left = Math.max(0, mins * 60000 - (Date.now() - r.lastActive));
    const m = Math.ceil(left / 60000);
    return left < 60000 ? 'Unloads in <1 min' : `Unloads in ${m} min`;
  }

  // ======================= menus =======================
  function tabMenu(tab, e) {
    const loc = locate(tab.id);
    const sp = loc.space;
    const loaded = isLoaded(tab);
    const otherSpaces = S.spaces.filter((s) => s.id !== sp.id);
    const folders = sp.items.filter((x) => x.type === 'folder');
    Menu.open({
      x: e.clientX, y: e.clientY,
      items: [
        loaded && !isHome(tab)
          ? { label: 'Unload tab', icon: Icons.unload, disabled: tab.id === currentTabId, onClick: () => unloadTab(tab.id) }
          : { label: 'Load tab', icon: Icons.reload, disabled: isHome(tab), onClick: () => { createWebview(tab); refreshTab(tab.id); } },
        { label: 'Reload', icon: Icons.reload, disabled: !loaded || isHome(tab), onClick: () => rt.get(tab.id).wv.reload() },
        { label: 'Duplicate', icon: Icons.duplicate, onClick: () => newTab(tab.url, { background: true, title: tab.title }) },
        { label: 'Copy link', icon: Icons.copy, disabled: isHome(tab), onClick: () => { window.saturne.copyText(tab.url); UI.toast('Link copied'); } },
        inAnySplit(tab.id)
          ? { label: 'Close split view', icon: Icons.split, onClick: () => { unsplitTab(tab.id); showView(); } }
          : { label: 'Split view with current tab', icon: Icons.split, disabled: isHome(tab) || tab.id === currentTabId || !currentTab() || isHome(currentTab()), onClick: () => openSplit(tab.id) },
        { sep: true },
        { label: 'Add to favorites', icon: Icons.star, disabled: isHome(tab), onClick: () => addToFavorites(tab) },
        { label: 'Bookmark', icon: Icons.pin, disabled: isHome(tab), onClick: () => toggleBookmark(tab) },
        {
          label: 'Move to space', icon: Icons.space,
          submenu: [
            ...otherSpaces.map((s) => ({ label: s.name, dot: s.color, onClick: () => moveTabToSpace(tab.id, s.id) })),
            ...(otherSpaces.length ? [{ sep: true }] : []),
            { label: 'New space…', icon: Icons.plus, onClick: async () => { const before = S.spaces.length; await newSpace(); if (S.spaces.length > before) moveTabToSpace(tab.id, S.spaces[S.spaces.length - 1].id); } },
          ],
        },
        {
          label: 'Move to folder', icon: Icons.folder,
          submenu: [
            { label: 'No folder', checked: !loc.folder, onClick: () => { loc.list.splice(loc.index, 1); sp.items.push(tab); renderSidebar(); Store.save(); } },
            ...folders.map((f) => ({ label: f.name, checked: loc.folder === f, onClick: () => { const l = locate(tab.id); l.list.splice(l.index, 1); f.children.push(tab); f.open = true; renderSidebar(); Store.save(); } })),
            { sep: true },
            { label: 'New folder…', icon: Icons.plus, onClick: () => { const l = locate(tab.id); l.list.splice(l.index, 1); const f = { type: 'folder', id: Store.uid(), name: 'New Folder', open: true, children: [tab] }; sp.items.push(f); Store.save(); startRename(f.id); } },
          ],
        },
        { sep: true },
        { label: 'Close other tabs', icon: Icons.x, onClick: () => flatTabs(sp).filter((t) => t.id !== tab.id).forEach((t) => closeTab(t.id)) },
        { label: 'Close tab', icon: Icons.x, shortcut: 'Ctrl+W', danger: true, onClick: () => closeTabAnimated(tab.id) },
      ],
    });
  }

  function folderMenu(folder, e) {
    const sp = space();
    Menu.open({
      x: e.clientX, y: e.clientY,
      items: [
        { label: folder.open ? 'Collapse' : 'Expand', icon: Icons.chevRight, onClick: () => toggleFolder(folder) },
        { label: 'New tab in folder', icon: Icons.plus, onClick: () => newTab(HOME, { folderId: folder.id }) },
        { label: 'New folder below', icon: Icons.folder, onClick: () => newFolder(folder) },
        { sep: true },
        { label: 'Rename', icon: Icons.pencil, shortcut: 'Double-click', onClick: () => startRename(folder.id) },
        { label: 'Change icon…', icon: Icons[folder.icon] || Icons.folderCode, onClick: () => chooseFolderIcon(folder) },
        { label: 'Unload all tabs', icon: Icons.unload, disabled: !folder.children.length, onClick: () => folder.children.forEach((t) => t.id !== currentTabId && unloadTab(t.id)) },
        {
          label: 'Move to space', icon: Icons.space, disabled: S.spaces.length < 2,
          submenu: S.spaces.filter((s) => s.id !== sp.id).map((s) => ({
            label: s.name, dot: s.color,
            onClick: () => {
              if (folder.children.some((t) => t.id === currentTabId)) showNothing();
              sp.items.splice(sp.items.indexOf(folder), 1); s.items.push(folder); renderSidebar(); Store.save();
            },
          })),
        },
        { sep: true },
        { label: 'Ungroup tabs', icon: Icons.layout, onClick: () => { const i = sp.items.indexOf(folder); sp.items.splice(i, 1, ...folder.children); renderSidebar(); Store.save(); } },
        {
          label: 'Delete folder and tabs', icon: Icons.trash, danger: true, onClick: async () => {
            if (folder.children.length && !(await UI.confirm({ title: `Delete “${folder.name}”?`, message: `${folder.children.length} tab(s) will be closed.`, ok: 'Delete', danger: true }))) return;
            [...folder.children].forEach((t) => closeTab(t.id));
            sp.items.splice(sp.items.indexOf(folder), 1);
            renderSidebar(); Store.save();
          },
        },
      ],
    });
  }

  function spaceMenu(e) {
    const btn = $('space-name');
    const atCursor = e && e.type === 'contextmenu';
    if (atCursor) { e.preventDefault(); e.stopPropagation(); } else if (Menu.justClosed(btn)) return;
    const sp = space();
    Menu.open({
      ...(atCursor ? { x: e.clientX, y: e.clientY } : { anchor: btn }), minWidth: 230,
      items: [
        { header: 'Spaces' },
        ...S.spaces.map((s, i) => ({ label: s.name, dot: s.color, checked: s.id === sp.id, shortcut: i < 9 ? `Ctrl+${i + 1}` : '', onClick: () => switchSpace(s.id) })),
        { sep: true },
        { label: 'New space…', icon: Icons.plus, onClick: newSpace },
        { label: 'Edit space…', icon: Icons.pencil, onClick: editSpace },
        { label: 'New folder', icon: Icons.folder, onClick: newFolder },
        { label: 'Unload inactive tabs', icon: Icons.unload, onClick: () => flatTabs(sp).forEach((t) => t.id !== currentTabId && unloadTab(t.id)) },
        { sep: true },
        { label: 'Delete space', icon: Icons.trash, danger: true, disabled: S.spaces.length < 2, onClick: deleteSpace },
      ],
    });
  }

  function mainMenu() {
    const btn = $('btn-more');
    if (Menu.justClosed(btn)) return;
    const t = currentTab();
    const onPage = t && !isHome(t);
    const r = currentTabId && rt.get(currentTabId);
    const bookmarked = onPage && S.bookmarks.some((b) => b.url === t.url);
    const st = S.settings;
    const set = (k, v) => { st[k] = v; Store.save(); applySettings(); };
    const splitOn = !!shownSplit();

    // compact layout: rows of tiles instead of one long list (no scrolling)
    const tile = (icon, label, fn, { disabled = false, on = false, tip = '', sub = false } = {}) => {
      const b = h('button.mm-tile' + (on ? '.on' : '') + (disabled ? '.disabled' : ''), tip ? { 'data-tip': tip } : null,
        h('span.mm-ico', { html: icon }), h('span.mm-lbl', { text: label }), sub ? h('span.mm-sub', { html: Icons.chevDown }) : null);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        if (disabled) return;
        const rect = b.getBoundingClientRect();
        Menu.closeAll();
        fn(rect);
      });
      return b;
    };
    const below = (rect, items) => Menu.open({ x: rect.left, y: rect.bottom - 2, items });
    const grid = (cls, ...tiles) => h('div.mm-grid' + cls, null, ...tiles);
    const pct = () => `${Math.round(Math.pow(1.2, (rt.get(currentTabId) || {}).zoom || 0) * 100)}%`;
    const zoomPct = h('span.mm-zoom-val', { text: pct() });
    const zb = (icon, tip, d) => {
      const b = h('button.mm-zb', { html: icon, 'data-tip': tip, onclick: () => { zoom(d); zoomPct.textContent = pct(); } });
      b.disabled = !onPage;
      return b;
    };
    const zr = h('button.mm-zb.mm-zr', { text: 'Reset', onclick: () => { zoom(0); zoomPct.textContent = pct(); } });
    zr.disabled = !onPage;

    const panel = h('div.mm', null,
      grid('.g4',
        tile(Icons.plus, 'New tab', () => newTab(), { tip: 'Ctrl+T' }),
        tile(Icons.space, 'Space', newSpace, { tip: 'New space' }),
        tile(Icons.folder, 'Folder', () => newFolder(), { tip: 'New folder' }),
        tile(Icons.history, 'Reopen', reopenClosed, { disabled: !S.closed.length, tip: 'Reopen closed tab  (Ctrl+Shift+T)' })),
      h('div.mm-title', { text: onPage ? host(t.url) : 'This page' }),
      grid('.g5',
        tile(bookmarked ? Icons.starFill : Icons.star, bookmarked ? 'Saved' : 'Bookmark', () => toggleBookmark(t), { disabled: !onPage, on: bookmarked, tip: 'Ctrl+D' }),
        tile(Icons.pin, 'Favorite', () => addToFavorites(t), { disabled: !onPage, tip: 'Add to favorites' }),
        tile(Icons.search, 'Find', () => Find.open(), { disabled: !onPage, tip: 'Find in page  (Ctrl+F)' }),
        tile(Icons.split, splitOn ? 'Unsplit' : 'Split', () => (splitOn ? closeSplit() : pickSplit()), { disabled: !onPage && !splitOn, on: splitOn, tip: splitOn ? 'Close split view' : 'Split view' }),
        tile(Icons.reader, 'Reader', () => Features.toggleReader(), { disabled: !onPage, on: Features.readerOn(), tip: 'Reader mode  (F9)' }),
        tile(Icons.translate, 'Translate', (rc) => below(rc, Features.translateItems()), { disabled: !onPage, sub: true }),
        tile(Icons.camera, 'Capture', (rc) => below(rc, [
          { label: 'Select an area', icon: Icons.crop, shortcut: 'Ctrl+Shift+X', onClick: () => Features.screenshot('area') },
          { label: 'Visible part', icon: Icons.window, onClick: () => Features.screenshot('visible') },
          { label: 'Full page', icon: Icons.file, onClick: () => Features.screenshot('full') },
        ]), { disabled: !onPage, sub: true, tip: 'Screenshot' }),
        tile(Icons.pip, 'PiP', () => Features.pip(), { disabled: !onPage, tip: 'Picture-in-picture' }),
        tile(Icons.printer, 'Print', printPage, { disabled: !onPage, tip: 'Ctrl+P' }),
        tile(Icons.code, 'DevTools', () => DevTools.toggle(), { disabled: !(r && r.wv) && !DevTools.view, on: !!DevTools.view, tip: 'Developer tools  (F12)' })),
      h('div.mm-zoom', null, h('span.mm-ico', { html: Icons.zoomIn }), h('span.mm-zl', { text: 'Zoom' }),
        zb(Icons.zoomOut, 'Zoom out  (Ctrl+-)', -1), zoomPct, zb(Icons.zoomIn, 'Zoom in  (Ctrl+=)', 1), zr),
      h('div.mm-sep'),
      grid('.g4',
        tile(Icons.history, 'History', openHistory, { tip: 'Ctrl+H' }),
        tile(Icons.download, 'Downloads', () => openDownloads()),
        tile(Icons.key, 'Passwords', () => Features.passwords()),
        tile(Icons.puzzle, 'Extensions', () => Features.extensions())));

    Menu.open({
      anchor: btn, align: 'right', minWidth: 340, className: 'main-menu',
      items: [
        { custom: panel },
        { sep: true },
        { label: 'Search open tabs', icon: Icons.tabs, shortcut: 'Ctrl+Shift+A', onClick: () => TabSearch.open() },
        { label: 'Customize home page', icon: Icons.palette, onClick: () => { if (!isHome(t)) newTab(); setTimeout(() => Home.openCustomize(), 60); } },
        {
          label: 'Settings', icon: Icons.gear,
          submenu: [
            { header: 'Search engine' },
            ...Object.entries(Store.SEARCH_ENGINES).map(([k, v]) => ({ label: v.name, checked: st.searchEngine === k, onClick: () => set('searchEngine', k) })),
            { sep: true },
            {
              label: 'Unload inactive tabs after', icon: Icons.unload,
              submenu: [1, 5, 10, 30, 60, 0].map((m) => ({
                label: m ? (m === 60 ? '1 hour' : `${m} minute${m > 1 ? 's' : ''}`) : 'Never',
                checked: Number(st.unloadMinutes) === m, onClick: () => set('unloadMinutes', m),
              })),
            },
            {
              label: 'Tab preview delay', icon: Icons.image,
              submenu: [1, 2, 3, 5].map((s) => ({ label: `${s} second${s > 1 ? 's' : ''}`, checked: Number(st.previewDelay) === s, onClick: () => set('previewDelay', s) })),
            },
            { sep: true },
            { label: 'Expanded sidebar', checked: st.sidebarOpen, shortcut: 'Ctrl+Shift+S', onClick: toggleSidebar },
            { label: 'Show bookmarks bar', checked: st.showBookmarks, onClick: () => set('showBookmarks', !st.showBookmarks) },
            { label: 'Custom scrollbars on websites', checked: st.webScrollbars, onClick: () => { set('webScrollbars', !st.webScrollbars); toggleWebScrollbars(); } },
            { sep: true },
            { label: 'Site permissions…', icon: Icons.globe, onClick: () => Perms.manage() },
            { label: isDefault ? 'Saturne is your default browser' : 'Make Saturne the default browser…', icon: Icons.saturn, checked: isDefault, disabled: isDefault, onClick: makeDefault },
            { sep: true },
            { label: 'About Saturne', icon: Icons.info, onClick: about },
          ],
        },
      ],
    });
  }

  function toggleWebScrollbars() {
    for (const [, r] of rt) {
      if (!r.wv || !r.wcId) continue;
      if (S.settings.webScrollbars) r.wv.insertCSS(SCROLLBAR_CSS).then((k) => (r.cssKey = k)).catch(() => {});
      else if (r.cssKey) { r.wv.removeInsertedCSS(r.cssKey).catch(() => {}); r.cssKey = null; }
    }
  }

  function zoom(dir) {
    const r = currentTabId && rt.get(currentTabId);
    if (!r || !r.wv) return;
    r.zoom = dir === 0 ? 0 : UI.clamp((r.zoom || 0) + dir * 0.5, -3, 4);
    r.wv.setZoomLevel(r.zoom);
    UI.toast(`Zoom ${Math.round(Math.pow(1.2, r.zoom) * 100)}%`, 1200);
  }

  function about() {
    const chrome = (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || '';
    UI.modal({
      title: 'Saturne',
      body(box, close) {
        box.append(h('p', { text: 'A custom web browser with spaces, auto-unloading tabs, hover previews and a fully customizable home page.' }));
        box.append(h('p', { text: `Version 1.0.0 · Chromium ${chrome}` }));
        box.append(h('div.actions', null, h('button.s-btn.primary', { text: 'Close', onclick: close })));
      },
    });
  }

  // ---------- page context menu (right-click inside a website) ----------
  function pageMenu(p) {
    const tabId = [...rt.entries()].find(([, r]) => r.wcId === p.wcId);
    if (!tabId) return;
    const r = tabId[1];
    const wv = r.wv;
    const wr = wv.getBoundingClientRect();
    // real cursor position (from the main process) so the menu sits right next to the pointer
    const x = p.cursorX != null ? p.cursorX : wr.left + p.x;
    const y = p.cursorY != null ? p.cursorY : wr.top + p.y;
    const items = [];
    if (p.linkURL) {
      items.push(
        { label: 'Open link in new tab', icon: Icons.plus, onClick: () => newTab(p.linkURL, { background: true }) },
        { label: 'Open link in new space…', icon: Icons.space, submenu: S.spaces.filter((s) => s.id !== S.activeSpaceId).map((s) => ({ label: s.name, dot: s.color, onClick: () => { switchSpace(s.id); newTab(p.linkURL); } })).concat(S.spaces.length < 2 ? [{ label: 'No other space', disabled: true }] : []) },
        { label: 'Copy link address', icon: Icons.copy, onClick: () => window.saturne.copyText(p.linkURL) },
        { sep: true });
    }
    if (p.mediaType === 'video') {
      items.push(
        { label: 'Picture-in-picture', icon: Icons.pip, onClick: () => Features.pip(tabId[0], p.x, p.y) },
        { sep: true });
    }
    if (p.mediaType === 'image' && p.srcURL) {
      items.push(
        { label: 'Open image in new tab', icon: Icons.image, onClick: () => newTab(p.srcURL, { background: true }) },
        { label: 'Copy image address', icon: Icons.copy, onClick: () => window.saturne.copyText(p.srcURL) },
        { sep: true });
    }
    if (p.isEditable) {
      items.push(
        { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !p.editFlags.canUndo, onClick: () => wv.undo() },
        { label: 'Cut', shortcut: 'Ctrl+X', disabled: !p.editFlags.canCut, onClick: () => wv.cut() },
        { label: 'Copy', shortcut: 'Ctrl+C', disabled: !p.editFlags.canCopy, onClick: () => wv.copy() },
        { label: 'Paste', shortcut: 'Ctrl+V', disabled: !p.editFlags.canPaste, onClick: () => wv.paste() },
        { label: 'Select all', shortcut: 'Ctrl+A', onClick: () => wv.selectAll() },
        { sep: true });
    } else if (p.selectionText) {
      const q = p.selectionText.trim().slice(0, 40);
      items.push(
        { label: 'Copy', icon: Icons.copy, shortcut: 'Ctrl+C', onClick: () => wv.copy() },
        { label: `Search for “${q}${p.selectionText.length > 40 ? '…' : ''}”`, icon: Icons.search, onClick: () => newTab((Store.SEARCH_ENGINES[S.settings.searchEngine] || Store.SEARCH_ENGINES.google).url + encodeURIComponent(p.selectionText.trim())) },
        { sep: true });
    }
    items.push(
      { label: 'Back', icon: Icons.back, disabled: !p.canGoBack, onClick: () => wv.goBack() },
      { label: 'Forward', icon: Icons.forward, disabled: !p.canGoForward, onClick: () => wv.goForward() },
      { label: 'Reload', icon: Icons.reload, onClick: () => wv.reload() },
      { sep: true },
      { label: 'Translate page', icon: Icons.translate, submenu: Features.translateItems(tabId[0]) },
      { label: 'Reader mode', icon: Icons.reader, shortcut: 'F9', onClick: () => { if (tabId[0] !== currentTabId) activateTab(tabId[0]); Features.toggleReader(); } },
      { label: 'Screenshot', icon: Icons.camera, shortcut: 'Ctrl+Shift+X', onClick: () => { if (tabId[0] !== currentTabId) activateTab(tabId[0]); Features.screenshot('area'); } },
      { sep: true },
      { label: 'Inspect', icon: Icons.code, onClick: () => DevTools.inspect(tabId[0], p.x, p.y) });
    Menu.open({ x, y, items });
  }

  // ======================= developer tools (custom docked panel) =======================
  const DevTools = {
    tabId: null, view: null, wanted: false,
    get dock() { return S.settings.devtoolsDock || 'bottom'; },

    layout() {
      const c = $('content');
      c.classList.toggle('dt-open', !!this.view);
      c.classList.toggle('dt-bottom', this.dock === 'bottom');
      c.classList.toggle('dt-right', this.dock === 'right');
      c.style.setProperty('--dt-size', (this.dock === 'bottom' ? S.settings.dtHeight || 320 : S.settings.dtWidth || 460) + 'px');
      const b = $('dt-dock');
      b.innerHTML = this.dock === 'bottom' ? Icons.dockRight : Icons.dockBottom;
      b.dataset.tip = this.dock === 'bottom' ? 'Dock to the right' : 'Dock to the bottom';
      const loc = this.tabId && locate(this.tabId);
      $('devtools-panel').querySelector('.dt-target').textContent = loc ? host(loc.tab.url) : '';
    },

    async open(tabId) {
      const loc = locate(tabId);
      const r = rt.get(tabId);
      if (!loc || isHome(loc.tab) || !r || !r.wv) { UI.toast('Open a web page to use the developer tools'); return false; }
      this.wanted = true;
      if (this.tabId === tabId && this.view) return true;
      this.close(false);
      if (!r.wcId) await new Promise((res) => r.wv.addEventListener('dom-ready', res, { once: true }));
      const dv = document.createElement('webview');
      dv.setAttribute('src', 'about:blank');
      $('devtools-panel').querySelector('.dt-body').append(dv);
      this.view = dv; this.tabId = tabId;
      this.layout();
      await new Promise((res) => dv.addEventListener('dom-ready', res, { once: true }));
      if (this.view !== dv) return false;
      return window.saturne.attachDevTools(r.wcId, dv.getWebContentsId());
    },

    close(byUser = true) {
      if (byUser) this.wanted = false;
      if (this.tabId) { const r = rt.get(this.tabId); if (r && r.wcId) window.saturne.closeDevTools(r.wcId); }
      if (this.view) this.view.remove();
      this.view = null; this.tabId = null;
      this.layout();
    },

    toggle() { if (this.view) this.close(); else if (currentTabId) this.open(currentTabId); },

    async inspect(tabId, x, y) {
      if (await this.open(tabId)) window.saturne.inspectAt(rt.get(tabId).wcId, Math.round(x), Math.round(y));
    },

    // follow the visible tab: reopen on web pages, hide on the home page
    follow() {
      if (!this.wanted || this.tabId === currentTabId) return;
      const t = currentTab(), r = currentTabId && rt.get(currentTabId);
      if (t && !isHome(t) && r && r.wv) this.open(currentTabId);
      else this.close(false);
    },

    init() {
      $('devtools-panel').querySelector('.dt-ico').innerHTML = Icons.code;
      $('dt-close').innerHTML = Icons.x;
      $('dt-reload').innerHTML = Icons.reload;
      $('dt-close').onclick = () => this.close();
      $('dt-reload').onclick = () => { const r = this.tabId && rt.get(this.tabId); if (r && r.wv) r.wv.reload(); };
      $('dt-dock').onclick = () => { S.settings.devtoolsDock = this.dock === 'bottom' ? 'right' : 'bottom'; Store.save(); this.layout(); };
      // resize by dragging the edge
      $('dt-splitter').addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const bottom = this.dock === 'bottom';
        document.body.classList.add('resizing', bottom ? 'ns' : 'ew');
        const shield = $('drag-shield');
        const rect = $('content').getBoundingClientRect();
        const move = (ev) => {
          if (bottom) S.settings.dtHeight = Math.round(UI.clamp(rect.bottom - ev.clientY, 140, rect.height - 100));
          else S.settings.dtWidth = Math.round(UI.clamp(rect.right - ev.clientX, 260, rect.width - 200));
          this.layout();
        };
        const up = () => {
          document.body.classList.remove('resizing', 'ns', 'ew');
          shield.removeEventListener('pointermove', move);
          shield.removeEventListener('pointerup', up);
          Store.save();
        };
        shield.addEventListener('pointermove', move);
        shield.addEventListener('pointerup', up);
      });
      this.layout();
    },
  };

  // ======================= extra right-click menus =======================
  /** custom context menu for every text field (inputs & textareas of the UI) */
  function textMenu(el, e) {
    e.preventDefault();
    if (!/^(text|search|url|email|password|)$/i.test(el.type || '') && el.tagName !== 'TEXTAREA') return;
    const start = el.selectionStart, end = el.selectionEnd;
    const sel = el.value.slice(start, end);
    const ro = el.readOnly || el.disabled;
    const clip = window.saturne.readClipboard();
    const put = (text) => {
      el.focus();
      el.setSelectionRange(start, end);
      el.setRangeText(text, start, end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const isUrl = el.id === 'url-input';
    Menu.open({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'Undo', icon: Icons.undo, shortcut: 'Ctrl+Z', disabled: ro, onClick: () => { el.focus(); document.execCommand('undo'); } },
        { label: 'Redo', icon: Icons.redo, shortcut: 'Ctrl+Y', disabled: ro, onClick: () => { el.focus(); document.execCommand('redo'); } },
        { sep: true },
        { label: 'Cut', icon: Icons.scissors, shortcut: 'Ctrl+X', disabled: !sel || ro, onClick: () => { window.saturne.copyText(sel); put(''); } },
        { label: 'Copy', icon: Icons.copy, shortcut: 'Ctrl+C', disabled: !sel, onClick: () => window.saturne.copyText(sel) },
        { label: 'Paste', icon: Icons.paste, shortcut: 'Ctrl+V', disabled: !clip || ro, onClick: () => put(clip) },
        isUrl ? { label: 'Paste and go', icon: Icons.forward, disabled: !clip, onClick: () => { el.blur(); navigate(Store.resolveInput(clip)); } } : null,
        { label: 'Delete', icon: Icons.trash, disabled: !sel || ro, onClick: () => put('') },
        { sep: true },
        { label: 'Select all', icon: Icons.selectAll, shortcut: 'Ctrl+A', onClick: () => { el.focus(); el.select(); } },
      ],
    });
  }

  /** right-click on back / forward: list of pages to jump to */
  async function historyMenu(dir, e) {
    e.preventDefault(); e.stopPropagation();
    const r = currentTabId && rt.get(currentTabId);
    const items = [];
    if (r && r.wcId) {
      const hist = await window.saturne.navHistory(r.wcId);
      if (hist) {
        const list = dir < 0
          ? hist.entries.map((x, i) => ({ ...x, i })).slice(0, hist.index).reverse()
          : hist.entries.map((x, i) => ({ ...x, i })).slice(hist.index + 1);
        list.filter((x) => !x.url.startsWith(ERR_PREFIX)).slice(0, 12).forEach((x) => items.push({
          label: x.title || x.url, img: Store.faviconFor(x.url), onClick: () => window.saturne.goToIndex(r.wcId, x.i),
        }));
      }
    }
    if (!items.length) items.push({ label: dir < 0 ? 'No previous pages' : 'No next pages', disabled: true });
    items.push({ sep: true }, { label: 'Show full history', icon: Icons.history, shortcut: 'Ctrl+H', onClick: openHistory });
    Menu.open({ x: e.clientX, y: e.clientY, items, minWidth: 260 });
  }

  function windowMenu(e) {
    e.preventDefault();
    const max = window.saturne.isMaximized();
    Menu.open({ x: e.clientX, y: e.clientY, items: [
      { label: 'New tab', icon: Icons.plus, shortcut: 'Ctrl+T', onClick: () => newTab() },
      { label: 'New space…', icon: Icons.space, onClick: newSpace },
      { label: 'Reopen closed tab', icon: Icons.history, shortcut: 'Ctrl+Shift+T', disabled: !S.closed.length, onClick: reopenClosed },
      { sep: true },
      { label: 'Expanded sidebar', checked: S.settings.sidebarOpen, shortcut: 'Ctrl+Shift+S', onClick: toggleSidebar },
      { label: 'Show bookmarks bar', checked: S.settings.showBookmarks, onClick: () => { S.settings.showBookmarks = !S.settings.showBookmarks; applySettings(); Store.save(); } },
      { sep: true },
      { label: 'Minimize', icon: Icons.minimize, onClick: () => window.saturne.minimize() },
      { label: max ? 'Restore' : 'Maximize', icon: max ? Icons.restore : Icons.maximize, onClick: () => window.saturne.toggleMaximize() },
      { label: 'Close Saturne', icon: Icons.close, danger: true, onClick: async () => { await Store.saveNow(); window.saturne.close(); } },
    ] });
  }

  function setupContextMenus() {
    $('btn-back').addEventListener('contextmenu', (e) => historyMenu(-1, e));
    $('btn-forward').addEventListener('contextmenu', (e) => historyMenu(1, e));
    $('btn-reload').addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      const r = currentTabId && rt.get(currentTabId);
      const wv = r && r.wv;
      Menu.open({ x: e.clientX, y: e.clientY, items: [
        { label: 'Reload', icon: Icons.reload, shortcut: 'Ctrl+R', disabled: !wv, onClick: () => wv.reload() },
        { label: 'Hard reload (ignore cache)', icon: Icons.reload, shortcut: 'Ctrl+Shift+R', disabled: !wv, onClick: () => wv.reloadIgnoringCache() },
        { label: 'Stop loading', icon: Icons.stop, disabled: !(wv && r.loading), onClick: () => wv.stop() },
        { sep: true },
        { label: 'Reload all tabs in space', icon: Icons.reload, onClick: () => flatTabs(space()).forEach((t) => { const x = rt.get(t.id); if (x && x.wv) x.wv.reload(); }) },
      ] });
    });
    $('btn-home').addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      Menu.open({ x: e.clientX, y: e.clientY, items: [
        { label: 'Go home', icon: Icons.home, shortcut: 'Alt+Home', onClick: goHome },
        { label: 'Open home in new tab', icon: Icons.plus, onClick: () => newTab() },
        { label: 'Customize home page', icon: Icons.palette, onClick: () => { if (!isHome(currentTab())) newTab(); setTimeout(() => Home.openCustomize(), 60); } },
      ] });
    });
    $('btn-copy-url').addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      const t = currentTab();
      const ok = t && !isHome(t);
      Menu.open({ x: e.clientX, y: e.clientY, items: [
        { label: 'Copy link', icon: Icons.copy, disabled: !ok, onClick: () => { window.saturne.copyText(t.url); UI.toast('Link copied'); } },
        { label: 'Copy as Markdown link', icon: Icons.code, disabled: !ok, onClick: () => { window.saturne.copyText(`[${t.title}](${t.url})`); UI.toast('Markdown link copied'); } },
        { label: 'Bookmark this page', icon: Icons.star, shortcut: 'Ctrl+D', disabled: !ok, onClick: () => toggleBookmark(t) },
        { label: 'Add to favorites', icon: Icons.pin, disabled: !ok, onClick: () => addToFavorites(t) },
      ] });
    });
    $('space-name').addEventListener('contextmenu', spaceMenu);
    $('btn-downloads').addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      Menu.open({ x: e.clientX, y: e.clientY, items: [
        { label: 'Show downloads', icon: Icons.download, onClick: () => openDownloads() },
        { label: 'Open downloads folder', icon: Icons.folderOpen, onClick: () => window.saturne.openDownloadsFolder() },
        { label: 'Clear list', icon: Icons.trash, disabled: ![...downloads.values()].some((d) => d.state !== 'progressing'), onClick: () => { for (const [k, d] of downloads) if (d.state !== 'progressing') downloads.delete(k); } },
      ] });
    });
    $('btn-new-space').addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      Menu.open({ x: e.clientX, y: e.clientY, items: [
        { label: 'New space…', icon: Icons.space, onClick: newSpace },
        { label: 'New folder', icon: Icons.folder, onClick: () => newFolder() },
        { label: 'New tab', icon: Icons.plus, shortcut: 'Ctrl+T', onClick: () => newTab() },
      ] });
    });
    $('bookmarks').addEventListener('contextmenu', (e) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      const t = currentTab();
      Menu.open({ x: e.clientX, y: e.clientY, items: [
        { label: 'Add bookmark…', icon: Icons.plus, onClick: () => editBookmark(null) },
        { label: 'Bookmark this page', icon: Icons.star, shortcut: 'Ctrl+D', disabled: !t || isHome(t), onClick: () => toggleBookmark(t) },
        { sep: true },
        { label: 'Hide bookmarks bar', icon: Icons.x, onClick: () => { S.settings.showBookmarks = false; applySettings(); Store.save(); } },
      ] });
    });
    $('devtools-panel').querySelector('.dt-head').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      Menu.open({ x: e.clientX, y: e.clientY, items: [
        { label: 'Dock to the bottom', checked: DevTools.dock === 'bottom', onClick: () => { S.settings.devtoolsDock = 'bottom'; Store.save(); DevTools.layout(); } },
        { label: 'Dock to the right', checked: DevTools.dock === 'right', onClick: () => { S.settings.devtoolsDock = 'right'; Store.save(); DevTools.layout(); } },
        { sep: true },
        { label: 'Close developer tools', icon: Icons.x, shortcut: 'F12', onClick: () => DevTools.close() },
      ] });
    });
    // fallback: text fields everywhere, and the top bar
    document.addEventListener('contextmenu', (e) => {
      if (e.defaultPrevented) return;
      const el = e.target;
      if (el.matches && el.matches('input, textarea')) return textMenu(el, e);
      if (el.closest('#topbar')) return windowMenu(e);
      e.preventDefault();
    });
  }

  // ======================= top bar =======================
  function updateChrome() {
    const t = currentTab();
    const r = currentTabId && rt.get(currentTabId);
    const wv = r && r.wv;
    const input = $('url-input');
    if (document.activeElement !== input) input.value = !t || isHome(t) ? '' : (r && r.failedUrl) || t.url;
    let canBack = false, canFwd = false;
    try { canBack = !!(wv && wv.canGoBack()); canFwd = !!(wv && wv.canGoForward()); } catch {}
    $('btn-back').disabled = !canBack;
    $('btn-forward').disabled = !canFwd;
    const loading = !!(r && r.loading && wv);
    $('btn-reload').innerHTML = loading ? Icons.stop : Icons.reload;
    $('btn-reload').dataset.tip = loading ? 'Stop' : 'Reload  (Ctrl+R)';
    $('btn-reload').disabled = !wv;
    $('urlbar').classList.toggle('loading', loading);
    document.title = t && !isHome(t) ? `${t.title} — Saturne` : 'Saturne';
    if (window.Features) Features.sync();
  }

  function setupTopbar() {
    $('btn-sidebar').innerHTML = Icons.sidebar;
    $('btn-back').innerHTML = Icons.back;
    $('btn-forward').innerHTML = Icons.forward;
    $('btn-home').innerHTML = Icons.home;
    $('btn-home').onclick = goHome;
    $('btn-reload').innerHTML = Icons.reload;
    $('btn-copy-url').innerHTML = Icons.link;
    $('btn-more').innerHTML = Icons.more;
    $('btn-min').innerHTML = Icons.minimize;
    $('btn-close').innerHTML = Icons.close;
    $('btn-downloads').insertAdjacentHTML('afterbegin', Icons.download);
    $('btn-new-space').innerHTML = Icons.plus;
    $('space-name').querySelector('.chev').innerHTML = Icons.chevDown;

    const setMax = (m) => { $('btn-max').innerHTML = m ? Icons.restore : Icons.maximize; $('btn-max').dataset.tip = m ? 'Restore' : 'Maximize'; };
    setMax(window.saturne.isMaximized());
    window.saturne.onMaximized(setMax);
    $('btn-min').onclick = () => window.saturne.minimize();
    $('btn-max').onclick = () => window.saturne.toggleMaximize();
    $('btn-close').onclick = async () => { await Store.saveNow(); window.saturne.close(); };
    $('btn-more').onclick = mainMenu;

    $('btn-sidebar').onclick = toggleSidebar;
    $('btn-back').onclick = () => { const w = currentWv(); if (w && w.canGoBack()) w.goBack(); };
    $('btn-forward').onclick = () => { const w = currentWv(); if (w && w.canGoForward()) w.goForward(); };
    $('btn-reload').onclick = () => {
      const r = currentTabId && rt.get(currentTabId);
      if (!r || !r.wv) return;
      if (r.loading) r.wv.stop();
      else if (r.failedUrl) load(r.wv, r.failedUrl);
      else r.wv.reload();
    };
    $('btn-copy-url').onclick = () => {
      const t = currentTab();
      if (!t || isHome(t)) return;
      window.saturne.copyText(t.url); UI.toast('Link copied to clipboard');
    };

    const input = $('url-input');
    input.addEventListener('focus', () => setTimeout(() => input.select(), 0));
    input.addEventListener('blur', () => setTimeout(updateChrome, 120));
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { updateChrome(); input.blur(); const w = currentWv(); if (w) w.focus(); } });
    attachSuggest(input, {
      anchor: $('urlbar'),
      getItems: suggestions,
      onPick: (it) => { input.blur(); navigate(it.url || Store.resolveInput(it.raw)); },
    });

    $('space-name').onclick = spaceMenu;
    $('btn-new-space').onclick = newSpace;
    $('btn-downloads').onclick = () => openDownloads();
    $('tab-scroll').addEventListener('contextmenu', (e) => {
      if (e.target.closest('.row')) return;
      e.preventDefault();
      Menu.open({ x: e.clientX, y: e.clientY, items: [
        { label: 'New tab', icon: Icons.plus, shortcut: 'Ctrl+T', onClick: () => newTab() },
        { label: 'New folder', icon: Icons.folder, onClick: newFolder },
        { sep: true },
        { label: 'Unload inactive tabs', icon: Icons.unload, onClick: () => flatTabs(space()).forEach((t) => t.id !== currentTabId && unloadTab(t.id)) },
      ] });
    });
    $('tab-scroll').addEventListener('scroll', hidePreview, true);
  }

  /** autocomplete items for the address bar & home search */
  function suggestions(q) {
    q = q.trim();
    if (!q) return [];
    const eng = Store.SEARCH_ENGINES[S.settings.searchEngine] || Store.SEARCH_ENGINES.google;
    const resolved = Store.resolveInput(q);
    const isUrl = !resolved.startsWith(eng.url);
    const out = [];
    if (isUrl) out.push({ label: resolved, sub: 'Open', icon: Icons.globe, url: resolved });
    out.push({ label: q, sub: `Search with ${eng.name}`, icon: Icons.search, url: eng.url + encodeURIComponent(q) });
    const ql = q.toLowerCase();
    const seen = new Set(out.map((o) => o.url));
    const add = (url, title, fav, sub) => {
      if (seen.has(url) || out.length >= 8) return;
      seen.add(url);
      out.push({ label: title || url, sub, img: fav || Store.faviconFor(url), url });
    };
    S.bookmarks.forEach((b) => { if ((b.title + ' ' + b.url).toLowerCase().includes(ql)) add(b.url, b.title, b.favicon, 'Bookmark'); });
    S.history.forEach((x) => { if ((x.title + ' ' + x.url).toLowerCase().includes(ql)) add(x.url, x.title, x.favicon, host(x.url)); });
    return out;
  }

  // ======================= bookmarks bar =======================
  function renderBookmarks() {
    const bar = $('bookmarks');
    bar.innerHTML = '';
    if (!S.bookmarks.length) bar.append(h('span.bm-empty', { text: 'Bookmarks appear here — press Ctrl+D on a page' }));
    S.bookmarks.forEach((b) => {
      const img = h('img', { src: b.favicon || Store.faviconFor(b.url) });
      img.onerror = () => img.replaceWith(h('span', { html: Icons.globe, style: { width: '15px', height: '15px', display: 'grid' } }));
      const el = h('button.bm', { 'data-tip': b.url }, img, h('span', { text: b.title }));
      el.onclick = (e) => (e.ctrlKey ? newTab(b.url, { background: true }) : navigate(b.url));
      el.onauxclick = (e) => { if (e.button === 1) newTab(b.url, { background: true }); };
      el.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        Menu.open({ x: e.clientX, y: e.clientY, items: [
          { label: 'Open', icon: Icons.open, onClick: () => navigate(b.url) },
          { label: 'Open in new tab', icon: Icons.plus, onClick: () => newTab(b.url) },
          { label: 'Edit…', icon: Icons.pencil, onClick: () => editBookmark(b) },
          { label: 'Copy link', icon: Icons.copy, onClick: () => window.saturne.copyText(b.url) },
          { sep: true },
          { label: 'Delete', icon: Icons.trash, danger: true, onClick: () => { S.bookmarks.splice(S.bookmarks.indexOf(b), 1); renderBookmarks(); Store.save(); } },
        ] });
      };
      bar.append(el);
    });
  }

  async function editBookmark(b) {
    const res = await UI.prompt({ title: b ? 'Edit bookmark' : 'Add bookmark', fields: [
      { key: 'title', label: 'Name', value: b ? b.title : '' },
      { key: 'url', label: 'Address', icon: Icons.link, value: b ? b.url : '' },
    ] });
    if (!res || !res.url) return;
    const url = Store.resolveInput(res.url);
    if (b) Object.assign(b, { title: res.title || host(url), url, favicon: b.url === url ? b.favicon : Store.faviconFor(url) });
    else S.bookmarks.push({ id: Store.uid(), title: res.title || host(url), url, favicon: Store.faviconFor(url) });
    renderBookmarks(); Store.save();
  }

  function toggleBookmark(tab) {
    tab = tab || currentTab();
    if (!tab || isHome(tab)) return;
    const i = S.bookmarks.findIndex((b) => b.url === tab.url);
    if (i >= 0) { S.bookmarks.splice(i, 1); UI.toast('Bookmark removed'); }
    else { S.bookmarks.push({ id: Store.uid(), url: tab.url, title: tab.title || host(tab.url), favicon: tab.favicon }); UI.toast('Page bookmarked'); }
    renderBookmarks(); Store.save();
  }

  // ======================= downloads =======================
  let dlPanel = null;
  function fmtBytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
    while (n >= 1024 && i < 3) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + ' ' + u[i];
  }
  function buildDlPanel(el) {
    el.innerHTML = '';
    el.append(h('div.dl-head', null, h('b', { text: 'Downloads' }),
      h('button.s-btn.ghost', { text: 'Open folder', style: { height: '26px', padding: '0 8px' }, onclick: () => window.saturne.openDownloadsFolder() })));
    const items = [...downloads.values()].reverse();
    if (!items.length) el.append(h('div.dl-empty', { text: 'No downloads yet' }));
    items.forEach((d) => {
      const pct = d.total ? Math.round((d.received / d.total) * 100) : 0;
      const status = d.state === 'progressing' ? `${fmtBytes(d.received)}${d.total ? ' of ' + fmtBytes(d.total) : ''}`
        : d.state === 'completed' ? `Completed · ${fmtBytes(d.total || d.received)}` : d.state === 'cancelled' ? 'Cancelled' : 'Failed';
      const row = h('div.dl-item', null,
        h('span.dli', { html: Icons.file }),
        h('div.dlb', null, h('div.dln', { text: d.filename }), h('div.dls', { text: status }),
          d.state === 'progressing' ? h('div.dl-bar', null, h('i', { style: { width: pct + '%' } })) : null),
        d.state === 'progressing'
          ? h('button.gear-btn', { html: Icons.x, 'data-tip': 'Cancel', onclick: (e) => { e.stopPropagation(); window.saturne.cancelDownload(d.id); } })
          : d.state === 'completed' ? h('button.gear-btn', { html: Icons.folderOpen, 'data-tip': 'Show in folder', onclick: (e) => { e.stopPropagation(); window.saturne.showItem(d.path); } }) : null);
      if (d.state === 'completed') row.onclick = () => window.saturne.openPath(d.path);
      el.append(row);
    });
  }
  function openDownloads() {
    const btn = $('btn-downloads');
    if (Menu.justClosed(btn)) return;
    const panel = h('div.dl-panel');
    buildDlPanel(panel);
    dlPanel = panel;
    Menu.open({ anchor: btn, items: [{ custom: panel }], onClose: () => { dlPanel = null; } });
  }
  window.saturne.onDownload((d) => {
    const isNew = !downloads.has(d.id);
    downloads.set(d.id, d);
    if (isNew) UI.toast(`Downloading ${d.filename}`);
    if (d.state === 'completed' && downloads.get(d.id)._notified !== true) { d._notified = true; UI.toast(`Downloaded ${d.filename}`); }
    $('btn-downloads').classList.toggle('has-active', [...downloads.values()].some((x) => x.state === 'progressing'));
    if (dlPanel) buildDlPanel(dlPanel);
  });

  // ======================= history =======================
  function openHistory() {
    UI.modal({
      title: 'History', wide: true,
      body(box, close) {
        const listInner = h('div');
        const list = CustomScroll.wrap(listInner, 'history-list');
        const draw = (q = '') => {
          listInner.innerHTML = '';
          const ql = q.toLowerCase();
          let day = '';
          const items = S.history.filter((x) => !ql || (x.title + ' ' + x.url).toLowerCase().includes(ql)).slice(0, 400);
          if (!items.length) listInner.append(h('div.dl-empty', { text: q ? 'No results' : 'Your history is empty' }));
          items.forEach((x) => {
            const d = new Date(x.time);
            const label = d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            if (label !== day) { day = label; listInner.append(h('div.h-day', { text: label })); }
            const img = h('img', { src: x.favicon || Store.faviconFor(x.url) });
            img.onerror = () => (img.style.visibility = 'hidden');
            const row = h('div.h-item', null,
              h('span.htime', { text: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) }), img,
              h('span.ht', { text: x.title || x.url }), h('span.hu', { text: host(x.url) }),
              h('button.gear-btn', { html: Icons.x, 'data-tip': 'Remove', onclick: (e) => { e.stopPropagation(); S.history.splice(S.history.indexOf(x), 1); Store.save(); draw(fld.input.value); Home.refreshRecent(); } }));
            row.onclick = () => { close(); newTab(x.url); };
            listInner.append(row);
          });
        };
        const fld = UI.field({ placeholder: 'Search history', onInput: draw });
        box.append(fld.el, list,
          h('div.actions', null,
            h('button.s-btn.danger', { text: 'Clear browsing history', onclick: async () => {
              if (await UI.confirm({ title: 'Clear browsing history?', message: 'This removes every entry, including the recently visited sites on the home page.', ok: 'Clear', danger: true })) {
                S.history.length = 0; Store.save(); draw(); Home.refreshRecent();
              }
            } }),
            h('button.s-btn.primary', { text: 'Done', onclick: close })));
        draw();
        setTimeout(() => fld.input.focus(), 30);
      },
    });
  }

  // ======================= default browser & printing =======================
  let isDefault = false;
  const refreshDefault = () => window.saturne.isDefaultBrowser().then((v) => { isDefault = v; }).catch(() => {});
  refreshDefault();
  window.addEventListener('focus', refreshDefault); // the user may have changed it in Windows settings
  async function makeDefault() {
    const r = await window.saturne.makeDefaultBrowser();
    if (r && r.error) return UI.toast('Couldn’t register Saturne: ' + r.error, 5000);
    UI.modal({
      title: 'Almost done',
      body(box, close) {
        box.append(
          UI.h('p', { text: 'Windows opened its “Default apps” page for Saturne. Click “Set default” at the top of that page (or choose Saturne for HTTP and HTTPS).' }),
          UI.h('p', { text: 'Links you click in other apps will then open in Saturne.' }),
          UI.h('div.actions', null, UI.h('button.s-btn.primary', { text: 'OK', onclick: () => { close(); refreshDefault(); } })));
      },
    });
  }
  function printPage() {
    const wv = currentWv();
    if (wv && !isHome(currentTab())) { try { wv.print(); } catch {} }
  }

  // ======================= find in page (Ctrl+F) =======================
  const Find = {
    el: null, input: null, count: null, tabId: null,
    build() {
      if (this.el) return;
      this.input = UI.h('input', { type: 'text', placeholder: 'Find in page', spellcheck: 'false', autocomplete: 'off' });
      this.count = UI.h('span.find-count');
      const btn = (icon, tip, fn) => UI.h('button.icon-btn', { html: icon, 'data-tip': tip, onclick: fn });
      this.el = UI.h('div#findbar', null,
        UI.h('span.find-ico', { html: Icons.search }), this.input, this.count,
        btn(Icons.chevDown, 'Previous  (Shift+Enter)', () => this.step(false)),
        btn(Icons.chevDown, 'Next  (Enter)', () => this.step(true)),
        btn(Icons.x, 'Close  (Esc)', () => this.close()));
      this.el.children[3].classList.add('up');
      this.input.addEventListener('input', () => this.search());
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.step(!e.shiftKey); }
        else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      });
      $('content').append(this.el);
    },
    wv() { const r = this.tabId && rt.get(this.tabId); return r && r.wv; },
    open() {
      const wv = currentWv();
      if (!wv || isHome(currentTab())) return;
      this.build();
      if (this.tabId && this.tabId !== currentTabId) this.stop();
      this.tabId = currentTabId;
      this.el.classList.add('open');
      this.input.focus(); this.input.select();
      if (this.input.value) this.search();
    },
    search() {
      const wv = this.wv();
      if (!wv) return;
      const q = this.input.value;
      if (!q) { wv.stopFindInPage('clearSelection'); this.show(null); return; }
      wv.findInPage(q);
    },
    step(forward) {
      const wv = this.wv(), q = this.input && this.input.value;
      if (!wv || !q) return;
      wv.findInPage(q, { forward, findNext: true });
    },
    result(tabId, res) {
      if (tabId !== this.tabId || !this.el) return;
      if (res.finalUpdate || res.matches) this.show(res);
    },
    show(res) {
      this.count.textContent = !res ? '' : res.matches ? `${res.activeMatchOrdinal}/${res.matches}` : 'No results';
      this.el.classList.toggle('none', !!res && !res.matches);
    },
    stop() { const wv = this.wv(); if (wv) { try { wv.stopFindInPage('keepSelection'); } catch {} } },
    close() {
      if (!this.el || !this.el.classList.contains('open')) return;
      this.stop();
      this.el.classList.remove('open');
      const wv = this.wv(); this.tabId = null;
      if (wv) wv.focus();
    },
    // called whenever the visible tab changes
    sync() { if (this.tabId && this.tabId !== currentTabId) this.close(); },
  };

  // ======================= crashed / frozen pages =======================
  const Crash = {
    el: null,
    mark(tabId, kind) { // kind: 'crashed' | 'frozen' | null
      const r = rt.get(tabId);
      if (!r) return;
      r.crashed = kind;
      if (kind === 'crashed') r.loading = false;
      refreshTab(tabId);
      if (tabId === currentTabId) this.sync();
    },
    sync() {
      const t = currentTab(), r = currentTabId && rt.get(currentTabId);
      const kind = !isHome(t) && r && r.wv ? r.crashed : null;
      if (!kind) { if (this.el) this.el.classList.remove('open'); return; }
      if (!this.el) { this.el = UI.h('div#crashpage'); $('content').append(this.el); }
      const crashed = kind === 'crashed';
      this.el.replaceChildren(UI.h('div.crash-box', null,
        UI.h('div.crash-ico', { html: crashed ? Icons.info : Icons.unload }),
        UI.h('h1', { text: crashed ? 'This page crashed' : 'This page isn’t responding' }),
        UI.h('p.crash-host', { text: host(t.url) }),
        UI.h('p', { text: crashed ? 'The rest of Saturne is fine. Reload to open the page again.' : 'You can wait for it to respond, or reload it.' }),
        UI.h('div.actions', null,
          crashed ? null : UI.h('button.s-btn.ghost', { text: 'Wait', onclick: () => this.mark(currentTabId, null) }),
          UI.h('button.s-btn.primary', { html: Icons.reload + '<span>Reload</span>', onclick: () => this.reload(currentTabId) }))));
      this.el.classList.add('open');
    },
    reload(tabId) {
      const loc = locate(tabId);
      if (!loc) return;
      unloadTab(tabId);
      R(tabId).crashed = null;
      createWebview(loc.tab);
      showView(); updateChrome();
    },
  };

  // ======================= site permissions =======================
  const PERM_TEXT = {
    camera: 'Use your camera', microphone: 'Use your microphone', geolocation: 'Know your location',
    notifications: 'Show notifications', 'clipboard-read': 'See text and images copied to the clipboard',
    midi: 'Use your MIDI devices', midiSysex: 'Control your MIDI devices', 'idle-detection': 'Know when you’re actively using this device',
    'window-management': 'Manage windows on all your displays',
  };
  const PERM_SHORT = { camera: 'Camera', microphone: 'Microphone', geolocation: 'Location', notifications: 'Notifications', 'clipboard-read': 'Clipboard',
    midi: 'MIDI', midiSysex: 'MIDI control', 'idle-detection': 'Activity', 'window-management': 'Window management' };
  const Perms = {
    queue: [], el: null,
    tabOf(wcId) { for (const [id, r] of rt) if (r.wcId === wcId && r.wv) return id; return null; },
    ask(req) { this.queue.push(req); this.sync(); },
    answer(req, allow, remember) {
      this.queue = this.queue.filter((x) => x !== req);
      window.saturne.answerPermission(req.id, allow, remember);
      this.sync();
    },
    sync() {
      // requests from tabs that were closed or unloaded are refused
      for (const q of [...this.queue]) if (q.wcId != null && this.tabOf(q.wcId) == null) this.answer(q, false, false);
      const cur = currentTabId && rt.get(currentTabId);
      const req = this.queue.find((q) => cur && cur.wcId != null && q.wcId === cur.wcId);
      if (!req) { if (this.el) this.el.classList.remove('open'); return; }
      if (!this.el) { this.el = UI.h('div#permprompt'); $('content').append(this.el); }
      const remember = UI.h('input', { type: 'checkbox', checked: true });
      this.el.replaceChildren(
        UI.h('div.perm-head', null, UI.h('span.perm-ico', { html: Icons.globe }), UI.h('b', { text: host(req.origin) }), UI.h('span', { text: ' wants to' })),
        UI.h('ul', null, req.keys.map((k) => UI.h('li', { text: PERM_TEXT[k] || k }))),
        UI.h('label.perm-remember', null, remember, UI.h('span', { text: 'Remember my choice for this site' })),
        UI.h('div.actions', null,
          UI.h('button.s-btn.ghost', { text: 'Block', onclick: () => this.answer(req, false, remember.checked) }),
          UI.h('button.s-btn.primary', { text: 'Allow', onclick: () => this.answer(req, true, remember.checked) })));
      this.el.classList.add('open');
    },
    manage() {
      UI.modal({
        title: 'Site permissions', wide: true,
        body(box, close) {
          const list = UI.h('div.perm-list');
          const draw = () => {
            const all = window.saturne.listPermissions() || {};
            const sites = Object.keys(all).sort();
            list.replaceChildren(...(sites.length ? sites.map((o) => UI.h('div.perm-row', null,
              UI.h('b', { text: host(o) }),
              UI.h('div.perm-chips', null, Object.entries(all[o]).map(([k, v]) => UI.h('span.perm-chip' + (v ? '.on' : '.off'), null,
                UI.h('span', { text: (PERM_SHORT[k] || k) + (v ? ' · allowed' : ' · blocked') }),
                UI.h('button', { html: Icons.x, title: 'Forget', onclick: () => { window.saturne.forgetPermission(o, k); draw(); } })))),
              UI.h('button.s-btn.ghost', { text: 'Reset', onclick: () => { window.saturne.forgetPermission(o, null); draw(); } })))
              : [UI.h('p', { text: 'No saved choices yet. When a site asks for your camera, microphone, location or notifications, your answer shows up here.' })]));
          };
          draw();
          box.append(list, UI.h('div.actions', null, UI.h('button.s-btn.primary', { text: 'Done', onclick: close })));
        },
      });
    },
  };
  window.saturne.onPermission((req) => Perms.ask(req));

  // ======================= search open tabs (Ctrl+Shift+A) =======================
  // also used to choose the second tab of a split view ({ pick: true })
  const TabSearch = {
    back: null,
    open({ pick = false } = {}) {
      if (this.back) return this.close();
      Menu.closeAll();
      const input = UI.h('input', { type: 'text', placeholder: pick ? 'Choose the tab to show next to this one, or type an address' : 'Search your open tabs', spellcheck: 'false', autocomplete: 'off' });
      const list = UI.h('div.ts-list');
      const box = UI.h('div.ts-box', null,
        UI.h('div.ts-field', null, UI.h('span.ts-ico', { html: pick ? Icons.split : Icons.search }), input, UI.h('span.ts-key', { text: 'Esc' })), list);
      this.back = UI.h('div.ts-back', null, box);
      this.back.addEventListener('mousedown', (e) => { if (e.target === this.back) this.close(); });
      let items = [], sel = 0;
      const all = () => {
        const out = [];
        const add = (t, sp, fav) => {
          if (pick && (isHome(t) || t.id === currentTabId || fav || sp.id !== S.activeSpaceId)) return;
          out.push({ t, sp, fav });
        };
        // current space first
        const spaces = [space(), ...S.spaces.filter((s) => s.id !== S.activeSpaceId)];
        spaces.forEach((sp) => flatTabs(sp).forEach((t) => add(t, sp, false)));
        if (!pick) S.favorites.forEach((f) => { if (f.tab) add(f.tab, { id: '', name: 'Favorites', color: '' }, true); });
        // this space first, then open tabs before unloaded ones, most recently used first
        const rank = (x) => { const r = rt.get(x.t.id); return [x.sp.id === S.activeSpaceId ? 0 : 1, r && r.wv ? 0 : 1, -((r && r.lastActive) || 0)]; };
        return out.map((x) => ({ x, k: rank(x) })).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2]).map((o) => o.x);
      };
      const draw = () => {
        const q = input.value.trim().toLowerCase();
        const words = q.split(/\s+/).filter(Boolean);
        items = all().filter(({ t, sp }) => {
          const hay = `${isHome(t) ? 'new tab' : t.title} ${t.url} ${sp.name}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        });
        if (pick && q) items.push({ url: Store.resolveInput(input.value) });
        sel = UI.clamp(sel, 0, Math.max(0, items.length - 1));
        list.replaceChildren(...(items.length ? items.map((it, i) => {
          if (it.url) {
            return UI.h('button.ts-item' + (i === sel ? '.on' : ''), { onclick: () => choose(i) },
              UI.h('span.ts-fav', { html: Icons.globe }), UI.h('span.ts-t', { text: `Open “${input.value.trim()}” next to this tab` }), UI.h('span.ts-sp', { text: 'New tab' }));
          }
          const { t, sp, fav } = it;
          const r = rt.get(t.id);
          const icon = UI.h('span.ts-fav');
          if (isHome(t)) icon.innerHTML = Icons.saturn;
          else if (t.favicon) { const img = UI.h('img', { src: t.favicon }); img.onerror = () => { icon.innerHTML = Icons.globe; }; icon.append(img); }
          else icon.innerHTML = Icons.globe;
          return UI.h('button.ts-item' + (i === sel ? '.on' : '') + (t.id === currentTabId ? '.cur' : '') + (r && r.wv || isHome(t) ? '' : '.unl'), { onclick: () => choose(i), onmousemove: () => { if (sel !== i) { sel = i; mark(); } } },
            icon,
            UI.h('span.ts-txt', null, UI.h('span.ts-t', { text: isHome(t) ? 'New Tab' : t.title || t.url }), UI.h('span.ts-u', { text: isHome(t) ? 'Home' : host(t.url) })),
            r && r.audible ? UI.h('span.ts-audio', { html: Icons.speaker }) : null,
            UI.h('span.ts-sp', null, sp.color ? UI.h('i', { style: { background: sp.color } }) : UI.h('span', { html: Icons.star }), UI.h('span', { text: fav ? 'Favorite' : sp.name })));
        }) : [UI.h('div.ts-empty', { text: pick ? 'No other web page open in this space — type an address' : 'No open tab matches' })]));
      };
      const mark = () => [...list.children].forEach((x, i) => x.classList.toggle('on', i === sel));
      const choose = (i) => {
        const it = items[i];
        if (!it) return;
        this.close();
        if (it.url) {
          openSplit(newTab(it.url, { background: true }).id);
        } else if (pick) openSplit(it.t.id);
        else activateTab(it.t.id);
      };
      input.addEventListener('input', () => { sel = 0; draw(); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length);
          mark(); const b = list.children[sel]; if (b) b.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
        else if (e.key === 'Tab') e.preventDefault();
      });
      draw();
      $('layer').append(this.back);
      setTimeout(() => input.focus(), 20);
    },
    close() {
      const b = this.back;
      if (!b) return;
      this.back = null;
      b.classList.add('leaving');
      setTimeout(() => b.remove(), 140);
    },
  };

  // ======================= keyboard shortcuts =======================
  function handleShortcut(k) {
    const key = k.key.toLowerCase();
    const c = k.control, sh = k.shift, alt = k.alt;
    const wv = currentWv();
    if (c && sh && key === 'a') TabSearch.open();
    else if (c && sh && key === 'x') Features.screenshot('area');
    else if (key === 'f9') Features.toggleReader();
    else if (c && sh && key === 't') reopenClosed();
    else if (c && sh && key === 's') toggleSidebar();
    else if ((c && sh && key === 'i') || key === 'f12') DevTools.toggle();
    else if (alt && key === 'home') goHome();
    else if (c && key === 't') newTab();
    else if (c && key === 'w') { if (currentTabId) closeTabAnimated(currentTabId); }
    else if (c && key === 'l') { const i = $('url-input'); i.focus(); i.select(); }
    else if (c && sh && key === 'r') { if (wv) wv.reloadIgnoringCache(); }
    else if ((c && key === 'r') || key === 'f5') { if (wv) wv.reload(); }
    else if (c && key === 'd') toggleBookmark();
    else if (c && key === 'h') openHistory();
    else if (c && !sh && key === 'f') Find.open();
    else if (c && !sh && key === 'p') printPage();
    else if (key === 'f3') { if (Find.tabId === currentTabId && Find.input && Find.input.value) Find.step(!sh); else Find.open(); }
    else if (c && key === 'tab') {
      const tabs = flatTabs(space());
      if (!tabs.length) return true;
      const i = tabs.findIndex((t) => t.id === currentTabId);
      activateTab(tabs[(i + (sh ? -1 : 1) + tabs.length) % tabs.length].id);
    } else if (c && /^[1-9]$/.test(key)) { const sp = S.spaces[Number(key) - 1]; if (sp) switchSpace(sp.id); }
    else if (alt && key === 'arrowleft') { if (wv && wv.canGoBack()) wv.goBack(); }
    else if (alt && key === 'arrowright') { if (wv && wv.canGoForward()) wv.goForward(); }
    else if (c && (key === '=' || key === '+')) zoom(1);
    else if (c && key === '-') zoom(-1);
    else if (c && key === '0') zoom(0);
    else return false;
    return true;
  }
  window.saturne.onShortcut(handleShortcut);
  document.addEventListener('keydown', (e) => {
    const k = { key: e.key, control: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey };
    const inText = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    const keyL = e.key.toLowerCase();
    // let text fields keep their own Ctrl+A/C/V/X/Z etc.
    if (inText && k.control && !k.shift && ['a', 'c', 'v', 'x', 'z', 'y'].includes(keyL)) return;
    if (inText && k.alt) return;
    if (!k.control && !k.alt && !['f5', 'f12', 'f3', 'f9'].includes(keyL)) return;
    if (handleShortcut(k)) e.preventDefault();
  });

  // events from main
  window.saturne.onOpenTab(({ url, background }) => newTab(url, { background }));
  window.saturne.onContextMenu(pageMenu);
  window.addEventListener('beforeunload', () => Store.saveNow());

  // ======================= boot =======================
  window.Browser = {
    navigate, newTab, applyTheme, suggestions, host, isHome, currentTab,
    openInNewTab: (url) => newTab(url),
    // used by automated tests / debugging
    internals: { renderSidebar, DevTools, newFolder, toggleSidebar, setFavorite, tabMenu, folderMenu, locate, toggleFolder, chooseFolderIcon, goHome, activateTab },
    // used by features.js (reader, translation, screenshots, passwords…)
    rt, currentWv, flatTabs, space, locate, activateTab, renderBookmarks, applySettings, makeDefault,
    get currentTabId() { return currentTabId; },
    tabOfWc(wcId) { for (const [id, r] of rt) if (r.wcId === wcId && r.wv) return id; return null; },
    split: { open: openSplit, close: closeSplit, pick: pickSplit, shown: shownSplit },
    TabSearch,
  };

  applyTheme();
  applySettings();
  setupTopbar();
  setupContextMenus();
  DevTools.init();
  CustomScroll.attach($('tab-scroll'));
  CustomScroll.attach($('customize-panel'));
  Home.init();
  renderBookmarks();
  renderSidebar();
  const sp = space();
  if (sp.activeTabId && locate(sp.activeTabId)) activateTab(sp.activeTabId, { focus: false });
  else { showView(); updateChrome(); }
  booted = true;
})();
