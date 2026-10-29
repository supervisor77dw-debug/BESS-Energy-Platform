// Benutzer & Berechtigungen (AW-BESS-STROMKAI-BENUTZERVERWALTUNG-009): Anmeldung ohne Pflicht-MFA, Einladung und Aktivierung,
// Rollen und Projektrechte, sofortiger Entzug, Sperre mit Sitzungswiderruf, Schutz gegen Rechteausweitung.
// Aufruf: node --test test/benutzerverwaltung.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = mkdtempSync(join(tmpdir(), 'bess-bv-'));
process.env.BESS_DATA_DIR = DIR;
process.env.BESS_PREVIEW_HELPERS = '0';
delete process.env.BESS_MFA; // Standard der Abnahmeplattform: keine Pflicht-MFA
const PW = 'Vorschau!Speicher-2026';

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
after(() => { server?.close(); rmSync(DIR, { recursive: true, force: true }); });

class Client {
  constructor() { this.cookie = ''; }
  async req(path, opts = {}) {
    const res = await fetch(base + path, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(this.cookie ? { cookie: this.cookie } : {}) } });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    return res;
  }
  async text(path) { const r = await this.req(path); return { r, body: await r.text() }; }
  form(path, fields) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) p.append(k, x);
    return this.req(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: p.toString() });
  }
  async login(email, password = PW) {
    const { body } = await this.text('/portal/login');
    return this.form('/portal/anmelden', { _t: /name="_t" value="([^"]+)"/.exec(body)[1], email, password });
  }
  async csrf(path = '/portal') { const { body } = await this.text(path); return /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; }
}
const status = async (c, p) => (await c.req(p)).status;
const loc = (r) => r.headers.get('location');
const token = (html) => /aktivieren\?t=([\w-]+)/.exec(html)?.[1];
const userBy = (email) => db.users.find((x) => x.email === email);

let dirk;
test('1 – Dirk meldet sich nur mit E-Mail und Passwort an (keine MFA, kein QR-Code)', async () => {
  dirk = new Client();
  const r = await dirk.login('admin@demo.invalid');
  assert.equal(r.status, 303);
  assert.equal(loc(r), '/portal', 'direkt in den Startbereich');
  const { r: p, body } = await dirk.text('/portal');
  assert.equal(p.status, 200);
  assert.doesNotMatch(body, /Zweiten Faktor|data:image\/gif/);
  assert.match(body, /Benutzer &amp; Berechtigungen|Benutzer & Berechtigungen/);
  assert.ok(userBy('admin@demo.invalid').lastLoginAt, 'letzte Anmeldung wird erfasst');
});

test('Markus (Vertrieb Nord) ebenfalls ohne MFA, landet in der Pipeline', async () => {
  const m = new Client();
  const r = await m.login('markus@demo.invalid');
  assert.equal(loc(r), '/portal/pipeline');
  assert.equal(await status(m, '/portal/projekte/p-s01'), 404);
  assert.equal(await status(m, '/portal/dokumente/d-n01-fin-intern/download'), 404, 'keine vertraulichen Finanzdaten');
  assert.equal(await status(m, '/portal/admin/benutzer'), 404, 'keine Benutzerverwaltung');
});

let tester, tok1;
test('2/3 – Dirk lädt einen Testbenutzer ein, Rolle Investor, Projekt Nord A', async () => {
  const csrf = await dirk.csrf('/portal/admin/benutzer/neu');
  const r = await dirk.form('/portal/admin/benutzer/neu', { _csrf: csrf, name: 'Test Investor', email: 'test.investor@demo.invalid', roles: 'investor', projects: 'p-n01' });
  assert.equal(r.status, 200);
  const body = await r.text();
  tok1 = token(body);
  assert.ok(tok1 && tok1.length >= 40, 'einmaliger Aktivierungslink angezeigt');
  tester = userBy('test.investor@demo.invalid');
  assert.equal(tester.pw, null, 'kein Passwort vergeben');
  assert.deepEqual(tester.roles, ['investor']);
  assert.ok(db.grants.some((g) => g.userId === tester.id && g.projectId === 'p-n01' && g.scope === 'investor'));
  const inv = db.invitations.find((i) => i.userId === tester.id);
  assert.ok(inv.tokenHash && !JSON.stringify(db).includes(tok1), 'nur Prüfsumme gespeichert, kein Klartext-Token');
  assert.ok(Date.parse(inv.expiresAt) > Date.now() + 70 * 3600e3, 'Gültigkeit 72 Stunden');
  const { body: list } = await dirk.text('/portal/admin/benutzer?status=eingeladen');
  assert.match(list, /Test Investor/);
  assert.match(list, /Einladung offen/);
  const { body: log } = await dirk.text('/portal/admin/aenderungen');
  assert.match(log, /Benutzer eingeladen/);
});

