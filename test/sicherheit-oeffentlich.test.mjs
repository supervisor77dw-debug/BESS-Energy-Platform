// Technische Sicherheitsprüfung der öffentlichen Angriffsfläche vor dem Go-live
// (AW-20261114-GE-CLAUDE-STROMKAI-GOLIVE-VORBEREITUNG-022). Produktionsstufe "abnahme" mit Blob-Stellvertreter.
// Aufruf: node --test test/sicherheit-oeffentlich.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
process.env.BESS_STAGE = 'abnahme';
process.env.VERCEL_ENV = 'production';
process.env.VERCEL = '1';
process.env.BESS_OEFFENTLICH = '1'; // Go-live-Schalter gesetzt: darf nichts Internes freischalten
for (const k of ['BESS_GATE', 'BESS_FORMULARE', 'BESS_EIGENER_PRODUKTIONSSPEICHER', 'BESS_AKQUISE_ECHTDATEN', 'BESS_AKTIVE_AKQUISE', 'BESS_MODE', 'BESS_QA_ADMIN_SPIEGEL', 'BESS_BLOB_PREFIX', 'BESS_DATA_DIR']) delete process.env[k];
const { hashPassword } = await import('../src/lib/auth.mjs');
process.env.BESS_ACCOUNTS = JSON.stringify({ users: [{ id: 'u-admin', email: 'dirk@stromkai-abnahme.invalid', pw: hashPassword(randomBytes(9).toString('base64url')) }, { id: 'u-markus', email: 'markus@stromkai-abnahme.invalid', pw: hashPassword(randomBytes(9).toString('base64url')) }] });

const blobs = new Map(); const pfade = new Set(); let n = 0;
class Precondition extends Error { constructor() { super('Precondition failed'); this.name = 'BlobPreconditionFailedError'; } }
globalThis.__bessBlobSdk = {
  async put(path, body, o) { pfade.add(path); const cur = blobs.get(path); if (cur && o.allowOverwrite === false) throw new Error('exists'); if (o.ifMatch && (!cur || cur.etag !== o.ifMatch)) throw new Precondition(); const etag = `"e${++n}"`; blobs.set(path, { data: Buffer.isBuffer(body) ? body : Buffer.from(body), etag }); return { etag }; },
  async head(path) { pfade.add(path); const cur = blobs.get(path); if (!cur) { const e = new Error('Vercel Blob: The requested blob does not exist'); e.name = 'BlobError'; throw e; } return { etag: cur.etag }; },
  async get(path) { pfade.add(path); const cur = blobs.get(path); if (!cur) return null; return { statusCode: 200, stream: Readable.from([cur.data]), blob: { etag: `W/${cur.etag}-http` } }; },
};

