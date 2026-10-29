// Prüfung der Portal-Navigation (AW-STROMKAI-20261029-INVESTITIONSPLANER-016) gegen eine lokale Instanz mit Demo-Daten:
// je Ansicht und Rolle alle Menüpunkte vollständig lesbar (kein Abschneiden, keine Ellipse), kein waagerechter Bildlauf der Seite,
// ausreichende Breite der Arbeitsfläche, Menüschalter auf schmalen Bildschirmen, einklappbare Leiste am Desktop.
// Nur Demo-Konten (*.invalid) einer lokalen Instanz, nie persönliche Konten. Schreibt nur in den Ausgabeordner.
// Aufruf: QA_PLAYWRIGHT=<pfad zu playwright-core> QA_PASSWORT=<Demo-Passwort> node tools/qa/nav-check.mjs <basis-url> <ausgabeordner>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const pw = createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT);
const VIEW = {
  'desktop-1920': { width: 1920, height: 1080 }, 'desktop-1440': { width: 1440, height: 900 }, 'desktop-1280': { width: 1280, height: 800 },
  'tablet-quer': { width: 1024, height: 768 }, 'tablet-hoch': { width: 768, height: 1024 }, 'smartphone-390': { width: 390, height: 844 }, 'smartphone-375': { width: 375, height: 812 },
};
const ROLLEN = { admin: 'admin@demo.invalid', projektleitung: 'projektleitung@demo.invalid', eigentuemer: 'eigentuemer.a@demo.invalid', investor: 'investor.a@demo.invalid' };
const ergebnisse = [];
const pruefe = (name, ok, d = '') => { ergebnisse.push({ name, ok: !!ok, d }); console.log(`${ok ? 'OK  ' : 'FEHL'} ${name}${d ? ' – ' + d : ''}`); };

const messen = () => {
  const nav = document.getElementById('portalnavigation'); const btn = document.querySelector('.rail-menu');
  const mobil = getComputedStyle(btn).display !== 'none';
  if (mobil && !nav.classList.contains('open')) btn.click();
  const rail = document.querySelector('.rail').getBoundingClientRect();
  const sp = [...nav.querySelectorAll('a span')];
  const ab = sp.filter((s) => { const b = s.getBoundingClientRect(); return s.scrollWidth > s.clientWidth + 0.5 || b.right > Math.min(rail.right, innerWidth) + 0.5 || b.width < 4 || getComputedStyle(s).textOverflow === 'ellipsis'; }).map((s) => s.textContent);
  const r = { mobil, punkte: sp.length, abgeschnitten: ab, ueberlauf: document.documentElement.scrollWidth > innerWidth + 1, arbeitsflaeche: Math.round(document.querySelector('.work').getBoundingClientRect().width), aktiv: [...nav.querySelectorAll('[aria-current="page"]')].map((a) => a.textContent), ziele: sp.map((s) => s.parentElement.getAttribute('href')) };
  return r;
};

const browser = await pw.chromium.launch({ channel: 'msedge' });
for (const [rolle, email] of Object.entries(ROLLEN)) {
  const ansichten = rolle === 'admin' ? Object.entries(VIEW) : Object.entries(VIEW).filter(([n]) => ['desktop-1280', 'tablet-hoch', 'smartphone-375'].includes(n));
  for (const [vn, vp] of ansichten) {
    const ctx = await browser.newContext({ viewport: vp, isMobile: vn.startsWith('smartphone'), hasTouch: vn.startsWith('smartphone') });
    const page = await ctx.newPage();
    await page.goto(base + '/portal/login');
    await page.fill('#email', email); await page.fill('#pw', process.env.QA_PASSWORT);
    await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
    const start = new URL(page.url()).pathname;
    const m = await page.evaluate(messen);
    pruefe(`${rolle} ${vn} ${start}: ${m.punkte} Menüpunkte vollständig lesbar`, m.abgeschnitten.length === 0, m.abgeschnitten.join(', '));
    pruefe(`${rolle} ${vn} ${start}: kein waagerechter Bildlauf`, !m.ueberlauf);
    pruefe(`${rolle} ${vn}: genau ein aktiver Menüpunkt`, m.aktiv.length === 1, m.aktiv.join(', '));
    if (!m.mobil) pruefe(`${rolle} ${vn}: Arbeitsfläche ≥ 760 px`, m.arbeitsflaeche >= 760, `${m.arbeitsflaeche} px`);
    if (rolle === 'admin') {
      await page.screenshot({ path: join(out, `${vn}_zentrale${m.mobil ? '_menue-offen' : ''}.png`) });
      // Alle Menüziele aufrufen: jede Seite erreichbar, Menü überall vollständig
      for (const ziel of m.ziele) {
        const res = await page.goto(base + ziel);
        const mz = await page.evaluate(messen);
        pruefe(`admin ${vn} ${ziel}: Status 200, Menü vollständig, kein Überlauf`, res.status() === 200 && mz.abgeschnitten.length === 0 && !mz.ueberlauf && mz.aktiv.length === 1, `${res.status()} ${mz.abgeschnitten.join(', ')}${mz.ueberlauf ? ' Überlauf' : ''} aktiv=${mz.aktiv.join('|')}`);
      }
      if (m.mobil) {
        await page.goto(base + '/portal/zentrale');
        await page.screenshot({ path: join(out, `${vn}_zentrale_menue-zu.png`) });
        const zu = await page.evaluate(() => getComputedStyle(document.getElementById('portalnavigation')).display === 'none');
        await page.click('.rail-menu');
        const auf = await page.evaluate(() => getComputedStyle(document.getElementById('portalnavigation')).display !== 'none' && document.querySelector('.rail-menu').getAttribute('aria-expanded') === 'true');
        await page.keyboard.press('Escape');
        const wieder = await page.evaluate(() => getComputedStyle(document.getElementById('portalnavigation')).display === 'none');
        pruefe(`admin ${vn}: Menüschalter öffnet und schließt (Escape)`, zu && auf && wieder);
      } else if (vn === 'desktop-1280') {
        await page.goto(base + '/portal/zentrale');
        await page.click('.rail-collapse');
        const eng = await page.evaluate(() => ({ w: document.querySelector('.rail').getBoundingClientRect().width, gedrueckt: document.querySelector('.rail-collapse').getAttribute('aria-pressed'), titel: [...document.querySelectorAll('#portalnavigation a')].every((a) => a.title && a.querySelector('span').textContent) }));
        await page.screenshot({ path: join(out, `${vn}_zentrale_eingeklappt.png`) });
        await page.reload();
        const bleibt = await page.evaluate(() => document.documentElement.classList.contains('nav-eng'));
        await page.click('.rail-collapse');
        const breit = await page.evaluate(() => document.querySelector('.rail').getBoundingClientRect().width);
        pruefe('admin desktop-1280: Leiste einklappbar, Zustand bleibt erhalten, wieder ausklappbar', eng.w <= 72 && eng.gedrueckt === 'true' && eng.titel && bleibt && breit >= 200, `eng ${eng.w} px, breit ${breit} px`);
      }
    }
    await ctx.close();
  }
}
await browser.close();
const ok = ergebnisse.filter((e) => e.ok).length;
writeFileSync(join(out, 'navigation.json'), JSON.stringify({ zeitpunkt: new Date().toISOString(), basis: base, bestanden: ok, gesamt: ergebnisse.length, ergebnisse }, null, 1));
console.log(`\n${ok}/${ergebnisse.length} bestanden`);
process.exit(ok === ergebnisse.length ? 0 : 1);
