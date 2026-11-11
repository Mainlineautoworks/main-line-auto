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
const ASSET_V = '20261111a';
const toLin = v => Math.pow(v / 255, 2.2);
const hexLin = h => { const n = parseInt(h.replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255].map(toLin); };
const FIN = { gloss: [1, 1], satin: [0.8, 0.4], matte: [0.6, 0.12] };   // lighting contrast, shine kept
// Lighting presets for the wrap preview. con/shine/gain/tint change how the paint reads;
// bands are reflected light streaks [position, width, strength, slant, top, bottom] across the body.
const LIGHTS = {
  studio:   { con: 1,    shine: 1,   gain: 1,    tint: [1, 1, 1],         bands: [], bandTint: [1, 1, 1] },
  sun:      { con: 1.3,  shine: 1.7, gain: 1.12, tint: [1.06, 1.0, 0.92], bands: [[0.34, 0.06, 0.6, 0.35, 0, 0.62], [0.72, 0.04, 0.35, 0.35, 0, 0.55]], bandTint: [1, 0.97, 0.88] },
  overcast: { con: 0.62, shine: 0.45, gain: 0.95, tint: [0.96, 0.98, 1.02], bands: [[0.5, 0.42, 0.22, 0, 0, 0.5]], bandTint: [0.9, 0.95, 1] },
  garage:   { con: 1.05, shine: 1.15, gain: 0.98, tint: [0.98, 1.0, 1.02], bands: [[0.25, 0.016, 0.42, 0.5, 0.02, 0.55], [0.52, 0.016, 0.42, 0.5, 0.02, 0.55], [0.79, 0.016, 0.42, 0.5, 0.02, 0.55]], bandTint: [0.95, 0.98, 1] },
  night:    { con: 1.2,  shine: 0.9, gain: 0.85, tint: [1.0, 0.92, 0.82], bands: [[0.22, 0.04, 0.55, -0.2, 0, 0.65], [0.64, 0.06, 0.25, -0.2, 0, 0.7]], bandTint: [1, 0.62, 0.25] }
};
const shadeCache = {};
// Run fn once the page has finished loading and el is (nearly) on screen, so heavy demo images
// never compete with the first view of the page.
function whenNear(el, fn, margin = '300px') {
  const go = () => {
    if (!('IntersectionObserver' in window)) return fn();
    new IntersectionObserver((es, obs) => { if (es.some(e => e.isIntersecting)) { obs.disconnect(); fn(); } }, { rootMargin: margin }).observe(el);
  };
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
}
function loadShade(src) {
  if (!shadeCache[src]) shadeCache[src] = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  return shadeCache[src];
}
function createPainter({ view, img, canvas, stage, vehicles, initial, color }) {
  if (!canvas || !view || !img) return null;
  const ctx = canvas.getContext('2d');
  let lit = null, hi = null, alpha = null, out = null, mean = 0.1, loadId = 0, hidden = false;
  let cur = hexLin(color), goal = cur, fin = FIN.gloss, goalFin = fin, metal = 0, anim = 0;
  let light = LIGHTS.studio, lw = 0, lh = 0;
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
    const o = out.data, [con0, shine] = fin, L = light;
    const con = con0 * L.con, hiGain = shine * (metal ? 1.6 : 1) * L.shine;
    // reflected light streaks: sharp on gloss, spread out and faint on matte
    const spread = 1 + (1 - shine) * 4.5, bandK = Math.pow(shine, 0.8);
    const W = canvas.width, Hh = canvas.height;
    for (let i = 0; i < lit.length; i++) {
      if (!alpha[i]) { o[i * 4 + 3] = 0; continue; }
      const s = Math.max(0, mean + (lit[i] - mean) * con) * L.gain;
      let h = hi[i] * hiGain, b = 0;
      if (L.bands.length) {
        // reflections ride on the brighter, upward-facing panels and break up across body lines
        const x = (i % W) / W, y = ((i / W) | 0) / Hh, r = Math.min(1.4, lit[i] / mean), follow = r * r * 0.7;
        for (const [pos, wid, str, slant, y0, y1] of L.bands) {
          if (y < y0 || y > y1) continue;
          const fade = Math.min(1, (y - y0) / 0.12, (y1 - y) / 0.12);
          const u = x + (y - 0.5) * slant + Math.sin(y * 18 + pos * 9) * 0.012, d = (u - pos) / (wid * spread);
          b += Math.exp(-d * d) * str * bandK * follow * fade;
        }
      }
      for (let c = 0; c < 3; c++) o[i * 4 + c] = 255 * Math.pow(Math.min(1, cur[c] * s * L.tint[c] + h + b * L.bandTint[c]), 1 / 2.2);
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
  // load the first car when the section is about to scroll into view; warm the others a bit later
  whenNear(view, () => {
    setVehicle(initial, true);
    setTimeout(() => Object.values(vehicles).forEach(v => { loadShade(v.shade); const i = new Image(); i.src = v.img; }), 2500);
  }, '400px');
  return {
    setVehicle,
    showOriginal(on) { hidden = on; render(); },
    setColor(hex, opts = {}) { hidden = false; goal = hexLin(hex).map(v => opts.metallic ? v * 0.7 : v); metal = opts.metallic ? 1 : 0; animate(); },
    setFinish(name) { goalFin = FIN[name] || FIN.gloss; animate(); },
    setLight(name) { light = LIGHTS[name] || LIGHTS.studio; render(); }
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
    sports:  { img: asset('caliper-sports.webp'),  shade: asset('caliper-sports-shade.webp'),  box: [659, 274, 170, 358], alt: 'Black wheel on a red sports car' },
    sedan:   { img: asset('caliper-sedan.webp'),   shade: asset('caliper-sedan-shade.webp'),   box: [361, 484, 212, 379], size: [1320, 1227], alt: 'Gloss black wheel on a grey sedan' },
    truck:   { img: asset('caliper-truck.webp'),   shade: asset('caliper-truck-shade.webp'),   box: [707, 347, 74, 162],  alt: 'Gloss black wheel on a grey pickup truck' },
    closeup: { img: asset('caliper-closeup.webp'), shade: asset('caliper-closeup-shade.webp'), box: [128, 24, 307, 843], alt: 'Close-up of a brake caliper beside a drilled rotor' }
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
    sports: { img: asset('wrap-sports.webp'), shade: asset('wrap-sports-shade.webp'), box: [74, 219, 979, 435], size: [1117, 787], alt: 'Lamborghini Huracan with its body wrapped in the selected color' },
    sedan: { img: asset('wrap-sedan.webp'), shade: asset('wrap-sedan-shade.webp'), box: [42, 86, 921, 314], size: [1005, 526], alt: 'BMW M3 sedan with its body wrapped in the selected color' },
    suv: { img: asset('wrap-suv.webp'), shade: asset('wrap-suv-shade.webp'), box: [50, 182, 1132, 459], size: [1220, 784], alt: 'Volvo XC40 SUV with its body wrapped in the selected color' },
    truck: { img: asset('wrap-truck.webp'), shade: asset('wrap-truck-shade.webp'), box: [83, 53, 838, 278], size: [990, 481], alt: 'Ram TRX pickup with its body wrapped in the selected color' }
  }
});
wirePickers(document.getElementById('wrap-view') && document.getElementById('wrap-view').closest('section'), wrapPaint);
// Wrap lighting switcher: scene look comes from CSS on the view, paint reflections from the painter
(() => {
  const view = document.getElementById('wrap-view'); if (!view || !wrapPaint) return;
  const section = view.closest('section'), btns = Array.from(section.querySelectorAll('.light-picker button'));
  const note = section.querySelector('.light-note');
  const notes = {
    studio: 'Even studio light, like our shop.',
    sun: 'Direct sun: gloss throws sharp reflections, matte stays flat and even.',
    overcast: 'Overcast: soft light. Color looks truest, and finishes look closest to each other.',
    garage: 'Garage lights: watch the tube reflections stay crisp on gloss and blur out on satin and matte.',
    night: 'Night under streetlights: darker colors fade into shadow, and gloss picks up the orange glow.'
  };
  arrowNav(btns, btn => {
    btns.forEach(b => b.setAttribute('aria-checked', String(b === btn)));
    view.dataset.light = btn.dataset.light; wrapPaint.setLight(btn.dataset.light);
    if (note) note.textContent = notes[btn.dataset.light];
  });
})();

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

