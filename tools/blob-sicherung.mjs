// Sicherung, Prüfung und Übertragung eines Blob-Bereichs (Go-live S-2, AW-20261114-GE-CLAUDE-STROMKAI-GOLIVE-VORBEREITUNG-022).
// Zweck: Produktionsbereich 'abnahme/' vor der Speichertrennung sichern, in den neuen Produktions-Store übertragen,
// Übertragung byte-genau prüfen und bei Bedarf zurückspielen (Rückfall).
//
// Das Zugangstoken wird NUR aus der Umgebungsvariable BLOB_READ_WRITE_TOKEN gelesen, nie als Argument angenommen und nie
// ausgegeben; angezeigt wird ausschließlich die Store-Kennung. Ausführung nur durch Dirk im eigenen Fenster (CLAUDE_GLOBAL §8 Nr. 5).
//
//   inventur:  node tools/blob-sicherung.mjs inventur --store store_…   (nur Anzahl/Größe je Bereich, keine Inhalte, keine Dateinamen)
//   lokal:     node tools/blob-sicherung.mjs lokal --quelle <ordner> --ziel <ordner>   (Wiederherstellungsprobe als lokaler Datenbestand, ohne Netz)
//   sichern:   node tools/blob-sicherung.mjs sichern  --prefix abnahme/ --ziel <ordner> --store store_…
//   pruefen:   node tools/blob-sicherung.mjs pruefen  --quelle <ordner>                         (lokal, ohne Netz)
//   vergleich: node tools/blob-sicherung.mjs vergleich --quelle <ordner> --store store_…          (Store gegen Sicherung)
//   einspielen:node tools/blob-sicherung.mjs einspielen --quelle <ordner> --store store_… [--leer]  (--leer: Ziel muss leer sein)
// --store ist Pflicht und muss zur Store-Kennung des Tokens passen (Schutz vor Verwechslung von Produktion und QA).
// Rückgabecodes: 0 OK · 2 Aufruf · 21 Zeitlimit · 22 Store passt nicht/Berechtigung · 24 STOPP vor Ausführung · 25 Prüfung fehlgeschlagen
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const storeAusToken = (t) => { const id = String(t || '').split('_')[3] || ''; return id ? `store_${id}` : ''; };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sicher = (p) => { if (!/^[A-Za-z0-9._\-/]+$/.test(p) || p.split('/').includes('..')) throw Object.assign(new Error(`Unzulässiger Pfad: ${p}`), { rc: 25 }); return p; };
async function lesen(stream) { const c = []; for await (const x of stream) c.push(Buffer.from(x)); return Buffer.concat(c); }

async function alle(sdk, token, prefix) {
  const out = []; let cursor;
  do { const r = await sdk.list({ prefix, cursor, token, limit: 1000 }); out.push(...r.blobs); cursor = r.hasMore ? r.cursor : undefined; } while (cursor);
  return out;
}

