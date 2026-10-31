// QA-Betrieb auf dem gemeinsamen Blob-Speicher (AW-STROMKAI-20261031-CONSOLIDATION-ACQUISITION-020):
// Datenisolierung (R-1), fehlende Dateien (R-2), idempotentes Löschen (R-3), Protokoll ohne Personenbezug (R-4) und
// Anmeldung über die bestehende Administrationsidentität der Produktion (QA-Identitätsspiegel, nur lesend).
// Lokaler Stellvertreter der Blob-API; jeder Schreib- und Löschzugriff wird mitgeschrieben. Aufruf: node --test test/qa-isolation.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
Object.assign(process.env, { VERCEL: '1', VERCEL_ENV: 'preview', BESS_QA_ADMIN_SPIEGEL: '1', BESS_BLOB_PREFIX: 'qa-020/', BESS_PREVIEW_HELPERS: '0' });
for (const k of ['BESS_STAGE', 'BESS_GATE', 'BESS_MFA', 'BESS_DATA_DIR']) delete process.env[k];
const { hashPassword } = await import('../src/lib/auth.mjs');

// ---- Stellvertreter der @vercel/blob-API: get liefert für fehlende Objekte null (wie das echte SDK) ----
const blobs = new Map(); const schreib = []; let n = 0;
const notFound = () => { const e = new Error('Vercel Blob: The requested blob does not exist'); e.name = 'BlobNotFoundError'; return e; };
globalThis.__bessBlobSdk = {
  async put(path, body, o) {
    schreib.push(['put', path]);
    const cur = blobs.get(path);
    if (cur && o.allowOverwrite === false) throw new Error('This blob already exists');
    if (o.ifMatch && (!cur || cur.etag !== o.ifMatch)) { const e = new Error('Precondition failed'); e.name = 'BlobPreconditionFailedError'; throw e; }
    const etag = `"e${++n}"`; blobs.set(path, { data: Buffer.isBuffer(body) ? body : Buffer.from(body), etag });
    return { etag };
  },
  async head(path) { const c = blobs.get(path); if (!c) throw notFound(); return { etag: c.etag }; },
  async get(path) { const c = blobs.get(path); return c ? { statusCode: 200, stream: Readable.from([c.data]), blob: { etag: c.etag } } : null; },
  async del(path) { schreib.push(['del', path]); if (Array.isArray(path)) throw new Error('Sammellöschung'); if (!blobs.has(path)) throw notFound(); blobs.delete(path); },
};

// Produktionsbereich (Stufe 'abnahme'): bestehende Administrationsidentität, ein Nicht-Admin, ein gesperrter Admin, eine Datei
const PROD_PW = randomBytes(12).toString('base64url');
const PROD = { users: [
  { id: 'u-admin', email: 'dirk@stromkai-prod.invalid', name: 'Dirk (Produktion)', role: 'admin', active: true, pw: hashPassword(PROD_PW) },
  { id: 'u-markus', email: 'markus@stromkai-prod.invalid', name: 'Markus', role: 'vertrieb_nord', active: true, pw: hashPassword(PROD_PW) },
  { id: 'u-alt', email: 'alt@stromkai-prod.invalid', name: 'Alt', role: 'admin', active: false, pw: hashPassword(PROD_PW) },
], projects: [], inquiries: [{ id: 'inq-prod', name: 'Echter Eigentümer' }] };
blobs.set('abnahme/state/db.json', { data: Buffer.from(JSON.stringify(PROD)), etag: '"prod-1"' });
blobs.set('abnahme/files/in-prod.pdf', { data: Buffer.from('%PDF prod'), etag: '"prod-2"' });
blobs.set('files/in-qa-alt.pdf', { data: Buffer.from('%PDF qa-alt'), etag: '"qa-1"' }); // bisheriger QA-Bereich (Wurzel)
const fremd = () => [...blobs].filter(([k]) => !k.startsWith('qa-020/')).map(([k, v]) => `${k}=${v.etag}:${v.data.length}`).sort().join('|');
const FREMD_VORHER = fremd();

// QA-Zugänge (eigene Provisionierung der Vorschau) – der Spiegel ergänzt sie, ersetzt sie nicht
process.env.BESS_ACCOUNTS = JSON.stringify({ users: [{ id: 'u-admin', email: 'dirk@bess-vorschau.invalid', pw: hashPassword(randomBytes(12).toString('base64url')), mustChangePassword: false }], gate: [] });

