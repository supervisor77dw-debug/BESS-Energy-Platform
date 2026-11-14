// Operativer Arbeitsleitstand (AW-STROMKAI-20261031-CONSOLIDATION-ACQUISITION-020, Folgeauftrag UX/Workflow).
// - Portalbenachrichtigungen (db.benachrichtigungen) mit Entdoppelung über einen fachlichen Schlüssel, dauerhaft dokumentiert;
//   je Benachrichtigung ein ehrlicher Outbox-Eintrag (src/lib/mail.mjs, Versand nicht aktiv).
// - Eingangsprozess für Anfragen (nächste Aktion, Historie, Zuständigkeit, Benachrichtigung; Erstkontakt-SLA nur konfigurierbar).
// - Aufgaben: Zuständigkeit verpflichtend, bewusste Ausnahme nur über die Zuordnungswarteschlange, Historie je Aufgabe.
// - Persönliche Arbeitsübersicht je vorhandener Rolle und Gesamtüberblick für die Administration.
// Rechte: ausschließlich über policy.mjs (bestehende Rollen und Projektzuordnungen); keine neuen Rechte, keine Rechteausweitung.
import { html, raw, fmtDate, fmtDateTime } from '../lib/html.mjs';
import { getDb, persist, newId, now, audit } from '../lib/store.mjs';
import { redirect } from '../lib/http.mjs';
import * as P from '../lib/policy.mjs';
import { inOutbox, mailKonfig, STATUS_TEXT } from '../lib/mail.mjs';
import { istOffen, statusVon, faellig, kennung, STATUS as ANFRAGE_STATUS } from './akquise.mjs';

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const notFound = () => new HttpError(404, 'Nicht gefunden');
const heute = () => new Date().toISOString().slice(0, 10);
const nameVon = (db, id) => db.users.find((x) => x.id === id)?.name || '–';
const aktiveMitRolle = (db, rolle) => db.users.filter((x) => x.active && P.rolesOf(x).includes(rolle));
const empty = (t) => html`<p class="muted">${t}</p>`;

// ---------- Benachrichtigungen ----------
// Ein Ereignis erzeugt je Empfänger höchstens eine Benachrichtigung (Schlüssel art:ref:empfänger) – auch bei wiederholter Verarbeitung.
export function benachrichtigen(db, { userId, art, ref, text, href, schluessel }) {
  db.benachrichtigungen ??= [];
  const u = db.users.find((x) => x.id === userId && x.active);
  if (!u) return null;
  const key = schluessel || `${art}:${ref}:${userId}`;
  if (db.benachrichtigungen.some((n) => n.schluessel === key)) return null;
  const n = { id: newId('bn'), schluessel: key, userId, art, ref, text: String(text).slice(0, 300), href, at: now(), gelesenAm: null };
  db.benachrichtigungen.push(n);
  inOutbox(db, n);
  return n;
}
export const ungeleseneBenachrichtigungen = (db, u) => (db.benachrichtigungen || []).filter((n) => n.userId === u.id && !n.gelesenAm);

// ---------- Erstkontakt-SLA (Geschäftsregel, zur Entscheidung vorgelegt – standardmäßig AUS) ----------
// BESS_SLA_ERSTKONTAKT_TAGE = Kalendertage bis zur ersten Wiedervorlage (1–30). Ohne Wert wird keine Frist gesetzt.
export function slaTage(env = process.env) {
  const n = Number(env.BESS_SLA_ERSTKONTAKT_TAGE);
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : null;
}

