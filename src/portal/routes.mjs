// Portal-Routen. Jede Route prüft Anmeldung, CSRF (bei POST) und lädt Daten ausschließlich über policy.mjs.
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.mjs';
import { getDb, persist, newId, now, audit, getFile, putFile } from '../lib/store.mjs';
import { verifyPassword, verifyTotp, totp, createSession, getSession, destroySession, sessionCookie, hashPassword, newTotpSecret } from '../lib/auth.mjs';
import { parseCookies, parseForm, send, redirect, rateLimit, clientIp, formToken, checkFormToken, sniffType, tooMany, hit } from '../lib/http.mjs';
import * as P from '../lib/policy.mjs';
import * as V from './views.mjs';
import { handleUserAdmin, handleActivation, passwordProblem as pwProblem } from './benutzer.mjs';
import { handleRecovery } from './wiederherstellung.mjs';
import { handleFinanzen, investorKennzahlen } from './finanzen.mjs';
import { html } from '../lib/html.mjs';

const DEMO_PASSWORD = 'Vorschau!Speicher-2026'; // nur für die Anzeige der Vorschau-Zugänge (siehe data/seed.mjs)

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const notFound = () => new HttpError(404, 'Nicht gefunden');
const forbidden = () => new HttpError(403, 'Kein Zugriff');

function current(req, res) {
  const s = getSession(parseCookies(req).bess_sid);
  if (!s) return {};
  if (s.refresh && res) res.setHeader('Set-Cookie', sessionCookie(s)); // gleitender Leerlauf
  const u = getDb().users.find((x) => x.id === s.userId && x.active);
  // gesperrte Konten und Sitzungen vor einer Sperre, Rücksetzung oder erzwungenen Abmeldung sind sofort ungültig
  if (!u || (u.sessionsNotBefore && s.created < u.sessionsNotBefore)) { destroySession(s); return {}; }
  return { s, u: s.mfaPending ? null : u, pendingUser: u };
}

function checkCsrf(s, fields) {
  const t = String(fields._csrf || '');
  if (!s || t.length !== s.csrf.length || t !== s.csrf) throw new HttpError(403, 'Sicherheitstoken ungültig. Bitte Seite neu laden.');
}

const out = (res, body, status = 200) => send(res, status, String(body));

// Startbereich nach der Anmeldung je Rolle
export function landing(u) {
  if (u.mustChangePassword) return '/portal/passwort';
  return { investor: '/portal/dokumente', kommune: '/portal/projekte', technik: '/portal/projekte', vertrieb_nord: '/portal/pipeline', vertrieb_sued: '/portal/pipeline' }[P.primaryRole(P.rolesOf(u))] || '/portal';
}
// MFA nach Betriebsart: aus (Standard der Abnahmeplattform), nur privilegierte Konten oder je Konto
export function mfaRequired(u) {
  if (config.mfa === 'konto') return !!u.mfa;
  if (config.mfa === 'privilegiert') return P.isAdmin(u) || P.hasRole(u, 'projektleitung');
  return false;
}
const LOCK_FAILS = 5, LOCK_WINDOW = 15 * 60000, LOCK_TIME = 15 * 60000;

function ctxFor(u) {
  const db = getDb();
  const projects = P.listProjects(u);
  return {
    u, projects, docs: P.listDocuments(u), appointments: P.listAppointments(u), threads: P.listThreads(u),
    tasks: P.listTasks(u), approvals: P.isInternal(u) ? db.approvals.filter((a) => projects.some((p) => p.id === a.targetId || db.documents.find((d) => d.id === a.targetId)?.projectId === p.id)) : [],
    inquiries: P.isInternal(u) ? db.inquiries : [], parcels: P.listParcels(u), contracts: P.listContracts(u), users: db.users,
  };
}

