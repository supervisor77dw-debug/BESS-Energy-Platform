// Einmaliges administratives Startpasswort für ein bestehendes Konto (AW-014).
// Liest die bisherige Kontenliste (nur Hashes), ersetzt beim Zielkonto Anmeldeadresse und Passwort-Hash und setzt
// "reset": "<Kennung>" (wird genau einmal angewendet) und "mustChangePassword": false. Alle anderen Einträge bleiben unverändert.
// Das Klartextpasswort steht ausschließlich in der Übergabedatei; ausgegeben wird nur die neue Kontenliste in eine Datei.
// Aufruf: node tools/admin-startpasswort.mjs --basis <BESS_ACCOUNTS.json> --user u-admin --email <adresse> --datei <übergabe> --aus <neue-liste.json>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, randomInt } from 'node:crypto';
import { hashPassword } from '../src/lib/auth.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const basis = arg('--basis'), userId = arg('--user'), email = arg('--email'), datei = arg('--datei'), aus = arg('--aus');
if (!basis || !userId || !email || !datei || !aus) { console.error('Aufruf: --basis --user --email --datei --aus'); process.exit(2); }
if (existsSync(datei)) { console.error('Übergabedatei existiert bereits – wird nicht überschrieben.'); process.exit(3); }
const acc = JSON.parse(readFileSync(basis, 'utf8'));
const ziel = (acc.users || []).find((u) => u.id === userId);
if (!ziel) { console.error(`Konto ${userId} nicht in der Kontenliste.`); process.exit(4); }

// 24 Zeichen aus einem Alphabet ohne verwechselbare Zeichen, garantiert Groß-/Kleinbuchstaben, Ziffer, Sonderzeichen
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
let pw = '';
do { pw = Array.from({ length: 20 }, () => A[randomInt(A.length)]).join('') + '-' + randomInt(10, 99) + '!'; }
while (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || /dirk/i.test(pw));
const kennung = `ar-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${randomBytes(3).toString('hex')}`;
Object.assign(ziel, { email, pw: hashPassword(pw), mustChangePassword: false, reset: kennung });
acc.rev = kennung;
writeFileSync(datei, [
  'STROMKAI – temporäres Startpasswort (Administratorzugang)',
  `Vorgang: ${kennung}`,
  '',
  'Anmeldung: https://bess-energy-platform.vercel.app/portal/login',
  `E-Mail-Adresse: ${email}`,
  `Passwort: ${pw}`,
  '',
  'Kein Passwortwechsel beim ersten Login, keine MFA. Ändern jederzeit selbst unter Benutzer & Berechtigungen → Eigenes Konto.',
  'Diese Datei nach der ersten erfolgreichen Anmeldung löschen.',
  '',
].join('\r\n'), { flag: 'wx' });
writeFileSync(aus, JSON.stringify(acc));
console.log(JSON.stringify({ kennung, konto: userId, email, konten: acc.users.map((u) => u.id) }));