// ---------- Eingang einer Anfrage (nach regionZuordnen; idempotent) ----------
export const ERSTE_AKTION = 'Anfrage prüfen und Erstkontakt aufnehmen';
export function anfrageEingang(db, i) {
  if (i.eingangVerarbeitet) return; // wiederholte Verarbeitung erzeugt nichts doppelt
  i.eingangVerarbeitet = now();
  i.nextAction ||= ERSTE_AKTION;
  const sla = slaTage();
  if (!i.followUp && sla) i.followUp = new Date(Date.parse(i.at) + sla * 864e5).toISOString().slice(0, 10);
  (i.log ??= []).push({ at: i.at, by: null, byName: 'System', text: `Eingang ${kennung(i)} · Status neu · nächste Aktion: ${i.nextAction}${i.followUp ? ` · Wiedervorlage ${fmtDate(i.followUp)} (Erstkontakt-SLA ${sla} Tage)` : ''}${i.assignee ? '' : ' · noch nicht zugewiesen (Zuordnungswarteschlange)'}` });
  const art = i.kind === 'flaeche' ? 'Flächenanfrage' : 'Kontaktanfrage';
  if (i.assignee) benachrichtigen(db, { userId: i.assignee, art: 'anfrage_zugewiesen', ref: i.id, text: `Neue ${art} ${kennung(i)} ist Ihnen zugewiesen: ${i.name}${i.lage ? `, ${i.lage}` : ''}`, href: `/portal/anfragen/${i.id}` });
  else for (const a of aktiveMitRolle(db, 'admin')) benachrichtigen(db, { userId: a.id, art: 'anfrage_unzugewiesen', ref: i.id, text: `Neue ${art} ${kennung(i)} ohne Zuständigkeit – bitte zuweisen`, href: `/portal/anfragen/${i.id}` });
}
// Zuständigkeitswechsel (Bearbeitung, Schnellübernahme)
export function zuweisungMelden(db, i, von) {
  if (i.assignee && i.assignee !== von?.id) benachrichtigen(db, { userId: i.assignee, art: 'anfrage_zugewiesen', ref: i.id, text: `Anfrage ${kennung(i)} wurde Ihnen von ${von?.name || 'System'} zugewiesen`, href: `/portal/anfragen/${i.id}` });
}

// ---------- Nachrichten: Gelesen-Status und Benachrichtigung ----------
const gelesenId = (userId, key) => `gl-${userId}-${key}`;
export function alsGelesen(db, u, key) {
  db.gelesen ??= [];
  const id = gelesenId(u.id, key);
  const g = db.gelesen.find((x) => x.id === id);
  if (g) g.at = now(); else db.gelesen.push({ id, userId: u.id, threadKey: key, at: now() });
}
export function ungelesenIn(db, u, thread) {
  const g = (db.gelesen || []).find((x) => x.id === gelesenId(u.id, thread.key));
  return thread.messages.filter((m) => m.fromUserId !== u.id && (!g || m.at > g.at)).length;
}
export function nachrichtMelden(db, m, absender) {
  const p = db.projects.find((x) => x.id === m.projectId);
  const [, extId] = m.threadKey.split(':');
  let empf;
  if (absender.id === extId) {
    // externe Person schreibt: zuständige interne Personen des Projekts (Projektverantwortung, Kontaktverantwortung), sonst Administration
    empf = [...new Set([p?.responsible, ...db.contacts.filter((c) => (c.projectIds || []).includes(m.projectId)).map((c) => c.owner)].filter(Boolean))];
    if (!empf.length) empf = aktiveMitRolle(db, 'admin').map((x) => x.id);
  } else empf = [extId];
  for (const id of empf.filter((x) => x !== absender.id)) benachrichtigen(db, { userId: id, art: 'nachricht', ref: m.id, text: `Neue Nachricht von ${absender.name} zu ${p?.name || 'Projekt'}`, href: `/portal/nachrichten?t=${encodeURIComponent(m.threadKey)}` });
}
export function freigabeMelden(db, a, von) {
  for (const x of aktiveMitRolle(db, 'admin').filter((x) => x.id !== von.id)) benachrichtigen(db, { userId: x.id, art: 'freigabe_offen', ref: a.id, text: `Freigabe beantragt von ${von.name}: ${a.note || a.kind}`, href: '/portal/freigaben' });
}

