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

// Live repaint of the caliper in the real photo.
// caliper-shade.png holds the caliper's lighting (RGB) and outline (alpha), cut from our own photos;
// any paint color is multiplied through that lighting, so reflections and shadows stay real.
const paint = (() => {
  const cv = document.getElementById('caliper-paint');
  if (!cv || !caliperView || !caliperImg) return null;
  const ctx = cv.getContext('2d');
  const toLin = v => Math.pow(v / 255, 2.2);
  const hexLin = h => { const n = parseInt(h.replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255].map(toLin); };
  const FIN = { gloss: 1, satin: 0.72, matte: 0.45 };   // how much of the lighting contrast survives
  let shade = null, alpha = null, out = null, cur = hexLin('#CD1620'), goal = cur, metal = 0, contrast = 1, goalContrast = 1, anim = 0;
  const img = new Image();
  img.onload = () => {
    const t = document.createElement('canvas'); t.width = cv.width; t.height = cv.height;
    const tc = t.getContext('2d'); tc.drawImage(img, 0, 0);
    const d = tc.getImageData(0, 0, t.width, t.height).data;
    shade = new Float32Array(d.length / 4); alpha = new Uint8ClampedArray(d.length / 4);
    for (let i = 0; i < shade.length; i++) { shade[i] = toLin(d[i * 4]); alpha[i] = d[i * 4 + 3]; }
    out = ctx.createImageData(cv.width, cv.height);
    caliperImg.src = 'assets/img/caliper-black.webp';
    caliperView.classList.add('paint-ready');
    render();
  };
  img.src = 'assets/img/caliper-shade.png';
  const MID = 0.2;
  function render() {
    if (!shade) return;
    const o = out.data;
    for (let i = 0; i < shade.length; i++) {
      let s = shade[i];
      s = MID + (s - MID) * contrast;                     // satin/matte flatten the highlights
      if (metal) s = s * 0.8 + Math.max(0, shade[i] - MID) * 0.9;  // metallic: stronger, whiter highlights
      for (let c = 0; c < 3; c++) o[i * 4 + c] = Math.round(255 * Math.pow(Math.min(1, Math.max(0, cur[c] * s)), 1 / 2.2));
      o[i * 4 + 3] = alpha[i];
    }
    ctx.putImageData(out, 0, 0);
  }
  function animate() {
    cancelAnimationFrame(anim);
    const from = cur.slice(), c0 = contrast, start = performance.now();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const step = t => {
      const k = reduce ? 1 : Math.min((t - start) / 260, 1), e = k * k * (3 - 2 * k);
      cur = from.map((v, i) => v + (goal[i] - v) * e);
      contrast = c0 + (goalContrast - c0) * e;
      render();
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  return {
    setColor(hex, opts = {}) { goal = hexLin(hex).map(v => opts.metallic ? v * 0.75 : v); metal = opts.metallic ? 1 : 0; animate(); },
    setFinish(name) { goalContrast = FIN[name] || 1; animate(); }
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
  if (!paint) caliperImg.src = `assets/img/caliper-${presetColor}.webp`;
  caliperImg.alt = `Brake caliper shown in ${label.toLowerCase()} behind a black wheel`;
  colorName.textContent = label;
  const hex = getComputedStyle(btn).getPropertyValue('--c').trim(), opts = { metallic: btn.dataset.metallic === 'true' };
  if (viewer()) viewer().setColor(hex, opts);
  if (paint) paint.setColor(hex, opts);
}
arrowNav(colorButtons, setColor);
if (caliperImg && !document.getElementById('caliper-paint')) {
  // No live repaint: preload the photos once the section is close, so swaps are instant
  new IntersectionObserver((es, obs) => {
    if (!es[0].isIntersecting) return;
    colorButtons.forEach(b => { const i = new Image(); i.src = `assets/img/caliper-${b.dataset.color}.webp`; });
    obs.disconnect();
  }, { rootMargin: '400px' }).observe(caliperImg);
}

if (customColor) {
  const applyCustom = () => {
    colorButtons.forEach(b => b.setAttribute('aria-checked', 'false'));
    customSwatch.classList.add('is-active');
    customSwatch.style.setProperty('--c', customColor.value);
    colorName.textContent = `Custom ${customColor.value.toUpperCase()}`;
    caliperImg.alt = `Brake caliper shown in a custom color behind a black wheel`;
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
