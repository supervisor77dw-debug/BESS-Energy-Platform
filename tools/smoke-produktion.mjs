// Smoke-Test der öffentlichen Website nach einem Deployment (AW-20261114-GE-CLAUDE-STROMKAI-GOLIVE-VORBEREITUNG-022).
// Nur lesende GET/HEAD-Anfragen und ein POST ohne Inhalt auf die gesperrten Formular-Endpunkte (erwartet 403, nichts gespeichert).
//   node tools/smoke-produktion.mjs --basis https://stromkai.de --erwartet vorschau|live [--aliase]
//   --basis    Ziel (auch eine Deployment-URL *.vercel.app für den Test vor der Domainumschaltung)
//   --erwartet vorschau = noindex + Entwurfshinweis (vor BESS_OEFFENTLICH=1), live = indexierbar
//   --aliase   prüft zusätzlich http→https sowie www.stromkai.de, stromkai.com, www.stromkai.com → 308 auf https://stromkai.de
// Rückgabe: 0 alle Prüfungen bestanden · 25 mindestens eine Prüfung fehlgeschlagen · 21 Zeitlimit
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const basis = String(arg('--basis', 'https://stromkai.de')).replace(/\/$/, '');
const erwartet = arg('--erwartet', 'vorschau');
const HAUPT = 'https://stromkai.de';
const SEITEN = ['/', '/unternehmen', '/technologie', '/standortentwicklung', '/grundstueckseigentuemer', '/standort-anbieten', '/investoren', '/kommunen', '/projekte', '/kontakt', '/impressum', '/datenschutz'];
const GESCHUETZT = ['/portal', '/portal/zentrale', '/portal/dokumente', '/portal/pipeline', '/portal/admin/benutzer'];
const INTERN = /DOC-|AW-20|Entscheidung Dirk|scrypt\$|sessionKey|BLOB_READ_WRITE|BESS_ACCOUNTS|\.invalid|\n\s+at /;

let fehler = 0;
const ok = (bed, text) => { console.log(`${bed ? 'OK    ' : 'FEHLER'} ${text}`); if (!bed) fehler++; };
const t = setTimeout(() => { console.error('STOPP: Zeitlimit 120 s (rc 21)'); process.exit(21); }, 120e3); t.unref();
const hol = (url, o = {}) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15e3), ...o });

console.log(`ARBEITET – keine Eingabe nötig · Ziel ${basis} · erwartet ${erwartet}`);
for (const p of SEITEN) {
  const r = await hol(basis + p); const body = await r.text();
  ok(r.status === 200, `${p} → ${r.status}`);
  const h = (k) => r.headers.get(k) || '';
  ok(/default-src 'self'/.test(h('content-security-policy')) && h('x-frame-options') === 'DENY' && /nosniff/.test(h('x-content-type-options')), `${p} Sicherheitsheader`);
  if (basis.startsWith('https://')) ok(/max-age=\d{7,}/.test(h('strict-transport-security')), `${p} HSTS`);
  const noindex = /noindex/.test(h('x-robots-tag')) || /<meta name="robots" content="noindex/.test(body);
  ok(erwartet === 'live' ? !noindex : noindex, `${p} Indexierung ${erwartet === 'live' ? 'erlaubt' : 'gesperrt (noindex)'}`);
  ok(!INTERN.test(body), `${p} keine internen Kennungen/Geheimnisse`);
}
const robots = await hol(basis + '/robots.txt'); const rt = await robots.text();
ok(robots.status === 200 && (erwartet === 'live' ? /Sitemap: https:\/\/stromkai\.de/.test(rt) : /Disallow: \//.test(rt)), `robots.txt passend zu ${erwartet}`);
ok((await hol(basis + '/sitemap.xml')).status === (erwartet === 'live' ? 200 : 404), `sitemap.xml ${erwartet === 'live' ? 'vorhanden' : 'nicht ausgeliefert'}`);
const nf = await hol(basis + '/gibt-es-nicht-' + Date.now()); const nfb = await nf.text();
ok(nf.status === 404 && !INTERN.test(nfb), 'Fehlerseite 404 ohne interne Details');
ok((await hol(basis + '/portal/login')).status === 200, 'Portal-Anmeldung erreichbar');
for (const p of GESCHUETZT) { const r = await hol(basis + p); ok([302, 303, 401, 403, 404].includes(r.status) && !/\/portal\/(zentrale|dokumente)$/.test(r.headers.get('location') || ''), `${p} ohne Anmeldung abgewiesen (${r.status})`); }
for (const p of ['/kontakt', '/standort-anbieten']) { const r = await hol(basis + p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' }); ok(r.status === 403, `POST ${p} gesperrt (${r.status})`); }
ok((await hol(basis + '/danke')).status === 404, '/danke nicht erreichbar (Formulare aus)');

if (process.argv.includes('--aliase')) {
  for (const [von, nach] of [['http://stromkai.de/impressum', `${HAUPT}/impressum`], ['https://www.stromkai.de/impressum', `${HAUPT}/impressum`], ['https://stromkai.com/kontakt', `${HAUPT}/kontakt`], ['https://www.stromkai.com/', `${HAUPT}/`], ['http://stromkai.com/', null]]) {
    try { const r = await hol(von); const loc = r.headers.get('location') || '';
      ok([301, 308].includes(r.status) && (nach ? loc === nach : loc.startsWith('https://')), `${von} → ${r.status} ${loc}`);
    } catch (e) { ok(false, `${von} nicht erreichbar (${e.cause?.code || e.message})`); }
  }
}
console.log(fehler ? `STOPP: ${fehler} Prüfung(en) fehlgeschlagen (rc 25)` : 'Smoke-Test bestanden');
process.exit(fehler ? 25 : 0);