// ---------- Aufgaben ----------
const offenAufgabe = (t) => t.status !== 'erledigt';
const ueberfaellig = (t) => offenAufgabe(t) && t.due && t.due < heute();
function aufgabeLog(t, u, text) { (t.log ??= []).push({ at: now(), by: u?.id ?? null, byName: u?.name ?? 'System', text }); }
export function aufgabeZuweisen(db, t, assignee, u) {
  t.assignee = assignee; delete t.warteschlange;
  aufgabeLog(t, u, `Zuständig: ${nameVon(db, assignee)}`);
  if (assignee !== u.id) benachrichtigen(db, { userId: assignee, art: 'aufgabe_zugewiesen', ref: `${t.id}:${t.log.length}`, text: `Aufgabe zugewiesen: ${t.title} (Frist ${fmtDate(t.due)})`, href: '/portal/aufgaben?f=meine' });
}

function aufgabenSicht({ db, s, u, tasks, projects, filter }) {
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
  const intern = db.users.filter((x) => x.active && P.isInternal(x));
  const sichten = { offen: tasks.filter(offenAufgabe), meine: tasks.filter((t) => offenAufgabe(t) && t.assignee === u.id), ueberfaellig: tasks.filter(ueberfaellig), unzugewiesen: tasks.filter((t) => offenAufgabe(t) && !t.assignee), alle: tasks };
  const liste = [...sichten[filter]].sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  const tab = (k, t) => html`<a href="/portal/aufgaben?f=${k}"${filter === k ? raw(' aria-current="true"') : ''}>${t} (${sichten[k].length})</a>`;
  const herkunft = (t) => { const i = t.inquiryId && db.inquiries.find((x) => x.id === t.inquiryId); return i ? html`<br><a class="small" href="/portal/anfragen/${i.id}">aus ${kennung(i)}</a>` : ''; };
  return html`${sichten.unzugewiesen.length ? html`<div class="alert" role="status"><strong>${sichten.unzugewiesen.length} Aufgabe(n) ohne Zuständigkeit</strong> – <a href="/portal/aufgaben?f=unzugewiesen">Zuordnungswarteschlange öffnen</a></div>` : ''}
<section class="panel"><div class="panel-head"><h2>Aufgaben</h2><nav class="seg" aria-label="Filter">${tab('meine', 'Meine')}${tab('ueberfaellig', 'Überfällig')}${tab('unzugewiesen', 'Nicht zugewiesen')}${tab('offen', 'Alle offenen')}${tab('alle', 'Alle')}</nav></div>
${liste.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Frist</th><th>Aufgabe / nächste Aktion</th><th>Projekt</th><th>Zuständig</th><th>Status</th><th><span class="sr">Aktion</span></th></tr></thead><tbody>${liste.map((t) => html`<tr>
  <td data-l="Frist" class="${ueberfaellig(t) ? 'bad' : ''}">${fmtDate(t.due)}${ueberfaellig(t) ? html`<br><span class="mark mark-warn">überfällig</span>` : ''}</td>
  <td data-l="Aufgabe">${t.title}${herkunft(t)}${t.log?.length ? html`<br><span class="small muted">${t.log.at(-1).text} · ${fmtDateTime(t.log.at(-1).at)}</span>` : ''}</td>
  <td data-l="Projekt">${byId[t.projectId] ? html`<a href="/portal/projekte/${t.projectId}">${byId[t.projectId].code}</a>` : '–'}</td>
  <td data-l="Zuständig">${t.assignee ? nameVon(db, t.assignee) : html`<span class="mark mark-warn">nicht zugewiesen</span>`}</td>
  <td data-l="Status">${t.status}</td>
  <td>${offenAufgabe(t) ? html`<div class="row-actions">${t.assignee ? '' : html`<form method="post" action="/portal/aufgaben/${t.id}/zuweisen" class="row-actions"><input type="hidden" name="_csrf" value="${s.csrf}"><label class="sr" for="zw-${t.id}">Zuständig</label><select id="zw-${t.id}" name="assignee" required><option value="">wählen …</option>${intern.map((x) => html`<option value="${x.id}">${x.name}</option>`)}</select><button class="btn btn-small">Zuweisen</button></form>`}<form method="post" action="/portal/aufgaben/${t.id}/erledigt"><input type="hidden" name="_csrf" value="${s.csrf}"><button class="btn btn-small">Erledigt</button></form></div>` : html`<span class="small muted">${t.doneBy ? `${nameVon(db, t.doneBy)} · ${fmtDate(t.doneAt)}` : ''}</span>`}</td></tr>`)}</tbody></table></div>` : empty('Keine Aufgaben in dieser Ansicht.')}
