// End-to-End-Tests über HTTP: Authentifizierung, MFA, Rollen, Mandanten-/Projekttrennung, Dokumentzugriffe,
// Freigaben, öffentliche Formulare und Sicherheitsheader. Aufruf: node --test test/platform.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = mkdtempSync(join(tmpdir(), 'bess-test-'));
process.env.BESS_DATA_DIR = DIR;
process.env.BESS_PREVIEW_HELPERS = '0';
const PW = 'Vorschau!Speicher-2026';

let server, base, totp, db;
before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'data', 'seed.mjs'), DIR]);
  const store = await import('../src/lib/store.mjs');
  db = await store.openStore(DIR);
  ({ totp } = await import('../src/lib/auth.mjs'));
  const { createApp } = await import('../server.mjs');
  server = createApp();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); rmSync(DIR, { recursive: true, force: true }); });

// ---------- Hilfen ----------
class Client {
  constructor() { this.cookie = ''; }
  async req(path, opts = {}) {
    const res = await fetch(base + path, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(this.cookie ? { cookie: this.cookie } : {}) } });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    return res;
  }
  async text(path) { const r = await this.req(path); return { r, body: await r.text() }; }
  async form(path, fields) { return this.req(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() }); }
  async csrf() { const { body } = await this.text('/portal'); return /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; }
}
const tokenFrom = (html) => /name="_t" value="([^"]+)"/.exec(html)[1];

async function login(email, { pw = PW } = {}) {
  const c = new Client();
  const { body } = await c.text('/portal/login');
  const r = await c.form('/portal/anmelden', { _t: tokenFrom(body), email, password: pw });
  if (r.headers.get('location') === '/portal/mfa') {
    const u = db.users.find((x) => x.email === email);
    const page = await (await c.req('/portal/mfa')).text();
    const csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
    const r2 = await c.form('/portal/mfa', { _csrf: csrf, code: totp(u.totp) });
    assert.equal(r2.status, 303);
  } else assert.equal(r.status, 303, `Login fehlgeschlagen für ${email}`);
  return c;
}
const status = async (c, path) => (await c.req(path)).status;

// ---------- Öffentlicher Bereich ----------
test('öffentliche Seiten sind erreichbar und tragen Sicherheitsheader', async () => {
  for (const p of ['/', '/unternehmen', '/technologie', '/standortentwicklung', '/grundstueckseigentuemer', '/investoren', '/kommunen', '/projekte', '/kontakt', '/standort-anbieten', '/impressum', '/datenschutz']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.match(r.headers.get('x-robots-tag'), /noindex/, 'Vorschau ist nicht indexierbar');
  }
});

test('robots.txt sperrt die Vorschau vollständig', async () => {
  assert.match(await (await fetch(base + '/robots.txt')).text(), /Disallow: \/\n/);
});

test('Projektseite zeigt keine nicht freigegebenen Projekte und keine internen Daten', async () => {
  const body = await (await fetch(base + '/projekte')).text();
  assert.match(body, /keine Projekte zur Veröffentlichung freigegeben/);
  for (const secret of ['DEMO-N01', 'Demo-Standort', 'Musterkreis', 'CAPEX', 'Eigentümer A']) assert.ok(!body.includes(secret), secret);
});

test('keine öffentlichen Behauptungen zu Partnern, Renditen oder festen Pachtbeträgen', async () => {
  for (const p of ['/', '/unternehmen', '/investoren', '/grundstueckseigentuemer', '/standortentwicklung', '/kommunen', '/technologie', '/standort-anbieten']) {
    const body = await (await fetch(base + p)).text();
    assert.ok(!/EUR\/ha|€ ?pro Hektar|IRR|Rendite von|risikolos|garantiert|geräuschlos|vollständig unversiegelt|versiegelungsfrei/i.test(body), `unzulässige Aussage auf ${p}`);
  }
});

test('Statische Dateien: kein Pfad-Ausbruch', async () => {
  assert.equal((await fetch(base + '/static/..%2F..%2Fdata%2Fruntime%2Fdb.json')).status, 404);
  assert.equal((await fetch(base + '/static/%2e%2e/server.mjs')).status, 404);
});

