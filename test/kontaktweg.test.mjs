// Kontaktweg ohne Formulare für den öffentlichen Start (AW-20261114-GE-CLAUDE-STROMKAI-GOLIVE-VORBEREITUNG-022, G-11).
// Läuft wie die Produktion (Stufe "abnahme", Blob-Stellvertreter) und mit BESS_FORMULARE=1, aber OHNE bestätigten
// eigenen Produktionsspeicher: Die Formulare müssen trotzdem gesperrt bleiben und dürfen nichts in den Store schreiben.
// Aufruf: node --test test/kontaktweg.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
process.env.BESS_STAGE = 'abnahme';
process.env.VERCEL_ENV = 'production';
process.env.BESS_FORMULARE = '1'; // erster Schlüssel gesetzt, zweiter (eigener Produktionsspeicher) fehlt
delete process.env.BESS_EIGENER_PRODUKTIONSSPEICHER;
delete process.env.BESS_GATE;
process.env.BESS_ACCOUNTS = JSON.stringify({ users: [] });

// Blob-Stellvertreter: protokolliert jeden Schreibzugriff mit Pfad und Inhalt
const blobs = new Map(); const puts = []; let n = 0;
class Precondition extends Error { constructor() { super('Precondition failed'); this.name = 'BlobPreconditionFailedError'; } }
globalThis.__bessBlobSdk = {
  async put(path, body, o) { const data = Buffer.isBuffer(body) ? body : Buffer.from(body); puts.push({ path, data }); const cur = blobs.get(path); if (cur && o.allowOverwrite === false) throw new Error('exists'); if (o.ifMatch && (!cur || cur.etag !== o.ifMatch)) throw new Precondition(); const etag = `"e${++n}"`; blobs.set(path, { data, etag }); return { etag }; },
  async head(path) { const cur = blobs.get(path); if (!cur) { const e = new Error('Vercel Blob: The requested blob does not exist'); e.name = 'BlobError'; throw e; } return { etag: cur.etag }; },
  async get(path) { const cur = blobs.get(path); if (!cur) return null; return { statusCode: 200, stream: Readable.from([cur.data]), blob: { etag: `W/${cur.etag}-http` } }; },
};

