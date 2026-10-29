// Tests der EXTERNEN Vorschau-Konfiguration (eigener Serverprozess wie im Betrieb):
// Zugangsschranke, keine Demo-Zugangsdaten, MFA-Ersteinrichtung, Sitzungsablauf, Logout, gleichzeitige Nutzer,
// Upload-/Download-Sicherheit, Sicherung und Wiederherstellung. Aufruf: node --test test/external.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { totp } from '../src/lib/auth.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = mkdtempSync(join(tmpdir(), 'bess-ext-'));
const RUNTIME = join(TMP, 'runtime'), OUT = join(TMP, 'zugaenge'), BACKUPS = join(TMP, 'backups');
const PORT = 4730 + Math.floor(Math.random() * 50);
const base = `http://127.0.0.1:${PORT}`;
let srv, creds = {}, gate = {};

function startServer() {
  srv = spawn(process.execPath, [join(ROOT, 'server.mjs')], { env: { ...process.env, BESS_PORT: String(PORT), BESS_DATA_DIR: RUNTIME, BESS_GATE: '1', BESS_TRUST_PROXY: '1', BESS_SECURE_COOKIES: '1', BESS_IDLE_TTL_MS: '4000', BESS_MFA: 'konto' }, stdio: 'ignore' });
  return new Promise((r) => setTimeout(r, 1200));
}
const stopServer = () => new Promise((r) => { srv.once('exit', r); srv.kill(); });

before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'tools', 'provision-preview.mjs'), '--runtime', RUNTIME, '--out', OUT], { stdio: 'ignore' });
  const txt = readFileSync(join(OUT, readdirSync(OUT).find((f) => f.startsWith('ZUGAENGE'))), 'utf8');
  for (const m of txt.matchAll(/Prüferkennung: (\w+)\s+Passwort: (\S+)/g)) gate[m[1]] = m[2];
  for (const m of txt.matchAll(/(\S+@\S+\.invalid)\s+Passwort: (\S+)/g)) creds[m[1]] = m[2];
  await startServer();
});
after(async () => { await stopServer(); rmSync(TMP, { recursive: true, force: true }); });

let ipCounter = 10;
class Client {
  constructor() { this.jar = {}; this.ip = `198.51.100.${ipCounter++}`; }
  get cookie() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(path, opts = {}) {
    const r = await fetch(base + path, { redirect: 'manual', ...opts, headers: { 'x-forwarded-for': this.ip, ...(opts.headers || {}), cookie: this.cookie } });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (v) this.jar[k] = v; else delete this.jar[k]; }
    return r;
  }
  form(path, fields) { return this.req(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() }); }
  async page(path) { const r = await this.req(path); return { r, body: await r.text() }; }
  async passGate(user = 'dirk') {
    const { body } = await this.page('/_vorschau/anmelden');
    const t = /name="_t" value="([^"]+)"/.exec(body)[1];
    return this.form('/_vorschau/anmelden', { _t: t, next: '/', user, password: gate[user] });
  }
  async login(email, { secretRef } = {}) {
    const { body } = await this.page('/portal/login');
    const t = /name="_t" value="([^"]+)"/.exec(body)[1];
    const r = await this.form('/portal/anmelden', { _t: t, email, password: creds[email] });
    if (r.headers.get('location') !== '/portal/mfa') return r;
    const mfa = await this.page('/portal/mfa');
    const csrf = /name="_csrf" value="([^"]+)"/.exec(mfa.body)[1];
    const secret = secretRef?.secret || /<code>([A-Z2-7 ]+)<\/code>/.exec(mfa.body)?.[1]?.replace(/ /g, '');
    if (secretRef) secretRef.secret = secret;
    return this.form('/portal/mfa', { _csrf: csrf, code: totp(secret) });
  }
}

