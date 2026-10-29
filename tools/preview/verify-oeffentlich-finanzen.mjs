// Prüft den öffentlichen Abnahmekandidaten nach Übernahme des Finanz- und Designmoduls (AW-STROMKAI-20261029-FINANCE-PUBLIC-011)
// OHNE Anmeldung persönlicher Konten: ausgelieferter Stand, Schutz aller neuen Finanz- und Verwaltungsrouten (GET und POST),
// keine Datenlecks, Demo-Kennzeichnung, noindex, Darstellung Desktop/Smartphone ohne seitliches Scrollen.
// Schreibt nichts in die Anwendung. Aufruf: node tools/preview/verify-oeffentlich-finanzen.mjs --url https://… [--shots <ordner>]
import { createRequire } from 'node:module';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const base = arg('--url').replace(/\/$/, '');
const shots = arg('--shots');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'OK  ' : 'FEHL'} ${name}${detail ? ' – ' + detail : ''}`); };
const get = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o });
const LECK = /Gesamtinvestition|Schuldendienst|Projekt-IRR|Kapitalwert|Handelsumsätze|Erfolgsbeteiligung|Kaufpreis|Mindestpacht|Batterieverschleiß/;

// Ausgelieferter Stand: neue Gestaltungsebene im Stylesheet
const [rs, html] = await (async () => { const r = await get('/'); return [r, await r.text()]; })();
check('Startseite erreichbar', rs.status === 200);
const css = /href="(\/static\/css\/portal\.css[^"]*)"/.exec(html)?.[1] || '/static/css/portal.css';
const cs = await (await get(css)).text();
check('Portal-Stylesheet mit Finanz-/Designebene ausgeliefert', /AW-STROMKAI-20261029-DESIGN-FINANCE-010/.test(cs) && /\.status-strip/.test(cs) && /\.owner-contract > \*/.test(cs));
check('noindex auf der Startseite', /<meta name="robots" content="noindex, nofollow">/.test(html));

// Login-Seite: normale Passwortanmeldung (Formular E-Mail + Passwort), Demo-Hinweis
const lr = await get('/portal/login'); const lb = await lr.text();
check('Login-Seite mit E-Mail und Passwort', lr.status === 200 && /name="email"/.test(lb) && /type="password"/.test(lb));
check('Login-Seite ohne MFA-Feld', !/name="code"/.test(lb));
check('Demo-Betrieb auf der Portal-Anmeldung gekennzeichnet', /synthetisch/i.test(lb));

// Neue und bestehende geschützte Routen ohne Sitzung
const routen = ['/portal', '/portal/wirtschaftlichkeit', '/portal/wirtschaftlichkeit/p-n01', '/portal/wirtschaftlichkeit/p-n01/export.csv',
  '/portal/verguetung', '/portal/verguetung/p-n01', '/portal/verguetung/p-s01', '/portal/verguetung/vertrag/k-1/pdf', '/portal/admin/handelsdaten',
  '/portal/admin', '/portal/admin/benutzer', '/portal/projekte/p-n01', '/portal/dokumente/d-n01-own-a-vertrag/download'];
for (const p of routen) {
  const r = await get(p); const b = await r.text();
  check(`ohne Anmeldung gesperrt: GET ${p}`, r.status !== 200 && !LECK.test(b), `${r.status} → ${r.headers.get('location') || '–'}`);
}
const posts = ['/portal/wirtschaftlichkeit/p-n01/berechnen', '/portal/wirtschaftlichkeit/p-n01/freigeben', '/portal/verguetung/p-n01/simulation',
  '/portal/verguetung/p-n01/verbindlich', '/portal/verguetung/p-n01/zahlung', '/portal/admin/handelsdaten'];
for (const p of posts) {
  const r = await get(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'technik.zyklenJahr=1&betrag=1&inhalt=x' });
  check(`ohne Anmeldung abgewiesen: POST ${p}`, ![200, 201, 204].includes(r.status) && !LECK.test(await r.text()), String(r.status));
}
const fl = await get('/portal/anmelden', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=unbekannt%40demo.invalid&password=falsch' });
check('Anmeldung ohne Formular-Token bzw. mit falschen Daten abgewiesen', fl.status !== 303 || (fl.headers.get('location') || '').includes('login'), String(fl.status));

// Darstellung
if (shots) {
  const pw = createRequire(import.meta.url)('C:/Users/dirk/RodyOnlineWeb/A/work/node_modules/playwright-core');
  const b = await pw.chromium.launch({ channel: 'msedge' });
  for (const [vn, vp] of [['desktop', { width: 1440, height: 900 }], ['smartphone', { width: 390, height: 844 }]]) {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: vn === 'smartphone' ? 2 : 1 });
    const p = await ctx.newPage();
    for (const [n, u] of [['start', '/'], ['portal-login', '/portal/login']]) {
      await p.goto(base + u, { waitUntil: 'networkidle' });
      const ov = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      check(`${vn} ${n}: kein seitliches Scrollen`, !ov);
      await p.screenshot({ path: `${shots}/oeffentlich_${vn}_${n}.png`, fullPage: n !== 'start' });
    }
    await ctx.close();
  }
  await b.close();
}

const fail = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - fail}/${results.length} bestanden`);
process.exit(fail ? 1 : 0);
