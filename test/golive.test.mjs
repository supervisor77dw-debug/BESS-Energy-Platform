// Go-live-Sperre, kanonische Weiterleitung und Trennung öffentliche Website / Portal
// (AW-20261114-GE-CLAUDE-STROMKAI-GOLIVE-VORBEREITUNG-022). Aufruf: node --test test/golive.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = mkdtempSync(join(tmpdir(), 'bess-golive-'));
process.env.BESS_DATA_DIR = DIR;
process.env.BESS_PREVIEW_HELPERS = '0';
process.env.BESS_OEFFENTLICH = '1'; // Schalter allein darf nichts freischalten (Stufe qa, Platzhalter, keine Freigaben)

let server, port, cfg;
before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'data', 'seed.mjs'), DIR]);
  const store = await import('../src/lib/store.mjs');
  await store.openStore(DIR);
  cfg = await import('../src/config.mjs');
  const { createApp } = await import('../server.mjs');
  server = createApp();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => { server?.close(); rmSync(DIR, { recursive: true, force: true }); });

// node:http, damit der Host-Header frei gesetzt werden kann
const get = (path, host = `127.0.0.1:${port}`) => new Promise((resolve, reject) => {
  const r = request({ host: '127.0.0.1', port, path, method: 'GET', headers: { host } }, (res) => {
    let body = ''; res.setEncoding('utf8'); res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  r.on('error', reject); r.end();
});

const VOLLSTAENDIG = {
  domain: 'https://stromkai.de',
  legal: { stand: { status: 'BESTAETIGT' }, operator: 'Muster Speicher GmbH', address: ['Musterweg 1', '24103 Kiel'], representatives: 'Max Muster', register: 'Amtsgericht Kiel, HRB 0000', vatId: '', mstv: { einschlaegig: false } },
  contact: { email: 'info@stromkai.de', phone: '+49 431 000000', adressen: [{ email: 'info@stromkai.de', zweck: 'Allgemein', bestaetigt: true }] },
  freigaben: { impressum: true, datenschutz: true, marke: true, traegerschaft: true },
};
const MFA = 'privilegiert';

test('Sperre aktiv: mit dem heutigen brand.json bleibt die Website gesperrt, auch wenn BESS_OEFFENTLICH=1 gesetzt ist', async () => {
  const s = cfg.goLiveSperren();
  assert.equal(cfg.isPublicLive(), false);
  for (const erwartet of [/Produktionsstufe/, /Vertretungsberechtigte/, /Betreiberangaben nicht bestätigt/, /§ 18 Abs\. 2 MStV/, /Kontakt-E-Mail/, /Zweiter direkter Kontaktweg/, /Impressum nicht/, /Datenschutzerklärung nicht/, /Markenprüfung/, /Projektträgerschaft/]) {
    assert.ok(s.some((x) => erwartet.test(x)), `Sperrgrund fehlt: ${erwartet}`);
  }
  assert.ok(!s.some((x) => /BESS_OEFFENTLICH/.test(x)), 'Schalter ist gesetzt und darf nicht als Grund erscheinen');
});

test('Sperrlogik: nur wenn alle Bedingungen erfüllt sind, ist die Freischaltung möglich', () => {
  const env = { BESS_OEFFENTLICH: '1' };
  assert.deepEqual(cfg.goLiveSperren(VOLLSTAENDIG, env, 'abnahme', MFA), []);
  assert.ok(cfg.goLiveSperren(VOLLSTAENDIG, {}, 'abnahme', MFA).some((x) => /BESS_OEFFENTLICH/.test(x)), 'ohne Schalter gesperrt');
  assert.ok(cfg.goLiveSperren(VOLLSTAENDIG, env, 'qa', MFA).length === 1, 'QA-Stufe nie öffentlich');
  assert.deepEqual(cfg.goLiveSperren(VOLLSTAENDIG, env, 'abnahme', 'aus'), [], 'MFA ist keine Go-live-Bedingung (Entscheidung Dirk 14.11.2026)');
  for (const [pfad, wert] of [['legal.operator', '[Rechtsträger – noch festzulegen]'], ['legal.register', ''], ['legal.representatives', '[Geschäftsführung – prüfen]'], ['legal.stand', { status: 'VORLAEUFIG' }], ['legal.mstv', { einschlaegig: null }], ['legal.mstv', { einschlaegig: true, verantwortlich: '' }], ['legal.vatId', '12345'], ['contact.email', '[kontakt@domain – noch festzulegen]'], ['contact.phone', ''], ['domain', 'https://www.example.invalid'], ['freigaben.marke', false], ['freigaben.impressum', undefined], ['freigaben.traegerschaft', false]]) {
    const b = structuredClone(VOLLSTAENDIG); const [a, k] = pfad.split('.');
    if (k) b[a][k] = wert; else b[a] = wert;
    assert.ok(cfg.goLiveSperren(b, env, 'abnahme', MFA).length >= 1, `${pfad} = ${JSON.stringify(wert)} muss sperren`);
  }
  const ohneRegister = structuredClone(VOLLSTAENDIG); ohneRegister.legal.register = 'entfällt (keine Eintragungspflicht, Rechtsform laut Kanzlei)';
  assert.deepEqual(cfg.goLiveSperren(ohneRegister, env, 'abnahme', MFA), [], 'ausdrücklich „entfällt“ ist zulässig');
  const mitUst = structuredClone(VOLLSTAENDIG); mitUst.legal.vatId = 'DE123456789';
  assert.deepEqual(cfg.goLiveSperren(mitUst, env, 'abnahme', MFA), [], 'gültige USt-IdNr. zulässig');
});

test('Gesperrte Website: noindex, Vorschauleiste, robots sperrt alles, keine Sitemap, kein kanonischer Link, kein Cookie', async () => {
  for (const p of ['/', '/impressum', '/datenschutz', '/kontakt', '/standort-anbieten']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers['x-robots-tag'] || '', /noindex/, `${p} X-Robots-Tag`);
    assert.match(r.body, /<meta name="robots" content="noindex, nofollow">/, `${p} meta robots`);
    assert.match(r.body, /class="preview-bar"/, `${p} Vorschauleiste`);
    assert.ok(!/rel="canonical"/.test(r.body), `${p} ohne kanonischen Link vor Go-live`);
    assert.equal(r.headers['set-cookie'], undefined, `${p} setzt kein Cookie`);
  }
  assert.match((await get('/robots.txt')).body, /Disallow: \/\n/);
  assert.equal((await get('/sitemap.xml')).status, 404);
});

test('Rechtsseiten: Betreiber aus brand.legal, vorläufig gekennzeichnet; offene Angaben sichtbar, nichts erfunden', async () => {
  const imp = (await get('/impressum')).body;
  const L = cfg.brand.legal;
  assert.match(imp, /Entwurf – Angaben werden nach Festlegung/);
  assert.match(imp, /Betreiberangaben vorläufig/, 'vorläufig bis aktueller Registerauszug');
  assert.ok(!/DOC-[A-Z]+-\d{4}|Entscheidung Dirk|AW-\d{8}/.test(imp + (await get('/datenschutz')).body), 'keine internen Kennungen öffentlich');
  assert.ok(imp.includes(`${cfg.brand.name} – ein Projekt der ${L.operator}`), 'Trägerzeile aus brand.legal');
  assert.match(imp, /Projektbezeichnung und keine eigene Gesellschaft/);
  assert.ok(imp.includes(L.register) && imp.includes(L.address[0]), 'Register und Anschrift aus brand.legal');
  assert.ok(imp.includes(L.representatives), 'Vertretung nur als Prüfplatzhalter');
  assert.match(L.representatives, /^\[/, 'Vertretung ist noch Platzhalter');
  assert.ok(!/STROMKAI (GmbH|UG|AG|GbR|Infrastruktur)|Speicher 01 GmbH/.test(imp), 'keine eigene STROMKAI-Gesellschaft behauptet');
  assert.ok(!/Umsatzsteuer-Identifikationsnummer/.test(imp), 'ohne Nachweis keine USt-IdNr.');
  assert.ok(!/mailto:/.test(imp), 'keine unbestätigte E-Mail');
  const ds = (await get('/datenschutz')).body;
  assert.match(ds, /Entwurf – vor Veröffentlichung/);
  assert.ok(ds.includes(L.operator), 'Verantwortlicher aus brand.legal');
  for (const t of [/Server-Protokolle/, /Cookies und Tracking/, /Art\. 28 DSGVO/, /Vercel Inc\./, /Microsoft Ireland Operations Limited/, /vorgesehen/, /Art\. 21/, /Art\. 77 DSGVO/, /noch festzulegen/]) assert.match(ds, t);
  const home = (await get('/')).body;
  assert.ok(home.includes(`${cfg.brand.name} – ein Projekt der ${L.operator}`), 'Trägerzeile in der Fußzeile');
  assert.ok(!/werden von eigenständigen Projektgesellschaften getragen/.test(home), 'keine Behauptung bestehender Projektgesellschaften in der Fußzeile');
  assert.match(home, /"@type":"WebSite"/, 'ohne bestätigte Betreiberangaben keine Organisation in strukturierten Daten');
  assert.match((await get('/investoren')).body, /kein Angebot und keine Aufforderung zum Erwerb/);
});

test('Weiterleitung: www und .com per 308 auf https://stromkai.de, Pfad bleibt erhalten; andere Hosts unberührt', async () => {
  for (const h of ['www.stromkai.de', 'stromkai.com', 'www.stromkai.com', 'WWW.STROMKAI.COM:443']) {
    const r = await get('/kontakt?anliegen=flaeche', h);
    assert.equal(r.status, 308, h);
    assert.equal(r.headers.location, 'https://stromkai.de/kontakt?anliegen=flaeche', h);
  }
  for (const h of ['stromkai.de', 'bess-energy-platform.vercel.app', 'bess-energy-platform-git-5ab2e8-supervisor77dw-debugs-projects.vercel.app', 'localhost', 'boese.example']) {
    const r = await get('/', h);
    assert.equal(r.status, 200, `${h} wird nicht umgeleitet`);
  }
  assert.equal(cfg.kanonischeWeiterleitung('stromkai.com', '/portal/login'), 'https://stromkai.de/portal/login');
});

test('Gegenprobe (nur im Speicher, Musterwerte): sind alle Bedingungen erfüllt, wird die Website indexierbar', async () => {
  const sicherung = { brand: structuredClone(cfg.brand), stage: cfg.config.stage, mfa: cfg.config.mfa };
  try {
    Object.assign(cfg.brand, structuredClone(VOLLSTAENDIG));
    cfg.config.stage = 'abnahme';
    cfg.config.mfa = MFA;
    assert.equal(cfg.isPublicLive(), true);
    const home = await get('/', 'stromkai.de');
    assert.equal(home.status, 200);
    assert.equal(home.headers['x-robots-tag'], undefined, 'kein noindex-Header');
    assert.ok(!/name="robots"/.test(home.body), 'kein meta robots');
    assert.ok(!/class="preview-bar"/.test(home.body), 'keine Vorschauleiste');
    assert.match(home.body, /<link rel="canonical" href="https:\/\/stromkai\.de\/">/);
    const robots = (await get('/robots.txt', 'stromkai.de')).body;
    assert.match(robots, /Disallow: \/portal\//); assert.match(robots, /Sitemap: https:\/\/stromkai\.de\/sitemap\.xml/);
    const sm = await get('/sitemap.xml', 'stromkai.de');
    assert.equal(sm.status, 200); assert.match(sm.body, /<loc>https:\/\/stromkai\.de\/impressum<\/loc>/); assert.ok(!/portal/.test(sm.body), 'Portal nicht in der Sitemap');
    assert.ok(!/class="draft"/.test((await get('/impressum', 'stromkai.de')).body), 'freigegebenes Impressum ohne Entwurfshinweis');
    const login = await get('/portal/login', 'stromkai.de');
    assert.match(login.headers['x-robots-tag'] || '', /noindex/, 'Portal bleibt auch nach Go-live noindex');
    assert.equal(cfg.isPreview(), true, 'Portal-Modus bleibt unverändert');
  } finally {
    for (const k of Object.keys(cfg.brand)) delete cfg.brand[k];
    Object.assign(cfg.brand, sicherung.brand); cfg.config.stage = sicherung.stage; cfg.config.mfa = sicherung.mfa;
  }
  assert.equal(cfg.isPublicLive(), false, 'nach der Gegenprobe wieder gesperrt');
});

test('Trennung: der öffentliche Schalter ändert weder Portal-Modus noch Echtdaten-Schalter', () => {
  assert.equal(cfg.config.mode, 'preview', 'Portal bleibt im Vorschau-/Synthetik-Modus');
  assert.equal(cfg.isPreview(), true);
  assert.equal(cfg.config.akquiseEchtdaten, false, 'Echtdaten-Akquise bleibt aus');
  assert.notEqual(cfg.config.blobPrefix, 'abnahme/', 'kein Zugriff auf den Produktionsbereich aus der QA-Stufe');
});

test('MFA-Standard: ohne BESS_MFA ist MFA aus – auch im Vercel-Production-Ziel', () => {
  const run = (env) => execFileSync(process.execPath, ['--input-type=module', '-e', "const { config } = await import('./src/config.mjs'); console.log(config.mfa);"], { cwd: ROOT, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env }, encoding: 'utf8' }).trim();
  assert.equal(run({}), 'aus');
  assert.equal(run({ VERCEL: '1', VERCEL_ENV: 'production', BESS_STAGE: 'abnahme' }), 'aus', 'Produktion ohne Variable: aus');
  assert.equal(run({ BESS_MFA: 'unsinn' }), 'aus', 'ungültiger Wert: aus');
});
