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

// Caliper picker: swap to the pre-rendered photo in that color
const caliperImg = document.getElementById('caliper-img');
const colorName = document.getElementById('color-name');
const colorButtons = Array.from(document.querySelectorAll('.color-picker button'));
// Preload so swaps are instant
colorButtons.forEach(b => { const i = new Image(); i.src = `assets/img/caliper-${b.dataset.color}.webp`; });
function setColor(btn) {
  colorButtons.forEach(b => b.setAttribute('aria-checked', String(b === btn)));
  const label = btn.textContent.trim();
  caliperImg.src = `assets/img/caliper-${btn.dataset.color}.webp`;
  caliperImg.alt = `Brake caliper shown in ${label.toLowerCase()} behind a black wheel`;
  colorName.textContent = label;
}
arrowNav(colorButtons, setColor);

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