test('Provisionierung erzeugt Zugänge außerhalb des Quellcodes', () => {
  assert.ok(gate.dirk && gate.markus, 'Schrankenzugänge für Dirk und Markus');
  assert.ok(creds['dirk@bess-vorschau.invalid'] && creds['markus@bess-vorschau.invalid']);
  const src = readFileSync(join(ROOT, 'data', 'seed.mjs'), 'utf8') + readFileSync(join(ROOT, 'src', 'portal', 'routes.mjs'), 'utf8');
  for (const p of [...Object.values(gate), ...Object.values(creds)]) assert.ok(!src.includes(p), 'kein generiertes Passwort im Quellcode');
  const gj = readFileSync(join(RUNTIME, 'gate.json'), 'utf8');
  assert.ok(!gj.includes(gate.dirk) && gj.includes('scrypt$'), 'gate.json enthält nur Hashes');
});

test('Ohne Schrankenzugang ist nichts erreichbar – auch nicht Bilder, robots.txt oder Formulare', async () => {
  const c = new Client();
  for (const p of ['/', '/grundstueckseigentuemer', '/portal/login', '/robots.txt', '/sitemap.xml', '/projekte']) {
    const r = await c.req(p);
    assert.equal(r.status, 303, p);
    assert.match(r.headers.get('location'), /^\/_vorschau\/anmelden/);
  }
  assert.equal((await c.req('/static/img/hero.svg')).status, 401);
  assert.equal((await c.req('/static/js/site.js')).status, 401);
  assert.equal((await c.form('/kontakt', { name: 'x' })).status, 401);
  assert.equal((await c.req('/static/css/portal.css')).status, 200, 'Stylesheet der Schrankenseite');
});

test('Schrankenseite: noindex, keine Demo-Zugangsdaten, falsches Passwort abgelehnt, Sperre nach Fehlversuchen', async () => {
  const c = new Client();
  const { r, body } = await c.page('/_vorschau/anmelden');
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  assert.ok(!/demo\.invalid|Vorschau!Speicher|Passwort für alle/.test(body));
  const t = /name="_t" value="([^"]+)"/.exec(body)[1];
  assert.equal((await c.form('/_vorschau/anmelden', { _t: t, user: 'dirk', password: 'falsch' })).status, 401);
  let last;
  for (let i = 0; i < 11; i++) last = await c.form('/_vorschau/anmelden', { _t: t, user: 'markus', password: 'x' + i });
  assert.equal(last.status, 429);
});

