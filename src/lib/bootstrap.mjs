// Erstbefüllung des Cloud-Zustands (Vercel Blob), wenn noch kein Zustand existiert.
// Inhalte: synthetischer Datenbestand aus data/seed-lib.mjs. Zugänge: ausschließlich aus der geschützten
// Umgebungsvariable BESS_ACCOUNTS (nur scrypt-Hashes, erzeugt mit tools/provision-vercel.mjs).
// Fehlt BESS_ACCOUNTS, startet die Plattform nicht (fail closed) – das lokale Demo-Passwort wird nie verwendet.
import { buildSeed } from '../../data/seed-lib.mjs';

export async function bootstrapFromEnv() {
  const raw = process.env.BESS_ACCOUNTS;
  if (!raw) throw new Error('BESS_ACCOUNTS fehlt – keine Erstbefüllung ohne provisionierte Zugänge.');
  const acc = JSON.parse(raw);
  const { db, files } = buildSeed({ external: false });
  const byId = new Map((acc.users || []).map((u) => [u.id, u]));
  for (const u of db.users) {
    const a = byId.get(u.id);
    if (!a || !/^scrypt\$/.test(a.pw || '')) { u.active = false; u.pw = null; continue; }
    u.email = a.email || u.email;
    u.pw = a.pw;
    if (u.mfa) u.totp = null; // MFA wird beim ersten Login vom Nutzer selbst eingerichtet
  }
  db.gateUsers = (acc.gate || []).filter((g) => /^scrypt\$/.test(g.hash || ''));
  if (!db.gateUsers.length) throw new Error('BESS_ACCOUNTS enthält keine Schrankenzugänge.');
  db.meta.environment = process.env.VERCEL_ENV || 'unbekannt';
  db.meta.bootstrappedAt = new Date().toISOString();
  return { db, files };
}
