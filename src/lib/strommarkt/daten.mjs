// Ergebnisdaten „Strommarkt & Backtesting“ (Format stromkai.portal.strommarkt/1, erzeugt im STROMKAI-Trading-System,
// Auftrag AW-20261029-GE-CLAUDE-STROMKAI-STUFE2-013). Nur reale öffentliche Marktdaten (SMARD) und Simulationen
// neutraler Anlagengrößen – keine Projekt-, Vertrags- oder Finanzdaten. Liegt unter src/ und wird nicht öffentlich ausgeliefert.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMAT = 'stromkai.portal.strommarkt/1';
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'strommarkt-daten');
const cache = new Map();
let sums = null;

// Lädt eine Datei und prüft ihre SHA-256-Prüfsumme gegen SHA256SUMS.json (Integrität des Exports).
export function lade(name) {
  if (cache.has(name)) return cache.get(name);
  if (!/^(meta|ergebnisse|preise_tage)\.json$|^tage\/\d{4}-\d{2}\.json$/.test(name)) throw new Error('unzulässiger Dateiname');
  const p = join(DIR, name);
  if (!existsSync(p)) return null;
  sums ??= JSON.parse(readFileSync(join(DIR, 'SHA256SUMS.json'), 'utf8'));
  const buf = readFileSync(p);
  if (createHash('sha256').update(buf).digest('hex') !== sums[name]) throw new Error(`Prüfsumme stimmt nicht: ${name}`);
  const obj = JSON.parse(buf.toString('utf8'));
  if (obj.format !== FORMAT) throw new Error(`Unbekanntes Format: ${name}`);
  cache.set(name, obj);
  return obj;
}

export const verfuegbar = () => existsSync(join(DIR, 'meta.json'));

export function tag(datum) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return null;
  return lade(`tage/${datum.slice(0, 7)}.json`)?.tage?.[datum] || null;
}