</section>
<section class="panel"><h2>Neue Aufgabe</h2>
<form method="post" action="/portal/aufgaben/neu" class="stack stack-wide"><input type="hidden" name="_csrf" value="${s.csrf}">
  <label for="na-p">Projekt</label><select id="na-p" name="projectId" required>${projects.map((p) => html`<option value="${p.id}">${p.code} · ${p.name}</option>`)}</select>
  <label for="na-t">Aufgabe / nächste Aktion</label><input id="na-t" name="title" required maxlength="200">
  <label for="na-d">Frist</label><input id="na-d" name="due" type="date" required>
  <label for="na-a">Zuständig</label><select id="na-a" name="assignee"><option value="">bitte wählen</option>${intern.map((x) => html`<option value="${x.id}"${x.id === u.id ? raw(' selected') : ''}>${x.name}</option>`)}</select>
  <label class="check"><input type="checkbox" name="warteschlange" value="ja"> Bewusst ohne Zuständigkeit in die Zuordnungswarteschlange</label>
  <button class="btn btn-primary" type="submit">Aufgabe anlegen</button>
  <p class="small muted">Eine Zuständigkeit ist Pflicht. Ohne Zuständigkeit landet die Aufgabe sichtbar in der Zuordnungswarteschlange.</p>
</form></section>`;
}

// ---------- Persönliche Arbeitsübersicht (je vorhandener Rolle) ----------
const zeile = (href, titel, sub, warn) => html`<li><a href="${href}"><strong>${titel}</strong></a>${sub ? html`<br><span class="small ${warn ? 'bad' : 'muted'}">${sub}</span>` : ''}</li>`;
const liste = (eintraege, leer) => eintraege.length ? html`<ul class="assume worklist">${eintraege.slice(0, 8)}</ul>${eintraege.length > 8 ? html`<p class="small muted">und ${eintraege.length - 8} weitere</p>` : ''}` : empty(leer);
const anfrageZeile = (i) => zeile(`/portal/anfragen/${i.id}`, `${kennung(i)} · ${i.name}`, `${statusVon(i)} · ${i.nextAction || 'keine nächste Aktion'}${i.followUp ? ` · Wiedervorlage ${fmtDate(i.followUp)}` : ''}`, faellig(i));

export function arbeitsbereich(db, u) {
  if (!P.isInternal(u)) return '';
  const rollen = P.rolesOf(u);
  const regionen = rollen.map((r) => P.ROLES[r].region).filter(Boolean);
  const anfragen = db.inquiries.filter((i) => !i.anonymisiert);
  const meine = anfragen.filter((i) => istOffen(i) && i.assignee === u.id);
  const neu = anfragen.filter((i) => statusVon(i) === 'neu' && (i.assignee === u.id || (!i.assignee && (P.isAdmin(u) || !i.region || regionen.includes(i.region)))));
  const unzugewiesen = anfragen.filter((i) => istOffen(i) && !i.assignee && (P.isAdmin(u) || regionen.includes(i.region) || (regionen.length && !i.region)));
  const tasks = P.listTasks(u);
  const meineAufgaben = tasks.filter((t) => offenAufgabe(t) && t.assignee === u.id);
  const ueberf = [...meine.filter(faellig).map((i) => ({ t: 'a', i })), ...meineAufgaben.filter(ueberfaellig).map((t) => ({ t: 'g', x: t }))];
  const heuteFaellig = meineAufgaben.filter((t) => t.due === heute());
  const bn = ungeleseneBenachrichtigungen(db, u);
  const projekte = P.listProjects(u);
  const byId = Object.fromEntries(projekte.map((p) => [p.id, p]));
  const entscheidungen = P.isAdmin(u) ? db.approvals.filter((a) => a.state === 'offen' && a.requestedBy !== u.id) : db.approvals.filter((a) => a.state === 'offen' && a.requestedBy === u.id);
  const kopf = html`<section class="kpis" aria-label="Was liegt bei mir?">
  <a class="kpi" href="/portal/benachrichtigungen"><span class="kpi-v">${bn.length}</span><span class="kpi-l">ungelesene Benachrichtigungen</span></a>
  <a class="kpi" href="/portal/anfragen?f=meine"><span class="kpi-v">${meine.length}</span><span class="kpi-l">meine offenen Anfragen</span></a>
  <a class="kpi" href="/portal/aufgaben?f=meine"><span class="kpi-v">${meineAufgaben.length}</span><span class="kpi-l">meine offenen Aufgaben${heuteFaellig.length ? html` · ${heuteFaellig.length} heute` : ''}</span></a>
  <a class="kpi" href="/portal/aufgaben?f=ueberfaellig"><span class="kpi-v${ueberf.length ? ' bad' : ''}">${ueberf.length}</span><span class="kpi-l">überfällig (Wiedervorlagen und Aufgaben)</span></a>
  <a class="kpi" href="/portal/freigaben"><span class="kpi-v">${entscheidungen.length}</span><span class="kpi-l">${P.isAdmin(u) ? 'Entscheidungen offen' : 'eigene Freigabeanträge offen'}</span></a>