export async function sichern({ sdk, token, prefix, ziel }) {
  if (!prefix) throw Object.assign(new Error('--prefix fehlt'), { rc: 2 });
  if (existsSync(join(ziel, 'MANIFEST.json'))) throw Object.assign(new Error('Ziel enthält bereits eine Sicherung – wird nicht überschrieben'), { rc: 24 });
  const eintraege = [];
  for (const b of await alle(sdk, token, prefix)) {
    const pfad = sicher(b.pathname);
    const r = await sdk.get(pfad, { access: 'private', token, useCache: false });
    if (!r?.stream) throw Object.assign(new Error(`Lesen fehlgeschlagen: ${pfad}`), { rc: 25 });
    const data = await lesen(r.stream);
    const datei = join(ziel, 'daten', pfad); mkdirSync(dirname(datei), { recursive: true }); writeFileSync(datei, data, { flag: 'wx' });
    eintraege.push({ pfad, bytes: data.length, sha256: sha(data), contentType: b.contentType || r.blob?.contentType || 'application/octet-stream' });
  }
  const manifest = { erstellt: new Date().toISOString(), store: storeAusToken(token), prefix, anzahl: eintraege.length, bytes: eintraege.reduce((a, e) => a + e.bytes, 0), eintraege };
  mkdirSync(ziel, { recursive: true }); writeFileSync(join(ziel, 'MANIFEST.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  return manifest;
}

export function pruefen({ quelle }) {
  const m = JSON.parse(readFileSync(join(quelle, 'MANIFEST.json'), 'utf8'));
  const fehler = m.eintraege.filter((e) => { const f = join(quelle, 'daten', sicher(e.pfad)); return !existsSync(f) || sha(readFileSync(f)) !== e.sha256; }).map((e) => e.pfad);
  return { manifest: m, fehler };
}

export async function vergleich({ sdk, token, quelle }) {
  const { manifest: m } = pruefen({ quelle });
  const ist = new Map((await alle(sdk, token, m.prefix)).map((b) => [b.pathname, b]));
  const fehler = [];
  for (const e of m.eintraege) {
    if (!ist.has(e.pfad)) { fehler.push(`fehlt: ${e.pfad}`); continue; }
    const r = await sdk.get(e.pfad, { access: 'private', token, useCache: false });
    if (sha(await lesen(r.stream)) !== e.sha256) fehler.push(`abweichend: ${e.pfad}`);
  }
  for (const p of ist.keys()) if (!m.eintraege.some((e) => e.pfad === p)) fehler.push(`zusätzlich: ${p}`);
  return { anzahl: m.eintraege.length, fehler };
}

// sicher (Neustart-fähig): Ziel ist leer ODER enthält nur Objekte der Sicherung mit identischem Inhalt (abgebrochener
// früherer Lauf) – dann werden nur die fehlenden ergänzt. Abweichende oder zusätzliche Objekte → STOPP, nichts geschrieben.
export async function einspielen({ sdk, token, quelle, leer, sicher }) {
  const { manifest: m, fehler } = pruefen({ quelle });
  if (fehler.length) throw Object.assign(new Error(`Sicherung beschädigt (${fehler.length} Dateien) – nichts eingespielt`), { rc: 25 });
  const vorhanden = await alle(sdk, token, m.prefix);
  if (leer && vorhanden.length) throw Object.assign(new Error(`Ziel-Store enthält bereits Daten unter ${m.prefix} – STOPP`), { rc: 24 });
  let fehlend = m.eintraege;
  if (sicher && vorhanden.length) {
    const v = await vergleich({ sdk, token, quelle });
    const fremd = v.fehler.filter((f) => !f.startsWith('fehlt: '));
    if (fremd.length) throw Object.assign(new Error(`Ziel-Store enthält abweichende oder zusätzliche Objekte (${fremd.length}) – STOPP, nichts geschrieben`), { rc: 24 });
    const fehlt = new Set(v.fehler.map((f) => f.slice('fehlt: '.length)));
    fehlend = m.eintraege.filter((e) => fehlt.has(e.pfad));
  }
  for (const e of fehlend) await sdk.put(e.pfad, readFileSync(join(quelle, 'daten', e.pfad)), { access: 'private', token, addRandomSuffix: false, allowOverwrite: true, contentType: e.contentType });
  return vergleich({ sdk, token, quelle });
}


// Inventur: alle Objekte des Stores nach oberstem Bereich (z. B. abnahme/, qa-020/) – nur Zählwerte
export async function inventur({ sdk, token }) {
  const bereiche = {};
  for (const b of await alle(sdk, token, '')) { const k = b.pathname.includes('/') ? b.pathname.split('/')[0] + '/' : '(Wurzel)'; const x = bereiche[k] ??= { anzahl: 0, bytes: 0, zustand: false }; x.anzahl++; x.bytes += b.size || 0; if (/(^|\/)state\/db\.json$/.test(b.pathname)) x.zustand = true; }
  return { store: storeAusToken(token), bereiche };
}

// Wiederherstellungsprobe: Sicherung als lokalen Datenbestand (db.json + files/) anlegen; danach mit dem Datei-Treiber öffnen
export function lokal({ quelle, ziel }) {
  const { manifest: m, fehler } = pruefen({ quelle });
  if (fehler.length) throw Object.assign(new Error('Sicherung beschädigt – keine Probe'), { rc: 25 });
  if (existsSync(join(ziel, 'db.json'))) throw Object.assign(new Error('Ziel enthält bereits einen Datenbestand – STOPP'), { rc: 24 });
  let zustand = false, dateien = 0;
  for (const e of m.eintraege) {
    const rel = e.pfad.slice(m.prefix.length);
    const nach = rel === 'state/db.json' ? join(ziel, 'db.json') : rel.startsWith('files/') ? join(ziel, rel) : null;
    if (!nach) continue;
    mkdirSync(dirname(nach), { recursive: true }); writeFileSync(nach, readFileSync(join(quelle, 'daten', e.pfad)), { flag: 'wx' });
    if (rel === 'state/db.json') zustand = true; else dateien++;
  }
  if (!zustand) throw Object.assign(new Error('Sicherung enthält keinen Zustand state/db.json'), { rc: 25 });
  const db = JSON.parse(readFileSync(join(ziel, 'db.json'), 'utf8'));
  return { konten: (db.users || []).length, aktiv: (db.users || []).filter((u) => u.active).length, projekte: (db.projects || []).length, dokumente: (db.documents || []).length, dateien };
}

// Zwei Sicherungen inhaltlich vergleichen (Pfade relativ zum Bereich, SHA-256) – ohne Netz
export function manifestvergleich({ a, b }) {
  const ma = pruefen({ quelle: a }).manifest, mb = pruefen({ quelle: b }).manifest;
  const rel = (m) => new Map(m.eintraege.map((e) => [e.pfad.slice(m.prefix.length), e.sha256]));
  const ra = rel(ma), rb = rel(mb), fehler = [];
  for (const [k, h] of ra) if (rb.get(k) !== h) fehler.push(rb.has(k) ? `abweichend: ${k}` : `fehlt in B: ${k}`);
  for (const k of rb.keys()) if (!ra.has(k)) fehler.push(`zusätzlich in B: ${k}`);
  return { anzahlA: ra.size, anzahlB: rb.size, storeA: ma.store, storeB: mb.store, fehler };
}

// ---------- Befehlszeile ----------
const istCli = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (istCli) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const befehl = process.argv[2];
  const stopp = (msg, rc) => { console.error(`STOPP: ${msg} (rc ${rc})`); process.exit(rc); };
  const zeitlimit = setTimeout(() => stopp('Zeitlimit 10 Minuten überschritten', 21), 10 * 60e3); zeitlimit.unref();
  try {
    if (befehl === 'manifestvergleich') {
      const r = manifestvergleich({ a: resolve(arg('--a') || ''), b: resolve(arg('--b') || '') });
      console.log(`manifestvergleich: A ${r.storeA} ${r.anzahlA} Dateien, B ${r.storeB} ${r.anzahlB} Dateien, Abweichungen ${r.fehler.length}`);
      process.exit(r.fehler.length ? 25 : 0);
    }
    if (befehl === 'lokal') {
      const r = lokal({ quelle: resolve(arg('--quelle') || ''), ziel: resolve(arg('--ziel') || '') });
      const st = await import('../src/lib/store.mjs'); await st.openStore(resolve(arg('--ziel'))); // mit dem Datei-Treiber der Anwendung öffnen
      console.log(`Wiederherstellungsprobe: Konten ${r.konten} (aktiv ${r.aktiv}), Projekte ${r.projekte}, Dokumente ${r.dokumente}, Dateien ${r.dateien}`);
      process.exit(0);
    }
    if (befehl === 'pruefen') {
      const { manifest, fehler } = pruefen({ quelle: resolve(arg('--quelle') || '') });
      console.log(`Sicherung ${manifest.store} ${manifest.prefix}: ${manifest.anzahl} Dateien, ${manifest.bytes} Bytes, Fehler ${fehler.length}`);
      process.exit(fehler.length ? 25 : 0);
    }
    if (!['inventur', 'sichern', 'vergleich', 'einspielen'].includes(befehl)) stopp('Befehl inventur | sichern | pruefen | lokal | vergleich | einspielen', 2);
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) stopp('BLOB_READ_WRITE_TOKEN ist nicht gesetzt', 22);
    if (!arg('--store') || storeAusToken(token) !== arg('--store')) stopp(`Token gehört zu ${storeAusToken(token) || 'unbekannt'}, erwartet ${arg('--store') || '(--store fehlt)'}`, 22);
    const sdk = globalThis.__bessBlobSdk || await import('@vercel/blob');
    console.log('ARBEITET – keine Eingabe nötig');
    if (befehl === 'inventur') { const r = await inventur({ sdk, token }); console.log(`Inventur ${r.store}:`); for (const [k, v] of Object.entries(r.bereiche)) console.log(`  ${k.padEnd(14)} ${String(v.anzahl).padStart(5)} Objekte ${String(v.bytes).padStart(10)} Bytes${v.zustand ? '  (mit Zustand)' : ''}`); }
    else if (befehl === 'sichern') { const m = await sichern({ sdk, token, prefix: arg('--prefix'), ziel: resolve(arg('--ziel') || '') }); console.log(`Gesichert: ${m.anzahl} Dateien, ${m.bytes} Bytes aus ${m.store} ${m.prefix}`); }
    else { const r = befehl === 'vergleich' ? await vergleich({ sdk, token, quelle: resolve(arg('--quelle') || '') }) : await einspielen({ sdk, token, quelle: resolve(arg('--quelle') || ''), leer: process.argv.includes('--leer'), sicher: process.argv.includes('--sicher') });
      console.log(`${befehl}: ${r.anzahl} Dateien, Abweichungen ${r.fehler.length}`); for (const f of r.fehler) console.log(`  ${f}`); if (r.fehler.length) process.exit(25); }
    process.exit(0);
  } catch (e) { stopp(e.message, e.rc || 25); }
}
