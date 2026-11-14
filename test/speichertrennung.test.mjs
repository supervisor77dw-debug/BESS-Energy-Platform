// Go-live-Blocker S-1/S-2 (AW-20261114-GE-CLAUDE-STROMKAI-GOLIVE-VORBEREITUNG-022):
//  S-2: Speichertrennung technisch erzwungen – Vorschau/Entwicklung erreicht den Produktions-Store nicht, die Produktion
//       läuft nie auf dem gemeinsamen Store, der Speicher wird bei Verstoß gar nicht erst geöffnet (fail closed).
//  S-1: Wird MFA eingeschaltet, sind bestehende Sitzungen ohne zweiten Faktor sofort ungültig.
// Nur Stellvertreter-Tokens (Format wie Vercel, ohne echtes Geheimnis). Aufruf: node --test test/speichertrennung.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROD = 'store_PRODTEST0000001';
const tok = (id) => `vercel_blob_rw_${id.replace(/^store_/, '')}_platzhalterOhneGeheimnis`;
const GEMEINSAM = 'store_A8KSoIBxmYMplN9S';

const DIR = mkdtempSync(join(tmpdir(), 'bess-trennung-'));
for (const k of ['BESS_MFA', 'BESS_STAGE', 'VERCEL_ENV', 'VERCEL', 'BESS_PRODUKTIONSSPEICHER', 'BLOB_READ_WRITE_TOKEN', 'BESS_GATE']) delete process.env[k];
process.env.BESS_DATA_DIR = DIR;
process.env.BESS_PREVIEW_HELPERS = '0';

let cfg, server, base, db;
before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'data', 'seed.mjs'), DIR]);
  cfg = await import('../src/config.mjs');
  const store = await import('../src/lib/store.mjs');
  db = await store.openStore(DIR);
  const { createApp } = await import('../server.mjs');
  server = createApp();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); rmSync(DIR, { recursive: true, force: true }); });

// Öffnet den Blob-Speicher in einem eigenen Prozess mit der angegebenen Umgebung; zählt jeden SDK-Zugriff
function oeffnen(env) {
  const code = "let zugriffe = 0; globalThis.__bessBlobSdk = { head: async () => { zugriffe++; const e = new Error('not found'); throw e; }, get: async () => { zugriffe++; return null; }, put: async () => { zugriffe++; return { etag: '\"e1\"' }; } };"
    + " const { config } = await import('./src/config.mjs'); const s = await import('./src/lib/store.mjs');"
    + " try { await s.openStore({ kind: 'blob', prefix: config.blobPrefix, bootstrap: async () => ({ db: {}, files: [] }) }); console.log('offen ' + zugriffe); } catch (e) { console.log('gesperrt ' + zugriffe + ' ' + e.message); }";
  return execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, BESS_ACCOUNTS: '{"users":[]}', ...env }, encoding: 'utf8' }).trim();
}

test('S-2: Regeln der Speichertrennung', () => {
  const v = cfg.speicherVerstoesse;
  assert.deepEqual(v({ VERCEL_ENV: 'production', BESS_PRODUKTIONSSPEICHER: PROD, BLOB_READ_WRITE_TOKEN: tok(PROD) }, 'abnahme'), []);
  assert.equal(cfg.speicherGetrennt({ BESS_PRODUKTIONSSPEICHER: PROD, BLOB_READ_WRITE_TOKEN: tok(PROD) }, 'abnahme'), true);
  assert.match(v({ VERCEL_ENV: 'preview' }, 'abnahme').join(), /Produktionsstufe/, 'Vorschau darf nie Produktionsstufe sein');
  assert.match(v({ VERCEL_ENV: 'preview', BESS_PRODUKTIONSSPEICHER: PROD, BLOB_READ_WRITE_TOKEN: tok(PROD) }, 'qa').join(), /Produktionsspeicher verbunden/);
  assert.match(v({ VERCEL_ENV: 'production', BESS_PRODUKTIONSSPEICHER: PROD, BLOB_READ_WRITE_TOKEN: tok('store_ANDERER') }, 'abnahme').join(), /nicht mit dem festgelegten/);
  assert.match(v({ BESS_PRODUKTIONSSPEICHER: GEMEINSAM, BLOB_READ_WRITE_TOKEN: tok(GEMEINSAM) }, 'abnahme').join(), /gemeinsamen Store/);
  assert.equal(cfg.speicherGetrennt({ BESS_PRODUKTIONSSPEICHER: GEMEINSAM, BLOB_READ_WRITE_TOKEN: tok(GEMEINSAM) }, 'abnahme'), false);
  assert.equal(cfg.speicherGetrennt({ BLOB_READ_WRITE_TOKEN: tok(GEMEINSAM) }, 'abnahme'), false, 'heutiger Zustand: nicht getrennt');
  assert.deepEqual(v({ VERCEL_ENV: 'preview', BESS_PRODUKTIONSSPEICHER: PROD, BLOB_READ_WRITE_TOKEN: tok('store_QA0001') }, 'qa'), []);
});

