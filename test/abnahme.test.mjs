// Öffentlicher Abnahmekandidat (Stufe "abnahme", Vercel-Production-Ziel) mit Blob-Stellvertreter:
// Website ohne Anmeldung, Portale getrennt geschützt, persönliche Konten mit Pflicht-Passwortwechsel und MFA,
// Rollen-Weiterleitung, Kontenabgleich bei neuer Provisionierung, getrennter Speicherbereich.
// Aufruf: node --test test/abnahme.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';

process.env.BESS_STAGE = 'abnahme';
process.env.VERCEL_ENV = 'production';
delete process.env.BESS_GATE;
const { hashPassword, totp } = await import('../src/lib/auth.mjs');

const blobs = new Map(); let n = 0;
class Precondition extends Error { constructor() { super('Precondition failed'); this.name = 'BlobPreconditionFailedError'; } }
globalThis.__bessBlobSdk = {
  async put(path, body, o) { const cur = blobs.get(path); if (cur && o.allowOverwrite === false) throw new Error('exists'); if (o.ifMatch && (!cur || cur.etag !== o.ifMatch)) throw new Precondition(); const etag = `"e${++n}"`; blobs.set(path, { data: Buffer.isBuffer(body) ? body : Buffer.from(body), etag, access: o.access }); return { etag }; },
  async head(path) { const cur = blobs.get(path); if (!cur) { const e = new Error('Vercel Blob: The requested blob does not exist'); e.name = 'BlobError'; throw e; } return { etag: cur.etag }; },
  async get(path) { const cur = blobs.get(path); if (!cur) return null; return { statusCode: 200, stream: Readable.from([cur.data]), blob: { etag: `W/${cur.etag}-http` } }; },
};

const start = { dirk: randomBytes(9).toString('base64url'), markus: randomBytes(9).toString('base64url') };
const accounts = (p) => JSON.stringify({ users: [{ id: 'u-admin', email: 'dirk@stromkai-abnahme.invalid', pw: hashPassword(p.dirk) }, { id: 'u-markus', email: 'markus@stromkai-abnahme.invalid', pw: hashPassword(p.markus) }] });
process.env.BESS_ACCOUNTS = accounts(start);

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
}
const tok = (b, k) => new RegExp(`name="${k}" value="([^"]+)"`).exec(b)?.[1];
const PUBLIC = ['/', '/unternehmen', '/technologie', '/standortentwicklung', '/grundstueckseigentuemer', '/standort-anbieten', '/investoren', '/kommunen', '/projekte', '/kontakt', '/impressum', '/datenschutz'];
const SECRETS = ['Demo-Standort', 'Musterkreis', 'DEMO-N0', 'Speicherprojekt Nord', 'CAPEX', 'Eigentümer A', 'Investor A', 'Demo-Gemarkung', 'Flurstück 12/4', 'scrypt$', 'sessionKey', 'Vorschau!Speicher', 'bess-vorschau.invalid', 'stromkai-abnahme.invalid', 'BLOB_READ_WRITE', 'BESS_ACCOUNTS'];

