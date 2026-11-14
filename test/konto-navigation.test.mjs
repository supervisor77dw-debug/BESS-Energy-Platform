// UI-Korrektur (AW-STROMKAI-20261030-UI-NAVIGATION-PASSWORT-019): Passwortänderung unter Benutzer & Berechtigungen →
// Plattform-Administration → Eigenes Konto statt im Kopfbereich; responsive Seitenleiste ohne feste schmale Breite.
// Regressionstests: nur das eigene Konto, unveränderte Prüfregeln und Hashes, keine Rollen- oder Rechteänderung,
// Funktion für Administration und eingeschränkte Rollen erreichbar.
// Aufruf: node --test test/konto-navigation.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = mkdtempSync(join(tmpdir(), 'bess-konto-'));
process.env.BESS_DATA_DIR = DIR;
process.env.BESS_PREVIEW_HELPERS = '0';
delete process.env.BESS_MFA;
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
  form(path, fields) { return this.req(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() }); }
  async login(email, password = PW) {
    const { body } = await this.text('/portal/login');
    return this.form('/portal/anmelden', { _t: /name="_t" value="([^"]+)"/.exec(body)[1], email, password });
  }
}
const csrfAus = (html) => /name="_csrf" value="([^"]+)"/.exec(html)[1];
const userBy = (email) => db.users.find((x) => x.email === email);
const kopf = (html) => /<header class="top">([\s\S]*?)<\/header>/.exec(html)[1];
const nav = (html) => /<nav class="rail"[\s\S]*?<\/nav>/.exec(html)[0];
const NEU = 'Neues-Eigenes-Kennwort-2026!';

test('Kopfbereich: nur Name und Rolle, kein Link „Passwort ändern“ (Administration und eingeschränkte Rollen)', async () => {
  for (const email of ['admin@demo.invalid', 'markus@demo.invalid', 'eigentuemer.a@demo.invalid', 'investor.a@demo.invalid']) {
    const c = new Client(); await c.login(email);
    const { body } = await c.text('/portal');
    const k = kopf(body);
    assert.doesNotMatch(k, /Passwort|\/portal\/passwort|\/portal\/konto/, `${email}: keine Passwortfunktion im Kopfbereich`);
    assert.match(k, new RegExp(userBy(email).name.replace(/[()]/g, '.')), `${email}: Name sichtbar`);
    assert.match(k, /<span class="who"><strong>[^<]+<\/strong><span>[^<]+<\/span><\/span>/, `${email}: Rolle ohne weitere Links`);
  }
});

