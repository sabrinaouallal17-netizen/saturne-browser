// Saturne — customizable home page (wallpaper, colors, draggable widgets)
(function () {
  const S = Store.state;
  const $ = (id) => document.getElementById(id);
  const H = () => S.home;

  const WALLPAPERS = {
    aurora: 'radial-gradient(at 18% 22%, #5b6cff 0, transparent 52%), radial-gradient(at 82% 26%, #c86dd7 0, transparent 50%), radial-gradient(at 50% 95%, #23c4b8 0, transparent 55%), #1b1d2a',
    sunset: 'linear-gradient(160deg, #ff9a8b 0%, #ff6a88 45%, #6a4c93 100%)',
    ocean: 'linear-gradient(160deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
    dusk: 'linear-gradient(180deg, #2c3e50 0%, #6f5a7e 55%, #fd746c 100%)',
    forest: 'linear-gradient(160deg, #134e5e 0%, #3f8a6c 60%, #71b280 100%)',
    peach: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    saturn: 'radial-gradient(ellipse 60% 9% at 68% 34%, transparent 70%, rgba(240,205,150,.55) 72%, transparent 76%), radial-gradient(circle at 68% 34%, #f2cf8f 0, #d39a55 9%, transparent 9.4%), radial-gradient(circle at 20% 80%, #3b2a5c 0, transparent 50%), linear-gradient(180deg, #0b0d1c, #1d1838)',
    graphite: 'var(--panel)',
  };

  const WIDGETS = {
    greeting: 'Greeting',
    clock: 'Clock',
    search: 'Search bar',
    weather: 'Weather',
    recent: 'Recently visited',
    notes: 'Quick note',
  };

  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

  // ===================== visuals =====================
  function applyHome() {
    const hm = H();
    const wp = $('home-wallpaper');
    const w = hm.wallpaper || {};
    if (w.type === 'image' && w.value) wp.style.background = `center / cover no-repeat url("${w.value.replace(/"/g, '%22')}")`;
    else if (w.type === 'color') wp.style.background = w.value;
    else wp.style.background = WALLPAPERS[w.value] || WALLPAPERS.aurora;
    wp.style.filter = hm.blur ? `blur(${hm.blur}px)` : '';
    $('home-dim').style.opacity = (hm.dim || 0) / 100;
    $('home').style.setProperty('--w-opacity', hm.widgetOpacity);
    $('home').style.setProperty('--w-radius', hm.widgetRadius + 'px');
  }

  // ===================== widgets =====================
  let clockTimer = null;
  const builders = {
    greeting(cfg) {
      const el = h('div.w-greeting');
      const paint = () => {
        const hr = new Date().getHours();
        const g = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
        el.textContent = cfg.name ? `${g}, ${cfg.name}` : g;
      };
      paint(); el._tick = paint;
      return el;
    },

    clock(cfg) {
      const time = h('div.time'), date = h('div.date');
      const el = h('div.w-clock', null, time, cfg.showDate ? date : null);
      const paint = () => {
        const d = new Date();
        let hh = d.getHours();
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        let suffix = '';
        if (!cfg.h24) { suffix = hh >= 12 ? 'PM' : 'AM'; hh = hh % 12 || 12; }
        const hs = cfg.h24 ? String(hh).padStart(2, '0') : String(hh);
        time.innerHTML = `${hs}:${mm}${cfg.seconds ? ':' + ss : ''}${suffix ? `<small>${suffix}</small>` : ''}`;
        date.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      };
      paint(); el._tick = paint;
      return el;
    },

    search() {
      const f = UI.field({ placeholder: 'Search the web or enter address', icon: Icons.search });
      attachSuggest(f.input, {
        anchor: f.el,
        getItems: (q) => Browser.suggestions(q),
        onPick: (it) => { const url = it.url || Store.resolveInput(it.raw); if (url) { f.input.value = ''; Browser.navigate(url); } },
      });
      return h('div.w-search', null, f.el);
    },

    weather(cfg) {
      const el = h('div.w-weather.w-card', null, h('div.err', { text: 'Loading weather…' }));
      loadWeather(cfg).then((d) => paintWeather(el, cfg, d)).catch(() => {
        el.innerHTML = '';
        el.append(h('div.city', { html: Icons.mapPin + UI.esc(cfg.label || cfg.city) }), h('div.err', { text: 'Weather unavailable. Check your connection or the city name.' }));
      });
      return el;
    },

    recent() {
      const grid = h('div.recent-grid');
      const el = h('div.w-recent.w-card', null, h('div.w-title', null, h('span', { text: 'Recently visited' })), grid);
      paintRecent(grid);
      el._recent = grid;
      return el;
    },

    notes(cfg) {
      const ta = h('textarea', { placeholder: 'Write something…', spellcheck: 'false' });
      ta.value = cfg.text || '';
      ta.addEventListener('input', () => { cfg.text = ta.value; Store.save(); });
      return h('div.w-notes.w-card', null, h('div.w-title', null, h('span', { text: 'Quick note' })), ta);
    },
  };

  function paintRecent(grid) {
    grid.innerHTML = '';
    const seen = new Set();
    const items = [];
    for (const x of S.history) {
      const hn = host(x.url);
      if (!hn || seen.has(hn)) continue;
      seen.add(hn); items.push(x);
      if (items.length >= 8) break;
    }
    if (!items.length) {
      grid.style.display = 'block';
      grid.append(h('div.recent-empty', { text: 'Sites you visit will show up here.' }));
      return;
    }
    grid.style.display = '';
    items.forEach((x) => {
      const img = h('img', { src: Store.faviconFor(x.url) || x.favicon });
      img.onerror = () => img.replaceWith(h('span', { html: Icons.globe, style: { width: '20px', color: '#777' } }));
      const del = h('button.rdel', { html: Icons.x, 'data-tip': 'Remove' });
      const tile = h('div.recent', null, h('div.ric', null, img),
        h('div.rtt', { text: (x.title || host(x.url)).split(/ [-|–—·] /)[0] }), h('div.rho', { text: host(x.url) }), del);
      tile.onclick = (e) => { if (!e.target.closest('.rdel')) Browser.navigate(x.url); };
      tile.onauxclick = (e) => { if (e.button === 1) Browser.newTab(x.url, { background: true }); };
      del.onclick = (e) => {
        e.stopPropagation();
        const hn = host(x.url);
        for (let i = S.history.length - 1; i >= 0; i--) if (host(S.history[i].url) === hn) S.history.splice(i, 1);
        Store.save(); Home.refreshRecent();
      };
      grid.append(tile);
    });
  }

  // ---------- weather (Open-Meteo, no API key) ----------
  const wCache = {};
  async function loadWeather(cfg) {
    if (cfg.lat == null) await geocode(cfg);
    const key = `${cfg.lat},${cfg.lon},${cfg.unit}`;
    if (wCache[key] && Date.now() - wCache[key].t < 15 * 60000) return wCache[key].d;
    const u = new URL('https://api.open-meteo.com/v1/forecast');
    u.search = new URLSearchParams({
      latitude: cfg.lat, longitude: cfg.lon, timezone: 'auto', forecast_days: 4,
      current: 'temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      temperature_unit: cfg.unit === 'f' ? 'fahrenheit' : 'celsius',
      wind_speed_unit: cfg.unit === 'f' ? 'mph' : 'kmh',
    });
    const res = await fetch(u);
    if (!res.ok) throw new Error('weather');
    const d = await res.json();
    wCache[key] = { t: Date.now(), d };
    return d;
  }
  async function geocode(cfg) {
    const u = `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=${encodeURIComponent(cfg.city)}`;
    const res = await fetch(u);
    const j = await res.json();
    const r = j.results && j.results[0];
    if (!r) throw new Error('city not found');
    cfg.lat = r.latitude; cfg.lon = r.longitude;
    cfg.label = r.name + (r.country_code ? ', ' + r.country_code : '');
    Store.save();
  }
  function wmo(code) {
    if (code === 0) return ['Clear sky', 'w_sun'];
    if (code <= 2) return [code === 1 ? 'Mainly clear' : 'Partly cloudy', 'w_partly'];
    if (code === 3) return ['Overcast', 'w_cloud'];
    if (code <= 48) return ['Fog', 'w_fog'];
    if (code <= 57) return ['Drizzle', 'w_rain'];
    if (code <= 67) return ['Rain', 'w_rain'];
    if (code <= 77) return ['Snow', 'w_snow'];
    if (code <= 82) return ['Rain showers', 'w_rain'];
    if (code <= 86) return ['Snow showers', 'w_snow'];
    return ['Thunderstorm', 'w_storm'];
  }
  function paintWeather(el, cfg, d) {
    const c = d.current;
    const [label, icon] = wmo(c.weather_code);
    const deg = '°';
    el.innerHTML = '';
    el.append(
      h('div.wh', null,
        h('div', null,
          h('div.city', { html: Icons.mapPin + UI.esc(cfg.label || cfg.city) }),
          h('div.temp', { text: Math.round(c.temperature_2m) + deg }),
          h('div.cond', { text: label })),
        h('div.wicon', { html: Icons[icon] })),
      h('div.meta', null,
        h('span', { text: `H ${Math.round(d.daily.temperature_2m_max[0])}${deg}  L ${Math.round(d.daily.temperature_2m_min[0])}${deg}` }),
        h('span', { text: `Humidity ${c.relative_humidity_2m}%` }),
        h('span', { text: `${Math.round(c.wind_speed_10m)} ${cfg.unit === 'f' ? 'mph' : 'km/h'}` })),
      h('div.days', null, [1, 2, 3].map((i) => {
        const dn = new Date(d.daily.time[i] + 'T12:00').toLocaleDateString('en-US', { weekday: 'short' });
        return h('div.day', null, h('div', { text: dn }), h('div', { html: Icons[wmo(d.daily.weather_code[i])[1]] }),
          h('div', null, `${Math.round(d.daily.temperature_2m_max[i])}${deg} `, h('span.lo', { text: `${Math.round(d.daily.temperature_2m_min[i])}${deg}` })));
      })));
  }

  // ---------- render canvas ----------
  function renderWidgets() {
    const canvas = $('home-canvas');
    canvas.innerHTML = '';
    for (const [key, cfg] of Object.entries(H().widgets)) {
      if (!cfg.enabled || !builders[key]) continue;
      const inner = builders[key](cfg);
      const w = h('div.widget', { dataset: { w: key } }, inner,
        h('div.w-tools', null,
          h('button.w-remove', { html: Icons.x, 'data-tip': 'Hide widget' }),
          h('div.w-resize', { 'data-tip': 'Resize' })));
      w.style.left = cfg.x + '%';
      w.style.top = cfg.y + '%';
      w.style.setProperty('--s', cfg.scale || 1);
      bindWidgetEdit(w, key, cfg);
      canvas.append(w);
    }
    clearInterval(clockTimer);
    clockTimer = setInterval(() => canvas.querySelectorAll('.widget > *').forEach((el) => el._tick && el._tick()), 1000);
  }

  function bindWidgetEdit(w, key, cfg) {
    const canvas = $('home-canvas');
    w.querySelector('.w-remove').onclick = (e) => {
      e.stopPropagation(); cfg.enabled = false; Store.save(); renderWidgets(); if (panelOpen()) renderCustomize();
    };
    w.addEventListener('pointerdown', (e) => {
      if (!$('home').classList.contains('editing') || e.button !== 0) return;
      e.preventDefault();
      const cr = canvas.getBoundingClientRect();
      const resizing = e.target.classList.contains('w-resize');
      if (e.target.closest('.w-remove')) return;
      w.setPointerCapture(e.pointerId);
      w.classList.add('grabbing');
      const cx = cr.left + (cfg.x / 100) * cr.width, cy = cr.top + (cfg.y / 100) * cr.height;
      const offX = e.clientX - cx, offY = e.clientY - cy;
      const startDist = Math.hypot(offX, offY) || 1, startScale = cfg.scale || 1;
      const move = (ev) => {
        if (resizing) {
          const d = Math.hypot(ev.clientX - cx, ev.clientY - cy);
          cfg.scale = UI.clamp(+(startScale * d / startDist).toFixed(3), 0.5, 2.2);
          w.style.setProperty('--s', cfg.scale);
        } else {
          cfg.x = UI.clamp(((ev.clientX - offX - cr.left) / cr.width) * 100, 2, 98);
          cfg.y = UI.clamp(((ev.clientY - offY - cr.top) / cr.height) * 100, 2, 98);
          w.style.left = cfg.x + '%'; w.style.top = cfg.y + '%';
        }
      };
      const up = () => {
        w.classList.remove('grabbing');
        w.removeEventListener('pointermove', move);
        w.removeEventListener('pointerup', up);
        Store.save();
      };
      w.addEventListener('pointermove', move);
      w.addEventListener('pointerup', up);
    });
  }

  function setEditing(on) {
    $('home').classList.toggle('editing', on);
    if (on) closeCustomize();
  }

  // ===================== customize panel =====================
  const panelOpen = () => $('customize-panel').classList.contains('open');
  function closeCustomize() { $('customize-panel').classList.remove('open'); }

  function colorInput(value, onInput) {
    const input = h('input', { type: 'color' });
    input.value = value;
    const box = h('label.color-input', { style: { background: value } }, input);
    input.addEventListener('input', () => { box.style.background = input.value; onInput(input.value); });
    return box;
  }
  const row = (label, ...right) => h('div.cp-row', null, h('span.lbl', { text: label }), h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, ...right));

  function renderCustomize() {
    const body = $('customize-body');
    const scrollTop = body.scrollTop;
    const hm = H();
    body.innerHTML = '';

    body.append(h('div.cp-head', null, h('h3', { text: 'Customize' }),
      h('button.gear-btn', { html: Icons.x, 'data-tip': 'Close', onclick: closeCustomize })));

    // --- wallpaper
    const wpGrid = h('div.wp-grid');
    Object.entries(WALLPAPERS).forEach(([k, css]) => {
      const on = hm.wallpaper.type === 'preset' && hm.wallpaper.value === k;
      const t = h('button.wp' + (on ? '.on' : ''), { 'data-tip': k[0].toUpperCase() + k.slice(1), style: { background: css } });
      t.onclick = () => { hm.wallpaper = { type: 'preset', value: k }; commit(); };
      wpGrid.append(t);
    });
    const up = h('button.wp.upload' + (hm.wallpaper.type === 'image' ? '.on' : ''), { html: Icons.upload, 'data-tip': 'Upload an image' });
    if (hm.wallpaper.type === 'image') { up.style.background = `center/cover url("${hm.wallpaper.value}")`; up.innerHTML = ''; }
    up.onclick = async () => {
      const url = await window.saturne.pickWallpaper();
      if (url) { hm.wallpaper = { type: 'image', value: url }; commit(); }
    };
    wpGrid.append(up);
    const urlField = UI.field({ icon: Icons.image, placeholder: 'Paste an image URL and press Enter', clearable: true,
      onEnter: (v) => { if (/^https?:\/\//i.test(v.trim())) { hm.wallpaper = { type: 'image', value: v.trim() }; commit(); } else UI.toast('Enter a valid http(s) image URL'); } });
    body.append(h('div.cp-sec', null, h('h4', { text: 'Wallpaper' }), wpGrid,
      h('div.cp-col', null, urlField.el),
      h('div.cp-col', null,
        row('Solid color', colorInput(hm.wallpaper.type === 'color' ? hm.wallpaper.value : '#333333', (v) => { hm.wallpaper = { type: 'color', value: v }; applyHome(); Store.save(); })),
        rangeRow('Blur', hm.blur, 0, 30, 'px', (v) => { hm.blur = v; applyHome(); }),
        rangeRow('Dim', hm.dim, 0, 80, '%', (v) => { hm.dim = v; applyHome(); }))));

    // --- colors (grays)
    const themes = h('div.theme-grid');
    Object.entries(Store.THEMES).forEach(([name, t]) => {
      const chip = h('button.theme-chip', null,
        h('span.sw', null, h('i', { style: { background: t.bg } }), h('i', { style: { background: t.panel } }), h('i', { style: { background: t.field } }), h('i', { style: { background: t.accent } })),
        h('span', { text: name }));
      chip.onclick = () => { Object.assign(S.theme, t); Browser.applyTheme(); Store.save(); renderCustomize(); };
      themes.append(chip);
    });
    const colorRows = [
      ['bg', 'Window & sidebar'], ['panel', 'Content panel'], ['field', 'Fields & search bar'],
      ['text', 'Text'], ['accent', 'Accent'], ['card', 'Favorite cards'],
    ].map(([k, label]) => row(label, colorInput(S.theme[k], (v) => { S.theme[k] = v; Browser.applyTheme(); Store.save(); })));
    body.append(h('div.cp-sec', null, h('h4', { text: 'Colors' }), themes, h('div.cp-col', null, ...colorRows),
      h('div.cp-actions', null, h('button.s-btn', { text: 'Reset colors', onclick: () => { Object.assign(S.theme, Store.THEMES.Graphite); Browser.applyTheme(); Store.save(); renderCustomize(); } }))));

    // --- widgets
    const wsec = h('div.cp-sec', null, h('h4', { text: 'Widgets' }));
    Object.entries(WIDGETS).forEach(([key, label]) => {
      const cfg = hm.widgets[key];
      const opts = widgetOptions(key, cfg);
      const gear = opts ? h('button.gear-btn', { html: Icons.gear, 'data-tip': 'Options' }) : null;
      wsec.append(row(label, gear, UI.switch(cfg.enabled, (on) => { cfg.enabled = on; Store.save(); renderWidgets(); })));
      if (opts) {
        opts.hidden = true;
        gear.onclick = () => (opts.hidden = !opts.hidden);
        wsec.append(opts);
      }
    });
    wsec.append(h('div.cp-actions', null,
      h('button.s-btn.primary', { html: `<span class="ico">${Icons.layout}</span>Edit layout`, onclick: () => setEditing(true) }),
      h('button.s-btn', { text: 'Reset layout', onclick: () => {
        const d = Store.defaultHome().widgets;
        for (const k in d) Object.assign(hm.widgets[k], { x: d[k].x, y: d[k].y, scale: 1 });
        Store.save(); renderWidgets();
      } })));
    body.append(wsec);

    // --- widget style
    body.append(h('div.cp-sec', null, h('h4', { text: 'Widget style' }),
      rangeRow('Opacity', hm.widgetOpacity, 0, 100, '%', (v) => { hm.widgetOpacity = v; applyHome(); }),
      rangeRow('Corner radius', hm.widgetRadius, 0, 28, 'px', (v) => { hm.widgetRadius = v; applyHome(); })));

    body.append(h('div.cp-sec', null, h('div.cp-actions', null,
      h('button.s-btn.danger', { text: 'Reset home page', onclick: async () => {
        if (!(await UI.confirm({ title: 'Reset home page?', message: 'Wallpaper, widgets and layout go back to default.', ok: 'Reset', danger: true }))) return;
        S.home = Store.defaultHome(); Store.save(); applyHome(); renderWidgets(); renderCustomize();
      } }))));

    body.scrollTop = scrollTop;
  }

  function rangeRow(label, value, min, max, unit, onInput) {
    const val = h('span.val', { text: value + unit });
    const r = UI.range({ min, max, value, onInput: (v) => { val.textContent = v + unit; onInput(v); Store.save(); } });
    return h('div.cp-col', null, h('div.cp-row', null, h('span.lbl', { text: label }), val), r);
  }

  function widgetOptions(key, cfg) {
    const box = h('div.w-opt');
    const rerender = () => { Store.save(); renderWidgets(); };
    if (key === 'clock') {
      box.append(
        row('24-hour format', UI.switch(cfg.h24, (v) => { cfg.h24 = v; rerender(); })),
        row('Show seconds', UI.switch(cfg.seconds, (v) => { cfg.seconds = v; rerender(); })),
        row('Show date', UI.switch(cfg.showDate, (v) => { cfg.showDate = v; rerender(); })));
    } else if (key === 'weather') {
      const f = UI.field({ icon: Icons.mapPin, placeholder: 'City — press Enter', value: cfg.city, clearable: false,
        onEnter: async (v) => {
          if (!v.trim()) return;
          const prev = { ...cfg };
          cfg.city = v.trim(); cfg.lat = null; cfg.lon = null;
          try { await geocode(cfg); rerender(); UI.toast(`Weather set to ${cfg.label}`); }
          catch { Object.assign(cfg, prev); UI.toast('City not found'); }
        } });
      box.append(h('div.cp-col', null, f.el),
        row('Units', UI.select({ value: cfg.unit, width: 140, options: [{ value: 'c', label: 'Celsius (°C)' }, { value: 'f', label: 'Fahrenheit (°F)' }], onChange: (v) => { cfg.unit = v; rerender(); } })));
    } else if (key === 'search') {
      box.append(row('Engine', UI.select({
        value: S.settings.searchEngine, width: 150,
        options: Object.entries(Store.SEARCH_ENGINES).map(([k, v]) => ({ value: k, label: v.name })),
        onChange: (v) => { S.settings.searchEngine = v; Store.save(); },
      })));
    } else if (key === 'greeting') {
      const f = UI.field({ icon: null, placeholder: 'Your name', value: cfg.name, onInput: (v) => { cfg.name = v; Store.save(); renderWidgets(); } });
      box.append(h('div.cp-col', null, f.el));
    } else return null;
    return box;
  }

  function commit() { Store.save(); applyHome(); renderCustomize(); }

  // ===================== public =====================
  window.Home = {
    init() {
      $('home-customize').querySelector('.ico').innerHTML = Icons.palette;
      $('home-customize').onclick = () => Home.openCustomize();
      $('btn-edit-done').onclick = () => { setEditing(false); Home.openCustomize(); };
      $('home-canvas').addEventListener('contextmenu', (e) => {
        if (e.target.matches('input, textarea')) return; // text fields get the text menu
        e.preventDefault();
        Menu.open({ x: e.clientX, y: e.clientY, items: [
          { label: 'Customize home page', icon: Icons.palette, onClick: () => Home.openCustomize() },
          { label: $('home').classList.contains('editing') ? 'Finish editing layout' : 'Edit layout', icon: Icons.layout, onClick: () => setEditing(!$('home').classList.contains('editing')) },
          { label: 'Change wallpaper…', icon: Icons.image, onClick: async () => { const u = await window.saturne.pickWallpaper(); if (u) { H().wallpaper = { type: 'image', value: u }; commit(); } } },
        ] });
      });
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || Menu.isOpen()) return;
        if ($('home').classList.contains('editing')) setEditing(false);
        else if (panelOpen()) closeCustomize();
      });
      applyHome();
      renderWidgets();
    },
    show(on) {
      $('home').classList.toggle('visible', on);
      if (!on) { closeCustomize(); setEditing(false); }
      else Home.refreshRecent();
    },
    openCustomize() {
      renderCustomize();
      $('customize-panel').classList.add('open');
    },
    refreshRecent() {
      document.querySelectorAll('.w-recent').forEach((el) => el._recent && paintRecent(el._recent));
    },
  };
})();