test('S-2: Speicher wird bei Verstoß nicht geöffnet – kein einziger Lese- oder Schreibzugriff', () => {
  const vorschauMitProdToken = oeffnen({ VERCEL: '1', VERCEL_ENV: 'preview', BESS_BLOB_PREFIX: 'qa-022/', BESS_PRODUKTIONSSPEICHER: PROD, BLOB_READ_WRITE_TOKEN: tok(PROD) });
  assert.match(vorschauMitProdToken, /^gesperrt 0 Speichertrennung verletzt/);
  const vorschauAlsProduktion = oeffnen({ VERCEL: '1', VERCEL_ENV: 'preview', BESS_STAGE: 'abnahme', BESS_PRODUKTIONSSPEICHER: PROD, BLOB_READ_WRITE_TOKEN: tok('store_QA0001') });
  assert.match(vorschauAlsProduktion, /^gesperrt 0 .*Produktionsstufe/);
  const prodFalscherStore = oeffnen({ VERCEL: '1', VERCEL_ENV: 'production', BESS_PRODUKTIONSSPEICHER: PROD, BLOB_READ_WRITE_TOKEN: tok('store_QA0001') });
  assert.match(prodFalscherStore, /^gesperrt 0 /);
  // zulässige Kombinationen passieren die Trennungsprüfung und greifen auf den Speicher zu (Stellvertreter ohne Bestand)
  const zulaessig = (x) => { assert.doesNotMatch(x, /Speichertrennung|^gesperrt 0 /); assert.match(x, /^(offen|gesperrt [1-9])/); };
  zulaessig(oeffnen({ VERCEL: '1', VERCEL_ENV: 'preview', BESS_BLOB_PREFIX: 'qa-022/', BESS_PRODUKTIONSSPEICHER: PROD, BLOB_READ_WRITE_TOKEN: tok('store_QA0001') }));
  zulaessig(oeffnen({ VERCEL: '1', VERCEL_ENV: 'production', BESS_PRODUKTIONSSPEICHER: PROD, BLOB_READ_WRITE_TOKEN: tok(PROD) }));
});

test('S-2: Go-live-Sperre und Formulare verlangen den getrennten Produktionsspeicher', () => {
  const sperre = (e) => cfg.goLiveSperren(undefined, { VERCEL: '1', ...e }, 'abnahme', 'privilegiert').filter((x) => x.startsWith('S-2'));
  assert.equal(sperre({ BLOB_READ_WRITE_TOKEN: tok(GEMEINSAM) }).length, 1, 'heutiger gemeinsamer Store blockiert den Go-live');
  assert.equal(sperre({ BESS_PRODUKTIONSSPEICHER: PROD, BLOB_READ_WRITE_TOKEN: tok(PROD) }).length, 0);
  const formulare = (env) => execFileSync(process.execPath, ['--input-type=module', '-e', "const { config } = await import('./src/config.mjs'); console.log(config.formulare);"], { cwd: ROOT, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, BESS_STAGE: 'abnahme', BESS_FORMULARE: '1', ...env }, encoding: 'utf8' }).trim();
  assert.equal(formulare({ BLOB_READ_WRITE_TOKEN: tok(GEMEINSAM) }), 'false');
  assert.equal(formulare({ BESS_EIGENER_PRODUKTIONSSPEICHER: '1', BLOB_READ_WRITE_TOKEN: tok(GEMEINSAM) }), 'false', 'früherer Bestätigungsschalter allein reicht nicht mehr');
});

