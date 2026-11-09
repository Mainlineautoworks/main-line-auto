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

// Caliper picker: repaints the 3D caliper (caliper-3d.js) and swaps the real photo
const caliperView = document.getElementById('caliper-view');
const caliperImg = document.getElementById('caliper-img');
const colorName = document.getElementById('color-name');
const colorButtons = Array.from(document.querySelectorAll('.color-picker button'));
const customColor = document.getElementById('custom-color');
const customSwatch = customColor && customColor.closest('.custom-swatch');
const modeButtons = Array.from(document.querySelectorAll('.cv-mode button'));
const viewer = () => window.CaliperViewer;
let presetColor = 'red';

// Live repaint of the calipers in the real photo.
// caliper-real-shade.png is cut from that photo: R = how brightly the paint is lit, G = the white
// highlights on top of it, alpha = the caliper outline. Any color is lit by the photo's own light.
const paint = (() => {
  const cv = document.getElementById('caliper-paint');
  if (!cv || !caliperView || !caliperImg) return null;
  const ctx = cv.getContext('2d');
  const toLin = v => Math.pow(v / 255, 2.2);
  const hexLin = h => { const n = parseInt(h.replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255].map(toLin); };
  // finish: how much of the lighting contrast and how much of the shine survive
  const FIN = { gloss: [1, 1], satin: [0.8, 0.4], matte: [0.6, 0.12] };
  let lit = null, hi = null, alpha = null, out = null, mean = 0.1;
  let cur = hexLin('#CD1620'), goal = cur, fin = FIN.gloss, goalFin = fin, metal = 0, anim = 0;
  const img = new Image();
  img.onload = () => {
    const t = document.createElement('canvas'); t.width = cv.width; t.height = cv.height;
    const tc = t.getContext('2d'); tc.drawImage(img, 0, 0);
    const d = tc.getImageData(0, 0, t.width, t.height).data, n = d.length / 4;
    lit = new Float32Array(n); hi = new Float32Array(n); alpha = new Uint8ClampedArray(n);
    let sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      lit[i] = toLin(d[i * 4]); hi[i] = toLin(d[i * 4 + 1]) / 4; alpha[i] = d[i * 4 + 3];
      if (alpha[i] > 128) { sum += lit[i]; cnt++; }
    }
    mean = cnt ? sum / cnt : 0.1;
    out = ctx.createImageData(cv.width, cv.height);
    caliperView.classList.add('paint-ready');
    render();
  };
  img.src = 'assets/img/caliper-real-shade.png';
  function render() {
    if (!lit) return;
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
  return {
    setColor(hex, opts = {}) { goal = hexLin(hex).map(v => opts.metallic ? v * 0.7 : v); metal = opts.metallic ? 1 : 0; animate(); },
    setFinish(name) { goalFin = FIN[name] || FIN.gloss; animate(); }
  };
})();

function setMode(mode) {
  if (!caliperView) return;
  caliperView.dataset.mode = mode;
  modeButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
}
modeButtons.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

function setColor(btn) {
  colorButtons.forEach(b => b.setAttribute('aria-checked', String(b === btn)));
  if (customSwatch) customSwatch.classList.remove('is-active');
  const label = btn.textContent.trim();
  presetColor = btn.dataset.color;
  caliperImg.alt = `Gloss black wheel with brake calipers shown in ${label.toLowerCase()}`;
  colorName.textContent = label;
  const hex = getComputedStyle(btn).getPropertyValue('--c').trim(), opts = { metallic: btn.dataset.metallic === 'true' };
  if (viewer()) viewer().setColor(hex, opts);
  if (paint) paint.setColor(hex, opts);
}
arrowNav(colorButtons, setColor);

if (customColor) {
  const applyCustom = () => {
    colorButtons.forEach(b => b.setAttribute('aria-checked', 'false'));
    customSwatch.classList.add('is-active');
    customSwatch.style.setProperty('--c', customColor.value);
    colorName.textContent = `Custom ${customColor.value.toUpperCase()}`;
    caliperImg.alt = `Gloss black wheel with brake calipers shown in a custom color`;
    if (viewer()) viewer().setColor(customColor.value);
    if (paint) paint.setColor(customColor.value); else setMode('3d');
  };
  customColor.addEventListener('input', applyCustom);
  customColor.addEventListener('change', applyCustom);
  customSwatch.style.setProperty('--c', customColor.value);
}

const finishButtons = Array.from(document.querySelectorAll('.finish-picker button'));
arrowNav(finishButtons, btn => {
  finishButtons.forEach(b => b.setAttribute('aria-checked', String(b === btn)));
  if (viewer()) viewer().setFinish(btn.dataset.finish);
  if (paint) paint.setFinish(btn.dataset.finish); else setMode('3d');
});

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
