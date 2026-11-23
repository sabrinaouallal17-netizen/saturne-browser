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
    wv.addEventListener('focus', () => Menu.closeAll());

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
    Object.assign(r, { wv: null, wcId: null, loading: false, audible: false, thumb: null, cssKey: null });
    refreshTab(id);
  }

  // auto-unload: tabs not used for N minutes are discarded (they turn gray)
  setInterval(() => {
    const mins = Number(S.settings.unloadMinutes);
    if (!mins) return;
    const now = Date.now();
    for (const [id, r] of rt) {
      if (!r.wv || id === currentTabId || r.audible) continue;
      if (now - r.lastActive > mins * 60000) unloadTab(id);
    }
  }, 5000);
  // keep a fresh thumbnail of the visible tab
  setInterval(() => { if (currentTabId) captureThumb(currentTabId); }, 30000);

  // ======================= tab actions =======================
  function showView() {
    const t = currentTab();
    for (const [id, r] of rt) if (r.wv) r.wv.classList.toggle('visible', id === currentTabId && !isHome(t));
    Home.show(isHome(t));
    document.body.classList.remove('page-fullscreen');
  }

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
      pickNeighbor(rest[pos] || rest[pos - 1] || null);
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
    if (DevTools.tabId === t.id) DevTools.close(false);
    const r = rt.get(t.id);
    if (r && r.wv) { r.wv.remove(); Object.assign(r, { wv: null, wcId: null, loading: false, audible: false, thumb: null, failedUrl: null }); }
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
    const ri = row.querySelector('.ri');
    const key = (r && r.loading && r.wv ? 'L' : '') + (isHome(tab) ? 'H' : tab.favicon);
    if (ri.dataset.key !== key) { ri.dataset.key = key; ri.innerHTML = ''; ri.append(tabIcon(tab)); }
    const title = isHome(tab) ? 'New Tab' : (tab.title || tab.url);
    const rt_ = row.querySelector('.rt');
    if (rt_.textContent !== title) rt_.textContent = title;
    if (app.classList.contains('compact')) row.dataset.tip = title; else delete row.dataset.tip;
    let au = row.querySelector('.audio');
    if (r && r.audible && !au) row.querySelector('.rx').before(h('span.audio', { html: Icons.speaker }));
    if (!(r && r.audible) && au) au.remove();
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
    Menu.open({
      anchor: btn, align: 'right', minWidth: 250,
      items: [
        { label: 'New tab', icon: Icons.plus, shortcut: 'Ctrl+T', onClick: () => newTab() },
        { label: 'New space…', icon: Icons.space, onClick: newSpace },
        { label: 'New folder', icon: Icons.folder, onClick: newFolder },
        { label: 'Reopen closed tab', icon: Icons.history, shortcut: 'Ctrl+Shift+T', disabled: !S.closed.length, onClick: reopenClosed },
        { sep: true },
        { label: bookmarked ? 'Remove bookmark' : 'Bookmark this page', icon: bookmarked ? Icons.starFill : Icons.star, shortcut: 'Ctrl+D', disabled: !onPage, onClick: () => toggleBookmark(t) },
        { label: 'Add to favorites', icon: Icons.pin, disabled: !onPage, onClick: () => addToFavorites(t) },
        {
          label: 'Zoom', icon: Icons.zoomIn, disabled: !onPage,
          submenu: [
            { label: 'Zoom in', icon: Icons.zoomIn, shortcut: 'Ctrl+=', keepOpen: true, onClick: () => zoom(1) },
            { label: 'Zoom out', icon: Icons.zoomOut, shortcut: 'Ctrl+-', keepOpen: true, onClick: () => zoom(-1) },
            { label: 'Reset zoom', icon: Icons.search, shortcut: 'Ctrl+0', onClick: () => zoom(0) },
          ],
        },
        { label: 'History', icon: Icons.history, shortcut: 'Ctrl+H', onClick: openHistory },
        { label: 'Downloads', icon: Icons.download, onClick: () => openDownloads() },
        { sep: true },
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
          ],
        },
        { label: DevTools.view ? 'Close developer tools' : 'Developer tools', icon: Icons.code, shortcut: 'F12', disabled: !(r && r.wv) && !DevTools.view, onClick: () => DevTools.toggle() },
        { sep: true },
        { label: 'About Saturne', icon: Icons.info, onClick: about },
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

  // ======================= keyboard shortcuts =======================
  function handleShortcut(k) {
    const key = k.key.toLowerCase();
    const c = k.control, sh = k.shift, alt = k.alt;
    const wv = currentWv();
    if (c && sh && key === 't') reopenClosed();
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
    if (!k.control && !k.alt && !['f5', 'f12'].includes(keyL)) return;
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
