// QA-Identitätsspiegel (AW-STROMKAI-20261031-CONSOLIDATION-ACQUISITION-020).
// Zweck: In der geschützten QA meldet sich die Administration mit ihrer bestehenden STROMKAI-Identität der Produktion an –
// keine neuen Konten, Passwörter oder Anmeldestufen. Grenzen:
//  - aktiv nur in Stufe 'qa' mit BESS_QA_ADMIN_SPIEGEL=1, nie im Production-Ziel (config.qaSpiegel);
//  - die Produktion wird ausschließlich gelesen (store.leseProduktionszustand), nie geschrieben;
//  - gespiegelt werden nur aktive Konten mit Rolle 'admin';
//  - der Passwort-Hash der Produktion wird nicht in die QA übernommen (Spiegelkonto ohne lokales Passwort, pw: null);
//  - Passwortänderung und Kontenabgleich wirken nicht auf Spiegelkonten.
import { config } from '../config.mjs';
import { verifyPassword } from './auth.mjs';
import { leseProduktionszustand } from './store.mjs';

const istAdmin = (u) => u.role === 'admin' || (u.roles || []).includes('admin');
export const spiegelId = (prodId) => `spiegel-${prodId}`;

// Ergebnis: null (Spiegel aus oder E-Mail gehört zu keinem Administrationskonto der Produktion),
// { abgelehnt: true } (Administrationskonto, Passwort falsch) oder { user } (QA-Spiegelkonto, angemeldet).
export async function spiegelAnmeldung(db, email, password) {
  if (!config.qaSpiegel) return null;
  const prod = await leseProduktionszustand();
  const pu = prod?.users?.find((x) => x.active && istAdmin(x) && String(x.email || '').toLowerCase() === email);
  if (!pu) return null;
  if (!pu.pw || !verifyPassword(password, pu.pw)) return { abgelehnt: true };
  const id = spiegelId(pu.id);
  let u = db.users.find((x) => x.id === id);
  if (!u) { u = { id, createdAt: new Date().toISOString() }; db.users.push(u); }
  Object.assign(u, { email: pu.email, name: pu.name, role: 'admin', roles: ['admin'], active: true, pw: null, mfa: false, totp: null, mustChangePassword: false,
    createdVia: 'spiegel', spiegel: { quelle: 'abnahme', id: pu.id, zuletzt: new Date().toISOString() } });
  return { user: u };
}
