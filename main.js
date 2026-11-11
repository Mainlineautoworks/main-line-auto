// Mobile menu
const toggle = document.querySelector('.menu-toggle');
const mobileNav = document.getElementById('mobile-nav');
if (toggle && mobileNav) {
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    mobileNav.hidden = open;
    toggle.textContent = open ? 'Menu' : 'Close';
  });
  mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    toggle.setAttribute('aria-expanded', 'false');
    mobileNav.hidden = true;
    toggle.textContent = 'Menu';
  }));
}

// Radio-group arrow keys, shared by both pickers
function arrowNav(buttons, select) {
  buttons.forEach((btn, i) => {
    btn.addEventListener('click', () => select(btn));
    btn.addEventListener('keydown', e => {
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const next = buttons[(i + dir + buttons.length) % buttons.length];
      next.focus(); select(next);
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Live repaint of real shop photos (calipers and wraps share this).
// Each *-shade.png is cut from its photo: R = how brightly the paint is lit, G = white highlights
// on top, alpha = the painted area. Any color is lit by that photo's own light.
// box = where the shade layer sits in the photo: [x, y, width, height]; size defaults to 1200x900.
// Bump ASSET_V whenever a photo or shade layer changes, so phones never pair a cached old
// photo with a new shade layer (that is what makes the repaint look shifted).
const ASSET_V = '20261110e';
const toLin = v => Math.pow(v / 255, 2.2);
const hexLin = h => { const n = parseInt(h.replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255].map(toLin); };
const FIN = { gloss: [1, 1], satin: [0.8, 0.4], matte: [0.6, 0.12] };   // lighting contrast, shine kept
const shadeCache = {};
function loadShade(src) {
  if (!shadeCache[src]) shadeCache[src] = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  return shadeCache[src];
}
function createPainter({ view, img, canvas, stage, vehicles, initial, color }) {
  if (!canvas || !view || !img) return null;
  const ctx = canvas.getContext('2d');
  let lit = null, hi = null, alpha = null, out = null, mean = 0.1, loadId = 0, hidden = false;
  let cur = hexLin(color), goal = cur, fin = FIN.gloss, goalFin = fin, metal = 0, anim = 0;
  function decode(im) {
    const t = document.createElement('canvas'); t.width = im.naturalWidth; t.height = im.naturalHeight;
    const tc = t.getContext('2d'); tc.drawImage(im, 0, 0);
    const d = tc.getImageData(0, 0, t.width, t.height).data, n = d.length / 4;
    lit = new Float32Array(n); hi = new Float32Array(n); alpha = new Uint8ClampedArray(n);
    let sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      lit[i] = toLin(d[i * 4]); hi[i] = toLin(d[i * 4 + 1]) / 4; alpha[i] = d[i * 4 + 3];
      if (alpha[i] > 128) { sum += lit[i]; cnt++; }
    }
    mean = cnt ? sum / cnt : 0.1;
    canvas.width = t.width; canvas.height = t.height;
    out = ctx.createImageData(t.width, t.height);
  }
  let cur_v = null;
  // fit the photo stage inside the frame at the photo's own shape (letterboxed, never cropped),
  // so the paint layer always sits exactly on the photo
  function fit() {
    if (!stage || !cur_v) return;
    const [W, H] = cur_v.size || [1200, 900], vw = view.clientWidth, vh = view.clientHeight;
    if (!vw || !vh) return;
    const pr = W / H, vr = vw / vh;
    stage.style.width = (pr > vr ? 100 : pr / vr * 100) + '%';
    stage.style.height = (pr > vr ? vr / pr * 100 : 100) + '%';
  }
  if (window.ResizeObserver) new ResizeObserver(fit).observe(view);
  function place(v) {
    const [x, y, w, h] = v.box, [W, H] = v.size || [1200, 900];
    cur_v = v; fit();
    img.width = W; img.height = H;
    Object.assign(canvas.style, { left: x / W * 100 + '%', top: y / H * 100 + '%', width: w / W * 100 + '%', height: h / H * 100 + '%' });
  }
  async function setVehicle(id, first) {
    const v = vehicles[id]; if (!v) return;
    const my = ++loadId;
    if (!first) view.classList.add('switching');
    const photo = new Image(); photo.src = v.img;
    const [shadeImg] = await Promise.all([loadShade(v.shade), photo.decode ? photo.decode().catch(() => {}) : null]);
    if (my !== loadId) return;
    await new Promise(r => setTimeout(r, first ? 0 : 120));
    decode(shadeImg); place(v);
    img.src = v.img; img.alt = v.alt;
    render();
    view.classList.add('paint-ready');
    view.classList.remove('switching');
  }
  function render() {
    if (!lit) return;
    canvas.style.visibility = hidden ? 'hidden' : '';
    const o = out.data, [con, shine] = fin, hiGain = shine * (metal ? 1.6 : 1);
    for (let i = 0; i < lit.length; i++) {
      const s = Math.max(0, mean + (lit[i] - mean) * con), h = hi[i] * hiGain;
      for (let c = 0; c < 3; c++) o[i * 4 + c] = 255 * Math.pow(Math.min(1, cur[c] * s + h), 1 / 2.2);
      o[i * 4 + 3] = alpha[i];
    }
    ctx.putImageData(out, 0, 0);
  }
  function animate() {
    cancelAnimationFrame(anim);
    const from = cur.slice(), f0 = fin.slice(), start = performance.now();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const step = t => {
      const k = reduce ? 1 : Math.min((t - start) / 260, 1), e = k * k * (3 - 2 * k);
      cur = from.map((v, i) => v + (goal[i] - v) * e);
      fin = f0.map((v, i) => v + (goalFin[i] - v) * e);
      render();
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  setVehicle(initial, true);
  // warm the other photos once the section is near, so switching is instant
  new IntersectionObserver((es, obs) => {
    if (!es[0].isIntersecting) return;
    Object.values(vehicles).forEach(v => { loadShade(v.shade); const i = new Image(); i.src = v.img; });
    obs.disconnect();
  }, { rootMargin: '400px' }).observe(view);
  return {
    setVehicle,
    showOriginal(on) { hidden = on; render(); },
    setColor(hex, opts = {}) { hidden = false; goal = hexLin(hex).map(v => opts.metallic ? v * 0.7 : v); metal = opts.metallic ? 1 : 0; animate(); },
    setFinish(name) { goalFin = FIN[name] || FIN.gloss; animate(); }
  };
}
// Resolve images next to main.js, so subpages (e.g. /vinyl-wraps/) load the same files.
const ASSET_BASE = new URL('assets/img/', (document.currentScript && document.currentScript.src) || location.href);
const asset = (name) => `${new URL(name, ASSET_BASE).href}?v=${ASSET_V}`;

// Wire one section's pickers (vehicle, color swatches, custom color, finish) to its painter.
function wirePickers(section, painter, { onColor, onFinish, onVehicle } = {}) {
  if (!section) return;
  const colorName = section.querySelector('.color-name');
  const colorButtons = Array.from(section.querySelectorAll('.color-picker button'));
  const custom = section.querySelector('.custom-swatch input');
  const customSwatch = custom && custom.closest('.custom-swatch');
  const vehicleButtons = Array.from(section.querySelectorAll('.vehicle-picker button'));
  const finishButtons = Array.from(section.querySelectorAll('.finish-picker button'));
  arrowNav(vehicleButtons, btn => {
    vehicleButtons.forEach(b => b.setAttribute('aria-checked', String(b === btn)));
    if (painter) painter.setVehicle(btn.dataset.vehicle);
    if (onVehicle) onVehicle(btn);
  });
  arrowNav(colorButtons, btn => {
    colorButtons.forEach(b => b.setAttribute('aria-checked', String(b === btn)));
    if (customSwatch) customSwatch.classList.remove('is-active');
    if (colorName) colorName.textContent = btn.textContent.trim();
    if (btn.dataset.original === 'true') { if (painter) painter.showOriginal(true); return; }
    const hex = getComputedStyle(btn).getPropertyValue('--c').trim(), opts = { metallic: btn.dataset.metallic === 'true' };
    if (painter) painter.setColor(hex, opts);
    if (onColor) onColor(hex, opts);
  });
  if (custom) {
    const applyCustom = () => {
      colorButtons.forEach(b => b.setAttribute('aria-checked', 'false'));
      customSwatch.classList.add('is-active');
      customSwatch.style.setProperty('--c', custom.value);
      if (colorName) colorName.textContent = `Custom ${custom.value.toUpperCase()}`;
      if (painter) painter.setColor(custom.value);
      if (onColor) onColor(custom.value, {});
    };
    custom.addEventListener('input', applyCustom);
    custom.addEventListener('change', applyCustom);
    customSwatch.style.setProperty('--c', custom.value);
  }
  arrowNav(finishButtons, btn => {
    finishButtons.forEach(b => b.setAttribute('aria-checked', String(b === btn)));
    if (painter) painter.setFinish(btn.dataset.finish);
    if (onFinish) onFinish(btn.dataset.finish);
  });
}

// Calipers: real photos plus the 3D wheel (caliper-3d.js)
const caliperView = document.getElementById('caliper-view');
const modeButtons = Array.from(document.querySelectorAll('#caliper-view .cv-mode button'));
const viewer = () => window.CaliperViewer;
function setMode(mode) {
  if (!caliperView) return;
  caliperView.dataset.mode = mode;
  modeButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
}
modeButtons.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
const caliperPaint = createPainter({
  view: caliperView, img: document.getElementById('caliper-img'), canvas: document.getElementById('caliper-paint'),
  stage: document.getElementById('cv-stage'), initial: 'sports', color: '#F0BE14',
  vehicles: {
    sports:  { img: asset('caliper-sports.webp'),  shade: asset('caliper-sports-shade.png'),  box: [659, 274, 170, 358], alt: 'Black wheel on a red sports car' },
    sedan:   { img: asset('caliper-sedan.webp'),   shade: asset('caliper-sedan-shade.png'),   box: [361, 484, 212, 379], size: [1320, 1227], alt: 'Gloss black wheel on a grey sedan' },
    truck:   { img: asset('caliper-truck.webp'),   shade: asset('caliper-truck-shade.png'),   box: [707, 347, 74, 162],  alt: 'Gloss black wheel on a grey pickup truck' },
    closeup: { img: asset('caliper-closeup.webp'), shade: asset('caliper-closeup-shade.png'), box: [128, 24, 307, 843], alt: 'Close-up of a brake caliper beside a drilled rotor' }
  }
});
wirePickers(caliperView && caliperView.closest('section'), caliperPaint, {
  onVehicle: () => setMode('photo'),
  onColor: (hex, opts) => { if (viewer()) viewer().setColor(hex, opts); },
  onFinish: f => { if (viewer()) viewer().setFinish(f); }
});

// Wraps: full-body color change on real cars
const wrapPaint = createPainter({
  view: document.getElementById('wrap-view'), img: document.getElementById('wrap-img'), canvas: document.getElementById('wrap-paint'),
  stage: document.getElementById('wrap-stage'), initial: 'sedan', color: '#C8102E',
  vehicles: {
    sports: { img: asset('wrap-sports.webp'), shade: asset('wrap-sports-shade.png'), box: [74, 219, 979, 435], size: [1117, 787], alt: 'Lamborghini Huracan with its body wrapped in the selected color' },
    sedan: { img: asset('wrap-sedan.webp'), shade: asset('wrap-sedan-shade.png'), box: [42, 86, 921, 314], size: [1005, 526], alt: 'BMW M3 sedan with its body wrapped in the selected color' },
    suv: { img: asset('wrap-suv.webp'), shade: asset('wrap-suv-shade.png'), box: [50, 182, 1132, 459], size: [1220, 784], alt: 'Volvo XC40 SUV with its body wrapped in the selected color' },
    truck: { img: asset('wrap-truck.webp'), shade: asset('wrap-truck-shade.png'), box: [83, 53, 838, 278], size: [990, 481], alt: 'Ram TRX pickup with its body wrapped in the selected color' }
  }
});
wirePickers(document.getElementById('wrap-view') && document.getElementById('wrap-view').closest('section'), wrapPaint);

// Tint picker: film opacity = light the film blocks (1 - VLT)
const notes = {
  70: '70%: barely there. Takes the edge off glare and blocks UV without changing the look.',
  50: '50%: a light, factory-style tint. Cooler cabin, subtle from outside.',
  35: '35%: a noticeable, clean tint. Still easy to see out of at night.',
  20: '20%: dark and private. A popular pick for rear windows.',
  5: '5%: limo tint. Maximum privacy; typically rear glass only.'
};
const film = document.getElementById('film');
const readout = document.getElementById('vlt-readout');
const note = document.getElementById('shade-note');
const shadeButtons = Array.from(document.querySelectorAll('.shade-picker button'));
function setShade(btn) {
  const vlt = Number(btn.dataset.vlt);
  shadeButtons.forEach(b => b.setAttribute('aria-checked', String(b === btn)));
  // Scale a little so the darkest shade still shows the scene through the glass
  film.style.opacity = ((100 - vlt) / 100 * 0.92).toFixed(2);
  readout.textContent = vlt;
  note.textContent = notes[vlt];
}
arrowNav(shadeButtons, setShade);
const initial = document.querySelector('.shade-picker [aria-checked="true"]');
if (initial) setShade(initial);

// Package carousels (ceramic, PPF): arrows, dots, phones open on the featured package
document.querySelectorAll('.coat-carousel').forEach(wrapEl => {
  const track = wrapEl.querySelector('.coat-track'); if (!track) return;
  const wrap = wrapEl, cards = Array.from(track.children);
  const prev = wrap.querySelector('.cc-prev'), next = wrap.querySelector('.cc-next'), dotsEl = wrap.querySelector('.cc-dots');
  const dots = cards.map((c, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', c.querySelector('h4').textContent);
    b.addEventListener('click', () => go(i)); dotsEl.appendChild(b); return b;
  });
  const step = () => cards[1].offsetLeft - cards[0].offsetLeft;
  const current = () => Math.round(track.scrollLeft / step());
  function go(i) {
    i = Math.max(0, Math.min(cards.length - 1, i));
    const center = getComputedStyle(cards[i]).scrollSnapAlign.includes('center');
    track.scrollTo({ left: center ? cards[i].offsetLeft - (track.clientWidth - cards[i].offsetWidth) / 2 : cards[i].offsetLeft - cards[0].offsetLeft });
  }
  function update() {
    const max = track.scrollWidth - track.clientWidth - 2, x = track.scrollLeft;
    let idx = cards.findIndex(c => c.offsetLeft + c.offsetWidth / 2 >= x + (track.clientWidth < 700 ? track.clientWidth / 2 : 1));
    if (x >= max) idx = cards.length - 1; if (idx < 0) idx = 0;
    dots.forEach((d, i) => d.setAttribute('aria-selected', String(i === idx)));
    prev.disabled = x <= 8; next.disabled = x >= max - 6;
  }
  prev.addEventListener('click', () => track.scrollBy({ left: -step() }));
  next.addEventListener('click', () => track.scrollBy({ left: step() }));
  track.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); next.click(); } if (e.key === 'ArrowLeft') { e.preventDefault(); prev.click(); } });
  track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  addEventListener('resize', update);
  // phones open on the featured package; wider screens start at Level I with Level II already in view
  if (innerWidth < 760) { track.style.scrollBehavior = 'auto'; go(cards.findIndex(c => c.classList.contains('is-featured'))); track.style.scrollBehavior = ''; }
  update();
});

const yearEl = document.getElementById('year'); if (yearEl) yearEl.textContent = new Date().getFullYear();

// Tint visualizer (tint page): shade slider + before/after wipe on the BMW photo
(() => {
  const stage = document.getElementById('tv-stage'); if (!stage) return;
  const film = document.getElementById('tv-film');
  const range = document.getElementById('tv-range'), compare = document.getElementById('tv-compare');
  const readout = document.getElementById('tv-readout'), note = document.getElementById('tv-note');
  const stops = [75, 70, 50, 35, 20, 5];
  const notes = {
    75: '75%: nearly clear. Cuts heat and UV with almost no change in look.',
    70: '70%: barely there. Takes the edge off glare without changing the look.',
    50: '50%: a light, factory-style tint. Subtle from outside.',
    35: '35%: a noticeable, clean tint. Still easy to see out of at night.',
    20: '20%: dark and private. Our most requested shade for rear windows.',
    5: '5%: limo tint. Maximum privacy; typically rear glass only.'
  };
  film.style.webkitMaskImage = film.style.maskImage = `url(${asset('tint-viz-side-mask.png')})`;
  function setShade() {
    const vlt = stops[Number(range.value)];
    film.style.opacity = ((100 - vlt) / 100 * 0.93).toFixed(3);
    readout.textContent = vlt + '%';
    range.setAttribute('aria-valuetext', vlt + '% VLT');
    note.textContent = notes[vlt];
    range.style.setProperty('--fill', (Number(range.value) / 5 * 100) + '%');
  }
  function setSplit() { stage.style.setProperty('--split', compare.value + '%'); }
  range.addEventListener('input', setShade);
  compare.addEventListener('input', setSplit);
  setShade(); setSplit();
})();

// Detailing page: vehicle size + package + add-on builder with a running price
(() => {
  const root = document.getElementById('packages'); if (!root || !root.classList.contains('dp')) return;
  const sizes = Array.from(root.querySelectorAll('input[name="dp-size"]'));
  const radios = Array.from(root.querySelectorAll('input[name="dp-package"]'));
  const boxes = Array.from(root.querySelectorAll('.dp-addon input'));
  const panels = Array.from(root.querySelectorAll('.dp-panel'));
  const lines = document.getElementById('dp-lines'), total = document.getElementById('dp-total');
  const money = n => '$' + n.toLocaleString('en-US');
  const priceOf = (input, i) => { if (!input.dataset.prices) return Number(input.dataset.price); const p = input.dataset.prices.split(',').map(Number); return p.length > i ? p[i] : Number(input.dataset.price); };
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  function update() {
    const sizeEl = sizes.find(r => r.checked) || sizes[0];
    const moto = sizeEl && sizeEl.value === 'moto';
    const si = moto ? 0 : Number(sizeEl ? sizeEl.value : 0), sizeLabel = sizeEl ? sizeEl.dataset.label : '';
    // Motorcycle shows its own packages and hides the car extras
    root.querySelectorAll('.dp-moto-only').forEach(el => { el.hidden = !moto; });
    root.querySelectorAll('.dp-car-only').forEach(el => { el.hidden = moto; });
    const current = radios.find(r => r.checked);
    const isMotoPkg = r => r.value.startsWith('moto');
    if (moto && (!current || !isMotoPkg(current))) radios.find(r => r.value === 'moto').checked = true;
    if (!moto && (!current || isMotoPkg(current))) (radios.find(r => r.value === 'full') || radios[0]).checked = true;
    if (moto) boxes.forEach(b => { b.checked = false; });
    sizes.forEach(r => r.closest('.dp-size').classList.toggle('is-selected', r === sizeEl));
    radios.forEach(r => { if (isMotoPkg(r)) return; const amt = r.closest('.dp-card').querySelector('.dp-card-amt'); if (amt) amt.textContent = money(priceOf(r, si)); });
    boxes.forEach(b => { const amt = b.closest('.dp-addon').querySelector('.dp-amt'); if (amt) amt.textContent = money(priceOf(b, si)); });
    document.querySelectorAll('[data-cmp]').forEach(el => { const r = radios.find(x => x.value === el.dataset.cmp); if (r) el.textContent = money(priceOf(r, si)); });
    const pkg = radios.find(r => r.checked) || radios[0];
    panels.forEach(p => { p.hidden = p.dataset.panel !== pkg.value; });
    radios.forEach(r => r.closest('.dp-card').classList.toggle('is-selected', r === pkg));
    boxes.forEach(b => b.closest('.dp-addon').classList.toggle('is-selected', b.checked));
    const picked = boxes.filter(b => b.checked);
    let sum = priceOf(pkg, si);
    const rows = [`<li><span>${pkg.dataset.name}</span><span>${money(sum)}</span></li>`];
    picked.forEach(b => { const p = priceOf(b, si); sum += p; rows.push(`<li class="dp-line-add"><span>+ ${b.dataset.name}</span><span>${money(p)}</span></li>`); });
    lines.innerHTML = rows.join('');
    total.textContent = money(sum);
    setText('dp-bar-total', money(sum));
    setText('dp-size-label', sizeLabel);
    setText('dp-pick', pkg.dataset.name);
    setText('dp-pick-size', sizeLabel);
    const extras = document.getElementById('dp-pick-extras');
    if (extras) extras.textContent = picked.length ? ', then add ' + picked.map(b => b.dataset.name.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' and $1') : '';
  }
  [...sizes, ...radios, ...boxes].forEach(i => i.addEventListener('change', update));
  update();
  // Phones: a slim bar with the running price while the builder is on screen and the summary isn't
  const bar = document.getElementById('dp-bar'), summary = root.querySelector('.dp-summary');
  if (bar && 'IntersectionObserver' in window) {
    let inSection = false, summaryVisible = false;
    const sync = () => bar.classList.toggle('is-on', inSection && !summaryVisible);
    new IntersectionObserver(e => { inSection = e[0].isIntersecting; sync(); }, { rootMargin: '-40% 0px -20% 0px' }).observe(root.querySelector('.dp-body'));
    new IntersectionObserver(e => { summaryVisible = e[0].isIntersecting; sync(); }).observe(summary);
  }
})();

// PPF rock chip test (PPF page): throw rocks at a car; film zones deflect them, bare paint chips
(() => {
  const stage = document.getElementById('rc-stage'); if (!stage) return;
  const cover = document.getElementById('rc-cover'), fx = document.getElementById('rc-fx');
  const cctx = cover.getContext('2d'), fctx = fx.getContext('2d');
  const W = 1090, H = 395;
  const btns = Array.from(document.querySelectorAll('.rc-pkgs button'));
  const chipsEl = document.getElementById('rc-chips'), blockedEl = document.getElementById('rc-blocked');
  const msg = document.getElementById('rc-msg'), driveBtn = document.getElementById('rc-drive');
  const names = ['no film', 'Partial Front', 'Full Front', 'Track Performance', 'Full Body'];
  let level = 0, zone = null, chips = [], rocks = [], sparks = [], nChip = 0, nBlock = 0, driving = false, raf = 0;
  [cover, fx].forEach(c => { c.width = W * 2; c.height = H * 2; });
  cctx.scale(2, 2); fctx.scale(2, 2);
  const img = new Image();
  img.onload = () => {
    const t = document.createElement('canvas'); t.width = W; t.height = H;
    const tc = t.getContext('2d'); tc.drawImage(img, 0, 0);
    const d = tc.getImageData(0, 0, W, H).data; zone = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) zone[i] = Math.round(d[i * 4] / 60);
    drawCover();
  };
  img.src = asset('ppf-zones.png');
  const zoneAt = (x, y) => zone ? zone[(Math.round(y) * W + Math.round(x))] || 0 : 0;
  const covered = (x, y) => { const z = zoneAt(x, y); return z > 0 && z <= level; };
  function drawCover() {
    cctx.clearRect(0, 0, W, H); if (!zone || !level) return;
    const id = cctx.createImageData(W, H), d = id.data;
    for (let i = 0; i < W * H; i++) { const z = zone[i]; if (z && z <= level) { d[i*4] = 90; d[i*4+1] = 180; d[i*4+2] = 255; d[i*4+3] = 70; } }
    const t = document.createElement('canvas'); t.width = W; t.height = H; t.getContext('2d').putImageData(id, 0, 0);
    cctx.drawImage(t, 0, 0);
    // glossy film edge sweep
    cctx.save(); cctx.globalCompositeOperation = 'source-atop';
    const g = cctx.createLinearGradient(0, 0, W, H); g.addColorStop(0.35, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.35)'); g.addColorStop(0.65, 'rgba(255,255,255,0)');
    cctx.fillStyle = g; cctx.fillRect(0, 0, W, H); cctx.restore();
  }
  function setLevel(l) {
    level = l; btns.forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.level) === l)));
    reset(); drawCover();
    msg.textContent = l ? `${names[l]} selected. Shaded areas are covered by film. Hit drive or tap the car.` : 'No film selected. Every rock hits bare paint. Hit drive or tap the car.';
  }
  function reset() { chips = []; rocks = []; sparks = []; nChip = 0; nBlock = 0; score(); kick(); }
  function score() { chipsEl.textContent = nChip; blockedEl.textContent = nBlock; }
  function makeChip(x, y) {
    const k = Math.min(2.4, Math.max(1, 760 / (stage.clientWidth || 760)));
    const r = (2.6 + Math.random() * 3) * k, n = 8 + (Math.random() * 4 | 0), pts = [];
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, rr = r * (0.55 + Math.random() * 0.6); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.85]); }
    return { pts, x, y, r };
  }
  function throwRock(tx, ty) {
    const sy = Math.min(H - 40, ty + 30 + Math.random() * 40);
    const rk = Math.min(2, Math.max(1, 760 / (stage.clientWidth || 760)));
    rocks.push({ sx: -10, sy, tx, ty, t: 0, dur: 18 + Math.random() * 10, s: (1.6 + Math.random() * 1.4) * rk, done: false, bounce: null });
    kick();
  }
  function impact(r) {
    const z = zoneAt(r.tx, r.ty);
    if (!z) { r.bounce = { vx: -2 - Math.random() * 2, vy: -1.5 - Math.random() * 2, x: r.tx, y: r.ty, life: 26 }; return; }
    if (z <= level) {
      nBlock++; r.bounce = { vx: -2.5 - Math.random() * 2.5, vy: -2 - Math.random() * 2.5, x: r.tx, y: r.ty, life: 30 };
      sparks.push({ x: r.tx, y: r.ty, t: 0, film: true });
    } else {
      nChip++; chips.push(makeChip(r.tx, r.ty)); sparks.push({ x: r.tx, y: r.ty, t: 0, film: false });
      r.bounce = { vx: -1.2 - Math.random(), vy: 1 + Math.random(), x: r.tx, y: r.ty, life: 18 };
    }
    score();
  }
  function frame() {
    fctx.clearRect(0, 0, W, H);
    for (const c of chips) {
      fctx.beginPath(); c.pts.forEach((p, i) => i ? fctx.lineTo(p[0], p[1]) : fctx.moveTo(p[0], p[1])); fctx.closePath();
      fctx.fillStyle = '#4a4f56'; fctx.fill(); fctx.strokeStyle = 'rgba(255,255,255,.55)'; fctx.lineWidth = 0.6; fctx.stroke();
      fctx.beginPath(); fctx.arc(c.x + 0.2, c.y + 0.2, c.r * 0.45, 0, 7); fctx.fillStyle = '#b9bcc0'; fctx.fill();
      fctx.beginPath(); fctx.arc(c.x - c.r * 0.2, c.y - c.r * 0.25, c.r * 0.18, 0, 7); fctx.fillStyle = '#2b2f34'; fctx.fill();
    }
    let live = false;
    for (const s of sparks) {
      if (s.t > 22) continue; live = true; s.t++;
      const k = s.t / 22;
      if (s.film) { fctx.beginPath(); fctx.arc(s.x, s.y, 3 + k * 14, 0, 7); fctx.strokeStyle = `rgba(80,170,255,${1 - k})`; fctx.lineWidth = 2; fctx.stroke(); }
      else { for (let i = 0; i < 6; i++) { const a = i * 1.05 + s.x; fctx.fillStyle = `rgba(250,250,250,${1 - k})`; fctx.fillRect(s.x + Math.cos(a) * k * 10, s.y + Math.sin(a) * k * 8 + k * k * 6, 1.6, 1.6); } }
    }
    for (const r of rocks) {
      if (r.done) continue; live = true;
      let x, y;
      if (!r.bounce) {
        r.t++; const k = Math.min(r.t / r.dur, 1);
        x = r.sx + (r.tx - r.sx) * k; y = r.sy + (r.ty - r.sy) * k - Math.sin(k * Math.PI) * 18;
        if (k >= 1) impact(r);
      } else {
        const b = r.bounce; b.x += b.vx; b.y += b.vy; b.vy += 0.25; b.life--; x = b.x; y = b.y; if (b.life <= 0) r.done = true;
      }
      fctx.beginPath(); fctx.ellipse(x, y, r.s * 1.2, r.s, 0.6, 0, 7); fctx.fillStyle = '#6b6560'; fctx.fill();
      fctx.beginPath(); fctx.arc(x - r.s * 0.3, y - r.s * 0.3, r.s * 0.35, 0, 7); fctx.fillStyle = 'rgba(255,255,255,.5)'; fctx.fill();
    }
    rocks = rocks.filter(r => !r.done);
    if (live || driving) raf = requestAnimationFrame(frame); else raf = 0;
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  function randomTarget() {
    for (let i = 0; i < 400; i++) {
      // highway debris mostly hits the front end and lower body
      const p = Math.random(); let x, y;
      if (p < 0.6) { x = 56 + Math.random() * 300; y = 150 + Math.random() * 170; }
      else if (p < 0.85) { x = 356 + Math.random() * 640; y = 255 + Math.random() * 60; }
      else { x = 56 + Math.random() * 980; y = 60 + Math.random() * 260; }
      if (zoneAt(x, y)) return [x, y];
    }
    return [150, 250];
  }
  function drive() {
    if (driving) return; reset(); driving = true; driveBtn.disabled = true; kick();
    let n = 0; const total = 40;
    const tick = () => { const [x, y] = randomTarget(); throwRock(x, y); if (++n < total) setTimeout(tick, 60 + Math.random() * 90); else setTimeout(finish, 900); };
    tick();
  }
  function finish() {
    driving = false; driveBtn.disabled = false;
    msg.textContent = !level ? `One highway mile with no film: ${nChip} chips in your paint.`
      : nChip ? `${names[level]}: ${nBlock} rocks stopped by the film, ${nChip} chips where the paint was bare.`
      : `${names[level]}: all ${nBlock} rocks stopped. Not a single chip.`;
  }
  btns.forEach(b => b.addEventListener('click', () => setLevel(Number(b.dataset.level))));
  driveBtn.addEventListener('click', drive);
  document.getElementById('rc-reset').addEventListener('click', () => { reset(); msg.textContent = 'Car reset. Hit drive or tap the car.'; });
  fx.addEventListener('pointerdown', e => {
    const b = fx.getBoundingClientRect(); const x = (e.clientX - b.left) / b.width * W, y = (e.clientY - b.top) / b.height * H;
    if (zoneAt(x, y)) throwRock(x, y);
  });
})();

