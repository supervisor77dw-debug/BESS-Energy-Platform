// Tests des Cloud-Pfads (Vercel-Handler + Blob-Speichertreiber) mit einem lokalen Stellvertreter der Blob-API:
// fail-closed ohne Zugänge, Produktionssperre, Bootstrap, Schranke/Login/MFA über verschlüsselte Cookies,
// mehrere Instanzen (gemeinsamer Zustand), Konfliktzusammenführung, private Dateiablage.
// Aufruf: node --test test/blob.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';

process.env.BESS_GATE = '1';
process.env.BESS_PREVIEW_HELPERS = '0';
const { hashPassword, totp } = await import('../src/lib/auth.mjs');

// ---- Stellvertreter der @vercel/blob-API (get/put mit ETag, ifMatch, ifNoneMatch, allowOverwrite) ----
const blobs = new Map(); let n = 0;
class Precondition extends Error { constructor() { super('Precondition failed'); this.name = 'BlobPreconditionFailedError'; } }
globalThis.__bessBlobSdk = {
  async put(path, body, o) {
    const cur = blobs.get(path);
    if (cur && o.allowOverwrite === false) throw new Error('This blob already exists');
    if (o.ifMatch && (!cur || cur.etag !== o.ifMatch)) throw new Precondition();
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const etag = `"e${++n}"`; blobs.set(path, { data, etag, access: o.access });
    return { etag, url: `blob://${path}` };
  },
  async get(path, o) {
    const cur = blobs.get(path);
    if (!cur) { const e = new Error('Blob not found'); e.name = 'BlobNotFoundError'; throw e; }
    if (o.ifNoneMatch && o.ifNoneMatch === cur.etag) return { statusCode: 304, stream: null, blob: { etag: cur.etag } };
    return { statusCode: 200, stream: Readable.from([cur.data]), blob: { etag: cur.etag } };
  },
};

const pw = { admin: randomBytes(9).toString('base64url'), own: randomBytes(9).toString('base64url'), gate: randomBytes(9).toString('base64url') };
const ACCOUNTS = JSON.stringify({
  users: [{ id: 'u-admin', email: 'dirk@bess-vorschau.invalid', pw: hashPassword(pw.admin) }, { id: 'u-own-a', email: 'eigentuemer.a@demo.invalid', pw: hashPassword(pw.own) }],
  gate: [{ id: 'g-dirk', user: 'dirk', name: 'Dirk', hash: hashPassword(pw.gate), active: true }],
});