test('Mit Schrankenzugang: Cookie sicher gesetzt, Website und Login ohne Demo-Zugänge', async () => {
  const c = new Client();
  const r = await c.passGate('markus');
  assert.equal(r.status, 303);
  const sc = r.headers.getSetCookie().join(';');
  assert.match(sc, /bess_gate=.*HttpOnly; SameSite=Lax; Secure/);
  const home = await c.page('/');
  assert.equal(home.r.status, 200);
  assert.match(home.r.headers.get('x-robots-tag'), /noindex/);
  const login = await c.page('/portal/login');
  assert.ok(!/Demo-Zugänge|Vorschau!Speicher|demo\.invalid/.test(login.body), 'Login zeigt keine Zugangsdaten');
  assert.match(await (await c.req('/robots.txt')).text(), /Disallow: \//);
});

test('Portal-Login allein reicht nicht: ohne Schranke kein Portal, auch mit gültiger Portal-Sitzung', async () => {
  const c = new Client();
  await c.passGate('dirk');
  await c.login('eigentuemer.a@demo.invalid');
  assert.equal((await c.req('/portal')).status, 200);
  delete c.jar.bess_gate;
  assert.equal((await c.req('/portal')).status, 303);
  const dl = await c.req('/portal/dokumente/d-n01-own-a-vertrag/download');
  assert.equal(dl.status, 303); assert.match(dl.headers.get('location'), /^\/_vorschau\/anmelden/);
});

test('MFA wird bei der ersten Anmeldung eingerichtet und danach erzwungen (Markus, Dirk)', async () => {
  for (const email of ['markus@bess-vorschau.invalid', 'dirk@bess-vorschau.invalid']) {
    const c = new Client(); await c.passGate('dirk');
    const ref = {};
    const { body } = await c.page('/portal/login');
    const t = /name="_t" value="([^"]+)"/.exec(body)[1];
    assert.equal((await c.form('/portal/anmelden', { _t: t, email, password: creds[email] })).headers.get('location'), '/portal/mfa');
    assert.equal((await c.req('/portal')).headers.get('location'), '/portal/mfa', 'vor MFA kein Zugriff');
    const enroll = await c.page('/portal/mfa');
    assert.match(enroll.body, /Zweiten Faktor einrichten/); assert.match(enroll.body, /data:image\/gif;base64/);
    const csrf = /name="_csrf" value="([^"]+)"/.exec(enroll.body)[1];
    ref.secret = /<code>([A-Z2-7 ]+)<\/code>/.exec(enroll.body)[1].replace(/ /g, '');
    assert.equal((await c.form('/portal/mfa', { _csrf: csrf, code: '123456' })).status, 401);
    assert.equal((await c.form('/portal/mfa', { _csrf: csrf, code: totp(ref.secret) })).status, 303);
    assert.equal((await c.req('/portal')).status, 200);
    // zweite Anmeldung: kein erneutes Einrichten, Code erforderlich
    const c2 = new Client(); await c2.passGate('dirk');
    const lp = await c2.page('/portal/login');
    await c2.form('/portal/anmelden', { _t: /name="_t" value="([^"]+)"/.exec(lp.body)[1], email, password: creds[email] });
    const m2 = await c2.page('/portal/mfa');
    assert.match(m2.body, /Zweiter Faktor/); assert.ok(!m2.body.includes(ref.secret), 'Geheimnis wird nicht erneut angezeigt');
    const csrf2 = /name="_csrf" value="([^"]+)"/.exec(m2.body)[1];
    assert.equal((await c2.form('/portal/mfa', { _csrf: csrf2, code: totp(ref.secret) })).status, 303);
  }
});

test('Rollentrennung hinter der Schranke: Eigentümerin B sieht nur ihr Projekt', async () => {
  const c = new Client(); await c.passGate('markus');
  await c.login('eigentuemer.b@demo.invalid');
  assert.equal((await c.req('/portal/projekte/p-n02')).status, 200);
  assert.equal((await c.req('/portal/projekte/p-n01')).status, 404);
  assert.equal((await c.req('/portal/admin')).status, 404);
});

test('Sitzungsablauf nach Leerlauf und Logout beenden die Sitzung serverseitig', async () => {
  const c = new Client(); await c.passGate('dirk');
  await c.login('gemeinde@demo.invalid');
  assert.equal((await c.req('/portal')).status, 200);
  await new Promise((r) => setTimeout(r, 4500));
  assert.equal((await c.req('/portal')).headers.get('location'), '/portal/login', 'Leerlauf-Ablauf');
  await c.login('gemeinde@demo.invalid');
  const page = await c.page('/portal');
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page.body)[1];
  const sid = c.jar.bess_sid;
  await c.form('/portal/abmelden', { _csrf: csrf });
  const r = await fetch(base + '/portal', { redirect: 'manual', headers: { cookie: `bess_gate=${c.jar.bess_gate}; bess_sid=${sid}`, 'x-forwarded-for': c.ip } });
  assert.equal(r.headers.get('location'), '/portal/login', 'alte Sitzungs-ID ist ungültig');
  const g = await c.req('/_vorschau/abmelden');
  assert.equal(g.status, 303);
  assert.equal((await c.req('/')).status, 303, 'Schranke nach Abmeldung wieder aktiv');
});

