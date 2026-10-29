// Passwort-Link für den persönlichen Administratorzugang (AW-20261029-GE-CLAUDE-STROMKAI-ADMIN-SSO-RECOVERY-014).
// Ersetzt die Wiederherstellung mit manuell einzugebendem Code. Nur aktiv, wenn die geschützte Umgebungsvariable gesetzt ist:
//   BESS_RECOVERY = { "id": "…", "userId": "u-…", "tokenHash": "<sha256 des Link-Tokens>", "expiresAt": "<ISO>", "email": "<neue Anmeldeadresse>" }
// Der Link (/portal/passwort-festlegen?t=…) wird ausschließlich an die verifizierte Adresse gesendet; gespeichert ist nur die Prüfsumme.
// Eigenschaften: an genau ein aktives Administratorkonto gebunden, 32-Byte-Zufallstoken, einmalig (Verbrauch in db.meta.recoveryUsed),
// zeitlich begrenzt, nach Benutzung sofort ungültig. Beim Speichern wird die Anmeldeadresse auf die verifizierte Adresse umgestellt
// (Besitz des Postfachs = Identitätsnachweis), Rolle und Rechte bleiben unverändert, danach direkt angemeldet.
import { createHash, timingSafeEqual } from 'node:crypto';
import { getDb, persist, now, audit } from '../lib/store.mjs';
import { hashPassword, createSession, sessionCookie } from '../lib/auth.mjs';
import { parseForm, redirect, send, clientIp, tooMany, hit } from '../lib/http.mjs';
import { html } from '../lib/html.mjs';
import * as P from '../lib/policy.mjs';
import { authPage } from './views.mjs';
import { passwordProblem } from './benutzer.mjs';
import { landing, mfaRequired } from './routes.mjs';

const sha = (t) => createHash('sha256').update(String(t)).digest('hex');
const gleich = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function recoveryConfig(env = process.env) {
  try {
    const r = JSON.parse(env.BESS_RECOVERY || 'null');
    if (!r || !r.id || !r.userId || !/^[0-9a-f]{64}$/.test(r.tokenHash || '') || !Date.parse(r.expiresAt)) return null;
    if (r.email != null && !EMAIL.test(r.email)) return null;
    return r;
  } catch { return null; }
}

// Zustand: aktiv | abgelaufen | verbraucht | keine
export function recoveryStatus(db, r, t = Date.now()) {
  if (!r) return 'keine';
  if (db.meta.recoveryUsed?.[r.id]?.usedAt) return 'verbraucht';
  if (Date.parse(r.expiresAt) <= t) return 'abgelaufen';
  const u = db.users.find((x) => x.id === r.userId);
  if (!u || !u.active || !P.isAdmin(u)) return 'keine';
  if (r.email && db.users.some((x) => x.id !== u.id && String(x.email).toLowerCase() === r.email.toLowerCase())) return 'keine';
  return 'aktiv';
}

const ungueltig = html`<div class="auth-card"><h1>Link nicht gültig</h1><p>Dieser Link ist abgelaufen, wurde bereits verwendet oder ist unvollständig. Bitte wenden Sie sich an die Plattformadministration.</p><p><a class="btn" href="/portal/login">Zur Anmeldung</a></p></div>`;

export async function handleRecovery(req, res, url, method) {
  const db = getDb();
  const ip = clientIp(req);
  const page = (body, status = 200) => send(res, status, String(authPage({ title: 'STROMKAI – Passwort festlegen', body })));
  if (tooMany(`pl:${ip}`, 20, 15 * 60000)) return page(html`<div class="auth-card"><h1>Zu viele Versuche</h1><p>Bitte warten Sie 15 Minuten.</p></div>`, 429);
  let fields = {};
  if (method === 'POST') ({ fields } = await parseForm(req));
  const token = String((method === 'POST' ? fields.t : url.searchParams.get('t')) || '');
  const r = recoveryConfig();
  const status = recoveryStatus(db, r);
  if (status !== 'aktiv' || !token || !gleich(sha(token), r.tokenHash)) {
    hit(`pl:${ip}`);
    if (token) audit('passwortlink_ungueltig', null, { ip, status });
    return page(ungueltig, 404);
  }
  const target = db.users.find((x) => x.id === r.userId);
  const email = r.email || target.email;
  const form = (error) => html`<div class="auth-card"><h1>STROMKAI – Passwort festlegen</h1>
  <p class="muted">Konto: <strong>${email}</strong></p>
  ${error ? html`<div class="alert" role="alert">${error}</div>` : ''}
  <form method="post" action="/portal/passwort-festlegen" class="stack"><input type="hidden" name="t" value="${token}">
  <input type="email" name="username" value="${email}" autocomplete="username" hidden>
  <label for="neu">Neues Passwort</label><input id="neu" name="neu" type="password" autocomplete="new-password" required minlength="12">
  <label for="neu2">Neues Passwort bestätigen</label><input id="neu2" name="neu2" type="password" autocomplete="new-password" required minlength="12">
  <p class="small muted">Mindestens 12 Zeichen, mit Buchstaben und mindestens einer Ziffer oder einem Sonderzeichen. Der Teil vor dem @ Ihrer E-Mail-Adresse („${email.split('@')[0]}“) darf nicht enthalten sein.</p>
  <button class="btn btn-primary" type="submit">Passwort speichern</button></form></div>`;
  if (method === 'GET') return page(form());
  const problem = passwordProblem({ ...target, email }, String(fields.neu || ''), String(fields.neu2 || ''));
  if (problem) return page(form(problem), 422);
  const vorher = target.email;
  target.email = email;
  target.pw = hashPassword(String(fields.neu));
  target.mustChangePassword = false;
  target.passwordChangedAt = now();
  target.failedLogins = []; delete target.lockedUntil;
  target.sessionsNotBefore = Date.now(); // ältere Sitzungen dieses Kontos enden, die folgende neue bleibt gültig
  db.meta.recoveryUsed ??= {};
  db.meta.recoveryUsed[r.id] = { usedAt: now() };
  persist();
  audit('admin_passwort_ueber_link_gesetzt', target, { konto: target.id, ip, vorgang: r.id, anmeldeadresse_geaendert: vorher !== email ? 'ja' : 'nein' });
  const needMfa = mfaRequired(target); // in der Abnahmephase aus (BESS_MFA), sonst wie bei der normalen Anmeldung
  const s = createSession(target.id, { mfaPending: needMfa });
  res.setHeader('Set-Cookie', sessionCookie(s));
  return redirect(res, needMfa ? '/portal/mfa' : landing(target));
}