test('ohne Aktivierung keine Anmeldung möglich', async () => {
  const c = new Client();
  assert.equal((await c.login('test.investor@demo.invalid', 'irgendwas-123456')).status, 401);
});

let user;
test('4 – Aktivierung: schwaches Passwort abgelehnt, starkes gespeichert, Link danach ungültig; erste Anmeldung', async () => {
  const a = new Client();
  assert.equal(await status(a, `/portal/aktivieren?t=${tok1}`), 200);
  assert.equal((await a.form('/portal/aktivieren', { t: tok1, neu: 'kurz', neu2: 'kurz' })).status, 422);
  assert.equal((await a.form('/portal/aktivieren', { t: tok1, neu: 'nurbuchstabenlang', neu2: 'nurbuchstabenlang' })).status, 422);
  const ok = await a.form('/portal/aktivieren', { t: tok1, neu: 'Sicheres-Testpasswort-29', neu2: 'Sicheres-Testpasswort-29' });
  assert.equal(ok.status, 303);
  assert.equal(loc(ok), '/portal/login?m=aktiviert');
  assert.match(userBy('test.investor@demo.invalid').pw, /^scrypt\$/);
  assert.equal(await status(a, `/portal/aktivieren?t=${tok1}`), 410, 'Link nur einmal verwendbar');
  user = new Client();
  const r = await user.login('test.investor@demo.invalid', 'Sicheres-Testpasswort-29');
  assert.equal(loc(r), '/portal/dokumente', 'direkt in den berechtigten Bereich');
});

test('5 – der Benutzer sieht ausschließlich seine freigegebenen Inhalte', async () => {
  assert.equal(await status(user, '/portal/dokumente/d-n01-inv-teaser/download'), 200);
  assert.equal(await status(user, '/portal/projekte/p-n01'), 200);
  for (const p of ['/portal/dokumente/d-n02-inv-teaser/download', '/portal/dokumente/d-n01-inv-netz-entwurf/download', '/portal/dokumente/d-n01-fin-intern/download', '/portal/dokumente/d-n01-own-a-vertrag/download', '/portal/projekte/p-n02', '/portal/projekte/p-s01', '/portal/admin', '/portal/admin/benutzer', '/portal/protokoll', '/portal/pipeline'])
    assert.equal(await status(user, p), 404, p);
});

test('Schutz gegen Rechteausweitung: kein Zugriff auf Verwaltungsaktionen, auch nicht mit gültigem Token', async () => {
  const csrf = await user.csrf('/portal/dokumente');
  for (const [p, f] of [[`/portal/admin/benutzer/${tester.id}/rollen`, { roles: 'admin', confirm_admin: 'ja' }], [`/portal/admin/benutzer/${tester.id}/zugriff`, { role: 'investor', projectId: 'p-n02' }], ['/portal/admin/benutzer/neu', { name: 'x', email: 'x@y.de', roles: 'admin' }], ['/portal/admin/zugriff', { userId: tester.id, projectId: 'p-n02' }]])
    assert.equal((await user.form(p, { _csrf: csrf, ...f })).status, 404, p);
  assert.deepEqual(userBy('test.investor@demo.invalid').roles, ['investor']);
  assert.equal(db.grants.filter((g) => g.userId === tester.id).length, 1);
});

test('6/7 – Dirk entzieht die Projektberechtigung: Zugriff sofort verweigert (gleiche Sitzung)', async () => {
  const g = db.grants.find((x) => x.userId === tester.id && x.projectId === 'p-n01');
  const csrf = await dirk.csrf(`/portal/admin/benutzer/${tester.id}`);
  assert.equal((await dirk.form(`/portal/admin/benutzer/${tester.id}/zugriff/${g.id}/entziehen`, { _csrf: csrf })).status, 303);
  assert.equal(await status(user, '/portal/dokumente/d-n01-inv-teaser/download'), 404);
  assert.equal(await status(user, '/portal/projekte/p-n01'), 404);
  const { body } = await dirk.text('/portal/admin/aenderungen');
  assert.match(body, /Projektrecht entzogen/);
});

