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

// Services: photo follows the service you're looking at
const serviceImg = document.getElementById('service-img');
const services = document.querySelectorAll('.service-list li');
function showService(li) {
  services.forEach(s => s.classList.toggle('active', s === li));
  const src = li.dataset.img;
  if (!serviceImg || !src) return;
  serviceImg.style.objectPosition = li.dataset.pos || '50% 50%';
  if (serviceImg.getAttribute('src') !== src) {
    serviceImg.style.opacity = 0;
    setTimeout(() => { serviceImg.src = src; serviceImg.style.opacity = 1; }, 150);
  }
}
services.forEach(li => {
  li.addEventListener('mouseenter', () => showService(li));
  li.addEventListener('focus', () => showService(li));
});
if (services[0]) services[0].classList.add('active');

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
const shadeButtons = document.querySelectorAll('.shade-picker button');
function setShade(btn) {
  const vlt = Number(btn.dataset.vlt);
  shadeButtons.forEach(b => b.setAttribute('aria-checked', String(b === btn)));
  // Scale a little so the darkest shade still shows the scene through the glass
  film.style.opacity = ((100 - vlt) / 100 * 0.92).toFixed(2);
  readout.textContent = vlt;
  note.textContent = notes[vlt];
}
shadeButtons.forEach((btn, i) => {
  btn.addEventListener('click', () => setShade(btn));
  btn.addEventListener('keydown', e => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = shadeButtons[(i + dir + shadeButtons.length) % shadeButtons.length];
    next.focus(); setShade(next);
  });
});
const initial = document.querySelector('.shade-picker [aria-checked="true"]');
if (initial) setShade(initial);

document.getElementById('year').textContent = new Date().getFullYear();