test('Test 1 – Besucher: alle 12 öffentlichen Seiten, Bilder, CSS, JS ohne Anmeldung; keine vertraulichen Inhalte', async () => {
  const c = new C();
  for (const p of PUBLIC) {
    const [r, body] = await c.text(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('x-robots-tag'), /noindex/, `${p} noindex`);
    for (const s of SECRETS) assert.ok(!body.includes(s), `${p} enthält „${s}“`);
    assert.match(body, /Login \/ Partnerportal/, `${p} Login-Menüpunkt`);
    assert.match(body, /Vorläufiger Abnahmekandidat/);
  }
  for (const p of ['/static/css/site.css', '/static/js/site.js', '/static/img/hero.svg', '/static/img/schnitt-batteriesystem.svg', '/static/img/favicon.svg']) assert.equal((await c.req(p)).status, 200, p);
  assert.match(await (await c.req('/robots.txt')).text(), /Disallow: \//);
  const imp = await (await c.req('/impressum')).text();
  assert.match(imp, /Entwurf – Angaben werden nach Festlegung/);
  assert.ok(!/rechtskonform|ist rechtlich geprüft|wurde rechtlich geprüft/i.test(imp), 'keine Behauptung geprüfter Rechtstexte');
});

test('Test 4 – ohne Anmeldung: Portale, Dokumente, Verwaltung und Admin-Aktionen serverseitig abgewiesen', async () => {
  const c = new C();
  for (const p of ['/portal', '/portal/admin', '/portal/protokoll', '/portal/projekte/p-n01', '/portal/grundstuecke', '/portal/dokumente', '/portal/dokumente/d-n01-inv-fin/download', '/portal/dokumente/d-n01-own-a-vertrag/download', '/portal/nachrichten', '/portal/passwort']) {
    const r = await c.req(p);
    assert.equal(r.status, 303, p); assert.equal(r.headers.get('location'), '/portal/login', p);
  }
  for (const [p, f] of [['/portal/admin/zugriff', { userId: 'u-inv-a', projectId: 'p-n02' }], ['/portal/admin/passwort-neu', { userId: 'u-admin' }], ['/portal/admin/mfa-zuruecksetzen', { userId: 'u-admin' }], ['/portal/freigaben/ap-1/entscheiden', { decision: 'genehmigt' }], ['/portal/dokumente/hochladen', {}]]) {
    const r = await c.form(p, f);
    assert.ok([303, 403].includes(r.status) && !/freigegeben|Einmalpasswort/.test(await r.text()), p);
  }
  assert.equal((await c.req('/api/projekte')).status, 404, 'keine öffentliche JSON-API');
  const st = JSON.parse(blobs.get('abnahme/state/db.json').data);
  assert.equal(st.documents.find((d) => d.id === 'd-n01-inv-netz-entwurf').status, 'entwurf', 'Freigabe nicht ohne Anmeldung');
});

test('getrennter Speicherbereich der Abnahme; nur Dirk und Markus aktiv; keine Schranke', async () => {
  assert.ok(blobs.has('abnahme/state/db.json')); assert.ok(!blobs.has('state/db.json'));
  assert.ok([...blobs.keys()].filter((k) => k.includes('files/')).every((k) => k.startsWith('abnahme/files/')));
  const st = JSON.parse(blobs.get('abnahme/state/db.json').data);
  assert.deepEqual(st.users.filter((u) => u.active).map((u) => u.id).sort(), ['u-admin', 'u-markus']);
  assert.equal(st.gateUsers.length, 0);
});

async function firstLogin(email, pwStart, pwNew) {
  const c = new C();
  const [, lp] = await c.text('/portal/login');
  assert.ok(!/Demo-Zugänge|Passwort für alle/.test(lp), 'keine Demo-Zugänge');
  assert.equal((await c.form('/portal/anmelden', { _t: tok(lp, '_t'), email, password: pwStart })).headers.get('location'), '/portal/mfa');
  const [, mb] = await c.text('/portal/mfa');
  assert.match(mb, /Zweiten Faktor einrichten/);
  const secret = /<code>([A-Z2-7 ]+)<\/code>/.exec(mb)[1].replace(/ /g, '');
  const r = await c.form('/portal/mfa', { _csrf: tok(mb, '_csrf'), code: totp(secret) });
  assert.equal(r.headers.get('location'), '/portal/passwort', 'Pflicht: eigenes Passwort');
  assert.equal((await c.req('/portal/admin')).headers.get('location'), '/portal/passwort', 'vor Passwortwechsel kein Zugriff');
  const [, pp] = await c.text('/portal/passwort');
  assert.equal((await c.form('/portal/passwort', { _csrf: tok(pp, '_csrf'), current: pwStart, neu: 'kurz', neu2: 'kurz' })).status, 422);
  assert.equal((await c.form('/portal/passwort', { _csrf: tok(pp, '_csrf'), current: 'falsch', neu: pwNew, neu2: pwNew })).status, 401);
  const ok = await c.form('/portal/passwort', { _csrf: tok(pp, '_csrf'), current: pwStart, neu: pwNew, neu2: pwNew });
  return { c, secret, landing: ok.headers.get('location') };
}

test('Test 2 – Dirk: Login, MFA-Ersteinrichtung, eigenes Passwort, Administration', async () => {
  const { c, landing } = await firstLogin('dirk@stromkai-abnahme.invalid', start.dirk, 'Sonnenwind-Kai-2026!x');
  assert.equal(landing, '/portal');
  assert.equal((await c.req('/portal/admin')).status, 200);
  assert.equal((await c.req('/portal/protokoll')).status, 200);
  assert.equal((await c.req('/portal/dokumente/d-n01-fin-intern/download')).status, 200);
  // Startpasswort gilt nicht mehr
  const c2 = new C(); const [, lp] = await c2.text('/portal/login');
  assert.equal((await c2.form('/portal/anmelden', { _t: tok(lp, '_t'), email: 'dirk@stromkai-abnahme.invalid', password: start.dirk })).status, 401);
});

test('Test 3 – Markus: Login, nur Vertrieb Nord; Admin kann Einmalpasswort vergeben', async () => {
  const { c, landing } = await firstLogin('markus@stromkai-abnahme.invalid', start.markus, 'Nordwind-Speicher-26!y');
  assert.equal(landing, '/portal/pipeline');
  for (const [p, st] of [['/portal/pipeline', 200], ['/portal/projekte/p-n01', 200], ['/portal/projekte/p-s01', 404], ['/portal/admin', 404], ['/portal/protokoll', 404], ['/portal/dokumente/d-n01-inv-fin/download', 404], ['/portal/dokumente/d-n01-fin-intern/download', 404]]) assert.equal((await c.req(p)).status, st, p);
  const [, ab] = await c.text('/portal/pipeline');
  assert.equal((await c.form('/portal/admin/passwort-neu', { _csrf: tok(ab, '_csrf'), userId: 'u-admin' })).status, 404, 'Markus darf keine Passwörter vergeben');
});

test('Kontenabgleich: neue Provisionierung setzt Passwörter und MFA zurück und beendet alle Sitzungen', async () => {
  const c = new C(); const [, lp] = await c.text('/portal/login');
  // bestehende Sitzung von Dirk aufbauen (eigenes Passwort, MFA eingerichtet → Code aus Zustand)
  const st0 = JSON.parse(blobs.get('abnahme/state/db.json').data);
  await c.form('/portal/anmelden', { _t: tok(lp, '_t'), email: 'dirk@stromkai-abnahme.invalid', password: 'Sonnenwind-Kai-2026!x' });
  const [, mb] = await c.text('/portal/mfa');
  await c.form('/portal/mfa', { _csrf: tok(mb, '_csrf'), code: totp(st0.users.find((u) => u.id === 'u-admin').totp) });
  assert.equal((await c.req('/portal')).status, 200);
  const neu = { dirk: randomBytes(9).toString('base64url'), markus: randomBytes(9).toString('base64url') };
  process.env.BESS_ACCOUNTS = accounts(neu);
  assert.equal((await c.req('/portal')).headers.get('location'), '/portal/login', 'alte Sitzung ungültig');
  const st = JSON.parse(blobs.get('abnahme/state/db.json').data);
  const d = st.users.find((u) => u.id === 'u-admin');
  assert.equal(d.totp, null); assert.equal(d.mustChangePassword, true);
  const c2 = new C(); const [, lp2] = await c2.text('/portal/login');
  assert.equal((await c2.form('/portal/anmelden', { _t: tok(lp2, '_t'), email: 'dirk@stromkai-abnahme.invalid', password: neu.dirk })).headers.get('location'), '/portal/mfa');
});
