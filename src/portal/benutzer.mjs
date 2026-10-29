// Benutzer & Berechtigungen (nur Plattformadministration) sowie Kontoaktivierung über einmalige Links.
// Grundsätze: Rechte werden ausschließlich serverseitig über policy.mjs durchgesetzt; Einladungs- und Rücksetzlinks sind
// zufällig, zeitlich begrenzt, einmalig und werden nur als SHA-256-Prüfsumme gespeichert. Passwörter werden nie im
// Klartext gespeichert oder versendet; die Übergabe des Links erfolgt in der Abnahmephase manuell (kein E-Mail-Dienst).
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.mjs';
import { getDb, persist, newId, now, audit } from '../lib/store.mjs';
import { hashPassword, verifyPassword } from '../lib/auth.mjs';
import { parseForm, redirect, send, clientIp, tooMany, hit } from '../lib/http.mjs';
import { html, raw, fmtDateTime } from '../lib/html.mjs';
import * as P from '../lib/policy.mjs';
import { authPage } from './views.mjs';

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);

export function passwordProblem(u, pw, pw2) {
  if (pw.length < 12) return 'Das neue Passwort muss mindestens 12 Zeichen lang sein.';
  if (pw.length > 200) return 'Das neue Passwort ist zu lang.';
  if (pw !== pw2) return 'Die beiden neuen Passwörter stimmen nicht überein.';
  if (!/[A-Za-zÄÖÜäöüß]/.test(pw) || !/[^A-Za-zÄÖÜäöüß]/.test(pw)) return 'Das Passwort muss Buchstaben und mindestens eine Ziffer oder ein Sonderzeichen enthalten.';
  if (pw.toLowerCase().includes(String(u.email).split('@')[0].toLowerCase())) return 'Das Passwort darf den Benutzernamen nicht enthalten.';
  if (u.pw && verifyPassword(pw, u.pw)) return 'Bitte ein neues, anderes Passwort wählen.';
  return null;
}

// ---------- Konten, Status, Einladungen ----------
const sha = (t) => createHash('sha256').update(String(t)).digest('hex');
export const accountStatus = (x) => (!x.active ? 'gesperrt' : !x.pw ? 'eingeladen' : 'aktiv');
const STATUS_LABEL = { aktiv: 'aktiv', eingeladen: 'Einladung offen', gesperrt: 'gesperrt' };
const STATUS_MARK = { aktiv: 'mark-ok', eingeladen: 'mark-info', gesperrt: 'mark-warn' };
export function inviteStatus(i) {
  if (i.usedAt) return 'verwendet';
  if (i.revokedAt) return 'widerrufen';
  if (Date.parse(i.expiresAt) < Date.now()) return 'abgelaufen';
  return 'offen';
}
const ADMIN_EVENTS = ['konto_eingeladen', 'konto_angelegt', 'konto_bearbeitet', 'rollen_geaendert', 'zugriff_erteilt', 'zugriff_entzogen', 'konto_gesperrt', 'konto_entsperrt',
  'sitzungen_beendet', 'einladung_erzeugt', 'einladung_widerrufen', 'konto_aktiviert', 'passwort_link_erzeugt', 'passwort_ueber_link_gesetzt', 'passwort_neu_vergeben', 'mfa_zurueckgesetzt',
  'eigentuemer_kontakt_gesetzt', 'konto_vorlaeufig_gesperrt'];

