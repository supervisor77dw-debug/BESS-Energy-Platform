// Flächenanfragen → Projektpipeline (AW-STROMKAI-20261031-CONSOLIDATION-ACQUISITION-020).
// Keine eigene Datenbank: Anfragen bleiben in db.inquiries, eine Übernahme legt Kontakt, Standort (db.projects),
// Grundstück (db.parcels) und erste Aufgabe (db.tasks) im bestehenden Projektprozess an.
// Rechte: Bearbeiten alle internen Rollen; Übernahme als Standort Administration (alle Regionen) und Vertrieb der eigenen
// Region – nur wenn der neue Standort für die übernehmende Person ohne Rechteänderung sichtbar ist;
// Löschen (Anonymisieren) nur Administration und nur für abgeschlossene oder abgelehnte Anfragen.
import { html, raw, fmtDate, fmtDateTime } from '../lib/html.mjs';
import { getDb, persist, newId, now, audit, getFile, deleteFile } from '../lib/store.mjs';
import { send, redirect } from '../lib/http.mjs';
import * as P from '../lib/policy.mjs';
import { zuweisungMelden } from './arbeit.mjs';

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const notFound = () => new HttpError(404, 'Nicht gefunden');

export const STATUS = ['neu', 'in Prüfung', 'Rückfrage offen', 'Gespräch vereinbart', 'als Standort übernommen', 'nicht geeignet', 'abgeschlossen'];
const OFFEN = new Set(['neu', 'in Prüfung', 'Rückfrage offen', 'Gespräch vereinbart']);
const LOESCHBAR = new Set(['nicht geeignet', 'abgeschlossen']);
export const ROLLEN = ['Eigentümer/in', 'Miteigentümer/in oder Erbengemeinschaft', 'Bevollmächtigt oder Verwaltung', 'Pächter/in', 'Sonstiges'];
// Bestand vor AW-020 kannte nur „in Bearbeitung“
export const statusVon = (i) => (i.status === 'in Bearbeitung' ? 'in Prüfung' : i.status);
export const istOffen = (i) => OFFEN.has(statusVon(i));
const heute = () => new Date().toISOString().slice(0, 10);
export const faellig = (i) => istOffen(i) && i.followUp && i.followUp <= heute();

// Lesbare, fortlaufende Kennung je Jahr (ANF-2026-0001); ältere Anfragen behalten ihre technische ID
export function naechsteKennung(db, at = now()) {
  const jahr = at.slice(0, 4);
  db.meta.anfrageSeq ??= {};
  db.meta.anfrageSeq[jahr] = (db.meta.anfrageSeq[jahr] || 0) + 1;
  return `ANF-${jahr}-${String(db.meta.anfrageSeq[jahr]).padStart(4, '0')}`;
}
export const kennung = (i) => i.ref || i.id;

// Dublettenprüfung: gleiche E-Mail, Telefonnummer, Flurstücksangabe oder PLZ + Ort in Anfragen, Kontakten und Grundstücken
const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
const ziffern = (v) => String(v || '').replace(/\D/g, '');
const flur = (v) => norm(v).replace(/[^a-z0-9äöüß/]/g, '');
export function dubletten(db, i) {
  const out = [];
  const mail = norm(i.email), tel = ziffern(i.phone), fl = flur(i.flurstueck), ort = i.plz ? `${ziffern(i.plz)}|${norm(i.lage)}` : '';
  for (const x of db.inquiries) {
    if (x.id === i.id || x.anonymisiert) continue;
    const g = [];
    if (mail && norm(x.email) === mail) g.push('E-Mail');
    if (tel.length >= 6 && ziffern(x.phone) === tel) g.push('Telefon');
    if (fl.length >= 3 && flur(x.flurstueck) === fl) g.push('Flurstück');
    if (ort && x.plz && `${ziffern(x.plz)}|${norm(x.lage)}` === ort) g.push('PLZ und Ort');
    if (g.length) out.push({ art: 'Anfrage', id: x.id, text: `${kennung(x)} · ${x.name}`, href: `/portal/anfragen/${x.id}`, gruende: g });
  }
  for (const c of db.contacts) {
    const g = [];
    if (mail && norm(c.email) === mail) g.push('E-Mail');
    if (tel.length >= 6 && ziffern(c.phone) === tel) g.push('Telefon');
    if (g.length) out.push({ art: 'Kontakt', id: c.id, text: c.name, href: '/portal/kontakte', gruende: g });
  }
  if (fl.length >= 3) for (const x of db.parcels) if (flur(`${x.gemarkung} ${x.flur} ${x.flurstueck}`).includes(fl) || flur(x.flurstueck) === fl) out.push({ art: 'Grundstück', id: x.id, text: `${x.gemarkung}, Flur ${x.flur}, Flurstück ${x.flurstueck}`, href: `/portal/projekte/${x.projectId}`, gruende: ['Flurstück'] });
  return out;
}

