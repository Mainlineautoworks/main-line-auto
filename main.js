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
  caliperImg.src = `assets/img/caliper-${presetColor}.webp`;
  caliperImg.alt = `Brake caliper shown in ${label.toLowerCase()} behind a black wheel`;
  colorName.textContent = label;
  if (caliperView) caliperView.classList.remove('custom-color');
  if (viewer()) viewer().setColor(getComputedStyle(btn).getPropertyValue('--c').trim(), { metallic: btn.dataset.metallic === 'true' });
}
arrowNav(colorButtons, setColor);
if (caliperImg) {
  // Preload the photos once the section is close, so the photo view swaps instantly
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
    // We only have shop photos for the preset colors, so a custom color shows in 3D
    if (caliperView) caliperView.classList.add('custom-color');
    setMode('3d');
    if (viewer()) viewer().setColor(customColor.value);
  };
  customColor.addEventListener('input', applyCustom);
  customColor.addEventListener('change', applyCustom);
  customSwatch.style.setProperty('--c', customColor.value);
}

const finishButtons = Array.from(document.querySelectorAll('.finish-picker button'));
arrowNav(finishButtons, btn => {
  finishButtons.forEach(b => b.setAttribute('aria-checked', String(b === btn)));
  if (viewer()) viewer().setFinish(btn.dataset.finish);
  setMode('3d');
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
