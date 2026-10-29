// Notfall-Wiederherstellung des Administratorzugangs und Schutz selbst gesetzter Passwörter (AW-20261029-GE-CLAUDE-STROMKAI-ADMIN-SSO-RECOVERY-014).
// Aufruf: node --test test/wiederherstellung.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const CODE = 'Test-Wiederherstellungscode-0123456789';
const NEU = 'Mein-eigenes-Passwort-2026!';

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
const admin = () => db.users.find((x) => x.email === 'admin@demo.invalid');
const setze = (o = {}) => { process.env.BESS_RECOVERY = JSON.stringify({ id: o.id || 'wh-test-1', userId: o.userId || 'u-admin', codeHash: createHash('sha256').update(o.code || CODE).digest('hex'), expiresAt: o.expiresAt || new Date(Date.now() + 3600e3).toISOString() }); };
async function absenden(c, f) {
  const { body } = await c.text('/portal/wiederherstellen');
  return c.form('/portal/wiederherstellen', { _t: /name="_t" value="([^"]+)"/.exec(body)?.[1] || '', ...f });
}

test('ohne BESS_RECOVERY ist die Wiederherstellung nicht verfügbar', async () => {
  const { r, body } = await new Client().text('/portal/wiederherstellen');
  assert.equal(r.status, 404); assert.match(body, /nicht verfügbar/);
});

test('Formular enthält weder Code noch Prüfsumme; Code wird nie in der URL erwartet', async () => {
  setze();
  const { r, body } = await new Client().text('/portal/wiederherstellen?code=' + CODE);
  assert.equal(r.status, 200);
  assert.doesNotMatch(body, new RegExp(CODE)); assert.doesNotMatch(body, /[0-9a-f]{64}/);
  assert.match(body, /type="password"[^>]*autocomplete="one-time-code"|name="code" type="password"/);
});

test('falscher Code oder falsche E-Mail werden abgewiesen und gezählt', async () => {
  setze({ id: 'wh-test-falsch' });
  const c = new Client();
  assert.equal((await absenden(c, { email: 'admin@demo.invalid', code: 'falsch', neu: NEU, neu2: NEU })).status, 401);
  assert.equal((await absenden(c, { email: 'investor.a@demo.invalid', code: CODE, neu: NEU, neu2: NEU })).status, 401, 'Code ist an das Administratorkonto gebunden');
  assert.equal(db.meta.recoveryUsed['wh-test-falsch'].fehlversuche, 2);
  assert.notEqual(admin().passwordChangedAt && admin().pw, null);
});

test('nach drei Fehlversuchen ist die Wiederherstellung gesperrt – auch mit richtigem Code', async () => {
  setze({ id: 'wh-test-falsch' });
  const c = new Client();
  assert.equal((await absenden(c, { email: 'admin@demo.invalid', code: 'falsch-3', neu: NEU, neu2: NEU })).status, 401);
  assert.equal((await absenden(c, { email: 'admin@demo.invalid', code: CODE, neu: NEU, neu2: NEU })).status, 404);
});

test('abgelaufen oder an ein Nicht-Admin-Konto gebunden: nicht verfügbar', async () => {
  setze({ id: 'wh-alt', expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await new Client().text('/portal/wiederherstellen')).r.status, 404);
  const inv = db.users.find((x) => x.email === 'investor.a@demo.invalid');
  setze({ id: 'wh-inv', userId: inv.id });
  assert.equal((await new Client().text('/portal/wiederherstellen')).r.status, 404);
});

