// Lesende Prüfung der Grundstücks-Altdaten (AW-20261101-GE-CLAUDE-STROMKAI-AKTIVE-AKQUISE-021).
// Liest eine db.json-Kopie und meldet je Grundstück: Flurstücksangabe strukturiert, eindeutig zerlegbar oder Prüffall,
// sowie die Belegbarkeit der Eigentümerzuordnung. Schreibt nichts, ruft keine Dienste auf, gibt keine Personendaten aus.
// Aufruf: node tools/akquise-altdaten.mjs <pfad/zu/db.json>
import { readFileSync } from 'node:fs';
import { altdatenPruefen } from '../src/portal/flaechen.mjs';

const datei = process.argv[2];
if (!datei) { console.error('Aufruf: node tools/akquise-altdaten.mjs <pfad/zu/db.json>'); process.exit(2); }
const db = JSON.parse(readFileSync(datei, 'utf8'));
for (const k of ['parcels', 'contacts', 'contracts']) db[k] ??= [];
const befund = altdatenPruefen(db);
const zaehle = (feld) => befund.reduce((m, b) => ({ ...m, [b[feld]]: (m[b[feld]] || 0) + 1 }), {});
console.log(JSON.stringify({ grundstuecke: befund.length, flurstueck: zaehle('flurstueck'), eigentuemer: zaehle('eigentuemer'),
  pruefliste: befund.filter((b) => b.flurstueck !== 'strukturiert oder leer' || !['Vertrag vorhanden', 'keine Zuordnung'].includes(b.eigentuemer)).map(({ id, projectId, flurstueck, eigentuemer }) => ({ id, projectId, flurstueck, eigentuemer })) }, null, 2));