function issueLink(target, kind, by) {
  const db = getDb();
  for (const i of db.invitations) if (i.userId === target.id && inviteStatus(i) === 'offen') i.revokedAt = now(); // nur ein gültiger Link je Konto
  const token = randomBytes(32).toString('base64url');
  const ttl = kind === 'einladung' ? config.inviteTtlMs : config.resetTtlMs;
  const inv = { id: newId('inv'), userId: target.id, kind, tokenHash: sha(token), createdBy: by.id, createdAt: now(), expiresAt: new Date(Date.now() + ttl).toISOString(), usedAt: null, revokedAt: null };
  db.invitations.push(inv);
  return { inv, token };
}
const origin = (req) => `${config.secureCookies ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;

function linkView(req, target, token, inv, title) {
  const link = `${origin(req)}/portal/aktivieren?t=${token}`;
  return html`<section class="panel"><h2>${title}</h2>
  <p>Der folgende Link ist <strong>einmalig</strong> und gilt bis <strong>${fmtDateTime(inv.expiresAt)}</strong>. Er wird nur jetzt angezeigt; gespeichert ist lediglich eine Prüfsumme. Über den Link legt ${target.name} ein persönliches Passwort fest.</p>
  <dl class="kv"><div><dt>Benutzername</dt><dd><code>${target.email}</code></dd></div><div><dt>Aktivierungslink</dt><dd><code class="linkcode">${link}</code></dd></div></dl>
  <div class="notice-info"><strong>Übergabe in der Abnahmephase (noch kein E-Mail-Dienst):</strong> Link persönlich oder über einen verschlüsselten Messenger (z. B. Signal, Threema) übergeben – nicht zusammen mit anderen Zugangsdaten und nicht in Gruppen. Geht der Link verloren, erzeugen Sie einfach einen neuen; der alte wird dabei ungültig.</div>
  <p><a class="btn btn-primary" href="/portal/admin/benutzer/${target.id}">Zum Benutzer</a> <a class="btn" href="/portal/admin/benutzer">Zur Benutzerübersicht</a></p></section>`;
}

// ---------- Hilfen für Formulare ----------
const asList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(String);
const roleLabel = (r) => P.ROLES[r]?.label || r;
const csrf = (s) => raw(`<input type="hidden" name="_csrf" value="${s.csrf}">`);
const activeAdmins = () => getDb().users.filter((x) => x.active && P.isAdmin(x));

function setRoles(target, roles, actor, confirmAdmin) {
  roles = [...new Set(roles.filter((r) => P.ROLES[r]))];
  if (!roles.length) throw bad('Bitte mindestens eine Rolle wählen.');
  const before = P.rolesOf(target);
  if (roles.includes('admin') && !before.includes('admin') && confirmAdmin !== 'ja') throw bad('Die Rolle Plattformadministration bitte ausdrücklich bestätigen.');
  if (target.id === actor.id && before.includes('admin') && !roles.includes('admin')) throw bad('Sie können sich die Administrationsrolle nicht selbst entziehen.');
  target.roles = roles; target.role = P.primaryRole(roles);
  // Projektzuordnungen entfallen, wenn die zugehörige Rolle entfällt (keine verwaisten Rechte)
  const db = getDb();
  const removed = db.grants.filter((g) => g.userId === target.id && !roles.includes(g.scope));
  db.grants = db.grants.filter((g) => !removed.includes(g));
  audit('rollen_geaendert', actor, { konto: target.id, vorher: before.join(','), nachher: roles.join(','), entfallene_zuordnungen: removed.length });
}

// ---------- Routen ----------
export async function handleUserAdmin({ req, res, url, path, method, u, s, view, post }) {
  const db = getDb();
  const users = db.users;
  const byId = (id) => users.find((x) => x.id === id);
  const pCode = Object.fromEntries(db.projects.map((p) => [p.id, p]));

  if (path === '/portal/admin/benutzer' && method === 'GET') {
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const rolle = url.searchParams.get('rolle') || '';
    const status = url.searchParams.get('status') || '';
    const projekt = url.searchParams.get('projekt') || '';
    const list = users.filter((x) => (!q || `${x.name} ${x.email}`.toLowerCase().includes(q)) && (!rolle || P.hasRole(x, rolle)) && (!status || accountStatus(x) === status) && (!projekt || P.visibleProjectIds(x).has(projekt)));
    const msg = { gesperrt: 'Benutzer gesperrt. Alle Sitzungen sind beendet.', entsperrt: 'Benutzer entsperrt.' }[url.searchParams.get('m')];
    return view('Benutzer & Berechtigungen', html`${msg ? html`<div class="notice" role="status">${msg}</div>` : ''}${adminTabs('benutzer')}