let server, base, store;
before(async () => {
  store = await import('../src/lib/store.mjs');
  const { vercelHandler } = await import('../server.mjs');
  server = createServer((req, res) => vercelHandler(req, res).catch(() => { if (!res.headersSent) { res.statusCode = 503; res.end('nicht verfügbar'); } }));
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
async function gateAndLogin(c, email, password) {
  const [, gb] = await c.text('/_vorschau/anmelden');
  assert.equal((await c.form('/_vorschau/anmelden', { _t: tok(gb, '_t'), user: 'dirk', password: pw.gate, next: '/' })).status, 303);
  const [, lb] = await c.text('/portal/login');
  return c.form('/portal/anmelden', { _t: tok(lb, '_t'), email, password });
}

test('ohne provisionierte Zugänge startet die Plattform nicht (fail closed), kein Zustand wird angelegt', async () => {
  delete process.env.BESS_ACCOUNTS;
  const r = await fetch(base + '/');
  assert.equal(r.status, 503);
  assert.equal(blobs.size, 0);
});

test('Produktionsaufrufe sind ohne Freigabe gesperrt', async () => {
  process.env.VERCEL_ENV = 'production';
  try { assert.equal((await fetch(base + '/')).status, 503); } finally { delete process.env.VERCEL_ENV; }
});

test('Bootstrap aus BESS_ACCOUNTS: privater Zustand und private Dokumente, nicht provisionierte Konten gesperrt', async () => {
  process.env.BESS_ACCOUNTS = ACCOUNTS;
  const r = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(r.status, 303, 'Schranke aktiv');
  assert.ok(blobs.has('state/db.json'));
  assert.ok([...blobs.keys()].some((k) => k.startsWith('files/')));
  assert.ok([...blobs.values()].every((b) => b.access === 'private'), 'alles privat');
  const st = JSON.parse(blobs.get('state/db.json').data);
  assert.ok(!JSON.stringify(st).includes('Vorschau!Speicher'), 'kein Demo-Passwort');
  assert.equal(st.users.find((u) => u.id === 'u-inv-a').active, false, 'nicht provisioniertes Konto gesperrt');
  assert.equal(st.users.find((u) => u.id === 'u-admin').totp, null, 'MFA-Ersteinrichtung ausstehend');
  assert.ok(st.meta.sessionKey, 'Sitzungsschlüssel nur im privaten Zustand');
});

test('Login, MFA-Einrichtung, Download und Logout über verschlüsselte Cookies', async () => {
  const c = new C();
  assert.equal((await gateAndLogin(c, 'dirk@bess-vorschau.invalid', pw.admin)).headers.get('location'), '/portal/mfa');
  const [, mb] = await c.text('/portal/mfa');
  const secret = /<code>([A-Z2-7 ]+)<\/code>/.exec(mb)[1].replace(/ /g, '');
  assert.equal((await c.form('/portal/mfa', { _csrf: tok(mb, '_csrf'), code: totp(secret) })).status, 303);
  assert.equal((await c.req('/portal/admin')).status, 200);
  const d = await c.req('/portal/dokumente/d-n01-fin-intern/download');
  assert.equal(d.status, 200); assert.equal((await d.arrayBuffer()).byteLength > 100, true);
  assert.ok(JSON.parse(blobs.get('state/db.json').data).users.find((u) => u.id === 'u-admin').totp, 'MFA dauerhaft gespeichert');
  // Cookie ist verschlüsselt: keine Klartext-Nutzer-ID
  assert.ok(!c.jar.bess_sid.includes('u-admin') && !Buffer.from(c.jar.bess_sid, 'base64url').toString('latin1').includes('u-admin'));
  const [, pb] = await c.text('/portal');
  const old = c.jar.bess_sid;
  await c.form('/portal/abmelden', { _csrf: tok(pb, '_csrf') });
  const r = await fetch(base + '/portal', { redirect: 'manual', headers: { cookie: `bess_gate=${c.jar.bess_gate}; bess_sid=${old}` } });
  assert.equal(r.headers.get('location'), '/portal/login', 'abgemeldete Sitzung über Sperrliste ungültig');
});

test('Manipuliertes Sitzungs-Cookie wird verworfen', async () => {
  const c = new C();
  await gateAndLogin(c, 'eigentuemer.a@demo.invalid', pw.own);
  assert.equal((await c.req('/portal')).status, 200);
  const b = Buffer.from(c.jar.bess_sid, 'base64url'); b[b.length - 1] ^= 1; c.jar.bess_sid = b.toString('base64url');
  assert.equal((await c.req('/portal')).headers.get('location'), '/portal/login');
});

test('Gesperrte (nicht provisionierte) Konten können sich nicht anmelden', async () => {
  const c = new C();
  const r = await gateAndLogin(c, 'investor.a@demo.invalid', 'Vorschau!Speicher-2026');
  assert.equal(r.status, 401);
});

test('Zweite Instanz/Fremdänderung: Konflikt wird zusammengeführt, keine Änderung geht verloren', async () => {
  const c = new C();
  await gateAndLogin(c, 'eigentuemer.a@demo.invalid', pw.own);
  const [, page] = await c.text('/portal/nachrichten');
  // Fremdänderung direkt im Speicher (andere Instanz)
  const cur = JSON.parse(blobs.get('state/db.json').data);
  cur.messages.push({ id: 'm-fremd', threadKey: 'p-n01:u-own-a', projectId: 'p-n01', fromUserId: 'u-markus', text: 'Fremdänderung', at: new Date().toISOString() });
  blobs.set('state/db.json', { data: Buffer.from(JSON.stringify(cur)), etag: `"e${++n}"`, access: 'private' });
  // Diese Instanz hat den alten Stand im Speicher → Konflikt beim Speichern; refresh vor der Anfrage holt Neues,
  // daher den Konflikt erzwingen, indem während der Anfrage erneut fremd geschrieben wird:
  const origPut = globalThis.__bessBlobSdk.put; let injected = false;
  globalThis.__bessBlobSdk.put = async (path, body, o) => {
    if (path === 'state/db.json' && !injected) {
      injected = true;
      const x = JSON.parse(blobs.get(path).data); x.messages.push({ id: 'm-fremd-2', threadKey: 'p-n01:u-own-a', projectId: 'p-n01', fromUserId: 'u-markus', text: 'Fremdänderung 2', at: new Date().toISOString() });
      blobs.set(path, { data: Buffer.from(JSON.stringify(x)), etag: `"e${++n}"`, access: 'private' });
    }
    return origPut(path, body, o);
  };
  try {
    const r = await c.form('/portal/nachrichten', { _csrf: tok(page, '_csrf'), t: 'p-n01:u-own-a', text: 'Eigene Nachricht' });
    assert.equal(r.status, 303);
  } finally { globalThis.__bessBlobSdk.put = origPut; }
  const texts = JSON.parse(blobs.get('state/db.json').data).messages.map((m) => m.text);
  for (const t of ['Fremdänderung', 'Fremdänderung 2', 'Eigene Nachricht']) assert.ok(texts.includes(t), t);
});

test('merge(): lokal geänderte und gelöschte Datensätze, fremde neue Datensätze', () => {
  const b = { grants: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }], meta: { x: 1 } };
  const l = { grants: [{ id: 'a', v: 2 }, { id: 'c', v: 1 }], meta: { x: 1 } };
  const r = { grants: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'd', v: 1 }], meta: { x: 3 } };
  const m = store.merge(b, l, r);
  assert.deepEqual(m.grants.map((g) => `${g.id}${g.v}`).sort(), ['a2', 'c1', 'd1']);
  assert.deepEqual(m.meta, { x: 3 });
});

test('Upload landet als privater Blob und ist nur für Berechtigte abrufbar', async () => {
  const c = new C();
  await gateAndLogin(c, 'eigentuemer.a@demo.invalid', pw.own);
  const [, page] = await c.text('/portal/dokumente');
  const fd = new FormData(); fd.set('_csrf', tok(page, '_csrf')); fd.set('projectId', 'p-n01'); fd.set('title', 'Grundbuch'); fd.set('file', new Blob([Buffer.from('%PDF-1.4 test')]), 'g.pdf');
  assert.equal((await c.req('/portal/dokumente/hochladen', { method: 'POST', body: fd })).headers.get('location'), '/portal/dokumente?m=ok');
  const doc = JSON.parse(blobs.get('state/db.json').data).documents.at(-1);
  assert.equal(blobs.get(`files/${doc.file}`).access, 'private');
  assert.equal((await c.req(`/portal/dokumente/${doc.id}/download`)).status, 200);
});
