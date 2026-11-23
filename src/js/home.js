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
    analog: 'Analog clock',
    calendar: 'Calendar',
    links: 'Quick links',
    todo: 'To-do list',
    timer: 'Focus timer',
    countdown: 'Countdown',
    worldclock: 'World clock',
    quote: 'Quote of the day',
    battery: 'Battery',
  };

  const QUOTES = [
    ['The best way to predict the future is to invent it.', 'Alan Kay'],
    ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci'],
    ['Stay hungry, stay foolish.', 'Stewart Brand'],
    ['Done is better than perfect.', 'Sheryl Sandberg'],
    ['Whether you think you can or you think you can’t, you’re right.', 'Henry Ford'],
    ['It always seems impossible until it’s done.', 'Nelson Mandela'],
    ['Make it work, make it right, make it fast.', 'Kent Beck'],
    ['The secret of getting ahead is getting started.', 'Mark Twain'],
    ['Imagination is more important than knowledge.', 'Albert Einstein'],
    ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
    ['Small steps every day.', 'Proverb'],
    ['Life is what happens when you’re busy making other plans.', 'John Lennon'],
    ['The journey of a thousand miles begins with one step.', 'Lao Tzu'],
    ['Be yourself; everyone else is already taken.', 'Oscar Wilde'],
    ['Creativity is intelligence having fun.', 'Albert Einstein'],
    ['What we think, we become.', 'Buddha'],
    ['Act as if what you do makes a difference. It does.', 'William James'],
    ['Quality is not an act, it is a habit.', 'Aristotle'],
    ['Everything you can imagine is real.', 'Pablo Picasso'],
    ['Dream big. Start small. Act now.', 'Robin Sharma'],
    ['Talk is cheap. Show me the code.', 'Linus Torvalds'],
    ['First, solve the problem. Then, write the code.', 'John Johnson'],
    ['The only way to do great work is to love what you do.', 'Steve Jobs'],
    ['Look up at the stars and not down at your feet.', 'Stephen Hawking'],
  ];
  const ZONES = {
    'Paris': 'Europe/Paris', 'London': 'Europe/London', 'New York': 'America/New_York', 'Los Angeles': 'America/Los_Angeles',
    'Chicago': 'America/Chicago', 'Montréal': 'America/Toronto', 'São Paulo': 'America/Sao_Paulo', 'Mexico City': 'America/Mexico_City',
    'Tokyo': 'Asia/Tokyo', 'Seoul': 'Asia/Seoul', 'Shanghai': 'Asia/Shanghai', 'Hong Kong': 'Asia/Hong_Kong', 'Singapore': 'Asia/Singapore',
    'Dubai': 'Asia/Dubai', 'Mumbai': 'Asia/Kolkata', 'Moscow': 'Europe/Moscow', 'Istanbul': 'Europe/Istanbul', 'Cairo': 'Africa/Cairo',
    'Casablanca': 'Africa/Casablanca', 'Algiers': 'Africa/Algiers', 'Dakar': 'Africa/Dakar', 'Sydney': 'Australia/Sydney', 'Auckland': 'Pacific/Auckland', 'Honolulu': 'Pacific/Honolulu',
  };
  const zoneName = (z) => Object.keys(ZONES).find((k) => ZONES[k] === z) || z.split('/').pop().replace(/_/g, ' ');
  // focus timer keeps running while the home page is re-rendered
  const timerRun = { mode: 'work', left: null, running: false, endAt: 0 };

  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

  // ===================== visuals =====================
  function applyHome() {
    const hm = H();
    const wp = $('home-wallpaper');
    const w = hm.wallpaper || {};
    let vid = wp.querySelector('video');
    if (w.type === 'video' && w.value) {
      wp.style.background = '#000';
      if (!vid) {
        vid = h('video', { playsinline: '', loop: '', preload: 'auto' });
        vid.muted = true; vid.defaultMuted = true; vid.autoplay = true;
        vid.addEventListener('canplay', () => { if ($('home').classList.contains('visible') && vid.paused) vid.play().catch(() => {}); });
        vid.addEventListener('error', () => { if (H().wallpaper.type === 'video') UI.toast('This video can’t be played — use MP4 (H.264) or WebM', 4000); });
        wp.append(vid);
      }
      if (vid.dataset.src !== w.value) { vid.src = w.value; vid.dataset.src = w.value; }
      if ($('home').classList.contains('visible')) vid.play().catch(() => {});
    } else {
      if (vid) { vid.pause(); vid.remove(); }
      if (w.type === 'image' && w.value) wp.style.background = `center / cover no-repeat url("${w.value.replace(/"/g, '%22')}")`;
      else if (w.type === 'color') wp.style.background = w.value;
      else wp.style.background = WALLPAPERS[w.value] || WALLPAPERS.aurora;
    }
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

    analog(cfg) {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 200 200');
      let marks = '';
      for (let i = 0; i < 60; i++) {
        const big = i % 5 === 0, a = (i * 6 * Math.PI) / 180, r1 = big ? 80 : 85, r2 = 90;
        marks += `<line x1="${100 + r1 * Math.sin(a)}" y1="${100 - r1 * Math.cos(a)}" x2="${100 + r2 * Math.sin(a)}" y2="${100 - r2 * Math.cos(a)}" class="${big ? 'mk big' : 'mk'}"/>`;
      }
      let nums = '';
      if (cfg.numbers) for (let n = 1; n <= 12; n++) { const a = (n * 30 * Math.PI) / 180; nums += `<text x="${100 + 66 * Math.sin(a)}" y="${100 - 66 * Math.cos(a) + 5}">${n}</text>`; }
      svg.innerHTML = `<circle cx="100" cy="100" r="96" class="face"/>${marks}${nums}<line class="hh" x1="100" y1="100" x2="100" y2="55"/><line class="mh" x1="100" y1="100" x2="100" y2="30"/><line class="sh" x1="100" y1="115" x2="100" y2="24"/><circle cx="100" cy="100" r="4" class="pin"/>`;
      const el = h('div.w-analog', null, svg);
      const hh = svg.querySelector('.hh'), mh = svg.querySelector('.mh'), sh = svg.querySelector('.sh');
      const paint = () => {
        const d = new Date(), s = d.getSeconds(), m = d.getMinutes() + s / 60, hr = (d.getHours() % 12) + m / 60;
        hh.setAttribute('transform', `rotate(${hr * 30} 100 100)`);
        mh.setAttribute('transform', `rotate(${m * 6} 100 100)`);
        sh.setAttribute('transform', `rotate(${s * 6} 100 100)`);
      };
      paint(); el._tick = paint;
      return el;
    },

    calendar(cfg) {
      let offset = 0;
      const body = h('div.cal-body');
      const title = h('span.cal-title');
      const el = h('div.w-calendar.w-card', null,
        h('div.cal-head', null, title,
          h('div.cal-nav', null,
            h('button', { html: Icons.chevRight, class: 'prev', onclick: () => { offset--; paint(); } }),
            h('button', { text: '•', 'data-tip': 'Today', onclick: () => { offset = 0; paint(); } }),
            h('button', { html: Icons.chevRight, onclick: () => { offset++; paint(); } }))),
        body);
      const paint = () => {
        const now = new Date();
        const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        title.textContent = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const names = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
        const start = cfg.mondayFirst ? 1 : 0;
        const cells = [];
        for (let i = 0; i < 7; i++) cells.push(h('span.dn', { text: names[(i + start) % 7] }));
        const lead = (first.getDay() - start + 7) % 7;
        const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
        for (let i = 0; i < lead; i++) cells.push(h('span'));
        for (let d = 1; d <= days; d++) {
          const today = offset === 0 && d === now.getDate();
          const wd = new Date(first.getFullYear(), first.getMonth(), d).getDay();
          cells.push(h('span.d' + (today ? '.today' : '') + (wd === 0 || wd === 6 ? '.we' : ''), { text: d }));
        }
        body.replaceChildren(...cells);
      };
      paint();
      let lastDay = new Date().getDate();
      el._tick = () => { const d = new Date().getDate(); if (d !== lastDay) { lastDay = d; paint(); } };
      return el;
    },

    links(cfg) {
      const grid = h('div.links-grid');
      (cfg.items || []).forEach((it) => {
        const img = h('img', { src: Store.faviconFor(it.url) });
        img.onerror = () => img.replaceWith(h('span', { html: Icons.globe }));
        const a = h('button.qlink', { 'data-tip': it.url }, h('span.qic', null, img), h('span.qtt', { text: it.title || host(it.url) }));
        a.onclick = () => Browser.navigate(it.url);
        a.onauxclick = (e) => { if (e.button === 1) Browser.newTab(it.url, { background: true }); };
        grid.append(a);
      });
      if (!(cfg.items || []).length) grid.append(h('div.recent-empty', { text: 'Add sites in Customize → Quick links.' }));
      return h('div.w-links.w-card', null, grid);
    },

    todo(cfg) {
      cfg.items = cfg.items || [];
      const list = h('div.todo-list');
      const input = h('input', { type: 'text', placeholder: 'Add a task…', spellcheck: 'false', maxlength: '120' });
      const count = h('span');
      const paint = () => {
        list.replaceChildren(...cfg.items.map((it) => {
          const cb = h('button.todo-cb' + (it.done ? '.on' : ''), { html: it.done ? Icons.check : '' });
          cb.onclick = () => { it.done = !it.done; Store.save(); paint(); };
          const del = h('button.todo-del', { html: Icons.x, 'data-tip': 'Delete' });
          del.onclick = () => { cfg.items.splice(cfg.items.indexOf(it), 1); Store.save(); paint(); };
          return h('div.todo-item' + (it.done ? '.done' : ''), null, cb, h('span.todo-t', { text: it.text }), del);
        }));
        const left = cfg.items.filter((x) => !x.done).length;
        count.textContent = cfg.items.length ? `${left} left` : '';
      };
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !input.value.trim()) return;
        cfg.items.push({ id: Store.uid(), text: input.value.trim(), done: false });
        input.value = ''; Store.save(); paint();
      });
      const clear = h('button.todo-clear', { text: 'Clear done', onclick: () => { cfg.items = cfg.items.filter((x) => !x.done); Store.save(); paint(); } });
      paint();
      return h('div.w-todo.w-card', null, h('div.w-title', null, h('span', { text: 'To-do' }), count), list, h('div.todo-add', null, input, clear));
    },

    timer(cfg) {
      const total = () => (timerRun.mode === 'work' ? cfg.work : cfg.rest) * 60;
      if (timerRun.left == null) timerRun.left = total();
      const time = h('div.t-time'), mode = h('div.t-mode');
      const ring = h('div.t-ring', null, time);
      const play = h('button.s-btn.primary.t-play');
      const el = h('div.w-timer.w-card', null, mode, ring,
        h('div.t-btns', null,
          h('button.s-btn.ghost', { html: Icons.reload, 'data-tip': 'Reset', onclick: () => { timerRun.running = false; timerRun.left = total(); paint(); } }),
          play,
          h('button.s-btn.ghost', { text: timerRun.mode === 'work' ? 'Break' : 'Focus', class: 't-switch', onclick: () => { swap(); } })));
      const swap = () => { timerRun.mode = timerRun.mode === 'work' ? 'rest' : 'work'; timerRun.running = false; timerRun.left = total(); paint(); };
      const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      const paint = () => {
        if (timerRun.running) timerRun.left = Math.max(0, (timerRun.endAt - Date.now()) / 1000);
        if (timerRun.running && timerRun.left <= 0) {
          timerRun.running = false;
          UI.toast(timerRun.mode === 'work' ? 'Focus session done — take a break!' : 'Break over — back to it!', 5000);
          try { new Notification('Saturne', { body: timerRun.mode === 'work' ? 'Focus session done — take a break!' : 'Break over!' }); } catch {}
          swap(); return;
        }
        time.textContent = fmt(Math.ceil(timerRun.left));
        mode.textContent = timerRun.mode === 'work' ? 'Focus' : 'Break';
        el.classList.toggle('rest', timerRun.mode === 'rest');
        ring.style.setProperty('--p', (1 - timerRun.left / total()) * 100 + '%');
        play.textContent = timerRun.running ? 'Pause' : (timerRun.left < total() ? 'Resume' : 'Start');
        const sw = el.querySelector('.t-switch'); if (sw) sw.textContent = timerRun.mode === 'work' ? 'Break' : 'Focus';
      };
      play.onclick = () => {
        if (timerRun.running) { timerRun.left = Math.max(0, (timerRun.endAt - Date.now()) / 1000); timerRun.running = false; }
        else { timerRun.endAt = Date.now() + timerRun.left * 1000; timerRun.running = true; }
        paint();
      };
      paint(); el._tick = paint;
      return el;
    },

    countdown(cfg) {
      const num = h('div.cd-num'), unit = h('div.cd-unit'), sub = h('div.cd-sub');
      const el = h('div.w-countdown.w-card', null, h('div.cd-label', { text: cfg.label || 'Countdown' }), num, unit, sub);
      const paint = () => {
        const target = new Date((cfg.date || '') + 'T00:00:00');
        if (isNaN(target)) { num.textContent = '—'; unit.textContent = 'Pick a date in Customize'; sub.textContent = ''; return; }
        let ms = target - Date.now();
        const past = ms < 0; ms = Math.abs(ms);
        const d = Math.floor(ms / 86400000), hr = Math.floor(ms / 3600000) % 24, mi = Math.floor(ms / 60000) % 60;
        num.textContent = d;
        unit.textContent = past ? `day${d === 1 ? '' : 's'} ago` : `day${d === 1 ? '' : 's'} to go`;
        sub.textContent = `${hr} h ${mi} min · ${target.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}`;
      };
      paint(); el._tick = paint;
      return el;
    },

    worldclock(cfg) {
      const list = h('div.wc-list');
      const el = h('div.w-worldclock.w-card', null, list);
      const rows = (cfg.zones || []).map((z) => {
        const t = h('span.wc-t'), d = h('span.wc-d');
        list.append(h('div.wc-row', null, h('div', null, h('div.wc-city', { text: zoneName(z) }), d), t));
        return { z, t, d };
      });
      if (!rows.length) list.append(h('div.recent-empty', { text: 'Add cities in Customize → World clock.' }));
      const paint = () => {
        const now = new Date();
        const localDay = now.toLocaleDateString('en-CA');
        for (const r of rows) {
          try {
            r.t.textContent = now.toLocaleTimeString('en-GB', { timeZone: r.z, hour: '2-digit', minute: '2-digit' });
            const day = now.toLocaleDateString('en-CA', { timeZone: r.z });
            const off = new Date(now.toLocaleString('en-US', { timeZone: r.z })) - new Date(now.toLocaleString('en-US'));
            const hrs = Math.round(off / 360000) / 10;
            r.d.textContent = (day > localDay ? 'Tomorrow' : day < localDay ? 'Yesterday' : 'Today') + ', ' + (hrs === 0 ? 'same time' : (hrs > 0 ? '+' : '') + hrs + ' h');
          } catch { r.t.textContent = '--:--'; }
        }
      };
      paint(); el._tick = paint;
      return el;
    },

    quote() {
      const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
      const [q, a] = QUOTES[day % QUOTES.length];
      return h('div.w-quote', null, h('div.q-text', { text: `“${q}”` }), h('div.q-author', { text: '— ' + a }));
    },

    battery() {
      const pct = h('div.b-pct', { text: '…' }), state = h('div.b-state');
      const fill = h('div.b-fill');
      const el = h('div.w-battery.w-card', null, h('div.b-icon', null, fill, h('div.b-cap')), h('div', null, pct, state));
      if (!navigator.getBattery) { pct.textContent = '—'; state.textContent = 'Not available'; return el; }
      navigator.getBattery().then((b) => {
        const paint = () => {
          const p = Math.round(b.level * 100);
          const desktop = b.charging && p === 100 && b.chargingTime === 0 && b.dischargingTime === Infinity;
          pct.textContent = desktop ? 'Plugged in' : p + '%';
          fill.style.width = p + '%';
          el.classList.toggle('low', p <= 20 && !b.charging);
          el.classList.toggle('charging', b.charging);
          const mins = (s) => (isFinite(s) && s > 0 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : '');
          state.textContent = desktop ? 'No battery (desktop)' : b.charging ? (mins(b.chargingTime) ? `Charging · full in ${mins(b.chargingTime)}` : 'Charging') : (mins(b.dischargingTime) ? `${mins(b.dischargingTime)} left` : 'On battery');
        };
        paint();
        ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((ev) => b.addEventListener(ev, paint));
      }).catch(() => { pct.textContent = '—'; state.textContent = 'Not available'; });
      return el;
    },
  };

  // ===================== CustomIMG (pictures & GIFs) =====================
  const IMG_DEFAULTS = { scale: 1, width: 260, radius: 16, opacity: 100, rotate: 0, shadow: true, link: '' };
  function imageWidget(img) {
    const pic = h('img.ci-img', { src: img.src, draggable: 'false', alt: '' });
    pic.onerror = () => { pic.replaceWith(h('div.ci-missing', { html: Icons.image + '<span>Image not found</span>' })); };
    const el = h('div.w-img' + (img.shadow ? '.shadow' : ''), null, pic);
    el.style.width = img.width + 'px';
    el.style.borderRadius = img.radius + 'px';
    el.style.opacity = img.opacity / 100;
    el.style.transform = img.rotate ? `rotate(${img.rotate}deg)` : '';
    if (img.link) { el.classList.add('linked'); el.onclick = () => { if (!$('home').classList.contains('editing')) Browser.navigate(img.link); }; }
    return el;
  }
  async function addImages(urls, { edit = true } = {}) {
    const hm = H();
    hm.images = hm.images || [];
    urls.forEach((src, i) => hm.images.push({ id: Store.uid(), src, x: UI.clamp(50 + i * 4, 5, 95), y: UI.clamp(50 + i * 4, 5, 95), ...IMG_DEFAULTS }));
    if (!urls.length) return;
    Store.save(); renderWidgets();
    if (panelOpen()) renderCustomize();
    UI.toast(urls.length > 1 ? `${urls.length} images added — drag them where you want` : 'Image added — drag it where you want');
    if (edit) setEditing(true);
  }
  async function pickImages() { addImages(await window.saturne.pickHomeImages()); }
  function removeImage(img) {
    const hm = H();
    hm.images = (hm.images || []).filter((x) => x !== img);
    if (img.src.startsWith('file:')) window.saturne.deleteHomeImage(img.src);
    Store.save(); renderWidgets(); if (panelOpen()) renderCustomize();
  }
  function layer(img, front) {
    const list = H().images; const i = list.indexOf(img);
    list.splice(i, 1); front ? list.push(img) : list.unshift(img);
    Store.save(); renderWidgets();
  }
  function imageMenu(img, e) {
    e.preventDefault(); e.stopPropagation();
    Menu.open({ x: e.clientX, y: e.clientY, items: [
      { label: 'Image options…', icon: Icons.gear, onClick: () => imageOptions(img) },
      { label: 'Move & resize', icon: Icons.move, onClick: () => setEditing(true) },
      { label: 'Bring to front', icon: Icons.layout, onClick: () => layer(img, true) },
      { label: 'Send to back', icon: Icons.layout, onClick: () => layer(img, false) },
      { label: 'Replace image…', icon: Icons.image, onClick: async () => { const [u] = await window.saturne.pickHomeImages(); if (u) { if (img.src.startsWith('file:')) window.saturne.deleteHomeImage(img.src); img.src = u; Store.save(); renderWidgets(); } } },
      { sep: true },
      { label: 'Delete image', icon: Icons.trash, danger: true, onClick: () => removeImage(img) },
    ] });
  }
  function imageOptions(img) {
    UI.modal({
      title: 'Image options',
      body(box, close) {
        const live = () => { Store.save(); renderWidgets(); };
        const prev = h('div.ci-prev', null, h('img', { src: img.src, alt: '' }));
        const slider = (label, key, min, max, unit) => {
          const val = h('span.val', { text: img[key] + unit });
          return h('div.cp-col', null, h('div.cp-row', null, h('span.lbl', { text: label }), val),
            UI.range({ min, max, value: img[key], onInput: (v) => { img[key] = v; val.textContent = v + unit; live(); } }));
        };
        const link = UI.field({ icon: Icons.link, placeholder: 'https://… (optional)', value: img.link, onInput: (v) => { img.link = /^https?:\/\//i.test(v.trim()) ? v.trim() : ''; live(); } });
        box.append(prev,
          slider('Width', 'width', 60, 900, ' px'),
          slider('Rounded corners', 'radius', 0, 200, ' px'),
          slider('Opacity', 'opacity', 10, 100, ' %'),
          slider('Rotation', 'rotate', -180, 180, '°'),
          h('div.cp-row', { style: { marginTop: '10px' } }, h('span.lbl', { text: 'Shadow' }), UI.switch(img.shadow, (v) => { img.shadow = v; live(); })),
          h('label', { text: 'Open a link when clicked' }), link.el,
          h('div.actions', null,
            h('button.s-btn.danger', { text: 'Delete', onclick: () => { close(); removeImage(img); } }),
            h('button.s-btn.primary', { text: 'Done', onclick: close })));
      },
    });
  }

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
    // CustomIMG pictures (several allowed); later ones are drawn on top
    for (const img of H().images || []) {
      const w = h('div.widget.widget-img', { dataset: { w: 'img' } }, imageWidget(img),
        h('div.w-tools', null,
          h('button.w-remove', { html: Icons.x, 'data-tip': 'Delete image' }),
          h('button.w-gear', { html: Icons.gear, 'data-tip': 'Image options' }),
          h('div.w-resize', { 'data-tip': 'Resize' })));
      w.style.left = img.x + '%';
      w.style.top = img.y + '%';
      w.style.setProperty('--s', img.scale || 1);
      w.querySelector('.w-gear').addEventListener('pointerdown', (e) => e.stopPropagation());
      w.querySelector('.w-gear').onclick = (e) => { e.stopPropagation(); imageOptions(img); };
      w.addEventListener('contextmenu', (e) => imageMenu(img, e));
      bindWidgetEdit(w, 'img', img, () => removeImage(img));
      canvas.append(w);
    }
    clearInterval(clockTimer);
    clockTimer = setInterval(() => canvas.querySelectorAll('.widget > *').forEach((el) => el._tick && el._tick()), 1000);
  }

  function bindWidgetEdit(w, key, cfg, onRemove) {
    const canvas = $('home-canvas');
    w.querySelector('.w-remove').onclick = (e) => {
      e.stopPropagation();
      if (onRemove) return onRemove();
      cfg.enabled = false; Store.save(); renderWidgets(); if (panelOpen()) renderCustomize();
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
          cfg.scale = UI.clamp(+(startScale * d / startDist).toFixed(3), key === 'img' ? 0.2 : 0.5, key === 'img' ? 4 : 2.2);
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

  // ---------- wallpaper: preset, color, image / GIF, or video ----------
  const isVideoUrl = (u) => /\.(mp4|webm|m4v|ogv|mov)([?#]|$)/i.test(u || '');
  function setWallpaperUrl(u) {
    H().wallpaper = { type: isVideoUrl(u) ? 'video' : 'image', value: u };
    commit();
  }
  async function pickWallpaper() {
    const r = await window.saturne.pickWallpaper();
    if (r && r.error) return UI.toast(r.error, 3500);
    if (r) setWallpaperUrl(r);
  }

  // ---------- panel: 4 short tabs instead of one long page ----------
  let cpTab = 'background';
  let cpOpenWidget = null; // widget whose options are shown
  const CP_TABS = [['background', 'Background', 'image'], ['widgets', 'Widgets', 'layout'], ['pictures', 'Pictures', 'sparkle'], ['style', 'Style', 'palette']];
  const WIDGET_ICONS = {
    greeting: 'chat', clock: 'history', search: 'search', weather: 'w_partly', recent: 'tabs', notes: 'pencil', analog: 'saturn',
    calendar: 'layout', links: 'link', todo: 'check', timer: 'bolt', countdown: 'star', worldclock: 'globe', quote: 'reader', battery: 'unload',
  };

  function renderCustomize() {
    const body = $('customize-body');
    const scrollTop = body.scrollTop;
    const hm = H();
    body.innerHTML = '';

    const tabs = h('div.cp-tabs', null, CP_TABS.map(([k, label, ic]) => h('button.cp-tab' + (cpTab === k ? '.on' : ''), {
      onclick: () => { if (cpTab !== k) { cpTab = k; renderCustomize(); body.scrollTop = 0; } },
    }, h('span.ico', { html: Icons[ic] }), h('span', { text: label }))));
    body.append(h('div.cp-top', null,
      h('div.cp-head', null, h('h3', { text: 'Customize' }), h('button.gear-btn', { html: Icons.x, 'data-tip': 'Close  (Esc)', onclick: closeCustomize })),
      tabs));
    const page = h('div.cp-page');
    body.append(page);

    if (cpTab === 'background') {
      const w = hm.wallpaper;
      const grid = h('div.wp-grid');
      Object.entries(WALLPAPERS).forEach(([k, css]) => {
        const on = w.type === 'preset' && w.value === k;
        grid.append(h('button.wp' + (on ? '.on' : ''), { 'data-tip': k[0].toUpperCase() + k.slice(1), style: { background: css }, onclick: () => { hm.wallpaper = { type: 'preset', value: k }; commit(); } }));
      });
      // your own picture / GIF / video
      const mine = w.type === 'image' || w.type === 'video';
      const own = h('button.wp.wp-own' + (mine ? '.on' : ''), { 'data-tip': mine ? 'Your wallpaper — click to change' : 'Your own image, GIF or video', onclick: pickWallpaper });
      if (w.type === 'image') own.style.background = `center/cover url("${w.value.replace(/"/g, '%22')}")`;
      else if (w.type === 'video') { const v = h('video', { src: w.value, preload: 'metadata' }); v.muted = true; own.append(v, h('span.wp-tag', { html: Icons.video })); }
      else own.append(h('span.wp-plus', { html: Icons.upload }));
      grid.append(own);
      const solid = colorInput(w.type === 'color' ? w.value : '#333333', (v) => { hm.wallpaper = { type: 'color', value: v }; applyHome(); Store.save(); grid.querySelectorAll('.wp').forEach((x) => x.classList.remove('on')); });
      solid.classList.add('wp', 'wp-color');
      if (w.type === 'color') solid.classList.add('on');
      solid.dataset.tip = 'Solid color';
      grid.append(solid);

      const url = UI.field({ icon: Icons.link, placeholder: 'Or paste an image, GIF or video link', clearable: true,
        onEnter: (v) => { const u = v.trim(); if (/^https?:\/\/\S+$/i.test(u)) setWallpaperUrl(u); else UI.toast('Enter a valid http(s) link'); } });
      page.append(
        h('div.cp-card', null, grid,
          h('button.s-btn.primary.cp-wide', { html: `<span class="ico">${Icons.upload}</span>Upload an image, GIF or video…`, onclick: pickWallpaper }),
          h('div.cp-col', null, url.el),
          h('p.cp-hint', { text: 'Videos play muted and in a loop (MP4 or WebM). GIFs are animated too.' })),
        h('div.cp-card', null,
          rangeRow('Blur', hm.blur, 0, 30, 'px', (v) => { hm.blur = v; applyHome(); }),
          rangeRow('Darken', hm.dim, 0, 80, '%', (v) => { hm.dim = v; applyHome(); })));
    }

    if (cpTab === 'widgets') {
      const grid = h('div.wd-grid');
      Object.entries(WIDGETS).forEach(([key, label]) => {
        const cfg = hm.widgets[key];
        const hasOpts = !!widgetOptions(key, cfg);
        const tile = h('div.wd-tile' + (cfg.enabled ? '.on' : '') + (cpOpenWidget === key ? '.open' : ''), null,
          h('button.wd-main', { onclick: () => { cfg.enabled = !cfg.enabled; Store.save(); renderWidgets(); renderCustomize(); } },
            h('span.wd-ico', { html: Icons[WIDGET_ICONS[key]] || Icons.layout }), h('span.wd-name', { text: label }),
            h('span.wd-check', { html: Icons.check })),
          hasOpts && cfg.enabled ? h('button.wd-gear', { html: Icons.gear, 'data-tip': 'Options', onclick: () => { cpOpenWidget = cpOpenWidget === key ? null : key; renderCustomize(); } }) : null);
        grid.append(tile);
      });
      let opts = null;
      if (cpOpenWidget && hm.widgets[cpOpenWidget] && hm.widgets[cpOpenWidget].enabled) {
        const box = widgetOptions(cpOpenWidget, hm.widgets[cpOpenWidget]);
        if (box) opts = h('div.cp-card.wd-opts', null,
          h('div.cp-row', null, h('b', { text: WIDGETS[cpOpenWidget] + ' options' }), h('button.gear-btn', { html: Icons.x, onclick: () => { cpOpenWidget = null; renderCustomize(); } })), box);
      }
      page.append(
        h('div.cp-actions.cp-top-actions', null,
          h('button.s-btn.primary', { html: `<span class="ico">${Icons.layout}</span>Move & resize`, onclick: () => setEditing(true) }),
          h('button.s-btn', { text: 'Reset positions', onclick: () => {
            const d = Store.defaultHome().widgets;
            for (const k in d) Object.assign(hm.widgets[k], { x: d[k].x, y: d[k].y, scale: d[k].scale || 1 });
            Store.save(); renderWidgets();
          } })),
        h('p.cp-hint', { text: 'Click a widget to show or hide it.' }),
        ...(opts ? [opts] : []), grid);
    }

    if (cpTab === 'pictures') {
      const imgs = hm.images || [];
      const thumbs = h('div.ci-thumbs', null, imgs.map((img) => {
        const t = h('button.ci-thumb', { 'data-tip': 'Options' }, h('img', { src: img.src, alt: '' }), h('span.ci-del', { html: Icons.x, 'data-tip': 'Delete' }));
        t.onclick = (e) => { if (e.target.closest('.ci-del')) removeImage(img); else imageOptions(img); };
        return t;
      }));
      const imgUrl = UI.field({ icon: Icons.link, placeholder: 'Or paste an image or GIF link', clearable: true,
        onEnter: (v) => { const u = v.trim(); if (!/^https?:\/\/\S+$/i.test(u)) return UI.toast('Enter a valid http(s) image URL'); addImages([u]); } });
      page.append(h('div.cp-card', null,
        h('button.s-btn.primary.cp-wide', { html: `<span class="ico">${Icons.image}</span>Add images or GIFs…`, onclick: pickImages }),
        h('div.cp-col', null, imgUrl.el),
        h('p.cp-hint', { text: 'Pictures float on your home page: drag them in “Move & resize”, right-click one for its options. You can also drop files on the page.' })),
        ...(imgs.length ? [h('div.cp-card', null, h('div.cp-label', { text: `On your home page (${imgs.length})` }), thumbs)] : []));
    }

    if (cpTab === 'style') {
      const themes = h('div.theme-grid');
      Object.entries(Store.THEMES).forEach(([name, t]) => {
        const on = S.theme.bg === t.bg && S.theme.accent === t.accent;
        themes.append(h('button.theme-chip' + (on ? '.on' : ''), { onclick: () => { Object.assign(S.theme, t); Browser.applyTheme(); Store.save(); renderCustomize(); } },
          h('span.sw', null, h('i', { style: { background: t.bg } }), h('i', { style: { background: t.panel } }), h('i', { style: { background: t.field } }), h('i', { style: { background: t.accent } })),
          h('span', { text: name })));
      });
      const custom = h('details.cp-more', null, h('summary', { text: 'Custom colors' }),
        ...[['bg', 'Window & sidebar'], ['panel', 'Content panel'], ['field', 'Fields & search bar'], ['text', 'Text'], ['accent', 'Accent'], ['card', 'Favorite cards']]
          .map(([k, label]) => row(label, colorInput(S.theme[k], (v) => { S.theme[k] = v; Browser.applyTheme(); Store.save(); }))),
        h('div.cp-actions', null, h('button.s-btn', { text: 'Reset colors', onclick: () => { Object.assign(S.theme, Store.THEMES.Graphite); Browser.applyTheme(); Store.save(); renderCustomize(); } })));
      page.append(
        h('div.cp-card', null, h('div.cp-label', { text: 'Theme' }), themes, custom),
        h('div.cp-card', null, h('div.cp-label', { text: 'Widgets' }),
          rangeRow('Background opacity', hm.widgetOpacity, 0, 100, '%', (v) => { hm.widgetOpacity = v; applyHome(); }),
          rangeRow('Rounded corners', hm.widgetRadius, 0, 28, 'px', (v) => { hm.widgetRadius = v; applyHome(); })),
        h('div.cp-actions', null, h('button.s-btn.danger', { text: 'Reset home page', onclick: async () => {
          if (!(await UI.confirm({ title: 'Reset home page?', message: 'Wallpaper, widgets, pictures and layout go back to default.', ok: 'Reset', danger: true }))) return;
          (S.home.images || []).forEach((img) => { if (img.src.startsWith('file:')) window.saturne.deleteHomeImage(img.src); });
          S.home = Store.defaultHome(); Store.save(); applyHome(); renderWidgets(); renderCustomize();
        } })));
    }

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
    } else if (key === 'analog') {
      box.append(row('Show numbers', UI.switch(cfg.numbers, (v) => { cfg.numbers = v; rerender(); })));
    } else if (key === 'calendar') {
      box.append(row('Week starts on Monday', UI.switch(cfg.mondayFirst, (v) => { cfg.mondayFirst = v; rerender(); })));
    } else if (key === 'links') {
      const list = h('div.opt-list');
      const draw = () => list.replaceChildren(...(cfg.items || []).map((it, i) => h('div.opt-item', null,
        h('span', { text: it.title || host(it.url) }),
        h('button.gear-btn', { html: Icons.x, 'data-tip': 'Remove', onclick: () => { cfg.items.splice(i, 1); rerender(); draw(); } }))));
      const f = UI.field({ icon: Icons.link, placeholder: 'Add a site (e.g. netflix.com) — Enter', clearable: true,
        onEnter: (v) => {
          const url = Store.resolveInput(v);
          if (!url || !/^https?:/.test(url) || /[?&]q=/.test(url)) return UI.toast('Enter a website address');
          if ((cfg.items || []).length >= 12) return UI.toast('Up to 12 links');
          cfg.items = cfg.items || [];
          const name = host(url).split('.').slice(-2, -1)[0] || host(url);
          cfg.items.push({ url, title: name.charAt(0).toUpperCase() + name.slice(1) });
          f.input.value = ''; rerender(); draw();
        } });
      draw();
      box.append(list, h('div.cp-col', null, f.el));
    } else if (key === 'timer') {
      const num = (label, k, max) => row(label, UI.select({ value: cfg[k], width: 110,
        options: (k === 'work' ? [15, 20, 25, 30, 45, 50, 60, 90] : [3, 5, 10, 15, 20]).filter((m) => m <= max).map((m) => ({ value: m, label: `${m} min` })),
        onChange: (v) => { cfg[k] = v; timerRun.running = false; timerRun.left = null; rerender(); } }));
      box.append(num('Focus', 'work', 90), num('Break', 'rest', 20));
    } else if (key === 'countdown') {
      const label = UI.field({ icon: null, placeholder: 'What are you counting down to?', value: cfg.label, clearable: false, onInput: (v) => { cfg.label = v; rerender(); } });
      const date = h('input.s-date', { type: 'date', value: cfg.date || '' });
      date.addEventListener('change', () => { cfg.date = date.value; rerender(); });
      box.append(h('div.cp-col', null, label.el), row('Date', date));
    } else if (key === 'worldclock') {
      const list = h('div.opt-list');
      const draw = () => list.replaceChildren(...(cfg.zones || []).map((z, i) => h('div.opt-item', null,
        h('span', { text: zoneName(z) }),
        h('button.gear-btn', { html: Icons.x, 'data-tip': 'Remove', onclick: () => { cfg.zones.splice(i, 1); rerender(); draw(); } }))));
      const add = UI.select({ value: '', width: 170, options: [{ value: '', label: 'Add a city…' }, ...Object.keys(ZONES).map((c) => ({ value: ZONES[c], label: c }))],
        onChange: (v) => {
          if (!v) return;
          cfg.zones = cfg.zones || [];
          if (!cfg.zones.includes(v) && cfg.zones.length < 6) cfg.zones.push(v);
          add.setValue(''); rerender(); draw();
        } });
      draw();
      box.append(list, row('City', add));
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
          { label: 'Change wallpaper (image, GIF, video)…', icon: Icons.image, onClick: pickWallpaper },
          { label: 'Add image or GIF…', icon: Icons.upload, onClick: pickImages },
        ] });
      });
      // drop pictures (files from Explorer, or images dragged from a website) onto the home page
      const home = $('home');
      const isImageDrag = (e) => [...(e.dataTransfer.types || [])].some((t) => t === 'Files' || t === 'text/uri-list');
      home.addEventListener('dragover', (e) => { if (isImageDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; home.classList.add('dropping'); } });
      home.addEventListener('dragleave', (e) => { if (e.target === home || !home.contains(e.relatedTarget)) home.classList.remove('dropping'); });
      home.addEventListener('drop', async (e) => {
        home.classList.remove('dropping');
        if (!isImageDrag(e)) return;
        e.preventDefault();
        const files = [...e.dataTransfer.files];
        if (files.length) {
          const urls = await window.saturne.importHomeImages(files);
          if (!urls.length) return UI.toast('Only images and GIFs can be added (PNG, JPG, GIF, WebP…)');
          return addImages(urls);
        }
        const u = (e.dataTransfer.getData('text/uri-list') || '').split('\n').find((x) => /^https?:\/\//i.test(x.trim()));
        if (u) addImages([u.trim()]);
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
      // the video wallpaper only plays while the home page is on screen
      const vid = $('home-wallpaper').querySelector('video');
      if (vid) { if (on) vid.play().catch(() => {}); else vid.pause(); }
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
