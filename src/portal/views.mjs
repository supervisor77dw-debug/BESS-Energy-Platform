// Portal-Oberfläche nach AIW Design 2.0: eine dunkle Leiste, helle Arbeitsfläche, Doppellinie am aktiven Bereich,
// Herkunftsmarken für synthetische/ungeprüfte Daten.
import { html, raw, fmtDate, fmtDateTime, fmtNum } from '../lib/html.mjs';
import { brand, isPreview, brandLogo } from '../config.mjs';
import { ROLES, AUDIENCES, isInternal, isAdmin, hasRole, rolesOf } from '../lib/policy.mjs';
import { PHASES } from '../public/pages.mjs';
import { createRequire } from 'node:module';

const qrcode = createRequire(import.meta.url)('../vendor/qrcode-generator.cjs');

const ICON = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  proj: 'M4 5h16v14H4zM4 10h16M9 5v14',
  doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  land: 'M3 18l5-9 4 6 3-4 6 7zM3 21h18',
  msg: 'M4 5h16v11H9l-5 4z',
  pipe: 'M4 6h5v12H4zM10 6h5v8h-5zM16 6h4v5h-4z',
  people: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M22 20a6 6 0 0 0-4-5.6',
  task: 'M4 6l2 2 4-4M12 7h8M4 13l2 2 4-4M12 14h8M12 20h8',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  check: 'M4 12l5 5L20 6',
  log: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  admin: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  ai: 'M12 3v3M12 18v3M3 12h3M18 12h3M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  chart: 'M4 20h16M7 16v-5M12 16V7M17 16v-8',
  euro: 'M17 6.5A6 6 0 1 0 17 17.5M5 10h9M5 14h9',
};
const icon = (k) => raw(`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${ICON[k]}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>`);

export function navFor(u) {
  const n = [['/portal', 'Übersicht', 'home']];
  if (isInternal(u)) n.push(['/portal/pipeline', 'Pipeline', 'pipe']);
  n.push(['/portal/projekte', u.role === 'eigentuemer' ? 'Projekt' : 'Projekte', 'proj']);
  if (hasRole(u, 'eigentuemer') || isInternal(u)) n.push(['/portal/grundstuecke', 'Grundstücke', 'land']);
  n.push(['/portal/dokumente', u.role === 'investor' ? 'Datenraum' : 'Dokumente', 'doc']);
  if (hasRole(u, 'eigentuemer')) n.push(['/portal/verguetung', 'Meine Vergütung', 'euro']);
  n.push(['/portal/nachrichten', 'Nachrichten', 'msg']);
  if (rolesOf(u).some((r) => ['admin', 'projektleitung', 'vertrieb_nord', 'vertrieb_sued'].includes(r))) n.push(['/portal/wirtschaftlichkeit', 'Wirtschaftlichkeit', 'chart']);
  if (isInternal(u)) n.push(['/portal/kontakte', 'Kontakte', 'people'], ['/portal/aufgaben', 'Aufgaben', 'task'], ['/portal/anfragen', 'Anfragen', 'inbox'], ['/portal/freigaben', 'Freigaben', 'check']);
  if (isAdmin(u)) n.push(['/portal/admin/handelsdaten', 'Handelsdaten', 'pipe'], ['/portal/admin/benutzer', 'Benutzer & Berechtigungen', 'people'], ['/portal/protokoll', 'Protokoll', 'log'], ['/portal/admin', 'Verwaltung', 'admin'], ['/portal/ki', 'KI-Assistenz', 'ai']);
  return n;
}

export function shell({ u, s, path, title, context, body, actions }) {
  const nav = navFor(u);
  const active = (href) => href === '/portal' ? path === '/portal' : path.startsWith(href);
  const items = nav.map(([href, label, ic]) => html`<li><a href="${href}"${active(href) ? raw(' aria-current="page"') : ''}>${icon(ic)}<span>${label}</span></a></li>`);
  return html`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive"><title>${title} · Portal · ${brand.name}</title>
<link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/static/css/portal.css"></head>
<body>
<a class="skip" href="#main">Zum Inhalt springen</a>
<div class="app">
  <nav class="rail" aria-label="Portalbereiche">
    <a class="rail-brand" href="/portal" aria-label="Portal ${brand.name}">${raw(brandLogo('rail-logo'))}</a>
    <ul>${items}</ul>
  </nav>
  <div class="work">
    <header class="top">
      <div class="top-title"><h1>${title}</h1>${context ? html`<p>${context}</p>` : ''}</div>
      <div class="top-user">
        ${actions || ''}
        <span class="who"><strong>${u.name}</strong><span>${rolesOf(u).map((r) => ROLES[r].label).join(', ')} · <a href="/portal/passwort">Passwort ändern</a></span></span>
        <form method="post" action="/portal/abmelden"><input type="hidden" name="_csrf" value="${s.csrf}"><button class="btn btn-quiet" type="submit">Abmelden</button></form>
      </div>
    </header>
    ${isPreview() ? html`<aside class="demo-bar" aria-label="Hinweis zu den Daten"><span class="mark mark-demo">Vorschau</span> Alle Daten in diesem Portal sind synthetisch. Keine realen Personen, Flächen, Verträge oder Zahlen.</aside>` : ''}
    <main id="main" class="content">${body}</main>
  </div>
</div>
</body></html>`;
}

export function authPage({ title, body }) {
  return html`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${title} · ${brand.name}</title><link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/static/css/portal.css"></head>
<body class="auth"><main class="auth-main"><a class="auth-brand" href="/">${raw(brandLogo('auth-logo'))}${brand.wordmark}</a>${body}</main></body></html>`;
}