</section>`;
  const teile = [];
  if (rollen.some((r) => r.startsWith('vertrieb')) || P.isAdmin(u)) {
    const termine = P.listAppointments(u).filter((a) => a.at >= now()).sort((a, b) => a.at.localeCompare(b.at));
    const eigeneProjekte = projekte.filter((p) => p.responsible === u.id || db.contacts.some((c) => c.owner === u.id && (c.projectIds || []).includes(p.id)));
    teile.push(html`<section class="grid-2">
  <div class="panel"><h2>Neue Anfragen und Erstkontakte</h2>${liste(neu.map(anfrageZeile), 'Keine neuen Anfragen.')}</div>
  <div class="panel"><h2>Meine offenen Anfragen</h2>${liste(meine.map(anfrageZeile), 'Keine offenen Anfragen.')}</div>
</section>
<section class="grid-2">
  <div class="panel"><h2>Nicht zugewiesen${P.isAdmin(u) ? '' : ' (meine Region)'}</h2>${liste(unzugewiesen.map(anfrageZeile), 'Alle Anfragen sind zugewiesen.')}</div>
  <div class="panel"><h2>Eigene Projekte</h2>${liste(eigeneProjekte.map((p) => zeile(`/portal/projekte/${p.id}`, `${p.code} · ${p.name}`, p.contractStatus)), 'Keine eigenen Projekte.')}<p class="small muted">Nächster Termin: ${termine[0] ? `${fmtDateTime(termine[0].at)} · ${termine[0].title}` : 'keiner'} (alle Termine weiter unten)</p></div>
</section>`);
  }
  if (rollen.includes('projektleitung') || P.isAdmin(u)) {
    const plIds = P.internalProjectIds(u);
    const plProjekte = projekte.filter((p) => plIds.has(p.id));
    const offenePA = tasks.filter((t) => offenAufgabe(t) && plIds.has(t.projectId)).sort((a, b) => (a.due || '').localeCompare(b.due || ''));
    const entwuerfe = db.documents.filter((d) => plIds.has(d.projectId) && d.status !== 'freigegeben');
    teile.push(html`<section class="panel"><h2>Projektleitstand</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Projekt</th><th>Netzanschluss</th><th>Genehmigung</th><th>Risiken</th><th>Offene Aufgaben</th></tr></thead><tbody>${plProjekte.map((p) => { const ot = offenePA.filter((t) => t.projectId === p.id); return html`<tr><td data-l="Projekt"><a href="/portal/projekte/${p.id}"><strong>${p.code}</strong></a><br><span class="small muted">${p.name}</span></td><td data-l="Netzanschluss">${p.gridStatus}</td><td data-l="Genehmigung">${p.permitStatus}</td><td data-l="Risiken" class="small">${(p.risks || []).join('; ') || '–'}</td><td data-l="Offene Aufgaben">${ot.length}${ot.some(ueberfaellig) ? html` <span class="mark mark-warn">überfällig</span>` : ''}${ot.some((t) => !t.assignee) ? html` <span class="mark mark-warn">ohne Zuständigkeit</span>` : ''}</td></tr>`; })}</tbody></table></div>
