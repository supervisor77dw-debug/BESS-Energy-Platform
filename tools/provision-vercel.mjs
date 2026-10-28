// Erzeugt die Zugänge für das Vercel-Preview:
//  - BESS_ACCOUNTS_<zeit>.json: nur scrypt-Hashes → Wert der geschützten Vercel-Umgebungsvariable BESS_ACCOUNTS (Preview)
//  - ZUGAENGE_BESS-Vercel_<zeit>.txt: Klartext-Zugänge für Dirk (vertraulich, persönliche Weitergabe an Markus)
// Beide Dateien nur außerhalb von Dropbox und außerhalb des Repositorys.
// Neue Zugänge wirken erst, wenn der Cloud-Zustand neu angelegt wird (state/db.json im Blob-Speicher löschen).
// Aufruf: node tools/provision-vercel.mjs [--out C:\Users\dirk\BESS-Preview-Zugaenge] [--url <preview-adresse>]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/lib/auth.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = resolve(arg('--out', join(process.env.USERPROFILE || '.', 'BESS-Preview-Zugaenge')));
if (/dropbox/i.test(out) || out.startsWith(resolve('.'))) { console.error('Abbruch: Zielordner darf nicht in Dropbox oder im Repository liegen.'); process.exit(2); }
mkdirSync(out, { recursive: true });

const pw = () => randomBytes(12).toString('base64url');
const stage = arg('--stage', 'qa'); // 'qa' (geschützte Vorschau, Schranke + Rollenkonten) | 'abnahme' (öffentlich, nur persönliche Konten)
if (stage === 'abnahme') {
  const url = arg('--url', '<öffentliche Adresse>');
  const people = [
    { id: 'u-admin', email: 'dirk@abnahme.stromkai.invalid', name: 'Dirk – Plattformadministration', who: 'Dirk', role: 'Plattformadministration (alle Bereiche)' },
    { id: 'u-markus', email: 'markus@abnahme.stromkai.invalid', name: 'Markus – Vertriebskoordination Nord', who: 'Markus', role: 'Vertriebskoordination Nord (Nordprojekte, Eigentümerkontakte)' },
  ].map((p) => ({ ...p, password: pw() }));
  const env = { users: people.map((p) => ({ id: p.id, email: p.email, name: p.name, pw: hashPassword(p.password), mustChangePassword: true })) };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  writeFileSync(join(out, `BESS_ACCOUNTS_ABNAHME_${stamp}.json`), JSON.stringify(env), { mode: 0o600 });
  const block = (p) => `=== ${p.who} – ${p.role} ===
Benutzername (E-Mail-Feld):  ${p.email}
Startpasswort (einmalig):    ${p.password}
`;
  writeFileSync(join(out, `ZUGAENGE_STROMKAI-Abnahme_${stamp}.txt`), `STROMKAI (Arbeitsname) – Zugänge öffentlicher Abnahmekandidat
VERTRAULICH · nicht weiterleiten · nicht in Dropbox, Mail oder Chat kopieren
Erzeugt: ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} Europe/Berlin · Auftrag AW-20261028-GE-CLAUDE-BESS-PUBLIC-PORTAL-005

Öffentliche Website (ohne Anmeldung):  ${url}
Login-Seite:                           ${url.replace(/\/$/, '')}/portal/login   (oder oben rechts „Login / Partnerportal“)

So melden Sie sich zum ersten Mal an
1. Login-Seite öffnen, Benutzername und Startpasswort eingeben.
2. Zweiten Faktor einrichten: Authenticator-App öffnen (z. B. Microsoft oder Google Authenticator),
   „Konto hinzufügen“ → QR-Code scannen, dann den 6-stelligen Code eingeben.
   Kein QR-Scan möglich? Den angezeigten Schlüssel manuell eingeben (zeitbasiert, 6 Stellen, 30 Sekunden).
3. Eigenes Passwort festlegen (mindestens 12 Zeichen, ohne den Benutzernamen). Das Startpasswort ist danach ungültig.
4. Bei jeder weiteren Anmeldung: Benutzername, eigenes Passwort, 6-stelliger Code aus der App.

Passwort vergessen / neues Handy: Dirk vergibt in „Verwaltung“ ein Einmalpasswort bzw. setzt die MFA-Einrichtung zurück.
Für Dirks eigenes Konto: neue Provisionierung (tools/provision-vercel.mjs --stage abnahme), siehe docs/HOSTING_VERCEL.md.

${people.map(block).join('\n')}
Weitergabe an Markus: Benutzername und Startpasswort getrennt übermitteln (z. B. Benutzername per Mail, Passwort telefonisch
oder per Signal/Threema). Markus richtet MFA und sein eigenes Passwort selbst ein.
`, { mode: 0o600 });
  console.log(`Abnahme-Zugänge erzeugt in ${out} (BESS_ACCOUNTS_ABNAHME_${stamp}.json = nur Hashes, ZUGAENGE_STROMKAI-Abnahme_${stamp}.txt = vertraulich).`);
  process.exit(0);
}
const accounts = [
  ['u-admin', 'dirk@bess-vorschau.invalid', 'Dirk – Plattformadministration', true],
  ['u-markus', 'markus@bess-vorschau.invalid', 'Markus – Vertriebskoordination Nord', true],
  ['u-pl', 'projektleitung@demo.invalid', 'Projektleitung (synthetisch)', true],
  ['u-own-a', 'eigentuemer.a@demo.invalid', 'Eigentümer A (synthetisch)', false],
  ['u-own-b', 'eigentuemer.b@demo.invalid', 'Eigentümerin B (synthetisch)', false],
  ['u-inv-a', 'investor.a@demo.invalid', 'Investor A (synthetisch)', true],
  ['u-inv-b', 'investor.b@demo.invalid', 'Investor B (synthetisch)', true],
  ['u-kom', 'gemeinde@demo.invalid', 'Gemeinde (synthetisch)', false],
  ['u-tech', 'technik@demo.invalid', 'Technikpartner (synthetisch)', false],
].map(([id, email, name, mfa]) => ({ id, email, name, mfa, password: pw() }));
const gate = [{ id: 'g-dirk', user: 'dirk', name: 'Dirk' }, { id: 'g-markus', user: 'markus', name: 'Markus' }].map((g) => ({ ...g, password: pw() }));

