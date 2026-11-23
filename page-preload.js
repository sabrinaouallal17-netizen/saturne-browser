// Saturne — helper loaded in every web page (isolated from the page's own scripts).
// Saved passwords: offers to save a login after a form is sent, and fills saved logins.
// The main process only ever answers about the page's own site.
const { ipcRenderer } = require('electron');

(function () {
  if (!/^https?:$/.test(location.protocol)) return;

  const isPw = (el) => el instanceof HTMLInputElement && el.type === 'password';
  const isUserish = (el) => el instanceof HTMLInputElement && /^(text|email|tel|)$/i.test(el.type)
    && /user|mail|login|identifier|account|phone|name/i.test(`${el.name} ${el.id} ${el.autocomplete} ${el.type} ${el.getAttribute('aria-label') || ''}`);
  const shown = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

  function userFieldFor(pwField) {
    const scope = pwField.form || document;
    const inputs = [...scope.querySelectorAll('input')].filter((i) => /^(text|email|tel|)$/i.test(i.type) && shown(i));
    let best = null;
    for (const i of inputs) if (i.compareDocumentPosition(pwField) & Node.DOCUMENT_POSITION_FOLLOWING) best = i;
    return best;
  }

  // ---------- offer to save ----------
  let lastPw = null, lastUser = '', sentKey = '';
  function offer(field) {
    if (!field || !field.value) return;
    const uf = userFieldFor(field);
    const u = ((uf && uf.value) || lastUser || '').trim();
    const key = u + '\n' + field.value;
    if (key === sentKey) return;
    sentKey = key;
    ipcRenderer.send('pw:candidate', { u, p: field.value });
  }
  document.addEventListener('input', (e) => {
    if (isPw(e.target)) lastPw = e.target;
    else if (isUserish(e.target) && e.target.value.trim()) lastUser = e.target.value; // remembered for 2-step logins
  }, true);
  document.addEventListener('submit', (e) => {
    const f = e.target && e.target.querySelectorAll ? [...e.target.querySelectorAll('input[type=password]')].find((x) => x.value) : null;
    offer(f || (lastPw && lastPw.isConnected ? lastPw : null));
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && isPw(e.target)) offer(e.target); }, true);
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('button, input[type=submit], input[type=button], [role=button]');
    if (b && lastPw && lastPw.isConnected && lastPw.value) offer(lastPw);
  }, true);
  window.addEventListener('pagehide', () => { if (lastPw && lastPw.value) offer(lastPw); });

  // ---------- fill saved logins ----------
  let saved = null; // usernames saved for this site
  const setVal = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  let filling = false;
  async function fill(pwField, u) {
    const p = await ipcRenderer.invoke('pw:fill', u);
    if (p == null) return;
    const uf = userFieldFor(pwField);
    filling = true;
    try {
      if (uf && u) setVal(uf, u);
      setVal(pwField, p);
    } finally { filling = false; }
    sentKey = u + '\n' + p; // don't offer to save what we just filled
  }

  // small list under the field to pick a saved account
  let host = null;
  function closeList() { if (host) { host.remove(); host = null; } }
  function openList(field, pwField) {
    closeList();
    if (!saved || !saved.length) return;
    const r = field.getBoundingClientRect();
    host = document.createElement('saturne-logins');
    const root = host.attachShadow({ mode: 'closed' });
    const css = `:host{all:initial;position:fixed;z-index:2147483647;left:${Math.round(r.left)}px;top:${Math.round(r.bottom + 4)}px}
      .b{min-width:${Math.max(220, Math.round(r.width))}px;max-width:360px;padding:5px;border-radius:10px;background:#2f2f2f;color:#ededed;
        font:13px "Segoe UI",system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);border:1px solid #444;animation:i .14s ease-out}
      @keyframes i{from{opacity:0;transform:translateY(-4px)}}
      .h{padding:4px 8px 6px;font-size:11px;color:#9a9a9a;text-transform:uppercase;letter-spacing:.05em}
      button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:9px;width:100%;padding:7px 8px;border-radius:6px;cursor:default}
      button:hover{background:#3d3d3d}.k{width:18px;height:18px;border-radius:50%;background:#8fb0ff;color:#111;display:grid;place-items:center;font-weight:700;font-size:11px}
      .d{color:#9a9a9a}`;
    const box = document.createElement('div');
    box.className = 'b';
    box.innerHTML = `<style>${css}</style><div class="h">Saturne · saved logins</div>`;
    for (const u of saved) {
      const b = document.createElement('button');
      const k = document.createElement('span'); k.className = 'k'; k.textContent = (u || '?')[0].toUpperCase();
      const t = document.createElement('span'); t.textContent = u || '(no username)';
      const d = document.createElement('span'); d.className = 'd'; d.textContent = '••••••';
      b.append(k, t, d);
      b.addEventListener('mousedown', (e) => { e.preventDefault(); closeList(); fill(pwField, u); });
      box.append(b);
    }
    root.append(box);
    document.documentElement.append(host);
  }

  function pwFieldNear(el) {
    if (isPw(el)) return el;
    const scope = el.form || document;
    return [...scope.querySelectorAll('input[type=password]')].find(shown) || null;
  }
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (filling || !saved || !saved.length || !(el instanceof HTMLInputElement)) return;
    const pwField = pwFieldNear(el);
    if (!pwField || (el !== pwField && userFieldFor(pwField) !== el)) return;
    openList(el, pwField);
  }, true);
  document.addEventListener('focusout', () => setTimeout(closeList, 120), true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeList(); }, true);
  window.addEventListener('scroll', closeList, true);

  // one saved login and an empty form: fill it right away
  let autoDone = false;
  function autoFill() {
    if (autoDone || !saved || saved.length !== 1) return;
    const pwField = [...document.querySelectorAll('input[type=password]')].find((x) => shown(x) && !x.value && x.autocomplete !== 'new-password');
    if (!pwField) return;
    autoDone = true;
    fill(pwField, saved[0]);
  }

  async function init() {
    if (!document.querySelector('input[type=password]')) return;
    if (saved === null) { saved = []; saved = await ipcRenderer.invoke('pw:for-page').catch(() => []); }
    autoFill();
  }
  // login forms often appear after the page has loaded
  let t = null;
  const watch = () => {
    init();
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(init, 300); }).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true }); else watch();
})();
