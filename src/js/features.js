// Saturne — reader mode, page translation, screenshots, picture-in-picture, saved passwords,
// Chrome extensions and the first-run welcome screen
(function () {
  const { h } = UI;
  const $ = (id) => document.getElementById(id);
  const sat = window.saturne;
  const B = Browser;
  const S = Store.state;
  const host = B.host;

  const cur = () => { const id = B.currentTabId; const r = id && B.rt.get(id); return r && r.wv && !B.isHome(B.currentTab()) ? { id, r, wv: r.wv, tab: B.currentTab() } : null; };
  const tabCtx = (tabId) => {
    if (!tabId || tabId === B.currentTabId) return cur();
    const r = B.rt.get(tabId), l = B.locate(tabId);
    return r && r.wv && l ? { id: tabId, r, wv: r.wv, tab: l.tab } : null;
  };
  // runs a function inside the page and returns its result
  const runInPage = (wv, fn, ...args) => wv.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);

  // =========================================================
  // Reader mode (F9): the article alone, in a clean layout
  // =========================================================
  // runs inside the web page: finds the main text and returns it as plain data (never as HTML)
  function extractArticle() {
    const abs = (u) => { try { return new URL(u, location.href).href; } catch { return ''; } };
    const meta = (s) => { const m = document.querySelector(s); return m ? (m.content || '').trim() : ''; };
    const title = meta('meta[property="og:title"]') || document.title || '';
    const byline = meta('meta[name="author"]') || meta('meta[property="article:author"]');
    const site = meta('meta[property="og:site_name"]') || location.hostname.replace(/^www\./, '');
    const BAD = /(^|[-_ ])(nav|navbar|menu|footer|sidebar|share|sharing|social|comments?|related|promo|advert|ads?|banner|cookie|newsletter|subscribe|breadcrumbs?|popup|modal|toolbar)([-_ ]|$)/i;
    const skipEl = (el) => {
      if (/^(SCRIPT|STYLE|NOSCRIPT|NAV|ASIDE|FOOTER|FORM|BUTTON|IFRAME|SVG|CANVAS|INPUT|SELECT|TEXTAREA|HEADER|DIALOG|TEMPLATE)$/.test(el.tagName)) return true;
      if (el.getAttribute('aria-hidden') === 'true' || el.hidden || el.getAttribute('role') === 'navigation') return true;
      const id = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
      if (BAD.test(id) && !/article|content|post|story|entry|body|main/i.test(id)) return true;
      const cs = getComputedStyle(el);
      return cs.display === 'none' || cs.visibility === 'hidden';
    };
    // the element holding most of the paragraphs' text
    const score = new Map();
    for (const p of document.querySelectorAll('p, pre, blockquote')) {
      const len = (p.textContent || '').trim().length;
      if (len < 30) continue;
      let el = p.parentElement, w = 1;
      for (let i = 0; el && i < 3; i++, el = el.parentElement, w /= 2) score.set(el, (score.get(el) || 0) + len * w);
    }
    let best = null, bestS = 0;
    for (const [el, s] of score) if (s > bestS && el !== document.documentElement) { best = el; bestS = s; }
    const art = best && best.closest('article');
    if (art && art.textContent.length < best.textContent.length * 2.2) best = art;
    if (!best) best = document.querySelector('article, main, [role=main]') || document.body;

    const blocks = [];
    let chars = 0;
    const inline = (el) => {
      const segs = [];
      const rec = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) { const t = c.nodeValue.replace(/\s+/g, ' '); if (t) segs.push({ x: t }); }
          else if (c.nodeType === 1 && !skipEl(c)) {
            if (c.tagName === 'A' && /^https?:/.test(c.href)) { const t = c.textContent.replace(/\s+/g, ' '); if (t.trim()) segs.push({ x: t, h: c.href }); }
            else if (c.tagName === 'BR') segs.push({ x: '\n' });
            else if (/^(STRONG|B)$/.test(c.tagName)) { const t = c.textContent.replace(/\s+/g, ' '); if (t) segs.push({ x: t, b: 1 }); }
            else if (/^(EM|I)$/.test(c.tagName)) { const t = c.textContent.replace(/\s+/g, ' '); if (t) segs.push({ x: t, i: 1 }); }
            else if (c.tagName === 'CODE') { const t = c.textContent; if (t) segs.push({ x: t, c: 1 }); }
            else if (c.tagName !== 'IMG') rec(c);
          }
        }
      };
      rec(el);
      return segs;
    };
    const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
    const imgOf = (i) => abs(i.currentSrc || i.getAttribute('data-src') || i.getAttribute('data-lazy-src') || i.src || '');
    const addImg = (i) => {
      const src = imgOf(i);
      if (!src || /^data:/.test(src) && src.length < 400) return;
      if ((i.naturalWidth || i.width || 0) < 120 && (i.naturalHeight || i.height || 0) < 120) return;
      blocks.push({ t: 'img', src, alt: i.alt || '' });
    };
    const walk = (el) => {
      for (const c of el.children) {
        if (blocks.length > 3000) return;
        if (skipEl(c)) continue;
        const tn = c.tagName;
        if (/^H[1-6]$/.test(tn)) { const t = text(c); if (t && t !== title.trim()) blocks.push({ t: 'h', l: Math.min(4, Math.max(2, Number(tn[1]))), x: t }); }
        else if (tn === 'P') {
          const s = inline(c);
          const len = s.reduce((a, b) => a + b.x.trim().length, 0);
          if (len > 1) { blocks.push({ t: 'p', s }); chars += len; }
          c.querySelectorAll('img').forEach(addImg);
        } else if (tn === 'IMG') addImg(c);
        else if (tn === 'PICTURE') { const i = c.querySelector('img'); if (i) addImg(i); }
        else if (tn === 'FIGCAPTION') { const t = text(c); if (t) blocks.push({ t: 'cap', x: t }); }
        else if (tn === 'UL' || tn === 'OL') {
          const items = [...c.children].filter((li) => li.tagName === 'LI' && !skipEl(li)).map(inline).filter((s) => s.some((x) => x.x.trim()));
          if (items.length) { blocks.push({ t: tn === 'OL' ? 'ol' : 'ul', items }); chars += text(c).length; }
        } else if (tn === 'PRE') blocks.push({ t: 'pre', x: c.textContent });
        else if (tn === 'BLOCKQUOTE') { const t = text(c); if (t) { blocks.push({ t: 'q', x: t }); chars += t.length; } }
        else if (tn === 'HR') blocks.push({ t: 'hr' });
        else if (tn === 'TABLE') continue;
        else if ([...c.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim().length > 60)) {
          const s = inline(c); blocks.push({ t: 'p', s }); chars += text(c).length;
        } else walk(c);
      }
    };
    walk(best);
    return { title, byline, site, chars, blocks, lang: document.documentElement.lang || '', url: location.href };
  }

  const READER_THEMES = { light: 'Light', sepia: 'Sepia', dark: 'Dark' };
  const rprefs = () => (S.settings.reader = Object.assign({ size: 19, font: 'serif', theme: 'sepia', width: 700 }, S.settings.reader || {}));
  const Reader = {
    el: null, tabId: null, url: '',
    isOn() { return !!this.tabId && this.tabId === B.currentTabId; },
    async toggle() {
      if (this.isOn()) return this.close();
      const c = cur();
      if (!c) return UI.toast('Open a web page to use reader mode');
      let data;
      try { data = await runInPage(c.wv, extractArticle); } catch { data = null; }
      if (!data || data.chars < 400) return UI.toast('This page doesn’t look like an article', 2600);
      this.tabId = c.id; this.url = c.tab.url;
      this.render(data);
    },
    render(data) {
      if (this.el) this.el.remove();
      const P = rprefs();
      const art = h('article.rd-art');
      const minutes = Math.max(1, Math.round(data.chars / 1100));
      // "Title - Site name" -> "Title"
      const short = data.title.replace(/\s+[-|–—·]\s+[^-|–—·]{2,40}$/, '').trim();
      const title = short.length >= 2 ? short : data.title;
      art.append(h('div.rd-site', { text: data.site }), h('h1', { text: title }),
        h('div.rd-meta', { text: [data.byline, `${minutes} min read`].filter(Boolean).join(' · ') }));
      const segs = (list) => {
        const frag = document.createDocumentFragment();
        for (const s of list) {
          let n;
          if (s.h) {
            n = h('a', { text: s.x, href: s.h });
            n.addEventListener('click', (e) => { e.preventDefault(); if (e.ctrlKey || e.button === 1) B.newTab(s.h, { background: true }); else { this.close(); B.navigate(s.h); } });
          } else if (s.b) n = h('strong', { text: s.x });
          else if (s.i) n = h('em', { text: s.x });
          else if (s.c) n = h('code', { text: s.x });
          else if (s.x === '\n') n = h('br');
          else n = document.createTextNode(s.x);
          frag.append(n);
        }
        return frag;
      };
      const seen = new Set();
      for (const b of data.blocks) {
        if (b.t === 'p') { const p = h('p'); p.append(segs(b.s)); art.append(p); }
        else if (b.t === 'h') art.append(h('h' + b.l, { text: b.x }));
        else if (b.t === 'img') {
          if (seen.has(b.src)) continue; seen.add(b.src);
          const img = h('img', { src: b.src, alt: b.alt, loading: 'lazy', referrerpolicy: 'no-referrer' });
          img.onerror = () => img.remove();
          art.append(img);
        } else if (b.t === 'cap') art.append(h('div.rd-cap', { text: b.x }));
        else if (b.t === 'ul' || b.t === 'ol') { const l = h(b.t); b.items.forEach((it) => { const li = h('li'); li.append(segs(it)); l.append(li); }); art.append(l); }
        else if (b.t === 'pre') art.append(h('pre', { text: b.x }));
        else if (b.t === 'q') art.append(h('blockquote', { text: b.x }));
        else if (b.t === 'hr') art.append(h('hr'));
      }
      const btn = (html, tip, fn, cls = '') => h('button.rd-btn' + cls, { html, 'data-tip': tip, onclick: fn });
      const apply = () => {
        this.el.dataset.theme = P.theme;
        this.el.style.setProperty('--rd-size', P.size + 'px');
        this.el.style.setProperty('--rd-width', P.width + 'px');
        this.el.classList.toggle('sans', P.font === 'sans');
        this.el.querySelectorAll('.rd-theme').forEach((b) => b.classList.toggle('on', b.dataset.t === P.theme));
        fontBtn.textContent = P.font === 'sans' ? 'Sans' : 'Serif';
        Store.save();
      };
      const fontBtn = h('button.rd-btn.rd-font', { 'data-tip': 'Font', onclick: () => { P.font = P.font === 'sans' ? 'serif' : 'sans'; apply(); } });
      const bar = h('div.rd-bar', null,
        h('span.rd-label', null, h('span', { html: Icons.reader }), h('span', { text: 'Reader' })),
        h('span.rd-grow'),
        btn('A−', 'Smaller text', () => { P.size = Math.max(14, P.size - 1); apply(); }, '.txt'),
        btn('A+', 'Bigger text', () => { P.size = Math.min(30, P.size + 1); apply(); }, '.txt'),
        fontBtn,
        btn(Icons.dockRight, 'Narrower / wider', () => { P.width = P.width >= 900 ? 600 : P.width + 150; apply(); }),
        h('span.rd-sep'),
        ...Object.entries(READER_THEMES).map(([k, v]) => h('button.rd-theme', { dataset: { t: k }, 'data-tip': v, onclick: () => { P.theme = k; apply(); } })),
        h('span.rd-sep'),
        btn(Icons.x, 'Exit reader mode  (F9)', () => this.close()));
      const scroll = h('div.rd-scroll', null, art);
      this.el = h('div#reader', null, bar, scroll);
      this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
      $('content').append(this.el);
      apply();
      scroll.tabIndex = -1;
      setTimeout(() => scroll.focus(), 30);
      paintActions();
    },
    close() {
      const el = this.el;
      const id = this.tabId;
      this.el = null; this.tabId = null;
      if (el) { el.classList.add('leaving'); setTimeout(() => el.remove(), 180); }
      paintActions();
      const r = id && B.rt.get(id);
      if (r && r.wv && id === B.currentTabId) r.wv.focus();
    },
    sync() {
      if (!this.tabId) return;
      const l = B.locate(this.tabId);
      if (this.tabId !== B.currentTabId || !l || l.tab.url !== this.url) this.close();
    },
  };

  // =========================================================
  // Translate the page (Google Translate)
  // =========================================================
  const LANGS = [['fr', 'Français'], ['en', 'English'], ['es', 'Español'], ['de', 'Deutsch'], ['it', 'Italiano'], ['pt', 'Português'],
    ['ar', 'العربية'], ['nl', 'Nederlands'], ['tr', 'Türkçe'], ['pl', 'Polski'], ['ru', 'Русский'], ['uk', 'Українська'],
    ['zh-CN', '中文'], ['ja', '日本語'], ['ko', '한국어'], ['hi', 'हिन्दी']];
  const langName = (code) => { const l = LANGS.find((x) => x[0].toLowerCase() === String(code || '').toLowerCase()); return l ? l[1] : (code || '?').toUpperCase(); };

  // runs inside the page: collects the visible text, and keeps the originals to restore them
  function collectText() {
    const T = window.__saturneTr || (window.__saturneTr = { nodes: [], orig: [] });
    T.nodes.forEach((n, i) => { n.nodeValue = T.orig[i]; });
    T.nodes = []; T.orig = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest('script,style,noscript,code,pre,textarea,svg,math,kbd,samp,[translate=no],.notranslate,[contenteditable=""],[contenteditable=true]')) return NodeFilter.FILTER_REJECT;
        return /\p{L}/u.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    let n, total = 0;
    while ((n = walker.nextNode()) && T.nodes.length < 5000 && total < 200000) { T.nodes.push(n); T.orig.push(n.nodeValue); total += n.nodeValue.length; }
    // what's on screen first, so the visible part is translated in a second or two
    const vh = innerHeight;
    const order = T.nodes.map((x, i) => { const r = x.parentElement.getBoundingClientRect(); return { i, v: r.bottom > -50 && r.top < vh * 1.5 && r.width ? 0 : 1 }; });
    order.sort((a, b) => a.v - b.v || a.i - b.i);
    T.nodes = order.map((o) => T.nodes[o.i]); T.orig = order.map((o) => T.orig[o.i]);
    T.apply = (start, list) => list.forEach((t, i) => {
      const node = T.nodes[start + i];
      if (!node || t == null) return;
      const o = T.orig[start + i];
      node.nodeValue = o.match(/^\s*/)[0] + t + o.match(/\s*$/)[0];
    });
    T.restore = () => { T.nodes.forEach((x, i) => { x.nodeValue = T.orig[i]; }); T.nodes = []; T.orig = []; };
    return T.orig.map((x) => x.trim());
  }

  const trState = new Map(); // tabId -> { to, from, url, busy }
  const Translate = {
    async run(tabId, to) {
      const c = tabCtx(tabId);
      if (!c) return UI.toast('Open a web page to translate it');
      S.settings.translateTo = to; Store.save();
      const st = { to, from: '', url: c.tab.url, busy: true, done: 0, total: 0, closed: false };
      trState.set(c.id, st);
      bar.paint();
      let texts;
      try { texts = await runInPage(c.wv, collectText); } catch { texts = null; }
      if (!texts || !texts.length) { trState.delete(c.id); bar.paint(); return UI.toast('There is no text to translate on this page'); }
      // batches of ~4500 characters, 3 at a time
      const batches = [];
      for (let i = 0; i < texts.length;) {
        let len = 0; const start = i; const list = [];
        while (i < texts.length && list.length < 100 && (len + texts[i].length < 4500 || !list.length)) { list.push(texts[i]); len += texts[i].length; i++; }
        batches.push({ start, list });
      }
      st.total = texts.length;
      let failed = null;
      const langs = {};
      const work = async () => {
        while (batches.length && trState.get(c.id) === st) {
          const b = batches.shift();
          let res;
          try { res = await sat.translate(b.list, to); } catch (err) { res = { error: err.message }; }
          if (!res || res.error) { failed = (res && res.error) || 'The translation service didn’t answer.'; return; }
          res.items.forEach((x) => { if (x.lang) langs[x.lang] = (langs[x.lang] || 0) + 1; });
          if (trState.get(c.id) !== st) return;
          await c.wv.executeJavaScript(`window.__saturneTr && window.__saturneTr.apply(${b.start}, ${JSON.stringify(res.items.map((x) => x.text))})`).catch(() => {});
          st.done += b.list.length;
          st.from = Object.entries(langs).sort((a, b2) => b2[1] - a[1])[0][0];
          bar.paint();
        }
      };
      await Promise.all([work(), work(), work(), work()]);
      if (trState.get(c.id) !== st) return;
      st.busy = false;
      if (failed) { UI.toast('Translation failed: ' + failed, 4000); this.restore(c.id); return; }
      if (st.from && st.from.split('-')[0] === to.split('-')[0]) { UI.toast(`This page is already in ${langName(to)}`); this.restore(c.id); return; }
      bar.paint();
    },
    restore(tabId) {
      const c = tabCtx(tabId);
      trState.delete(tabId || B.currentTabId);
      if (c) c.wv.executeJavaScript('window.__saturneTr && window.__saturneTr.restore()').catch(() => {});
      bar.paint();
    },
    items(tabId) {
      const id = tabId || B.currentTabId;
      const st = trState.get(id);
      const want = S.settings.translateTo || (navigator.language || 'fr').split('-')[0];
      const first = LANGS.find((l) => l[0] === want) ? want : 'fr';
      const order = [LANGS.find((l) => l[0] === first), ...LANGS.filter((l) => l[0] !== first)];
      return [
        { header: 'Translate to' },
        ...order.map(([k, v]) => ({ label: v, checked: !!st && st.to === k, onClick: () => this.run(id, k) })),
        { sep: true },
        { label: 'Show original', checked: !st, disabled: !st, onClick: () => this.restore(id) },
      ];
    },
    sync() {
      for (const [id, st] of trState) {
        const l = B.locate(id), r = B.rt.get(id);
        if (!l || !r || !r.wv || l.tab.url !== st.url) trState.delete(id); // navigated away: the new page is in its own language
      }
      bar.paint();
    },
  };
  const bar = {
    el: null,
    paint() {
      const st = trState.get(B.currentTabId);
      paintActions();
      if (!st) { this.key = ''; if (this.el) this.el.classList.remove('open'); return; }
      const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
      const key = [B.currentTabId, st.to, st.from, st.busy, pct, st.closed].join('|');
      if (key === this.key) return; // nothing changed
      this.key = key;
      if (!this.el) { this.el = h('div#trbar'); $('content').append(this.el); }
      if (st.closed) { this.el.classList.remove('open'); return; }
      const pick = h('button.tr-lang', { onclick: (e) => Menu.open({ anchor: e.currentTarget, items: Translate.items() }) }, h('span', { text: langName(st.to) }), h('span.chev', { html: Icons.chevDown }));
      this.el.replaceChildren(
        h('span.tr-ico', { html: Icons.translate }),
        st.busy
          ? h('span', { text: `Translating${st.from ? ' from ' + langName(st.from) : ''}… ${pct}%` })
          : h('span', { text: `Translated${st.from ? ' from ' + langName(st.from) : ''} to` }),
        pick,
        h('button.s-btn.ghost.tr-orig', { text: 'Show original', onclick: () => Translate.restore() }),
        h('button.icon-btn.tr-x', { html: Icons.x, 'data-tip': 'Close', onclick: () => { if (st.busy) Translate.restore(); else { st.closed = true; this.paint(); } } }));
      this.el.classList.add('open');
    },
  };

  // =========================================================
  // Screenshots (visible part, an area, or the whole page)
  // =========================================================
  function actionToast(msg, actions, ms = 6000) {
    const t = h('div.toast.act-toast', null, h('span', { text: msg }), ...actions.map(([label, fn]) => h('button', { text: label, onclick: () => { fn(); t.remove(); } })));
    $('toasts').append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
  }
  async function takeShot(mode, rect) {
    const c = cur();
    if (!c || !c.r.wcId) return UI.toast('Open a web page to take a screenshot');
    if (mode === 'area' && !rect) return pickArea(c);
    let wait = null;
    if (mode === 'full') { wait = h('div.toast', { text: 'Capturing the whole page… (long pages take a few seconds)' }); $('toasts').append(wait); }
    const res = await sat.screenshot(c.r.wcId, mode, rect);
    if (wait) wait.remove();
    if (!res || res.error) return UI.toast('Screenshot failed' + (res && res.error ? ': ' + res.error : ''), 4000);
    $('content').classList.remove('flash'); void $('content').offsetWidth; $('content').classList.add('flash');
    actionToast(`Screenshot copied and saved (${res.width}×${res.height})`, [['Open', () => sat.openPath(res.path)], ['Show in folder', () => sat.showItem(res.path)]]);
  }
  // drag a rectangle over the page
  function pickArea(c) {
    const box = c.wv.getBoundingClientRect();
    const ov = h('div#shot-pick', { style: { left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' } });
    const sel = h('div.shot-sel');
    const size = h('div.shot-size');
    const tools = h('div.shot-tools', null,
      h('span', { text: 'Drag to select an area' }),
      h('button.s-btn.ghost', { html: Icons.window + '<span>Visible part</span>', onclick: (e) => { e.stopPropagation(); done(); takeShot('visible'); } }),
      h('button.s-btn.ghost', { html: Icons.file + '<span>Full page</span>', onclick: (e) => { e.stopPropagation(); done(); takeShot('full'); } }),
      h('button.icon-btn', { html: Icons.x, 'data-tip': 'Cancel  (Esc)', onclick: (e) => { e.stopPropagation(); done(); } }));
    ov.append(sel, size, tools);
    $('layer').append(ov);
    let start = null;
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(); } };
    function done() { document.removeEventListener('keydown', key, true); ov.remove(); }
    document.addEventListener('keydown', key, true);
    ov.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.shot-tools')) return;
      ov.setPointerCapture(e.pointerId);
      start = { x: e.clientX - box.left, y: e.clientY - box.top };
      ov.classList.add('drawing');
    });
    let rect = null;
    ov.addEventListener('pointermove', (e) => {
      if (!start) return;
      const x = UI.clamp(e.clientX - box.left, 0, box.width), y = UI.clamp(e.clientY - box.top, 0, box.height);
      rect = { x: Math.min(x, start.x), y: Math.min(y, start.y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) };
      Object.assign(sel.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px', display: 'block' });
      size.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
      Object.assign(size.style, { left: rect.x + 'px', top: Math.max(0, rect.y - 26) + 'px', display: 'block' });
    });
    ov.addEventListener('pointerup', () => {
      if (!start) return;
      start = null;
      const r = rect;
      done();
      if (r && r.width > 4 && r.height > 4) setTimeout(() => takeShot('area', r), 60); // let the overlay disappear first
    });
  }

  // =========================================================
  // Picture-in-picture
  // =========================================================
  async function pip(tabId, x, y) {
    const c = tabCtx(tabId);
    if (!c) return UI.toast('Open a page with a video first');
    const res = await runInPage(c.wv, async (px, py) => {
      if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return 'exit'; }
      let v = px != null ? document.elementFromPoint(px, py) : null;
      v = v && (v.closest('video') || (v.querySelector && v.querySelector('video')));
      if (!v) {
        const vids = [...document.querySelectorAll('video')].filter((x2) => x2.readyState > 0);
        v = vids.find((x2) => !x2.paused) || vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      }
      if (!v) return 'none';
      v.disablePictureInPicture = false;
      try { await v.requestPictureInPicture(); return 'ok'; } catch (e) { return 'error:' + e.message; }
    }, x == null ? null : x, y == null ? null : y).catch((e) => 'error:' + e.message);
    if (res === 'none') UI.toast('No video on this page (videos inside embedded players can’t be detached)', 3500);
    else if (String(res).startsWith('error')) UI.toast('Picture-in-picture isn’t available for this video', 3000);
  }

  // =========================================================
  // Saved passwords
  // =========================================================
  const pwQueue = [];
  const Pw = {
    el: null,
    sync() {
      for (const q of [...pwQueue]) if (B.tabOfWc(q.wcId) == null) { pwQueue.splice(pwQueue.indexOf(q), 1); sat.answerPassword(q.id, 'dismiss'); }
      const r = B.currentTabId && B.rt.get(B.currentTabId);
      const o = pwQueue.find((q) => r && q.wcId === r.wcId);
      if (!o) { this.shown = null; if (this.el) this.el.classList.remove('open'); return; }
      if (this.shown === o) return; // already on screen
      this.shown = o;
      if (!this.el) { this.el = h('div#pwprompt'); $('content').append(this.el); }
      const answer = (a) => { pwQueue.splice(pwQueue.indexOf(o), 1); sat.answerPassword(o.id, a); if (a === 'save') UI.toast(o.update ? 'Password updated' : 'Password saved'); this.sync(); };
      this.el.replaceChildren(
        h('div.perm-head', null, h('span.perm-ico', { html: Icons.key }), h('b', { text: o.update ? 'Update saved password?' : 'Save password?' })),
        h('div.pw-site', { text: host(o.origin) }),
        h('div.pw-cred', null, h('span', { text: o.username || '(no username)' }), h('span.pw-dots', { text: '••••••••' })),
        h('p.pw-note', { text: 'Saturne fills it in next time. Passwords stay on this PC, encrypted for your Windows account.' }),
        h('div.actions', null,
          o.update ? null : h('button.s-btn.ghost', { text: 'Never for this site', onclick: () => answer('never') }),
          h('button.s-btn.ghost', { text: 'Not now', onclick: () => answer('dismiss') }),
          h('button.s-btn.primary', { text: o.update ? 'Update' : 'Save', onclick: () => answer('save') })));
      this.el.classList.add('open');
    },
    manage() {
      UI.modal({
        title: 'Passwords', wide: true,
        body(box, close) {
          const list = h('div.pw-list');
          let data = { logins: [], never: [] };
          const draw = (q = '') => {
            const ql = q.toLowerCase();
            const items = data.logins.filter((x) => !ql || (x.origin + ' ' + x.u).toLowerCase().includes(ql)).sort((a, b) => host(a.origin).localeCompare(host(b.origin)));
            const rows = items.map((x) => {
              const pwEl = h('span.pw-val', { text: '••••••••' });
              let shown = false;
              const eye = h('button.gear-btn', { html: Icons.eye, 'data-tip': 'Show password', onclick: async () => {
                shown = !shown;
                pwEl.textContent = shown ? (await sat.revealPassword(x.origin, x.u)) || '' : '••••••••';
                eye.innerHTML = shown ? Icons.eyeOff : Icons.eye; eye.dataset.tip = shown ? 'Hide password' : 'Show password';
                pwEl.classList.toggle('shown', shown);
              } });
              const img = h('img', { src: Store.faviconFor(x.origin) });
              img.onerror = () => { img.style.visibility = 'hidden'; };
              return h('div.pw-row', null, img,
                h('div.pw-who', null, h('b', { text: host(x.origin) }), h('span', { text: x.u || '(no username)' })),
                pwEl, eye,
                h('button.gear-btn', { html: Icons.copy, 'data-tip': 'Copy password', onclick: async () => { sat.copyText((await sat.revealPassword(x.origin, x.u)) || ''); UI.toast('Password copied'); } }),
                h('button.gear-btn', { html: Icons.trash, 'data-tip': 'Delete', onclick: async () => {
                  if (!(await UI.confirm({ title: 'Delete this password?', message: `${x.u || 'The login'} on ${host(x.origin)} will be removed from Saturne.`, ok: 'Delete', danger: true }))) return;
                  sat.deletePassword(x.origin, x.u); load();
                } }));
            });
            list.replaceChildren(...(rows.length ? rows : [h('p.pw-empty', { text: q ? 'No results' : 'No saved passwords yet. When you sign in to a site, Saturne offers to save the password.' })]));
            if (data.never.length && !q) {
              list.append(h('div.h-day', { text: 'Never saved for' }), ...data.never.map((o) => h('div.pw-row.never', null,
                h('div.pw-who', null, h('b', { text: host(o) })),
                h('button.s-btn.ghost', { text: 'Remove', onclick: () => { sat.deletePassword(o, null); load(); } }))));
            }
          };
          const fld = UI.field({ placeholder: 'Search passwords', onInput: draw });
          const load = async () => { data = (await sat.passwords()) || data; draw(fld.input.value); };
          box.append(fld.el, CustomScroll.wrap(list, 'pw-scroll'), h('div.actions', null, h('button.s-btn.primary', { text: 'Done', onclick: close })));
          load();
        },
      });
    },
  };
  sat.onPasswordOffer((o) => { pwQueue.push(o); Pw.sync(); });

  // =========================================================
  // Chrome extensions
  // =========================================================
  const STORE_RE = /^https:\/\/(chromewebstore\.google\.com\/detail\/[^?#]*?|chrome\.google\.com\/webstore\/detail\/[^?#]*?)([a-p]{32})/;
  let extCache = [];
  const refreshExt = async () => { extCache = (await sat.extensions()) || []; paintActions(); return extCache; };
  async function installExt(input) {
    UI.toast('Installing the extension…', 1500);
    const r = await sat.installExtension(input);
    if (!r || r.error) { UI.toast('Couldn’t install it: ' + ((r && r.error) || 'unknown error'), 5000); return false; }
    extCache = r.list; paintActions();
    const added = r.list.find((x) => input.includes(x.key));
    UI.toast(`${added ? added.name : 'Extension'} added to Saturne`, 3000);
    return true;
  }
  function extPopup(x, anchor) {
    if (!x.popup) {
      if (x.options) return B.newTab(x.options);
      return UI.toast(`${x.name} works on its own on web pages (it has no menu)`, 3000);
    }
    const wv = document.createElement('webview');
    wv.setAttribute('partition', sat.partition);
    wv.setAttribute('src', x.popup);
    wv.setAttribute('autosize', 'on');
    wv.setAttribute('minwidth', '220'); wv.setAttribute('minheight', '60');
    wv.setAttribute('maxwidth', '780'); wv.setAttribute('maxheight', '580');
    const box = h('div.ext-pop', null, wv);
    const a = anchor.getBoundingClientRect();
    box.style.top = a.bottom + 8 + 'px';
    box.style.right = Math.max(8, window.innerWidth - a.right) + 'px';
    $('layer').append(box);
    const close = () => { box.remove(); document.removeEventListener('mousedown', out, true); document.removeEventListener('keydown', esc, true); };
    const out = (e) => { if (!box.contains(e.target)) close(); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    setTimeout(() => { document.addEventListener('mousedown', out, true); document.addEventListener('keydown', esc, true); }, 0);
    wv.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== wv) close(); }, 150));
    wv.addEventListener('dom-ready', () => wv.focus(), { once: true });
  }
  async function extMenu(btn) {
    if (Menu.justClosed(btn)) return;
    const list = await refreshExt();
    const on = list.filter((x) => x.enabled);
    const c = cur();
    const m = c && STORE_RE.exec(c.tab.url);
    Menu.open({
      anchor: btn, align: 'right', minWidth: 260,
      items: [
        { header: 'Extensions' },
        ...(on.length ? on.map((x) => ({ label: x.name, img: x.icon || undefined, icon: x.icon ? undefined : Icons.puzzle, onClick: () => extPopup(x, btn) }))
          : [{ label: 'No extension yet', disabled: true }]),
        m && !list.some((x) => x.key === m[2]) ? { label: 'Add this extension to Saturne', icon: Icons.plus, onClick: () => installExt(c.tab.url) } : null,
        { sep: true },
        { label: 'Get extensions (Chrome Web Store)', icon: Icons.open, onClick: () => B.newTab('https://chromewebstore.google.com/') },
        { label: 'Manage extensions…', icon: Icons.gear, onClick: manageExt },
      ],
    });
  }
  function manageExt() {
    UI.modal({
      title: 'Extensions', wide: true,
      body(box, close) {
        const list = h('div.ext-list');
        const draw = (items) => {
          extCache = items; paintActions();
          list.replaceChildren(...(items.length ? items.map((x) => {
            const sw = UI.switch(x.enabled, async (v) => draw((await sat.toggleExtension(x.key, v)) || items));
            const ico = h('span.ext-ico', { html: x.icon ? '' : Icons.puzzle });
            if (x.icon) ico.append(h('img', { src: x.icon }));
            return h('div.ext-row' + (x.enabled ? '' : '.off'), null, ico,
              h('div.ext-txt', null, h('b', { text: x.name }), h('span', { text: [x.version && 'v' + x.version, x.source === 'folder' ? 'from a folder' : 'Chrome Web Store'].filter(Boolean).join(' · ') }),
                x.description ? h('span.ext-desc', { text: x.description }) : null, x.error ? h('span.ext-err', { text: x.error }) : null),
              x.options && x.enabled ? h('button.gear-btn', { html: Icons.gear, 'data-tip': 'Options', onclick: () => { close(); B.newTab(x.options); } }) : null,
              h('button.gear-btn', { html: Icons.trash, 'data-tip': 'Remove', onclick: async () => {
                if (!(await UI.confirm({ title: `Remove ${x.name}?`, message: 'The extension and its settings will be removed from this profile.', ok: 'Remove', danger: true }))) return;
                draw((await sat.removeExtension(x.key)) || items);
              } }),
              sw);
          }) : [h('p.pw-empty', { text: 'No extension yet. Paste a Chrome Web Store link below, or open the store and use the puzzle button next to the address bar.' })]));
        };
        const fld = UI.field({ icon: Icons.link, placeholder: 'Chrome Web Store link or extension id' });
        const add = h('button.s-btn.primary', { text: 'Install', onclick: async () => {
          const v = fld.input.value.trim();
          if (!v) return;
          add.disabled = true;
          if (await installExt(v)) { fld.input.value = ''; draw(extCache); }
          add.disabled = false;
        } });
        fld.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add.click(); });
        box.append(
          h('p', { text: 'Saturne runs Chrome extensions with Electron, which supports part of Chrome’s extension features: extensions that change pages (dark mode, ad blocking, styling…) work best; some menus and features may not work.' }),
          h('div.ext-add', null, fld.el, add),
          CustomScroll.wrap(list, 'ext-scroll'),
          h('div.actions', null,
            h('button.s-btn.ghost', { text: 'Load unpacked folder…', onclick: async () => {
              const r = await sat.loadUnpackedExtension();
              if (r && r.error) UI.toast(r.error, 4000); else if (r && r.list) draw(r.list);
            } }),
            h('button.s-btn.ghost', { text: 'Open Chrome Web Store', onclick: () => { close(); B.newTab('https://chromewebstore.google.com/'); } }),
            h('button.s-btn.primary', { text: 'Done', onclick: close })));
        refreshExt().then(draw);
      },
    });
  }

  // =========================================================
  // Address bar buttons: reader, translate, store install, extensions
  // =========================================================
  const acts = h('div#url-actions');
  const aReader = h('button.url-act', { html: Icons.reader, 'data-tip': 'Reader mode  (F9)', onclick: () => Reader.toggle() });
  const aTr = h('button.url-act', { html: Icons.translate, 'data-tip': 'Translate page', onclick: (e) => { if (!Menu.justClosed(aTr)) Menu.open({ anchor: aTr, align: 'right', items: Translate.items() }); } });
  const aStore = h('button.url-chip', { html: Icons.plus + '<span>Add to Saturne</span>', onclick: () => { const c = cur(); if (c) installExt(c.tab.url); } });
  const aExt = h('button.url-act', { html: Icons.puzzle, 'data-tip': 'Extensions', onclick: () => extMenu(aExt) });
  acts.append(aStore, aReader, aTr, aExt);
  $('urlbar').append(acts);
  function paintActions() {
    const c = cur();
    aReader.hidden = !c; aTr.hidden = !c;
    aReader.classList.toggle('on', Reader.isOn());
    aTr.classList.toggle('on', !!trState.get(B.currentTabId));
    const m = c && STORE_RE.exec(c.tab.url);
    aStore.hidden = !m || extCache.some((x) => x.key === m[2]);
  }
  refreshExt();

  // =========================================================
  // First-run welcome screen
  // =========================================================
  function welcome() {
    const prof = sat.profiles();
    const me = prof.list.find((p) => p.id === prof.active) || prof.list[0];
    let step = 0;
    const steps = [];
    const stage = h('div.wl-stage');
    const dots = h('div.wl-dots');
    const back = h('div.wl-back', null, h('div.wl-box', null, stage, h('div.wl-foot', null, dots, h('span.wl-grow'),
      h('button.s-btn.ghost.wl-skip', { text: 'Skip', onclick: () => finish() }))));
    const finish = () => {
      S.settings.onboarded = true; Store.save();
      back.classList.add('leaving');
      setTimeout(() => back.remove(), 300);
    };
    const go = (i) => {
      step = i;
      const page = steps[i]();
      page.classList.add('wl-page');
      stage.replaceChildren(page);
      dots.replaceChildren(...steps.map((_, k) => h('i' + (k === i ? '.on' : ''))));
      back.querySelector('.wl-skip').hidden = i === steps.length - 1;
      const f = page.querySelector('input, .primary'); if (f) setTimeout(() => f.focus(), 350);
    };
    const next = () => go(step + 1);
    const nav = (onNext = next) => h('div.wl-nav', null,
      step > 0 ? h('button.s-btn.ghost', { text: 'Back', onclick: () => go(step - 1) }) : null,
      h('button.s-btn.primary', { text: 'Continue', onclick: onNext }));

    steps.push(() => h('div.wl-hero', null,
      h('div.wl-logo', { html: Icons.saturn }),
      h('h1', { text: 'Welcome to Saturne' }),
      h('p', { text: 'A browser with spaces, split view, reader mode, a home page you design yourself, and lots more. Let’s set it up in a few seconds.' }),
      h('div.wl-nav', null, h('button.s-btn.primary.wl-big', { text: 'Get started', onclick: next }))));

    steps.push(() => {
      const name = h('input.wl-input', { type: 'text', placeholder: 'Your name', value: me && me.name !== 'Me' ? me.name : '', maxLength: 32 });
      const grid = h('div.wl-themes');
      const paint = () => grid.querySelectorAll('.wl-theme').forEach((b) => b.classList.toggle('on', b.dataset.t === S.theme.bg));
      Object.entries(Store.THEMES).forEach(([k, t]) => {
        const b = h('button.wl-theme', { dataset: { t: t.bg }, onclick: () => { Object.assign(S.theme, t); B.applyTheme(); Store.save(); paint(); } },
          h('span.wl-sw', { style: { background: t.bg } }, h('i', { style: { background: t.panel } }), h('b', { style: { background: t.accent } })),
          h('span', { text: k }));
        grid.append(b);
      });
      paint();
      const save = async () => {
        const n = name.value.trim();
        if (n && me) {
          await sat.saveProfile({ id: me.id, name: n });
          S.home.widgets.greeting.name = n;
          Store.save();
          if (window.Account && Account.refresh) Account.refresh();
        }
        next();
      };
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      return h('div', null, h('h2', { text: 'Make it yours' }),
        h('label', { text: 'What should Saturne call you?' }), name,
        h('label', { text: 'Pick a theme' }), grid, nav(save));
    });

    steps.push(() => {
      const grid = h('div.wl-engines');
      Object.entries(Store.SEARCH_ENGINES).forEach(([k, v]) => {
        const img = h('img', { src: Store.faviconFor(v.url) });
        img.onerror = () => { img.style.visibility = 'hidden'; };
        const b = h('button.wl-engine' + (S.settings.searchEngine === k ? '.on' : ''), { onclick: () => {
          S.settings.searchEngine = k; Store.save();
          grid.querySelectorAll('.wl-engine').forEach((x) => x.classList.toggle('on', x === b));
        } }, img, h('span', { text: v.name }));
        grid.append(b);
      });
      return h('div', null, h('h2', { text: 'Search engine' }), h('p', { text: 'Used when you type something that isn’t an address.' }), grid, nav());
    });

    steps.push(() => {
      const box = h('div.wl-import', null, h('p.wl-muted', { text: 'Looking for other browsers…' }));
      sat.importBrowsers().then((list) => {
        if (!list || !list.length) { box.replaceChildren(h('p.wl-muted', { text: 'No other browser with bookmarks was found on this PC.' })); return; }
        box.replaceChildren(...list.map((b) => {
          const btn = h('button.wl-src', { onclick: async () => {
            const items = await sat.importBookmarks(b.key);
            const have = new Set(S.bookmarks.map((x) => x.url));
            let n = 0;
            for (const it of items) {
              if (have.has(it.url)) continue;
              have.add(it.url);
              S.bookmarks.push({ id: Store.uid(), url: it.url, title: it.title || host(it.url), favicon: Store.faviconFor(it.url) });
              n++;
            }
            Store.save(); B.renderBookmarks();
            if (n && !S.settings.showBookmarks) { S.settings.showBookmarks = true; B.applySettings(); }
            btn.classList.add('done'); btn.disabled = true;
            btn.querySelector('.wl-src-sub').textContent = n ? `${n} bookmark${n > 1 ? 's' : ''} imported` : 'Already imported';
          } }, h('span.wl-src-ico', { html: Icons.star }), h('span.wl-src-txt', null, h('b', { text: b.name }), h('span.wl-src-sub', { text: `${b.count} bookmark${b.count > 1 ? 's' : ''}` })), h('span.wl-src-go', { text: 'Import' }));
          return btn;
        }));
      });
      return h('div', null, h('h2', { text: 'Bring your bookmarks' }), h('p', { text: 'Import the bookmarks you already have in another browser. You can skip this.' }), box, nav());
    });

    steps.push(() => {
      const tips = [
        [Icons.split, 'Split view', 'Right-click a tab → “Split view with current tab”'],
        [Icons.tabs, 'Search tabs', 'Ctrl+Shift+A'],
        [Icons.reader, 'Reader mode', 'F9, or the book in the address bar'],
        [Icons.translate, 'Translate', 'The button in the address bar'],
        [Icons.camera, 'Screenshot', 'Ctrl+Shift+X'],
        [Icons.key, 'Passwords', 'Saved when you sign in'],
        [Icons.puzzle, 'Extensions', 'From the Chrome Web Store'],
        [Icons.pip, 'Picture-in-picture', 'Right-click a video'],
      ];
      return h('div', null, h('h2', { text: 'You’re all set' }),
        h('div.wl-tips', null, tips.map(([ic, t, s]) => h('div.wl-tip', null, h('span.wl-tip-ico', { html: ic }), h('div', null, h('b', { text: t }), h('span', { text: s }))))),
        h('div.wl-nav', null,
          h('button.s-btn.ghost', { text: 'Back', onclick: () => go(step - 1) }),
          h('button.s-btn.ghost', { text: 'Make Saturne my default browser', onclick: () => { finish(); B.makeDefault(); } }),
          h('button.s-btn.primary', { text: 'Start browsing', onclick: finish })));
    });

    $('layer').append(back);
    go(0);
  }

  // =========================================================
  window.Features = {
    readerOn: () => Reader.isOn(),
    toggleReader: () => Reader.toggle(),
    translateItems: (tabId) => Translate.items(tabId),
    screenshot: (mode) => takeShot(mode),
    pip,
    passwords: () => Pw.manage(),
    extensions: manageExt,
    welcome,
    // the visible tab changed or navigated
    sync() { Reader.sync(); Translate.sync(); Pw.sync(); paintActions(); },
  };

  if (!S.settings.onboarded) setTimeout(welcome, 400);
})();