<section class="panel"><form method="get" action="/portal/admin/benutzer" class="filters" role="search">
<label>Suche<input name="q" value="${q}" placeholder="Name oder E-Mail"></label>
<label>Rolle<select name="rolle"><option value="">alle</option>${Object.keys(P.ROLES).map((r) => html`<option value="${r}"${rolle === r ? raw(' selected') : ''}>${roleLabel(r)}</option>`)}</select></label>
<label>Status<select name="status"><option value="">alle</option>${Object.entries(STATUS_LABEL).map(([k, l]) => html`<option value="${k}"${status === k ? raw(' selected') : ''}>${l}</option>`)}</select></label>
<label>Projekt<select name="projekt"><option value="">alle</option>${db.projects.map((p) => html`<option value="${p.id}"${projekt === p.id ? raw(' selected') : ''}>${p.code}</option>`)}</select></label>
<button class="btn" type="submit">Filtern</button>${q || rolle || status || projekt ? html` <a class="btn btn-quiet" href="/portal/admin/benutzer">Zurücksetzen</a>` : ''}</form></section>
<section class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Person</th><th>Rollen</th><th>Projekte</th><th>Status</th><th>Letzte Anmeldung</th><th><span class="sr">Aktion</span></th></tr></thead><tbody>
${list.map((x) => { const st = accountStatus(x); const pids = [...P.visibleProjectIds(x)]; return html`<tr><td data-l="Person"><strong>${x.name}</strong><br><span class="muted small">${x.email}</span></td><td data-l="Rollen">${P.rolesOf(x).map((r) => html`<span class="chip chip-plain">${roleLabel(r)}</span>`)}</td><td data-l="Projekte" class="small">${P.isAdmin(x) ? 'alle' : pids.map((id) => pCode[id]?.code).join(', ') || html`<span class="muted">keine</span>`}</td><td data-l="Status"><span class="mark ${STATUS_MARK[st]}">${STATUS_LABEL[st]}</span>${x.lockedUntil && Date.parse(x.lockedUntil) > Date.now() ? html`<br><span class="small muted">Fehlversuche: gesperrt bis ${fmtDateTime(x.lockedUntil)}</span>` : ''}</td><td data-l="Letzte Anmeldung" class="small">${x.lastLoginAt ? fmtDateTime(x.lastLoginAt) : html`<span class="muted">noch nie</span>`}</td><td><a class="btn btn-small" href="/portal/admin/benutzer/${x.id}">Bearbeiten</a></td></tr>`; })}
</tbody></table></div>${list.length ? '' : html`<p class="muted">Keine Benutzer für diese Auswahl.</p>`}<p class="small muted">${list.length} von ${users.length} Benutzern</p></section>`, 'Konten, Rollen, Projektrechte und Sperren');
  }

  if (path === '/portal/admin/benutzer/neu') {
    if (method === 'GET') return view('Neuen Benutzer einladen', html`${adminTabs('neu')}${inviteForm(s, db)}`, 'Konto vorbereiten und Aktivierungslink erzeugen');
    const { fields } = await post();
    const email = String(fields.email || '').trim().toLowerCase();
    const name = String(fields.name || '').trim().slice(0, 120);
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Bitte Name und eine gültige E-Mail-Adresse angeben.');
    if (users.some((x) => x.email.toLowerCase() === email)) throw new HttpError(409, 'Für diese E-Mail-Adresse besteht bereits ein Konto.');
    const nu = { id: newId('u'), email, name, role: 'investor', roles: [], active: true, pw: null, mfa: false, totp: null, createdAt: now(), createdBy: u.id, createdVia: 'verwaltung', projects: [] };
    setRoles(nu, asList(fields.roles), u, fields.confirm_admin);
    const projectIds = asList(fields.projects).filter((id) => pCode[id]);
    for (const r of P.rolesOf(nu).filter((r) => P.PROJECT_ROLES.includes(r))) for (const pid of projectIds) db.grants.push({ id: newId('g'), userId: nu.id, projectId: pid, scope: r, grantedBy: u.id, at: now() });
    if (P.hasRole(nu, 'eigentuemer') && fields.contactId && db.contacts.some((c) => c.id === fields.contactId)) nu.contactId = String(fields.contactId);
    nu.mfa = P.ROLES[nu.role].internal || P.hasRole(nu, 'investor'); // für eine spätere MFA-Pflicht je Konto vorgemerkt
    users.push(nu);
    const { inv, token } = issueLink(nu, 'einladung', u);
    persist();
    audit('konto_eingeladen', u, { konto: nu.id, rollen: P.rolesOf(nu).join(','), projekte: projectIds.join(',') });
    audit('einladung_erzeugt', u, { konto: nu.id, gueltig_bis: inv.expiresAt });
    return view('Einladung erzeugt', linkView(req, nu, token, inv, `Einladung für ${nu.name}`));
  }

  if (path === '/portal/admin/einladungen' && method === 'GET') {
    const rows = [...db.invitations].reverse();
    return view('Einladungen', html`${adminTabs('einladungen')}<section class="panel"><p class="small muted">Einladungs- und Rücksetzlinks sind einmalig und zeitlich begrenzt. Gespeichert ist nur eine Prüfsumme; ein verlorener Link kann nicht erneut angezeigt, aber jederzeit neu erzeugt werden.</p>
