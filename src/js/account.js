// Saturne — profile button (photo + banner menu, local profiles) and "Update Available"
(function () {
  const { h } = UI;
  const $ = (id) => document.getElementById(id);
  const sat = window.saturne;
  const GRADIENTS = [
    ['#8fb0ff', '#c6a4ff'], ['#ff8fa3', '#ffc94d'], ['#7fd1a3', '#5fd4e0'], ['#c6a4ff', '#ff8fa3'],
    ['#ffc94d', '#ff9f5a'], ['#5fd4e0', '#8fb0ff'], ['#3a3a3a', '#6a6a6a'], ['#ff9f5a', '#e81123'],
  ];

  let data = sat.profiles();
  const refresh = () => (data = sat.profiles());
  const me = () => data.list.find((p) => p.id === data.active) || data.list[0];
  const initial = (p) => ((p.name || '?').trim()[0] || '?').toUpperCase();
  const isPicture = (s) => typeof s === 'string' && s.startsWith('data:');

  // ---------- pictures ----------
  function avatarEl(p, cls = '') {
    const el = h('span.pf-avatar' + cls);
    if (p.avatar) el.style.backgroundImage = `url("${p.avatar}")`;
    else { el.textContent = initial(p); el.style.backgroundColor = p.color || '#8fb0ff'; }
    return el;
  }
  // banner = a picture, a preset gradient ("g:3"), or nothing (gradient from the profile color)
  function bannerStyle(p) {
    if (isPicture(p.banner)) return { backgroundImage: `url("${p.banner}")` };
    const g = /^g:\d+$/.test(p.banner || '') ? GRADIENTS[Number(p.banner.slice(2))] : null;
    const [a, b] = g || [p.color || '#8fb0ff', '#2b2b2b'];
    return { backgroundImage: `linear-gradient(135deg, ${a}, ${b})` };
  }

  // pick an image file, then let the user crop it (round frame for the photo, wide frame for the banner)
  function pickImage(w, hgt) {
    return new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
      inp.addEventListener('change', () => {
        const f = inp.files && inp.files[0];
        if (!f) return resolve(null);
        if (f.size > 25 * 1024 * 1024) { UI.toast('This image is too big (25 MB max)'); return resolve(null); }
        const img = new Image();
        img.onload = () => cropImage(img, w, hgt).then(resolve);
        img.onerror = () => { UI.toast('This image can’t be opened'); resolve(null); };
        const rd = new FileReader();
        rd.onload = () => { img.src = rd.result; };
        rd.onerror = () => resolve(null);
        rd.readAsDataURL(f);
      });
      inp.click();
    });
  }

  // ---------- crop tool: drag to move, wheel / slider to zoom ----------
  function cropImage(img, outW, outH) {
    return new Promise((resolve) => {
      const round = outW === outH;
      const frameW = round ? 260 : 540, frameH = Math.round(frameW * outH / outW);
      const stageW = round ? 440 : 580, stageH = frameH + (round ? 60 : 120);
      const fx = (stageW - frameW) / 2, fy = (stageH - frameH) / 2;
      const cover = Math.max(frameW / img.naturalWidth, frameH / img.naturalHeight);
      let zoom = 1, x = 0, y = 0; // image position (px, stage coords) and zoom relative to "cover"
      const pic = h('img.crop-img', { src: img.src, draggable: 'false' });
      const frame = h('div.crop-frame' + (round ? '.round' : ''), { style: { left: fx + 'px', top: fy + 'px', width: frameW + 'px', height: frameH + 'px' } });
      const stage = h('div.crop-stage', { style: { width: stageW + 'px', height: stageH + 'px' } }, pic, frame);
      const slider = UI.range({ min: 100, max: 400, step: 1, value: 100, onInput: (v) => zoomTo(v / 100) });
      const scale = () => cover * zoom;
      // keep the frame always filled by the picture
      const clampPos = () => {
        const w = img.naturalWidth * scale(), hh = img.naturalHeight * scale();
        x = Math.min(fx, Math.max(fx + frameW - w, x));
        y = Math.min(fy, Math.max(fy + frameH - hh, y));
      };
      const paint = () => {
        clampPos();
        Object.assign(pic.style, { width: img.naturalWidth * scale() + 'px', height: img.naturalHeight * scale() + 'px', transform: `translate(${x}px, ${y}px)` });
      };
      // zoom around a point (the frame center by default)
      function zoomTo(z, cx = fx + frameW / 2, cy = fy + frameH / 2) {
        z = Math.min(4, Math.max(1, z));
        const k = z / zoom;
        x = cx - (cx - x) * k; y = cy - (cy - y) * k;
        zoom = z; slider.value = Math.round(z * 100);
        slider.style.setProperty('--p', ((z - 1) / 3) * 100 + '%');
        paint();
      }
      // start centered
      x = fx + (frameW - img.naturalWidth * cover) / 2;
      y = fy + (frameH - img.naturalHeight * cover) / 2;
      paint();

      let drag = null;
      stage.addEventListener('pointerdown', (e) => { drag = { px: e.clientX, py: e.clientY, x, y }; stage.setPointerCapture(e.pointerId); stage.classList.add('grabbing'); });
      stage.addEventListener('pointermove', (e) => { if (!drag) return; x = drag.x + e.clientX - drag.px; y = drag.y + e.clientY - drag.py; paint(); });
      const end = () => { drag = null; stage.classList.remove('grabbing'); };
      stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
      stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = stage.getBoundingClientRect();
        zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });

      // own overlay (not UI.modal) so Esc closes only the crop tool, not the profile editor under it
      const finish = (ok) => {
        back.remove();
        window.removeEventListener('keydown', onKey, true);
        if (!ok) return resolve(null);
        const c = document.createElement('canvas');
        c.width = outW; c.height = outH;
        const s = scale();
        c.getContext('2d').drawImage(img, (fx - x) / s, (fy - y) / s, frameW / s, frameH / s, 0, 0, outW, outH);
        resolve(c.toDataURL('image/jpeg', 0.9));
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(false); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); finish(true); }
      };
      window.addEventListener('keydown', onKey, true);
      const box = h('div.modal.crop-modal', { style: { width: stageW + 40 + 'px' } },
        h('h3', { text: round ? 'Crop your photo' : 'Crop your banner' }),
        stage,
        h('div.crop-zoom', null, h('span.ico', { html: Icons.zoomOut }), slider, h('span.ico', { html: Icons.zoomIn })),
        h('p.crop-hint', { text: 'Drag to move · scroll to zoom' }),
        h('div.actions', null,
          h('button.s-btn.ghost', { text: 'Cancel', onclick: () => finish(false) }),
          h('button.s-btn.primary', { text: 'Apply', onclick: () => finish(true) })));
      const back = h('div.modal-back.crop-back', null, box);
      document.getElementById('layer').append(back);
    });
  }

  // ---------- top bar buttons ----------
  const btnUpdate = h('button.win-btn#btn-update', { 'data-tip': 'Restart Saturne with the new version' },
    h('span.ico', { html: Icons.download }), h('span.lbl', { text: 'Update Available' }));
  const btnAccount = h('button.win-btn#btn-account');
  btnUpdate.hidden = true;
  $('win-btns').prepend(btnUpdate, btnAccount);
  function paintButton() {
    btnAccount.replaceChildren(avatarEl(me()));
    btnAccount.dataset.tip = me().name;
  }
  // keep the address bar clear of the buttons on the right
  const syncWidth = () => document.documentElement.style.setProperty('--winbtns-w', $('win-btns').offsetWidth + 'px');
  new ResizeObserver(syncWidth).observe($('win-btns'));

  // ---------- dropdown ----------
  let pop = null;
  function closePop() {
    if (!pop) return;
    pop.remove(); pop = null;
    btnAccount.classList.remove('open');
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  const outside = (e) => { if (pop && !pop.contains(e.target) && !btnAccount.contains(e.target)) closePop(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); closePop(); } };

  function openPop() {
    if (pop) return closePop();
    refresh();
    const p = me();
    const others = data.list.filter((x) => x.id !== p.id);
    const row = (icon, label, fn, cls = '') => h('button.pf-row' + cls, { onclick: () => { closePop(); fn(); } }, h('span.ico', { html: icon }), h('span', { text: label }));
    const U = sat.updateStatus();

    pop = h('div.pf-pop', null,
      h('div.pf-banner', { style: bannerStyle(p) }),
      h('div.pf-id', null,
        avatarEl(p, '.big'),
        h('span.pf-grow'),
        h('button.s-btn.pf-edit', { html: Icons.pencil + '<span>Edit profile</span>', onclick: () => { closePop(); editProfile(p); } })),
      h('div.pf-name.pf-under', null, h('b', { text: p.name }), h('span', { text: data.list.length > 1 ? 'Active profile' : 'Your profile' })),
      h('div.pf-sep'),
      others.length ? h('div.pf-head', { text: 'Switch profile' }) : null,
      others.map((o) => h('div.pf-other', null,
        h('button.pf-row', { onclick: () => { closePop(); switchTo(o); } }, avatarEl(o, '.small'), h('span', { text: o.name })),
        o.id === 'default' ? null : h('button.pf-del', { html: Icons.trash, 'data-tip': 'Delete profile', onclick: () => { closePop(); removeProfile(o); } }))),
      row(Icons.plus, 'Add a profile', addProfile),
      h('div.pf-sep'),
      U.state === 'available'
        ? row(Icons.download, 'Update Available — restart to install', installUpdate, '.accent')
        : row(Icons.reload, U.state === 'checking' ? 'Checking for updates…' : 'Check for updates', checkNow));

    document.body.append(pop);
    const b = btnAccount.getBoundingClientRect();
    pop.style.top = b.bottom + 6 + 'px';
    pop.style.right = Math.max(8, innerWidth - b.right - 4) + 'px';
    btnAccount.classList.add('open');
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', onKey, true);
  }
  btnAccount.addEventListener('click', openPop);

  // ---------- profile editor ----------
  function editProfile(p) {
    const draft = { ...p };
    UI.modal({
      title: 'Edit profile', wide: true,
      body(box, close) {
        const preview = h('div.pf-preview');
        const nameF = UI.field({ icon: null, value: draft.name, clearable: false, placeholder: 'Your name' });
        nameF.input.maxLength = 32;
        nameF.input.addEventListener('input', () => { draft.name = nameF.input.value; draw(); });
        const swatches = h('div.color-row');
        const draw = () => {
          preview.replaceChildren(
            h('div.pf-banner', { style: bannerStyle(draft) },
              h('div.pf-pic-btns', null,
                h('button.s-btn.glass', { html: Icons.image + '<span>Change banner</span>', onclick: async () => { const d = await pickImage(960, 320); if (d) { draft.banner = d; draw(); } } }),
                isPicture(draft.banner) ? h('button.s-btn.glass', { html: Icons.x, 'data-tip': 'Remove banner picture', onclick: () => { draft.banner = ''; draw(); } }) : null)),
            h('div.pf-id', null,
              h('button.pf-avatar-edit', { 'data-tip': 'Change photo', onclick: async () => { const d = await pickImage(256, 256); if (d) { draft.avatar = d; draw(); } } },
                avatarEl(draft, '.big'), h('span.pf-cam', { html: Icons.camera })),
              h('div.pf-name', null, h('b', { text: draft.name || 'Your name' }),
                draft.avatar ? h('button.pf-link', { text: 'Remove photo', onclick: () => { draft.avatar = ''; draw(); } }) : h('span', { text: 'Click the circle to add a photo' }))));
          swatches.replaceChildren(...GRADIENTS.map(([a, b], i) => h('button.color-chip' + (draft.banner === 'g:' + i ? '.on' : ''), {
            style: { background: `linear-gradient(135deg, ${a}, ${b})` },
            onclick: () => { draft.banner = 'g:' + i; draft.color = a; draw(); },
          })));
        };
        draw();
        box.append(preview,
          h('label', { text: 'Name' }), nameF.el,
          h('label', { text: 'Banner colors (replaces the banner picture)' }), swatches,
          h('p.pf-note', { text: 'Each profile keeps its own spaces, tabs, home page customization, theme, site logins and permissions.' }),
          h('div.actions', null,
            h('button.s-btn.ghost', { text: 'Cancel', onclick: close }),
            h('button.s-btn.primary', { text: 'Save', onclick: async () => {
              const saved = await sat.saveProfile({ id: draft.id, name: draft.name, avatar: draft.avatar || '', banner: draft.banner || '', color: draft.color });
              close();
              if (saved) { refresh(); paintButton(); UI.toast('Profile saved'); } else UI.toast('Couldn’t save the profile');
            } })));
        setTimeout(() => nameF.input.focus(), 30);
      },
    });
  }

  // ---------- profile actions ----------
  async function switchTo(p) {
    UI.toast(`Opening ${p.name}…`);
    await Store.saveNow();
    await sat.switchProfile(p.id);
  }
  async function addProfile() {
    const res = await UI.prompt({ title: 'Add a profile', message: 'A new profile starts with its own spaces, home page and site logins.', fields: [{ key: 'name', label: 'Name', placeholder: 'e.g. School, Gaming…' }], ok: 'Create' });
    if (!res || !res.name) return;
    const i = refresh().list.length % GRADIENTS.length;
    const p = await sat.createProfile({ name: res.name, color: GRADIENTS[i][0], banner: 'g:' + i });
    if (!p) return UI.toast('You can have up to 12 profiles');
    refresh();
    if (await UI.confirm({ title: `Switch to ${p.name}?`, message: 'Saturne restarts on the new profile. Your current tabs are saved.', ok: 'Switch now' })) switchTo(p);
  }
  async function removeProfile(p) {
    if (!(await UI.confirm({ title: `Delete ${p.name}?`, message: 'Its spaces, tabs, home page, site logins and saved permissions are erased from this PC. This can’t be undone.', ok: 'Delete', danger: true }))) return;
    if (await sat.deleteProfile(p.id)) UI.toast(`${p.name} deleted`);
    refresh();
  }

  // ---------- updates ----------
  function paintUpdate(u) {
    btnUpdate.hidden = !(u && (u.state === 'available' || u.state === 'installing'));
    btnUpdate.classList.toggle('busy', !!u && u.state === 'installing');
    btnUpdate.querySelector('.lbl').textContent = u && u.state === 'installing' ? 'Updating…' : 'Update Available';
  }
  async function checkNow() {
    const u = await sat.checkUpdate();
    if (u.state === 'uptodate') UI.toast('Saturne is up to date');
    else if (u.state === 'error') UI.toast(u.error || 'Couldn’t check for updates', 4500);
  }
  async function installUpdate() {
    const u = sat.updateStatus();
    if (!u.available) return checkNow();
    if (!u.canInstall) return UI.toast('Running from the source folder: use git pull to update', 4500);
    const when = u.available.date ? new Date(u.available.date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    const ok = await UI.confirm({
      title: 'Update available',
      message: `“${u.available.message || 'New version'}”${when ? ' — ' + when : ''}. Saturne downloads it and restarts; your tabs are kept.`,
      ok: 'Restart & update',
    });
    if (!ok) return;
    await Store.saveNow();
    UI.toast('Downloading the update…', 4000);
    const r = await sat.installUpdate();
    if (r && r.error) UI.toast(r.error, 6000);
  }
  btnUpdate.addEventListener('click', installUpdate);
  sat.onUpdate(paintUpdate);

  // ---------- start ----------
  paintButton();
  paintUpdate(sat.updateStatus());
  syncWidth();
  window.Account = { open: openPop, edit: () => editProfile(me()), check: checkNow, install: installUpdate };
})();