test('Gleichzeitige Nutzer: 40 parallele Sitzungen ohne Fehler und ohne Vermischung', async () => {
  const roles = [['eigentuemer.a@demo.invalid', 'd-n01-own-a-vertrag', 'd-n02-own-b-vertrag'], ['eigentuemer.b@demo.invalid', 'd-n02-own-b-vertrag', 'd-n01-own-a-vertrag'], ['technik@demo.invalid', 'd-n02-tech-spec', 'd-n01-kom-brand'], ['gemeinde@demo.invalid', 'd-n01-kom-brand', 'd-n02-tech-spec']];
  const t0 = Date.now();
  const runs = await Promise.all(Array.from({ length: 40 }, async (_, i) => {
    const [email, own, foreign] = roles[i % roles.length];
    const c = new Client(); await c.passGate(i % 2 ? 'dirk' : 'markus');
    await c.login(email);
    const a = await c.req(`/portal/dokumente/${own}/download`); await a.arrayBuffer();
    const b = await c.req(`/portal/dokumente/${foreign}/download`); await b.text();
    const p = await c.req('/portal'); await p.text();
    return [a.status, b.status, p.status];
  }));
  assert.ok(runs.every(([a, b, p]) => a === 200 && b === 404 && p === 200), JSON.stringify(runs.filter(([a, b, p]) => !(a === 200 && b === 404 && p === 200))));
  assert.ok(Date.now() - t0 < 30000, `Dauer ${Date.now() - t0} ms`);
});

test('Uploads: SVG/HTML abgelehnt, Übergröße abgelehnt; Downloads als Anhang ohne Zwischenspeicher', async () => {
  const c = new Client(); await c.passGate('dirk');
  await c.login('eigentuemer.a@demo.invalid');
  const page = await c.page('/portal/dokumente');
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page.body)[1];
  const up = (blob, name) => { const fd = new FormData(); fd.set('_csrf', csrf); fd.set('projectId', 'p-n01'); fd.set('title', 't'); fd.set('file', blob, name); return c.req('/portal/dokumente/hochladen', { method: 'POST', body: fd }); };
  assert.equal((await up(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>']), 'x.svg')).headers.get('location'), '/portal/dokumente?m=typ');
  assert.equal((await up(new Blob(['<html><script>alert(1)</script>']), 'x.pdf')).headers.get('location'), '/portal/dokumente?m=typ');
  const big = Buffer.alloc(11 * 1024 * 1024); big.write('%PDF-1.4');
  assert.equal((await up(new Blob([big]), 'gross.pdf')).status, 413);
  const d = await c.req('/portal/dokumente/d-n01-own-a-vertrag/download');
  assert.equal(d.status, 200);
  assert.match(d.headers.get('content-disposition'), /^attachment;/);
  assert.equal(d.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(d.headers.get('cache-control'), 'no-store');
  assert.equal(d.headers.get('content-type'), 'application/pdf');
});

test('Testumgebung ist wiederherstellbar (Sicherung → Änderung → Wiederherstellung)', async () => {
  const name = execFileSync(process.execPath, [join(ROOT, 'tools', 'backup-runtime.mjs'), '--runtime', RUNTIME, '--backups', BACKUPS]).toString().trim();
  const c = new Client(); await c.passGate('dirk');
  await c.login('eigentuemer.a@demo.invalid');
  const page = await c.page('/portal/nachrichten');
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page.body)[1];
  await c.form('/portal/nachrichten', { _csrf: csrf, t: 'p-n01:u-own-a', text: 'Nachricht nach der Sicherung' });
  assert.match(readFileSync(join(RUNTIME, 'db.json'), 'utf8'), /Nachricht nach der Sicherung/);
  await stopServer();
  execFileSync(process.execPath, [join(ROOT, 'tools', 'backup-runtime.mjs'), '--runtime', RUNTIME, '--backups', BACKUPS, '--restore', name]);
  await startServer();
  assert.ok(!readFileSync(join(RUNTIME, 'db.json'), 'utf8').includes('Nachricht nach der Sicherung'));
  const c2 = new Client(); assert.equal((await c2.passGate('dirk')).status, 303, 'Schranke nach Wiederherstellung funktionsfähig');
});