const MARKE = 'Kontaktweg-Pruefperson-7f3a';
let server, base, cfg, formToken;
before(async () => {
  cfg = await import('../src/config.mjs');
  ({ formToken } = await import('../src/lib/http.mjs'));
  const { vercelHandler } = await import('../server.mjs');
  server = createServer((req, res) => vercelHandler(req, res).catch(() => { if (!res.headersSent) { res.statusCode = 503; res.end(); } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await fetch(base + '/'); // Store initialisieren
});
after(() => server?.close());

const PUBLIC = ['/', '/unternehmen', '/technologie', '/standortentwicklung', '/grundstueckseigentuemer', '/standort-anbieten', '/investoren', '/kommunen', '/projekte', '/kontakt', '/impressum', '/datenschutz', '/kontakt?anliegen=flaeche&region=nord', '/standort-anbieten?region=nord'];
const zustand = () => { const s = [...blobs.entries()].find(([p]) => p.endsWith('state/db.json')); return s ? JSON.parse(s[1].data.toString('utf8')) : null; };
const allesGeschrieben = () => puts.map((x) => x.data.toString('latin1')).join('\n');

test('Schalter: Formulare standardmäßig aus; in der Produktion nur mit beiden Schlüsseln', () => {
  assert.equal(cfg.config.stage, 'abnahme');
  assert.equal(cfg.config.formulare, false, 'BESS_FORMULARE=1 allein reicht in der Produktion nicht');
  const run = (env) => execFileSync(process.execPath, ['--input-type=module', '-e', "const { config } = await import('./src/config.mjs'); console.log(config.formulare);"], { cwd: ROOT, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env }, encoding: 'utf8' }).trim();
  assert.equal(run({}), 'false', 'lokal ohne Schalter aus');
  assert.equal(run({ BESS_FORMULARE: '1' }), 'true', 'QA/lokal mit Schalter an (synthetische Daten)');
  assert.equal(run({ BESS_STAGE: 'abnahme', BESS_FORMULARE: '1' }), 'false');
  assert.equal(run({ BESS_STAGE: 'abnahme', BESS_EIGENER_PRODUKTIONSSPEICHER: '1' }), 'false', 'zweiter Schlüssel allein reicht nicht');
  assert.equal(run({ BESS_STAGE: 'abnahme', BESS_FORMULARE: '1', BESS_EIGENER_PRODUKTIONSSPEICHER: '1' }), 'true');
});

test('Öffentliche Seiten vollständig nutzbar, ohne Formular und ohne unbestätigte E-Mail-Adresse', async () => {
  for (const p of PUBLIC) {
    const r = await fetch(base + p);
    const body = await r.text();
    assert.equal(r.status, 200, p);
    assert.ok(!/<form[^>]+action="\/(kontakt|standort-anbieten)"/.test(body), `${p}: kein Formular`);
    assert.ok(!/name="_t"/.test(body), `${p}: kein Formular-Token`);
    assert.ok(!/info@stromkai\.de|vertrieb@stromkai\.de/.test(body), `${p}: keine unbestätigte Adresse`);
    assert.ok(!/mailto:/.test(body), `${p}: kein mailto ohne bestätigte Adresse`);
    assert.match(body, /noindex/, `${p}: Go-live-Sperre unverändert`);
  }
  for (const p of ['/kontakt', '/standort-anbieten']) {
    const body = await (await fetch(base + p)).text();
    assert.match(body, /Kontakt per E-Mail/);
    assert.match(body, /werden gerade eingerichtet/);
    assert.match(body, /Onlineformular ist derzeit nicht aktiv/);
  }
  assert.match(await (await fetch(base + '/datenschutz')).text(), /Onlineformulare dieser Website sind derzeit nicht aktiv/);
  assert.equal((await fetch(base + '/danke?k=kontakt')).status, 404, 'keine Eingangsbestätigung ohne Formular');
});

test('Direkte Aufrufe umgehen die Sperre nicht: 403, nichts gespeichert, kein Upload', async () => {
  const vorher = { puts: puts.length, anfragen: zustand()?.inquiries?.length ?? 0 };
  const t = formToken();
  const felder = { _t: t, name: MARKE, email: 'pruef@beispiel.invalid', phone: '0431 000', nachricht: MARKE, lage: 'Musterort', dsgvo: 'ja', anliegen: 'flaeche' };
  const antworten = [];
  antworten.push(await fetch(base + '/kontakt', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(felder).toString() }));
  const fd = new FormData(); for (const [k, v] of Object.entries(felder)) fd.append(k, v);
  fd.append('datei', new Blob([Buffer.from(`%PDF-1.4 ${MARKE}`)], { type: 'application/pdf' }), 'lageplan.pdf');
  antworten.push(await fetch(base + '/standort-anbieten', { method: 'POST', redirect: 'manual', body: fd }));
  antworten.push(await fetch(base + '/kontakt', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' }, body: JSON.stringify(felder) }));
  antworten.push(await fetch(base + '/standort-anbieten?region=nord', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(felder).toString() }));
  for (const r of antworten) {
    assert.equal(r.status, 403);
    const b = await r.text();
    assert.match(b, /nicht übermittelt und nicht gespeichert/);
    assert.ok(!b.includes(MARKE), 'Eingaben werden nicht zurückgespiegelt');
  }
  for (const m of ['PUT', 'PATCH', 'DELETE']) assert.equal((await fetch(base + '/kontakt', { method: m, body: 'x' })).status, 405, m);
  assert.equal(puts.length, vorher.puts, 'kein Schreibzugriff auf den Blob-Store');
  assert.equal(zustand()?.inquiries?.length ?? 0, vorher.anfragen, 'keine neue Anfrage');
  assert.ok(!allesGeschrieben().includes(MARKE), 'Prüfmarke nirgends im Store');
  assert.ok(!puts.slice(vorher.puts).some((x) => /\/files\//.test(x.path)), 'kein Datei-Upload nach den Anfragen');
  assert.ok(puts.every((x) => x.path.startsWith('abnahme/')), 'Produktionsstufe schreibt nur in ihren Bereich');
});

test('Bestätigte Adressen erscheinen als Kontaktweg; Impressums-E-Mail muss bestätigt sein', async () => {
  const sicherung = structuredClone(cfg.brand.contact);
  try {
    cfg.brand.contact.adressen = [{ email: 'info@stromkai.de', zweck: 'Allgemein', bestaetigt: true }, { email: 'vertrieb@stromkai.de', zweck: 'Flächen', bestaetigt: false }];
    assert.deepEqual(cfg.kontaktAdressen().map((a) => a.email), ['info@stromkai.de']);
    const k = await (await fetch(base + '/kontakt')).text();
    assert.match(k, /href="mailto:info@stromkai\.de\?subject=/);
    assert.ok(!/vertrieb@stromkai\.de/.test(k), 'unbestätigte Adresse bleibt verborgen');
    const s = await (await fetch(base + '/standort-anbieten')).text();
    assert.match(s, /mailto:info@stromkai\.de/, 'ohne bestätigtes vertrieb@ fällt die Flächenseite auf info@ zurück');
    cfg.brand.contact.adressen[1].bestaetigt = true;
    assert.match(await (await fetch(base + '/standort-anbieten')).text(), /href="mailto:vertrieb@stromkai\.de\?subject=/, 'Flächenangebote an vertrieb@');
    const b = { ...structuredClone(cfg.brand), contact: { ...cfg.brand.contact, email: 'info@stromkai.de' } };
    assert.ok(!cfg.goLiveSperren(b, { BESS_OEFFENTLICH: '1' }, 'abnahme').some((x) => /Kontakt-E-Mail/.test(x)), 'bestätigte Impressums-E-Mail');
    b.contact.adressen = b.contact.adressen.map((a) => ({ ...a, bestaetigt: false }));
    assert.ok(cfg.goLiveSperren(b, { BESS_OEFFENTLICH: '1' }, 'abnahme').some((x) => /nicht als empfangsbereit bestätigt/.test(x)), 'unbestätigte Impressums-E-Mail sperrt');
  } finally { cfg.brand.contact = sicherung; }
  assert.ok(!/mailto:/.test(await (await fetch(base + '/kontakt')).text()), 'nach dem Test wieder ohne Adresse');
});

test('Portal und Sicherheitsregeln unverändert: Login geschützt, Website-Go-live-Sperre aktiv', async () => {
  const r = await fetch(base + '/portal/login');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('x-robots-tag'), /noindex, nofollow, noarchive/);
  assert.equal((await fetch(base + '/portal/anfragen', { redirect: 'manual' })).status, 303, 'Board ohne Anmeldung nicht erreichbar');
  assert.equal(cfg.isPublicLive(), false);
  assert.match(await (await fetch(base + '/robots.txt')).text(), /Disallow: \/\n/);
});
