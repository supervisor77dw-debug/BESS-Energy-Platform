// Passwort-Link für den Administratorzugang und Schutz persönlich übernommener Konten (AW-20261029-GE-CLAUDE-STROMKAI-ADMIN-SSO-RECOVERY-014).
// Isoliertes Testkonto: Seed-Administrator admin@demo.invalid (kein persönliches Konto). Aufruf: node --test test/wiederherstellung.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = mkdtempSync(join(tmpdir(), 'bess-wh-'));
process.env.BESS_DATA_DIR = DIR;
process.env.BESS_PREVIEW_HELPERS = '0';
delete process.env.BESS_MFA;
delete process.env.BESS_RECOVERY;
const PW = 'Vorschau!Speicher-2026';
const NEU = 'Sonnenkai-Speicher-2026!';
const NEUE_ADRESSE = 'leitung@stromkai-test.example';

let server, base, db;
before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'data', 'seed.mjs'), DIR]);
  const store = await import('../src/lib/store.mjs');
  await store.openStore(DIR);
  db = store.getDb();
  const { createApp } = await import('../server.mjs');
  server = createApp();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); delete process.env.BESS_RECOVERY; rmSync(DIR, { recursive: true, force: true }); });

class Client {
  constructor() { this.cookie = ''; }
  async req(path, opts = {}) {
    const res = await fetch(base + path, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(this.cookie ? { cookie: this.cookie } : {}) } });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    return res;
  }
  async text(path) { const r = await this.req(path); return { r, body: await r.text() }; }
  form(path, fields) { return this.req(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() }); }
  async login(email, password = PW) {
    const { body } = await this.text('/portal/login');
    return this.form('/portal/anmelden', { _t: /name="_t" value="([^"]+)"/.exec(body)[1], email, password });
  }
}
const admin = () => db.users.find((x) => x.id === 'u-admin');
const neuerLink = (o = {}) => {
  const token = randomBytes(32).toString('base64url');
  process.env.BESS_RECOVERY = JSON.stringify({ id: o.id || `pl-${randomBytes(3).toString('hex')}`, userId: o.userId || 'u-admin', tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: o.expiresAt || new Date(Date.now() + 3600e3).toISOString(), ...(o.email !== null ? { email: o.email || NEUE_ADRESSE } : {}) });
  return token;
};

test('ohne Einrichtung und mit falschem Token: „Link nicht gültig“, alte Code-Seite abgeschaltet', async () => {
  assert.equal((await new Client().text('/portal/passwort-festlegen?t=abc')).r.status, 404);
  neuerLink();
  assert.equal((await new Client().text('/portal/passwort-festlegen?t=falsch')).r.status, 404);
  assert.equal((await new Client().text('/portal/passwort-festlegen')).r.status, 404, 'ohne Token');
  const alt = await new Client().req('/portal/wiederherstellen');
  assert.equal(alt.status, 303); assert.equal(alt.headers.get('location'), '/portal/passwort-festlegen');
});

test('abgelaufen, an Nicht-Admin gebunden oder Adresse bereits vergeben: nicht gültig', async () => {
  let t = neuerLink({ expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await new Client().text(`/portal/passwort-festlegen?t=${t}`)).r.status, 404);
  const inv = db.users.find((x) => x.email === 'investor.a@demo.invalid');
  t = neuerLink({ userId: inv.id });
  assert.equal((await new Client().text(`/portal/passwort-festlegen?t=${t}`)).r.status, 404);
  t = neuerLink({ email: 'investor.a@demo.invalid' });
  assert.equal((await new Client().text(`/portal/passwort-festlegen?t=${t}`)).r.status, 404, 'keine Übernahme einer fremden Adresse');
});

test('Seite zeigt nur Passwort, Bestätigung, Speichern – kein Code, keine MFA, keine Prüfsumme', async () => {
  const t = neuerLink();
  const { r, body } = await new Client().text(`/portal/passwort-festlegen?t=${t}`);
  assert.equal(r.status, 200);
  assert.match(body, /Neues Passwort<\/label>/); assert.match(body, /Neues Passwort bestätigen/); assert.match(body, /Passwort speichern/);
  assert.doesNotMatch(body, /name="code"|QR|TOTP|[0-9a-f]{64}/);
  assert.match(r.headers.get('cache-control') || '', /no-store/);
});

test('Passwortregeln mit verständlicher Meldung; Fehleingabe verbraucht den Link nicht', async () => {
  const t = neuerLink({ id: 'pl-regeln' });
  const c = new Client();
  const kurz = await c.form('/portal/passwort-festlegen', { t, neu: 'kurz', neu2: 'kurz' });
  assert.equal(kurz.status, 422); assert.match(await kurz.text(), /mindestens 12 Zeichen/);
  const name = await c.form('/portal/passwort-festlegen', { t, neu: 'leitung-Speicher-2026', neu2: 'leitung-Speicher-2026' });
  assert.equal(name.status, 422); assert.match(await name.text(), /Benutzernamen/);
  assert.equal((await c.text(`/portal/passwort-festlegen?t=${t}`)).r.status, 200, 'Link weiterhin gültig');
});