<div class="grid-2 mt"><div><h3>Überfällige Maßnahmen</h3>${liste(offenePA.filter(ueberfaellig).map((t) => zeile(`/portal/projekte/${t.projectId}`, t.title, `${byId[t.projectId]?.code || ''} · Frist ${fmtDate(t.due)} · ${t.assignee ? nameVon(db, t.assignee) : 'nicht zugewiesen'}`, true)), 'Keine überfälligen Maßnahmen.')}</div>
<div><h3>Unterlagen noch nicht freigegeben</h3>${liste(entwuerfe.map((d) => zeile(`/portal/projekte/${d.projectId}`, d.title, `${byId[d.projectId]?.code || ''} · ${d.status}`)), 'Alle Unterlagen freigegeben.')}</div></div></section>`);
  }
  return html`<section class="panel worktop"><h2>Mein Arbeitsbereich</h2><p class="small muted">Was liegt bei mir, was ist heute fällig, was ist überfällig, wo ist eine Entscheidung nötig. E-Mail-Benachrichtigungen: ${mailKonfig().aktiv ? 'aktiv' : 'nicht eingerichtet – Hinweise erscheinen nur im Portal'}.</p></section>${kopf}${teile}`;
}

// Gesamtüberblick der Administration (Zentrale)
export function gesamtueberblick(db, u) {
  if (!P.isAdmin(u)) return '';
  const anfragen = db.inquiries.filter((i) => !i.anonymisiert);
  const regionen = [['nord', 'Nord'], ['sued', 'Süd'], ['', 'ohne Region']];
  const status = ANFRAGE_STATUS;
  const tasks = P.listTasks(u).filter(offenAufgabe);
  const verantw = [...new Set(tasks.map((t) => t.assignee || ''))].map((id) => [id, tasks.filter((t) => (t.assignee || '') === id)]).sort((a, b) => b[1].length - a[1].length);
  const offeneFreigaben = db.approvals.filter((a) => a.state === 'offen');
  const projekte = P.listProjects(u);
  return html`<section class="panel"><div class="panel-head"><h2>Gesamtüberblick Vertrieb und Projekte</h2><a class="btn btn-small" href="/portal/anfragen?f=alle">Alle Anfragen</a></div>
