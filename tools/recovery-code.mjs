// Erzeugt einen einmaligen, zeitlich begrenzten Wiederherstellungscode für den Administratorzugang (AW-014).
// Der Code wird ausschließlich in die Übergabedatei auf Dirks Rechner geschrieben (nicht ausgegeben, nicht protokolliert).
// Ausgegeben wird nur der Wert für die geschützte Umgebungsvariable BESS_RECOVERY (enthält die SHA-256-Prüfsumme, nicht den Code).
// Aufruf: node tools/recovery-code.mjs --user u-admin --email <login-email> --url https://… --stunden 24 --datei <übergabedatei>
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const userId = arg('--user'), email = arg('--email'), url = (arg('--url') || '').replace(/\/$/, ''), datei = arg('--datei');
const stunden = Math.min(72, Math.max(1, Number(arg('--stunden') || 24)));
if (!userId || !email || !url || !datei) { console.error('Aufruf: --user --email --url --datei [--stunden 1–72]'); process.exit(2); }
if (existsSync(datei)) { console.error('Übergabedatei existiert bereits – wird nicht überschrieben.'); process.exit(3); }

const code = randomBytes(24).toString('base64url');
const id = `wh-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${randomBytes(3).toString('hex')}`;
const expiresAt = new Date(Date.now() + stunden * 3600e3).toISOString();
const ablauf = new Date(expiresAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
writeFileSync(datei, [
  'STROMKAI – einmalige Wiederherstellung des Administratorzugangs',
  `Kennung: ${id}`,
  `Gültig bis: ${ablauf} (Europe/Berlin)`,
  '',
  `1. Öffnen: ${url}/portal/wiederherstellen`,
  `2. E-Mail-Adresse: ${email}`,
  `3. Wiederherstellungscode: ${code}`,
  '4. Eigenes neues Passwort zweimal eingeben und speichern.',
  '',
  'Der Code ist nur einmal verwendbar und nach drei Fehleingaben gesperrt. Diese Datei danach löschen.',
  'Der Code wird nie per Link, E-Mail oder Chat übermittelt.',
  '',
].join('\r\n'), { flag: 'wx' });
console.log(JSON.stringify({ id, userId, codeHash: createHash('sha256').update(code).digest('hex'), expiresAt }));