test('Formular Fläche anbieten: Validierung, Bot-Schutz, Speicherung ohne Angebot', async () => {
  const html = await (await fetch(base + '/standort-anbieten')).text();
  const t = tokenFrom(html);
  await new Promise((r) => setTimeout(r, 1600));
  const bad = new FormData(); bad.set('_t', t); bad.set('name', '');
  assert.equal((await fetch(base + '/standort-anbieten', { method: 'POST', body: bad, redirect: 'manual' })).status, 422);
  const before = db.inquiries.length;
  const ok = new FormData();
  Object.entries({ _t: t, name: 'Test Landwirt', email: 'test@example.invalid', lage: 'Testgemeinde', nutzung: 'Acker', umspannwerk: 'unter 1 km', dsgvo: 'ja' }).forEach(([k, v]) => ok.set(k, v));
  ok.set('datei', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), 'lageplan.pdf');
  const r = await fetch(base + '/standort-anbieten', { method: 'POST', body: ok, redirect: 'manual' });
  assert.equal(r.status, 303);
  assert.equal(db.inquiries.length, before + 1);
  assert.equal(db.inquiries.at(-1).status, 'neu');
  const exe = new FormData();
  Object.entries({ _t: t, name: 'X', email: 'x@example.invalid', lage: 'Y', dsgvo: 'ja' }).forEach(([k, v]) => exe.set(k, v));
  exe.set('datei', new Blob([Buffer.from('MZ\x90\x00 executable')]), 'tool.pdf');
  assert.equal((await fetch(base + '/standort-anbieten', { method: 'POST', body: exe, redirect: 'manual' })).status, 422, 'getarnte EXE wird abgelehnt');
  const hp = new FormData(); hp.set('_t', t); hp.set('firma', 'bot'); hp.set('name', 'Bot');
  const n = db.inquiries.length;
  await fetch(base + '/standort-anbieten', { method: 'POST', body: hp, redirect: 'manual' });
  assert.equal(db.inquiries.length, n, 'Honeypot verwirft Bot');
});