<div class="tbl-wrap"><table class="tbl tbl-compact"><thead><tr><th>Region</th>${status.map((s) => html`<th class="num">${s}</th>`)}</tr></thead><tbody>${regionen.map(([r, l]) => html`<tr><td data-l="Region">${l}</td>${status.map((s) => { const n = anfragen.filter((i) => (i.region || '') === r && statusVon(i) === s).length; return html`<td data-l="${s}" class="num">${n || '–'}</td>`; })}</tr>`)}</tbody></table></div>
<div class="grid-2 mt"><div><h3>Offene Aufgaben je Verantwortlichem</h3>${liste(verantw.map(([id, ts]) => zeile(id ? '/portal/aufgaben?f=offen' : '/portal/aufgaben?f=unzugewiesen', id ? nameVon(db, id) : 'Nicht zugewiesen', `${ts.length} offen${ts.filter(ueberfaellig).length ? ` · ${ts.filter(ueberfaellig).length} überfällig` : ''}`, !id || ts.some(ueberfaellig))), 'Keine offenen Aufgaben.')}</div>
<div><h3>Ausstehende Freigaben und Projektrisiken</h3>${liste([...offeneFreigaben.map((a) => zeile('/portal/freigaben', a.note || a.kind, `beantragt von ${nameVon(db, a.requestedBy)} · ${fmtDate(a.at)}`)), ...projekte.filter((p) => p.risks?.length).map((p) => zeile(`/portal/projekte/${p.id}`, `${p.code}: ${p.risks.length} Risiko(en)`, p.risks[0]))], 'Keine offenen Freigaben oder Risiken.')}</div></div>
<p class="small muted">Pipeline nach Entwicklungsphase: <a href="/portal/pipeline">Pipeline</a>. Wirtschaftliche Kennzahlen: unten unter „Kennzahlen“ mit Erläuterung.</p></section>`;
}

// ---------- Benachrichtigungsseite ----------
function benachrichtigungenSicht(db, u, s) {
  const eigene = (db.benachrichtigungen || []).filter((n) => n.userId === u.id).sort((a, b) => b.at.localeCompare(a.at));
  const ob = Object.fromEntries((db.outbox || []).map((o) => [o.benachrichtigungId, o]));
  const k = mailKonfig();
  return html`<section class="panel"><div class="panel-head"><h2>Benachrichtigungen</h2>${eigene.some((n) => !n.gelesenAm) ? html`<form method="post" action="/portal/benachrichtigungen/gelesen"><input type="hidden" name="_csrf" value="${s.csrf}"><button class="btn btn-small">Alle als gelesen markieren</button></form>` : ''}</div>