export async function handlePortal(req, res, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/portal';
  const method = req.method;
  const db = getDb();

  // ---------- Anmeldung ----------
  if (path === '/portal/login' && method === 'GET') {
    const { u } = current(req, res);
    if (u) return redirect(res, '/portal');
    const demo = config.previewHelpers ? { password: DEMO_PASSWORD, users: db.users.filter((x) => x.email.endsWith('@demo.invalid')) } : null;
    const info = { aktiviert: 'Ihr Passwort ist gespeichert. Sie können sich jetzt anmelden.' }[url.searchParams.get('m')] || null;
    return out(res, V.loginView({ token: formToken(), demo, info, error: url.searchParams.get('e') === 'ablauf' ? 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.' : null }));
  }
  if (path === '/portal/anmelden' && method === 'POST') {
    const { fields } = await parseForm(req);
    const ip = clientIp(req);
    const email = String(fields.email || '').trim().toLowerCase();
    const fail = (msg) => { return out(res, V.loginView({ token: formToken(), error: msg, email, demo: config.previewHelpers ? { password: DEMO_PASSWORD, users: db.users.filter((x) => x.email.endsWith('@demo.invalid')) } : null }), 401); };
    if (!checkFormToken(fields._t, 0)) return fail('Das Formular ist abgelaufen. Bitte erneut versuchen.');
    if (tooMany(`login-ip:${ip}`, 30, 15 * 60000) || tooMany(`login-user:${email}`, 6, 15 * 60000)) {
      audit('anmeldung_gesperrt', null, { email, ip });
      return out(res, V.loginView({ token: formToken(), error: 'Zu viele Anmeldeversuche. Bitte warten Sie 15 Minuten.', email }), 429);
    }
    const user = db.users.find((x) => x.email.toLowerCase() === email && x.active);
    // Kontosperre nach wiederholten Fehlversuchen – gespeichert am Konto, gilt damit über alle Serverinstanzen
    if (user?.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) { audit('anmeldung_gesperrt', user, { ip }); return out(res, V.loginView({ token: formToken(), error: 'Zu viele Anmeldeversuche. Bitte warten Sie 15 Minuten.', email }), 429); }
    if (!user || !verifyPassword(fields.password || '', user.pw)) {
      hit(`login-ip:${ip}`); hit(`login-user:${email}`);
      if (user) {
        const t = Date.now();
        user.failedLogins = (user.failedLogins || []).filter((x) => t - x < LOCK_WINDOW).concat(t);
        if (user.failedLogins.length >= LOCK_FAILS) { user.lockedUntil = new Date(t + LOCK_TIME).toISOString(); user.failedLogins = []; audit('konto_vorlaeufig_gesperrt', user, { ip }); }
      } // gespeichert mit dem folgenden Protokolleintrag (audit schreibt den Datenbestand)
      audit('anmeldung_fehlgeschlagen', null, { email, ip });
      return fail('E-Mail-Adresse oder Passwort ist nicht korrekt.');
    }
    const needMfa = mfaRequired(user);
    user.failedLogins = []; delete user.lockedUntil; user.lastLoginAt = now(); user.lastLoginIp = ip; // gespeichert mit dem Protokolleintrag unten
    const s = createSession(user.id, { mfaPending: needMfa });
    res.setHeader('Set-Cookie', sessionCookie(s));
    audit(needMfa ? 'anmeldung_passwort_ok' : 'anmeldung', user, { ip });
    return redirect(res, needMfa ? '/portal/mfa' : landing(user));
  }
  if (path === '/portal/mfa') {
    const { s, pendingUser } = current(req, res);
    if (!s || !s.mfaPending) return redirect(res, s ? '/portal' : '/portal/login');
    // Ersteinrichtung: Konten ohne hinterlegtes TOTP-Geheimnis richten MFA bei der ersten Anmeldung ein.
    const enrolling = !pendingUser.totp;
    if (enrolling && !s.enrollSecret) { s.enrollSecret = newTotpSecret(); res.setHeader('Set-Cookie', sessionCookie(s)); }
    const secret = pendingUser.totp || s.enrollSecret;
    const demoCode = config.previewHelpers && !enrolling ? totp(secret) : null;
    const page = (extra = {}) => enrolling ? V.mfaEnrollView({ s, secret, account: pendingUser.email, ...extra }) : V.mfaView({ s, demoCode, ...extra });
    if (method === 'GET') return out(res, page());
    const { fields } = await parseForm(req);
    checkCsrf(s, fields);
    if (!rateLimit(`mfa:${s.id}`, 5, 15 * 60000)) { destroySession(s); audit('mfa_gesperrt', pendingUser); return redirect(res, '/portal/login'); }
    if (!verifyTotp(secret, fields.code)) { audit('mfa_fehlgeschlagen', pendingUser); return out(res, page({ error: 'Der Code ist nicht gültig. Bitte den aktuellen Code eingeben.' }), 401); }
    if (enrolling) { pendingUser.totp = secret; pendingUser.totpEnrolledAt = now(); persist(); audit('mfa_eingerichtet', pendingUser); }
    // Sitzung nach erfolgreicher MFA erneuern (Session-Fixation vermeiden)
    destroySession(s);
    const s2 = createSession(pendingUser.id, { mfaPending: false });
    res.setHeader('Set-Cookie', sessionCookie(s2));
    audit('anmeldung', pendingUser, { mfa: 'ok' });
    return redirect(res, landing(pendingUser));
  }
  // Einladung annehmen / Passwort über Zurücksetzungslink festlegen (ohne Anmeldung, einmaliger Link)
  if (path === '/portal/aktivieren') return handleActivation(req, res, url, method);
  // Passwort-Link für den Administratorzugang (nur bei gesetzter BESS_RECOVERY, einmalig); alte Code-Wiederherstellung abgeschaltet
  if (path === '/portal/passwort-festlegen') return handleRecovery(req, res, url, method);
  if (path === '/portal/wiederherstellen') return redirect(res, '/portal/passwort-festlegen');
  if (path === '/portal/abmelden' && method === 'POST') {
    const { s, pendingUser } = current(req, res);
    const { fields } = await parseForm(req);
    if (s) { checkCsrf(s, fields); destroySession(s); audit('abmeldung', pendingUser); }
    res.setHeader('Set-Cookie', sessionCookie(null, 0));
    return redirect(res, '/portal/login');
  }

  // ---------- ab hier: angemeldet ----------
  const { s, u } = current(req, res);
  if (!u) return redirect(res, s ? '/portal/mfa' : '/portal/login');

  // Eigenes Passwort festlegen (Pflicht beim ersten Login, sonst jederzeit möglich)
  if (path === '/portal/passwort') {
    if (method === 'GET') return out(res, V.passwordView({ s, u, forced: !!u.mustChangePassword }));
    const { fields } = await parseForm(req);
    checkCsrf(s, fields);
    if (!rateLimit(`pw:${u.id}`, 10, 15 * 60000)) return out(res, V.passwordView({ s, u, forced: !!u.mustChangePassword, error: 'Zu viele Versuche. Bitte später erneut versuchen.' }), 429);
    if (!verifyPassword(fields.current || '', u.pw)) { audit('passwort_aenderung_fehlgeschlagen', u); return out(res, V.passwordView({ s, u, forced: !!u.mustChangePassword, error: 'Das bisherige Passwort ist nicht korrekt.' }), 401); }
    const problem = pwProblem(u, String(fields.neu || ''), String(fields.neu2 || ''));
    if (problem) return out(res, V.passwordView({ s, u, forced: !!u.mustChangePassword, error: problem }), 422);
    u.pw = hashPassword(String(fields.neu)); u.mustChangePassword = false; u.passwordChangedAt = now();
    persist(); audit('passwort_geaendert', u);
    return redirect(res, landing(u));
  }
  if (u.mustChangePassword) return redirect(res, '/portal/passwort');
  const view = (title, body, context) => out(res, V.shell({ u, s, path, title, body, context }));
  const page = (title, body, context) => V.shell({ u, s, path, title, body, context });
  const internalOnly = () => { if (!P.isInternal(u)) throw notFound(); };
  const adminOnly = () => { if (!P.isAdmin(u)) throw notFound(); };
  const post = async () => { const f = await parseForm(req); checkCsrf(s, f.fields); return f; };

  if (path === '/portal' && method === 'GET') {
    const greeting = { eigentuemer: 'Ihr persönlicher Bereich', investor: 'Investoren-Datenraum', kommune: 'Kommunales Partnerportal', technik: 'Partnerbereich Technik' }[u.role] || 'Projektsteuerung';
    return view('Übersicht', V.dashboard(ctxFor(u)), greeting);
  }
  if (path === '/portal/pipeline' && method === 'GET') { internalOnly(); return view('Pipeline', V.pipelineBoard(P.listProjects(u)), 'Standorte nach Entwicklungsphase'); }
  if (path === '/portal/projekte' && method === 'GET') return view('Projekte', V.projectList({ u, projects: P.listProjects(u), spvs: db.spvs }));
  let m = /^\/portal\/projekte\/([\w-]+)$/.exec(path);
  if (m && method === 'GET') {
    const p = P.getProject(u, m[1]);
    if (!p) throw notFound();
    audit('projekt_angesehen', u, { projekt: p.id });
    return view(p.name, html`${V.projectDetail({ u, s, p, spv: db.spvs.find((x) => x.id === p.spvId), docs: P.listDocuments(u, p.id), showFin: P.canSeeFinancials(u, p), showTech: P.canSeeTechnical(u, p), parcels: P.listParcels(u, p.id), approvals: db.approvals })}${investorKennzahlen(db, u, p)}`, p.code);
  }
  if (path === '/portal/grundstuecke' && method === 'GET') {
    if (!(P.hasRole(u, 'eigentuemer') || P.isInternal(u))) throw notFound();
    return view('Grundstücke und Verträge', V.grundstuecke({ u, parcels: P.listParcels(u), contracts: P.listContracts(u), projects: P.listProjects(u) }));
  }
  if (path === '/portal/dokumente' && method === 'GET') {
    const msg = { ok: 'Das Dokument wurde hochgeladen.', typ: 'Dateityp nicht erlaubt. Erlaubt sind PDF, JPG und PNG.' }[url.searchParams.get('m')];
    return view(P.hasRole(u, 'investor') && !P.isInternal(u) ? 'Datenraum' : 'Dokumente', V.dokumente({ u, s, docs: P.listDocuments(u), projects: P.listProjects(u), msg }));
  }
  m = /^\/portal\/dokumente\/([\w-]+)\/download$/.exec(path);
  if (m && method === 'GET') {
    const d = P.getDocument(u, m[1]);
    if (!d) { audit('download_verweigert', u, { dokument: m[1] }); throw notFound(); }
    const data = await getFile(d.file);
    db.downloads.push({ id: newId('dl'), at: now(), userId: u.id, docId: d.id, version: d.version, projectId: d.projectId });
    audit('download', u, { dokument: d.id, version: d.version });
    const fname = d.title.replace(/[^\w\-äöüÄÖÜß ]+/g, '').replace(/\s+/g, '_').slice(0, 80) + '.' + (d.mime === 'application/pdf' ? 'pdf' : d.mime === 'image/png' ? 'png' : 'jpg');
    res.setHeader('Content-Disposition', `attachment; filename="${fname.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fname)}`);
    return send(res, 200, data, d.mime);
  }
  if (path === '/portal/dokumente/hochladen' && method === 'POST') {
    if (!(P.hasRole(u, 'eigentuemer') || P.isInternal(u))) throw notFound();
    const { fields, files } = await post();
    const p = P.getProject(u, fields.projectId);
    if (!p) throw notFound();
    const f = files.find((x) => x.field === 'file');
    const type = f && sniffType(f.data);
    if (!type) { audit('upload_abgelehnt', u, { grund: 'typ' }); return redirect(res, '/portal/dokumente?m=typ'); }
    let audience = 'eigentuemer', status = 'eingereicht', owner = u.contactId || null;
    const internHier = P.internalProjectIds(u).has(p.id);
    if (internHier) {
      audience = String(fields.audience || 'intern');
      if (!P.allowedAudiences(u, p.id).includes(audience)) throw forbidden();
      status = audience.startsWith('intern') ? 'freigegeben' : 'entwurf';
      owner = null;
    }
    const id = newId('d'); const file = `${id}.${type.ext}`;
    await putFile(file, f.data, type.mime);
    db.documents.push({ id, projectId: p.id, title: String(fields.title || f.filename).slice(0, 140), category: internHier ? 'Upload intern' : 'Einreichung Eigentümer', audience, ownerContactId: owner, status, version: '1.0', versions: [{ v: '1.0', at: now(), file }], file, mime: type.mime, size: f.data.length, uploadedBy: u.id, at: now(), source: `Upload ${u.name}`, stand: now().slice(0, 10) });
    persist();
    audit('upload', u, { dokument: id, projekt: p.id, bereich: audience });
    return redirect(res, '/portal/dokumente?m=ok');
  }
  if (path === '/portal/nachrichten') {
    if (method === 'POST') {
      const { fields } = await post();
      const [projectId, extId] = String(fields.t || '').split(':');
      if (!P.canPostToThread(u, projectId, extId)) throw notFound();
      const text = String(fields.text || '').trim().slice(0, 4000);
      if (text) { db.messages.push({ id: newId('m'), threadKey: P.threadKey(projectId, extId), projectId, fromUserId: u.id, text, at: now() }); persist(); audit('nachricht', u, { projekt: projectId }); }
      return redirect(res, `/portal/nachrichten?t=${encodeURIComponent(P.threadKey(projectId, extId))}`);
    }
    return view('Nachrichten', V.nachrichten({ u, s, threads: P.listThreads(u), projects: P.listProjects(u), users: db.users, active: url.searchParams.get('t') }));
  }

  // ---------- intern ----------
  if (path === '/portal/kontakte' && method === 'GET') { internalOnly(); return view('Kontakte', V.kontakte({ contacts: P.listContacts(u), users: db.users, projects: P.listProjects(u) })); }
  if (path === '/portal/aufgaben' && method === 'GET') { internalOnly(); return view('Aufgaben und Fristen', V.aufgaben({ s, tasks: P.listTasks(u), projects: P.listProjects(u), users: db.users })); }
  m = /^\/portal\/aufgaben\/([\w-]+)\/erledigt$/.exec(path);
  if (m && method === 'POST') { internalOnly(); await post(); const t = P.listTasks(u).find((x) => x.id === m[1]); if (!t) throw notFound(); t.status = 'erledigt'; t.doneBy = u.id; t.doneAt = now(); persist(); audit('aufgabe_erledigt', u, { aufgabe: t.id }); return redirect(res, '/portal/aufgaben'); }
  if (path === '/portal/anfragen' && method === 'GET') { internalOnly(); return view('Anfragen', V.anfragen({ s, inquiries: db.inquiries })); }
  m = /^\/portal\/anfragen\/([\w-]+)\/status$/.exec(path);
  if (m && method === 'POST') { internalOnly(); const { fields } = await post(); const i = db.inquiries.find((x) => x.id === m[1]); if (!i) throw notFound(); i.status = fields.status === 'in Bearbeitung' ? 'in Bearbeitung' : i.status; i.assignee = u.id; persist(); audit('anfrage_uebernommen', u, { anfrage: i.id }); return redirect(res, '/portal/anfragen'); }

  if (path === '/portal/freigaben' && method === 'GET') {
    internalOnly();
    const c = ctxFor(u);
    return view('Freigaben', V.freigaben({ u, s, approvals: c.approvals, users: db.users, docs: P.listDocuments(u), projects: c.projects }));
  }
  if (path === '/portal/freigaben/beantragen' && method === 'POST') {
    internalOnly();
    const { fields } = await post();
    const kind = fields.kind;
    if (kind === 'document_release') { const d = P.getDocument(u, fields.targetId); if (!d || d.status === 'freigegeben') throw notFound(); }
    else if (kind === 'project_public') { if (!P.getProject(u, fields.targetId)) throw notFound(); }
    else throw new HttpError(400, 'Unbekannte Freigabeart');
    if (db.approvals.some((a) => a.targetId === fields.targetId && a.kind === kind && a.state === 'offen')) return redirect(res, '/portal/freigaben');
    db.approvals.push({ id: newId('ap'), kind, targetId: fields.targetId, requestedBy: u.id, at: now(), state: 'offen', note: String(fields.note || (kind === 'project_public' ? 'Veröffentlichung auf der Website' : '')).slice(0, 200),
      payload: kind === 'project_public' ? { publicName: String(fields.publicName || '').slice(0, 120), summary: String(fields.summary || '').slice(0, 400) } : null });
    persist(); audit('freigabe_beantragt', u, { art: kind, ziel: fields.targetId });
    return redirect(res, '/portal/freigaben');
  }
  m = /^\/portal\/freigaben\/([\w-]+)\/entscheiden$/.exec(path);
  if (m && method === 'POST') {
    adminOnly();
    const { fields } = await post();
    const a = db.approvals.find((x) => x.id === m[1]);
    if (!a) throw notFound();
    if (!P.canDecideApproval(u, a)) throw new HttpError(403, 'Eigene Anträge können nicht selbst freigegeben werden (Vier-Augen-Prinzip).');
    const decision = fields.decision === 'genehmigt' ? 'genehmigt' : 'abgelehnt';
    a.state = decision; a.decidedBy = u.id; a.decidedAt = now();
    if (decision === 'genehmigt') {
      if (a.kind === 'document_release') { const d = db.documents.find((x) => x.id === a.targetId); if (d) d.status = 'freigegeben'; }
      if (a.kind === 'project_public') { const p = db.projects.find((x) => x.id === a.targetId); if (p) p.publicRelease = { state: 'freigegeben', publicName: a.payload?.publicName || p.name, summary: a.payload?.summary || '', publicRegion: p.region === 'nord' ? 'Norddeutschland' : 'Süddeutschland', approvedBy: u.id, approvedAt: now() }; }
    }
    persist(); audit('freigabe_entschieden', u, { antrag: a.id, entscheidung: decision });
    return redirect(res, '/portal/freigaben');
  }

  // ---------- Verwaltung ----------
  if (path === '/portal/protokoll' && method === 'GET') { adminOnly(); return view('Protokoll', V.protokoll({ audit: db.audit, downloads: db.downloads, users: db.users, docs: db.documents })); }
  if (path === '/portal/ki' && method === 'GET') { adminOnly(); return view('KI-Assistenz', V.ki(), 'Vorbereitete Funktionen'); }
  // Benutzer & Berechtigungen (nur Plattformadministration; Prüfung in handleUserAdmin)
  if (path.startsWith('/portal/admin/benutzer') || path.startsWith('/portal/admin/einladungen') || path === '/portal/admin/aenderungen') {
    adminOnly();
    return handleUserAdmin({ req, res, url, path, method, u, s, view, post });
  }
  if (path === '/portal/admin' && method === 'GET') {
    adminOnly();
    const msg = url.searchParams.get('m') === 'ok' ? 'Gespeichert.' : null;
    return view('Verwaltung', V.admin({ s, users: db.users, grants: db.grants, projects: db.projects, spvs: db.spvs, msg }), 'Konten, Rollen und Projektzugriffe');
  }
  if (path === '/portal/admin/zugriff' && method === 'POST') {
    adminOnly();
    const { fields } = await post();
    const target = db.users.find((x) => x.id === fields.userId);
    const p = db.projects.find((x) => x.id === fields.projectId);
    if (!target || !p || !['investor', 'kommune', 'technik'].includes(target.role)) throw new HttpError(400, 'Ungültige Angaben');
    if (!db.grants.some((g) => g.userId === target.id && g.projectId === p.id && g.scope === target.role)) {
      db.grants.push({ id: newId('g'), userId: target.id, projectId: p.id, scope: target.role, grantedBy: u.id, at: now() });
      persist(); audit('zugriff_erteilt', u, { konto: target.id, projekt: p.id, bereich: target.role });
    }
    return redirect(res, '/portal/admin?m=ok');
  }
  m = /^\/portal\/admin\/zugriff\/([\w-]+)\/entziehen$/.exec(path);
  if (m && method === 'POST') {
    adminOnly(); await post();
    const i = db.grants.findIndex((g) => g.id === m[1]);
    if (i < 0) throw notFound();
    const [g] = db.grants.splice(i, 1); persist(); audit('zugriff_entzogen', u, { konto: g.userId, projekt: g.projectId });
    return redirect(res, '/portal/admin?m=ok');
  }
  if (path === '/portal/admin/passwort-neu' && method === 'POST') {
    adminOnly();
    const { fields } = await post();
    const target = db.users.find((x) => x.id === fields.userId);
    if (!target || !target.active) throw new HttpError(400, 'Konto nicht gefunden oder gesperrt.');
    const pw = randomBytes(12).toString('base64url');
    target.pw = hashPassword(pw); target.mustChangePassword = true;
    persist(); audit('passwort_neu_vergeben', u, { konto: target.id });
    return view('Einmalpasswort vergeben', html`<section class="panel"><h2>Einmalpasswort für ${target.name}</h2><p>Dieses Passwort wird nur jetzt angezeigt und nirgends gespeichert. Bitte persönlich oder über einen getrennten, verschlüsselten Kanal übergeben. Beim nächsten Login muss ein eigenes Passwort festgelegt werden.</p><dl class="kv"><div><dt>Benutzername</dt><dd><code>${target.email}</code></dd></div><div><dt>Einmalpasswort</dt><dd><code>${pw}</code></dd></div></dl><p><a class="btn" href="/portal/admin">Zurück zur Verwaltung</a></p></section>`);
  }
  if (path === '/portal/admin/mfa-zuruecksetzen' && method === 'POST') {
    adminOnly();
    const { fields } = await post();
    const target = db.users.find((x) => x.id === fields.userId);
    if (!target || !target.mfa) throw new HttpError(400, 'Konto ohne MFA-Pflicht oder nicht gefunden.');
    target.totp = null; delete target.totpEnrolledAt;
    persist(); audit('mfa_zurueckgesetzt', u, { konto: target.id });
    return redirect(res, '/portal/admin?m=ok');
  }
  // frühere Kontoanlage mit angezeigtem Startpasswort ersetzt durch Einladung mit Aktivierungslink
  if (path === '/portal/admin/konto') { adminOnly(); return redirect(res, '/portal/admin/benutzer/neu'); }
  // Projektwirtschaftlichkeit, Vergütung, Handelsdaten (eigene Rechteprüfung je Projekt)
  const fin = await handleFinanzen({ req, res, url, path, method, u, s, view, page, post });
  if (fin !== null) return fin;
  throw notFound();
}

export { HttpError };
