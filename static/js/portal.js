// Portal-Navigation: Menüschalter auf schmalen Bildschirmen, einklappbare Seitenleiste am Desktop.
// Läuft im <head>, damit der eingeklappte Zustand ohne Flackern greift. Ohne JavaScript bleibt die Navigation ausgeklappt.
// Ohne eigene Wahl (localStorage) klappt die Leiste zwischen 900 und 1199 px automatisch ein, darüber ist sie ausgeklappt;
// eine Wahl über den Schalter gilt je Browser für alle Breiten (AW-STROMKAI-20261030-UI-NAVIGATION-PASSWORT-019).
(() => {
  const root = document.documentElement;
  root.classList.add('js');
  const mittel = window.matchMedia('(min-width: 900px) and (max-width: 1199px)');
  const wahl = () => { try { return localStorage.getItem('portal-leiste'); } catch { return null; /* Speicher gesperrt: automatisch */ } };
  const anwenden = () => { const w = wahl(); root.classList.toggle('nav-eng', w === 'eng' || (w !== 'breit' && mittel.matches)); };
  anwenden();
  document.addEventListener('DOMContentLoaded', () => {
    const menu = document.querySelector('.rail-menu');
    const nav = document.getElementById('portalnavigation');
    const eng = document.querySelector('.rail-collapse');
    const setMenu = (open) => { nav.classList.toggle('open', open); menu.setAttribute('aria-expanded', String(open)); menu.textContent = open ? 'Schließen' : 'Menü'; };
    if (menu && nav) {
      menu.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { setMenu(false); menu.focus(); } });
    }
    // Tooltip der eingeklappten Leiste: festes Element außerhalb des Bildlaufbereichs, bei Zeigen und Tastaturfokus
    const tip = document.createElement('div');
    tip.className = 'rail-tip'; tip.hidden = true; tip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tip);
    const zeigen = (el) => {
      if (!root.classList.contains('nav-eng') || (menu && getComputedStyle(menu).display !== 'none')) return;
      const r = el.getBoundingClientRect();
      tip.textContent = el.querySelector('span').textContent; tip.hidden = false;
      tip.style.left = `${r.right + 8}px`; tip.style.top = `${r.top + r.height / 2 - tip.offsetHeight / 2}px`;
    };
    const verbergen = () => { tip.hidden = true; };
    document.querySelectorAll('.rail a, .rail-collapse').forEach((el) => {
      el.addEventListener('mouseenter', () => zeigen(el)); el.addEventListener('mouseleave', verbergen);
      el.addEventListener('focus', () => { if (el.matches(':focus-visible')) zeigen(el); }); el.addEventListener('blur', verbergen);
    });
    document.querySelector('.rail')?.addEventListener('scroll', verbergen, { passive: true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') verbergen(); });
    if (eng) {
      const sync = () => { const on = root.classList.contains('nav-eng'); eng.setAttribute('aria-pressed', String(on)); const t = on ? 'Leiste ausklappen' : 'Leiste einklappen'; eng.querySelector('span').textContent = t; if (!tip.hidden) tip.textContent = t; };
      sync();
      mittel.addEventListener('change', () => { anwenden(); sync(); });
      eng.addEventListener('click', () => {
        const neu = !root.classList.contains('nav-eng');
        try { localStorage.setItem('portal-leiste', neu ? 'eng' : 'breit'); } catch { /* nur für diese Seite */ }
        root.classList.toggle('nav-eng', neu);
        sync();
      });
    }
  });
})();