export function loginView({ token, error, demo, email = '', info }) {
  return authPage({ title: 'Anmeldung', body: html`
<div class="auth-card">
  <h1>Anmeldung zum Portal</h1>
  <p class="muted">Für Grundstückseigentümer, Investoren, Kommunen, Partner und Mitarbeitende. Zugänge werden persönlich eingerichtet.</p>
  ${info ? html`<div class="notice" role="status">${info}</div>` : ''}
  ${error ? html`<div class="alert" role="alert">${error}</div>` : ''}
  <form method="post" action="/portal/anmelden" class="stack">
    <input type="hidden" name="_t" value="${token}">
    <label for="email">E-Mail-Adresse</label><input id="email" name="email" type="email" autocomplete="username" required value="${email}">
    <label for="pw">Passwort</label><input id="pw" name="password" type="password" autocomplete="current-password" required>
    <button class="btn btn-primary" type="submit">Anmelden</button>
  </form>
  <p class="small muted">Kein Zugang? Ihr Ansprechpartner richtet ihn ein. <a href="/kontakt">Kontakt</a></p>
</div>
${demo ? html`<aside class="auth-card demo-card" aria-label="Vorschau-Zugänge">
  <h2><span class="mark mark-demo">Vorschau</span> Demo-Zugänge</h2>
  <p class="small">Nur in der Abnahmevorschau sichtbar. Passwort für alle: <code>${demo.password}</code></p>
  <table class="tbl tbl-compact"><thead><tr><th>Rolle</th><th>E-Mail</th><th>MFA</th></tr></thead><tbody>${demo.users.map((x) => html`<tr><td>${ROLES[x.role].label}</td><td><code>${x.email}</code></td><td>${x.mfa ? 'ja' : '–'}</td></tr>`)}</tbody></table>
</aside>` : ''}` });
}

export function mfaView({ s, error, demoCode }) {
  return authPage({ title: 'Bestätigung', body: html`
<div class="auth-card">
  <h1>Zweiter Faktor</h1>
  <p class="muted">Geben Sie den sechsstelligen Code aus Ihrer Authenticator-App ein.</p>
  ${error ? html`<div class="alert" role="alert">${error}</div>` : ''}
  <form method="post" action="/portal/mfa" class="stack">
    <input type="hidden" name="_csrf" value="${s.csrf}">
    <label for="code">Bestätigungscode</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus>
    <button class="btn btn-primary" type="submit">Bestätigen</button>
  </form>
  ${demoCode ? html`<p class="small"><span class="mark mark-demo">Vorschau</span> Aktueller Code: <code>${demoCode}</code></p>` : ''}
</div>` });
}

export function mfaEnrollView({ s, secret, account, error }) {
  const issuer = encodeURIComponent(`${brand.name} Vorschau`);
  const uri = `otpauth://totp/${issuer}:${encodeURIComponent(account)}?secret=${secret}&issuer=${issuer}&digits=6&period=30`;
  const qr = qrcode(0, 'M'); qr.addData(uri); qr.make();
  return authPage({ title: 'Zwei-Faktor einrichten', body: html`
<div class="auth-card">
  <h1>Zweiten Faktor einrichten</h1>
  <p class="muted">Für Ihr Konto ist die Anmeldung mit zweitem Faktor vorgeschrieben. Scannen Sie den Code mit einer Authenticator-App (z. B. Microsoft oder Google Authenticator) und geben Sie den angezeigten sechsstelligen Code ein.</p>
  ${error ? html`<div class="alert" role="alert">${error}</div>` : ''}
  <img class="qr" src="${qr.createDataURL(5, 2)}" alt="QR-Code zur Einrichtung der Authenticator-App" width="200" height="200">
  <details class="small"><summary>Code lässt sich nicht scannen?</summary><p>Schlüssel manuell eingeben: <code>${secret.match(/.{1,4}/g).join(' ')}</code> (zeitbasiert, 6 Stellen, 30 Sekunden)</p></details>
  <form method="post" action="/portal/mfa" class="stack">
    <input type="hidden" name="_csrf" value="${s.csrf}">
    <label for="code">Bestätigungscode aus der App</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
    <button class="btn btn-primary" type="submit">Einrichtung abschließen</button>
  </form>
</div>` });
}

export function passwordView({ s, u, forced, error }) {
  return authPage({ title: 'Passwort festlegen', body: html`
<div class="auth-card">
  <h1>${forced ? 'Eigenes Passwort festlegen' : 'Passwort ändern'}</h1>
  <p class="muted">${forced ? 'Sie haben sich mit einem Startpasswort angemeldet. Bitte legen Sie jetzt ein eigenes Passwort fest. Es ist nur Ihnen bekannt.' : 'Hier können Sie Ihr Passwort jederzeit ändern.'}</p>
  ${error ? html`<div class="alert" role="alert">${error}</div>` : ''}
  <form method="post" action="/portal/passwort" class="stack">
    <input type="hidden" name="_csrf" value="${s.csrf}">
    <input type="text" name="username" value="${u.email}" autocomplete="username" hidden>
    <label for="cur">Bisheriges Passwort</label><input id="cur" name="current" type="password" autocomplete="current-password" required>
    <label for="n1">Neues Passwort (mindestens 12 Zeichen)</label><input id="n1" name="neu" type="password" autocomplete="new-password" minlength="12" required>
    <label for="n2">Neues Passwort wiederholen</label><input id="n2" name="neu2" type="password" autocomplete="new-password" minlength="12" required>
    <button class="btn btn-primary" type="submit">Passwort speichern</button>
  </form>
  <form method="post" action="/portal/abmelden"><input type="hidden" name="_csrf" value="${s.csrf}"><button class="btn btn-quiet" type="submit">Abmelden</button></form>
</div>` });
}

// ---------- Bausteine ----------
const phaseLabel = (n) => n ? `${n} · ${PHASES[n - 1][0]}` : '–';
export const phaseBar = (n) => html`<div class="phasebar" role="img" aria-label="Projektphase ${n} von 10: ${PHASES[n - 1]?.[0] || ''}">${PHASES.map((_, i) => html`<span class="${i < n ? 'on' : ''}${i === n - 1 ? ' cur' : ''}"></span>`)}</div>`;
const statusMark = (t) => html`<span class="status">${t}</span>`;
const audMark = (a) => html`<span class="mark mark-aud">${AUDIENCES[a]}</span>`;
const docStatus = (d) => d.status === 'freigegeben' ? html`<span class="mark mark-ok">freigegeben</span>` : d.status === 'entwurf' ? html`<span class="mark mark-warn">Entwurf</span>` : html`<span class="mark mark-info">eingereicht</span>`;
const empty = (t, sub) => html`<div class="empty"><p><strong>${t}</strong></p>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>`;

