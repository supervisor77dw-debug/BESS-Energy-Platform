// Vorschau-Zugangsschranke: eigene Anmeldung VOR Website und Portal. Ohne gültigen Schrankenzugang
// liefert der Server ausschließlich die Schrankenseite und deren Stylesheet aus.
import { randomBytes } from 'node:crypto';
import { config } from '../config.mjs';
import { verifyPassword, seal, unseal, isRevoked, revoke } from './auth.mjs';
import { parseCookies, parseForm, send, redirect, formToken, checkFormToken, tooMany, hit, clientIp } from './http.mjs';
import { html, esc } from './html.mjs';
import { audit, getDb } from './store.mjs';

// Zugänge liegen im Datenbestand (gateUsers, nur scrypt-Hashes); Token sind verschlüsselte Cookies.
const gateUsers = () => getDb().gateUsers || [];
export function loadGate() {
  const n = gateUsers().length;
  if (!n) throw new Error('Vorschau-Schranke aktiv, aber keine Prüferzugänge im Datenbestand – Provisionierung ausführen.');
  return n;
}

const cookie = (v, maxAge) => `bess_gate=${v}; Path=/; HttpOnly; SameSite=Lax${config.secureCookies ? '; Secure' : ''}${maxAge != null ? `; Max-Age=${maxAge}` : ''}`;
const OPEN = new Set(['/_vorschau/anmelden', '/static/css/portal.css', '/static/img/favicon.svg']);

function valid(req) {
  const e = unseal(parseCookies(req).bess_gate, 'gate');
  if (!e) return null;
  if (Date.now() - e.created > config.gateTtlMs || isRevoked(e.id) || !gateUsers().some((u) => u.id === e.gateUserId && u.active)) return null;
  return e;
}

function gatePage(res, { error, status = 200, next = '/' } = {}) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-store');
  return send(res, status, String(html`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Geschützte Vorschau</title><link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/static/css/portal.css"></head>
<body class="auth"><main class="auth-main"><div class="auth-card">
<h1>Geschützte Vorschau</h1>
<p class="muted">Diese Testumgebung ist nur für eingeladene Prüfer zugänglich. Die Zugangsdaten erhalten Sie persönlich.</p>
${error ? html`<div class="alert" role="alert">${error}</div>` : ''}
<form method="post" action="/_vorschau/anmelden" class="stack">
<input type="hidden" name="_t" value="${formToken()}"><input type="hidden" name="next" value="${next}">
<label for="g-user">Prüferkennung</label><input id="g-user" name="user" autocomplete="username" required autofocus>
<label for="g-pw">Vorschau-Passwort</label><input id="g-pw" name="password" type="password" autocomplete="current-password" required>
<button class="btn btn-primary" type="submit">Weiter zur Vorschau</button>
</form>
<p class="small muted">Danach folgt die eigentliche Anmeldung zum Portal mit eigenem Konto.</p>
</div></main></body></html>`));
}

// Gibt true zurück, wenn die Anfrage hier vollständig beantwortet wurde.
export async function handleGate(req, res, url) {
  if (!config.gate) return false;
  const p = url.pathname;
  if (p === '/_vorschau/anmelden' && req.method === 'POST') {
    const { fields } = await parseForm(req);
    const ip = clientIp(req);
    const next = /^\/[\w\-/.?=&%]*$/.test(fields.next || '') && !String(fields.next).startsWith('//') ? fields.next : '/';
    if (!checkFormToken(fields._t, 0)) return gatePage(res, { error: 'Das Formular ist abgelaufen. Bitte erneut versuchen.', status: 400, next }), true;
    if (tooMany(`gate-ip:${ip}`, 10, 15 * 60000)) { audit('vorschau_schranke_gesperrt', null, { ip }); return gatePage(res, { error: 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.', status: 429, next }), true; }
    const u = gateUsers().find((x) => x.active && x.user === String(fields.user || '').trim().toLowerCase());
    if (!u || !verifyPassword(fields.password || '', u.hash)) { hit(`gate-ip:${ip}`); audit('vorschau_schranke_fehlgeschlagen', null, { ip, kennung: String(fields.user || '').slice(0, 60) }); return gatePage(res, { error: 'Prüferkennung oder Passwort ist nicht korrekt.', status: 401, next }), true; }
    const t = seal({ id: randomBytes(18).toString('base64url'), gateUserId: u.id, name: u.name, created: Date.now() }, 'gate');
    res.setHeader('Set-Cookie', cookie(t));
    audit('vorschau_schranke_ok', null, { ip, pruefer: u.name });
    redirect(res, next); return true;
  }
  if (p === '/_vorschau/abmelden') {
    const e = unseal(parseCookies(req).bess_gate, 'gate'); if (e) revoke(e.id, config.gateTtlMs);
    res.setHeader('Set-Cookie', [cookie('', 0), 'bess_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0']);
    redirect(res, '/_vorschau/anmelden'); return true;
  }
  if (valid(req)) return false;
  if (OPEN.has(p)) return p === '/_vorschau/anmelden' ? (gatePage(res, { next: url.searchParams.get('next') || '/' }), true) : false;
  // Alles andere: Schranke. Für Seitenaufrufe Weiterleitung, für alles übrige 401 ohne Inhalt.
  if (req.method === 'GET' && !p.startsWith('/static/')) { redirect(res, `/_vorschau/anmelden?next=${encodeURIComponent(p + url.search)}`); return true; }
  res.setHeader('X-Robots-Tag', 'noindex'); send(res, 401, 'Vorschau-Zugang erforderlich', 'text/plain; charset=utf-8'); return true;
}

export const gateInfo = (req) => valid(req);
export { esc };