test('gültige Wiederherstellung: eigenes Passwort, Sperre aufgehoben, alte Sitzungen beendet, danach verbraucht', async () => {
  const alt = new Client(); assert.equal((await alt.login('admin@demo.invalid')).status, 303);
  admin().lockedUntil = new Date(Date.now() + 600000).toISOString();
  setze({ id: 'wh-gut' });
  const c = new Client();
  assert.equal((await absenden(c, { email: 'admin@demo.invalid', code: CODE, neu: 'kurz', neu2: 'kurz' })).status, 422, 'Passwortregeln gelten');
  const r = await absenden(c, { email: 'Admin@Demo.invalid', code: CODE, neu: NEU, neu2: NEU });
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/portal/login?m=wiederhergestellt');
  assert.equal(admin().mustChangePassword, false); assert.equal(admin().lockedUntil, undefined);
  assert.equal((await alt.req('/portal')).headers.get('location'), '/portal/login', 'bisherige Sitzung beendet');
  assert.equal((await new Client().login('admin@demo.invalid', PW)).status, 401, 'altes Passwort ungültig');
  const n = new Client(); const l = await n.login('admin@demo.invalid', NEU);
  assert.equal(l.status, 303); assert.notEqual(l.headers.get('location'), '/portal/passwort', 'kein erneuter Pflichtwechsel');
  assert.equal((await n.req('/portal/admin/benutzer')).status, 200, 'Administratorrechte unverändert');
  assert.equal((await new Client().text('/portal/wiederherstellen')).r.status, 404, 'einmalig');
  assert.ok(db.audit.some((x) => x.event === 'admin_zugang_wiederhergestellt'));
  assert.ok(!JSON.stringify(db.audit).includes(CODE), 'Code nie im Protokoll');
});

test('Kontenabgleich überschreibt selbst gesetzte Passwörter nicht und meldet niemanden ab', async () => {
  const { syncAccounts } = await import('../src/lib/bootstrap.mjs');
  const vorher = admin().pw, key = db.meta.sessionKey;
  const sess = new Client(); await sess.login('admin@demo.invalid', NEU);
  process.env.BESS_ACCOUNTS = JSON.stringify({ users: db.users.filter((u) => u.createdVia !== 'verwaltung').map((u) => ({ id: u.id, email: u.email, pw: 'scrypt$neu$abgleich', mustChangePassword: true })), rev: 'neue-bereitstellung' });
  try { assert.equal(syncAccounts(db), true); } finally { delete process.env.BESS_ACCOUNTS; }
  assert.equal(admin().pw, vorher, 'eigenes Passwort bleibt'); assert.equal(admin().mustChangePassword, false);
  const other = db.users.find((u) => u.email === 'investor.a@demo.invalid');
  assert.equal(other.pw, 'scrypt$neu$abgleich', 'nicht übernommene Startzugänge werden wie bisher gesetzt');
  assert.notEqual(db.meta.sessionKey, key, 'Schlüsselwechsel nur, weil Startzugänge neu gesetzt wurden');
  process.env.BESS_ACCOUNTS = JSON.stringify({ users: [{ id: 'u-admin', email: 'admin@demo.invalid', pw: 'scrypt$x$y', reset: true }] });
  try { syncAccounts(db); } finally { delete process.env.BESS_ACCOUNTS; }
  assert.equal(admin().pw, 'scrypt$x$y', 'ausdrücklicher Reset bleibt möglich');
});

test('Kontenabgleich ohne neu gesetzte Zugänge lässt Sitzungen bestehen', async () => {
  const { applyAccounts } = await import('../src/lib/bootstrap.mjs');
  const a = admin(); a.passwordChangedAt = new Date().toISOString(); a.mustChangePassword = false;
  const nurAdmin = { meta: { sessionKey: 'k1' }, users: [a], revoked: ['x'], audit: [] };
  applyAccounts(nurAdmin, { users: [{ id: a.id, email: a.email, pw: 'scrypt$z$z' }] }, 'h2');
  assert.equal(nurAdmin.meta.sessionKey, 'k1'); assert.deepEqual(nurAdmin.revoked, ['x']);
});

test('recovery-code: Code nur in der Übergabedatei, Ausgabe nur Prüfsumme, kein Überschreiben', () => {
  const f = join(DIR, 'uebergabe.txt');
  const out = execFileSync(process.execPath, [join(ROOT, 'tools', 'recovery-code.mjs'), '--user', 'u-admin', '--email', 'dirk@x.invalid', '--url', 'https://x.test', '--stunden', '2', '--datei', f]).toString();
  const env = JSON.parse(out);
  const code = /Wiederherstellungscode: (\S+)/.exec(readFileSync(f, 'utf8'))[1];
  assert.ok(!out.includes(code));
  assert.equal(env.codeHash, createHash('sha256').update(code).digest('hex'));
  assert.ok(Date.parse(env.expiresAt) - Date.now() <= 2 * 3600e3 + 5000);
  assert.throws(() => execFileSync(process.execPath, [join(ROOT, 'tools', 'recovery-code.mjs'), '--user', 'u-admin', '--email', 'a@b.c', '--url', 'https://x', '--datei', f], { stdio: 'pipe' }));
});
