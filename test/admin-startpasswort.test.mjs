// Einmaliges administratives Startpasswort ohne Pflichtwechsel (AW-20261029-GE-CLAUDE-STROMKAI-ADMIN-SSO-RECOVERY-014).
// Isoliertes Testkonto auf der Abnahmestufe mit Blob-Stellvertreter (gleicher Speicherweg wie Produktion):
// Startpasswort setzen → anmelden → Dashboard → abmelden → erneut anmelden → „neue Bereitstellung“ (neuer Abgleich, neuer
// Instanzzustand aus dem Blob) → weiterhin unverändert; einmaliger Reset wird nie erneut angewendet.
// Aufruf: node --test test/admin-startpasswort.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';

process.env.BESS_STAGE = 'abnahme';
delete process.env.BESS_MFA; // Abnahmephase: keine Pflicht-MFA
process.env.VERCEL_ENV = 'production';
delete process.env.BESS_GATE;
delete process.env.BESS_RECOVERY;
const { hashPassword } = await import('../src/lib/auth.mjs');

const blobs = new Map(); let n = 0;
class Precondition extends Error { constructor() { super('Precondition failed'); this.name = 'BlobPreconditionFailedError'; } }
globalThis.__bessBlobSdk = {
  async put(path, body, o) { const cur = blobs.get(path); if (cur && o.allowOverwrite === false) throw new Error('exists'); if (o.ifMatch && (!cur || cur.etag !== o.ifMatch)) throw new Precondition(); const etag = `"e${++n}"`; blobs.set(path, { data: String(body), etag }); return { pathname: path, etag }; },
  async head(path) { const cur = blobs.get(path); if (!cur) { const e = new Error('Vercel Blob: The requested blob does not exist'); e.name = 'BlobError'; throw e; } return { etag: cur.etag }; },
  async get(path) { const cur = blobs.get(path); if (!cur) return null; return { statusCode: 200, stream: Readable.from([cur.data]), blob: { etag: `W/${cur.etag}-http` } }; },
};
const zustand = () => JSON.parse(blobs.get('abnahme/state/db.json').data);
const adminIm = (st) => st.users.find((u) => u.id === 'u-admin');

// Ausgangslage wie öffentlich: Testkonto mit selbst gesetztem Passwort unter Kunstadresse, Zweitkonto mit unbenutztem Start
const alt = { admin: 'Alt-Eigenes-Passwort-7!', markus: randomBytes(9).toString('base64url') };
const TEMP = `Tmp-${randomBytes(12).toString('base64url')}-4x`;
const ADRESSE = 'leitung@stromkai-test.example';
const accounts = (o = {}) => JSON.stringify({ users: [
  { id: 'u-admin', email: o.adminEmail || 'admin@stromkai-abnahme.invalid', pw: o.adminPw || hashPassword(alt.admin), ...(o.adminExtra || {}) },
  { id: 'u-markus', email: 'markus@stromkai-abnahme.invalid', pw: o.markusPw || hashPassword(alt.markus) }], rev: o.rev || 'r0' });
const MARKUS_PW = hashPassword(alt.markus);
process.env.BESS_ACCOUNTS = accounts({ markusPw: MARKUS_PW });