test('8/9 – Dirk sperrt den Benutzer: Sitzung sofort ungültig, Anmeldung abgewiesen; nach Entsperren bleibt die alte Sitzung ungültig', async () => {
  const csrf = await dirk.csrf(`/portal/admin/benutzer/${tester.id}`);
  assert.equal((await dirk.form(`/portal/admin/benutzer/${tester.id}/sperren`, { _csrf: csrf, grund: 'Abnahmetest' })).status, 303);
  const r = await user.req('/portal/dokumente');
  assert.equal(r.status, 303);
  assert.equal(loc(r), '/portal/login');
  const again = new Client();
  assert.equal((await again.login('test.investor@demo.invalid', 'Sicheres-Testpasswort-29')).status, 401);
  const { body } = await dirk.text('/portal/admin/benutzer?status=gesperrt');
  assert.match(body, /Test Investor/);
  const old = user.cookie;
  const csrf2 = await dirk.csrf(`/portal/admin/benutzer/${tester.id}`);
  await dirk.form(`/portal/admin/benutzer/${tester.id}/entsperren`, { _csrf: csrf2 });
  const stale = new Client(); stale.cookie = old;
  assert.equal(loc(await stale.req('/portal')), '/portal/login', 'alte Sitzung bleibt nach Entsperren ungültig');
  assert.equal(loc(await new Client().login('test.investor@demo.invalid', 'Sicheres-Testpasswort-29')), '/portal/dokumente');
});

test('Mehrere Rollen gelten nur je Projekt (keine Vermischung)', async () => {
  const csrf = await dirk.csrf('/portal/admin/benutzer/neu');
  const r = await dirk.form('/portal/admin/benutzer/neu', { _csrf: csrf, name: 'Doppelrolle', email: 'doppel@demo.invalid', roles: ['investor', 'kommune'] });
  const t = token(await r.text());
  const x = userBy('doppel@demo.invalid');
  for (const [role, pid] of [['investor', 'p-n02'], ['kommune', 'p-n01']]) {
    const c = await dirk.csrf(`/portal/admin/benutzer/${x.id}`);
    assert.equal((await dirk.form(`/portal/admin/benutzer/${x.id}/zugriff`, { _csrf: c, role, projectId: pid })).status, 303);
  }
  assert.equal((await new Client().form('/portal/aktivieren', { t, neu: 'Zwei-Rollen-2026!', neu2: 'Zwei-Rollen-2026!' })).status, 303);
  const c = new Client();
  await c.login('doppel@demo.invalid', 'Zwei-Rollen-2026!');
  assert.equal(await status(c, '/portal/dokumente/d-n02-inv-teaser/download'), 200, 'Investor für Nord B');
  assert.equal(await status(c, '/portal/dokumente/d-n01-kom-brand/download'), 200, 'Kommune für Nord A');
  assert.equal(await status(c, '/portal/dokumente/d-n01-inv-teaser/download'), 404, 'kein Investorenzugriff auf Nord A');
  assert.equal(await status(c, '/portal/dokumente/d-n01-inv-fin/download'), 404);
  assert.equal(await status(c, '/portal/dokumente/d-n02-tech-spec/download'), 404);
});

test('Rollenvergabe: Administrationsrolle nur mit Bestätigung; eigene Administrationsrolle und eigene Sperre geschützt; CSRF Pflicht', async () => {
  const x = userBy('doppel@demo.invalid');
  let csrf = await dirk.csrf(`/portal/admin/benutzer/${x.id}`);
  assert.equal((await dirk.form(`/portal/admin/benutzer/${x.id}/rollen`, { _csrf: csrf, roles: ['investor', 'admin'] })).status, 400);
  assert.ok(!userBy('doppel@demo.invalid').roles.includes('admin'));
  const me = userBy('admin@demo.invalid');
  csrf = await dirk.csrf(`/portal/admin/benutzer/${me.id}`);
  assert.equal((await dirk.form(`/portal/admin/benutzer/${me.id}/rollen`, { _csrf: csrf, roles: 'investor' })).status, 400);
  assert.equal((await dirk.form(`/portal/admin/benutzer/${me.id}/sperren`, { _csrf: csrf })).status, 400);
  assert.ok(userBy('admin@demo.invalid').roles?.includes?.('admin') ?? userBy('admin@demo.invalid').role === 'admin');
  assert.equal((await dirk.form(`/portal/admin/benutzer/${x.id}/sperren`, {})).status, 403, 'ohne CSRF-Token');
  assert.equal((await dirk.form(`/portal/admin/benutzer/${x.id}/sperren`, { _csrf: 'falsch' })).status, 403);
  // Rolle entfällt → zugehörige Projektrechte entfallen
  csrf = await dirk.csrf(`/portal/admin/benutzer/${x.id}`);
  assert.equal((await dirk.form(`/portal/admin/benutzer/${x.id}/rollen`, { _csrf: csrf, roles: 'kommune' })).status, 303);
  assert.ok(!db.grants.some((g) => g.userId === x.id && g.scope === 'investor'));
});