function docTable(docs, projectsById, { showProject = true, showAudience = false } = {}) {
  if (!docs.length) return empty('Keine Dokumente in diesem Bereich.', 'Freigegebene Unterlagen erscheinen hier, sobald sie bereitgestellt werden.');
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Dokument</th>${showProject ? html`<th>Projekt</th>` : ''}${showAudience ? html`<th>Bereich</th>` : ''}<th>Version</th><th>Stand</th><th>Status</th><th><span class="sr">Aktion</span></th></tr></thead><tbody>
  ${docs.map((d) => html`<tr><td data-l="Dokument"><strong>${d.title}</strong><br><span class="muted small">${d.category} · Quelle: ${d.source}</span></td>${showProject ? html`<td data-l="Projekt">${projectsById[d.projectId]?.code}</td>` : ''}${showAudience ? html`<td data-l="Bereich">${audMark(d.audience)}</td>` : ''}<td data-l="Version">${d.version}</td><td data-l="Stand">${fmtDate(d.stand)}</td><td data-l="Status">${docStatus(d)}</td><td><a class="btn btn-small" href="/portal/dokumente/${d.id}/download">Herunterladen</a></td></tr>`)}
  </tbody></table></div>`;
}

// ---------- Dashboard ----------
export function dashboard(ctx) {
  const { u, projects, docs, appointments, threads, tasks, approvals, inquiries, parcels, contracts, users } = ctx;
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
  const nextAppts = appointments.filter((a) => a.at >= new Date().toISOString()).sort((a, b) => a.at.localeCompare(b.at)).slice(0, 4);
  const apptList = nextAppts.length ? html`<ul class="list">${nextAppts.map((a) => html`<li><span class="date">${fmtDateTime(a.at)}</span><span><strong>${a.title}</strong><br><span class="muted small">${byId[a.projectId]?.name} · ${a.place}</span></span></li>`)}</ul>` : empty('Keine anstehenden Termine.');
  const unread = threads.filter((t) => t.messages.length && t.messages[t.messages.length - 1].fromUserId !== u.id).length;

  if (u.role === 'eigentuemer') {
    const p = projects[0];
    return html`
<section class="grid-2">
  <div class="panel">
    <h2>Ihr Standort</h2>
    ${projects.length ? projects.map((pp) => html`<div class="proj-head"><p class="kicker">${pp.code}</p><h3>${pp.name}</h3><p class="muted">${pp.location}</p>${phaseBar(pp.phase)}<p class="small">Aktuelle Phase: <strong>${phaseLabel(pp.phase)}</strong></p></div>`) : empty('Noch kein Projekt zugeordnet.')}
  </div>
  <div class="panel"><h2>Nächste Termine</h2>${apptList}</div>
</section>
<section class="grid-2">
  <div class="panel"><h2>Neuigkeiten zum Projekt</h2>${p?.ownerUpdates?.length ? html`<ul class="timeline">${[...p.ownerUpdates].reverse().map((x) => html`<li><span class="date">${fmtDate(x.at)}</span><p>${x.text}</p></li>`)}</ul>` : empty('Noch keine Meldungen.')}</div>
  <div class="panel"><h2>Ihr Vertrag</h2>${contracts.length ? contracts.map((c) => html`<p><strong>${c.type}</strong><br>${statusMark(c.status)}${c.signedAt ? html` · unterzeichnet am ${fmtDate(c.signedAt)}` : ''}</p><p><a href="/portal/grundstuecke">Eckdaten ansehen</a></p>`) : empty('Kein Vertrag hinterlegt.')}
  <h2 class="mt">Ansprechpartner</h2><p>${users.find((x) => x.role === 'vertrieb_nord')?.name || 'Vertriebskoordination'}<br><span class="muted small">Vertriebskoordination Nord</span></p><p><a class="btn btn-primary" href="/portal/nachrichten">Nachricht schreiben</a>${unread ? html` <span class="badge">${unread} neu</span>` : ''}</p></div>
</section>`;
  }

  if (u.role === 'investor' || u.role === 'kommune' || u.role === 'technik') {
    return html`
<section class="panel">
  <h2>${u.role === 'investor' ? 'Freigeschaltete Projekte' : 'Ihre Projekte'}</h2>
  ${projects.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Projekt</th><th>Phase</th><th>Netzanschluss</th><th>Genehmigung</th><th><span class="sr">Aktion</span></th></tr></thead><tbody>${projects.map((p) => html`<tr><td data-l="Projekt"><strong>${p.name}</strong><br><span class="muted small">${p.code} · ${p.location}</span></td><td data-l="Phase">${phaseBar(p.phase)}<span class="small">${phaseLabel(p.phase)}</span></td><td data-l="Netzanschluss">${p.gridStatus}</td><td data-l="Genehmigung">${p.permitStatus}</td><td><a class="btn btn-small" href="/portal/projekte/${p.id}">Öffnen</a></td></tr>`)}</tbody></table></div>` : empty('Für Ihren Zugang ist noch kein Projekt freigeschaltet.', 'Die Freischaltung erfolgt projektbezogen durch die Plattformadministration.')}
</section>
<section class="grid-2">
  <div class="panel"><h2>Zuletzt bereitgestellt</h2>${docTable(docs.slice(-5).reverse(), byId)}</div>
  <div class="panel"><h2>Termine</h2>${apptList}<h2 class="mt">Nachrichten</h2><p>${unread ? html`<span class="badge">${unread} neu</span> ` : ''}<a href="/portal/nachrichten">Zu den Nachrichten</a></p></div>
</section>`;
  }

  // intern
  const open = tasks.filter((t) => t.status !== 'erledigt');
  const overdue = open.filter((t) => t.due < new Date().toISOString().slice(0, 10));
  const newInq = inquiries.filter((i) => i.status === 'neu');
  const openAppr = approvals.filter((a) => a.state === 'offen');
  return html`
<section class="kpis" aria-label="Lage">
  <a class="kpi" href="/portal/pipeline"><span class="kpi-v">${projects.length}</span><span class="kpi-l">Projekte im Zugriff</span></a>
  <a class="kpi" href="/portal/aufgaben"><span class="kpi-v">${open.length}</span><span class="kpi-l">offene Aufgaben${overdue.length ? html` · <span class="bad">${overdue.length} überfällig</span>` : ''}</span></a>
  <a class="kpi" href="/portal/anfragen"><span class="kpi-v">${newInq.length}</span><span class="kpi-l">neue Anfragen</span></a>
  <a class="kpi" href="/portal/freigaben"><span class="kpi-v">${openAppr.length}</span><span class="kpi-l">offene Freigaben</span></a>
</section>
<section class="grid-2">
  <div class="panel"><h2>Fällige Aufgaben</h2>${open.length ? html`<ul class="list">${open.sort((a, b) => a.due.localeCompare(b.due)).slice(0, 6).map((t) => html`<li><span class="date${t.due < new Date().toISOString().slice(0, 10) ? ' bad' : ''}">${fmtDate(t.due)}</span><span>${t.title}<br><span class="muted small">${byId[t.projectId]?.code}</span></span></li>`)}</ul>` : empty('Keine offenen Aufgaben.')}</div>
  <div class="panel"><h2>Termine</h2>${apptList}</div>
</section>
<section class="panel"><h2>Pipeline nach Phase</h2>${pipelineBoard(projects)}</section>`;
}