<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Person</th><th>Art</th><th>Erzeugt</th><th>Gültig bis</th><th>Status</th><th><span class="sr">Aktion</span></th></tr></thead><tbody>
${rows.map((i) => { const t = byId(i.userId); const st = inviteStatus(i); return html`<tr><td data-l="Person"><a href="/portal/admin/benutzer/${i.userId}">${t?.name || i.userId}</a><br><span class="muted small">${t?.email}</span></td><td data-l="Art">${i.kind === 'einladung' ? 'Einladung' : 'Passwort zurücksetzen'}</td><td data-l="Erzeugt" class="small">${fmtDateTime(i.createdAt)}<br>${byId(i.createdBy)?.name || ''}</td><td data-l="Gültig bis" class="small">${fmtDateTime(i.expiresAt)}</td><td data-l="Status"><span class="mark ${st === 'offen' ? 'mark-info' : st === 'verwendet' ? 'mark-ok' : 'mark-aud'}">${st}</span>${i.usedAt ? html`<br><span class="small muted">${fmtDateTime(i.usedAt)}</span>` : ''}</td><td>${st === 'offen' ? html`<form method="post" action="/portal/admin/einladungen/${i.id}/widerrufen">${csrf(s)}<button class="btn btn-small" type="submit">Widerrufen</button></form>` : ''}</td></tr>`; })}
</tbody></table></div>${rows.length ? '' : html`<p class="muted">Noch keine Einladungen.</p>`}</section>`, 'Status aller Aktivierungs- und Rücksetzlinks');
  }
  let m = /^\/portal\/admin\/einladungen\/([\w-]+)\/widerrufen$/.exec(path);
  if (m && method === 'POST') {
    await post();
    const i = db.invitations.find((x) => x.id === m[1]);
    if (!i) throw new HttpError(404, 'Nicht gefunden');
    if (inviteStatus(i) === 'offen') { i.revokedAt = now(); persist(); audit('einladung_widerrufen', u, { konto: i.userId, einladung: i.id }); }
    return redirect(res, '/portal/admin/einladungen');
  }

  if (path === '/portal/admin/aenderungen' && method === 'GET') {
    const rows = db.audit.filter((a) => ADMIN_EVENTS.includes(a.event)).reverse().slice(0, 400);
    return view('Änderungsprotokoll', html`${adminTabs('aenderungen')}<section class="panel"><p class="small muted">Alle Änderungen an Konten, Rollen, Projektrechten, Sperren, Einladungen und Passwörtern – mit Zeitpunkt und ausführender Person. Das Protokoll kann nicht bearbeitet werden.</p>