// ---------- Authentifizierung ----------
test('Portal ohne Anmeldung leitet zur Anmeldung und ist nicht indexierbar', async () => {
  const r = await fetch(base + '/portal/dokumente', { redirect: 'manual' });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/portal/login');
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('falsches Passwort wird abgelehnt, Cookie ist HttpOnly/SameSite', async () => {
  const c = new Client();
  const { body } = await c.text('/portal/login');
  const r = await c.form('/portal/anmelden', { _t: tokenFrom(body), email: 'investor.a@demo.invalid', password: 'falsch' });
  assert.equal(r.status, 401);
  const r2 = await c.form('/portal/anmelden', { _t: tokenFrom(body), email: 'eigentuemer.a@demo.invalid', password: PW });
  assert.match(r2.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
});

test('MFA ist für Investoren Pflicht: ohne Code kein Zugriff', async () => {
  const c = new Client();
  const { body } = await c.text('/portal/login');
  const r = await c.form('/portal/anmelden', { _t: tokenFrom(body), email: 'investor.a@demo.invalid', password: PW });
  assert.equal(r.headers.get('location'), '/portal/mfa');
  assert.equal((await c.req('/portal/dokumente')).headers.get('location'), '/portal/mfa');
  const page = await (await c.req('/portal/mfa')).text();
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  assert.equal((await c.form('/portal/mfa', { _csrf: csrf, code: '000000' })).status, 401);
});

test('Anmeldung wird nach wiederholten Fehlversuchen begrenzt', async () => {
  const c = new Client();
  const { body } = await c.text('/portal/login');
  let last;
  for (let i = 0; i < 8; i++) last = await c.form('/portal/anmelden', { _t: tokenFrom(body), email: 'unbekannt@demo.invalid', password: 'x' + i });
  assert.equal(last.status, 429);
});

// ---------- Rollen und Trennung ----------
test('Investor A sieht nur freigeschaltete Projekte und nie fremde Investoren- oder Eigentümerunterlagen', async () => {
  const c = await login('investor.a@demo.invalid');
  assert.equal(await status(c, '/portal/projekte/p-n01'), 200);
  assert.equal(await status(c, '/portal/projekte/p-n02'), 404, 'fremdes Projekt');
  assert.equal(await status(c, '/portal/dokumente/d-n01-inv-teaser/download'), 200);
  for (const id of ['d-n02-inv-teaser', 'd-n01-own-a-vertrag', 'd-n02-own-b-vertrag', 'd-n01-fin-intern', 'd-n01-intern-notiz', 'd-n01-kom-lageplan', 'd-n01-inv-netz-entwurf'])
    assert.equal(await status(c, `/portal/dokumente/${id}/download`), 404, id);
  const docs = await (await c.req('/portal/dokumente')).text();
  assert.ok(!docs.includes('Nord B') && !docs.includes('Optionsvertrag') && !docs.includes('Interne Kalkulation'));
  const proj = await (await c.req('/portal/projekte/p-n01')).text();
  assert.match(proj, /Wirtschaftliche Kennzahlen/);
  assert.match(proj, /Quelle:/); assert.match(proj, /Stand:/); assert.match(proj, /Annahmen/);
  assert.ok(!proj.includes('Gemarkung'), 'keine Grundstücksdaten für Investoren');
  for (const p of ['/portal/pipeline', '/portal/kontakte', '/portal/admin', '/portal/protokoll', '/portal/grundstuecke', '/portal/anfragen'])
    assert.equal(await status(c, p), 404, p);
});

test('Investor B sieht Projekt N01 nicht', async () => {
  const c = await login('investor.b@demo.invalid');
  assert.equal(await status(c, '/portal/projekte/p-n01'), 404);
  assert.equal(await status(c, '/portal/dokumente/d-n01-inv-fin/download'), 404);
  assert.equal(await status(c, '/portal/dokumente/d-n02-inv-teaser/download'), 200);
});

test('Eigentümer sieht nur eigene Flächen und Verträge, keine Kalkulationen', async () => {
  const a = await login('eigentuemer.a@demo.invalid');
  const g = await (await a.req('/portal/grundstuecke')).text();
  assert.match(g, /12\/4/); assert.ok(!g.includes('Demo-Gemarkung 7'), 'fremdes Grundstück');
  assert.equal(await status(a, '/portal/dokumente/d-n01-own-a-vertrag/download'), 200);
  assert.equal(await status(a, '/portal/dokumente/d-n02-own-b-vertrag/download'), 404);
  assert.equal(await status(a, '/portal/dokumente/d-n01-inv-fin/download'), 404);
  assert.equal(await status(a, '/portal/projekte/p-n02'), 404);
  const p = await (await a.req('/portal/projekte/p-n01')).text();
  assert.ok(!p.includes('CAPEX') && !p.includes('Wirtschaftliche Kennzahlen') && !p.includes('Projektgesellschaft'), 'keine internen Kennzahlen');
  const b = await login('eigentuemer.b@demo.invalid');
  assert.equal(await status(b, '/portal/dokumente/d-n01-own-a-vertrag/download'), 404);
});

test('Kommune sieht kommunale Unterlagen, aber keine Investoren- oder Eigentümerdaten', async () => {
  const c = await login('gemeinde@demo.invalid');
  assert.equal(await status(c, '/portal/dokumente/d-n01-kom-brand/download'), 200);
  for (const id of ['d-n01-inv-teaser', 'd-n01-own-info', 'd-n01-own-a-vertrag', 'd-n01-intern-notiz']) assert.equal(await status(c, `/portal/dokumente/${id}/download`), 404, id);
  assert.ok(!(await (await c.req('/portal/projekte/p-n01')).text()).includes('CAPEX'));
});

test('Technischer Partner sieht nur zugewiesene technische Unterlagen', async () => {
  const c = await login('technik@demo.invalid');
  assert.equal(await status(c, '/portal/dokumente/d-n02-tech-spec/download'), 200);
  assert.equal(await status(c, '/portal/dokumente/d-n02-inv-teaser/download'), 404);
  assert.equal(await status(c, '/portal/projekte/p-n01'), 404);
});

test('Vertrieb Nord: Nordprojekte, keine Finanzmodelle, kein Südprojekt', async () => {
  const c = await login('markus@demo.invalid');
  assert.equal(await status(c, '/portal/projekte/p-n02'), 200);
  assert.equal(await status(c, '/portal/projekte/p-s01'), 404);
  assert.equal(await status(c, '/portal/dokumente/d-n01-inv-fin/download'), 404);
  assert.equal(await status(c, '/portal/dokumente/d-n01-fin-intern/download'), 404);
  assert.equal(await status(c, '/portal/dokumente/d-n01-own-a-vertrag/download'), 200);
  assert.equal(await status(c, '/portal/admin'), 404);
  assert.ok(!(await (await c.req('/portal/projekte/p-n01')).text()).includes('CAPEX'));
});

test('Nachrichten: Eigentümer kann nicht in fremde Unterhaltungen schreiben', async () => {
  const b = await login('eigentuemer.b@demo.invalid');
  const csrf = await b.csrf();
  const n = db.messages.length;
  assert.equal((await b.form('/portal/nachrichten', { _csrf: csrf, t: 'p-n01:u-own-a', text: 'Eindringversuch' })).status, 404);
  assert.equal(db.messages.length, n);
  const page = await (await b.req('/portal/nachrichten')).text();
  assert.ok(!page.includes('Wann kommt der Vermesser'), 'fremde Nachricht nicht sichtbar');
});

test('CSRF: POST ohne gültiges Token wird abgelehnt', async () => {
  const c = await login('admin@demo.invalid');
  assert.equal((await c.form('/portal/admin/zugriff', { _csrf: 'falsch', userId: 'u-inv-a', projectId: 'p-n02' })).status, 403);
  assert.ok(!db.grants.some((g) => g.userId === 'u-inv-a' && g.projectId === 'p-n02'));
});

test('Downloads werden protokolliert', async () => {
  const n = db.downloads.length;
  const c = await login('investor.a@demo.invalid');
  await c.req('/portal/dokumente/d-n01-inv-fin/download');
  assert.equal(db.downloads.length, n + 1);
  assert.equal(db.downloads.at(-1).userId, 'u-inv-a');
});

test('Freigabe im Vier-Augen-Prinzip: Entwurf wird erst nach Admin-Entscheidung sichtbar', async () => {
  const inv = await login('investor.a@demo.invalid');
  assert.equal(await status(inv, '/portal/dokumente/d-n01-inv-netz-entwurf/download'), 404);
  const admin = await login('admin@demo.invalid');
  const csrf = await admin.csrf();
  // eigener Antrag darf nicht selbst entschieden werden
  await admin.form('/portal/freigaben/beantragen', { _csrf: csrf, kind: 'project_public', targetId: 'p-n01', publicName: 'Test', summary: 'x' });
  const own = db.approvals.find((a) => a.kind === 'project_public' && a.requestedBy === 'u-admin');
  assert.equal((await admin.form(`/portal/freigaben/${own.id}/entscheiden`, { _csrf: csrf, decision: 'genehmigt' })).status, 403);
  assert.ok(!(await (await fetch(base + '/projekte')).text()).includes('Test'), 'nicht öffentlich ohne Freigabe');
  // fremder Antrag (Projektleitung) wird freigegeben
  assert.equal((await admin.form('/portal/freigaben/ap-1/entscheiden', { _csrf: csrf, decision: 'genehmigt' })).status, 303);
  assert.equal(await status(inv, '/portal/dokumente/d-n01-inv-netz-entwurf/download'), 200);
  const invB = await login('investor.b@demo.invalid');
  assert.equal(await status(invB, '/portal/dokumente/d-n01-inv-netz-entwurf/download'), 404, 'Freigabe gilt nur im Projekt');
});

test('Nicht-Admins können keine Freigaben entscheiden und keine Zugriffe vergeben', async () => {
  const pl = await login('projektleitung@demo.invalid');
  const csrf = await pl.csrf();
  assert.equal((await pl.form('/portal/admin/zugriff', { _csrf: csrf, userId: 'u-inv-b', projectId: 'p-n01' })).status, 404);
  const open = db.approvals.find((a) => a.state === 'offen');
  if (open) assert.equal((await pl.form(`/portal/freigaben/${open.id}/entscheiden`, { _csrf: csrf, decision: 'genehmigt' })).status, 404);
});

test('Zugriff erteilen und entziehen wirkt sofort', async () => {
  const admin = await login('admin@demo.invalid');
  const csrf = await admin.csrf();
  const inv = await login('investor.b@demo.invalid');
  assert.equal(await status(inv, '/portal/projekte/p-n01'), 404);
  await admin.form('/portal/admin/zugriff', { _csrf: csrf, userId: 'u-inv-b', projectId: 'p-n01' });
  assert.equal(await status(inv, '/portal/projekte/p-n01'), 200);
  const g = db.grants.find((x) => x.userId === 'u-inv-b' && x.projectId === 'p-n01');
  await admin.form(`/portal/admin/zugriff/${g.id}/entziehen`, { _csrf: csrf });
  assert.equal(await status(inv, '/portal/projekte/p-n01'), 404);
});

test('Upload Eigentümer: nur eigene Sichtbarkeit, Dateityp geprüft', async () => {
  const a = await login('eigentuemer.a@demo.invalid');
  const csrf = await a.csrf();
  const fd = new FormData(); fd.set('_csrf', csrf); fd.set('projectId', 'p-n01'); fd.set('title', 'Grundbuchauszug');
  fd.set('file', new Blob([Buffer.from('%PDF-1.4 x')]), 'gb.pdf');
  assert.equal((await a.req('/portal/dokumente/hochladen', { method: 'POST', body: fd })).status, 303);
  const d = db.documents.at(-1);
  assert.equal(d.ownerContactId, 'c-own-a'); assert.equal(d.status, 'eingereicht');
  assert.equal(await status(a, `/portal/dokumente/${d.id}/download`), 200);
  const inv = await login('investor.a@demo.invalid');
  assert.equal(await status(inv, `/portal/dokumente/${d.id}/download`), 404);
  const kom = await login('gemeinde@demo.invalid');
  assert.equal(await status(kom, `/portal/dokumente/${d.id}/download`), 404);
  const fd2 = new FormData(); fd2.set('_csrf', csrf); fd2.set('projectId', 'p-n02'); fd2.set('title', 'x'); fd2.set('file', new Blob([Buffer.from('%PDF-1.4 x')]), 'x.pdf');
  assert.equal((await a.req('/portal/dokumente/hochladen', { method: 'POST', body: fd2 })).status, 404, 'Upload in fremdes Projekt');
  const fd3 = new FormData(); fd3.set('_csrf', csrf); fd3.set('projectId', 'p-n01'); fd3.set('title', 'x'); fd3.set('file', new Blob(['<script>alert(1)</script>']), 'x.pdf');
  assert.equal((await a.req('/portal/dokumente/hochladen', { method: 'POST', body: fd3 })).headers.get('location'), '/portal/dokumente?m=typ');
});

test('Ausgaben werden escaped (kein gespeichertes XSS über Nachrichten)', async () => {
  const a = await login('eigentuemer.a@demo.invalid');
  const csrf = await a.csrf();
  await a.form('/portal/nachrichten', { _csrf: csrf, t: 'p-n01:u-own-a', text: '<img src=x onerror=alert(1)>' });
  const m = await login('markus@demo.invalid');
  const page = await (await m.req('/portal/nachrichten?t=p-n01%3Au-own-a')).text();
  assert.ok(page.includes('&lt;img src=x onerror=alert(1)&gt;') && !page.includes('<img src=x'));
});

test('Abmeldung beendet die Sitzung serverseitig', async () => {
  const c = await login('eigentuemer.a@demo.invalid');
  const csrf = await c.csrf();
  const old = c.cookie;
  await c.form('/portal/abmelden', { _csrf: csrf });
  const r = await fetch(base + '/portal', { redirect: 'manual', headers: { cookie: old } });
  assert.equal(r.headers.get('location'), '/portal/login');
});