<p class="small muted">E-Mail: ${k.aktiv ? 'Versandweg aktiv' : html`<strong>nicht eingerichtet</strong> – es werden keine E-Mails versandt. Hinweise erscheinen ausschließlich hier im Portal.`}</p>
${eigene.length ? html`<ul class="timeline">${eigene.map((n) => html`<li${n.gelesenAm ? '' : raw(' class="unread"')}><span class="date">${fmtDateTime(n.at)}${n.gelesenAm ? '' : html` · <span class="mark mark-info">neu</span>`}</span><p><a href="${n.href}">${n.text}</a><br><span class="small muted">${STATUS_TEXT[ob[n.id]?.status] || ''}</span></p></li>`)}</ul>` : empty('Keine Benachrichtigungen.')}</section>
${P.isAdmin(u) ? html`<section class="panel"><h2>Versandprotokoll (Outbox)</h2><p class="small muted">Konfiguration nur über Umgebungsvariablen; fehlend: ${k.fehlend.join(', ') || '–'}. Einträge mit „nicht eingerichtet“ werden nie nachträglich versandt.</p>
<div class="tbl-wrap"><table class="tbl tbl-compact"><thead><tr><th>Erstellt</th><th>Empfänger</th><th>Betreff</th><th>Status</th><th class="num">Versuche</th><th>Letzter Fehler</th></tr></thead><tbody>${[...(db.outbox || [])].reverse().slice(0, 50).map((o) => html`<tr><td data-l="Erstellt">${fmtDateTime(o.erstelltAm)}</td><td data-l="Empfänger">${nameVon(db, o.empfaengerId)}</td><td data-l="Betreff" class="small">${o.betreff}</td><td data-l="Status">${STATUS_TEXT[o.status]}</td><td data-l="Versuche" class="num">${o.versuche}</td><td data-l="Fehler" class="small">${o.letzterFehler || '–'}</td></tr>`)}</tbody></table></div></section>` : ''}`;
}

// ---------- Routen ----------
export async function handleArbeit({ res, path, method, u, s, view, post, url }) {
  const db = getDb();
  if (path === '/portal/benachrichtigungen') {
    if (method === 'GET') return view('Benachrichtigungen', benachrichtigungenSicht(db, u, s), 'Portalhinweise und Versandstatus');
    throw notFound();
  }
  if (path === '/portal/benachrichtigungen/gelesen' && method === 'POST') {
    await post();
    for (const n of ungeleseneBenachrichtigungen(db, u)) n.gelesenAm = now();
    persist();
    return redirect(res, '/portal/benachrichtigungen');
  }
  if (!path.startsWith('/portal/aufgaben')) return null;
  if (!P.isInternal(u)) throw notFound();
  if (path === '/portal/aufgaben' && method === 'GET') {
    const f = ['meine', 'ueberfaellig', 'unzugewiesen', 'offen', 'alle'].includes(url.searchParams.get('f')) ? url.searchParams.get('f') : 'meine';
    return view('Aufgaben und Fristen', aufgabenSicht({ db, s, u, tasks: P.listTasks(u), projects: P.listProjects(u).filter((p) => P.internalProjectIds(u).has(p.id)), filter: f }), 'Zuständigkeit, Frist und nächste Aktion');
  }
  if (path === '/portal/aufgaben/neu' && method === 'POST') {
    const { fields } = await post();
    const p = P.listProjects(u).find((x) => x.id === fields.projectId && P.internalProjectIds(u).has(x.id));
    const title = String(fields.title || '').trim().slice(0, 200);
    const due = /^\d{4}-\d{2}-\d{2}$/.test(fields.due || '') ? fields.due : null;
    const intern = db.users.filter((x) => x.active && P.isInternal(x));
    const assignee = intern.some((x) => x.id === fields.assignee) ? fields.assignee : null;
    const warteschlange = fields.warteschlange === 'ja';
    if (!p || !title || !due) throw new HttpError(422, 'Projekt, Aufgabe und Frist sind Pflichtangaben.');
    if (!assignee && !warteschlange) throw new HttpError(422, 'Bitte eine zuständige Person wählen oder die Aufgabe bewusst in die Zuordnungswarteschlange geben.');
    const t = { id: newId('t'), projectId: p.id, title, due, assignee: null, status: 'offen', createdBy: u.id, createdAt: now() };
    db.tasks.push(t);
    aufgabeLog(t, u, `Angelegt von ${u.name}`);
    if (assignee) aufgabeZuweisen(db, t, assignee, u);
    else { t.warteschlange = true; aufgabeLog(t, u, 'Bewusst ohne Zuständigkeit in die Zuordnungswarteschlange'); for (const a of aktiveMitRolle(db, 'admin').filter((x) => x.id !== u.id)) benachrichtigen(db, { userId: a.id, art: 'aufgabe_unzugewiesen', ref: t.id, text: `Aufgabe ohne Zuständigkeit: ${t.title} (${p.code})`, href: '/portal/aufgaben?f=unzugewiesen' }); }
    persist(); audit('aufgabe_angelegt', u, { aufgabe: t.id, projekt: p.id });
    return redirect(res, assignee ? '/portal/aufgaben?f=offen' : '/portal/aufgaben?f=unzugewiesen');
  }
  const m = /^\/portal\/aufgaben\/([\w-]+)\/(zuweisen|erledigt)$/.exec(path);
  if (m && method === 'POST') {
    const { fields } = await post();
    const t = P.listTasks(u).find((x) => x.id === m[1]);
    if (!t) throw notFound();
    if (m[2] === 'zuweisen') {
      const intern = db.users.filter((x) => x.active && P.isInternal(x));
      if (!intern.some((x) => x.id === fields.assignee)) throw new HttpError(422, 'Bitte eine zuständige Person wählen.');
      aufgabeZuweisen(db, t, fields.assignee, u);
      persist(); audit('aufgabe_zugewiesen', u, { aufgabe: t.id, projekt: t.projectId });
      return redirect(res, '/portal/aufgaben?f=unzugewiesen');
    }
    if (t.status !== 'erledigt') { t.status = 'erledigt'; t.doneBy = u.id; t.doneAt = now(); aufgabeLog(t, u, 'Erledigt'); persist(); audit('aufgabe_erledigt', u, { aufgabe: t.id }); }
    return redirect(res, '/portal/aufgaben');
  }
  throw notFound();
}
