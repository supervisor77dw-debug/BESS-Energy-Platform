// Erstbefüllung und Kontenabgleich des Cloud-Zustands (Vercel Blob).
// Inhalte: synthetischer Datenbestand aus data/seed-lib.mjs. Zugänge: ausschließlich aus der geschützten
// Umgebungsvariable BESS_ACCOUNTS (nur scrypt-Hashes, erzeugt mit tools/provision-vercel.mjs).
// Fehlt BESS_ACCOUNTS, startet die Plattform nicht (fail closed) – das lokale Demo-Passwort wird nie verwendet.
//
// Kontenabgleich: Ändert sich BESS_ACCOUNTS (neue Provisionierung), werden beim nächsten Aufruf alle Konten
// neu gesetzt (Passwort, MFA-Ersteinrichtung offen, Passwortwechsel beim ersten Login), nicht aufgeführte
// Konten gesperrt und alle Sitzungen ungültig (neuer Sitzungsschlüssel).
import { createHash, randomBytes } from 'node:crypto';
import { buildSeed } from '../../data/seed-lib.mjs';
import { config } from '../config.mjs';

function readAccounts() {
  const raw = process.env.BESS_ACCOUNTS;
  if (!raw) throw new Error('BESS_ACCOUNTS fehlt – keine Erstbefüllung ohne provisionierte Zugänge.');
  return { acc: JSON.parse(raw), hash: createHash('sha256').update(raw).digest('hex') };
}

export function applyAccounts(db, acc, hash) {
  const byId = new Map((acc.users || []).map((u) => [u.id, u]));
  let geaendert = false;
  for (const u of db.users) {
    if (u.createdVia === 'verwaltung') continue; // in der Benutzerverwaltung angelegte Konten verwaltet der Kontenabgleich nicht
    const a = byId.get(u.id);
    if (!a || !/^scrypt\$/.test(a.pw || '')) { u.active = false; continue; } // nicht mehr aufgeführt: gesperrt, Passwort bleibt für eine spätere Reaktivierung erhalten
    u.active = true;
    // Persönlich übernommene Konten (selbst gesetztes Passwort) bleiben unverändert – Passwort, Anmeldeadresse, Name (AW-014).
    // Ein Abgleich setzt nur Startzugänge, die noch nicht persönlich übernommen wurden; Reset nur mit Eintrag "reset": true.
    if (u.passwordChangedAt && !u.mustChangePassword && u.pw && a.reset !== true) continue;
    u.email = a.email || u.email;
    u.name = a.name || u.name;
    u.pw = a.pw;
    u.mustChangePassword = a.mustChangePassword !== false;
    geaendert = true;
    if (u.mfa) { u.totp = null; delete u.totpEnrolledAt; } // MFA wird beim ersten Login vom Nutzer selbst eingerichtet
  }
  db.gateUsers = (acc.gate || []).filter((g) => /^scrypt\$/.test(g.hash || ''));
  if (config.gate && !db.gateUsers.length) throw new Error('Vorschau-Schranke aktiv, aber BESS_ACCOUNTS enthält keine Schrankenzugänge.');
  db.meta.accountsHash = hash;
  db.meta.accountsAppliedAt = new Date().toISOString();
  // Sitzungen nur beenden, wenn tatsächlich Zugänge neu gesetzt wurden (kein Abmelden durch bloße Bereitstellung)
  if (geaendert || !db.meta.sessionKey) { db.meta.sessionKey = randomBytes(32).toString('base64'); db.revoked = []; }
}

export async function bootstrapFromEnv() {
  const { acc, hash } = readAccounts();
  const { db, files } = buildSeed({ external: false });
  db.meta.stage = config.stage;
  db.meta.environment = process.env.VERCEL_ENV || 'unbekannt';
  db.meta.bootstrappedAt = new Date().toISOString();
  db.revoked = [];
  applyAccounts(db, acc, hash);
  return { db, files };
}

// Liefert true, wenn Konten neu gesetzt wurden (Aufrufer speichert dann).
export function syncAccounts(db) {
  const { acc, hash } = readAccounts();
  if (db.meta.accountsHash === hash) return false;
  applyAccounts(db, acc, hash);
  db.audit.push({ id: `log-sync-${Date.now()}`, at: new Date().toISOString(), event: 'konten_abgeglichen', actor: null, actorName: 'System (Provisionierung)' });
  return true;
}