// Regionale Zuordnung (AW-020 K3): Wählt die anfragende Person eine Region, geht die Anfrage an die regionale
// Vertriebskoordination – nur wenn genau ein aktives Konto diese Rolle hat. Keine Kontaktdaten, nur interne Zuständigkeit.
export const REGIONEN_OEFFENTLICH = ['nord', 'sued'];
export function regionZuordnen(db, i) {
  if (!REGIONEN_OEFFENTLICH.includes(i.region)) return;
  const rolle = `vertrieb_${i.region}`;
  const k = db.users.filter((x) => x.active && P.rolesOf(x).includes(rolle));
  if (k.length !== 1) return;
  i.assignee = k[0].id;
  (i.log ??= []).push({ at: i.at, by: null, byName: 'System', text: `Automatisch zugeordnet nach Region: ${P.ROLES[rolle].label} (${k[0].name})` });
}
const verlauf = (i, u, text) => { (i.log ??= []).push({ at: now(), by: u?.id ?? null, byName: u?.name ?? 'System', text }); };
const REGIONEN = { nord: 'Nord', sued: 'Süd' };
const regionenFuer = (u) => (P.isAdmin(u) ? Object.keys(REGIONEN) : P.rolesOf(u).map((r) => P.ROLES[r].region).filter(Boolean));
const darfUebernehmen = (u) => regionenFuer(u).length > 0;
const intern = (db) => db.users.filter((x) => x.active && P.isInternal(x));
const nameVon = (db, id) => db.users.find((x) => x.id === id)?.name || '–';
const mark = (st) => html`<span class="mark ${st === 'neu' ? 'mark-info' : st === 'als Standort übernommen' ? 'mark-ok' : st === 'nicht geeignet' ? 'mark-aud' : OFFEN.has(st) ? 'mark-warn' : 'mark-aud'}">${st}</span>`;
const empty = (t) => html`<div class="empty"><p><strong>${t}</strong></p></div>`;

