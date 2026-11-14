// Einmalige serverseitige Erstübernahme des Produktionsbestands in den eigenen Produktions-Store (S-2,
// AW-20261114-GE-CLAUDE-STROMKAI-GOLIVE-VORBEREITUNG-022). Läuft ausschließlich beim Start einer Vercel-Produktionslaufzeit,
// bevor die Anwendung ihren Speicher öffnet. Kein Endpunkt, keine Eingabe von außen.
//
// Voraussetzungen (alle aus geschützten Umgebungsvariablen der Production-Bereitstellung, nichts wird ausgegeben):
//   BLOB_READ_WRITE_TOKEN       Ziel: neuer Produktions-Store (Sensitive; wird nur von der Laufzeit genutzt)
//   BESS_PRODUKTIONSSPEICHER    Kennung des Ziel-Stores (muss zum Ziel-Token passen)
//   BESS_MIGRATION_QUELLE       Token des bisherigen gemeinsamen Stores – NUR gelesen (list/get), nie geschrieben
//   BESS_MIGRATION_MANIFEST     Pfade + SHA-256 der geprüften lokalen Sicherung (nicht geheim)
// Ablauf: Marker im Ziel vorhanden → nichts tun. Sonst je Manifest-Eintrag aus der Quelle lesen, Prüfsumme gegen die
// Sicherung prüfen (Abweichung = Altbestand seit der Sicherung verändert → Abbruch), im Ziel nur FEHLENDE Objekte anlegen
// (nie überschreiben), danach das Ziel vollständig gegen das Manifest prüfen und erst dann den Marker schreiben.
// Jeder Fehler bricht den Start ab (fail closed); Rückfall = vorherige Bereitstellung, der Altbestand bleibt unverändert.
import { createHash } from 'node:crypto';
import { GEMEINSAME_SPEICHER } from '../config.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const storeVon = (t) => { const id = String(t || '').split('_')[3] || ''; return id ? `store_${id}` : ''; };
async function lesen(stream) { const c = []; for await (const x of stream) c.push(Buffer.from(x)); return Buffer.concat(c); }
async function alle(sdk, token, prefix) {
  const out = []; let cursor;
  do { const r = await sdk.list({ prefix, cursor, token, limit: 1000 }); out.push(...r.blobs); cursor = r.hasMore ? r.cursor : undefined; } while (cursor);
  return out;
}
const fehler = (m) => Object.assign(new Error(`Erstübernahme abgebrochen: ${m}`), { erstuebernahme: true });

export async function erstuebernahme({ sdk, env = process.env, stage, log = (m) => console.log(m) }) {
  const quelle = String(env.BESS_MIGRATION_QUELLE || '').trim();
  if (!quelle) return { status: 'aus' };
  if (env.VERCEL_ENV !== 'production' || stage !== 'abnahme') throw fehler('nur im Vercel-Production-Ziel mit Stufe abnahme zulässig');
  const ziel = String(env.BLOB_READ_WRITE_TOKEN || '').trim();
  const quellStore = storeVon(quelle), zielStore = storeVon(ziel), soll = String(env.BESS_PRODUKTIONSSPEICHER || '').trim();
  if (!GEMEINSAME_SPEICHER.includes(quellStore)) throw fehler('Quelle ist nicht der bisherige gemeinsame Store');
  if (!zielStore || zielStore !== soll || zielStore === quellStore) throw fehler('Ziel ist nicht der festgelegte eigene Produktions-Store');
  let m; try { m = JSON.parse(env.BESS_MIGRATION_MANIFEST || ''); } catch { throw fehler('Manifest fehlt oder ist ungültig'); }
  const prefix = String(m.prefix || '');
  if (prefix !== 'abnahme/' || !Array.isArray(m.eintraege) || !m.eintraege.length || m.eintraege.some((e) => !String(e.pfad).startsWith(prefix) || !/^[0-9a-f]{64}$/.test(e.sha256))) throw fehler('Manifest unvollständig');
  const kennung = sha(JSON.stringify(m.eintraege.map((e) => [e.pfad, e.sha256]))).slice(0, 16);
  const marker = `${prefix}.erstuebernahme-${kennung}.json`;

  const vorhanden = new Map((await alle(sdk, ziel, prefix)).map((b) => [b.pathname, b]));
  if (vorhanden.has(marker)) { log(`Erstübernahme ${kennung}: bereits abgeschlossen`); return { status: 'erledigt', kennung }; }
  const bekannt = new Set(m.eintraege.map((e) => e.pfad));
  const fremd = [...vorhanden.keys()].filter((p) => !bekannt.has(p) && !p.startsWith(`${prefix}.erstuebernahme-`));
  if (fremd.length) throw fehler(`Ziel enthält ${fremd.length} fremde Objekte`);

  let kopiert = 0;
  for (const e of m.eintraege) {
    if (vorhanden.has(e.pfad)) continue; // nie überschreiben (paralleler Start oder früherer Teillauf)
    const r = await sdk.get(e.pfad, { access: 'private', token: quelle, useCache: false });
    if (!r?.stream) throw fehler(`Quelle ohne Objekt (${kopiert} von ${m.eintraege.length} übernommen)`);
    const data = await lesen(r.stream);
    if (sha(data) !== e.sha256) throw fehler('Altbestand weicht von der geprüften Sicherung ab – neu sichern');
    try { await sdk.put(e.pfad, data, { access: 'private', token: ziel, addRandomSuffix: false, allowOverwrite: false, contentType: e.contentType || 'application/octet-stream' }); kopiert++; }
    catch (err) { if (!/exist/i.test(String(err?.message))) throw err; } // paralleler Start hat es angelegt
  }
  // Abschlussprüfung: Ziel vollständig und byte-gleich zur Sicherung (außer ein paralleler Lauf ist schon fertig)
  const nach = new Map((await alle(sdk, ziel, prefix)).map((b) => [b.pathname, b]));
  if (nach.has(marker)) { log(`Erstübernahme ${kennung}: von paralleler Instanz abgeschlossen`); return { status: 'erledigt', kennung }; }
  for (const e of m.eintraege) {
    const r = nach.has(e.pfad) ? await sdk.get(e.pfad, { access: 'private', token: ziel, useCache: false }) : null;
    if (!r?.stream || sha(await lesen(r.stream)) !== e.sha256) throw fehler('Ziel weicht nach der Übernahme von der Sicherung ab');
  }
  const info = JSON.stringify({ kennung, anzahl: m.eintraege.length, quelle: quellStore, ziel: zielStore, am: new Date().toISOString() });
  try { await sdk.put(marker, info, { access: 'private', token: ziel, addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' }); }
  catch (err) { if (!/exist/i.test(String(err?.message))) throw err; }
  log(`Erstübernahme ${kennung}: ${m.eintraege.length} Objekte geprüft, ${kopiert} neu angelegt, Quelle ${quellStore} unverändert`);
  return { status: 'uebernommen', kennung, anzahl: m.eintraege.length, kopiert };
}
