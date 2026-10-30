// Browserprüfung UI-Korrektur (AW-STROMKAI-20261030-UI-NAVIGATION-PASSWORT-019) gegen eine lokale Instanz mit Demo-Daten:
// Seitenleiste je Breite, Zoomstufe, Fensterhöhe und Zustand (ausgeklappt, eingeklappt, Menüschalter) für Administration und
// eingeschränkte Rollen; Kopfbereich nur Name und Rolle; Eigenes Konto mit Passwortformular erreichbar.
// Browser-Zoom wird wie im Browser abgebildet: CSS-Ansichtsbreite = Fensterbreite / Zoom, Pixeldichte = Zoom.
// Nur Demo-Konten (*.invalid) einer lokalen Instanz; ändert keine Passwörter. Schreibt nur in den Ausgabeordner.
// Aufruf: QA_PLAYWRIGHT=<pfad zu playwright-core> QA_PASSWORT=<Demo-Passwort> node tools/qa/nav-konto-check.mjs <basis-url> <ausgabeordner>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const pw = createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT);
const FENSTER = { 'desktop-1920': [1920, 1080], 'desktop-1440': [1440, 900], 'desktop-1280': [1280, 800], 'tablet-768': [768, 1024], 'smartphone-390': [390, 844], 'smartphone-375': [375, 812] };
const ZOOM = [1, 1.25, 1.5];
const NIEDRIG = { 'niedrig-1440x420': [1440, 420], 'niedrig-1280x360': [1280, 360], 'niedrig-smartphone-375x480': [375, 480] };
const ROLLEN = { admin: 'admin@demo.invalid', vertrieb: 'markus@demo.invalid', eigentuemer: 'eigentuemer.a@demo.invalid' };
const ergebnisse = [];
const pruefe = (name, ok, d = '') => { ergebnisse.push({ name, ok: !!ok, d }); if (!ok) console.log(`FEHL ${name}${d ? ' – ' + d : ''}`); };

// Misst im geöffneten Zustand: jede Beschriftung einzeilig, vollständig, innerhalb Leiste und Fenster; jeder Punkt per Bildlauf
// erreichbar und anklickbar (oberstes Element an seinem Mittelpunkt); Seite ohne waagerechten Bildlauf.
const messen = async (page) => page.evaluate(async () => {
  const nav = document.getElementById('portalnavigation'); const btn = document.querySelector('.rail-menu');
  const mobil = getComputedStyle(btn).display !== 'none';
  if (mobil && !nav.classList.contains('open')) btn.click();
  const eng = !mobil && document.documentElement.classList.contains('nav-eng');
  const rail = document.querySelector('.rail');
  const links = [...nav.querySelectorAll('a')];
  const fehler = []; const tips = [];
  for (const a of links) {
    a.scrollIntoView({ block: 'nearest' });
    await new Promise((r) => requestAnimationFrame(r));
    const s = a.querySelector('span'); const b = a.getBoundingClientRect(); const rr = rail.getBoundingClientRect();
    const mx = b.left + b.width / 2, my = b.top + b.height / 2;
    const oben = document.elementFromPoint(mx, my);
    if (!oben || !a.contains(oben)) fehler.push(`${s.textContent}: nicht anklickbar`);
    if (b.bottom > innerHeight + 0.5 || b.top < -0.5) fehler.push(`${s.textContent}: nicht im Bild`);
    if (eng) {
      a.dispatchEvent(new MouseEvent('mouseenter'));
      const t = document.querySelector('.rail-tip'); const tb = t.getBoundingClientRect();
      if (t.hidden || t.textContent !== s.textContent || tb.right > innerWidth + 0.5 || t.scrollWidth > t.clientWidth + 0.5) fehler.push(`${s.textContent}: Tooltip`); else tips.push(t.textContent);
      a.dispatchEvent(new MouseEvent('mouseleave'));
    } else {
      const sb = s.getBoundingClientRect(); const zeilen = s.getClientRects().length;
      if (s.scrollWidth > s.clientWidth + 0.5 || sb.right > Math.min(rr.right, innerWidth) + 0.5 || zeilen !== 1 || sb.height > parseFloat(getComputedStyle(s).lineHeight) * 1.4 + 1) fehler.push(`${s.textContent}: abgeschnitten/umbrochen`);
    }
  }
  const work = document.querySelector('.work').getBoundingClientRect(); const rr = rail.getBoundingClientRect();
  const who = document.querySelector('.who');
  return {
    mobil, eng, punkte: links.length, fehler, tips: tips.length,
    ueberlauf: document.documentElement.scrollWidth > innerWidth + 1,
    aktiv: nav.querySelectorAll('[aria-current="page"]').length,
    leiste: Math.round(rr.width), arbeitsflaeche: Math.round(work.width), anschluss: mobil || Math.abs(work.left - rr.right) < 1.5,
    kopf: who ? { links: who.querySelectorAll('a').length, text: who.textContent } : null,
  };
});