test('Administration: Benutzer & Berechtigungen → Eigenes Konto, Menüpunkt bleibt hervorgehoben', async () => {
  const c = new Client(); await c.login('admin@demo.invalid');
  const { body: ben } = await c.text('/portal/admin/benutzer');
  assert.match(ben, /<nav class="tabs" aria-label="Benutzerverwaltung">[\s\S]*href="\/portal\/konto">Eigenes Konto<\/a>/);
  const { r, body } = await c.text('/portal/konto');
  assert.equal(r.status, 200);
  assert.match(body, /Benutzer &amp; Berechtigungen › Plattform-Administration › Eigenes Konto/);
  assert.match(body, /href="\/portal\/konto" aria-current="page">Eigenes Konto/, 'Reiter aktiv');
  assert.match(nav(body), /href="\/portal\/admin\/benutzer" aria-current="page"/, 'Seitenleiste: Benutzer & Berechtigungen aktiv');
  assert.equal((nav(body).match(/aria-current="page"/g) || []).length, 1, 'genau ein aktiver Menüpunkt');
  assert.match(body, /<form method="post" action="\/portal\/konto" class="stack">[\s\S]*name="current"[\s\S]*name="neu"[\s\S]*name="neu2"/);
  assert.doesNotMatch(body, /name="userId"|<select[^>]*name="user/, 'keine Auswahl eines anderen Kontos');
});

test('Eingeschränkte Rollen: Eigenes Konto über das Menü erreichbar, keine Benutzerverwaltung', async () => {
  for (const email of ['markus@demo.invalid', 'eigentuemer.a@demo.invalid', 'investor.a@demo.invalid', 'gemeinde@demo.invalid']) {
    const c = new Client(); await c.login(email);
    const { body: home } = await c.text('/portal');
    assert.match(nav(home), /href="\/portal\/konto"><svg[\s\S]*?<span>Eigenes Konto<\/span>/, `${email}: Menüpunkt`);
    const { r, body } = await c.text('/portal/konto');
    assert.equal(r.status, 200, email);
    assert.match(nav(body), /href="\/portal\/konto" aria-current="page"/, `${email}: aktiv`);
    assert.doesNotMatch(body, /aria-label="Benutzerverwaltung"/, `${email}: keine Reiter der Benutzerverwaltung`);
    assert.ok([403, 404].includes((await c.req('/portal/admin/benutzer')).status), `${email}: Benutzerverwaltung gesperrt`);
  }
});

test('Bisherige Adresse /portal/passwort führt ohne Pflichtwechsel zum eigenen Konto', async () => {
  const c = new Client(); await c.login('technik@demo.invalid');
  const r = await c.req('/portal/passwort');
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/portal/konto');
});

test('Passwort ändern im eigenen Konto: bestehende Prüfregeln, Hash, Audit; Rollen und Rechte unverändert', async () => {
  const c = new Client(); await c.login('eigentuemer.b@demo.invalid');
  const u = userBy('eigentuemer.b@demo.invalid');
  const vorher = JSON.stringify({ role: u.role, roles: u.roles, projects: u.projects, contactId: u.contactId, active: u.active, grants: db.grants?.filter((g) => g.userId === u.id) });
  const altHash = u.pw;
  const { body } = await c.text('/portal/konto');
  const t = csrfAus(body);
  assert.equal((await c.form('/portal/konto', { current: PW, neu: NEU, neu2: NEU })).status, 403, 'ohne CSRF-Token abgewiesen');
  const falsch = await c.form('/portal/konto', { _csrf: t, current: 'falsch-falsch-falsch', neu: NEU, neu2: NEU });
  assert.equal(falsch.status, 401); assert.match(await falsch.text(), /Das bisherige Passwort ist nicht korrekt/);
  assert.equal((await c.form('/portal/konto', { _csrf: t, current: PW, neu: 'kurz', neu2: 'kurz' })).status, 422, 'Mindestlänge');
  assert.equal((await c.form('/portal/konto', { _csrf: t, current: PW, neu: NEU, neu2: NEU + 'x' })).status, 422, 'Wiederholung muss übereinstimmen');
  assert.equal(u.pw, altHash, 'abgewiesene Versuche ändern nichts');
  const ok = await c.form('/portal/konto', { _csrf: t, current: PW, neu: NEU, neu2: NEU });
  assert.equal(ok.status, 303); assert.equal(ok.headers.get('location'), '/portal/konto?m=passwort');
  assert.match((await c.text('/portal/konto?m=passwort')).body, /Passwort geändert/);
  assert.notEqual(u.pw, altHash); assert.match(u.pw, /^scrypt\$/, 'weiterhin scrypt-Hash'); assert.ok(!u.pw.includes(NEU), 'kein Klartext');
  assert.ok(u.passwordChangedAt);
  assert.equal(JSON.stringify({ role: u.role, roles: u.roles, projects: u.projects, contactId: u.contactId, active: u.active, grants: db.grants?.filter((g) => g.userId === u.id) }), vorher, 'Rollen, Projekte und Rechte unverändert');
  assert.ok(db.audit.some((a) => a.action === 'passwort_geaendert' && a.userId === u.id) || JSON.stringify(db.audit).includes('passwort_geaendert'), 'Änderung protokolliert');
  assert.equal((await new Client().login('eigentuemer.b@demo.invalid', PW)).status, 401, 'altes Passwort ungültig');
  assert.equal((await new Client().login('eigentuemer.b@demo.invalid', NEU)).status, 303, 'neues Passwort gilt');
});

test('Kein Zugriff auf fremde Passwörter: userId im Formular wird ignoriert, keine Hashes in der Ausgabe', async () => {
  const admin = new Client(); await admin.login('admin@demo.invalid');
  const a = userBy('admin@demo.invalid'), fremd = userBy('projektleitung@demo.invalid');
  const fremdHash = fremd.pw, adminHash = a.pw;
  const { body } = await admin.text('/portal/konto');
  for (const x of db.users) assert.ok(!body.includes(x.pw), 'kein Passwort-Hash in der Seite');
  assert.doesNotMatch(body, new RegExp(fremd.email.replace('.', '\\.')), 'keine Daten anderer Konten');
  // Versuch, über das eigene Konto ein fremdes Passwort zu setzen: wirkt nur auf das angemeldete Konto oder gar nicht
  const r = await admin.form('/portal/konto', { _csrf: csrfAus(body), userId: fremd.id, email: fremd.email, current: 'nicht-das-richtige', neu: NEU, neu2: NEU });
  assert.equal(r.status, 401);
  assert.equal(fremd.pw, fremdHash, 'fremdes Konto unverändert'); assert.equal(a.pw, adminHash);
  const r2 = await admin.form('/portal/konto', { _csrf: csrfAus(body), userId: fremd.id, current: PW, neu: NEU, neu2: NEU });
  assert.equal(r2.status, 303);
  assert.equal(fremd.pw, fremdHash, 'fremdes Konto weiterhin unverändert'); assert.notEqual(a.pw, adminHash, 'nur das eigene Konto geändert');
});

test('Seitenleiste: keine feste schmale Breite, einzeilige Beschriftungen, Menüschalter, einklappbar mit Tooltip', async () => {
  const css = readFileSync(join(ROOT, 'static/css/portal.css'), 'utf8');
  const js = readFileSync(join(ROOT, 'static/js/portal.js'), 'utf8');
  assert.doesNotMatch(css, /grid-template-columns: 76px|--rail-w: clamp/, 'keine feste Spaltenbreite');
  assert.match(css, /\.app \{ display: grid; grid-template-columns: auto minmax\(0, 1fr\)/, 'Spalte bemisst sich am Inhalt');
  assert.match(css, /\.rail \{ width: max-content; min-width: 220px/);
  assert.match(css, /\.rail a span, \.rail-group-title, \.rail-collapse span \{ white-space: nowrap; \}/, 'kein ungewollter Umbruch');
  assert.match(css, /\.rail \{[^}]*overflow-y: auto/, 'senkrechter Bildlauf bei geringer Höhe');
  assert.match(css, /\.rail-tip \{ position: fixed/, 'Tooltip außerhalb des Bildlaufbereichs');
  assert.match(js, /matchMedia\('\(min-width: 900px\) and \(max-width: 1199px\)'\)/, 'automatisch eingeklappt bei mittlerer Breite');
  const c = new Client(); await c.login('admin@demo.invalid', NEU); // Passwort im vorigen Test geändert
  const { body } = await c.text('/portal/zentrale');
  const n = nav(body);
  assert.match(n, /<button class="rail-menu" type="button" aria-expanded="false" aria-controls="portalnavigation">Menü<\/button>/);
  assert.match(n, /<button class="rail-collapse" type="button" aria-pressed="false">/);
  const labels = [...n.matchAll(/<a href="[^"]+"(?: aria-current="page")?><svg[\s\S]*?<\/svg><span>([^<]+)<\/span><\/a>/g)].map((m) => m[1]);
  assert.ok(labels.length >= 20, `alle Menüpunkte mit Beschriftung (${labels.length})`);
  assert.equal((n.match(/aria-current="page"/g) || []).length, 1, 'genau ein aktiver Menüpunkt');
});