test('Gesamtablauf: Link → zweimal Passwort → direkt im Admin-Bereich; Adresse umgestellt; Link danach ungültig', async () => {
  const alt = new Client(); assert.equal((await alt.login('admin@demo.invalid')).status, 303);
  admin().lockedUntil = new Date(Date.now() + 600000).toISOString();
  const rollenVorher = JSON.stringify(admin().roles || admin().role);
  const t = neuerLink({ id: 'pl-gut' });
  const c = new Client();
  const r = await c.form('/portal/passwort-festlegen', { t, neu: NEU, neu2: NEU });
  assert.equal(r.status, 303); assert.notEqual(r.headers.get('location'), '/portal/mfa', 'keine MFA');
  assert.equal((await c.req(r.headers.get('location'))).status, 200, 'unmittelbar angemeldet');
  assert.equal((await c.req('/portal/admin/benutzer')).status, 200, 'Administration erreichbar');
  assert.equal(admin().email, NEUE_ADRESSE); assert.equal(admin().mustChangePassword, false); assert.equal(admin().lockedUntil, undefined);
  assert.equal(JSON.stringify(admin().roles || admin().role), rollenVorher, 'Rollen unverändert');
  assert.equal((await alt.req('/portal')).headers.get('location'), '/portal/login', 'ältere Sitzung beendet');
  assert.equal((await new Client().text(`/portal/passwort-festlegen?t=${t}`)).r.status, 404, 'einmalig');
  assert.equal((await new Client().form('/portal/passwort-festlegen', { t, neu: 'Anderes-Passwort-2026!', neu2: 'Anderes-Passwort-2026!' })).status, 404);
  const n = new Client(); const l = await n.login(NEUE_ADRESSE, NEU);
  assert.equal(l.status, 303); assert.notEqual(l.headers.get('location'), '/portal/passwort', 'dauerhafte Anmeldung ohne Pflichtwechsel');
  assert.equal((await new Client().login('admin@demo.invalid', NEU)).status, 401, 'alte Kunstadresse gilt nicht mehr');
  assert.ok(db.audit.some((x) => x.event === 'admin_passwort_ueber_link_gesetzt'));
  assert.ok(!JSON.stringify(db.audit).includes(t), 'Token nie im Protokoll');
});

test('Kontenabgleich lässt persönlich übernommene Konten unverändert (Passwort, Adresse) und meldet niemanden ab', async () => {
  const { syncAccounts } = await import('../src/lib/bootstrap.mjs');
  const vorher = admin().pw;
  const s = new Client(); await s.login(NEUE_ADRESSE, NEU);
  process.env.BESS_ACCOUNTS = JSON.stringify({ users: db.users.filter((u) => u.createdVia !== 'verwaltung').map((u) => ({ id: u.id, email: u.id === 'u-admin' ? 'admin@demo.invalid' : u.email, pw: 'scrypt$neu$abgleich', mustChangePassword: true })), rev: 'bereitstellung' });
  try { assert.equal(syncAccounts(db), true); } finally { delete process.env.BESS_ACCOUNTS; }
  assert.equal(admin().pw, vorher); assert.equal(admin().email, NEUE_ADRESSE, 'Anmeldeadresse bleibt'); assert.equal(admin().mustChangePassword, false);
  assert.equal(db.users.find((u) => u.email === 'investor.a@demo.invalid').pw, 'scrypt$neu$abgleich', 'nicht übernommene Startzugänge wie bisher');
  process.env.BESS_ACCOUNTS = JSON.stringify({ users: [{ id: 'u-admin', email: 'admin@demo.invalid', pw: 'scrypt$x$y', reset: true }] });
  try { syncAccounts(db); } finally { delete process.env.BESS_ACCOUNTS; }
  assert.equal(admin().pw, 'scrypt$x$y', 'ausdrücklicher Reset bleibt möglich');
});

test('Kontenabgleich ohne neu gesetzte Zugänge lässt Sitzungen bestehen', async () => {
  const { applyAccounts } = await import('../src/lib/bootstrap.mjs');
  const a = { ...admin(), passwordChangedAt: new Date().toISOString(), mustChangePassword: false, pw: 'scrypt$a$b' };
  const nurAdmin = { meta: { sessionKey: 'k1' }, users: [a], revoked: ['x'], audit: [] };
  applyAccounts(nurAdmin, { users: [{ id: a.id, email: a.email, pw: 'scrypt$z$z' }] }, 'h2');
  assert.equal(nurAdmin.meta.sessionKey, 'k1'); assert.deepEqual(nurAdmin.revoked, ['x']);
});

test('recovery-code: Link nur in der Übergabedatei, Ausgabe nur Prüfsumme, max. 24 h, kein Überschreiben', () => {
  const f = join(DIR, 'uebergabe.txt');
  const out = execFileSync(process.execPath, [join(ROOT, 'tools', 'recovery-code.mjs'), '--user', 'u-admin', '--email', 'a@b.example', '--url', 'https://x.test', '--stunden', '48', '--datei', f]).toString();
  const env = JSON.parse(out);
  const token = /passwort-festlegen\?t=(\S+)/.exec(readFileSync(f, 'utf8'))[1];
  assert.ok(!out.includes(token)); assert.equal(token.length, 43);
  assert.equal(env.tokenHash, createHash('sha256').update(token).digest('hex'));
  assert.ok(Date.parse(env.expiresAt) - Date.now() <= 24 * 3600e3 + 5000, 'höchstens 24 h');
  assert.throws(() => execFileSync(process.execPath, [join(ROOT, 'tools', 'recovery-code.mjs'), '--user', 'u-admin', '--email', 'a@b.c', '--url', 'https://x', '--datei', f], { stdio: 'pipe' }));
});
