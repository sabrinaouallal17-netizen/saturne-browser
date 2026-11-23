// Saturne — persistent state (saved as JSON in the app's user data folder)
(function () {
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  const SEARCH_ENGINES = {
    google: { name: 'Google', url: 'https://www.google.com/search?q=' },
    duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
    bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
    brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
    ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=' },
  };

  const THEMES = {
    Graphite: { bg: '#2b2b2b', panel: '#333333', field: '#3a3a3a', text: '#ededed', accent: '#8fb0ff', card: '#f4f4f4' },
    Midnight: { bg: '#16181d', panel: '#1e2128', field: '#272b34', text: '#e6e9f0', accent: '#7c9cff', card: '#eef1f7' },
    Carbon: { bg: '#121212', panel: '#1b1b1b', field: '#252525', text: '#f2f2f2', accent: '#c6a4ff', card: '#f2f2f2' },
    Mocha: { bg: '#2e2925', panel: '#38322d', field: '#443d37', text: '#f1e9e1', accent: '#e8b37a', card: '#f7efe6' },
    Forest: { bg: '#1f2723', panel: '#27312c', field: '#313c36', text: '#e7efe9', accent: '#7fd1a3', card: '#eef5f0' },
    Light: { bg: '#e9e9eb', panel: '#f7f7f8', field: '#dedee2', text: '#1d1d20', accent: '#3d6df2', card: '#ffffff' },
  };

  const SPACE_COLORS = ['#8fb0ff', '#ff8fa3', '#7fd1a3', '#ffc94d', '#c6a4ff', '#5fd4e0', '#ff9f5a', '#b0b0b0'];

  const faviconFor = (url) => {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return '';
      return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;
    } catch { return ''; }
  };

  const mkTab = (url, title) => ({ type: 'tab', id: uid(), url, title: title || url, favicon: faviconFor(url) });

  function defaultHome() {
    return {
      wallpaper: { type: 'preset', value: 'aurora' },
      blur: 0,
      dim: 10,
      widgetOpacity: 55,
      widgetRadius: 16,
      widgets: {
        greeting: { enabled: false, x: 50, y: 14, scale: 1, name: '' },
        clock: { enabled: true, x: 50, y: 27, scale: 1, h24: true, seconds: false, showDate: true },
        search: { enabled: true, x: 50, y: 47, scale: 1 },
        recent: { enabled: true, x: 50, y: 72, scale: 1 },
        weather: { enabled: true, x: 87, y: 20, scale: 1, city: 'Paris', unit: 'c', lat: 48.8566, lon: 2.3522, label: 'Paris' },
        notes: { enabled: false, x: 13, y: 22, scale: 1, text: '' },
        analog: { enabled: false, x: 13, y: 76, scale: 1, numbers: true },
        calendar: { enabled: false, x: 87, y: 81, scale: 0.85, mondayFirst: true },
        links: { enabled: false, x: 50, y: 90, scale: 1, items: [
          { url: 'https://www.youtube.com/', title: 'YouTube' },
          { url: 'https://github.com/', title: 'GitHub' },
          { url: 'https://www.wikipedia.org/', title: 'Wikipedia' },
          { url: 'https://mail.google.com/', title: 'Gmail' },
        ] },
        todo: { enabled: false, x: 13, y: 47, scale: 1, items: [] },
        timer: { enabled: false, x: 87, y: 47, scale: 1, work: 25, rest: 5 },
        countdown: { enabled: false, x: 50, y: 62, scale: 1, label: 'New Year', date: `${new Date().getFullYear() + 1}-01-01` },
        worldclock: { enabled: false, x: 13, y: 14, scale: 1, zones: ['America/New_York', 'Asia/Tokyo'] },
        quote: { enabled: false, x: 50, y: 8, scale: 1 },
        battery: { enabled: false, x: 79, y: 9, scale: 1 },
      },
      images: [], // CustomIMG widgets: { id, src, x, y, scale, width, radius, opacity, rotate, shadow, link }
    };
  }

  function defaults() {
    const spaceId = uid();
    const socials = {
      type: 'folder', id: uid(), name: 'Socials', open: false,
      children: [
        mkTab('https://www.instagram.com/', 'Instagram'),
        mkTab('https://x.com/', 'X'),
        mkTab('https://discord.com/app', 'Discord'),
      ],
    };
    return {
      version: 1,
      settings: {
        searchEngine: 'google',
        unloadMinutes: 10,
        sidebarOpen: true,
        showBookmarks: true,
        webScrollbars: true,
        previewDelay: 3,
      },
      theme: { ...THEMES.Graphite },
      favorites: [{ id: uid(), url: '' }, { id: uid(), url: '' }, { id: uid(), url: '' }],
      bookmarks: [
        { id: uid(), url: 'https://claude.ai/code', title: 'Claude Code', favicon: 'https://www.google.com/s2/favicons?domain=claude.ai&sz=64' },
        { id: uid(), url: 'https://vscode.dev/', title: 'Visual Studio Code', favicon: 'https://www.google.com/s2/favicons?domain=code.visualstudio.com&sz=64' },
      ],
      spaces: [{ id: spaceId, name: 'Space', color: SPACE_COLORS[0], items: [socials], activeTabId: null }],
      activeSpaceId: spaceId,
      history: [],
      closed: [],
      home: defaultHome(),
    };
  }

  function merge(base, saved) {
    if (!saved || typeof saved !== 'object') return base;
    const out = { ...base, ...saved };
    out.settings = { ...base.settings, ...(saved.settings || {}) };
    out.theme = { ...base.theme, ...(saved.theme || {}) };
    const bh = base.home, sh = saved.home || {};
    out.home = { ...bh, ...sh, widgets: { ...bh.widgets } };
    for (const k in bh.widgets) out.home.widgets[k] = { ...bh.widgets[k], ...((sh.widgets || {})[k] || {}) };
    if (!Array.isArray(out.spaces) || !out.spaces.length) out.spaces = base.spaces;
    if (!out.spaces.find((s) => s.id === out.activeSpaceId)) out.activeSpaceId = out.spaces[0].id;
    return out;
  }

  const state = merge(defaults(), window.saturne.loadState());

  let saveT;
  const Store = {
    state, uid, mkTab, faviconFor, SEARCH_ENGINES, THEMES, SPACE_COLORS, defaultHome,
    save() {
      clearTimeout(saveT);
      saveT = setTimeout(() => window.saturne.saveState(state), 400);
    },
    saveNow() { clearTimeout(saveT); return window.saturne.saveState(state); },

    // turn what the user typed into a URL (or a search)
    resolveInput(text) {
      const t = (text || '').trim();
      if (!t) return null;
      if (/^(https?|file|about|data|view-source):/i.test(t)) return t;
      if (/^localhost(:\d+)?(\/|$)/i.test(t) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(t)) return 'http://' + t;
      if (!/\s/.test(t) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(t)) return 'https://' + t;
      const eng = SEARCH_ENGINES[state.settings.searchEngine] || SEARCH_ENGINES.google;
      return eng.url + encodeURIComponent(t);
    },

    addHistory(url, title, favicon) {
      if (!/^https?:/i.test(url)) return;
      const h = state.history;
      if (h[0] && h[0].url === url) { h[0].time = Date.now(); if (title) h[0].title = title; }
      else h.unshift({ url, title: title || url, favicon: favicon || faviconFor(url), time: Date.now() });
      if (h.length > 1000) h.length = 1000;
      Store.save();
    },
    updateHistoryTitle(url, title, favicon) {
      const e = state.history.find((x) => x.url === url);
      if (e) { if (title) e.title = title; if (favicon) e.favicon = favicon; Store.save(); }
    },
  };

  window.Store = Store;
})();