let server, port, cfg;
before(async () => {
  cfg = await import('../src/config.mjs');
  const { vercelHandler } = await import('../server.mjs');
  server = createServer((req, res) => vercelHandler(req, res).catch(() => { if (!res.headersSent) { res.statusCode = 503; res.end(); } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  await roh('GET', '/');
});
after(() => server?.close());

// Rohanfrage ohne URL-Normalisierung (für Pfadausbrüche)
const roh = (method, path, headers = {}) => new Promise((resolve, reject) => {
  const r = request({ host: '127.0.0.1', port, path, method, headers: { host: 'stromkai.de', ...headers } }, (res) => {
    let body = ''; res.setEncoding('utf8'); res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  r.on('error', reject); r.end();
});

const OEFFENTLICH = ['/', '/unternehmen', '/technologie', '/standortentwicklung', '/grundstueckseigentuemer', '/standort-anbieten', '/investoren', '/kommunen', '/projekte', '/kontakt', '/impressum', '/datenschutz', '/robots.txt', '/healthz', '/gibt-es-nicht'];
// Interne Inhalte und Geheimnisse, die nie auf öffentlichen Seiten erscheinen dürfen (Muster wie test/abnahme.test.mjs)
const INTERN = ['Demo-Standort', 'Musterkreis', 'DEMO-N0', 'Speicherprojekt Nord', 'CAPEX', 'Eigentümer A', 'Investor A', 'Demo-Gemarkung', 'Flurstück 12/4', 'scrypt$', 'sessionKey', 'Vorschau!Speicher', 'bess-vorschau.invalid', 'stromkai-abnahme.invalid', 'BLOB_READ_WRITE', 'BESS_ACCOUNTS', 'qa-020', 'state/db.json', '\n    at ', 'at async', 'node:internal'];
const PORTAL_DATEIEN = execFileSync('git', ['ls-files', 'src/portal', 'src/lib'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.mjs'));
const PORTAL_ROUTEN = [...new Set(PORTAL_DATEIEN.flatMap((f) => readFileSync(join(ROOT, f), 'utf8').match(/'\/portal(\/[a-z0-9/_-]*)?'/g) || []).map((x) => x.slice(1, -1)))];
// ohne Anmeldung zulässig (Anmeldung, einmalige Links, Abmelden) – zeigen keine internen Daten
const OHNE_ANMELDUNG = new Set(['/portal/login', '/portal/anmelden', '/portal/aktivieren', '/portal/passwort-festlegen', '/portal/wiederherstellen']);

test('Öffentliche Seiten: keine internen Projekt-, Finanz-, Eigentümer- oder Kontodaten, keine Geheimnisse', async () => {
  for (const p of OEFFENTLICH) {
    const r = await roh('GET', p);
    assert.ok([200, 404].includes(r.status), `${p}: ${r.status}`);
    for (const s of INTERN) assert.ok(!r.body.includes(s), `${p} enthält „${s}“`);
  }
});

test(`Alle ${'Portalrouten'} ohne Anmeldung: Weiterleitung zum Login oder Abweisung, nie interne Inhalte`, async () => {
  assert.ok(PORTAL_ROUTEN.length >= 40, `Routen erkannt: ${PORTAL_ROUTEN.length}`);
  const ergebnis = {};
  for (const p of PORTAL_ROUTEN) {
    for (const m of ['GET', 'POST']) {
      const r = await roh(m, p, m === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '0' } : {});
      ergebnis[`${m} ${p}`] = r.status;
      if (r.status === 200) assert.ok(OHNE_ANMELDUNG.has(p), `${m} ${p} liefert 200 ohne Anmeldung`);
      else assert.ok([302, 303, 400, 401, 403, 404, 405, 409, 410, 422, 429].includes(r.status), `${m} ${p}: ${r.status}`);
      if (r.status === 303 || r.status === 302) assert.match(r.headers.location || '', /^\/portal\/login|^\/portal$|^\/portal\/passwort-festlegen$/, `${m} ${p} → ${r.headers.location}`);
      for (const s of INTERN) assert.ok(!r.body.includes(s), `${m} ${p} enthält „${s}“`);
      assert.match(r.headers['x-robots-tag'] || '', /noindex/, `${m} ${p} noindex`);
    }
  }
  assert.equal(ergebnis['GET /portal/admin'], 303);
  assert.equal(ergebnis['GET /portal/admin/benutzer'], 303);
});

test('Pfadausbrüche und Interna über /static und /api nicht erreichbar', async () => {
  for (const p of ['/static/../brand.json', '/static/..%2fbrand.json', '/static/%2e%2e/server.mjs', '/static/..%5cserver.mjs', '/static/../.env', '/static/../package.json', '/static/../data/seed.mjs', '/api/index', '/api/index.mjs', '/.env', '/brand.json', '/server.mjs', '/package.json', '/.git/config', '/data/seed.mjs']) {
    const r = await roh('GET', p);
    assert.ok([400, 404].includes(r.status), `${p}: ${r.status}`);
    assert.ok(!/"dependencies"|BESS_|createServer|\[core\]|"legal"/.test(r.body), `${p} gibt Dateiinhalt preis`);
  }
});

test('Sicherheitsheader auf öffentlichen Seiten und im Portal; HSTS und sichere Cookies auf Vercel', async () => {
  for (const p of ['/', '/impressum', '/portal/login']) {
    const r = await roh('GET', p);
    assert.match(r.headers['content-security-policy'] || '', /default-src 'self'/, p);
    assert.match(r.headers['content-security-policy'] || '', /frame-ancestors 'none'/, p);
    assert.equal(r.headers['x-frame-options'], 'DENY', p);
    assert.equal(r.headers['x-content-type-options'], 'nosniff', p);
    assert.match(r.headers['strict-transport-security'] || '', /max-age=31536000/, p);
    assert.match(r.headers['referrer-policy'] || '', /strict-origin/, p);
  }
  const login = await roh('GET', '/portal/login');
  for (const c of [].concat(login.headers['set-cookie'] || [])) assert.match(c, /HttpOnly/i, c);
  assert.equal(cfg.config.secureCookies, true);
});

test('Fehlerbehandlung: unbekannte Methoden und Pfade ohne interne Details', async () => {
  for (const [m, p] of [['DELETE', '/'], ['PUT', '/impressum'], ['PATCH', '/kontakt'], ['GET', '/%E0%A4%A'], ['GET', '/portal/dokumente/%00']]) {
    const r = await roh(m, p);
    if (p.startsWith('/portal/') && r.status === 303) assert.match(r.headers.location, /^\/portal\/login/, `${m} ${p} → Login`);
    else assert.ok(r.status >= 400 && r.status < 500, `${m} ${p}: ${r.status}`);
    for (const s of ['\n    at ', 'at async', 'node:internal', 'TypeError', 'ReferenceError', ROOT.replace(/\\/g, '/')]) assert.ok(!r.body.includes(s), `${m} ${p} enthält „${s}“`);
  }
});

test('Datentrennung: Produktionsstufe greift nur auf abnahme/ zu, nie auf QA-Bereiche', () => {
  assert.ok(pfade.size > 0);
  for (const p of pfade) assert.ok(p.startsWith('abnahme/'), `Zugriff außerhalb abnahme/: ${p}`);
});

test('Go-live-Schalter schaltet keine internen Funktionen frei (Echtdaten, Formulare, aktive Akquise, QA-Spiegel, Portalmodus)', () => {
  assert.equal(process.env.BESS_OEFFENTLICH, '1');
  assert.equal(cfg.config.akquiseEchtdaten, false);
  assert.equal(cfg.config.formulare, false);
  assert.equal(cfg.config.aktiveAkquise, false);
  assert.equal(cfg.config.qaSpiegel, false);
  assert.equal(cfg.config.mode, 'preview', 'Portal bleibt im Demo-/Synthetik-Modus');
  assert.equal(cfg.config.previewHelpers, false, 'keine Demo-Zugänge');
  const run = (env) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', "const { config } = await import('./src/config.mjs'); console.log(JSON.stringify({ e: config.akquiseEchtdaten, f: config.formulare, a: config.aktiveAkquise, m: config.mode }));"], { cwd: ROOT, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env }, encoding: 'utf8' }).trim());
  assert.deepEqual(run({ BESS_STAGE: 'abnahme', BESS_OEFFENTLICH: '1' }), { e: false, f: false, a: false, m: 'preview' });
});

test('Repository: keine Geheimnisse oder Zugangsdaten in versionierten Dateien', () => {
  const dateien = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => f && !/^src\/vendor\/|\.(png|jpg|jpeg|webp|avif|ico|woff2|pdf)$/.test(f));
  const muster = [/vercel_blob_rw_[A-Za-z0-9]{8,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/, /\bsk-[A-Za-z0-9]{20,}/, /\bghp_[A-Za-z0-9]{30,}/, /BLOB_READ_WRITE_TOKEN\s*=\s*["']?vercel/];
  const funde = [];
  for (const f of dateien) { let t; try { t = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; } for (const m of muster) if (m.test(t)) funde.push(`${f}: ${m}`); }
  assert.deepEqual(funde, []);
  assert.ok(!dateien.some((f) => /(^|\/)\.env(\.|$)|\.pem$|\.key$/.test(f)), 'keine .env-, .pem- oder .key-Dateien versioniert');
});