test('Passwort zurücksetzen über Link: alter Link ungültig, bestehende Sitzungen beendet', async () => {
  const x = userBy('doppel@demo.invalid');
  const c = new Client(); await c.login('doppel@demo.invalid', 'Zwei-Rollen-2026!');
  assert.equal((await c.req('/portal/projekte')).status, 200);
  let csrf = await dirk.csrf(`/portal/admin/benutzer/${x.id}`);
  const t1 = token(await (await dirk.form(`/portal/admin/benutzer/${x.id}/passwort-link`, { _csrf: csrf })).text());
  csrf = await dirk.csrf(`/portal/admin/benutzer/${x.id}`);
  const t2 = token(await (await dirk.form(`/portal/admin/benutzer/${x.id}/passwort-link`, { _csrf: csrf })).text());
  assert.equal(await status(new Client(), `/portal/aktivieren?t=${t1}`), 410, 'ältere Links werden beim Neuerzeugen ungültig');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await new Client().form('/portal/aktivieren', { t: t2, neu: 'Neues-Passwort-2027!', neu2: 'Neues-Passwort-2027!' })).status, 303);
  assert.equal(loc(await c.req('/portal/projekte')), '/portal/login', 'Sitzung nach Rücksetzung beendet');
  assert.equal((await new Client().login('doppel@demo.invalid', 'Zwei-Rollen-2026!')).status, 401);
  assert.equal(loc(await new Client().login('doppel@demo.invalid', 'Neues-Passwort-2027!')), '/portal/projekte');
});

test('Abgelaufene oder widerrufene Einladung ist unbrauchbar', async () => {
  const csrf = await dirk.csrf('/portal/admin/benutzer/neu');
  const t = token(await (await dirk.form('/portal/admin/benutzer/neu', { _csrf: csrf, name: 'Ablauf', email: 'ablauf@demo.invalid', roles: 'technik' })).text());
  const inv = db.invitations.find((i) => i.userId === userBy('ablauf@demo.invalid').id);
  inv.expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.equal(await status(new Client(), `/portal/aktivieren?t=${t}`), 410);
  assert.equal(await status(new Client(), '/portal/aktivieren?t=erfunden-erfunden-erfunden-erfunden-123'), 410);
  const { body } = await dirk.text('/portal/admin/einladungen');
  assert.match(body, /abgelaufen/);
});

test('Kontosperre nach wiederholten Fehlversuchen (am Konto gespeichert)', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await new Client().login('ablauf@demo.invalid', `falsch-${i}-xxxxxxxx`)).status, 401);
  const x = userBy('ablauf@demo.invalid');
  assert.ok(Date.parse(x.lockedUntil) > Date.now(), 'vorläufige Sperre gesetzt');
  // auch Dirk: nach Sperre selbst mit richtigem Passwort 429
  const target = userBy('markus@demo.invalid');
  for (let i = 0; i < 5; i++) await new Client().login('markus@demo.invalid', `falsch-${i}-yyyyyyyy`);
  assert.equal((await new Client().login('markus@demo.invalid')).status, 429);
  const csrf = await dirk.csrf(`/portal/admin/benutzer/${target.id}`);
  await dirk.form(`/portal/admin/benutzer/${target.id}/entsperren`, { _csrf: csrf });
  assert.equal((await new Client().login('markus@demo.invalid')).status, 303, 'Administration hebt die vorläufige Sperre auf');
});

test('Kontenabgleich aus der Umgebung lässt in der Verwaltung angelegte Konten unberührt', async () => {
  const { syncAccounts } = await import('../src/lib/bootstrap.mjs');
  process.env.BESS_ACCOUNTS = JSON.stringify({ users: [{ id: 'u-admin', email: 'admin@demo.invalid', pw: userBy('admin@demo.invalid').pw, mustChangePassword: false }] });
  try { syncAccounts(db); } finally { delete process.env.BESS_ACCOUNTS; }
  assert.equal(userBy('test.investor@demo.invalid').active, true);
  assert.match(userBy('test.investor@demo.invalid').pw, /^scrypt\$/);
  assert.equal(userBy('investor.a@demo.invalid').active, false, 'nicht provisionierte Altkonten werden weiterhin gesperrt');
});
