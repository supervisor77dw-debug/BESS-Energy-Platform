// Portal-Navigation: Menüschalter auf schmalen Bildschirmen, einklappbare Seitenleiste am Desktop (Wahl je Browser).
// Läuft im <head>, damit der eingeklappte Zustand ohne Flackern greift. Ohne JavaScript bleibt die Navigation ausgeklappt.
(() => {
  const root = document.documentElement;
  root.classList.add('js');
  try { if (localStorage.getItem('portal-leiste') === 'eng') root.classList.add('nav-eng'); } catch { /* Speicher gesperrt: breite Leiste */ }
  document.addEventListener('DOMContentLoaded', () => {
    const menu = document.querySelector('.rail-menu');
    const nav = document.getElementById('portalnavigation');
    const eng = document.querySelector('.rail-collapse');
    const setMenu = (open) => { nav.classList.toggle('open', open); menu.setAttribute('aria-expanded', String(open)); menu.textContent = open ? 'Schließen' : 'Menü'; };
    if (menu && nav) {
      menu.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { setMenu(false); menu.focus(); } });
    }
    if (eng) {
      const sync = () => { const on = root.classList.contains('nav-eng'); eng.setAttribute('aria-pressed', String(on)); const t = on ? 'Leiste ausklappen' : 'Leiste einklappen'; eng.title = t; eng.querySelector('span').textContent = t; };
      sync();
      eng.addEventListener('click', () => {
        root.classList.toggle('nav-eng');
        try { localStorage.setItem('portal-leiste', root.classList.contains('nav-eng') ? 'eng' : 'breit'); } catch { /* nur für diese Seite */ }
        sync();
      });
    }
  });
})();