// ---------- S-1 ----------
class Client {
  constructor() { this.cookie = ''; }
  async req(path, opts = {}) {
    const res = await fetch(base + path, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(this.cookie ? { cookie: this.cookie } : {}) } });
    const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    return res;
  }
  async form(path, fields) { return this.req(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() }); }
}

test('S-1: Einschalten der MFA beendet bestehende Sitzungen ohne zweiten Faktor; danach nur mit Code', async () => {
  const { totp } = await import('../src/lib/auth.mjs');
  const { DEMO_PASSWORD } = await import('../data/seed-lib.mjs');
  const admin = db.users.find((u) => u.id === 'u-admin');
  assert.equal(cfg.config.mfa, 'aus');
  const c = new Client();
  const lp = await (await c.req('/portal/login')).text();
  const r = await c.form('/portal/anmelden', { _t: /name="_t" value="([^"]+)"/.exec(lp)[1], email: admin.email, password: DEMO_PASSWORD });
  assert.equal(r.status, 303); assert.notEqual(r.headers.get('location'), '/portal/mfa');
  assert.equal((await c.req('/portal/zentrale')).status, 200, 'ohne MFA angemeldet');

  cfg.config.mfa = 'privilegiert'; // wie BESS_MFA=privilegiert nach neuem Deployment
  try {
    const r2 = await c.req('/portal/zentrale');
    assert.equal(r2.status, 303); assert.equal(r2.headers.get('location'), '/portal/login', 'Altsitzung ohne MFA beendet');
    assert.equal((await c.req('/portal/zentrale')).headers.get('location'), '/portal/login', 'bleibt beendet');

    const c2 = new Client();
    const lp2 = await (await c2.req('/portal/login')).text();
    const r3 = await c2.form('/portal/anmelden', { _t: /name="_t" value="([^"]+)"/.exec(lp2)[1], email: admin.email, password: DEMO_PASSWORD });
    assert.equal(r3.headers.get('location'), '/portal/mfa');
    assert.equal((await c2.req('/portal/zentrale')).headers.get('location'), '/portal/mfa', 'ohne Code kein Zugriff');
    const mp = await (await c2.req('/portal/mfa')).text();
    const csrf = /name="_csrf" value="([^"]+)"/.exec(mp)[1];
    assert.equal((await c2.form('/portal/mfa', { _csrf: csrf, code: '000000' })).status, 401);
    assert.equal((await c2.form('/portal/mfa', { _csrf: csrf, code: totp(admin.totp) })).status, 303);
    assert.equal((await c2.req('/portal/zentrale')).status, 200, 'mit zweitem Faktor angemeldet');
  } finally { cfg.config.mfa = 'aus'; }
});