let server, base, store, config;
before(async () => {
  ({ config } = await import('../src/config.mjs'));
  store = await import('../src/lib/store.mjs');
  const { vercelHandler } = await import('../server.mjs');
  server = createServer((req, res) => vercelHandler(req, res).catch(() => { if (!res.headersSent) { res.statusCode = 503; res.end('nicht verfügbar'); } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

class C {
  jar = {};
  async req(path, opts = {}) {
    const r = await fetch(base + path, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) this.jar[k] = v; else delete this.jar[k]; }
    return r;
  }
  async text(p) { return (await this.req(p)).text(); }
  async form(p, f) { return this.req(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(f).toString() }); }
  async login(email, password) { const t = /name="_t" value="([^"]+)"/.exec(await this.text('/portal/login'))[1]; return this.form('/portal/anmelden', { _t: t, email, password }); }
  async csrf(p) { return /name="_csrf" value="([^"]+)"/.exec(await this.text(p))?.[1]; }
}
const db = () => store.getDb();

test('Konfiguration: Stufe qa, eigener Bereich qa-020/, keine Zusatzschranke, Spiegel aktiv', () => {
  assert.equal(config.stage, 'qa');
  assert.equal(config.blobPrefix, 'qa-020/');
  assert.equal(config.qaSpiegel, true);
  assert.equal(config.gate, false, 'keine zusätzliche Anmeldestufe');
});

test('Spiegel: Anmeldung mit der bestehenden Administrationsidentität der Produktion, ohne Passwortübernahme', async () => {
  const c = new C();
  const r = await c.login('Dirk@stromkai-prod.invalid'.toLowerCase(), PROD_PW);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/portal/zentrale');
  assert.equal((await c.req('/portal/anfragen')).status, 200);
  const u = db().users.find((x) => x.id === 'spiegel-u-admin');
  assert.ok(u && u.active && u.role === 'admin');
  assert.equal(u.pw, null, 'kein Passwort-Hash der Produktion in der QA');
  assert.equal(u.spiegel.quelle, 'abnahme');
  assert.ok(!JSON.stringify(db()).includes(PROD.users[0].pw), 'Hash nirgends im QA-Zustand');
  assert.ok(db().audit.some((e) => e.event === 'anmeldung' && e.spiegel === 'abnahme'));
  // Passwortänderung wirkt nicht auf die Produktionsidentität
  const csrf = await c.csrf('/portal/konto');
  assert.equal((await c.form('/portal/konto', { _csrf: csrf, current: PROD_PW, neu: 'Neu-Passwort!2026x', neu2: 'Neu-Passwort!2026x' })).status, 409);
  assert.equal(fremd(), FREMD_VORHER, 'Produktion unverändert');
});

test('Spiegel: falsches Passwort, Nicht-Admin und gesperrter Admin werden nicht gespiegelt', async () => {
  assert.equal((await new C().login('dirk@stromkai-prod.invalid', 'falsch')).status, 401);
  assert.equal((await new C().login('markus@stromkai-prod.invalid', PROD_PW)).status, 401, 'nur Rolle admin');
  assert.equal((await new C().login('alt@stromkai-prod.invalid', PROD_PW)).status, 401, 'nur aktive Konten');
  assert.ok(!db().users.some((x) => x.id === 'spiegel-u-markus' || x.id === 'spiegel-u-alt'));
  // Spiegelkonto hat kein lokales Passwort: auch ein leeres Passwort öffnet es nicht
  assert.equal((await new C().login('dirk@stromkai-prod.invalid', '')).status, 401);
});

test('Datenisolierung: kompletter Akquiseablauf mit Upload und Löschung schreibt nur in qa-020/', async () => {
  // Flächenanfrage mit Lageplan
  const html = await (await fetch(base + '/standort-anbieten')).text();
  const t = /name="_t" value="([^"]+)"/.exec(html)[1];
  await new Promise((r) => setTimeout(r, 1600));
  const f = new FormData();
  Object.entries({ _t: t, name: 'QA Test', email: 'qa@example.invalid', lage: 'Testort', plz: '24100', nutzung: 'Acker', umspannwerk: 'unter 1 km', dsgvo: 'ja' }).forEach(([k, v]) => f.set(k, v));
  f.set('datei', new Blob([Buffer.from('%PDF-1.4 qa')], { type: 'application/pdf' }), 'plan.pdf');
  assert.equal((await fetch(base + '/standort-anbieten', { method: 'POST', body: f, redirect: 'manual' })).status, 303);
  const c = new C(); await c.login('dirk@stromkai-prod.invalid', PROD_PW);
  const i = db().inquiries.at(-1);
  assert.ok(blobs.has(`qa-020/files/${i.fileId}`));
  const auditNeu = db().audit.find((e) => e.event === 'anfrage_flaeche' && e.anfrage === i.id);
  assert.ok(auditNeu && !('lage' in auditNeu), 'R-4: Protokoll ohne Ort');
  const csrf = await c.csrf(`/portal/anfragen/${i.id}`);
  await c.form(`/portal/anfragen/${i.id}/bearbeiten`, { _csrf: csrf, status: 'abgeschlossen' });
  assert.equal((await c.form(`/portal/anfragen/${i.id}/anonymisieren`, { _csrf: csrf })).status, 303);
  assert.ok(!blobs.has(`qa-020/files/${i.fileId ?? 'x'}`));
  for (const [art, p] of schreib) assert.ok(p.startsWith('qa-020/'), `${art} außerhalb des QA-Bereichs: ${p}`);
  assert.ok(schreib.some(([a]) => a === 'del'), 'Löschung ausgeführt');
  assert.equal(fremd(), FREMD_VORHER, 'Produktion und bisheriger QA-Bereich byte- und ETag-gleich');
  assert.ok(schreib.length < 80, `keine Massenschreibzugriffe (${schreib.length})`);
});

