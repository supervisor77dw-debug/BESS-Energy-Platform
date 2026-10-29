// Bildschirmaufnahmen und Layoutprüfung des Investitionsplaners (AW-STROMKAI-20261029-INVESTITIONSPLANER-016) gegen eine lokale
// Instanz mit Demo-Daten: legt bei Bedarf einen Demo-Planungsstand an (nur Demo-Projekt DEMO-N01, Demo-Konto *.invalid),
// nimmt alle sechs Schritte auf Desktop, Tablet und Smartphone auf und prüft auf waagerechten Überlauf.
// Aufruf: QA_PLAYWRIGHT=<pfad zu playwright-core> QA_PASSWORT=<Demo-Passwort> node tools/qa/planer-shots.mjs <basis-url> <ausgabeordner>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const pw = createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT);
const VIEW = { desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, smartphone: { width: 390, height: 844 } };
const SCHRITTE = ['grundstueck', 'technik', 'kosten', 'finanzierung', 'wirtschaftlichkeit', 'vergleich'];
const browser = await pw.chromium.launch({ channel: 'msedge' });
const ergebnisse = [];
const pruefe = (name, ok, d = '') => { ergebnisse.push({ name, ok: !!ok, d }); console.log(`${ok ? 'OK  ' : 'FEHL'} ${name}${d ? ' – ' + d : ''}`); };
async function anmelden(ctx) {
  const page = await ctx.newPage();
  await page.goto(base + '/portal/login');
  await page.fill('#email', 'admin@demo.invalid'); await page.fill('#pw', process.env.QA_PASSWORT);
  await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
  return page;
}
// Demo-Stand über die Oberfläche anlegen, falls noch keiner existiert
{
  const ctx = await browser.newContext({ viewport: VIEW.desktop });
  const page = await anmelden(ctx);
  await page.goto(base + '/portal/anlagenplanung/p-n01?schritt=grundstueck');
  if (await page.locator('text=Neuer Planungsstand (Vorbelegung)').count()) {
    for (const [k, v] of Object.entries({ bezeichnung: 'Demo-Flurstück Nord A (synthetisch)', flaecheM2: '12000', laengeM: '120', breiteM: '100', grenzabstandM: '3', zufahrtM2: '600', feuerwehrM2: '400', nebenanlagenM2: '300', netzMW: '12', einspeiseMW: '12', bezugMW: '15', gelaende: 'eben (Annahme)', entwaesserung: 'offen', erschliessung: 'Wirtschaftsweg, zu prüfen' })) await page.fill(`[name="g.${k}"]`, v);
    await page.selectOption('[name="a.flaeche.status"]', 'angenommen'); await page.fill('[name="a.flaeche.quelle"]', 'Projektakte (synthetisch)');
    await page.fill('[name="notiz"]', 'Demo-Grundstück für die QA');
    await Promise.all([page.waitForNavigation(), page.click('.ip-speichern button')]);
    await page.goto(base + '/portal/anlagenplanung/p-n01?schritt=technik');
    await page.selectOption('[name="v.B.erloes"]', 'b2_A'); await page.selectOption('[name="v.C.erloes"]', 'b2_B');
    await Promise.all([page.waitForNavigation(), page.click('.ip-speichern button')]);
  }
  await ctx.close();
}
for (const [vn, vp] of Object.entries(VIEW)) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: vn === 'smartphone', hasTouch: vn === 'smartphone' });
  const page = await anmelden(ctx);
  for (const s of SCHRITTE) {
    const res = await page.goto(`${base}/portal/anlagenplanung/p-n01?schritt=${s}&var=B`);
    const m = await page.evaluate(() => ({ ueberlauf: document.documentElement.scrollWidth > innerWidth + 1, fehler: !!document.querySelector('.alert') }));
    pruefe(`${vn} ${s}: Status 200, kein waagerechter Überlauf`, res.status() === 200 && !m.ueberlauf, m.ueberlauf ? 'Überlauf' : '');
    await page.screenshot({ path: join(out, `${vn}_${s}.png`), fullPage: vn !== 'smartphone' || s === 'grundstueck' });
  }
  for (const p of ['/portal/anlagenplanung', '/portal/anlagenplanung/katalog']) { const res = await page.goto(base + p); const ue = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); pruefe(`${vn} ${p}: 200, kein Überlauf`, res.status() === 200 && !ue); if (vn === 'desktop') await page.screenshot({ path: join(out, `${vn}${p.replace(/\//g, '_')}.png`), fullPage: true }); }
  await ctx.close();
}
await browser.close();
const ok = ergebnisse.filter((e) => e.ok).length;
writeFileSync(join(out, 'planer-shots.json'), JSON.stringify({ zeitpunkt: new Date().toISOString(), bestanden: ok, gesamt: ergebnisse.length, ergebnisse }, null, 1));
console.log(`\n${ok}/${ergebnisse.length} bestanden`);
process.exit(ok === ergebnisse.length ? 0 : 1);