<div class="tbl-wrap"><table class="tbl tbl-compact"><thead><tr><th>Zeit</th><th>Änderung</th><th>Durch</th><th>Betroffenes Konto</th><th>Details</th></tr></thead><tbody>
${rows.map((a) => html`<tr><td>${fmtDateTime(a.at)}</td><td>${EVENT_LABEL[a.event] || a.event}</td><td>${a.actorName || '–'}</td><td>${a.konto ? html`<a href="/portal/admin/benutzer/${a.konto}">${byId(a.konto)?.name || a.konto}</a>` : '–'}</td><td class="small">${Object.entries(a).filter(([k]) => !['id', 'at', 'event', 'actor', 'actorName', 'konto'].includes(k)).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')}</td></tr>`)}
</tbody></table></div>${rows.length ? '' : html`<p class="muted">Noch keine Änderungen protokolliert.</p>`}</section>`, 'Nachvollziehbarkeit administrativer Änderungen');
  }

  m = /^\/portal\/admin\/benutzer\/([\w-]+)(?:\/([\w-]+))?(?:\/([\w-]+)\/entziehen)?$/.exec(path);
  if (!m) throw new HttpError(404, 'Nicht gefunden');
  const target = byId(m[1]);
  if (!target) throw new HttpError(404, 'Nicht gefunden');
  const action = m[2];
  const back = (msg) => redirect(res, `/portal/admin/benutzer/${target.id}${msg ? `?m=${msg}` : ''}`);

  if (!action && method === 'GET') {
    const msg = { ok: 'Gespeichert.', gesperrt: 'Benutzer gesperrt. Alle Sitzungen wurden sofort beendet.', entsperrt: 'Benutzer entsperrt. Frühere Sitzungen bleiben ungültig.', abgemeldet: 'Alle Sitzungen dieses Benutzers wurden beendet.', mfa: 'MFA-Einrichtung zurückgesetzt.' }[url.searchParams.get('m')];
    return view(target.name, html`${msg ? html`<div class="notice" role="status">${msg}</div>` : ''}${adminTabs('benutzer')}${editView(s, db, target, u)}`, target.email);
  }
  if (method !== 'POST') throw new HttpError(405, 'Methode nicht erlaubt');
  const { fields } = await post();

  switch (action) {
    case 'stammdaten': {
      const name = String(fields.name || '').trim().slice(0, 120);
      const email = String(fields.email || '').trim().toLowerCase();
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Bitte Name und eine gültige E-Mail-Adresse angeben.');
      if (users.some((x) => x.id !== target.id && x.email.toLowerCase() === email)) throw new HttpError(409, 'Diese E-Mail-Adresse ist bereits vergeben.');
      const changes = [];
      if (name !== target.name) changes.push('Name');
      if (email !== target.email) changes.push('E-Mail');
      target.name = name; target.email = email; persist();
      if (changes.length) audit('konto_bearbeitet', u, { konto: target.id, felder: changes.join(', ') });
      return back('ok');
    }
    case 'rollen': {
      setRoles(target, asList(fields.roles), u, fields.confirm_admin); // eigene Administrationsrolle ist geschützt; damit bleibt stets ein Admin
      persist();
      return back('ok');
    }
    case 'zugriff': {
      if (m[3]) {
        const i = db.grants.findIndex((g) => g.id === m[3] && g.userId === target.id);
        if (i < 0) throw new HttpError(404, 'Nicht gefunden');
        const [g] = db.grants.splice(i, 1); persist();
        audit('zugriff_entzogen', u, { konto: target.id, projekt: g.projectId, rolle: g.scope });
        return back('ok');
      }
      const role = String(fields.role || ''); const pid = String(fields.projectId || '');
      if (!P.PROJECT_ROLES.includes(role) || !P.hasRole(target, role)) throw bad('Die Projektberechtigung muss zu einer Rolle des Benutzers gehören.');
      if (!pCode[pid]) throw bad('Projekt nicht gefunden.');
      if ((role === 'vertrieb_nord' || role === 'vertrieb_sued') && pCode[pid].region !== P.ROLES[role].region) throw bad('Das Projekt liegt nicht in der Region dieser Rolle.');
      if (!db.grants.some((g) => g.userId === target.id && g.projectId === pid && g.scope === role)) {
        db.grants.push({ id: newId('g'), userId: target.id, projectId: pid, scope: role, grantedBy: u.id, at: now() });
        persist(); audit('zugriff_erteilt', u, { konto: target.id, projekt: pid, rolle: role });
      }
      return back('ok');
    }
    case 'eigentuemer-kontakt': {
      if (!P.hasRole(target, 'eigentuemer')) throw bad('Nur für Konten mit der Rolle Grundstückseigentümer.');
      const cid = String(fields.contactId || '');
      if (cid && !db.contacts.some((c) => c.id === cid)) throw bad('Kontakt nicht gefunden.');
      target.contactId = cid || null; persist();
      audit('eigentuemer_kontakt_gesetzt', u, { konto: target.id, kontakt: cid || 'keiner' });
      return back('ok');
    }
    case 'sperren': {
      if (target.id === u.id) throw bad('Sie können Ihr eigenes Konto nicht sperren.');
      if (P.isAdmin(target) && activeAdmins().filter((x) => x.id !== target.id).length === 0) throw bad('Das letzte aktive Administrationskonto kann nicht gesperrt werden.');
      target.active = false; target.lockedAt = now(); target.lockedBy = u.id; target.sessionsNotBefore = Date.now() + 1;
      for (const i of db.invitations) if (i.userId === target.id && inviteStatus(i) === 'offen') i.revokedAt = now();
      persist(); audit('konto_gesperrt', u, { konto: target.id, grund: String(fields.grund || '').slice(0, 200) || '–' });
      return back('gesperrt');
    }
    case 'entsperren': {
      target.active = true; delete target.lockedAt; delete target.lockedBy; delete target.lockedUntil; target.failedLogins = [];
      persist(); audit('konto_entsperrt', u, { konto: target.id });
      return back('entsperrt');
    }
    case 'abmelden': {
      target.sessionsNotBefore = Date.now() + 1; persist();
      audit('sitzungen_beendet', u, { konto: target.id });
      return back(target.id === u.id ? null : 'abgemeldet');
    }
    case 'einladung': case 'passwort-link': {
      if (!target.active) throw bad('Für gesperrte Konten werden keine Links erzeugt. Bitte zuerst entsperren.');
      const kind = action === 'einladung' ? 'einladung' : 'zuruecksetzung';
      const { inv, token } = issueLink(target, kind, u);
      persist(); audit(kind === 'einladung' ? 'einladung_erzeugt' : 'passwort_link_erzeugt', u, { konto: target.id, gueltig_bis: inv.expiresAt });
      return view(kind === 'einladung' ? 'Einladung erzeugt' : 'Link zum Zurücksetzen', linkView(req, target, token, inv, kind === 'einladung' ? `Neue Einladung für ${target.name}` : `Passwort zurücksetzen für ${target.name}`));
    }
    case 'mfa': {
      target.totp = null; delete target.totpEnrolledAt; persist();
      audit('mfa_zurueckgesetzt', u, { konto: target.id });
      return back('mfa');
    }
    default: throw new HttpError(404, 'Nicht gefunden');
  }
}

// ---------- Aktivierung (ohne Anmeldung) ----------
export async function handleActivation(req, res, url, method) {
  const db = getDb();
  const ip = clientIp(req);
  const page = (body, status = 200) => send(res, status, String(authPage({ title: 'Zugang aktivieren', body })));
  if (tooMany(`akt:${ip}`, 20, 15 * 60000)) return page(html`<div class="auth-card"><h1>Zu viele Versuche</h1><p>Bitte warten Sie 15 Minuten.</p></div>`, 429);
  let token = url.searchParams.get('t') || '';
  let fields = {};
  if (method === 'POST') { ({ fields } = await parseForm(req)); token = String(fields.t || ''); }
  const inv = token ? db.invitations.find((i) => i.tokenHash === sha(token)) : null;
  const target = inv && db.users.find((x) => x.id === inv.userId);
  if (!inv || !target || inviteStatus(inv) !== 'offen' || !target.active) {
    hit(`akt:${ip}`); audit('aktivierung_ungueltig', null, { ip, status: inv ? inviteStatus(inv) : 'unbekannt' });
    return page(html`<div class="auth-card"><h1>Link ungültig</h1><p>Dieser Link ist abgelaufen, wurde bereits verwendet oder widerrufen. Bitte wenden Sie sich an Ihren Ansprechpartner; er kann Ihnen einen neuen Link erzeugen.</p><p><a class="btn" href="/portal/login">Zur Anmeldung</a></p></div>`, 410);
  }
  const form = (error) => html`<div class="auth-card"><h1>${inv.kind === 'einladung' ? 'Zugang aktivieren' : 'Neues Passwort festlegen'}</h1>
  <p class="muted">Konto: <strong>${target.email}</strong></p>
  ${error ? html`<div class="alert" role="alert">${error}</div>` : ''}
  <form method="post" action="/portal/aktivieren" class="stack"><input type="hidden" name="t" value="${token}">
  <label for="neu">Persönliches Passwort</label><input id="neu" name="neu" type="password" autocomplete="new-password" required minlength="12">
  <label for="neu2">Passwort wiederholen</label><input id="neu2" name="neu2" type="password" autocomplete="new-password" required minlength="12">
  <p class="small muted">Mindestens 12 Zeichen, Buchstaben und mindestens eine Ziffer oder ein Sonderzeichen, nicht der Benutzername.</p>
  <button class="btn btn-primary" type="submit">Passwort speichern</button></form></div>`;
  if (method === 'GET') return page(form());
  const problem = passwordProblem(target, String(fields.neu || ''), String(fields.neu2 || ''));
  if (problem) return page(form(problem), 422);
  target.pw = hashPassword(String(fields.neu)); target.mustChangePassword = false; target.passwordChangedAt = now();
  target.sessionsNotBefore = Date.now() + 1; // bestehende Sitzungen nach Zurücksetzen beenden
  if (!target.activatedAt) target.activatedAt = now();
  inv.usedAt = now();
  persist();
  audit(inv.kind === 'einladung' ? 'konto_aktiviert' : 'passwort_ueber_link_gesetzt', target, { konto: target.id, ip });
  return redirect(res, '/portal/login?m=aktiviert');
}

// ---------- Ansichten ----------
const EVENT_LABEL = { konto_eingeladen: 'Benutzer eingeladen', konto_angelegt: 'Konto angelegt', konto_bearbeitet: 'Stammdaten geändert', rollen_geaendert: 'Rollen geändert', zugriff_erteilt: 'Projektrecht erteilt', zugriff_entzogen: 'Projektrecht entzogen', konto_gesperrt: 'Benutzer gesperrt', konto_entsperrt: 'Benutzer entsperrt', sitzungen_beendet: 'Sitzungen beendet', einladung_erzeugt: 'Einladungslink erzeugt', einladung_widerrufen: 'Einladung widerrufen', konto_aktiviert: 'Konto aktiviert', passwort_link_erzeugt: 'Rücksetzlink erzeugt', passwort_ueber_link_gesetzt: 'Passwort über Link gesetzt', passwort_neu_vergeben: 'Einmalpasswort vergeben', mfa_zurueckgesetzt: 'MFA zurückgesetzt', eigentuemer_kontakt_gesetzt: 'Eigentümer-Kontakt verknüpft', konto_vorlaeufig_gesperrt: 'Vorläufige Sperre nach Fehlversuchen' };

function adminTabs(active) {
  const t = [['benutzer', '/portal/admin/benutzer', 'Benutzerübersicht'], ['neu', '/portal/admin/benutzer/neu', 'Neuen Benutzer einladen'], ['gesperrt', '/portal/admin/benutzer?status=gesperrt', 'Gesperrte Benutzer'], ['einladungen', '/portal/admin/einladungen', 'Einladungen'], ['aenderungen', '/portal/admin/aenderungen', 'Änderungsprotokoll']];
  return html`<nav class="tabs" aria-label="Benutzerverwaltung">${t.map(([k, href, l]) => html`<a href="${href}"${k === active ? raw(' aria-current="page"') : ''}>${l}</a>`)}</nav>`;
}
const roleChecks = (selected) => html`<fieldset class="checks"><legend>Rollen</legend>${Object.keys(P.ROLES).map((r) => html`<label><input type="checkbox" name="roles" value="${r}"${selected.includes(r) ? raw(' checked') : ''}> ${roleLabel(r)}</label>`)}
<label class="confirm"><input type="checkbox" name="confirm_admin" value="ja"> Ich bestätige: Vergabe der Rolle Plattformadministration (voller Zugriff auf alle Projekte und Benutzer)</label></fieldset>`;
const ownerContacts = (db) => db.contacts.filter((c) => /eigentümer/i.test(c.kind || ''));

function inviteForm(s, db) {
  return html`<section class="panel"><form method="post" action="/portal/admin/benutzer/neu" class="stack stack-wide">${csrf(s)}