// ---------- Ansichten ----------
export function liste({ db, s, u, filter }) {
  const alle = [...db.inquiries].reverse();
  const sichten = { offen: alle.filter(istOffen), meine: alle.filter((i) => istOffen(i) && i.assignee === u?.id), unzugewiesen: alle.filter((i) => istOffen(i) && !i.assignee), faellig: alle.filter(faellig), alle };
  const sicht = sichten[filter] || sichten.offen;
  const n = Object.fromEntries(Object.entries(sichten).map(([k, v]) => [k, v.length]));
  const tab = (k, t) => html`<a href="/portal/anfragen?f=${k}"${filter === k ? raw(' aria-current="true"') : ''}>${t} (${n[k]})</a>`;
  return html`<section class="panel"><div class="panel-head"><p class="small muted">Eingänge aus den öffentlichen Formularen. Aus Anfragen entstehen keine automatischen Angebote. Geeignete Flächen werden als Standort in die Pipeline übernommen.</p>
  <nav class="seg" aria-label="Filter">${tab('meine', 'Meine')}${tab('offen', 'Offen')}${tab('unzugewiesen', 'Nicht zugewiesen')}${tab('faellig', 'Wiedervorlage fällig')}${tab('alle', 'Alle')}</nav></div>
  ${sicht.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Anfrage</th><th>Absender</th><th>Fläche</th><th>Status</th><th>Zuständig</th><th>Nächste Aktion</th><th><span class="sr">Aktion</span></th></tr></thead><tbody>${sicht.map((i) => {
    const d = i.anonymisiert ? [] : dubletten(db, i);
    return html`<tr><td data-l="Anfrage"><strong>${kennung(i)}</strong><br><span class="small muted">${fmtDateTime(i.at)} · ${i.kind === 'flaeche' ? 'Flächenangebot' : `Kontakt: ${i.anliegen}`}</span></td>
    <td data-l="Absender">${i.name}${i.rolle ? html`<br><span class="small muted">${i.rolle}</span>` : ''}${d.length ? html`<br><span class="mark mark-warn" title="${d.map((x) => `${x.art}: ${x.text}`).join('; ')}">mögliche Dublette</span>` : ''}</td>
    <td data-l="Fläche" class="small">${i.kind === 'flaeche' ? html`${[i.plz, i.lage].filter(Boolean).join(' ')}${i.flaeche ? html`<br>${i.flaeche} ha` : ''}${i.nutzung ? ` · ${i.nutzung}` : ''}` : '–'}</td>
    <td data-l="Status">${mark(statusVon(i))}</td>
    <td data-l="Zuständig">${i.assignee ? nameVon(db, i.assignee) : html`<span class="muted">offen</span>`}</td>
    <td data-l="Nächste Aktion" class="small">${i.nextAction || '–'}${i.followUp ? html`<br><span class="${faellig(i) ? 'bad' : 'muted'}">Wiedervorlage ${fmtDate(i.followUp)}</span>` : ''}</td>
    <td><a class="btn btn-small" href="/portal/anfragen/${i.id}">Öffnen</a>${statusVon(i) === 'neu' ? html` <form method="post" action="/portal/anfragen/${i.id}/status" class="inline-form"><input type="hidden" name="_csrf" value="${s.csrf}"><button class="btn btn-small" name="status" value="in Bearbeitung">Übernehmen</button></form>` : ''}</td></tr>`;
  })}</tbody></table></div>` : empty(filter === 'faellig' ? 'Keine fälligen Wiedervorlagen.' : 'Keine Anfragen in dieser Ansicht.')}
  <p class="small muted">Benachrichtigung: Neue Anfragen erscheinen hier und als Kennzahl in der Übersicht. E-Mail-Benachrichtigungen sind nicht eingerichtet (kein freigegebener Versandweg).</p></section>`;
}

export function detail({ db, s, u, i, msg }) {
  const st = statusVon(i);
  const d = i.anonymisiert ? [] : dubletten(db, i);
  const projekt = i.projectId ? db.projects.find((p) => p.id === i.projectId) : null;
  const opt = (v, cur) => html`<option${v === cur ? raw(' selected') : ''}>${v}</option>`;
  const csrf = html`<input type="hidden" name="_csrf" value="${s.csrf}">`;
  return html`${msg ? html`<div class="notice" role="status">${msg}</div>` : ''}
<section class="panel proj-top">
  <div><p class="kicker">${kennung(i)} · Eingang ${fmtDateTime(i.at)}</p><p>${mark(st)}${projekt ? html` · Standort <a href="/portal/projekte/${projekt.id}">${projekt.code} ${projekt.name}</a>` : ''}</p></div>
  <dl class="kv">
    <div><dt>Zuständig</dt><dd>${i.assignee ? nameVon(db, i.assignee) : 'nicht zugeordnet'}</dd></div>
    <div><dt>Nächste Aktion</dt><dd>${i.nextAction || '–'}</dd></div>
    <div><dt>Wiedervorlage</dt><dd${faellig(i) ? raw(' class="bad"') : ''}>${i.followUp ? fmtDate(i.followUp) : '–'}</dd></div>
  </dl>
