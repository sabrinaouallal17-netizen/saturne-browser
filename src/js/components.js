// Saturne — reusable UI components ("models"):
//   CustomScroll  - custom overlay scrollbar
//   Menu          - custom dropdown / context menu (submenus, keyboard nav)
//   UI.select     - custom select built on Menu
//   UI.field      - custom input
//   Suggest       - autocomplete dropdown for inputs
//   UI.switch / UI.range / UI.modal / UI.prompt / UI.confirm / UI.toast / tooltips
(function () {
  const layer = () => document.getElementById('layer');

  // tiny DOM helper: h('div.cls#id', {attrs}, children...)
  function h(tag, attrs, ...kids) {
    const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
    const el = document.createElement(m[1] || 'div');
    (m[2].match(/[.#][\w-]+/g) || []).forEach((p) => {
      if (p[0] === '.') el.classList.add(p.slice(1)); else el.id = p.slice(1);
    });
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    kids.flat().forEach((k) => { if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k)); });
    return el;
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // =========================================================
  // CustomScroll — overlay scrollbar for .cs > .cs-view
  // =========================================================
  const CustomScroll = {
    attach(cs) {
      if (cs._cs) { cs._cs.update(); return cs._cs; }
      const view = cs.querySelector(':scope > .cs-view');
      const track = h('div.cs-track');
      const thumb = h('div.cs-thumb');
      track.append(thumb);
      cs.append(track);
      let hideT;

      const update = () => {
        const { scrollHeight: sh, clientHeight: ch, scrollTop: st } = view;
        if (sh <= ch + 1) { track.classList.add('hidden'); return; }
        track.classList.remove('hidden');
        const th = track.clientHeight;
        const size = Math.max(24, (ch / sh) * th);
        thumb.style.height = size + 'px';
        thumb.style.top = ((st / (sh - ch)) * (th - size)) + 'px';
      };
      const flash = () => {
        cs.classList.add('show-bar');
        clearTimeout(hideT);
        hideT = setTimeout(() => cs.classList.remove('show-bar'), 900);
      };

      view.addEventListener('scroll', () => { update(); flash(); }, { passive: true });
      cs.addEventListener('mouseenter', () => { update(); flash(); });

      // drag thumb
      thumb.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        thumb.setPointerCapture(e.pointerId);
        track.classList.add('dragging');
        const startY = e.clientY, startTop = view.scrollTop;
        const ratio = (view.scrollHeight - view.clientHeight) / (track.clientHeight - thumb.offsetHeight);
        const move = (ev) => { view.scrollTop = startTop + (ev.clientY - startY) * ratio; };
        const up = () => {
          track.classList.remove('dragging');
          thumb.removeEventListener('pointermove', move);
          thumb.removeEventListener('pointerup', up);
        };
        thumb.addEventListener('pointermove', move);
        thumb.addEventListener('pointerup', up);
      });
      // click on track -> page jump
      track.addEventListener('pointerdown', (e) => {
        if (e.target !== track) return;
        const r = thumb.getBoundingClientRect();
        view.scrollBy({ top: (e.clientY < r.top ? -1 : 1) * view.clientHeight * 0.9, behavior: 'smooth' });
      });

      new ResizeObserver(update).observe(view);
      new MutationObserver(() => requestAnimationFrame(update)).observe(view, { childList: true, subtree: true });
      cs._cs = { update, view };
      requestAnimationFrame(update);
      return cs._cs;
    },
    // build a scroll container around content
    wrap(content, className = '') {
      const view = h('div.cs-view', null, content);
      const cs = h('div.cs' + (className ? '.' + className.split(' ').join('.') : ''), null, view);
      requestAnimationFrame(() => CustomScroll.attach(cs));
      return cs;
    },
  };

  // =========================================================
  // Menu — custom dropdown model
  // items: { label, icon, img, shortcut, checked, disabled, danger, onClick, submenu, keepOpen }
  //        { sep: true } | { header: 'Title' } | { custom: element }
  // =========================================================
  const stack = [];

  function placeMenu(el, { x, y, anchor, align = 'left', sideOf }) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const r = el.getBoundingClientRect();
    let left, top;
    if (sideOf) {
      const a = sideOf.getBoundingClientRect();
      left = a.right + 4; top = a.top - 5;
      if (left + r.width > vw - 6) left = a.left - r.width - 4;
    } else if (anchor) {
      const a = anchor.getBoundingClientRect();
      left = align === 'right' ? a.right - r.width : a.left;
      top = a.bottom + 6;
      if (top + r.height > vh - 6) top = a.top - r.height - 6;
    } else {
      // open right next to the cursor; flip to the other side only when there is no room
      left = x + 2; top = y + 2;
      if (left + r.width > vw - 6) left = x - r.width - 2;
      if (top + r.height > vh - 6) top = y - r.height - 2;
      if (top < 6) top = Math.max(6, vh - r.height - 6);
    }
    el.style.left = clamp(left, 6, vw - r.width - 6) + 'px';
    el.style.top = clamp(top, 6, vh - r.height - 6) + 'px';
  }

  function openMenu(opts) {
    if (!opts.isSub) Menu.closeAll();
    const items = typeof opts.items === 'function' ? opts.items() : opts.items;
    const list = h('div');
    const el = h('div.menu' + (opts.className ? '.' + opts.className : ''), { role: 'menu' });
    if (opts.minWidth) el.style.minWidth = opts.minWidth + 'px';
    const cs = CustomScroll.wrap(list);
    el.append(cs);

    const entry = { el, opts, focus: -1, buttons: [], child: null, parent: opts.parent || null };
    let subTimer;

    items.forEach((it) => {
      if (!it) return;
      if (it.sep) { list.append(h('div.msep')); return; }
      if (it.header) { list.append(h('div.mhead', { text: it.header })); return; }
      if (it.custom) { list.append(it.custom); return; }
      const hasCheck = items.some((o) => o && o.checked !== undefined);
      const btn = h('button.mi' + (it.disabled ? '.disabled' : '') + (it.danger ? '.danger' : ''), { role: 'menuitem' },
        hasCheck ? h('span.mck', { html: it.checked ? Icons.check : '' }) : null,
        (it.icon || it.img || it.dot) ? h('span.mic', {
          html: it.img ? `<img src="${esc(it.img)}">` : it.dot ? `<span class="mdot" style="background:${esc(it.dot)}"></span>` : it.icon,
        }) : null,
        h('span.mil', { text: it.label }),
        it.shortcut ? h('span.mis', { text: it.shortcut }) : null,
        it.submenu ? h('span.mich', { html: Icons.chevRight }) : null,
      );
      const idx = entry.buttons.length;
      entry.buttons.push({ btn, it });

      btn.addEventListener('mouseenter', () => {
        setFocus(entry, idx);
        clearTimeout(subTimer);
        if (it.submenu && !it.disabled) subTimer = setTimeout(() => openSub(entry, idx), 140);
        else subTimer = setTimeout(() => closeChild(entry), 140);
      });
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => activate(entry, idx));
      list.append(btn);
    });

    layer().append(el);
    placeMenu(el, opts.isSub ? { sideOf: opts.sideOf } : opts);
    if (opts.anchor && opts.anchorClass !== false) opts.anchor.classList.add('open');
    stack.push(entry);
    if (opts.parent) opts.parent.child = entry;
    entry.close = () => closeEntry(entry);
    return entry;
  }

  function setFocus(entry, idx) {
    entry.buttons.forEach((b, i) => b.btn.classList.toggle('focus', i === idx));
    entry.focus = idx;
    const b = entry.buttons[idx];
    if (b) b.btn.scrollIntoView({ block: 'nearest' });
  }
  function openSub(entry, idx) {
    const { it, btn } = entry.buttons[idx];
    if (entry.child && entry.child.srcIdx === idx) return;
    closeChild(entry);
    const sub = openMenu({ items: it.submenu, isSub: true, sideOf: btn, parent: entry });
    sub.srcIdx = idx;
    return sub;
  }
  function closeChild(entry) { if (entry.child) { closeEntry(entry.child); entry.child = null; } }
  function closeEntry(entry) {
    closeChild(entry);
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    const el = entry.el; // short fade-out, then gone
    el.classList.add('menu-leave');
    setTimeout(() => el.remove(), 120);
    if (entry.parent && entry.parent.child === entry) entry.parent.child = null;
    if (entry.opts.anchor) entry.opts.anchor.classList.remove('open');
    if (entry.opts.onClose) entry.opts.onClose();
  }
  function activate(entry, idx) {
    const { it } = entry.buttons[idx] || {};
    if (!it || it.disabled) return;
    if (it.submenu) { const s = openSub(entry, idx); if (s) setFocus(s, 0); return; }
    if (!it.keepOpen) Menu.closeAll();
    if (it.onClick) it.onClick();
  }

  const Menu = {
    open: openMenu,
    closeAll() { while (stack.length) closeEntry(stack[0]); },
    isOpen: () => stack.length > 0,
  };

  document.addEventListener('mousedown', (e) => {
    if (!stack.length) return;
    if (stack.some((m) => m.el.contains(e.target))) return;
    if (stack.some((m) => m.opts.anchor && m.opts.anchor.contains(e.target))) {
      // clicking the anchor again toggles the menu closed
      e.stopPropagation();
      const anchorMenu = stack.find((m) => m.opts.anchor && m.opts.anchor.contains(e.target));
      anchorMenu._toggledClosed = true;
      Menu.closeAll();
      Menu._lastToggle = { anchor: anchorMenu.opts.anchor, t: Date.now() };
      return;
    }
    Menu.closeAll();
  }, true);
  window.addEventListener('blur', () => Menu.closeAll());
  window.addEventListener('resize', () => Menu.closeAll());
  // returns true when the click that just happened closed this anchor's menu (so we don't reopen it)
  Menu.justClosed = (anchor) => Menu._lastToggle && Menu._lastToggle.anchor === anchor && Date.now() - Menu._lastToggle.t < 300;

  document.addEventListener('keydown', (e) => {
    if (!stack.length) return;
    const top = stack[stack.length - 1];
    const n = top.buttons.length;
    const enabled = (i) => top.buttons[i] && !top.buttons[i].it.disabled;
    const step = (dir) => {
      let i = top.focus;
      for (let k = 0; k < n; k++) { i = (i + dir + n) % n; if (enabled(i)) { setFocus(top, i); break; } }
    };
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Enter') { if (top.focus >= 0) { e.preventDefault(); activate(top, top.focus); } }
    else if (e.key === 'ArrowRight') {
      const b = top.buttons[top.focus];
      if (b && b.it.submenu) { e.preventDefault(); const s = openSub(top, top.focus); if (s) setFocus(s, 0); }
    } else if (e.key === 'ArrowLeft') { if (top.parent) { e.preventDefault(); closeEntry(top); } }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeEntry(top); }
  }, true);

  // =========================================================
  // Suggest — autocomplete popup for inputs (keeps input focus)
  // =========================================================
  function attachSuggest(input, { anchor, getItems, onPick }) {
    let el = null, items = [], focus = -1;
    const close = () => { if (el) { el.remove(); el = null; } focus = -1; };
    const render = () => {
      items = getItems(input.value) || [];
      if (!items.length || document.activeElement !== input) { close(); return; }
      const list = h('div');
      items.forEach((it, i) => {
        const b = h('button.mi' + (i === focus ? '.focus' : ''), null,
          h('span.mic', { html: it.img ? `<img src="${esc(it.img)}">` : it.icon || Icons.globe }),
          h('span.mil', { text: it.label }),
          it.sub ? h('span.mis', { text: it.sub }) : null,
        );
        b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
        b.addEventListener('mouseenter', () => { focus = i; paint(); });
        list.append(b);
      });
      if (!el) { el = h('div.menu.suggest'); layer().append(el); }
      el.innerHTML = '';
      el.append(list);
      const a = (anchor || input).getBoundingClientRect();
      el.style.left = a.left + 'px';
      el.style.width = a.width + 'px';
      el.style.maxWidth = 'none';
      el.style.top = (a.bottom + 6) + 'px';
      if (a.bottom + 6 + el.offsetHeight > window.innerHeight - 6) el.style.top = (a.top - el.offsetHeight - 6) + 'px';
    };
    const paint = () => el && [...el.querySelectorAll('.mi')].forEach((b, i) => b.classList.toggle('focus', i === focus));
    const pick = (i) => { const it = items[i]; close(); if (it) onPick(it); };

    input.addEventListener('input', () => { focus = -1; render(); });
    input.addEventListener('focus', () => { if (input.value) render(); });
    input.addEventListener('blur', () => setTimeout(close, 80));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && el) { e.preventDefault(); focus = (focus + 1) % items.length; paint(); }
      else if (e.key === 'ArrowUp' && el) { e.preventDefault(); focus = (focus - 1 + items.length) % items.length; paint(); }
      else if (e.key === 'Escape' && el) { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (el && focus >= 0) pick(focus);
        else { close(); onPick({ raw: input.value }); }
      }
    });
    window.addEventListener('resize', close);
    return { close };
  }

  // =========================================================
  // UI factory
  // =========================================================
  const UI = {
    h, esc, clamp,

    field({ icon = Icons.search, placeholder = '', value = '', clearable = true, onInput, onEnter, className = '' } = {}) {
      const input = h('input', { type: 'text', placeholder, spellcheck: 'false', autocomplete: 'off' });
      input.value = value;
      const clear = clearable ? h('button.clear', { html: Icons.x, title: 'Clear' }) : null;
      const el = h('div.field.s-input' + (className ? '.' + className : ''), null,
        icon ? h('span.lead', { html: icon }) : null, input, clear);
      const sync = () => el.classList.toggle('has-value', !!input.value);
      input.addEventListener('input', () => { sync(); onInput && onInput(input.value); });
      if (onEnter) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') onEnter(input.value); });
      if (clear) clear.addEventListener('click', () => { input.value = ''; sync(); input.focus(); onInput && onInput(''); });
      el.addEventListener('mousedown', (e) => { if (e.target === el) { e.preventDefault(); input.focus(); } });
      sync();
      return { el, input };
    },

    select({ options, value, onChange, width }) {
      const label = h('span.sl');
      const el = h('button.s-select', null, label, h('span.chev', { html: Icons.chevDown }));
      if (width) el.style.width = width + 'px';
      const set = (v) => {
        value = v;
        const o = options.find((x) => x.value === v) || options[0];
        label.textContent = o ? o.label : '';
      };
      set(value);
      el.addEventListener('click', () => {
        if (Menu.justClosed(el)) return;
        Menu.open({
          anchor: el, minWidth: el.offsetWidth,
          items: options.map((o) => ({
            label: o.label, icon: o.icon, dot: o.dot, checked: o.value === value,
            onClick: () => { set(o.value); onChange && onChange(o.value); },
          })),
        });
      });
      el.setValue = set;
      return el;
    },

    switch(on, onChange) {
      const el = h('button.s-switch' + (on ? '.on' : ''), { role: 'switch' });
      el.addEventListener('click', () => {
        on = !on; el.classList.toggle('on', on); onChange && onChange(on);
      });
      el.set = (v) => { on = v; el.classList.toggle('on', v); };
      return el;
    },

    range({ min = 0, max = 100, step = 1, value = 50, onInput }) {
      const el = h('input.s-range', { type: 'range', min, max, step });
      el.value = value;
      const paint = () => el.style.setProperty('--p', ((el.value - min) / (max - min)) * 100 + '%');
      el.addEventListener('input', () => { paint(); onInput && onInput(Number(el.value)); });
      paint();
      return el;
    },

    modal({ title, body, wide = false, onClose }) {
      const box = h('div.modal' + (wide ? '.wide' : ''), null, title ? h('h3', { text: title }) : null);
      const back = h('div.modal-back', null, box);
      let closed = false;
      const close = () => {
        if (closed) return; closed = true;
        back.classList.add('leaving'); setTimeout(() => back.remove(), 170);
        document.removeEventListener('keydown', key, true); onClose && onClose();
      };
      const key = (e) => { if (e.key === 'Escape' && !Menu.isOpen()) { e.preventDefault(); close(); } };
      document.addEventListener('keydown', key, true);
      back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
      body(box, close);
      layer().append(back);
      return { close, box };
    },

    prompt({ title, message, fields, ok = 'Save', extra }) {
      return new Promise((resolve) => {
        let done = false;
        UI.modal({
          title,
          onClose: () => { if (!done) resolve(null); },
          body(box, close) {
            if (message) box.append(h('p', { text: message }));
            const inputs = {};
            fields.forEach((f, i) => {
              box.append(h('label', { text: f.label }));
              const fld = UI.field({ icon: f.icon || null, placeholder: f.placeholder || '', value: f.value || '', clearable: true });
              inputs[f.key] = fld.input;
              box.append(fld.el);
              if (i === 0) setTimeout(() => { fld.input.focus(); fld.input.select(); }, 30);
            });
            const extraState = extra ? extra(box) : null;
            const submit = () => {
              const out = {};
              for (const k in inputs) out[k] = inputs[k].value.trim();
              if (extraState) Object.assign(out, extraState.get());
              done = true; close(); resolve(out);
            };
            box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); } });
            box.append(h('div.actions', null,
              h('button.s-btn.ghost', { text: 'Cancel', onclick: close }),
              h('button.s-btn.primary', { text: ok, onclick: submit })));
          },
        });
      });
    },

    confirm({ title, message, ok = 'Confirm', danger = false }) {
      return new Promise((resolve) => {
        let done = false;
        UI.modal({
          title, onClose: () => { if (!done) resolve(false); },
          body(box, close) {
            if (message) box.append(h('p', { text: message }));
            const okBtn = h('button.s-btn' + (danger ? '.danger' : '.primary'), { text: ok, onclick: () => { done = true; close(); resolve(true); } });
            box.append(h('div.actions', null, h('button.s-btn.ghost', { text: 'Cancel', onclick: close }), okBtn));
            setTimeout(() => okBtn.focus(), 30);
          },
        });
      });
    },

    toast(msg, ms = 2200) {
      const t = h('div.toast', { text: msg });
      document.getElementById('toasts').append(t);
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
    },
  };

  // =========================================================
  // Tooltips: any element with data-tip
  // =========================================================
  (function tooltips() {
    let timer, cur;
    const tip = () => document.getElementById('tooltip');
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-tip]');
      if (el === cur) return;
      cur = el; clearTimeout(timer); tip().classList.remove('show');
      if (!el) return;
      timer = setTimeout(() => {
        if (Menu.isOpen()) return;
        const t = tip();
        t.textContent = el.dataset.tip;
        const r = el.getBoundingClientRect();
        t.style.left = '0px'; t.style.top = '0px';
        const w = t.offsetWidth;
        t.style.left = clamp(r.left + r.width / 2 - w / 2, 6, window.innerWidth - w - 6) + 'px';
        t.style.top = (r.bottom + 6) + 'px';
        t.classList.add('show');
      }, 650);
    });
    document.addEventListener('mousedown', () => { clearTimeout(timer); tip().classList.remove('show'); cur = null; }, true);
  })();

  window.h = h;
  window.UI = UI;
  window.Menu = Menu;
  window.CustomScroll = CustomScroll;
  window.attachSuggest = attachSuggest;
})();