const env = { users: accounts.map((a) => ({ id: a.id, email: a.email, pw: hashPassword(a.password) })), gate: gate.map((g) => ({ id: g.id, user: g.user, name: g.name, hash: hashPassword(g.password), active: true })) };
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
writeFileSync(join(out, `BESS_ACCOUNTS_${stamp}.json`), JSON.stringify(env), { mode: 0o600 });
const url = arg('--url', '<Preview-Adresse laut Abschlussbericht>');
const line = (a) => `  ${a.name.padEnd(40)} ${a.email.padEnd(32)} Passwort: ${a.password}${a.mfa ? '   (MFA beim ersten Login einrichten)' : ''}`;
writeFileSync(join(out, `ZUGAENGE_BESS-Vercel_${stamp}.txt`), `BESS Energy Platform – Zugänge Vercel-Preview (VERTRAULICH, nicht weiterleiten, nicht in Dropbox/Mail/Chat kopieren)
Erzeugt: ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} Europe/Berlin · Auftrag AW-BESS-PLATFORM-GITHUB-VERCEL-004
Adresse: ${url}
Ablauf: 1) Vercel-Freigabelink bzw. Vercel-Anmeldung  2) Vorschau-Schranke  3) Portal-Konto (+ MFA). Alle Daten synthetisch.

=== Markus (persönlich übergeben; Schranke und Portal über getrennte Kanäle) ===
Schranke:  Prüferkennung: markus   Passwort: ${gate[1].password}
Portal:
${line(accounts[1])}

=== Dirk ===
Schranke:  Prüferkennung: dirk     Passwort: ${gate[0].password}
Portal:
${line(accounts[0])}

=== Synthetische Rollenkonten für die fachliche Prüfung (nur Dirk) ===
${accounts.slice(2).map(line).join('\n')}
`, { mode: 0o600 });
console.log(`Zugänge erzeugt in ${out} (BESS_ACCOUNTS_${stamp}.json = nur Hashes, ZUGAENGE_BESS-Vercel_${stamp}.txt = vertraulich).`);