let server, base;
before(async () => {
  const { vercelHandler } = await import('../server.mjs');
  server = createServer((req, res) => vercelHandler(req, res).catch(() => { if (!res.headersSent) { res.statusCode = 503; res.end(); } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

class C {
  jar = {};
  async req(p, o = {}) {
    const r = await fetch(base + p, { redirect: 'manual', ...o, headers: { ...(o.headers || {}), cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) this.jar[k] = v; else delete this.jar[k]; }
    return r;
  }
  form(p, f) { return this.req(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(f).toString() }); }
  async text(p) { const r = await this.req(p); return [r, await r.text()]; }
  async login(email, password) { const [, b] = await this.text('/portal/login'); return this.form('/portal/anmelden', { _t: /name="_t" value="([^"]+)"/.exec(b)[1], email, password }); }
}

test('Vorbereitung: Testkonto übernimmt eigenes Passwort (wie Dirk öffentlich)', async () => {
  const c = new C();
  const l = await c.login('admin@stromkai-abnahme.invalid', alt.admin);
  assert.equal(l.headers.get('location'), '/portal/passwort', 'Startzugang verlangt einmal den Wechsel');
  const [, pb] = await c.text('/portal/passwort');
  const neu = 'Selbst-Gewaehlt-2026!';
  assert.equal((await c.form('/portal/passwort', { _csrf: /name="_csrf" value="([^"]+)"/.exec(pb)[1], current: alt.admin, neu, neu2: neu })).status, 303);
  assert.equal(adminIm(zustand()).mustChangePassword, false);
});

test('Einmaliger administrativer Reset: neue Adresse, Startpasswort ohne Pflichtwechsel, Sperre aufgehoben', async () => {
  const st0 = zustand();
  process.env.BESS_ACCOUNTS = accounts({ adminEmail: ADRESSE, adminPw: hashPassword(TEMP), adminExtra: { mustChangePassword: false, reset: 'ar-test-1' }, markusPw: MARKUS_PW, rev: 'r1' });
  const c = new C();
  const l = await c.login(ADRESSE, TEMP);
  assert.equal(l.status, 303);
  assert.notEqual(l.headers.get('location'), '/portal/passwort', 'kein Pflichtwechsel');
  assert.notEqual(l.headers.get('location'), '/portal/mfa', 'keine MFA');
  const d = adminIm(zustand());
  assert.equal(d.email, ADRESSE); assert.equal(d.mustChangePassword, false); assert.ok(d.passwordChangedAt);
  assert.deepEqual(zustand().meta.angewandteResets, ['ar-test-1']);
  assert.equal(adminIm(st0).id, d.id, 'dasselbe Konto, kein zweites angelegt');
  assert.equal(zustand().users.length, st0.users.length, 'kein zusätzliches Konto');
});

test('Ablauf: Dashboard und Administration öffnen, abmelden, erneut anmelden – ohne Passwortaufforderung', async () => {
  const c = new C();
  const l = await c.login(ADRESSE, TEMP);
  const ziel = l.headers.get('location');
  const [d] = await c.text(ziel);
  assert.equal(d.status, 200, `Dashboard ${ziel}`);
  for (const p of ['/portal', '/portal/admin/benutzer', '/portal/wirtschaftlichkeit', '/portal/projekte/p-n01']) assert.equal((await c.req(p)).status, 200, p);
  const [, pb] = await c.text('/portal');
  assert.equal((await c.form('/portal/abmelden', { _csrf: /name="_csrf" value="([^"]+)"/.exec(pb)[1] })).status, 303);
  assert.equal((await c.req('/portal')).headers.get('location'), '/portal/login');
  const c2 = new C(); const l2 = await c2.login(ADRESSE, TEMP);
  assert.equal(l2.status, 303); assert.notEqual(l2.headers.get('location'), '/portal/passwort');
  assert.equal((await new C().login('admin@stromkai-abnahme.invalid', TEMP)).status, 401, 'Kunstadresse gilt nicht mehr');
});

test('Neue Bereitstellung mit unverändertem und mit geändertem BESS_ACCOUNTS: Zugang bleibt, Reset wird nicht erneut angewendet', async () => {
  const sitzung = new C(); await sitzung.login(ADRESSE, TEMP);
  // gleicher Wert erneut (Kaltstart einer neuen Bereitstellung): kein Abgleich
  const vorher = adminIm(zustand());
  assert.equal((await sitzung.req('/portal')).status, 200);
  // Dirk ändert sein Passwort selbst über die Kontoeinstellungen (Eigenes Konto)
  const [, pb] = await sitzung.text('/portal/konto');
  const eigenes = 'Endgueltig-Eigenes-2026!';
  assert.equal((await sitzung.form('/portal/konto', { _csrf: /name="_csrf" value="([^"]+)"/.exec(pb)[1], current: TEMP, neu: eigenes, neu2: eigenes })).status, 303);
  // spätere Änderung an BESS_ACCOUNTS (z. B. für ein anderes Konto) mit noch enthaltenem Reset-Eintrag
  process.env.BESS_ACCOUNTS = accounts({ adminEmail: ADRESSE, adminPw: hashPassword(TEMP), adminExtra: { mustChangePassword: false, reset: 'ar-test-1' }, markusPw: hashPassword('Neu-Fuer-Markus-2026!'), rev: 'r2' });
  const c = new C();
  assert.equal((await c.login(ADRESSE, eigenes)).status, 303, 'eigenes Passwort gilt weiter');
  assert.equal((await new C().login(ADRESSE, TEMP)).status, 401, 'Startpasswort wird nicht erneut gesetzt');
  const d = adminIm(zustand());
  assert.equal(d.email, ADRESSE); assert.equal(d.mustChangePassword, false); assert.equal(d.id, vorher.id);
  assert.deepEqual(zustand().meta.angewandteResets, ['ar-test-1']);
});

test('Kontoeinstellungen: Passwort ändern ist für das Konto erreichbar (Eigenes Konto, AW-STROMKAI-20261030-UI-NAVIGATION-PASSWORT-019)', async () => {
  const c = new C(); await c.login(ADRESSE, 'Endgueltig-Eigenes-2026!');
  const alt = await c.req('/portal/passwort');
  assert.equal(alt.status, 303); assert.equal(alt.headers.get('location'), '/portal/konto', 'bisherige Adresse führt zum eigenen Konto');
  const [r, b] = await c.text('/portal/konto');
  assert.equal(r.status, 200); assert.match(b, /name="current"/);
  const [, ben] = await c.text('/portal/admin/benutzer');
  assert.match(ben, /href="\/portal\/konto">Eigenes Konto/, 'Reiter unter Benutzer & Berechtigungen');
  const [, home] = await c.text('/portal');
  assert.doesNotMatch(/<header class="top">([\s\S]*?)<\/header>/.exec(home)[1], /Passwort/, 'nicht mehr im Kopfbereich');
});