</section>
${d.length ? html`<section class="panel"><h2>Mögliche Dubletten</h2><p class="small muted">Vor einer Übernahme prüfen. Treffer werden nicht automatisch zusammengeführt.</p><ul class="assume">${d.map((x) => html`<li>${x.art}: <a href="${x.href}">${x.text}</a> <span class="muted small">(${x.gruende.join(', ')})</span></li>`)}</ul></section>` : ''}
<section class="grid-2">
  <div class="panel"><h2>Angaben</h2>${i.anonymisiert ? html`<p class="muted">Personenbezogene Angaben wurden am ${fmtDate(i.anonymisiert)} gelöscht.</p>` : html`<dl class="kv">
    <div><dt>Ansprechpartner</dt><dd>${i.name}${i.rolle ? html`<br><span class="small muted">${i.rolle}</span>` : ''}</dd></div>
    <div><dt>Kontakt</dt><dd>${i.email ? html`<a href="mailto:${i.email}">${i.email}</a>` : ''}${i.email && i.phone ? html`<br>` : ''}${i.phone || ''}</dd></div>
    ${i.region ? html`<div><dt>Region</dt><dd>${i.region === 'nord' ? 'Nord' : 'Süd'}</dd></div>` : ''}
    ${i.kind === 'flaeche' ? html`<div><dt>Standort</dt><dd>${[i.plz, i.lage].filter(Boolean).join(' ') || '–'}</dd></div>
    <div><dt>Gemarkung / Flurstück</dt><dd>${i.flurstueck || '–'}</dd></div>
    <div><dt>Grundstücksgröße</dt><dd>${i.flaeche ? `${i.flaeche} ha` : '–'}</dd></div>
    <div><dt>Aktuelle Nutzung</dt><dd>${i.nutzung || '–'}</dd></div>
    <div><dt>Nähe Umspannwerk</dt><dd>${i.umspannwerk || '–'}</dd></div>
    <div><dt>Unterlage</dt><dd>${i.fileId ? html`<a href="/portal/anfragen/${i.id}/anlage">herunterladen</a>` : '–'}</dd></div>` : html`<div><dt>Anliegen</dt><dd>${i.anliegen}${i.org ? html`<br>${i.org}` : ''}</dd></div>`}
  </dl>${i.nachricht ? html`<h3>Hinweise</h3><p>${i.nachricht}</p>` : ''}`}</div>
  <div class="panel"><h2>Bearbeitung</h2>
  <form method="post" action="/portal/anfragen/${i.id}/bearbeiten" class="stack">${csrf}
    <label for="st">Status</label><select id="st" name="status">${STATUS.filter((x) => x !== 'als Standort übernommen' || st === x).map((x) => opt(x, st))}</select>
    <label for="as">Zuständig</label><select id="as" name="assignee"><option value="">nicht zugeordnet</option>${intern(db).map((x) => html`<option value="${x.id}"${x.id === i.assignee ? raw(' selected') : ''}>${x.name}</option>`)}</select>
    <label for="na">Nächste Aktion</label><input id="na" name="nextAction" maxlength="200" value="${i.nextAction || ''}">
    <label for="fu">Wiedervorlage</label><input id="fu" name="followUp" type="date" value="${i.followUp || ''}">
    <label for="no">Notiz für die Historie <span class="muted small">freiwillig</span></label><textarea id="no" name="note" rows="2" maxlength="1000"></textarea>
    <button class="btn btn-primary" type="submit">Speichern</button>
  </form></div>
</section>
${i.kind === 'flaeche' && !projekt && !i.anonymisiert && darfUebernehmen(u) && OFFEN.has(st) ? html`<section class="panel"><h2>Als Standort übernehmen</h2>
  <p class="small muted">Legt Kontakt, Standort (Phase 1 · Standortidentifikation), Grundstück und eine erste Aufgabe in der bestehenden Projektstruktur an. Keine Projektgesellschaft, kein Vertrag, keine Rechtevergabe.</p>
  <form method="post" action="/portal/anfragen/${i.id}/standort" class="stack stack-inline">${csrf}
    <label for="sn">Standortname</label><input id="sn" name="name" required maxlength="80" value="${[i.lage, i.plz].filter(Boolean).join(' ').slice(0, 80)}">
    <label for="rg">Region</label><select id="rg" name="region">${regionenFuer(u).map((r) => html`<option value="${r}">${REGIONEN[r]}</option>`)}</select>
    ${d.length ? html`<label class="check"><input type="checkbox" name="dublettenGeprueft" value="ja" required> Dubletten geprüft</label>` : ''}
    <button class="btn" type="submit">Standort anlegen</button>
  </form></section>` : ''}
