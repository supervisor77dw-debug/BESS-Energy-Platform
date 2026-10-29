// Erzeugt einen einmaligen, zeitlich begrenzten Passwort-Link für den Administratorzugang (AW-014).
// Der Link (enthält das 32-Byte-Token) wird nur in die Übergabedatei auf Dirks Rechner geschrieben – für den Versand an die
// verifizierte Adresse bzw. als autorisierter Ersatzweg. Ausgegeben wird nur der Wert für die geschützte Umgebungsvariable
// BESS_RECOVERY (SHA-256-Prüfsumme des Tokens, nicht das Token).
// Aufruf: node tools/recovery-code.mjs --user u-admin --email <neue Anmeldeadresse> --url https://… --stunden 12 --datei <übergabedatei>
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const userId = arg('--user'), email = arg('--email'), url = (arg('--url') || '').replace(/\/$/, ''), datei = arg('--datei');
const stunden = Math.min(24, Math.max(1, Number(arg('--stunden') || 12)));
if (!userId || !email || !url || !datei) { console.error('Aufruf: --user --email --url --datei [--stunden 1–24]'); process.exit(2); }
if (existsSync(datei)) { console.error('Übergabedatei existiert bereits – wird nicht überschrieben.'); process.exit(3); }

const token = randomBytes(32).toString('base64url');
const id = `pl-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${randomBytes(3).toString('hex')}`;
const expiresAt = new Date(Date.now() + stunden * 3600e3).toISOString();
const ablauf = new Date(expiresAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
writeFileSync(datei, [
  'STROMKAI – Passwort festlegen (einmaliger Link)',
  `Vorgang: ${id}`,
  `Konto: ${email}`,
  `Gültig bis: ${ablauf} (Europe/Berlin)`,
  '',
  `${url}/portal/passwort-festlegen?t=${token}`,
  '',
  'Nur einmal verwendbar. Nach dem Speichern sind Sie direkt angemeldet. Diese Datei danach löschen.',
  '',
].join('\r\n'), { flag: 'wx' });
console.log(JSON.stringify({ id, userId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt, email }));
