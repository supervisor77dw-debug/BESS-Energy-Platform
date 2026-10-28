// Setzt die MFA-Einrichtung einzelner Konten zurück (nächster Login → Ersteinrichtung).
// Nur bei gestopptem Server ausführen (der Server hält den Datenbestand im Speicher).
// Aufruf: node tools/preview/reset-mfa.mjs --runtime C:\dev\bess-preview\runtime dirk@bess-vorschau.invalid markus@bess-vorschau.invalid
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const i = process.argv.indexOf('--runtime');
const runtime = process.argv[i + 1];
const emails = process.argv.slice(2).filter((a, k, all) => a !== '--runtime' && all[k - 1] !== '--runtime');
const file = join(runtime, 'db.json');
const db = JSON.parse(readFileSync(file, 'utf8'));
for (const e of emails) {
  const u = db.users.find((x) => x.email === e);
  if (!u) { console.error(`Konto nicht gefunden: ${e}`); process.exit(2); }
  u.totp = null; delete u.totpEnrolledAt;
  db.audit.push({ id: `log-reset-${Date.now()}`, at: new Date().toISOString(), event: 'mfa_zurueckgesetzt', actor: null, actorName: 'Werkzeug reset-mfa', konto: u.id });
  console.log(`MFA zurückgesetzt: ${e}`);
}
writeFileSync(file + '.tmp', JSON.stringify(db, null, 1));
renameSync(file + '.tmp', file);
