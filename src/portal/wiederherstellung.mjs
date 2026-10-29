// Notfall-Wiederherstellung des persönlichen Administratorzugangs (AW-20261029-GE-CLAUDE-STROMKAI-ADMIN-SSO-RECOVERY-014).
// Nur aktiv, wenn die geschützte Umgebungsvariable BESS_RECOVERY gesetzt ist:
//   { "id": "…", "userId": "u-…", "codeHash": "<sha256 des Codes>", "expiresAt": "<ISO>" }
// Der Code selbst existiert nur in der Übergabedatei auf Dirks Rechner (tools/recovery-code.mjs); gespeichert ist nur die Prüfsumme.
// Eigenschaften: an genau ein aktives Administratorkonto gebunden, einmalig (Verbrauch in db.meta.recoveryUsed), zeitlich begrenzt,
// nach drei falschen Codes verbrannt, Code nie in URL, Protokoll oder Antwort. Danach gilt allein das von Dirk gesetzte Passwort.
import { createHash, timingSafeEqual } from 'node:crypto';
import { getDb, persist, now, audit } from '../lib/store.mjs';
import { hashPassword } from '../lib/auth.mjs';
import { parseForm, redirect, send, clientIp, tooMany, hit, formToken, checkFormToken } from '../lib/http.mjs';
import { html } from '../lib/html.mjs';
import * as P from '../lib/policy.mjs';
import { authPage } from './views.mjs';
import { passwordProblem } from './benutzer.mjs';

const MAX_FEHLVERSUCHE = 3;
const sha = (t) => createHash('sha256').update(String(t)).digest('hex');
const gleich = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function recoveryConfig(env = process.env) {
  try {
    const r = JSON.parse(env.BESS_RECOVERY || 'null');
    if (!r || !r.id || !r.userId || !/^[0-9a-f]{64}$/.test(r.codeHash || '') || !Date.parse(r.expiresAt)) return null;
    return r;
  } catch { return null; }
}

// Zustand: aktiv | abgelaufen | verbraucht | gesperrt | keine
export function recoveryStatus(db, r, t = Date.now()) {
  if (!r) return 'keine';
  const m = db.meta.recoveryUsed?.[r.id];
  if (m?.usedAt) return 'verbraucht';
  if ((m?.fehlversuche || 0) >= MAX_FEHLVERSUCHE) return 'gesperrt';
  if (Date.parse(r.expiresAt) <= t) return 'abgelaufen';
  const u = db.users.find((x) => x.id === r.userId);
  if (!u || !u.active || !P.isAdmin(u)) return 'keine';
  return 'aktiv';
}

export async function handleRecovery(req, res, method) {
  const db = getDb();
  const ip = clientIp(req);
  const r = recoveryConfig();
  const page = (body, status = 200) => send(res, status, String(authPage({ title: 'Zugang wiederherstellen', body })));
  const status = recoveryStatus(db, r);
  if (status !== 'aktiv') {
    if (method === 'POST') audit('wiederherstellung_abgewiesen', null, { ip, status });
    return page(html`<div class="auth-card"><h1>Wiederherstellung nicht verfügbar</h1><p>Es ist keine gültige Wiederherstellung eingerichtet, oder sie wurde bereits verwendet bzw. ist abgelaufen.</p><p><a class="btn" href="/portal/login">Zur Anmeldung</a></p></div>`, 404);
  }
  const target = db.users.find((x) => x.id === r.userId);
  const form = (error) => html`<div class="auth-card"><h1>Administratorzugang wiederherstellen</h1>
  <p class="muted">Einmalige Wiederherstellung für das Administratorkonto. Den Wiederherstellungscode finden Sie in der Übergabedatei auf Ihrem Rechner. Danach gilt ausschließlich Ihr neues Passwort.</p>
  ${error ? html`<div class="alert" role="alert">${error}</div>` : ''}
  <form method="post" action="/portal/wiederherstellen" class="stack"><input type="hidden" name="_t" value="${formToken()}">
  <label for="email">E-Mail-Adresse des Administratorkontos</label><input id="email" name="email" type="email" autocomplete="username" required>
  <label for="code">Wiederherstellungscode</label><input id="code" name="code" type="password" autocomplete="one-time-code" required>
  <label for="neu">Neues persönliches Passwort</label><input id="neu" name="neu" type="password" autocomplete="new-password" required minlength="12">
  <label for="neu2">Passwort wiederholen</label><input id="neu2" name="neu2" type="password" autocomplete="new-password" required minlength="12">
  <p class="small muted">Mindestens 12 Zeichen, Buchstaben und mindestens eine Ziffer oder ein Sonderzeichen, nicht der Benutzername.</p>
  <button class="btn btn-primary" type="submit">Passwort festlegen</button></form></div>`;
  if (method === 'GET') return page(form());
  if (tooMany(`wh:${ip}`, 5, 15 * 60000)) return page(form('Zu viele Versuche. Bitte warten Sie 15 Minuten.'), 429);
  const { fields } = await parseForm(req);
  if (!checkFormToken(fields._t, 0)) return page(form('Das Formular ist abgelaufen. Bitte erneut versuchen.'), 400);
  const emailOk = String(fields.email || '').trim().toLowerCase() === String(target.email).toLowerCase();
  const codeOk = gleich(sha(String(fields.code || '').trim()), r.codeHash);
  if (!emailOk || !codeOk) {
    hit(`wh:${ip}`);
    db.meta.recoveryUsed ??= {};
    const m = (db.meta.recoveryUsed[r.id] ??= { fehlversuche: 0 });
    m.fehlversuche += 1;
    audit(m.fehlversuche >= MAX_FEHLVERSUCHE ? 'wiederherstellung_gesperrt' : 'wiederherstellung_fehlgeschlagen', null, { ip, fehlversuche: m.fehlversuche });
    return page(form('E-Mail-Adresse oder Wiederherstellungscode ist nicht korrekt.'), 401);
  }
  const problem = passwordProblem(target, String(fields.neu || ''), String(fields.neu2 || ''));
  if (problem) return page(form(problem), 422);
  target.pw = hashPassword(String(fields.neu));
  target.mustChangePassword = false;
  target.passwordChangedAt = now();
  target.failedLogins = []; delete target.lockedUntil;
  target.sessionsNotBefore = Date.now() + 1; // ältere Sitzungen dieses Kontos enden
  db.meta.recoveryUsed ??= {};
  db.meta.recoveryUsed[r.id] = { ...(db.meta.recoveryUsed[r.id] || {}), usedAt: now() };
  persist();
  audit('admin_zugang_wiederhergestellt', target, { konto: target.id, ip, wiederherstellung: r.id });
  return redirect(res, '/portal/login?m=wiederhergestellt');
}