test('R-2/R-3: fehlende Datei → 404 statt Fehler; Löschen fehlender Dateien ist idempotent', async () => {
  const c = new C(); await c.login('dirk@stromkai-prod.invalid', PROD_PW);
  const d = db().documents[0];
  blobs.delete(`qa-020/files/${d.file}`);
  assert.equal((await c.req(`/portal/dokumente/${d.id}/download`)).status, 404);
  assert.equal(await store.getFile('in-gibtesnicht.pdf'), null);
  await store.deleteFile('in-gibtesnicht.pdf'); // keine Ausnahme
});

test('R-1: Dateifunktionen weisen fremde Bereiche und Pfadausbrüche ab', async () => {
  for (const bad of ['../state/db.json', 'abnahme/files/in-prod.pdf', 'x/y.pdf', '..', 'state/db.json', '']) {
    await assert.rejects(store.deleteFile(bad), /Ungültiger Dateiname/, bad);
    await assert.rejects(store.getFile(bad), /Ungültiger Dateiname/, bad);
    await assert.rejects(store.putFile(bad, Buffer.from('x')), /Ungültiger Dateiname/, bad);
  }
  assert.equal(fremd(), FREMD_VORHER);
});

test('R-1: Stufen- und Präfixregeln fail closed (eigene Prozesse)', () => {
  const run = (env, code) => execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env }, encoding: 'utf8' }).trim();
  const cfg = "const { config } = await import('./src/config.mjs'); console.log(JSON.stringify({ s: config.stage, p: config.blobPrefix, q: config.qaSpiegel, g: config.gate }));";
  // Produktion: immer abnahme/, Spiegel nie aktiv, auch mit gesetztem Schalter und QA-Präfix
  assert.deepEqual(JSON.parse(run({ VERCEL: '1', VERCEL_ENV: 'production', BESS_STAGE: 'abnahme', BESS_GATE: '0', BESS_QA_ADMIN_SPIEGEL: '1', BESS_BLOB_PREFIX: 'qa-020/' }, cfg)), { s: 'abnahme', p: 'abnahme/', q: false, g: false });
  // Preview mit BESS_STAGE=qa und Spiegelschalter, aber VERCEL_ENV=production: kein Spiegel
  assert.equal(JSON.parse(run({ VERCEL: '1', VERCEL_ENV: 'production', BESS_STAGE: 'qa', BESS_QA_ADMIN_SPIEGEL: '1' }, cfg)).q, false);
  // QA ohne Spiegel: Schranke bleibt wie bisher aktiv
  assert.equal(JSON.parse(run({ VERCEL: '1', VERCEL_ENV: 'preview' }, cfg)).g, true);
  // QA darf keinen Produktionsbereich als Präfix wählen
  for (const p of ['abnahme/', 'abnahme-kopie/', '../', 'Qa/']) assert.throws(() => run({ VERCEL: '1', VERCEL_ENV: 'preview', BESS_BLOB_PREFIX: p }, cfg), undefined, p);
  // Speicher: Produktionsbereich in Stufe qa und QA-Bereich in Stufe abnahme werden abgewiesen
  const open = (prefix) => `globalThis.__bessBlobSdk = { head: async () => { throw new Error('not found'); }, get: async () => null, put: async () => ({}) }; const s = await import('./src/lib/store.mjs'); try { await s.openStore({ kind: 'blob', prefix: '${prefix}', bootstrap: async () => ({ db: {}, files: [] }) }); console.log('offen'); } catch (e) { console.log(e.message); }`;
  assert.match(run({ VERCEL_ENV: 'preview' }, open('abnahme/')), /passt nicht zur Stufe qa/);
  assert.match(run({ VERCEL_ENV: 'production', BESS_STAGE: 'abnahme' }, open('qa-020/')), /passt nicht zur Stufe abnahme/);
});
