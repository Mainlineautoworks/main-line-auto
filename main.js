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
const ASSET_V = '20261109r';
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
const asset = (name) => `assets/img/${name}?v=${ASSET_V}`;

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
  stage: document.getElementById('cv-stage'), initial: 'sports', color: '#CD1620',
  vehicles: {
    sports:  { img: asset('caliper-sports.webp'),  shade: asset('caliper-sports-shade.png'),  box: [659, 274, 170, 358], alt: 'Black wheel on a red sports car' },
    sedan:   { img: asset('caliper-sedan.webp'),   shade: asset('caliper-sedan-shade.png'),   box: [361, 484, 212, 379], size: [1320, 1227], alt: 'Gloss black wheel on a grey sedan' },
    truck:   { img: asset('caliper-truck.webp'),   shade: asset('caliper-truck-shade.png'),   box: [703, 350, 79, 162],  alt: 'Gloss black wheel on a grey pickup truck' },
    closeup: { img: asset('caliper-closeup.webp'), shade: asset('caliper-closeup-shade.png'), box: [128, 24, 307, 843], alt: 'Close-up of a brake caliper beside a drilled rotor' }
  }
});
wirePickers(document.getElementById('calipers'), caliperPaint, {
  onVehicle: () => setMode('photo'),
  onColor: (hex, opts) => { if (viewer()) viewer().setColor(hex, opts); },
  onFinish: f => { if (viewer()) viewer().setFinish(f); }
});

// Wraps: full-body color change on real cars
const wrapPaint = createPainter({
  view: document.getElementById('wrap-view'), img: document.getElementById('wrap-img'), canvas: document.getElementById('wrap-paint'),
  stage: document.getElementById('wrap-stage'), initial: 'sports', color: '#C8102E',
  vehicles: {
    sports: { img: asset('wrap-sports.webp'), shade: asset('wrap-sports-shade.png'), box: [74, 219, 976, 434], size: [1117, 787], alt: 'Lamborghini Huracan with its body wrapped in the selected color' },
    sedan: { img: asset('wrap-sedan.webp'), shade: asset('wrap-sedan-shade.png'), box: [21, 544, 1263, 380], size: [1320, 1158], alt: 'Porsche sport sedan with its body wrapped in the selected color' },
    suv: { img: asset('wrap-suv.webp'), shade: asset('wrap-suv-shade.png'), box: [53, 327, 1219, 404], size: [1320, 929], alt: 'Porsche SUV with its body wrapped in the selected color' },
    truck: { img: asset('wrap-truck.webp'), shade: asset('wrap-truck-shade.png'), box: [35, 117, 1243, 496], size: [1320, 812], alt: 'Ford F-250 pickup with its body wrapped in the selected color' }
  }
});
wirePickers(document.getElementById('wraps'), wrapPaint);

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

document.getElementById('year').textContent = new Date().getFullYear();
