// Datenspeicher mit zwei Treibern:
//  - "file": JSON-Datei + Dateiordner (lokale Entwicklung, Tests)
//  - "blob": privater Zustand in Vercel Blob (state/db.json) mit optimistischer Sperre per ETag,
//            Dokumente als private Blobs (files/<name>). Für mehrere Funktionsinstanzen geeignet.
// Zugriff ausschließlich über die Repository-Funktionen in policy.mjs, die jede Abfrage an den Nutzer binden.
// Ablauf je Anfrage: refresh() → Handler (ändert db, ruft persist()) → flush() vor dem Senden der Antwort.
import { ensureFinanceDemo } from './finance/demo.mjs';
import { KATALOG_START } from './planer/planer.mjs';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

let db = null;
let base = null;      // Stand beim letzten Laden (für die Zusammenführung bei Konflikten)
let etag = null;
let dirty = false;
let driver = null;    // { kind, ... }

let STATE = 'state/db.json';
let FILES = 'files/';
// Finanzmodul: Sammlungen anlegen und synthetische Demo-Daten einmalig ergänzen (Entwicklungs- und Abnahmephase)
const ensureCollections = (d) => { for (const k of ['audit', 'downloads', 'inquiries', 'messages', 'approvals', 'uploads', 'revoked', 'gateUsers', 'invitations', 'grants']) d[k] ??= []; d.meta ??= {}; ensureFinanceDemo(d); ensurePlaner(d); return d; };
// Investitionsplaner (AW-016): Sammlungen anlegen, Platzhalter-Katalog einmalig ergänzen (ohne Herstellerbezug und ohne Preise)
const ensurePlaner = (d) => { for (const k of ['planerStaende', 'planerKatalog', 'planerAngebote', 'wmVersionshinweise']) d[k] ??= []; if (!d.meta.planerKatalog) { for (const x of KATALOG_START) if (!d.planerKatalog.some((y) => y.id === x.id)) d.planerKatalog.push(structuredClone(x)); d.meta.planerKatalog = 1; } };

export async function openStore(opts) {
  if (typeof opts === 'string') opts = { kind: 'file', dataDir: opts };
  if (opts.kind === 'file') {
    mkdirSync(join(opts.dataDir, 'files'), { recursive: true });
    const file = join(opts.dataDir, 'db.json');
    if (!existsSync(file)) throw new Error(`Datenbestand fehlt: ${file} – zuerst "node data/seed.mjs" ausführen.`);
    driver = { kind: 'file', dataDir: opts.dataDir, file };
    db = ensureCollections(JSON.parse(readFileSync(file, 'utf8')));
    // Vorschau-Schranke (lokal): Zugänge aus gate.json übernehmen, falls vorhanden
    const g = join(opts.dataDir, 'gate.json');
    if (existsSync(g)) db.gateUsers = JSON.parse(readFileSync(g, 'utf8')).users || [];
    db.meta.sessionKey ??= randomBytes(32).toString('base64'); // lokal: je Prozess neu, wenn nicht gespeichert
    return db;
  }
  if (opts.kind === 'blob') {
    driver = { kind: 'blob', sdk: opts.sdk || globalThis.__bessBlobSdk || await import('@vercel/blob'), bootstrap: opts.bootstrap }; // __bessBlobSdk: nur Tests
    // Getrennte Speicherbereiche je Betriebsstufe (z. B. 'abnahme/'), damit QA- und Abnahmedaten nie vermischt werden
    const prefix = opts.prefix || '';
    STATE = `${prefix}state/db.json`; FILES = `${prefix}files/`;
    await refresh();
    return db;
  }
  throw new Error(`Unbekannter Speichertreiber: ${opts.kind}`);
}

export const getDb = () => db;
export const storeKind = () => driver?.kind;