const browser = await pw.chromium.launch({ channel: 'msedge' });
const faelle = [];
for (const [rolle, email] of Object.entries(ROLLEN)) {
  for (const [fn, [w, h]] of Object.entries(FENSTER)) for (const z of ZOOM) if (rolle === 'admin' || z === 1 || fn === 'desktop-1440') faelle.push({ rolle, email, name: `${fn}@${z * 100}%`, w, h, z });
  for (const [fn, [w, h]] of Object.entries(NIEDRIG)) faelle.push({ rolle, email, name: `${fn}@100%`, w, h, z: 1 });
}
for (const f of faelle) {
  const vp = { width: Math.round(f.w / f.z), height: Math.round(f.h / f.z) };
  const klein = f.w < 768;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: f.z * (klein ? 2 : 1), isMobile: klein, hasTouch: klein });
  const page = await ctx.newPage();
  await page.goto(base + '/portal/login');
  await page.fill('#email', f.email); await page.fill('#pw', process.env.QA_PASSWORT);
  await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
  const tag = `${f.rolle} ${f.name} (${vp.width}×${vp.height} CSS-px)`;
  for (const zustand of ['auto', 'umgeschaltet']) {
    if (zustand === 'umgeschaltet') {
      if (!(await page.locator('.rail-collapse').isVisible())) break;
      await page.click('.rail-collapse'); await page.reload();
    }
    const m = await messen(page);
    const art = m.mobil ? 'Menüschalter' : m.eng ? 'eingeklappt' : 'ausgeklappt';
    pruefe(`${tag} ${art}: ${m.punkte} Menüpunkte lesbar und erreichbar${m.eng ? ' (Tooltips)' : ''}`, m.fehler.length === 0, m.fehler.join('; '));
    pruefe(`${tag} ${art}: kein waagerechter Bildlauf, ein aktiver Punkt, Inhalt schließt an`, !m.ueberlauf && m.aktiv === 1 && m.anschluss, JSON.stringify({ ueberlauf: m.ueberlauf, aktiv: m.aktiv, leiste: m.leiste, arbeit: m.arbeitsflaeche }));
    if (m.kopf) pruefe(`${tag}: Kopfbereich nur Name und Rolle`, m.kopf.links === 0 && !/Passwort/.test(m.kopf.text), m.kopf.text);
    if (f.rolle === 'admin' && f.name === 'desktop-1440@100%' && zustand === 'auto') faelle.breit = m.leiste;
  }
  // Ausgangszustand für die nächste Rolle wiederherstellen
  await page.evaluate(() => { try { localStorage.removeItem('portal-leiste'); } catch { /* */ } });
  // Eigenes Konto erreichbar (Administration über Reiter, sonst Menü)
  if (f.z === 1 && ['desktop-1440', 'smartphone-375'].some((n) => f.name.startsWith(n))) {
    await page.goto(base + (f.rolle === 'admin' ? '/portal/admin/benutzer' : '/portal'));
    const ziel = f.rolle === 'admin' ? page.locator('nav.tabs a[href="/portal/konto"]') : page.locator('#portalnavigation a[href="/portal/konto"]');
    if (f.rolle !== 'admin' && klein) await page.click('.rail-menu');
    await ziel.scrollIntoViewIfNeeded(); await Promise.all([page.waitForNavigation(), ziel.click()]);
    const k = await page.evaluate(() => ({ pfad: location.pathname, formular: !!document.querySelector('form[action="/portal/konto"] input[name="current"]'), ueberlauf: document.documentElement.scrollWidth > innerWidth + 1 }));
    pruefe(`${tag}: Eigenes Konto mit Passwortformular erreichbar`, k.pfad === '/portal/konto' && k.formular && !k.ueberlauf, JSON.stringify(k));
  }
  await ctx.close();
}
await browser.close();
const ok = ergebnisse.filter((e) => e.ok).length;
writeFileSync(join(out, 'nav-konto-check.json'), JSON.stringify({ zeitpunkt: new Date().toISOString(), basis: base, bestanden: ok, gesamt: ergebnisse.length, leisteBreit1440: faelle.breit, ergebnisse }, null, 1));
console.log(`\n${ok}/${ergebnisse.length} bestanden`);
process.exit(ok === ergebnisse.length ? 0 : 1);