// ---------- Sicherung, Übertragung, Rückfall (tools/blob-sicherung.mjs) ----------
test('S-2: Sicherung → Einspielen in neuen Store → byte-genauer Vergleich; beschädigte Sicherung und belegtes Ziel stoppen', async () => {
  const { Readable } = await import('node:stream');
  const { writeFileSync, readFileSync } = await import('node:fs');
  const B = await import('../tools/blob-sicherung.mjs');
  const stores = { [tok(GEMEINSAM)]: new Map(), [tok(PROD)]: new Map() };
  const sdk = {
    async list({ prefix, token }) { return { blobs: [...stores[token].keys()].filter((p) => p.startsWith(prefix)).map((pathname) => ({ pathname, contentType: stores[token].get(pathname).ct })), hasMore: false }; },
    async get(p, { token }) { const x = stores[token].get(p); return x ? { stream: Readable.from([x.data]) } : null; },
    async put(p, data, { token, contentType }) { stores[token].set(p, { data: Buffer.from(data), ct: contentType }); return {}; },
  };
  const alt = stores[tok(GEMEINSAM)];
  alt.set('abnahme/state/db.json', { data: Buffer.from('{"users":[{"id":"u-admin"}]}'), ct: 'application/json' });
  alt.set('abnahme/files/vertrag.pdf', { data: Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 255, 1]), ct: 'application/pdf' });
  alt.set('qa-020/state/db.json', { data: Buffer.from('{"qa":true}'), ct: 'application/json' });
  const ziel = join(DIR, 'sicherung-1');

  const m = await B.sichern({ sdk, token: tok(GEMEINSAM), prefix: 'abnahme/', ziel });
  assert.equal(m.anzahl, 2, 'nur der Produktionsbereich, nicht qa-020/');
  assert.equal(m.store, GEMEINSAM);
  assert.doesNotMatch(readFileSync(join(ziel, 'MANIFEST.json'), 'utf8'), /vercel_blob_rw|platzhalterOhneGeheimnis/, 'kein Token in der Sicherung');
  assert.deepEqual(B.pruefen({ quelle: ziel }).fehler, []);
  await assert.rejects(B.sichern({ sdk, token: tok(GEMEINSAM), prefix: 'abnahme/', ziel }), (e) => e.rc === 24, 'bestehende Sicherung wird nicht überschrieben');

  const r = await B.einspielen({ sdk, token: tok(PROD), quelle: ziel, leer: true });
  assert.deepEqual(r.fehler, []); assert.equal(r.anzahl, 2);
  assert.deepEqual(stores[tok(PROD)].get('abnahme/files/vertrag.pdf').data, alt.get('abnahme/files/vertrag.pdf').data);
  assert.equal(stores[tok(PROD)].has('qa-020/state/db.json'), false, 'QA-Daten nicht übertragen');
  await assert.rejects(B.einspielen({ sdk, token: tok(PROD), quelle: ziel, leer: true }), (e) => e.rc === 24, 'belegtes Ziel: STOPP');

  stores[tok(PROD)].set('abnahme/state/db.json', { data: Buffer.from('{"veraendert":1}'), ct: 'application/json' });
  assert.match((await B.vergleich({ sdk, token: tok(PROD), quelle: ziel })).fehler.join(), /abweichend: abnahme\/state\/db.json/);
  const rueck = await B.einspielen({ sdk, token: tok(PROD), quelle: ziel }); // Rückfall: Sicherungsstand wiederherstellen
  assert.deepEqual(rueck.fehler, []);

  writeFileSync(join(ziel, 'daten', 'abnahme', 'state', 'db.json'), 'manipuliert');
  assert.deepEqual(B.pruefen({ quelle: ziel }).fehler, ['abnahme/state/db.json']);
  await assert.rejects(B.einspielen({ sdk, token: tok(PROD), quelle: ziel }), (e) => e.rc === 25, 'beschädigte Sicherung wird nicht eingespielt');
  assert.equal(B.storeAusToken(tok(PROD)), PROD);
});

test('S-1: In der Produktionsstufe gilt ein öffentlich bekanntes Demo-TOTP-Geheimnis nicht als eingerichtet', async () => {
  const { totp } = await import('../src/lib/auth.mjs');
  const { DEMO_PASSWORD } = await import('../data/seed-lib.mjs');
  const pl = db.users.find((u) => u.id === 'u-pl');
  assert.match(pl.totp, /^JBSWY3DPEHPK3PXP/);
  const stufe = cfg.config.stage;
  cfg.config.mfa = 'privilegiert'; cfg.config.stage = 'abnahme';
  try {
    const c = new Client();
    const lp = await (await c.req('/portal/login')).text();
    const r = await c.form('/portal/anmelden', { _t: /name="_t" value="([^"]+)"/.exec(lp)[1], email: pl.email, password: DEMO_PASSWORD });
    assert.equal(r.headers.get('location'), '/portal/mfa');
    const mp = await (await c.req('/portal/mfa')).text();
    assert.match(mp, /Zweiten Faktor einrichten/, 'Ersteinrichtung statt Demo-Geheimnis');
    const csrf = /name="_csrf" value="([^"]+)"/.exec(mp)[1];
    assert.equal((await c.form('/portal/mfa', { _csrf: csrf, code: totp(pl.totp) })).status, 401, 'Code aus dem Demo-Geheimnis wird abgelehnt');
  } finally { cfg.config.mfa = 'aus'; cfg.config.stage = stufe; }
});