async function readStream(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

// Blob: aktuellen Zustand laden. Das ETag stammt aus head() (Steuerungs-API, dasselbe Format wie bei put/ifMatch)
// und wird VOR dem Inhalt gelesen: Ändert sich der Zustand dazwischen, scheitert das spätere bedingte Speichern
// und wird zusammengeführt – ein veralteter Stand kann so nie unbemerkt überschrieben werden.
async function headEtag() {
  try { return (await driver.sdk.head(STATE))?.etag || null; } catch (e) { if (/not.?found|404|does not exist/i.test(String(e?.name) + String(e?.message))) return null; throw e; }
}
async function readState() {
  const tag = await headEtag();
  if (!tag) return null;
  const r = await driver.sdk.get(STATE, { access: 'private', useCache: false });
  if (!r || !r.stream) return null;
  return { text: (await readStream(r.stream)).toString('utf8'), etag: tag };
}
export async function refresh() {
  if (driver.kind !== 'blob') return;
  const tag = await headEtag();
  if (tag && tag === etag && db) return; // unverändert
  let st = tag ? await readState() : null;
  if (!st) {
    if (!driver.bootstrap) throw new Error('Zustand fehlt und kein Bootstrap konfiguriert.');
    const { put } = driver.sdk;
    const { db: fresh, files } = await driver.bootstrap();
    ensureCollections(fresh);
    fresh.meta.sessionKey ??= randomBytes(32).toString('base64');
    for (const f of files) await put(`${FILES}${f.name}`, f.data, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: f.mime || 'application/octet-stream' });
    try { await put(STATE, JSON.stringify(fresh), { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' }); } catch { /* parallel gebootet – unten neu laden */ }
    st = await readState();
  }
  db = ensureCollections(JSON.parse(st.text));
  base = JSON.parse(st.text);
  etag = st.etag;
  dirty = false;
}

export function persist() {
  dirty = true;
  if (driver.kind === 'file') {
    const tmp = driver.file + '.' + randomBytes(4).toString('hex') + '.tmp';
    writeFileSync(tmp, JSON.stringify({ ...db, gateUsers: [] }, null, 1)); // Schrankenzugänge bleiben lokal in gate.json
    renameSync(tmp, driver.file);
    dirty = false;
  }
}

// Drei-Wege-Zusammenführung je Datensatz-ID: lokal geänderte Datensätze gewinnen, sonst der neuere Fremdstand.
export function merge(baseDb, localDb, remoteDb) {
  const out = { ...remoteDb };
  for (const key of new Set([...Object.keys(localDb), ...Object.keys(remoteDb)])) {
    const b = baseDb?.[key], l = localDb[key], r = remoteDb[key];
    if (Array.isArray(l) && (Array.isArray(r) || r === undefined) && l.every((x) => x && typeof x === 'object' && 'id' in x)) {
      const bm = new Map((b || []).map((x) => [x.id, JSON.stringify(x)]));
      const lm = new Map(l.map((x) => [x.id, x]));
      const res = new Map((r || []).map((x) => [x.id, x]));
      for (const [id, x] of lm) if (!bm.has(id) || bm.get(id) !== JSON.stringify(x)) res.set(id, x);
      for (const id of bm.keys()) if (!lm.has(id)) res.delete(id);
      out[key] = [...res.values()];
    } else if (JSON.stringify(l) !== JSON.stringify(b)) out[key] = l;
  }
  return out;
}

export async function flush() {
  if (driver.kind !== 'blob' || !dirty) return;
  const { put } = driver.sdk;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await put(STATE, JSON.stringify(db), { access: 'private', addRandomSuffix: false, allowOverwrite: true, ifMatch: etag || undefined, contentType: 'application/json' });
      etag = res.etag; base = JSON.parse(JSON.stringify(db)); dirty = false;
      return;
    } catch (e) {
      if (!/precondition|412/i.test(String(e?.name) + String(e?.message))) throw e;
      const st = await readState();
      const remote = JSON.parse(st.text);
      db = ensureCollections(merge(base, db, remote));
      base = remote; etag = st.etag;
    }
  }
  throw new Error('Speichern nach mehreren Konflikten fehlgeschlagen');
}

// ---- Dateien ----
export async function putFile(name, data, mime) {
  if (driver.kind === 'file') return writeFileSync(join(driver.dataDir, 'files', name), data);
  await driver.sdk.put(`${FILES}${name}`, data, { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: mime || 'application/octet-stream' });
}
export async function getFile(name) {
  if (driver.kind === 'file') return readFileSync(join(driver.dataDir, 'files', name));
  const r = await driver.sdk.get(`${FILES}${name}`, { access: 'private' });
  return readStream(r.stream);
}

export const newId = (prefix) => `${prefix}-${randomBytes(6).toString('hex')}`;
export const now = () => new Date().toISOString();

export function audit(event, actor, detail = {}) {
  db.audit.push({ id: newId('log'), at: now(), event, actor: actor?.id ?? null, actorName: actor?.name ?? 'anonym', ...detail });
  persist();
}
