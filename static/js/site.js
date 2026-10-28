// Mobile Navigation. Ohne JavaScript bleibt die Navigation über den Seitenfuß erreichbar.
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.querySelector('.nav-toggle');
  const nav = document.getElementById('hauptnavigation');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Schließen' : 'Menü';
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('open')) { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); btn.textContent = 'Menü'; btn.focus(); }
  });
});