<section class="panel"><h2>Historie</h2>${i.log?.length ? html`<ul class="timeline">${[...i.log].reverse().map((x) => html`<li><span class="date">${fmtDateTime(x.at)} · ${x.byName}</span><p>${x.text}</p></li>`)}</ul>` : html`<p class="muted">Eingegangen ${fmtDateTime(i.at)}. Noch keine Bearbeitung.</p>`}</section>
${P.isAdmin(u) && !i.anonymisiert ? html`<section class="panel"><h2>Löschung</h2>
  <p class="small muted">Löschkonzept (Vorschlag, Datenschutzerklärung im Entwurf): Anfragen ohne Folgekontakt werden nach Abschluss gelöscht. Name, Kontaktdaten, Flurstück, Hinweise und Unterlage werden entfernt; Kennung, Datum, Status und Historie bleiben als Nachweis. Übernommene Standorte sind davon nicht betroffen.</p>
  ${LOESCHBAR.has(st) ? html`<form method="post" action="/portal/anfragen/${i.id}/anonymisieren">${csrf}<button class="btn btn-danger" type="submit">Personenbezogene Angaben löschen</button></form>` : html`<p class="small">Erst möglich, wenn der Status „nicht geeignet“ oder „abgeschlossen“ ist.</p>`}
</section>` : ''}`;
}

// ---------- Routen ----------
export async function handleAkquise({ res, path, method, u, s, view, post, url }) {
  if (!path.startsWith('/portal/anfragen')) return null;
  if (!P.isInternal(u)) throw notFound();
  const db = getDb();
  if (path === '/portal/anfragen' && method === 'GET') {
    const f = ['offen', 'meine', 'unzugewiesen', 'faellig', 'alle'].includes(url.searchParams.get('f')) ? url.searchParams.get('f') : 'offen';
    return view('Anfragen', liste({ db, s, u, filter: f }), 'Flächen- und Kontaktanfragen');
  }
  const m = /^\/portal\/anfragen\/([\w-]+)(?:\/(status|bearbeiten|standort|anonymisieren|anlage))?$/.exec(path);
  if (!m) throw notFound();
  const i = db.inquiries.find((x) => x.id === m[1]);
  if (!i) throw notFound();
  const aktion = m[2];
  if (!aktion && method === 'GET') return view(kennung(i), detail({ db, s, u, i, msg: { gespeichert: 'Gespeichert.', standort: 'Standort angelegt.', geloescht: 'Personenbezogene Angaben gelöscht.' }[url.searchParams.get('m')] }), i.kind === 'flaeche' ? 'Flächenanfrage' : 'Kontaktanfrage');
  if (aktion === 'anlage' && method === 'GET') {
    if (!i.fileId) throw notFound();
    const data = await getFile(i.fileId);
    if (!data) { audit('anfrage_anlage_fehlt', u, { anfrage: i.id }); throw notFound(); } // verwaister Verweis → 404 (R-2)
    audit('anfrage_anlage_abgerufen', u, { anfrage: i.id });
    const ext = i.fileId.split('.').pop();
    res.setHeader('Content-Disposition', `attachment; filename="${kennung(i)}-unterlage.${ext}"`);
    return send(res, 200, data, ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg');
  }
  if (method !== 'POST') throw notFound();
  const { fields } = await post();
  // bisherige Schnellübernahme aus der Liste
  if (aktion === 'status') {
    if (fields.status === 'in Bearbeitung' && statusVon(i) === 'neu') { i.status = 'in Prüfung'; i.assignee ??= u.id; verlauf(i, u, 'Übernommen, Status „in Prüfung“'); zuweisungMelden(db, i, u); persist(); audit('anfrage_uebernommen', u, { anfrage: i.id }); }
    return redirect(res, '/portal/anfragen');
  }
  if (aktion === 'bearbeiten') {
    const aend = [];
    const st = String(fields.status || '');
    if (STATUS.includes(st) && st !== 'als Standort übernommen' && st !== statusVon(i)) { aend.push(`Status ${statusVon(i)} → ${st}`); i.status = st; }
    const as = String(fields.assignee || '');
    if (as !== (i.assignee || '') && (!as || intern(db).some((x) => x.id === as))) { aend.push(`Zuständig: ${as ? nameVon(db, as) : 'nicht zugeordnet'}`); i.assignee = as || null; }
    const na = String(fields.nextAction || '').trim().slice(0, 200);
    if (na !== (i.nextAction || '')) { aend.push(`Nächste Aktion: ${na || '–'}`); i.nextAction = na; }
    const fu = /^\d{4}-\d{2}-\d{2}$/.test(fields.followUp || '') ? fields.followUp : '';
    if (fu !== (i.followUp || '')) { aend.push(`Wiedervorlage: ${fu ? fmtDate(fu) : '–'}`); i.followUp = fu || null; }
    const note = String(fields.note || '').trim().slice(0, 1000);
    if (note) aend.push(`Notiz: ${note}`);
    if (aend.length) { verlauf(i, u, aend.join(' · ')); if (aend.some((x) => x.startsWith('Zuständig:'))) zuweisungMelden(db, i, u); persist(); audit('anfrage_bearbeitet', u, { anfrage: i.id }); }
    return redirect(res, `/portal/anfragen/${i.id}?m=gespeichert`);
  }
  if (aktion === 'standort') {
    if (!darfUebernehmen(u) || i.kind !== 'flaeche' || i.projectId || i.anonymisiert || !istOffen(i)) throw new HttpError(403, 'Übernahme nicht möglich.');
    if (dubletten(db, i).length && fields.dublettenGeprueft !== 'ja') throw new HttpError(422, 'Bitte bestätigen Sie die Dublettenprüfung.');
    const region = String(fields.region || '');
    if (!regionenFuer(u).includes(region)) throw new HttpError(403, 'Übernahme nur für die eigene Region.');
    const name = String(fields.name || '').trim().slice(0, 80) || i.lage;
    const pid = newId('p'), cid = newId('c');
    const code = `STK-${region === 'nord' ? 'N' : 'S'}-${String((db.meta.standortSeq || 0) + 1).padStart(3, '0')}`;
    db.projects.push({ id: pid, code, name, region, location: [i.plz, i.lage].filter(Boolean).join(' '), spvId: null, phase: 1,
      gridStatus: 'nicht begonnen', permitStatus: 'nicht begonnen', contractStatus: 'Erstkontakt',
      tech: { powerMW: null, capacityMWh: null, connection: i.umspannwerk && i.umspannwerk !== 'Weiß ich nicht' ? `Umspannwerk: ${i.umspannwerk} (Angabe Eigentümer, ungeprüft)` : 'offen', areaHa: null, variant: 'noch keine Auslegung' },
      econ: null, risks: ['Netzkapazität und Anschlusspunkt ungeprüft', 'Planungsrechtliche Einordnung offen'], ownerUpdates: [], publicRelease: { state: 'nicht freigegeben' },
      responsible: i.assignee || u.id, source: { inquiryId: i.id, ref: kennung(i) }, createdAt: now() });
    // ohne Rechteänderung: der Standort muss für die übernehmende Person über ihre bestehende Rolle sichtbar sein
    if (!P.getProject(u, pid)) { db.projects.pop(); throw new HttpError(403, 'Der Standort wäre für Sie nicht sichtbar. Bitte durch die Administration übernehmen lassen.'); }
    db.meta.standortSeq = (db.meta.standortSeq || 0) + 1;
    db.contacts.push({ id: cid, name: i.name, kind: 'Grundstückseigentümer', email: i.email, phone: i.phone, projectIds: [pid], owner: i.assignee || u.id, note: [i.rolle, `aus Anfrage ${kennung(i)}`].filter(Boolean).join(' · ') });
    db.parcels.push({ id: newId('x'), projectId: pid, ownerContactId: cid, gemarkung: i.flurstueck || '–', flur: '–', flurstueck: '–', areaHa: Number(String(i.flaeche || '').replace(',', '.')) || null, devAreaHa: null, use: i.nutzung || 'unbekannt', status: 'Erstkontakt' });
    db.tasks.push({ id: newId('t'), projectId: pid, title: i.nextAction || 'Erstbewertung Netzentfernung und Standortkriterien', due: i.followUp || new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10), assignee: i.assignee || u.id, status: 'offen', inquiryId: i.id, log: [{ at: now(), by: u.id, byName: u.name, text: `Aus Anfrage ${kennung(i)} übernommen` }] });
    i.projectId = pid; i.status = 'als Standort übernommen';
    verlauf(i, u, `Als Standort ${code} übernommen (Kontakt, Grundstück, Aufgabe angelegt)`);
    persist(); audit('anfrage_als_standort', u, { anfrage: i.id, projekt: pid });
    return redirect(res, `/portal/anfragen/${i.id}?m=standort`);
  }
  if (aktion === 'anonymisieren') {
    if (!P.isAdmin(u) || i.anonymisiert || !LOESCHBAR.has(statusVon(i))) throw new HttpError(403, 'Löschung nicht möglich.');
    if (i.fileId) await deleteFile(i.fileId);
    for (const k of ['name', 'email', 'phone', 'flurstueck', 'nachricht', 'org', 'rolle']) if (i[k]) i[k] = k === 'name' ? 'gelöscht' : '';
    for (const x of i.log || []) x.text = x.text.replace(/Notiz: .*/s, 'Notiz: [gelöscht]');
    for (const e of db.audit) if (e.anfrage === i.id) for (const k of ['lage', 'email', 'name']) delete e[k]; // Protokoll ohne Personenbezug (R-4)
    i.fileId = null; i.anonymisiert = now();
    verlauf(i, u, 'Personenbezogene Angaben und Unterlage gelöscht');
    persist(); audit('anfrage_anonymisiert', u, { anfrage: i.id });
    return redirect(res, `/portal/anfragen/${i.id}?m=geloescht`);
  }
  throw notFound();
}