// Ceramic dirt test (PPF & ceramic page): realistic grime layers, rinsed off; coating levels release grime more easily
(() => {
  const stage = document.getElementById('dt-stage'); if (!stage) return;
  const W = 1090, H = 395, WW = W * 2, HH = H * 2;
  const gloss = document.getElementById('dt-gloss'), dirtC = document.getElementById('dt-dirt'), fx = document.getElementById('dt-fx');
  [gloss, dirtC, fx].forEach(c => { c.width = WW; c.height = HH; });
  const gctx = gloss.getContext('2d'), dctx = dirtC.getContext('2d'), fctx = fx.getContext('2d');
  const btns = Array.from(document.querySelectorAll('.dt-pkgs button'));
  const leftEl = document.getElementById('dt-left'), rinsesEl = document.getElementById('dt-rinses'), msg = document.getElementById('dt-msg');
  const mudBtn = document.getElementById('dt-mud'), rinseBtn = document.getElementById('dt-rinse'), wipeBtn = document.getElementById('dt-wipe');
  const names = ['Bare paint', 'Level I Sealant', 'Level II 5-Year', 'Level III 10-Year'];
  // share of each layer left after one rinse, by coating level
  const KEEP = { road: [0.4, 0.05, 0.02, 0], smear: [0.45, 0.06, 0.02, 0], bugs: [0.85, 0.3, 0.18, 0.1], drops: [0.9, 0.35, 0.2, 0.12] };
  const WEIGHT = { road: 94.6, bugs: 6, drops: 4 };          // relative amount of dirt in each layer
  const L = {}; ['road', 'bugs', 'drops', 'smear', 'spots', 'mask'].forEach(k => { L[k] = new Image(); });
  whenNear(stage, () => Object.keys(L).forEach(k => { L[k].src = asset(k === 'mask' ? 'grime-mask.png' : `grime-${k}.webp`); }), '600px');
  const A = { road: 0, bugs: 0, drops: 0, smear: 0, spots: 0 }, from = {}, to = {};
  const smearMask = document.createElement('canvas'); smearMask.width = WW; smearMask.height = HH; const smctx = smearMask.getContext('2d');
  const smearLayer = document.createElement('canvas'); smearLayer.width = WW; smearLayer.height = HH; const slctx = smearLayer.getContext('2d');
  let level = 0, smearAmt = 0, peak = 0, rinses = 0, busy = false, sweep = null, raf = 0, beads = [];
  let zone = null; const zi = new Image();
  zi.onload = () => { const t = document.createElement('canvas'); t.width = W; t.height = H; const c = t.getContext('2d'); c.drawImage(zi, 0, 0); const d = c.getImageData(0, 0, W, H).data; zone = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) zone[i] = d[i * 4] > 20 ? 1 : 0; };
  zi.src = asset('ppf-zones.png');
  const onPaint = (x, y) => zone && x >= 0 && y >= 0 && x < W && y < H && zone[(y | 0) * W + (x | 0)] === 1;
  const ready = () => Object.values(L).every(i => i.complete && i.naturalWidth);
  function amount() { return A.road * WEIGHT.road + A.bugs * WEIGHT.bugs + A.drops * WEIGHT.drops + A.smear * smearAmt; }
  function drawLayer(img, a, b, cut) {
    // a = alpha left of the rinse line (already rinsed), b = alpha right of it
    if (cut === null) { if (b > 0.003) { dctx.globalAlpha = b; dctx.drawImage(img, 0, 0); } return; }
    const x = Math.max(0, Math.min(WW, cut));
    if (a > 0.003 && x > 0) { dctx.save(); dctx.beginPath(); dctx.rect(0, 0, x, HH); dctx.clip(); dctx.globalAlpha = a; dctx.drawImage(img, 0, 0); dctx.restore(); }
    if (b > 0.003 && x < WW) { dctx.save(); dctx.beginPath(); dctx.rect(x, 0, WW - x, HH); dctx.clip(); dctx.globalAlpha = b; dctx.drawImage(img, 0, 0); dctx.restore(); }
  }
  function render() {
    if (!ready()) return;
    dctx.clearRect(0, 0, WW, HH);
    const cut = sweep === null ? null : sweep * 2;
    const pair = k => sweep === null ? [A[k], A[k]] : [to[k], from[k]];
    if (A.spots > 0.003) { dctx.globalAlpha = A.spots; dctx.drawImage(L.spots, 0, 0); }
    if (smearAmt) { const [a, b] = pair('smear'); drawLayer(smearLayer, a, b, cut); }
    ['road', 'bugs', 'drops'].forEach(k => { const [a, b] = pair(k); drawLayer(L[k], a, b, cut); });
    dctx.globalAlpha = 1;
    const amt = amount(); peak = Math.max(peak, amt);
    leftEl.textContent = (peak ? Math.round(amt / peak * 100) : 0) + '%'; rinsesEl.textContent = rinses;
  }
  function drawGloss() {
    gctx.clearRect(0, 0, WW, HH); if (!level || !L.mask.naturalWidth) return;
    const g = gctx.createLinearGradient(0, 0, WW * 0.6, HH);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.45, `rgba(255,255,255,${0.12 + level * 0.06})`); g.addColorStop(0.55, `rgba(200,230,255,${0.1 + level * 0.05})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    gctx.fillStyle = g; gctx.fillRect(0, 0, WW, HH);
    gctx.globalCompositeOperation = 'destination-in'; gctx.drawImage(L.mask, 0, 0); gctx.globalCompositeOperation = 'source-over';
  }
  L.mask.onload = drawGloss;
  function rebuildSmear() {
    slctx.clearRect(0, 0, WW, HH); slctx.drawImage(L.smear, 0, 0);
    slctx.globalCompositeOperation = 'destination-in'; slctx.drawImage(smearMask, 0, 0); slctx.globalCompositeOperation = 'source-over';
  }
  function measureSmear() {
    const t = document.createElement('canvas'); t.width = 218; t.height = 79; const c = t.getContext('2d'); c.drawImage(smearLayer, 0, 0, 218, 79);
    const d = c.getImageData(0, 0, 218, 79).data; let s = 0; for (let i = 3; i < d.length; i += 4) s += d[i];
    smearAmt = s / 255 / (218 * 79) * 300;
  }
  function fxFrame() {
    fctx.clearRect(0, 0, WW, HH); let live = false;
    if (sweep !== null) {
      live = true; sweep += 16;
      const x = sweep * 2, g = fctx.createLinearGradient(x - 320, 0, x + 40, 0);
      g.addColorStop(0, 'rgba(170,215,255,0)'); g.addColorStop(0.75, 'rgba(170,215,255,.4)'); g.addColorStop(1, 'rgba(255,255,255,.7)');
      fctx.fillStyle = g; fctx.fillRect(x - 320, 0, 360, HH);
      fctx.strokeStyle = 'rgba(255,255,255,.5)'; fctx.lineWidth = 2;
      for (let i = 0; i < 40; i++) { const sx = x - Math.random() * 300, sy = Math.random() * HH; fctx.beginPath(); fctx.moveTo(sx, sy); fctx.lineTo(sx - 10, sy + 34); fctx.stroke(); }
      if (level) for (let i = 0; i < 10; i++) { const bx = sweep - Math.random() * 120, by = 60 + Math.random() * 260; if (onPaint(bx, by)) beads.push({ x: bx, y: by, v: 0.5 + Math.random(), r: 1 + Math.random() * 1.6 * (1 + level * 0.15), life: 50 }); }
      if (sweep > W + 180) { sweep = null; Object.keys(to).forEach(k => A[k] = to[k]); afterRinse(); }
    }
    beads = beads.filter(b => b.life > 0);
    for (const b of beads) { live = true; b.life--; b.v += 0.12; b.y += b.v; if (!onPaint(b.x, b.y)) b.life = 0;
      fctx.beginPath(); fctx.arc(b.x * 2, b.y * 2, b.r * 2, 0, 7); fctx.fillStyle = 'rgba(255,255,255,.75)'; fctx.fill();
      fctx.beginPath(); fctx.arc(b.x * 2 - b.r * 0.6, b.y * 2 - b.r * 0.6, b.r * 0.7, 0, 7); fctx.fillStyle = '#fff'; fctx.fill(); }
    render();
    raf = live ? requestAnimationFrame(fxFrame) : 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(fxFrame); };
  function afterRinse() {
    rinses++;
    if (!level && peak) A.spots = Math.min(1, A.spots + 0.85);
    render(); busy = false; setBusy(false);
    const amt = amount(), left = peak ? amt / peak : 0;
    const specks = A.bugs > 0.05 || A.drops > 0.05;
    if (!peak) { msg.textContent = 'Nothing to rinse yet. Get the car dirty first.'; rinses = 0; render(); return; }
    if (left < 0.03 && !specks) { msg.textContent = `${names[level]}: clean after ${rinses === 1 ? 'one rinse' : rinses + ' rinses'}. Grime just let go.`; wipeBtn.hidden = true; }
    else if (level) { msg.textContent = `${names[level]}: the grime rinsed off. Just a few bug and bird spots left, and one quick wipe takes care of them.`; wipeBtn.textContent = 'Quick wipe'; wipeBtn.hidden = false; }
    else { msg.textContent = `Bare paint: ${Math.round(left * 100)}% of the dirt is still stuck, plus water spots as it dries. It needs a hand scrub.`; wipeBtn.textContent = 'Hand scrub'; wipeBtn.hidden = false; }
  }
  function setBusy(b) { [mudBtn, rinseBtn].forEach(x => x.disabled = b); }
  function rinse() {
    if (busy) return; busy = true; setBusy(true);
    ['road', 'bugs', 'drops', 'smear'].forEach(k => { from[k] = A[k]; to[k] = A[k] * KEEP[k][level]; });
    sweep = -40; kick();
  }
  function clean() { ['road', 'bugs', 'drops', 'smear', 'spots'].forEach(k => A[k] = 0); smctx.clearRect(0, 0, WW, HH); slctx.clearRect(0, 0, WW, HH); smearAmt = 0; }
  function wipe() { const was = wipeBtn.textContent; clean(); peak = 0; wipeBtn.hidden = true; render();
    msg.textContent = was === 'Quick wipe' ? `${names[level]}: one quick wipe and it's spotless.` : 'Bare paint: clean again, after a full hand wash and scrub.'; }
  function reset() { clean(); peak = 0; rinses = 0; beads = []; wipeBtn.hidden = true; render(); }
  function mud() { A.road = 1; A.bugs = 1; A.drops = 1; render(); msg.textContent = 'Road spray, bugs, and the birds found it too. Now rinse it.'; }
  function setLevel(l) { level = l; btns.forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.level) === l))); reset(); drawGloss(); msg.textContent = `${names[l]} selected. Get it dirty, then rinse.`; }
  btns.forEach(b => b.addEventListener('click', () => setLevel(Number(b.dataset.level))));
  mudBtn.addEventListener('click', mud); rinseBtn.addEventListener('click', rinse); wipeBtn.addEventListener('click', wipe);
  document.getElementById('dt-reset').addEventListener('click', () => { reset(); msg.textContent = 'Car reset. Get it dirty, then rinse.'; });
  // finger / mouse: paint the mud smear with a soft brush
  let down = false, last = null;
  const pos = e => { const b = fx.getBoundingClientRect(); return [(e.clientX - b.left) / b.width * WW, (e.clientY - b.top) / b.height * HH]; };
  // each brush dab = a clump of irregular blobs plus fine flecks, so it reads as thrown mud
  const brush = (x, y) => {
    const k = Math.min(2, Math.max(1, 760 / (stage.clientWidth || 760)));
    smctx.fillStyle = '#000';
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * 6.3, d = Math.random() * 14 * k, r = (4 + Math.random() * 9) * k;
      const cx = x + Math.cos(a) * d, cy = y + Math.sin(a) * d * 0.7;
      smctx.globalAlpha = 0.55 + Math.random() * 0.4; smctx.beginPath();
      for (let t = 0; t < 9; t++) { const ang = t / 9 * 6.283, rr = r * (0.6 + Math.random() * 0.55); const px = cx + Math.cos(ang) * rr * 1.3, py = cy + Math.sin(ang) * rr * 0.85; t ? smctx.lineTo(px, py) : smctx.moveTo(px, py); }
      smctx.closePath(); smctx.fill();
    }
    for (let i = 0; i < 14; i++) {
      const a = (Math.random() - 0.5) * 2.4, d = (14 + Math.random() * 34) * k, r = (0.8 + Math.random() * 2.4) * k;
      smctx.globalAlpha = 0.5 + Math.random() * 0.5; smctx.beginPath(); smctx.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, r * 1.6, r, a * 0.4, 0, 7); smctx.fill();
    }
    smctx.globalAlpha = 1;
  };
  fx.addEventListener('pointerdown', e => { if (busy) return; down = true; last = pos(e); fx.setPointerCapture(e.pointerId); A.smear = 1; brush(...last); rebuildSmear(); render(); });
  fx.addEventListener('pointermove', e => {
    if (!down) return; const p = pos(e), dx = p[0] - last[0], dy = p[1] - last[1], d = Math.hypot(dx, dy);
    for (let s = 18; s <= d; s += 18) brush(last[0] + dx * s / d, last[1] + dy * s / d);
    if (d >= 18) last = p; rebuildSmear(); render();
  });
  ['pointerup', 'pointercancel'].forEach(t => fx.addEventListener(t, () => { if (!down) return; down = false; measureSmear(); render(); if (A.smear) msg.textContent = 'Muddy. Now rinse it.'; }));
  const wait = setInterval(() => { if (ready()) { clearInterval(wait); drawGloss(); render(); } }, 200);
})();

