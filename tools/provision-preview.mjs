// Richtet die EXTERNE Vorschau ein bzw. setzt sie vollständig zurück:
//  1. synthetischer Datenbestand mit Zufallspasswörtern (MFA-Ersteinrichtung beim ersten Login)
//  2. Vorschau-Schranke (gate.json, nur scrypt-Hashes) für die benannten Prüfer
//  3. Zugangsdatei für Dirk außerhalb von Dropbox (persönliche Weitergabe an Markus)
// Aufruf: node tools/provision-preview.mjs --runtime C:\dev\bess-preview\runtime --out C:\Users\dirk\BESS-Preview-Zugaenge
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/lib/auth.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const runtime = resolve(arg('--runtime', 'C:\\dev\\bess-preview\\runtime'));
const out = resolve(arg('--out', join(process.env.USERPROFILE || '.', 'BESS-Preview-Zugaenge')));
if (/dropbox/i.test(runtime) || /dropbox/i.test(out)) { console.error('Abbruch: Laufzeitdaten und Zugangsdaten dürfen nicht in Dropbox liegen.'); process.exit(2); }

mkdirSync(out, { recursive: true });
const tmpCreds = join(out, '.seed-creds.json');
execFileSync(process.execPath, [join(ROOT, 'data', 'seed.mjs'), runtime], { env: { ...process.env, BESS_SEED_EXTERNAL: '1', BESS_SEED_CREDS: tmpCreds }, stdio: 'inherit' });
const accounts = JSON.parse(readFileSync(tmpCreds, 'utf8'));
rmSync(tmpCreds);

const testers = [{ id: 'g-dirk', user: 'dirk', name: 'Dirk' }, { id: 'g-markus', user: 'markus', name: 'Markus' }];
const gatePw = {};
const gate = { note: 'Vorschau-Schranke – nur Hashes', createdAt: new Date().toISOString(), users: testers.map((t) => { const p = randomBytes(12).toString('base64url'); gatePw[t.id] = p; return { ...t, hash: hashPassword(p), active: true }; }) };
writeFileSync(join(runtime, 'gate.json'), JSON.stringify(gate, null, 1));

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const acc = (id) => accounts.find((a) => a.id === id);
const line = (a) => `  ${a.name.padEnd(36)} ${a.email.padEnd(32)} Passwort: ${a.password}${a.mfa ? '   (MFA wird beim ersten Login eingerichtet)' : ''}`;
const txt = `BESS Energy Platform – Zugänge externe Vorschau (VERTRAULICH, nicht weiterleiten, nicht in Dropbox ablegen)
Erzeugt: ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} Europe/Berlin · Auftrag AW-20261028-GE-CLAUDE-BESS-EXTERNE-VORSCHAU-002
Alle Daten der Vorschau sind synthetisch. Ein erneutes Ausführen von provision-preview.mjs macht diese Zugänge ungültig.

=== Für Markus (persönlich übergeben, z. B. telefonisch oder verschlüsselt) ===
Schritt 1 – Vorschau-Schranke:  Prüferkennung: markus   Passwort: ${gatePw['g-markus']}
Schritt 2 – Portal-Konto:
${line(acc('u-markus'))}

=== Für Dirk ===
Schritt 1 – Vorschau-Schranke:  Prüferkennung: dirk     Passwort: ${gatePw['g-dirk']}
Schritt 2 – Portal-Konto:
${line(acc('u-admin'))}

=== Synthetische Rollenkonten für die fachliche Prüfung (nur Dirk) ===
${accounts.filter((a) => !['u-admin', 'u-markus'].includes(a.id)).map(line).join('\n')}
`;
const file = join(out, `ZUGAENGE_BESS-Vorschau_${stamp}.txt`);
writeFileSync(file, txt, { mode: 0o600 });
console.log(`Vorschau eingerichtet. Laufzeit: ${runtime}\nZugangsdatei (vertraulich): ${file}`);