<label for="i-name">Name</label><input id="i-name" name="name" required maxlength="120">
<label for="i-mail">E-Mail-Adresse (Benutzername)</label><input id="i-mail" name="email" type="email" required>
${roleChecks([])}
<fieldset class="checks"><legend>Projekte</legend><p class="small muted">Gilt für alle gewählten projektbezogenen Rollen (Projektleitung, Vertrieb, Investor, Kommune, Technik). Ohne Auswahl: kein Projektzugriff; Vertriebsrollen sehen dann ihre Region.</p>${db.projects.map((p) => html`<label><input type="checkbox" name="projects" value="${p.id}"> ${p.code} – ${p.name}</label>`)}</fieldset>
<label for="i-contact">Eigentümer-Kontakt <span class="muted small">(nur für Grundstückseigentümer: bestimmt, welche Grundstücke und Dokumente sichtbar sind)</span></label><select id="i-contact" name="contactId"><option value="">– keiner –</option>${ownerContacts(db).map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select>
<button class="btn btn-primary" type="submit">Einladung erzeugen</button>
<p class="small muted">Es wird kein Passwort vergeben und keine E-Mail versendet. Sie erhalten einen einmaligen Aktivierungslink (gültig ${Math.round(config.inviteTtlMs / 3600000)} Stunden), über den die Person ihr persönliches Passwort festlegt.</p></form></section>`;
}

function editView(s, db, x, me) {
  const st = accountStatus(x);
  const pById = Object.fromEntries(db.projects.map((p) => [p.id, p]));
  const grants = db.grants.filter((g) => g.userId === x.id);
  const projRoles = P.rolesOf(x).filter((r) => P.PROJECT_ROLES.includes(r));
  const invs = db.invitations.filter((i) => i.userId === x.id).reverse();
  const openInv = invs.find((i) => inviteStatus(i) === 'offen');
  const changes = db.audit.filter((a) => a.konto === x.id && ADMIN_EVENTS.includes(a.event)).reverse().slice(0, 15);
  const visible = [...P.projectsByRole(x)];
  return html`<section class="grid-2">
<div class="panel"><h2>Kontostatus</h2><dl class="kv">
<div><dt>Status</dt><dd><span class="mark ${STATUS_MARK[st]}">${STATUS_LABEL[st]}</span>${x.lockedAt ? html` <span class="small muted">seit ${fmtDateTime(x.lockedAt)}</span>` : ''}</dd></div>
<div><dt>Letzte Anmeldung</dt><dd>${x.lastLoginAt ? fmtDateTime(x.lastLoginAt) : 'noch nie'}</dd></div>
<div><dt>Angelegt</dt><dd>${x.createdAt ? fmtDateTime(x.createdAt) : 'bei Einrichtung der Plattform'}${x.activatedAt ? html`<br><span class="small muted">aktiviert ${fmtDateTime(x.activatedAt)}</span>` : ''}</dd></div>
<div><dt>Einladung / Link</dt><dd>${openInv ? html`offen bis ${fmtDateTime(openInv.expiresAt)}` : invs.length ? `zuletzt ${inviteStatus(invs[0])}` : 'keine'}</dd></div>
${x.lockedUntil && Date.parse(x.lockedUntil) > Date.now() ? html`<div><dt>Fehlversuche</dt><dd><span class="mark mark-warn">vorläufig gesperrt bis ${fmtDateTime(x.lockedUntil)}</span></dd></div>` : ''}
</dl>
<div class="row-actions">
${x.active ? (x.id !== me.id ? html`<form method="post" action="/portal/admin/benutzer/${x.id}/sperren" class="lockform">${csrf(s)}<label class="sr" for="grund">Grund der Sperre</label><input id="grund" name="grund" placeholder="Grund (optional)" maxlength="200"><button class="btn btn-danger" type="submit">Benutzer sofort sperren</button></form>` : '') : html`<form method="post" action="/portal/admin/benutzer/${x.id}/entsperren">${csrf(s)}<button class="btn btn-primary" type="submit">Benutzer entsperren</button></form>`}
${x.active ? html`<form method="post" action="/portal/admin/benutzer/${x.id}/${x.pw ? 'passwort-link' : 'einladung'}">${csrf(s)}<button class="btn" type="submit">${x.pw ? 'Link zum Zurücksetzen des Passworts erzeugen' : 'Neuen Einladungslink erzeugen'}</button></form>` : ''}
${x.id !== me.id ? html`<form method="post" action="/portal/admin/benutzer/${x.id}/abmelden">${csrf(s)}<button class="btn" type="submit">Alle Sitzungen beenden</button></form>` : ''}
${x.totp ? html`<form method="post" action="/portal/admin/benutzer/${x.id}/mfa">${csrf(s)}<button class="btn" type="submit">MFA-Einrichtung zurücksetzen</button></form>` : ''}
</div></div>
<div class="panel"><h2>Stammdaten</h2><form method="post" action="/portal/admin/benutzer/${x.id}/stammdaten" class="stack">${csrf(s)}
<label for="e-name">Name</label><input id="e-name" name="name" value="${x.name}" required maxlength="120">
<label for="e-mail">E-Mail-Adresse (Benutzername)</label><input id="e-mail" name="email" type="email" value="${x.email}" required>
<button class="btn btn-primary" type="submit">Stammdaten speichern</button></form></div>
</section>
<section class="panel"><h2>Rollen</h2><form method="post" action="/portal/admin/benutzer/${x.id}/rollen" class="stack stack-wide">${csrf(s)}${roleChecks(P.rolesOf(x))}
<button class="btn btn-primary" type="submit">Rollen speichern</button><p class="small muted">Entfällt eine Rolle, entfallen auch ihre Projektberechtigungen. Mehrere Rollen gelten jeweils nur für die Projekte, für die sie freigeschaltet sind.</p></form></section>
<section class="panel"><h2>Projektberechtigungen</h2>
${grants.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Projekt</th><th>Rolle / Bereich</th><th>Erteilt</th><th><span class="sr">Aktion</span></th></tr></thead><tbody>${grants.map((g) => html`<tr><td data-l="Projekt">${pById[g.projectId]?.code} – ${pById[g.projectId]?.name}</td><td data-l="Rolle">${roleLabel(g.scope)}</td><td data-l="Erteilt" class="small">${fmtDateTime(g.at)}</td><td><form method="post" action="/portal/admin/benutzer/${x.id}/zugriff/${g.id}/entziehen">${csrf(s)}<button class="btn btn-small" type="submit">Entziehen</button></form></td></tr>`)}</tbody></table></div>` : html`<p class="muted">Keine einzelnen Projektberechtigungen.</p>`}
${projRoles.length ? html`<form method="post" action="/portal/admin/benutzer/${x.id}/zugriff" class="stack stack-inline">${csrf(s)}<label for="z-role">Rolle</label><select id="z-role" name="role">${projRoles.map((r) => html`<option value="${r}">${roleLabel(r)}</option>`)}</select><label for="z-proj">Projekt</label><select id="z-proj" name="projectId">${db.projects.map((p) => html`<option value="${p.id}">${p.code} – ${p.name}</option>`)}</select><button class="btn btn-primary" type="submit">Berechtigung erteilen</button></form>` : ''}
${P.hasRole(x, 'eigentuemer') ? html`<form method="post" action="/portal/admin/benutzer/${x.id}/eigentuemer-kontakt" class="stack stack-inline">${csrf(s)}<label for="k-c">Eigentümer-Kontakt</label><select id="k-c" name="contactId"><option value="">– keiner –</option>${ownerContacts(db).map((c) => html`<option value="${c.id}"${x.contactId === c.id ? raw(' selected') : ''}>${c.name}</option>`)}</select><button class="btn" type="submit">Verknüpfen</button></form>` : ''}
<h3 class="mt">Ergebnis: sichtbare Projekte</h3>
${visible.length ? html`<ul class="assume">${visible.map(([r, ids]) => html`<li><strong>${roleLabel(r)}:</strong> ${r === 'admin' ? 'alle Projekte' : [...ids].map((id) => pById[id]?.code).join(', ') || 'keine'}${(r === 'vertrieb_nord' || r === 'vertrieb_sued') && !grants.some((g) => g.scope === r) ? ' (ganze Region, solange keine Einzelzuordnung besteht)' : ''}${r === 'eigentuemer' ? ' (über eigene Grundstücke)' : ''}</li>`)}</ul>` : html`<p class="muted">Keine.</p>`}
<p class="small muted">Diese Übersicht wird bei jeder Anfrage serverseitig berechnet; Änderungen wirken sofort.</p></section>
<section class="panel"><h2>Letzte Änderungen</h2>${changes.length ? html`<ul class="timeline">${changes.map((a) => html`<li><span class="date">${fmtDateTime(a.at)}</span><p>${EVENT_LABEL[a.event] || a.event} · ${a.actorName || '–'}</p></li>`)}</ul>` : html`<p class="muted">Keine.</p>`}<p><a href="/portal/admin/aenderungen">Vollständiges Änderungsprotokoll</a></p></section>`;
}