// Job tracker (/track/): looks up a tracking code in jobs.json and shows progress + updates
(() => {
  const form = document.getElementById('tr-form'); if (!form) return;
  const input = document.getElementById('tr-code'), result = document.getElementById('tr-result'), missing = document.getElementById('tr-missing');
  const STAGES = ['Checked in', 'Prep & inspection', 'Install', 'Curing & finishing', 'Final inspection', 'Ready for pick-up'];
  const dataUrl = new URL('../../jobs.json', ASSET_BASE).href;
  // Live jobs come from the shop's Google Sheet (via its Apps Script web app, set in data-api on the form);
  // the DEMO job and any fallback jobs come from jobs.json.
  let jobs = null;
  const loadLocal = () => jobs ? Promise.resolve(jobs) : fetch(dataUrl + '?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json()).then(x => (jobs = x));
  const load = code => {
    const api = form.dataset.api || '';
    if (!api || code === 'DEMO') return loadLocal();
    return fetch(api + '?job=' + encodeURIComponent(code), { cache: 'no-store' }).then(r => r.json())
      .then(x => x && !x.error ? { [code]: x } : loadLocal().catch(() => ({})));
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtDate = d => { const t = new Date(d + 'T12:00:00'); return isNaN(t) ? d : t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
  const img = p => p ? new URL('../../' + p.replace(/^\/+/, ''), ASSET_BASE).href : '';
  function show(code) {
    code = code.trim().toUpperCase(); if (!code) return;
    result.classList.add('is-loading');
    load(code).then(all => {
      result.classList.remove('is-loading');
      const key = Object.keys(all).find(k => k !== '_how_to' && k.toUpperCase() === code);
      const job = key && all[key];
      result.hidden = !job; missing.hidden = !!job;
      if (!job) { missing.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      const st = Math.max(0, Math.min(5, Number(job.stage) || 0));
      document.getElementById('tr-code-out').textContent = (key === 'DEMO' ? 'Sample job · ' : 'Tracking code · ') + key;
      document.getElementById('tr-vehicle').textContent = job.vehicle || 'Your vehicle';
      document.getElementById('tr-services').innerHTML = (job.services || []).map(s => `<li>${esc(s)}</li>`).join('');
      document.getElementById('tr-ready').textContent = st === 5 ? 'Ready now' : (job.ready ? fmtDate(job.ready) : 'We’ll confirm soon');
      document.getElementById('tr-status').textContent = STAGES[st];
      document.querySelectorAll('#tr-steps li').forEach((li, i) => { li.className = i < st ? 'done' : i === st ? 'now' : ''; li.removeAttribute('aria-current'); if (i === st) li.setAttribute('aria-current', 'step'); });
      document.getElementById('tr-steps').style.setProperty('--f', st / 5);
      document.getElementById('tr-feed').innerHTML = (job.updates || []).map(u => `
        <li>
          <div class="tr-dot" aria-hidden="true"></div>
          <div class="tr-entry">
            <p class="tr-meta"><span>${esc(STAGES[Math.max(0, Math.min(5, Number(u.stage) || 0))])}</span>${esc(u.date || '')}</p>
            <p>${esc(u.note || '')}</p>
            ${u.photo ? `<img src="${esc(img(u.photo))}" alt="Photo from the shop: ${esc(u.note || 'progress update')}" loading="lazy">` : ''}
          </div>
        </li>`).join('') || '<li class="tr-empty">No updates yet. Check back soon.</li>';
      history.replaceState(null, '', '?job=' + encodeURIComponent(key));
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(() => { result.classList.remove('is-loading'); result.hidden = true; missing.hidden = false; });
  }
  form.addEventListener('submit', e => { e.preventDefault(); show(input.value); });
  document.getElementById('tr-demo').addEventListener('click', () => { input.value = 'DEMO'; show('DEMO'); });
  const q = new URLSearchParams(location.search).get('job'); if (q) { input.value = q; show(q); }
})();

// Detail Dash mini game (detailing page): foam, scrub, rinse, dry, wax, tires against the clock
(() => {
  const stage = document.getElementById('dg-stage'); if (!stage) return;
  const W = 1090, H = 395, R = 2, WW = W * R, HH = H * R;
  const $ = id => document.getElementById(id);
  const layers = {}; ['shine', 'tires', 'dirt', 'foam', 'water', 'fx'].forEach(k => { const c = $('dg-' + k); c.width = WW; c.height = HH; layers[k] = c.getContext('2d'); });
  const maskUrl = asset('grime-mask.png');
  stage.querySelectorAll('.dg-paint, .dg-shine, .dg-dirt').forEach(c => { c.style.webkitMaskImage = c.style.maskImage = `url(${maskUrl})`; });
  const TOOLS = [
    { name: 'Foam cannon', tip: 'Drag over the paint to cover the whole car in foam.', r: 34 },
    { name: 'Wash mitt', tip: 'Scrub the foam and grime off every panel.', r: 30 },
    { name: 'Rinse', tip: 'Hose off all the suds.', r: 40 },
    { name: 'Drying towel', tip: 'Dry every drop so it doesn’t spot.', r: 36 },
    { name: 'Wax & buff', tip: 'Buff wax into the paint until it shines.', r: 32 },
    { name: 'Tire shine', tip: 'Tap both tires to dress them.', r: 0 }
  ];
  const WHEELS = [[210, 296], [836, 296]], TIRE_R = 76, RIM_R = 57;
  const NEED = 0.82, CELL = 10, GW = Math.ceil(W / CELL), GH = Math.ceil(H / CELL);
  let paintCells = null, paintCount = 0, touched = new Uint8Array(GW * GH), step = -1, t0 = 0, tick = 0, done = [false, false], playing = false, down = false, last = null;
  const imgs = {}; ['road', 'bugs', 'drops'].forEach(k => { imgs[k] = new Image(); });
  const foamTex = new Image();
  whenNear(stage, () => { Object.keys(imgs).forEach(k => { imgs[k].src = asset(`grime-${k}.webp`); }); foamTex.src = asset('foam-tex.webp'); }, '600px');
  const fm = document.createElement('canvas'); fm.width = WW; fm.height = HH; const fmc = fm.getContext('2d');   // where foam sits, and how thick
  let parts = [], drips = [], nozzle = null, loop = 0;
  function drawFoam() {
    const f = layers.foam; f.clearRect(0, 0, WW, HH); if (!foamTex.naturalWidth) return;
    f.globalCompositeOperation = 'source-over'; f.drawImage(foamTex, 0, 0);
    f.globalCompositeOperation = 'destination-in'; f.drawImage(fm, 0, 0); f.globalCompositeOperation = 'source-over';
  }
  const eraseFoam = (X, Y, RR, a) => { fmc.globalCompositeOperation = 'destination-out'; soft(fmc, X, Y, RR, `rgba(0,0,0,${a})`, 'rgba(0,0,0,0)'); fmc.globalCompositeOperation = 'source-over'; };
  let ptr = null, hover = false, bits = [];
  const PORES = Array.from({ length: 34 }, () => [Math.random() - 0.5, Math.random() - 0.5, 0.6 + Math.random()]);
  function wand(f, nx, ny, tx, ty, len, thick, tipCol) {
    const ang = Math.atan2(ty - ny, tx - nx); f.save(); f.translate(nx, ny); f.rotate(ang);
    f.fillStyle = 'rgba(0,0,0,.18)'; f.beginPath(); f.roundRect(-len * R + 3 * R, -thick * R / 2 + 4 * R, len * R - 8 * R, thick * R, 4 * R); f.fill();
    f.fillStyle = '#23272c'; f.beginPath(); f.roundRect(-len * R, -thick * R / 2, len * R - 8 * R, thick * R, 4 * R); f.fill();
    f.fillStyle = 'rgba(255,255,255,.18)'; f.fillRect(-len * R + 4 * R, -thick * R / 2 + 1.5 * R, len * R - 16 * R, 2 * R);
    f.fillStyle = tipCol; f.beginPath(); f.roundRect(-10 * R, -(thick / 2 + 1.5) * R, 12 * R, (thick + 3) * R, 3 * R); f.fill();
    f.restore(); return ang;
  }
  function drawTool(f, x, y, now) {
    const K = k(), X = x * R, Y = y * R, r = TOOLS[step].r * K * R;
    if (step > 0) { f.setLineDash([5 * R, 5 * R]); f.beginPath(); f.arc(X, Y, r, 0, 7); f.strokeStyle = 'rgba(216,30,44,.45)'; f.lineWidth = 1.5 * R; f.stroke(); f.setLineDash([]); }
    if (step === 0) { // foam cannon
      const nx = X - 150 * R * K, ny = Y - 95 * R * K; wand(f, nx, ny, X, Y, 70, 10, '#b08a3e');
      if (down) { const ang = Math.atan2(Y - ny, X - nx); f.save(); f.translate(nx, ny); f.rotate(ang);
        const cone = f.createLinearGradient(0, 0, 60 * R, 0); cone.addColorStop(0, 'rgba(255,255,255,.55)'); cone.addColorStop(1, 'rgba(255,255,255,0)');
        f.fillStyle = cone; f.beginPath(); f.moveTo(2 * R, -4 * R); f.lineTo(70 * R, -26 * R); f.lineTo(70 * R, 26 * R); f.lineTo(2 * R, 4 * R); f.closePath(); f.fill(); f.restore(); }
    } else if (step === 1) { // sponge, scrubbing back and forth while pressed
      const wob = down ? Math.sin(now / 55) : 0;
      f.save(); f.translate(X + wob * 4 * R, Y + Math.cos(now / 55) * (down ? 2 : 0) * R); f.rotate(-0.22 + wob * 0.12);
      const w = 74 * K * R, h = 48 * K * R;
      f.fillStyle = 'rgba(0,0,0,.22)'; f.beginPath(); f.roundRect(-w / 2 + 4 * R, -h / 2 + 6 * R, w, h, 10 * R); f.fill();
      const gr = f.createLinearGradient(0, -h / 2, 0, h / 2); gr.addColorStop(0, '#FFD45E'); gr.addColorStop(1, '#E9A62C');
      f.fillStyle = gr; f.beginPath(); f.roundRect(-w / 2, -h / 2, w, h, 10 * R); f.fill();
      f.fillStyle = '#3E9C5A'; f.beginPath(); f.roundRect(-w / 2, h / 2 - h * 0.26, w, h * 0.26, [0, 0, 10 * R, 10 * R]); f.fill();
      f.fillStyle = 'rgba(176,112,20,.55)'; for (const [px, py, s] of PORES) { if (py * h > h / 2 - h * 0.3) continue; f.beginPath(); f.arc(px * w * 0.9, py * h * 0.8, s * 1.4 * R, 0, 7); f.fill(); }
      f.fillStyle = 'rgba(255,255,255,.85)'; for (let i = 0; i < 5; i++) { f.beginPath(); f.arc(-w / 2 + (i + 0.5) * w / 5, h / 2 - h * 0.28, (3 + (i % 2) * 2) * R, 0, 7); f.fill(); }
      f.restore();
    } else if (step === 2) { // pressure washer wand with a flat fan of water
      const nx = X - 140 * R * K, ny = Y - 110 * R * K, ang = wand(f, nx, ny, X, Y, 90, 7, '#9aa3ac');
      if (down) { f.save(); f.translate(nx, ny); f.rotate(ang); const dist = Math.hypot(X - nx, Y - ny);
        const fan = f.createLinearGradient(0, 0, dist, 0); fan.addColorStop(0, 'rgba(210,235,255,.65)'); fan.addColorStop(1, 'rgba(210,235,255,.12)');
        f.fillStyle = fan; f.beginPath(); f.moveTo(2 * R, -2 * R); f.lineTo(dist, -r * 0.9); f.lineTo(dist, r * 0.9); f.lineTo(2 * R, 2 * R); f.closePath(); f.fill();
        f.strokeStyle = 'rgba(255,255,255,.7)'; f.lineWidth = 1 * R; for (let i = 0; i < 9; i++) { const sp = (Math.random() - 0.5) * r * 1.6; f.beginPath(); f.moveTo(4 * R, 0); f.lineTo(dist, sp); f.stroke(); }
        f.restore(); }
    } else if (step === 3) { // air blower
      const nx = X - 125 * R * K, ny = Y - 85 * R * K, ang = Math.atan2(Y - ny, X - nx);
      f.save(); f.translate(nx, ny); f.rotate(ang);
      f.fillStyle = 'rgba(0,0,0,.2)'; f.beginPath(); f.ellipse(-46 * R, 8 * R, 34 * R, 20 * R, 0, 0, 7); f.fill();
      f.fillStyle = '#2B3137'; f.beginPath(); f.ellipse(-48 * R, 0, 34 * R, 20 * R, 0, 0, 7); f.fill();
      f.fillStyle = '#D7192A'; f.beginPath(); f.roundRect(-70 * R, -4 * R, 30 * R, 8 * R, 3 * R); f.fill();
      f.fillStyle = '#3C444B'; f.beginPath(); f.moveTo(-16 * R, -11 * R); f.lineTo(10 * R, -6 * R); f.lineTo(10 * R, 6 * R); f.lineTo(-16 * R, 11 * R); f.closePath(); f.fill();
      f.fillStyle = '#1D2125'; f.beginPath(); f.roundRect(-58 * R, -30 * R, 20 * R, 14 * R, 4 * R); f.fill();
      if (down) { const dist = Math.hypot(X - nx, Y - ny); f.strokeStyle = 'rgba(235,245,255,.55)'; f.lineWidth = 1.6 * R;
        for (let i = 0; i < 6; i++) { const off = ((now / 6 + i * 23) % 60) * R, sp = (i - 2.5) * 5 * R; f.beginPath(); f.moveTo(12 * R + off, sp * 0.3);
          f.quadraticCurveTo(dist * 0.6 + off * 0.3, sp + Math.sin(now / 80 + i) * 4 * R, dist, sp * 2.2); f.stroke(); } }
      f.restore();
    } else if (step === 4) { // dual-action polisher, seen from above
      const spin = now / (down ? 18 : 140), orb = down ? 3 * R : 0, cx = X + Math.cos(now / 22) * orb, cy = Y + Math.sin(now / 22) * orb, pr = 30 * K * R;
      f.fillStyle = 'rgba(0,0,0,.22)'; f.beginPath(); f.arc(cx + 4 * R, cy + 6 * R, pr * 1.06, 0, 7); f.fill();
      f.save(); f.translate(X, Y); f.rotate(-0.7);
      f.fillStyle = '#2B3137'; f.beginPath(); f.roundRect(pr * 0.3, -11 * R, 78 * R * K, 22 * R, 10 * R); f.fill();
      f.fillStyle = '#D7192A'; f.fillRect(pr * 0.3 + 30 * R * K, -11 * R, 14 * R * K, 22 * R); f.restore();
      f.fillStyle = '#E8692E'; f.beginPath(); f.arc(cx, cy, pr, 0, 7); f.fill();
      f.fillStyle = '#C9521F'; f.beginPath(); f.arc(cx, cy, pr * 0.62, 0, 7); f.fill();
      f.fillStyle = '#23272c'; f.beginPath(); f.arc(cx, cy, pr * 0.42, 0, 7); f.fill();
      f.strokeStyle = 'rgba(255,255,255,.35)'; f.lineWidth = 2 * R; for (let i = 0; i < 3; i++) { const a0 = spin + i * 2.09; f.beginPath(); f.arc(cx, cy, pr * 0.82, a0, a0 + 0.9); f.stroke(); }
      f.fillStyle = '#9aa3ac'; f.beginPath(); f.arc(cx, cy, pr * 0.12, 0, 7); f.fill();
    }
  }
  // foam cannon: a cone of spray from the nozzle, foam piles up where it lands and slowly drips
  function foamLoop() {
    const f = layers.fx; f.clearRect(0, 0, WW, HH); let live = false;
    if (nozzle && down && step === 0) {
      live = true; const [nx, ny, tx, ty, r] = nozzle;
      for (let i = 0; i < 26; i++) { const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * r; parts.push({ x: nx, y: ny, tx: tx + Math.cos(a) * d, ty: ty + Math.sin(a) * d * 0.8, t: 0, life: 7 + Math.random() * 5 }); }
    }
    fmc.fillStyle = '#000';
    for (const p of parts) {
      p.t++; const k1 = p.t / p.life, px = p.x + (p.tx - p.x) * k1, py = p.y + (p.ty - p.y) * k1 + Math.sin(k1 * 3.14) * -6 * R;
      f.beginPath(); f.arc(px, py, (1 + k1 * 2.2) * R, 0, 7); f.fillStyle = `rgba(255,255,255,${0.55 + k1 * 0.35})`; f.fill();
      if (p.t >= p.life) { // splat into the foam layer
        const s = (3 + Math.random() * 7) * R; fmc.globalAlpha = 0.18 + Math.random() * 0.22; fmc.beginPath(); fmc.ellipse(p.tx, p.ty, s * 1.2, s, Math.random() * 3, 0, 7); fmc.fill(); fmc.globalAlpha = 1;
        if (Math.random() < 0.006) drips.push({ x: p.tx, y: p.ty, len: 0, max: (10 + Math.random() * 34) * R, w: (2 + Math.random() * 3) * R });
      }
    }
    parts = parts.filter(p => p.t < p.life); if (parts.length) live = true;
    for (const d of drips) { if (d.len >= d.max) continue; live = true; d.len += 0.7 * R; fmc.globalAlpha = 0.35; fmc.beginPath(); fmc.ellipse(d.x, d.y + d.len, d.w, d.w * 1.5, 0, 0, 7); fmc.fill(); fmc.globalAlpha = 1; }
    drips = drips.filter(d => d.len < d.max);
    for (const p of bits) { p.t++; p.x += p.vx; p.y += p.vy; p.vy += p.g; const al = 1 - p.t / p.life;
      if (p.kind === 'bub') { f.beginPath(); f.arc(p.x, p.y, p.r, 0, 7); f.strokeStyle = `rgba(255,255,255,${al * 0.9})`; f.lineWidth = 1.2 * R; f.stroke(); f.beginPath(); f.arc(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.25, 0, 7); f.fillStyle = `rgba(255,255,255,${al})`; f.fill(); }
      else if (p.kind === 'drop') { f.beginPath(); f.ellipse(p.x, p.y, p.r * 1.6, p.r, Math.atan2(p.vy, p.vx), 0, 7); f.fillStyle = `rgba(200,225,245,${al * 0.9})`; f.fill(); }
      else { f.beginPath(); f.arc(p.x, p.y, p.r * (1 + p.t / p.life), 0, 7); f.fillStyle = `rgba(255,255,255,${al * 0.7})`; f.fill(); } }
    bits = bits.filter(p => p.t < p.life); if (bits.length) live = true;
    if (ptr && playing && hover && step < 5) { drawTool(f, ptr[0], ptr[1], performance.now()); live = true; }
    drawFoam();
    loop = live ? requestAnimationFrame(foamLoop) : 0;
  }
  const kickFoam = () => { if (!loop) loop = requestAnimationFrame(foamLoop); };
  const zi = new Image(); zi.src = asset('ppf-zones.png');
  zi.onload = () => {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(zi, 0, 0);
    const d = x.getImageData(0, 0, W, H).data; paintCells = new Uint8Array(GW * GH);
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      let n = 0; for (let y = gy * CELL; y < Math.min(H, gy * CELL + CELL); y += 2) for (let xx = gx * CELL; xx < Math.min(W, gx * CELL + CELL); xx += 2) if (d[(y * W + xx) * 4] > 20) n++;
      if (n > 6) { paintCells[gy * GW + gx] = 1; paintCount++; }
    }
  };
  const k = () => Math.min(2.2, Math.max(1, 760 / (stage.clientWidth || 760)));
  let best = null; try { best = Number(localStorage.getItem('mla-detail-dash')) || null; } catch (e) {}
  const showBest = () => { $('dg-best').textContent = best ? `Best: ${best.toFixed(1)}s` : 'Best: none yet'; };
  showBest();
  function dirty() {
    Object.values(layers).forEach(c => c.clearRect(0, 0, WW, HH)); fmc.clearRect(0, 0, WW, HH); parts = []; drips = []; nozzle = null;
    const d = layers.dirt; ['road', 'bugs', 'drops'].forEach(n => { if (imgs[n].naturalWidth) d.drawImage(imgs[n], 0, 0); });
    d.globalCompositeOperation = 'source-atop'; d.fillStyle = 'rgba(120,100,75,.10)'; d.fillRect(0, 0, WW, HH); d.globalCompositeOperation = 'source-over';
    // dull, dusty tires
    const t = layers.tires; WHEELS.forEach(([x, y]) => { t.beginPath(); t.arc(x * R, y * R, TIRE_R * R, 0, 7); t.arc(x * R, y * R, RIM_R * R, 0, 7, true); t.fillStyle = 'rgba(150,140,125,.28)'; t.fill('evenodd'); });
  }
  function setStep(s) {
    step = s; touched = new Uint8Array(GW * GH);
    document.querySelectorAll('#dg-steps li').forEach((li, i) => { li.className = i < s ? 'done' : i === s ? 'now' : ''; });
    const tool = TOOLS[s]; $('dg-tool-name').textContent = tool.name; $('dg-tool-tip').textContent = tool.tip; bar(0);
    stage.dataset.tool = s;
  }
  function bar(p) { $('dg-bar').style.width = Math.round(Math.min(1, p) * 100) + '%'; }
  function coverage() { let n = 0; for (let i = 0; i < touched.length; i++) if (touched[i] && paintCells[i]) n++; return paintCount ? n / paintCount : 0; }
  function mark(x, y, r) {
    const g0x = Math.max(0, Math.floor((x - r) / CELL)), g1x = Math.min(GW - 1, Math.floor((x + r) / CELL));
    const g0y = Math.max(0, Math.floor((y - r) / CELL)), g1y = Math.min(GH - 1, Math.floor((y + r) / CELL));
    for (let gy = g0y; gy <= g1y; gy++) for (let gx = g0x; gx <= g1x; gx++) { const cx = gx * CELL + CELL / 2 - x, cy = gy * CELL + CELL / 2 - y; if (cx * cx + cy * cy <= r * r) touched[gy * GW + gx] = 1; }
  }
  function soft(ctx, x, y, r, inner, outer) { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, inner); g.addColorStop(1, outer); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
  function stamp(x, y) {
    const r = TOOLS[step].r * k(), X = x * R, Y = y * R, RR = r * R;
    if (step === 0) { // foam cannon: aim from up and to the left, spray lands around the pointer
      nozzle = [X - 150 * R * k(), Y - 95 * R * k(), X, Y, RR]; kickFoam();    } else if (step === 1) { // scrub: grime lifts into the suds
      const d = layers.dirt; d.globalCompositeOperation = 'destination-out'; soft(d, X, Y, RR, 'rgba(0,0,0,.9)', 'rgba(0,0,0,0)'); d.globalCompositeOperation = 'source-over';
      eraseFoam(X, Y, RR * 0.9, 0.3); drawFoam();
    } else if (step === 2) { // rinse: suds and leftover grime wash away, droplets stay
      eraseFoam(X, Y, RR, 1); drawFoam(); const c = layers.dirt; c.globalCompositeOperation = 'destination-out'; soft(c, X, Y, RR, 'rgba(0,0,0,1)', 'rgba(0,0,0,0)'); c.globalCompositeOperation = 'source-over';
      const w = layers.water; for (let i = 0; i < 6; i++) { const a = Math.random() * 6.3, d = Math.random() * RR, s = (1.2 + Math.random() * 2.6) * R; const px = X + Math.cos(a) * d, py = Y + Math.sin(a) * d;
        w.beginPath(); w.arc(px, py, s, 0, 7); w.fillStyle = 'rgba(170,200,225,.55)'; w.fill(); w.beginPath(); w.arc(px - s * 0.35, py - s * 0.35, s * 0.35, 0, 7); w.fillStyle = 'rgba(255,255,255,.95)'; w.fill(); }
    } else if (step === 3) { // dry
      const w = layers.water; w.globalCompositeOperation = 'destination-out'; soft(w, X, Y, RR, 'rgba(0,0,0,1)', 'rgba(0,0,0,0)'); w.globalCompositeOperation = 'source-over';
    } else if (step === 4) { // wax & buff: build up a glossy sheen
      soft(layers.shine, X, Y, RR, 'rgba(255,255,255,.16)', 'rgba(255,255,255,0)');
    }
    if (step === 1 && Math.random() < 0.6) bits.push({ kind: 'bub', x: X + (Math.random() - 0.5) * RR * 1.4, y: Y + (Math.random() - 0.5) * RR, vx: (Math.random() - 0.5) * 0.6 * R, vy: -(0.3 + Math.random() * 0.6) * R, g: 0, r: (2 + Math.random() * 4) * R, t: 0, life: 40 });
    if (step === 3) { const dx = X - (X - 125 * R * k()), dy = Y - (Y - 85 * R * k()), dl = Math.hypot(dx, dy); for (let i = 0; i < 4; i++) bits.push({ kind: 'drop', x: X + (Math.random() - 0.5) * RR, y: Y + (Math.random() - 0.5) * RR, vx: (dx / dl * 3 + (Math.random() - 0.5) * 2) * R, vy: (dy / dl * 3 + (Math.random() - 0.5) * 2) * R, g: 0.08 * R, r: (1.2 + Math.random() * 1.6) * R, t: 0, life: 22 }); }
    if (step === 4 && Math.random() < 0.3) bits.push({ kind: 'glint', x: X + (Math.random() - 0.5) * RR, y: Y + (Math.random() - 0.5) * RR, vx: 0, vy: 0, g: 0, r: 2 * R, t: 0, life: 18 });
    mark(x, y, r * 0.8);
    const c = coverage(); bar(c / NEED);
    if (c >= NEED) finishStep();
  }
  function finishStep() {
    if (step === 0) { fmc.globalAlpha = 0.75; fmc.fillStyle = '#000'; fmc.fillRect(0, 0, WW, HH); fmc.globalAlpha = 1; parts = []; nozzle = null; drawFoam(); }
    if (step === 1) { const d = layers.dirt; d.globalCompositeOperation = 'destination-out'; d.fillStyle = 'rgba(0,0,0,.85)'; d.fillRect(0, 0, WW, HH); d.globalCompositeOperation = 'source-over'; }
    if (step === 2) { fmc.clearRect(0, 0, WW, HH); drips = []; drawFoam(); layers.dirt.clearRect(0, 0, WW, HH); }
    if (step === 3) layers.water.clearRect(0, 0, WW, HH);
    if (step === 4) { const s = layers.shine; s.clearRect(0, 0, WW, HH); const g = s.createLinearGradient(0, 0, WW * 0.7, HH);
      g.addColorStop(0.25, 'rgba(255,255,255,0)'); g.addColorStop(0.42, 'rgba(255,255,255,.55)'); g.addColorStop(0.5, 'rgba(210,235,255,.35)'); g.addColorStop(0.62, 'rgba(255,255,255,0)'); s.fillStyle = g; s.fillRect(0, 0, WW, HH); }
    flash(); setStep(step + 1);
  }
  function flash() { stage.classList.remove('dg-flash'); void stage.offsetWidth; stage.classList.add('dg-flash'); }
  function tireTap(x, y) {
    WHEELS.forEach(([wx, wy], i) => {
      const d = Math.hypot(x - wx, y - wy); if (done[i] || d > TIRE_R + 12) return;
      done[i] = true; const t = layers.tires, X = wx * R, Y = wy * R;
      t.globalCompositeOperation = 'destination-out'; t.beginPath(); t.arc(X, Y, (TIRE_R + 2) * R, 0, 7); t.fill(); t.globalCompositeOperation = 'source-over';
      t.beginPath(); t.arc(X, Y, TIRE_R * R, 0, 7); t.arc(X, Y, RIM_R * R, 0, 7, true); t.fillStyle = 'rgba(8,8,10,.45)'; t.fill('evenodd');
      t.beginPath(); t.arc(X, Y, (TIRE_R - 6) * R, Math.PI * 1.1, Math.PI * 1.55); t.strokeStyle = 'rgba(255,255,255,.55)'; t.lineWidth = 3 * R; t.lineCap = 'round'; t.stroke();
      bar((done[0] + done[1]) / 2);
    });
    if (done[0] && done[1]) win();
  }
  function cursor(x, y) { ptr = [x, y]; kickFoam(); }
  const pos = e => { const b = stage.getBoundingClientRect(); return [(e.clientX - b.left) / b.width * W, (e.clientY - b.top) / b.height * H]; };
  const fx = $('dg-fx');
  fx.addEventListener('pointerdown', e => {
    if (!playing || !paintCells) return; const p = pos(e);
    if (step === 5) { tireTap(...p); return; }
    hover = true; down = true; last = p; fx.setPointerCapture(e.pointerId); cursor(...p); stamp(...p);
  });
  fx.addEventListener('pointermove', e => {
    const p = pos(e); cursor(...p); if (!down || !playing || step > 4) return;
    const dx = p[0] - last[0], dy = p[1] - last[1], d = Math.hypot(dx, dy), stepLen = Math.max(6, TOOLS[step].r * k() * 0.35);
    for (let s = stepLen; s <= d; s += stepLen) { stamp(last[0] + dx * s / d, last[1] + dy * s / d); if (!playing || step > 4) break; }
    if (d >= stepLen) last = p;
  });
  ['pointerup', 'pointercancel'].forEach(t => fx.addEventListener(t, e => { down = false; nozzle = null; if (e.pointerType !== 'mouse') hover = false; kickFoam(); }));
  fx.addEventListener('pointerenter', e => { hover = true; cursor(...pos(e)); });
  fx.addEventListener('pointerleave', () => { if (!down) { hover = false; kickFoam(); } });
  function start() {
    dirty(); done = [false, false]; setStep(0); playing = true; t0 = performance.now();
    $('dg-start').hidden = true; $('dg-end').hidden = true; stage.classList.add('is-playing');
    clearInterval(tick); tick = setInterval(() => { $('dg-time').textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's'; }, 100);
  }
  function win() {
    playing = false; clearInterval(tick); stage.classList.remove('is-playing'); bits = []; kickFoam();
    document.querySelectorAll('#dg-steps li').forEach(li => { li.className = 'done'; }); bar(1);
    const s = (performance.now() - t0) / 1000; $('dg-time').textContent = s.toFixed(1) + 's';
    const stars = s < 60 ? 3 : s < 100 ? 2 : 1, isBest = !best || s < best;
    if (isBest) { best = s; try { localStorage.setItem('mla-detail-dash', String(s)); } catch (e) {} showBest(); }
    $('dg-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    $('dg-end-title').textContent = stars === 3 ? 'Pro detailer!' : stars === 2 ? 'Spotless!' : 'Clean enough!';
    $('dg-end-msg').textContent = `${s.toFixed(1)} seconds${isBest ? ', a new personal best' : ''}. Our team takes a little longer, because we do it by hand, properly.`;
    setTimeout(() => { $('dg-end').hidden = false; }, 700);
  }
  $('dg-go').addEventListener('click', start); $('dg-again').addEventListener('click', start);
  const ready = setInterval(() => { if (Object.values(imgs).every(i => i.complete && i.naturalWidth)) { clearInterval(ready); dirty(); } }, 150);
})();

// ---------------------------------------------------------------------------------------------
// Quick-answers chat helper (every page). No AI: typed questions are matched to the answers below
// by keywords. To change a price or answer, edit HELP_ANSWERS. `need` = groups of words; a question
// matches when it contains at least one word from every group.
(() => {
  const ROOT = new URL('../../', ASSET_BASE).href;
  const L = p => ROOT + p;
  const PHONE = '<a href="tel:+14845741628">(484) 574-1628</a>';
  const HELP_ANSWERS = [
    { id: 'tint-front', need: [['tint', 'film', 'window'], ['front', 'two', '2 ', 'driver', 'passenger']], a: `Tinting the <b>2 front windows is $150</b> (on sale), with premium ceramic film: 99% UV blocking and up to 95% heat blocking. Heads-up: in Pennsylvania the front side windows have to let more than 70% of light through, and we'll help you stay legal.`, links: [['See tint packages', 'window-tint/#pricing'], ['Book now', 'https://mainlineautoworks.square.site']] },
    { id: 'tint-full', need: [['tint', 'film', 'window'], ['full', 'whole', 'all', 'entire', 'every']], a: `A <b>full vehicle tint is $399 to $450</b> (on sale) depending on sedan or SUV. That covers all side windows and the rear window in premium ceramic film.`, links: [['See tint packages', 'window-tint/#pricing']] },
    { id: 'tint-windshield', need: [['windshield', 'sun strip', 'brow', 'visor strip']], a: `<b>Full windshield: $250</b>, a clear or lightly shaded ceramic film for heat and glare. <b>Windshield sun strip: $65.</b>`, links: [['See tint packages', 'window-tint/#pricing']] },
    { id: 'tint-removal', need: [['tint', 'film'], ['remove', 'removal', 'strip', 'old', 'purple', 'bubbl']], a: `Tint removal is priced by the car, so it varies. Send us your year, make and model for a quick quote, or call ${PHONE}.`, links: [['Get a quote', 'window-tint/#estimate']] },
    { id: 'tint-law', need: [['legal', 'law', 'illegal', 'allowed', 'ticket', 'pennsylvania', ' pa ', 'how dark', 'darkest']], a: `In Pennsylvania, cars (sedans and coupes) need more than 70% light through on all side and rear windows. On SUVs, vans and trucks, the front side windows need more than 70%, but the rear windows can be any darkness. On every vehicle, only the top strip of the windshield can be tinted. We'll check your car and recommend a legal shade.`, links: [['Pennsylvania tint law', 'window-tint/#pa-law']] },
    { id: 'tint', need: [['tint', 'window film', 'limo', 'vlt']], a: `Our tint prices:<br>• 2 front windows: <b>$150</b><br>• Full vehicle: <b>$399–$450</b><br>• Full windshield: <b>$250</b><br>• Windshield sun strip: <b>$65</b><br>• Tint removal: price varies<br>All in premium ceramic film.`, links: [['Tint page', 'window-tint/'], ['Preview shades', 'window-tint/#tint']] },
    { id: 'detail-time', need: [['detail', 'wash', 'clean'], ['how long', 'time', 'hours', 'take']], a: `An interior or exterior detail takes about <b>2 to 4 hours</b>. A full detail takes about <b>4 to 8 hours</b>, longer for heavy soiling, pet hair or stains.` },
    { id: 'detail', need: [['detail', 'wash', 'interior', 'exterior', 'clean', 'vacuum', 'shampoo', 'super car']], a: `Detailing starts at:<br>• Quick Detail: <b>$85–$135</b><br>• Exterior: <b>$75–$165</b><br>• Interior: <b>$85–$195</b><br>• Full Vehicle: <b>$205–$295</b><br>• Super Car Premium: <b>$320–$595</b><br>Prices depend on vehicle size. Pick your vehicle on the Detailing page to see your exact price.`, links: [['Build your detail', 'auto-detailing/#packages'], ['Pick a time', 'auto-detailing/#book']] },
    { id: 'moto', need: [['motorcycle', 'bike', 'harley', 'motorbike']], a: `<b>Motorcycle Detail: $160</b> (on sale, was $175), or <b>$205 with drive chain care</b> (was $225).`, links: [['Book a motorcycle detail', 'auto-detailing/#packages']] },
    { id: 'ceramic', need: [['ceramic', 'coating', 'sealant', 'hydrophobic']], a: `Our ceramic packages start at:<br>• <b>Level I Sealant (6 months): $195</b>, same day<br>• <b>Level II 5-Year Coating: $995</b>, our most popular<br>• <b>Level III 10-Year Coating: $1,495</b><br>Levels II and III include a complimentary express interior detail. Your exact price depends on your vehicle and its paint condition, and we confirm it after a free evaluation.`, links: [['Ceramic packages', 'ppf-ceramic-coating/#ceramic'], ['Free estimate', '#estimate']] },

    { id: 'ppf', need: [['ppf', 'paint protection', 'clear bra', 'film', 'rock chip', 'chips']], a: `Paint protection film packages:<br>• <b>Partial Front</b><br>• <b>Full Front</b> (most popular)<br>• <b>Track Performance</b><br>• <b>Full Body</b><br>The price depends on your vehicle and coverage, so ask for a free estimate. You can also try the rock chip test to see what each package covers.`, links: [['PPF packages', 'ppf-ceramic-coating/#ppf'], ['Rock chip test', 'ppf-ceramic-coating/#rock-chip-test']] },
    { id: 'wrap-paint', need: [['wrap'], ['damage', 'hurt', 'ruin', 'paint safe', 'remove', 'come off', 'lease']], a: `Not on healthy factory paint. Quality wrap film is designed to come off cleanly, and it protects the paint while it's on. Leased cars can usually be wrapped and unwrapped before turn-in. We inspect the paint first and tell you about anything we see.`, links: [['Wrap FAQ', 'vinyl-wraps/#faq-h']] },
    { id: 'wrap', need: [['wrap', 'vinyl', 'color change', 'chrome delete', 'stripe', 'satin', 'matte']], a: `We do full color changes, partial wraps (roof, hood, mirrors), chrome delete and stripes, in gloss, satin, matte, metallic, color-shift and carbon fiber. Pricing depends on the car and the film, and estimates are free. Try colors on a real car with our wrap preview.`, links: [['Wraps page', 'vinyl-wraps/'], ['Try a color', 'vinyl-wraps/#visualizer']] },
    { id: 'caliper', need: [['caliper', 'brake']], a: `Caliper painting <b>starts at $750</b>. The final price can vary with custom color choices and decal additions. Every caliper gets a high-heat finish built for brake temperatures, and the estimate is free. Try a color on a real wheel first.`, links: [['Calipers page', 'caliper-painting/'], ['Try a color', 'caliper-painting/#calipers']] },
    { id: 'rental', need: [['rental', 'rent', 'loaner', 'courtesy', 'car while']], a: `Rental cars are <b>coming in spring 2027</b>. You'll be able to rent a car right at our shop while yours is with us. Until then, we offer pick-up and drop-off.` },
    { id: 'pickup', need: [['pick up', 'pickup', 'pick-up', 'drop off', 'dropoff', 'tow', 'come to me', 'mobile']], a: `Yes, we can <b>pick up and drop off</b> your car at your home or office. All work is done in our West Chester shop. Call ${PHONE} to set it up.` },
    { id: 'pay', need: [['klarna', 'afterpay', 'finance', 'financing', 'payment plan', 'pay over time', 'monthly']], a: `Yes. Larger jobs can be split into smaller payments with <b>Klarna or Afterpay</b>. Ask about it when you get your estimate.` },
    { id: 'status', need: [['status', 'track', 'ready yet', 'is my car', 'my car done', 'progress']], a: `Check your car on our Job Status page with the tracking code we texted you at drop-off.`, links: [['Job Status', 'track/']] },
    { id: 'gift', need: [['gift']], a: `Yes, we sell e-gift cards from $25.`, links: [['Buy a gift card', 'https://squareup.com/gift/MLZG3Z7PYS6BK/order']] },
    { id: 'location', need: [['where', 'address', 'location', 'directions', 'located', 'find you']], a: `We're at <b>1444 Phoenixville Pike, West Chester, PA 19380</b>, minutes from West Chester Borough and right off Route 202.`, links: [['Get directions', 'https://www.google.com/maps/dir/?api=1&destination=1444+Phoenixville+Pike+West+Chester+PA+19380']] },
    { id: 'hours', need: [['hour', 'open', 'close', 'saturday', 'sunday', 'weekend']], a: `Give us a call at ${PHONE} to check today's hours. You can also book a detail online any time.`, links: [['Book online', 'auto-detailing/#book']] },
    { id: 'book', need: [['book', 'appointment', 'schedule', 'estimate', 'quote', 'price', 'cost', 'how much']], a: `For detailing, you can pick a time online. For wraps, calipers, PPF, ceramic and tint, estimates are free: call ${PHONE}, or send us your year, make and model.`, links: [['Book a detail', 'auto-detailing/#book'], ['Free estimate', '#estimate']] },
    { id: 'contact', need: [['call', 'phone', 'text', 'email', 'contact', 'talk', 'human', 'person']], a: `Call or text us at ${PHONE}, or email <a href="mailto:info@mainlineautoworks.com">info@mainlineautoworks.com</a>.` }
  ];
  const CHIPS = [['Tint prices', 'tint'], ['Detailing prices', 'detail'], ['Caliper prices', 'caliper'], ['Ceramic prices', 'ceramic'], ['PPF', 'ppf'], ['Book or get an estimate', 'book'], ['Rental cars', 'rental'], ['Location', 'location']];
  const byId = id => HELP_ANSWERS.find(x => x.id === id);
  function match(text) {
    const q = ' ' + text.toLowerCase().replace(/[^a-z0-9$ ]/g, ' ').replace(/\s+/g, ' ') + ' ';
    let best = null, bestScore = 0;
    HELP_ANSWERS.forEach((e, i) => {
      if (!e.need.every(g => g.some(w => q.includes(w)))) return;
      const score = e.need.length * 10 - i * 0.01;     // more specific answers win; earlier answers break ties
      if (score > bestScore) { best = e; bestScore = score; }
    });
    return best;
  }
  const href = h => /^https?:|^tel:|^mailto:/.test(h) ? h : h.startsWith('#') ? (document.getElementById(h.slice(1)) ? h : L('') + h) : L(h);
  const ui = document.createElement('div'); ui.className = 'qa';
  ui.innerHTML = `
    <button type="button" class="qa-launch" aria-expanded="false" aria-controls="qa-panel">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 9.5h8M8 12.5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <span>Questions?</span>
    </button>
    <section class="qa-panel" id="qa-panel" role="dialog" aria-label="Quick answers" hidden>
      <header class="qa-head"><div><strong>Main Line Auto Works</strong><span>Quick answers</span></div>
        <button type="button" class="qa-close" aria-label="Close">&times;</button></header>
      <div class="qa-log" aria-live="polite"></div>
      <form class="qa-form" autocomplete="off"><label class="sr-only" for="qa-in">Type a question</label>
        <input id="qa-in" type="text" placeholder="Type a question…" maxlength="140">
        <button type="submit" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2-6z" fill="currentColor"/></svg></button></form>
    </section>`;
  document.body.appendChild(ui);
  const launch = ui.querySelector('.qa-launch'), panel = ui.querySelector('.qa-panel'), log = ui.querySelector('.qa-log');
  const form = ui.querySelector('.qa-form'), input = ui.querySelector('#qa-in');
  function bubble(html, who, links) {
    const b = document.createElement('div'); b.className = 'qa-msg qa-' + who;
    if (who === 'me') b.textContent = html; else b.innerHTML = html;
    if (links && links.length) { const l = document.createElement('div'); l.className = 'qa-links'; links.forEach(([t, h]) => { const a = document.createElement('a'); a.href = href(h); a.textContent = t; if (/^https?:/.test(h)) { a.target = '_blank'; a.rel = 'noopener'; } l.appendChild(a); }); b.appendChild(l); }
    log.appendChild(b); log.scrollTop = log.scrollHeight;
  }
  function chips() {
    const c = document.createElement('div'); c.className = 'qa-chips';
    CHIPS.forEach(([t, id]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.addEventListener('click', () => { log.querySelectorAll('.qa-chips').forEach(x => x.remove()); answer(t, byId(id)); }); c.appendChild(b); });
    log.appendChild(c); log.scrollTop = log.scrollHeight;
  }
  function answer(q, e) {
    bubble(q, 'me');
    setTimeout(() => {
      if (e) bubble(e.a, 'bot', e.links);
      else bubble(`I don't have a quick answer for that one. Our team can help: call or text ${PHONE}.`, 'bot', [['Free estimate', '#estimate']]);
      chips();
    }, 350);
  }
  let started = false;
  function open(on) {
    panel.hidden = !on; launch.setAttribute('aria-expanded', String(on)); ui.classList.toggle('is-open', on);
    if (on && !started) { started = true; bubble('Hi! Ask about prices, packages, booking or anything else. Tap a topic or type a question.', 'bot'); chips(); }
    if (on) setTimeout(() => input.focus(), 50); else launch.focus();
  }
  launch.addEventListener('click', () => open(panel.hidden));
  ui.querySelector('.qa-close').addEventListener('click', () => open(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) open(false); });
  form.addEventListener('submit', e => { e.preventDefault(); const q = input.value.trim(); if (!q) return; input.value = ''; log.querySelectorAll('.qa-chips').forEach(c => c.remove()); answer(q, match(q)); });
  log.addEventListener('click', e => { if (e.target.closest('.qa-links a') && window.matchMedia('(max-width: 600px)').matches) open(false); });
})();

// Detailing: link the chosen package straight to its Square booking page
(() => {
  const a = document.getElementById('dp-direct'); if (!a) return;
  const BASE = 'https://book.squareup.com/appointments/nebfqje99efjsg/location/L55RAA17AA9Y0/services/';
  const IDS = { quick: '7ZTIGMXDQ4HL6HVRJS6JO6DX', exterior: 'BSPHHWFPNNUTGAX5LX7GCDA5', interior: 'IGODDNWH3K5ATIKPHMQZYW3N',
    full: 'IASMDZ6XEM3SARRHGXZR75L4', supercar: '3DCT6QACKJQJA2OJTKCCOPBN', moto: 'O5BF7TKXDWUPEFAOJORQ262T', 'moto-chain': 'O5BF7TKXDWUPEFAOJORQ262T' };
  const radios = Array.from(document.querySelectorAll('input[name="dp-package"]'));
  const hint = document.getElementById('dp-book-hint');
  const sync = () => {
    const r = radios.find(x => x.checked);
    const href = BASE + (r && IDS[r.value] ? IDS[r.value] : '');
    a.href = href;
    const oneStep = document.getElementById('bk') && !document.getElementById('bk').hidden;
    document.querySelectorAll('a[data-square]').forEach(b => { if (!oneStep) b.href = href; });
    if (hint && !oneStep) {
      const extras = Array.from(document.querySelectorAll('.dp-addon input:checked')).map(b => b.dataset.name.toLowerCase());
      hint.textContent = extras.length
        ? 'Opens Square with your package picked. Add ' + extras.join(', ').replace(/, ([^,]*)$/, ' and $1') + ' there too, then choose a time.'
        : 'Opens Square with your package picked. Just choose a time.';
    }
  };
  document.addEventListener('change', () => setTimeout(sync, 0));
  sync();
})();

// Intake forms: send to the shop's Google Apps Script, which emails info@ and logs to the sheet
(() => {
  const forms = Array.from(document.querySelectorAll('form.intake:not([data-booking])')); if (!forms.length) return;
  const API = 'https://script.google.com/macros/s/AKfycbx8Sn6HCIIp_OTcchfsYQ0iToENevinNXVJ2sY2JXbneoX_sZ_59M7P2fbvEreDIJqTrA/exec';
  const MAX_PHOTOS = 5;

  // "Get a quote" buttons pre-check the matching option in this page's form
  document.addEventListener('click', ev => {
    const a = ev.target.closest('a[data-pick]'); if (!a) return;
    const box = forms[0].querySelector(`input[value="${CSS.escape(a.dataset.pick)}"]`);
    if (box) box.checked = true;
  });

  const shrink = file => new Promise(resolve => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.82).split(',')[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });

  const collect = form => Array.from(form.querySelectorAll('[data-label]')).filter(el => !el.classList.contains('if-photos')).map(el => {
    const label = el.dataset.label;
    const picks = Array.from(el.querySelectorAll('input[type=checkbox]:checked, input[type=radio]:checked')).map(i => i.value);
    const ctl = el.querySelector('input:not([type=checkbox]):not([type=radio]), textarea, select');
    return [label, picks.length ? picks.join(', ') : (ctl ? ctl.value.trim() : '')];
  });

  forms.forEach(form => {
    const started = Date.now();
    const status = form.querySelector('.if-status');
    const btn = form.querySelector('button[type=submit]');
    const fileIn = form.querySelector('.if-photos input[type=file]');
    const thumbs = form.querySelector('.if-thumbs');
    let files = [];

    const drawThumbs = () => {
      thumbs.innerHTML = '';
      files.forEach((f, i) => {
        const li = document.createElement('li');
        const im = document.createElement('img'); im.src = URL.createObjectURL(f); im.alt = '';
        const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Remove ' + f.name);
        x.addEventListener('click', () => { files.splice(i, 1); drawThumbs(); });
        li.append(im, x); thumbs.append(li);
      });
    };
    if (fileIn) fileIn.addEventListener('change', () => {
      files = files.concat(Array.from(fileIn.files).filter(f => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name))).slice(0, MAX_PHOTOS);
      fileIn.value = ''; drawThumbs();
    });

    // clear an error as soon as the field is fixed
    const clearBad = ev => {
      const f = ev.target.closest('.if'); if (f) f.classList.remove('is-bad');
      if (!form.querySelector('.is-bad') && status.classList.contains('is-error')) { status.className = 'if-status'; status.textContent = ''; }
    };
    form.addEventListener('input', clearBad);
    form.addEventListener('change', clearBad);

    const validate = () => {
      let first = null;
      form.querySelectorAll('.if').forEach(f => f.classList.remove('is-bad'));
      form.querySelectorAll('input[required], textarea[required]').forEach(i => {
        const bad = !i.value.trim() || (i.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.value.trim())) ||
          (i.type === 'tel' && i.value.replace(/\D/g, '').length < 10);
        if (bad) { i.closest('.if').classList.add('is-bad'); first = first || i; }
      });
      form.querySelectorAll('fieldset[data-required]').forEach(fs => {
        if (!fs.querySelector('input:checked')) { fs.classList.add('is-bad'); first = first || fs.querySelector('input'); }
      });
      if (first) { first.focus({ preventScroll: true }); first.closest('.if').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      return !first;
    };

    const fallback = fields => {
      const body = fields.filter(f => f[1]).map(f => f[0] + ': ' + f[1]).join('\n');
      const href = 'mailto:info@mainlineautoworks.com?subject=' + encodeURIComponent(form.dataset.form + ' request') + '&body=' + encodeURIComponent(body);
      status.className = 'if-status is-error';
      status.innerHTML = 'We couldn\'t send that just now. <a href="' + href + '">Send it by email instead</a> or call <a href="tel:+14845741628">(484) 574-1628</a>.';
    };

    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      status.className = 'if-status'; status.textContent = '';
      if (!validate()) { status.className = 'if-status is-error'; status.textContent = 'Please fill in the highlighted fields.'; return; }
      const fields = collect(form);
      btn.disabled = true; btn.textContent = files.length ? 'Uploading photos…' : 'Sending…';
      try {
        const photos = (await Promise.all(files.map(shrink))).filter(Boolean);
        btn.textContent = 'Sending…';
        const res = await fetch(API, {
          method: 'POST',
          body: JSON.stringify({ action: 'intake', form: form.dataset.form, page: location.href, fields, photos,
            website: form.querySelector('[name=website]').value, ms: Date.now() - started })
        });
        const out = await res.json();
        if (!out.ok) throw new Error(out.error || 'failed');
        const first = (fields.find(f => f[0] === 'First name') || [, ''])[1];
        form.classList.add('is-sent');
        form.innerHTML = '<div class="if-done"><span class="if-done-mark" aria-hidden="true">✓</span><h3>Thanks' + (first ? ', ' + first.replace(/[<>&"]/g, '') : '') +
          '!</h3><p>Your request is in. We\'ll reach out soon with a price. Need us sooner? Call <a href="tel:+14845741628">(484) 574-1628</a>.</p></div>';
        form.querySelector('h3').setAttribute('tabindex', '-1'); form.querySelector('h3').focus();
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Send request';
        fallback(fields);
      }
    });
  });
})();

// Detailing: one-step booking. Shows Square's open times for the exact package, size and add-ons,
// then books it in Square. If Square can't be reached, the page keeps Square's own calendar.
(() => {
  const bk = document.getElementById('bk'); if (!bk) return;
  const API = 'https://script.google.com/macros/s/AKfycbx8Sn6HCIIp_OTcchfsYQ0iToENevinNXVJ2sY2JXbneoX_sZ_59M7P2fbvEreDIJqTrA/exec';
  const TZ = 'America/New_York';
  const daysEl = document.getElementById('bk-days'), timesEl = document.getElementById('bk-times');
  const form = document.getElementById('bk-form'), done = document.getElementById('bk-done');
  const status = form.querySelector('.if-status'), btn = form.querySelector('button[type=submit]');
  const whenEl = document.getElementById('bk-when');
  const widget = document.querySelector('#book .dp-widget'), alt = document.querySelector('#book .dp-widget-alt');
  const note = document.querySelector('#dp-booking-note p');
  const hint = document.getElementById('dp-book-hint');
  const started = Date.now();
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayName = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
  const dayDate = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const longFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
  let active = false, slots = [], day = null, pick = null, reqKey = '', loadedKey = '', timer = 0;

  const choice = () => {
    const pkg = document.querySelector('input[name="dp-package"]:checked');
    const size = document.querySelector('input[name="dp-size"]:checked');
    const extras = pkg && /^moto/.test(pkg.value) ? [] : Array.from(document.querySelectorAll('.dp-addon input:checked'));
    const total = document.getElementById('dp-total');
    return { pkg: pkg ? pkg.value : 'full', pkgName: pkg ? pkg.dataset.name : '', size: size ? size.value : '2',
      sizeLabel: size ? size.dataset.label : '', extras: extras.map(b => b.value), extraNames: extras.map(b => b.dataset.name),
      total: total ? total.textContent : '' };
  };
  const keyOf = c => [c.pkg, c.size, c.extras.join(',')].join('|');
  const hrs = m => { const h = Math.floor(m / 60), r = m % 60; return (h ? h + ' hr' : '') + (h && r ? ' ' : '') + (r ? r + ' min' : ''); };

  const setNote = minutes => {
    if (!note) return;
    const c = choice();
    const adds = c.extraNames.length ? ' + ' + c.extraNames.map(x => x.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' and $1') : '';
    note.innerHTML = 'Booking <strong>' + c.pkgName + '</strong> for a <strong>' + c.sizeLabel + '</strong>' + adds +
      (minutes ? ' · about ' + hrs(minutes) : '') + ' · <strong>' + c.total + '</strong>. Change anything above and the times update.';
  };

  const activate = () => {
    if (active) return; active = true;
    bk.hidden = false;
    if (widget) widget.hidden = true;
    if (alt) alt.innerHTML = 'Prefer Square\'s calendar? <a class="link" href="https://book.squareup.com/appointments/nebfqje99efjsg/location/L55RAA17AA9Y0/services" target="_blank" rel="noopener">Book on Square</a> or call <a class="link" href="tel:+14845741628">(484) 574-1628</a>.';
    document.querySelectorAll('a[data-square]').forEach(a => { a.removeAttribute('target'); a.dataset.bk = '1'; a.href = '#book'; });
    if (hint) hint.textContent = 'Pick a day and time below. Your size and add-ons come with it.';
  };
  const deactivate = () => {               // fall back to Square's own calendar
    active = false; bk.hidden = true;
    if (widget) widget.hidden = false;
  };

  const drawDays = () => {
    const groups = {};
    slots.forEach(t => { const k = dayKey.format(new Date(t)); (groups[k] = groups[k] || []).push(t); });
    const keys = Object.keys(groups).sort();
    if (!keys.includes(day)) day = keys[0] || null;
    daysEl.innerHTML = keys.length ? '' : '<p class="bk-empty">No open times in the next two weeks for this combination. Call <a href="tel:+14845741628">(484) 574-1628</a> and we\'ll fit you in.</p>';
    keys.forEach(k => {
      const d = new Date(groups[k][0]);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'bk-day' + (k === day ? ' is-on' : '');
      b.setAttribute('aria-pressed', k === day);
      b.innerHTML = '<span>' + dayName.format(d) + '</span><strong>' + dayDate.format(d) + '</strong><em>' + groups[k].length + ' open</em>';
      b.addEventListener('click', () => { day = k; pick = null; drawDays(); });
      daysEl.append(b);
    });
    timesEl.innerHTML = '';
    (groups[day] || []).forEach(t => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'bk-time' + (t === pick ? ' is-on' : '');
      b.setAttribute('aria-pressed', t === pick);
      b.textContent = timeFmt.format(new Date(t));
      b.addEventListener('click', () => {
        pick = t; drawDays();
        form.hidden = false;
        whenEl.textContent = longFmt.format(new Date(t)) + ' at ' + timeFmt.format(new Date(t));
        if (!form.dataset.seen) { form.dataset.seen = '1'; form.querySelector('[name=first]').focus({ preventScroll: true }); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      });
      timesEl.append(b);
    });
    if (!slots.includes(pick)) { pick = null; form.hidden = true; }
  };

  const load = async () => {
    const c = choice(), key = keyOf(c);
    if (key === loadedKey) return;
    reqKey = key;
    if (active) { daysEl.innerHTML = '<p class="bk-empty">Finding open times…</p>'; timesEl.innerHTML = ''; }
    try {
      const q = new URLSearchParams({ action: 'slots', pkg: c.pkg, size: c.size, extras: c.extras.join(','), from: new Date().toISOString() });
      const j = await (await fetch(API + '?' + q)).json();
      if (reqKey !== key) return;                       // a newer choice is already loading
      if (!j.ok) throw new Error(j.error || 'failed');
      loadedKey = key; slots = j.slots || [];
      activate(); setNote(j.minutes); drawDays();
    } catch (err) {
      if (reqKey !== key) return;
      loadedKey = ''; deactivate();
    }
  };
  document.addEventListener('change', e => {
    if (!e.target.closest || !e.target.closest('.dp-step, .dp-sizes, .dp-addon, .dp-card') && !/^dp-/.test(e.target.name || '')) return;
    clearTimeout(timer); timer = setTimeout(load, 450);
  });
  load();

  // contact form
  form.addEventListener('input', ev => { const f = ev.target.closest('.if'); if (f) f.classList.remove('is-bad'); });
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    status.className = 'if-status'; status.textContent = '';
    if (!pick) { status.className = 'if-status is-error'; status.textContent = 'Pick a time first.'; return; }
    let first = null;
    form.querySelectorAll('input[required]').forEach(i => {
      const v = i.value.trim();
      const bad = !v || (i.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) || (i.type === 'tel' && v.replace(/\D/g, '').length < 10);
      i.closest('.if').classList.toggle('is-bad', bad); if (bad && !first) first = i;
    });
    if (first) { first.focus(); status.className = 'if-status is-error'; status.textContent = 'Please fill in the highlighted fields.'; return; }
    const c = choice(), val = n => (form.querySelector('[name=' + n + ']') || {}).value || '';
    const reach = form.querySelector('[name=reach]:checked');
    btn.disabled = true; btn.textContent = 'Booking…';
    try {
      const res = await fetch(API, { method: 'POST', body: JSON.stringify(Object.assign({ action: 'book', start: pick,
        first: val('first').trim(), last: val('last').trim(), phone: val('phone').trim(), email: val('email').trim(), vehicle: val('vehicle').trim(),
        reach: reach ? reach.value : '', notes: val('notes').trim(), website: val('website'), ms: Date.now() - started,
        key: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()) }, c)) });
      const j = await res.json();
      if (!j.ok) throw Object.assign(new Error(j.error || 'failed'), { code: j.error });
      const d = new Date(j.start || pick);
      bk.querySelector('.bk-panel').hidden = true;
      done.hidden = false;
      done.innerHTML = '<span class="if-done-mark" aria-hidden="true">✓</span>' +
        '<h3>' + (j.status === 'PENDING' ? 'Request sent' : 'You\'re booked') + ', ' + val('first').trim().replace(/[<>&"]/g, '') + '!</h3>' +
        '<p class="bk-done-when">' + longFmt.format(d) + ' at ' + timeFmt.format(d) + '</p>' +
        '<p>' + c.pkgName + ' for a ' + c.sizeLabel + (c.extraNames.length ? ' + ' + c.extraNames.join(', ').toLowerCase() : '') + ' · ' + c.total + '</p>' +
        '<p class="bk-done-fine">' + (j.status === 'PENDING' ? 'We\'ll confirm your time shortly.' : 'Square will send your confirmation and a reminder before your appointment.') +
        ' Need to change it? Call or text <a href="tel:+14845741628">(484) 574-1628</a>.</p>';
      if (note) note.closest('.dp-booking-note').hidden = true;
      if (alt) alt.hidden = true;
      done.focus();
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Book it';
      status.className = 'if-status is-error';
      if (err.code === 'slot_gone') {
        status.textContent = 'Sorry, that time was just taken. Pick another one.';
        loadedKey = ''; pick = null; load();
      } else {
        status.innerHTML = 'We couldn\'t finish booking online. <a href="https://book.squareup.com/appointments/nebfqje99efjsg/location/L55RAA17AA9Y0/services" target="_blank" rel="noopener">Book on Square instead</a> or call <a href="tel:+14845741628">(484) 574-1628</a>.' +
          '<span class="bk-err">Details: ' + String(err.message || err).replace(/[<>&]/g, '') + '</span>';
      }
    }
  });
})();