// Ceramic dirt test (PPF & ceramic page): sling dirt, rinse; coating levels release grime more easily
(() => {
  const stage = document.getElementById('dt-stage'); if (!stage) return;
  const W = 1090, H = 395, R = 2;
  const gloss = document.getElementById('dt-gloss'), dirtC = document.getElementById('dt-dirt'), fx = document.getElementById('dt-fx');
  [gloss, dirtC, fx].forEach(c => { c.width = W * R; c.height = H * R; });
  const gctx = gloss.getContext('2d'), dctx = dirtC.getContext('2d'), fctx = fx.getContext('2d');
  [gctx, dctx, fctx].forEach(c => c.scale(R, R));
  const btns = Array.from(document.querySelectorAll('.dt-pkgs button'));
  const leftEl = document.getElementById('dt-left'), rinsesEl = document.getElementById('dt-rinses'), msg = document.getElementById('dt-msg');
  const mudBtn = document.getElementById('dt-mud'), rinseBtn = document.getElementById('dt-rinse'), wipeBtn = document.getElementById('dt-wipe');
  const names = ['Bare paint', 'Level I Sealant', 'Level II 5-Year', 'Level III 10-Year'];
  // how much of each kind of dirt stays after one rinse, by coating level
  const KEEP = { mud: [0.4, 0.06, 0.02, 0], film: [0.55, 0.04, 0, 0], bug: [0.85, 0.3, 0.18, 0.1], drop: [0.9, 0.35, 0.2, 0.12] };
  let level = 0, zone = null, maskCanvas = null, items = [], spots = [], beads = [], rinses = 0, total = 0, busy = false, sweep = null, raf = 0;
  const img = new Image();
  img.onload = () => {
    const t = document.createElement('canvas'); t.width = W; t.height = H; const tc = t.getContext('2d'); tc.drawImage(img, 0, 0);
    const id = tc.getImageData(0, 0, W, H), d = id.data; zone = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) { zone[i] = d[i * 4] > 20 ? 1 : 0; d[i*4] = d[i*4+1] = d[i*4+2] = 0; d[i*4+3] = zone[i] ? 255 : 0; }
    tc.putImageData(id, 0, 0); maskCanvas = t; drawGloss();
  };
  img.src = asset('ppf-zones.png');
  const onPaint = (x, y) => zone && x >= 0 && y >= 0 && x < W && y < H && zone[(y | 0) * W + (x | 0)] === 1;
  let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const scaleK = () => Math.min(2.2, Math.max(1, 760 / (stage.clientWidth || 760)));
  function add(type, x, y) {
    if (!onPaint(x, y)) return;
    const k = scaleK(), s = (type === 'mud' ? 3 + Math.random() * 4 : type === 'film' ? 26 + Math.random() * 22 : type === 'bug' ? 1.3 + Math.random() * 1.1 : 4 + Math.random() * 3) * (type === 'film' ? 1 : k);
    const it = { type, x, y, s, a: 1, seed: (Math.random() * 1e9) | 0 };
    items.push(it); total += s * s;
  }
  function drawItem(c, it) {
    seed = it.seed; c.globalAlpha = it.a;
    if (it.type === 'mud') {
      const cols = ['#7a6448', '#8b7656', '#5e4a34', '#6f5a40'];
      c.beginPath(); c.ellipse(it.x, it.y, it.s * 0.7, it.s * 0.5, 0, 0, 7); c.fillStyle = 'rgba(105,85,60,.7)'; c.fill();
      const n = 12 + (rnd() * 8 | 0);
      for (let i = 0; i < n; i++) {
        // spray flies rearward (car travels left), so droplets trail to the right
        const a = (rnd() - 0.5) * 2.2, r = it.s * (0.3 + rnd() * 1.6);
        const x = it.x + Math.cos(a) * r, y = it.y + Math.sin(a) * r * 0.6, d = 0.4 + rnd() * it.s * 0.22;
        c.beginPath(); c.ellipse(x, y, d * (1 + rnd()), d, a * 0.4, 0, 7); c.fillStyle = cols[i % 4]; c.globalAlpha = it.a * (0.5 + rnd() * 0.4); c.fill();
      }
    } else if (it.type === 'film') {
      const g = c.createRadialGradient(it.x, it.y, 0, it.x, it.y, it.s);
      g.addColorStop(0, 'rgba(120,100,72,.30)'); g.addColorStop(1, 'rgba(120,100,72,0)');
      c.fillStyle = g; c.beginPath(); c.ellipse(it.x, it.y, it.s * 1.6, it.s * 0.6, 0, 0, 7); c.fill();
    } else if (it.type === 'bug') {
      c.beginPath(); c.ellipse(it.x + it.s * 0.6, it.y, it.s * 1.8, it.s * 0.8, 0, 0, 7); c.fillStyle = 'rgba(160,150,95,.45)'; c.fill();
      c.beginPath(); c.ellipse(it.x - it.s * 0.4, it.y, it.s * 0.7, it.s * 0.55, 0, 0, 7); c.fillStyle = '#2a2622'; c.fill();
      c.fillStyle = 'rgba(120,112,80,.45)'; c.fillRect(it.x, it.y - 0.3, it.s * 3, 0.6);
    } else {
      const n = 6;
      for (let i = 0; i < n; i++) { const a = rnd() * 6.3, r = rnd() * it.s * 0.8; c.beginPath(); c.arc(it.x + Math.cos(a) * r, it.y + Math.sin(a) * r, it.s * (0.4 + rnd() * 0.4), 0, 7); c.fillStyle = '#e9e7df'; c.fill(); }
      c.beginPath(); c.arc(it.x, it.y, it.s * 0.4, 0, 7); c.fillStyle = '#7d7a72'; c.fill();
      c.beginPath(); c.arc(it.x + it.s * 0.3, it.y + it.s * 0.2, it.s * 0.2, 0, 7); c.fillStyle = '#3d3a35'; c.fill();
    }
    c.globalAlpha = 1;
  }
  function drawGloss() {
    gctx.clearRect(0, 0, W, H); if (!maskCanvas || !level) return;
    const g = gctx.createLinearGradient(0, 0, W * 0.6, H);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.45, `rgba(255,255,255,${0.12 + level * 0.06})`); g.addColorStop(0.55, `rgba(200,230,255,${0.1 + level * 0.05})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    gctx.fillStyle = g; gctx.fillRect(0, 0, W, H);
    gctx.globalCompositeOperation = 'destination-in'; gctx.drawImage(maskCanvas, 0, 0); gctx.globalCompositeOperation = 'source-over';
  }
  function render() {
    dctx.clearRect(0, 0, W, H);
    for (const s of spots) { dctx.beginPath(); dctx.arc(s.x, s.y, s.r, 0, 7); dctx.strokeStyle = `rgba(150,155,160,${s.a})`; dctx.lineWidth = 0.7; dctx.stroke(); }
    for (const it of items) if (it.a > 0.01) drawItem(dctx, it);
    if (maskCanvas) { dctx.globalCompositeOperation = 'destination-in'; dctx.drawImage(maskCanvas, 0, 0); dctx.globalCompositeOperation = 'source-over'; }
    const left = total ? items.reduce((a, it) => a + it.s * it.s * it.a, 0) / total : 0;
    leftEl.textContent = Math.round(left * 100) + '%'; rinsesEl.textContent = rinses;
    return left;
  }
  function fxFrame() {
    fctx.clearRect(0, 0, W, H); let live = false;
    if (sweep !== null) {
      live = true; sweep += 18;
      const x = sweep, g = fctx.createLinearGradient(x - 160, 0, x + 20, 0);
      g.addColorStop(0, 'rgba(170,215,255,0)'); g.addColorStop(0.75, 'rgba(170,215,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,.75)');
      fctx.fillStyle = g; fctx.fillRect(x - 160, 0, 180, H);
      fctx.strokeStyle = 'rgba(255,255,255,.55)'; fctx.lineWidth = 1;
      for (let i = 0; i < 40; i++) { const sx = x - Math.random() * 150, sy = Math.random() * H; fctx.beginPath(); fctx.moveTo(sx, sy); fctx.lineTo(sx - 6, sy + 18); fctx.stroke(); }
      for (const it of items) if (!it.rinsed && it.x < x) { it.rinsed = true; it.target = it.a * KEEP[it.type][level]; }
      if (level) for (let i = 0; i < 10; i++) { const bx = x - Math.random() * 120, by = 60 + Math.random() * 260; if (onPaint(bx, by)) beads.push({ x: bx, y: by, v: 0.5 + Math.random(), r: 1 + Math.random() * 1.6 * (1 + level * 0.15), life: 50 }); }
      if (x > W + 180) { sweep = null; afterRinse(); }
    }
    for (const it of items) if (it.target !== undefined && it.a > it.target) { it.a = Math.max(it.target, it.a - 0.06); live = true; }
    beads = beads.filter(b => b.life > 0);
    for (const b of beads) { live = true; b.life--; b.v += 0.12; b.y += b.v; if (!onPaint(b.x, b.y)) b.life = 0;
      fctx.beginPath(); fctx.arc(b.x, b.y, b.r, 0, 7); fctx.fillStyle = 'rgba(255,255,255,.75)'; fctx.fill();
      fctx.beginPath(); fctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.35, 0, 7); fctx.fillStyle = 'rgba(255,255,255,1)'; fctx.fill(); }
    if (live) render();
    raf = live ? requestAnimationFrame(fxFrame) : 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(fxFrame); };
  function afterRinse() {
    items.forEach(it => { delete it.rinsed; delete it.target; });
    items = items.filter(it => it.a > 0.02);
    rinses++;
    if (!level) for (let i = 0; i < 60; i++) { const x = 60 + Math.random() * 970, y = 60 + Math.random() * 260; if (onPaint(x, y)) spots.push({ x, y, r: 1.2 + Math.random() * 2.2, a: 0.55 }); }
    const left = render(); busy = false; setBusy(false);
    if (!total) { msg.textContent = 'Nothing to rinse yet. Get the car dirty first.'; return; }
    const specks = items.filter(it => it.type !== 'mud' && it.type !== 'film' && it.a > 0.05).length;
    if (left < 0.03 && !specks) { msg.textContent = `${names[level]}: clean after ${rinses === 1 ? 'one rinse' : rinses + ' rinses'}. Grime just let go.`; wipeBtn.hidden = true; }
    else if (level) { msg.textContent = `${names[level]}: the grime rinsed off. Just a few bug and bird spots left, and one quick wipe takes care of them.`; wipeBtn.textContent = 'Quick wipe'; wipeBtn.hidden = false; }
    else { msg.textContent = `Bare paint: ${Math.round(left * 100)}% of the dirt is still stuck${spots.length ? ', plus water spots as it dries' : ''}. It needs a hand scrub.`; wipeBtn.textContent = 'Hand scrub'; wipeBtn.hidden = false; }
  }
  function setBusy(b) { [mudBtn, rinseBtn].forEach(x => x.disabled = b); }
  function rinse() { if (busy) return; busy = true; setBusy(true); sweep = -40; kick(); }
  function wipe() {
    const was = wipeBtn.textContent; items = []; spots = []; total = 0; wipeBtn.hidden = true; render();
    msg.textContent = was === 'Quick wipe' ? `${names[level]}: one quick wipe and it's spotless.` : 'Bare paint: clean again, after a full hand wash and scrub.';
  }
  function reset() { items = []; spots = []; beads = []; total = 0; rinses = 0; wipeBtn.hidden = true; render(); }
  function mud() {
    for (let i = 0; i < 40; i++) add('film', 70 + Math.random() * 960, 250 + Math.random() * 60);
    for (let i = 0; i < 170; i++) { const x = 56 + Math.random() * 980, y = 215 + Math.pow(Math.random(), 0.5) * 100; add('mud', x, y); }
    for (let i = 0; i < 40; i++) add('mud', 56 + Math.random() * 280, 160 + Math.random() * 160);
    for (let i = 0; i < 45; i++) add('bug', 56 + Math.random() * 220, 150 + Math.random() * 110);
    for (let i = 0; i < 5; i++) add('drop', 140 + Math.random() * 760, 60 + Math.random() * 110);
    render(); msg.textContent = 'Muddy, buggy and the birds found it too. Now rinse it.';
  }
  function setLevel(l) {
    level = l; btns.forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.level) === l)));
    reset(); drawGloss(); msg.textContent = `${names[l]} selected. Get it dirty, then rinse.`;
  }
  btns.forEach(b => b.addEventListener('click', () => setLevel(Number(b.dataset.level))));
  mudBtn.addEventListener('click', mud); rinseBtn.addEventListener('click', rinse); wipeBtn.addEventListener('click', wipe);
  document.getElementById('dt-reset').addEventListener('click', () => { reset(); msg.textContent = 'Car reset. Get it dirty, then rinse.'; });
  let down = false, last = null;
  const pos = e => { const b = fx.getBoundingClientRect(); return [(e.clientX - b.left) / b.width * W, (e.clientY - b.top) / b.height * H]; };
  fx.addEventListener('pointerdown', e => { if (busy) return; down = true; last = pos(e); fx.setPointerCapture(e.pointerId); add('mud', ...last); render(); });
  fx.addEventListener('pointermove', e => {
    if (!down) return; const p = pos(e), dx = p[0] - last[0], dy = p[1] - last[1], d = Math.hypot(dx, dy);
    for (let s = 6; s <= d; s += 6) add('mud', last[0] + dx * s / d + (Math.random() - 0.5) * 6, last[1] + dy * s / d + (Math.random() - 0.5) * 6);
    if (d >= 6) last = p; render();
  });
  ['pointerup', 'pointercancel'].forEach(t => fx.addEventListener(t, () => { down = false; }));
})();