export function pipelineBoard(projects) {
  const groups = [[1, 2, 'Akquise und Sicherung'], [3, 5, 'Netz, Genehmigung, Wirtschaftlichkeit'], [6, 8, 'Finanzierung und Bau'], [9, 10, 'Betrieb']];
  return html`<div class="board">${groups.map(([a, b, t]) => {
    const ps = projects.filter((p) => p.phase >= a && p.phase <= b);
    return html`<div class="lane"><h3>${t} <span class="muted">(${ps.length})</span></h3>${ps.map((p) => html`<a class="card" href="/portal/projekte/${p.id}"><strong>${p.name}</strong><span class="muted small">${p.code} · Region ${p.region === 'nord' ? 'Nord' : 'Süd'}</span>${phaseBar(p.phase)}<span class="small">${p.contractStatus}</span></a>`)}${ps.length ? '' : html`<p class="muted small">–</p>`}</div>`;
  })}</div>`;
}

// ---------- Projekte ----------
export function projectList({ u, projects, spvs }) {
  if (!projects.length) return empty('Keine Projekte in Ihrem Zugriff.');
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Projekt</th><th>Projektgesellschaft</th><th>Phase</th><th>Vertrag</th><th>Netz</th><th><span class="sr">Aktion</span></th></tr></thead><tbody>
  ${projects.map((p) => { const spv = spvs.find((x) => x.id === p.spvId); return html`<tr><td data-l="Projekt"><strong>${p.name}</strong><br><span class="muted small">${p.code} · ${p.location}</span></td><td data-l="Gesellschaft">${u.role === 'eigentuemer' ? '–' : html`${spv?.name}<br>${statusMark(spv?.legalStatus)}`}</td><td data-l="Phase">${phaseLabel(p.phase)}</td><td data-l="Vertrag">${p.contractStatus}</td><td data-l="Netz">${u.role === 'eigentuemer' ? '–' : p.gridStatus}</td><td><a class="btn btn-small" href="/portal/projekte/${p.id}">Öffnen</a></td></tr>`; })}
  </tbody></table></div>`;
}

export function projectDetail({ u, s, p, spv, docs, showFin, showTech, parcels, approvals }) {
  const byId = { [p.id]: p };
  const m = p.econ?.meta;
  return html`
<section class="panel proj-top">
  <div><p class="kicker">${p.code} · ${p.location}</p>${phaseBar(p.phase)}<p>Aktuelle Phase: <strong>${phaseLabel(p.phase)}</strong></p></div>
  <dl class="kv">
    ${showTech ? html`<div><dt>Projektgesellschaft</dt><dd>${spv?.name}<br>${statusMark(spv?.legalStatus)} <span class="muted small">${spv?.note}</span></dd></div>` : ''}
    <div><dt>Flächensicherung</dt><dd>${p.contractStatus}</dd></div>
    ${showTech ? html`<div><dt>Netzanschluss</dt><dd>${p.gridStatus}</dd></div><div><dt>Genehmigung</dt><dd>${p.permitStatus}</dd></div>` : ''}
  </dl>
</section>
${u.role === 'eigentuemer' ? html`<section class="panel"><h2>Projektfortschritt</h2>${p.ownerUpdates?.length ? html`<ul class="timeline">${[...p.ownerUpdates].reverse().map((x) => html`<li><span class="date">${fmtDate(x.at)}</span><p>${x.text}</p></li>`)}</ul>` : empty('Noch keine Meldungen.')}</section>` : ''}
${showTech ? html`<section class="panel"><h2>Technische Eckdaten <span class="mark mark-demo">synthetisch</span></h2><dl class="kv kv-4">
  <div><dt>Leistung</dt><dd class="num">${p.tech.powerMW ? `${fmtNum(p.tech.powerMW)} MW` : 'offen'}</dd></div>
  <div><dt>Energieinhalt</dt><dd class="num">${p.tech.capacityMWh ? `${fmtNum(p.tech.capacityMWh)} MWh` : 'offen'}</dd></div>
  <div><dt>Betriebsfläche (Planung)</dt><dd class="num">${p.tech.areaHa ? `ca. ${fmtNum(p.tech.areaHa, 1)} ha` : 'offen'}</dd></div>
  <div><dt>Netzanbindung</dt><dd>${p.tech.connection}</dd></div></dl><p class="small muted">Variante: ${p.tech.variant}</p></section>` : ''}
${showFin ? html`<section class="panel fin"><h2>Wirtschaftliche Kennzahlen</h2>
  ${p.econ ? html`<div class="fin-meta"><span class="mark mark-warn">${m.status}</span><span>Quelle: ${m.source}</span><span>Stand: ${fmtDate(m.stand)}</span></div>
  <dl class="kv kv-4"><div><dt>CAPEX (Bandbreite)</dt><dd class="num">${fmtNum(p.econ.capexMEUR[0], 1)}–${fmtNum(p.econ.capexMEUR[1], 1)} Mio. EUR</dd></div><div><dt>OPEX p. a. (Bandbreite)</dt><dd class="num">${fmtNum(p.econ.opexKEURa[0])}–${fmtNum(p.econ.opexKEURa[1])} TEUR</dd></div></dl>
  <h3>Annahmen</h3><ul class="assume">${m.assumptions.map((a) => html`<li>${a}</li>`)}</ul>
  <p class="small muted">Keine Prognosezusage. Verbindlich sind ausschließlich die Finanzierungsunterlagen der Projektgesellschaft nach Freigabe.</p>` : empty('Noch kein Wirtschaftlichkeitsmodell für dieses Projekt.')}
</section>` : ''}
${showFin || isInternal(u) ? html`<section class="panel"><h2>Risiken</h2><ul class="assume">${p.risks.map((r) => html`<li>${r}</li>`)}</ul></section>` : ''}
${parcels.length ? html`<section class="panel"><h2>Grundstücke</h2>${parcelTable(parcels)}</section>` : ''}
<section class="panel"><h2>Dokumente</h2>${docTable(docs, byId, { showProject: false, showAudience: isInternal(u) })}</section>
${isInternal(u) ? html`<section class="panel"><h2>Öffentliche Darstellung</h2>
  <p>Status: ${statusMark(p.publicRelease?.state || 'nicht freigegeben')}</p>
  ${p.publicRelease?.state === 'freigegeben' ? '' : approvals.some((a) => a.kind === 'project_public' && a.targetId === p.id && a.state === 'offen')
    ? html`<p class="muted">Eine Freigabe ist beantragt und wartet auf Entscheidung.</p>`
    : html`<form method="post" action="/portal/freigaben/beantragen" class="stack stack-inline"><input type="hidden" name="_csrf" value="${s.csrf}"><input type="hidden" name="kind" value="project_public"><input type="hidden" name="targetId" value="${p.id}">
      <label for="pubname">Öffentlicher Projektname</label><input id="pubname" name="publicName" value="${p.name}">
      <label for="pubsum">Kurzbeschreibung</label><textarea id="pubsum" name="summary" rows="2">Batteriespeicher in Entwicklung.</textarea>
      <button class="btn" type="submit">Veröffentlichung beantragen</button><p class="small muted">Wird erst nach Freigabe durch die Plattformadministration (Vier-Augen-Prinzip) auf der Website angezeigt.</p></form>`}
</section>` : ''}`;
}

export function parcelTable(parcels) {
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Gemarkung / Flur / Flurstück</th><th>Größe</th><th>Entwicklungsfläche</th><th>Nutzung</th><th>Status</th></tr></thead><tbody>${parcels.map((x) => html`<tr><td data-l="Lage">${x.gemarkung}, Flur ${x.flur}, Flurstück ${x.flurstueck}</td><td data-l="Größe" class="num">${x.areaHa ? `${fmtNum(x.areaHa, 1)} ha` : '–'}</td><td data-l="Entwicklungsfläche" class="num">${x.devAreaHa ? `ca. ${fmtNum(x.devAreaHa, 1)} ha` : '–'}</td><td data-l="Nutzung">${x.use}</td><td data-l="Status">${statusMark(x.status)}</td></tr>`)}</tbody></table></div>`;
}

export function grundstuecke({ u, parcels, contracts, projects }) {
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
  return html`
<section class="panel"><h2>${u.role === 'eigentuemer' ? 'Ihre Grundstücke' : 'Grundstücke im Zugriff'}</h2>${parcels.length ? parcelTable(parcels) : empty('Keine Grundstücke.')}</section>
<section class="panel"><h2>Verträge und vereinbarte Eckdaten</h2>
${contracts.length ? contracts.map((c) => html`<article class="contract"><header><h3>${c.type}</h3><p>${statusMark(c.status)} · ${byId[c.projectId]?.name}${c.signedAt ? html` · unterzeichnet am ${fmtDate(c.signedAt)}` : ''}</p><p class="small muted">Grundlage: ${c.basis}</p></header>
  <dl class="kv">${c.keyTerms.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl></article>`) : empty('Keine Verträge.')}
<p class="small muted">Maßgeblich ist allein der unterzeichnete Vertrag. Die Übersicht dient der Orientierung. Interne Projektkalkulationen sind hier nicht enthalten.</p>
</section>`;
}

// ---------- Dokumente ----------
export function dokumente({ u, s, docs, projects, msg }) {
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
  const canUpload = (hasRole(u, 'eigentuemer') || isInternal(u)) && projects.length;
  return html`
${msg ? html`<div class="notice" role="status">${msg}</div>` : ''}
${projects.map((p) => { const ds = docs.filter((d) => d.projectId === p.id); return html`<section class="panel"><h2>${p.name} <span class="muted small">${p.code}</span></h2>${docTable(ds, byId, { showProject: false, showAudience: isInternal(u) })}</section>`; })}
${projects.length ? '' : empty('Kein Projekt im Zugriff.')}
${canUpload ? html`<section class="panel"><h2>Dokument hochladen</h2>
<form method="post" action="/portal/dokumente/hochladen" enctype="multipart/form-data" class="stack stack-inline"><input type="hidden" name="_csrf" value="${s.csrf}">
  <label for="projectId">Projekt</label><select id="projectId" name="projectId">${projects.map((p) => html`<option value="${p.id}">${p.code} – ${p.name}</option>`)}</select>
  ${isInternal(u) ? html`<label for="audience">Bereich</label><select id="audience" name="audience">${['intern', 'eigentuemer', 'kommune', 'investor', 'technik'].filter((a) => hasRole(u, 'admin') || hasRole(u, 'projektleitung') || ['intern', 'eigentuemer', 'kommune'].includes(a)).map((a) => html`<option value="${a}">${AUDIENCES[a]}</option>`)}</select>` : ''}
  <label for="title">Titel</label><input id="title" name="title" required maxlength="140">
  <label for="file">Datei (PDF, JPG oder PNG, bis 10 MB)</label><input id="file" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" required>
  <button class="btn btn-primary" type="submit">Hochladen</button>
  <p class="small muted">${isInternal(u) ? 'Dokumente für externe Bereiche werden als Entwurf angelegt und erst nach Freigabe sichtbar.' : 'Ihr Dokument ist danach für Sie und Ihre Ansprechpartner sichtbar, nicht für andere Beteiligte.'}</p>
</form></section>` : ''}`;
}

// ---------- Nachrichten ----------
export function nachrichten({ u, s, threads, projects, users, active }) {
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
  const name = (id) => users.find((x) => x.id === id)?.name || 'Unbekannt';
  const t = threads.find((x) => x.key === active) || threads[0];
  return html`<div class="msg-layout">
  <nav class="panel msg-list" aria-label="Unterhaltungen">${threads.length ? html`<ul>${threads.map((x) => html`<li><a href="/portal/nachrichten?t=${encodeURIComponent(x.key)}"${t && x.key === t.key ? raw(' aria-current="true"') : ''}><strong>${isInternal(u) ? name(x.externalUserId) : 'Ihr Ansprechpartner'}</strong><span class="muted small">${byId[x.projectId]?.name} · ${x.messages.length} Nachrichten</span></a></li>`)}</ul>` : empty('Keine Unterhaltungen.')}</nav>
  <section class="panel msg-thread">${t ? html`
    <h2>${byId[t.projectId]?.name}</h2>
    <ol class="msgs">${t.messages.map((m) => html`<li class="${m.fromUserId === u.id ? 'mine' : ''}"><p>${m.text}</p><span class="muted small">${name(m.fromUserId)} · ${fmtDateTime(m.at)}</span></li>`)}${t.messages.length ? '' : html`<li class="muted">Noch keine Nachrichten. Schreiben Sie die erste.</li>`}</ol>
    <form method="post" action="/portal/nachrichten" class="stack"><input type="hidden" name="_csrf" value="${s.csrf}"><input type="hidden" name="t" value="${t.key}">
      <label for="text">Nachricht</label><textarea id="text" name="text" rows="3" required maxlength="4000"></textarea><button class="btn btn-primary" type="submit">Senden</button>
      <p class="small muted">Nachrichten werden im Portal gespeichert. Es wird keine E-Mail versendet.</p></form>` : ''}
  </section></div>`;
}

// ---------- Intern ----------
export function kontakte({ contacts, users, projects }) {
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
  return html`<section class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Kontakt</th><th>Art</th><th>Projekte</th><th>Verantwortlich</th><th>Notiz</th></tr></thead><tbody>
  ${contacts.map((c) => html`<tr><td data-l="Kontakt"><strong>${c.name}</strong><br><span class="muted small">${c.email} ${c.phone}</span></td><td data-l="Art">${c.kind}</td><td data-l="Projekte">${(c.projectIds || []).map((id) => byId[id]?.code || '(kein Zugriff)').join(', ')}</td><td data-l="Verantwortlich">${users.find((x) => x.id === c.owner)?.name || html`<span class="muted">nicht zugewiesen</span>`}</td><td data-l="Notiz">${c.note}</td></tr>`)}
  </tbody></table></div></section>`;
}
export function aufgaben({ s, tasks, projects, users }) {
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
  const today = new Date().toISOString().slice(0, 10);
  return html`<section class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Frist</th><th>Aufgabe</th><th>Projekt</th><th>Zuständig</th><th>Status</th><th><span class="sr">Aktion</span></th></tr></thead><tbody>
  ${tasks.sort((a, b) => a.due.localeCompare(b.due)).map((t) => html`<tr><td data-l="Frist" class="${t.status !== 'erledigt' && t.due < today ? 'bad' : ''}">${fmtDate(t.due)}</td><td data-l="Aufgabe">${t.title}</td><td data-l="Projekt">${byId[t.projectId]?.code}</td><td data-l="Zuständig">${users.find((x) => x.id === t.assignee)?.name || html`<span class="muted">offen</span>`}</td><td data-l="Status">${statusMark(t.status)}</td><td>${t.status !== 'erledigt' ? html`<form method="post" action="/portal/aufgaben/${t.id}/erledigt"><input type="hidden" name="_csrf" value="${s.csrf}"><button class="btn btn-small" type="submit">Erledigt</button></form>` : ''}</td></tr>`)}
  </tbody></table></div></section>`;
}
export function anfragen({ s, inquiries }) {
  return html`<section class="panel"><p class="small muted">Eingänge aus den öffentlichen Formularen. Aus Anfragen werden keine automatischen Angebote erzeugt.</p>
  ${inquiries.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Eingang</th><th>Art</th><th>Absender</th><th>Angaben</th><th>Status</th><th><span class="sr">Aktion</span></th></tr></thead><tbody>${[...inquiries].reverse().map((i) => html`<tr><td data-l="Eingang">${fmtDateTime(i.at)}</td><td data-l="Art">${i.kind === 'flaeche' ? 'Flächenangebot' : `Kontakt: ${i.anliegen}`}</td><td data-l="Absender"><strong>${i.name}</strong><br><span class="small">${i.email} ${i.phone}</span></td><td data-l="Angaben" class="small">${i.kind === 'flaeche' ? html`${i.lage}${i.flurstueck ? html`<br>${i.flurstueck}` : ''}<br>${i.flaeche ? `${i.flaeche} ha · ` : ''}${i.nutzung} · Umspannwerk: ${i.umspannwerk}${i.fileId ? html`<br>Anlage vorhanden` : ''}` : ''}${i.nachricht ? html`<br>${i.nachricht}` : ''}</td><td data-l="Status">${statusMark(i.status)}</td><td>${i.status === 'neu' ? html`<form method="post" action="/portal/anfragen/${i.id}/status"><input type="hidden" name="_csrf" value="${s.csrf}"><button class="btn btn-small" name="status" value="in Bearbeitung">Übernehmen</button></form>` : ''}</td></tr>`)}</tbody></table></div>` : empty('Keine Anfragen eingegangen.')}</section>`;
}
export function freigaben({ u, s, approvals, users, docs, projects }) {
  const name = (id) => users.find((x) => x.id === id)?.name || id;
  const target = (a) => a.kind === 'document_release' ? `Dokument: ${docs.find((d) => d.id === a.targetId)?.title || a.targetId}` : `Projekt öffentlich: ${projects.find((p) => p.id === a.targetId)?.name || a.targetId}`;
  return html`<section class="panel"><p class="small muted">Externe Veröffentlichungen und Dokumentfreigaben erfolgen nur nach Entscheidung der Plattformadministration. Antragsteller und Entscheider müssen verschiedene Personen sein.</p>
  ${approvals.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Antrag</th><th>Gegenstand</th><th>Beantragt</th><th>Status</th><th><span class="sr">Aktion</span></th></tr></thead><tbody>${[...approvals].reverse().map((a) => html`<tr><td data-l="Antrag">${a.note || '–'}</td><td data-l="Gegenstand">${target(a)}</td><td data-l="Beantragt">${name(a.requestedBy)}<br><span class="muted small">${fmtDateTime(a.at)}</span></td><td data-l="Status">${statusMark(a.state)}${a.decidedBy ? html`<br><span class="muted small">${name(a.decidedBy)} · ${fmtDateTime(a.decidedAt)}</span>` : ''}</td><td>${a.state === 'offen' && isAdmin(u) && a.requestedBy !== u.id ? html`<form method="post" action="/portal/freigaben/${a.id}/entscheiden" class="row-actions"><input type="hidden" name="_csrf" value="${s.csrf}"><button class="btn btn-small btn-primary" name="decision" value="genehmigt">Freigeben</button><button class="btn btn-small" name="decision" value="abgelehnt">Ablehnen</button></form>` : a.state === 'offen' && isAdmin(u) ? html`<span class="muted small">eigener Antrag</span>` : ''}</td></tr>`)}</tbody></table></div>` : empty('Keine Freigabeanträge.')}</section>
  <section class="panel"><h2>Dokumentfreigabe beantragen</h2>${(() => { const drafts = docs.filter((d) => d.status !== 'freigegeben' && !approvals.some((a) => a.targetId === d.id && a.state === 'offen')); return drafts.length ? html`<form method="post" action="/portal/freigaben/beantragen" class="stack stack-inline"><input type="hidden" name="_csrf" value="${s.csrf}"><input type="hidden" name="kind" value="document_release"><label for="tid">Dokument</label><select id="tid" name="targetId">${drafts.map((d) => html`<option value="${d.id}">${d.title} (${AUDIENCES[d.audience]})</option>`)}</select><label for="note">Begründung</label><input id="note" name="note" maxlength="200"><button class="btn" type="submit">Freigabe beantragen</button></form>` : html`<p class="muted">Keine Entwürfe ohne offenen Antrag.</p>`; })()}</section>`;
}
export function protokoll({ audit, downloads, users, docs }) {
  const name = (id) => users.find((x) => x.id === id)?.name || id || 'anonym';
  return html`<section class="panel"><h2>Downloadprotokoll</h2>${downloads.length ? html`<div class="tbl-wrap"><table class="tbl tbl-compact"><thead><tr><th>Zeit</th><th>Person</th><th>Dokument</th><th>Version</th></tr></thead><tbody>${[...downloads].reverse().slice(0, 200).map((d) => html`<tr><td>${fmtDateTime(d.at)}</td><td>${name(d.userId)}</td><td>${docs.find((x) => x.id === d.docId)?.title}</td><td>${d.version}</td></tr>`)}</tbody></table></div>` : empty('Noch keine Downloads.')}</section>
  <section class="panel"><h2>Zugriffs- und Ereignisprotokoll</h2><div class="tbl-wrap"><table class="tbl tbl-compact"><thead><tr><th>Zeit</th><th>Ereignis</th><th>Person</th><th>Details</th></tr></thead><tbody>${[...audit].reverse().slice(0, 300).map((a) => html`<tr><td>${fmtDateTime(a.at)}</td><td>${a.event}</td><td>${a.actorName}</td><td class="small">${Object.entries(a).filter(([k]) => !['id', 'at', 'event', 'actor', 'actorName'].includes(k)).map(([k, v]) => `${k}: ${v}`).join(' · ')}</td></tr>`)}</tbody></table></div></section>`;
}
export function admin({ s, users, grants, projects, spvs, msg }) {
  const pById = Object.fromEntries(projects.map((p) => [p.id, p]));
  const ext = users.filter((x) => ['investor', 'kommune', 'technik'].includes(x.role));
  return html`${msg ? html`<div class="notice" role="status">${msg}</div>` : ''}
<section class="panel"><h2>Konten und Rollen</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Person</th><th>Rolle</th><th>MFA</th><th>Projektzugriffe</th><th>Status</th></tr></thead><tbody>
${users.map((x) => html`<tr><td data-l="Person"><strong>${x.name}</strong><br><span class="muted small">${x.email}</span></td><td data-l="Rolle">${ROLES[x.role].label}</td><td data-l="MFA">${x.mfa ? html`${x.totp ? 'eingerichtet' : html`<span class="mark mark-warn">Einrichtung offen</span>`}${x.totp ? html`<form method="post" action="/portal/admin/mfa-zuruecksetzen" class="inline-form"><input type="hidden" name="_csrf" value="${s.csrf}"><input type="hidden" name="userId" value="${x.id}"><button class="btn btn-small" type="submit">Zurücksetzen</button></form>` : ''}` : html`<span class="muted">nicht erforderlich</span>`}</td><td data-l="Zugriffe" class="small">${grants.filter((g) => g.userId === x.id).map((g) => html`<span class="chip">${pById[g.projectId]?.code} · ${g.scope}<form method="post" action="/portal/admin/zugriff/${g.id}/entziehen"><input type="hidden" name="_csrf" value="${s.csrf}"><button type="submit" aria-label="Zugriff ${pById[g.projectId]?.code} entziehen">×</button></form></span>`)}${x.role === 'projektleitung' ? (x.projects || []).map((id) => pById[id]?.code).join(', ') : ''}${x.role.startsWith('vertrieb_') ? 'regionsbezogen' : ''}${x.role === 'eigentuemer' ? 'über eigene Grundstücke' : ''}${x.role === 'admin' ? 'alle' : ''}</td><td data-l="Status">${x.active ? html`aktiv<form method="post" action="/portal/admin/passwort-neu" class="inline-form"><input type="hidden" name="_csrf" value="${s.csrf}"><input type="hidden" name="userId" value="${x.id}"><button class="btn btn-small" type="submit">Passwort neu vergeben</button></form>` : 'gesperrt'}</td></tr>`)}
<tr><td><strong>Vertriebskoordination Süd</strong></td><td>${ROLES.vertrieb_sued.label}</td><td>–</td><td class="small">regionsbezogen</td><td><span class="mark mark-warn">nicht besetzt</span></td></tr>
</tbody></table></div></section>
<section class="grid-2">
<div class="panel"><h2>Projektzugriff freischalten</h2>
<form method="post" action="/portal/admin/zugriff" class="stack"><input type="hidden" name="_csrf" value="${s.csrf}">
<label for="g-user">Konto</label><select id="g-user" name="userId">${ext.map((x) => html`<option value="${x.id}">${x.name} (${ROLES[x.role].label})</option>`)}</select>
<label for="g-proj">Projekt</label><select id="g-proj" name="projectId">${projects.map((p) => html`<option value="${p.id}">${p.code} – ${p.name}</option>`)}</select>
<button class="btn btn-primary" type="submit">Freischalten</button><p class="small muted">Der Zugriff gilt nur für den Bereich der Rolle (Investor → Datenraum, Kommune → kommunale Unterlagen, Technik → technische Unterlagen).</p></form></div>
<div class="panel"><h2>Benutzer anlegen und verwalten</h2><p>Neue Benutzer, Rollen, Projektrechte, Sperren und Einladungen verwalten Sie unter <a href="/portal/admin/benutzer">Benutzer &amp; Berechtigungen</a>.</p><p><a class="btn btn-primary" href="/portal/admin/benutzer/neu">Neuen Benutzer einladen</a></p></div>
</section>
<section class="panel"><h2>Projektgesellschaften</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Gesellschaft</th><th>Rechtlicher Status</th><th>Projekte</th><th>Hinweis</th></tr></thead><tbody>${spvs.map((x) => html`<tr><td data-l="Gesellschaft">${x.name}</td><td data-l="Status">${statusMark(x.legalStatus)}</td><td data-l="Projekte">${projects.filter((p) => p.spvId === x.id).map((p) => p.code).join(', ')}</td><td data-l="Hinweis" class="small">${x.note}</td></tr>`)}</tbody></table></div></section>`;
}
export function ki() {
  const fns = [['Dokumentenklassifizierung', 'Vorschlag für Kategorie, Projekt und Bereich beim Upload'], ['Zusammenfassung von Gutachten', 'Kurzfassung mit Quellenangabe für interne Nutzung'], ['Prüfung fehlender Unterlagen', 'Abgleich gegen Phasen-Checkliste je Projekt'], ['Entwurf von Statusmeldungen', 'Entwurf für Eigentümer- oder Investoren-Update, Versand nur nach Freigabe'], ['Vertragsdatenübernahme', 'Eckdaten aus unterzeichneten Verträgen als Vorschlag, Übernahme nach Prüfung'], ['Fristenkontrolle', 'Hinweise auf Options-, Verlängerungs- und Behördenfristen'], ['Standortbewertung', 'Vorbewertung nach Netznähe, Fläche und Restriktionen'], ['Investorenberichte', 'Berichtsentwurf aus freigegebenen Daten'], ['Wissenssuche', 'Suche über freigegebene Projektunterlagen im Rahmen der eigenen Rechte']];
  return html`<section class="panel"><p><span class="mark mark-warn">vorbereitet, nicht aktiv</span></p><p>Die Plattform ist für KI-gestützte Funktionen vorbereitet. Jede Funktion arbeitet nur mit den Daten, die die anfragende Person ohnehin sehen darf, und erzeugt ausschließlich Entwürfe oder Vorschläge.</p>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Funktion</th><th>Wirkung</th><th>Status</th></tr></thead><tbody>${fns.map(([a, b]) => html`<tr><td data-l="Funktion">${a}</td><td data-l="Wirkung">${b}</td><td data-l="Status"><span class="muted">nicht aktiviert</span></td></tr>`)}</tbody></table></div>
  <h2 class="mt">Leitplanken</h2><ul class="assume"><li>Keine rechtlich verbindlichen Zusagen, keine Genehmigungsbehauptungen</li><li>Keine Veröffentlichung oder Versand ohne nachvollziehbare Freigabe im Freigabe-Modul</li><li>Änderungen an Vertragsdaten nur nach Bestätigung durch berechtigte Person</li><li>Administrative Verantwortung: Plattformadministration</li></ul></section>`;
}
