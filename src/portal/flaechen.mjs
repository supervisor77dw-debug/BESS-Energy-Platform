// Aktive Grundstücksakquise und Standortqualifizierung (AW-20261101-GE-CLAUDE-STROMKAI-AKTIVE-AKQUISE-021).
// Keine eigene Datenhaltung und keine neue Navigation: Flächenkandidaten sind Standorte in db.projects (kandidat: true,
// source.art 'aktive_akquise'), Flurstücke db.parcels, Kontakte db.contacts, Wiedervorlagen db.tasks. Erreichbar über
// Grundstücke, Kontakte und die Standortakte. Bestehende Anfrage- und Standortkennungen bleiben unverändert.
// Rechte: keine neue Rolle, keine Rechteänderung. Anlegen Administration und Vertrieb der eigenen Region (wie die
// Übernahme einer Anfrage); Bearbeiten jede interne Rolle mit Zugriff auf den Standort; externe Rollen erhalten 404.
// Datenschutz-Freigabetor (P0, docs/AKTIVE_AKQUISE.md): ohne config.akquiseEchtdaten nur gekennzeichnete Testdatensätze.
import { html, raw, fmtDate, fmtDateTime, fmtNum } from '../lib/html.mjs';
import { getDb, persist, newId, now, audit } from '../lib/store.mjs';
import { redirect } from '../lib/http.mjs';
import { config } from '../config.mjs';
import * as P from '../lib/policy.mjs';
import { dubletten, flurstueckParsen, regionenFuer, REGIONEN, intern, nameVon } from './akquise.mjs';
import { aufgabeZuweisen, benachrichtigen } from './arbeit.mjs';

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const notFound = () => new HttpError(404, 'Nicht gefunden');

export const KONTAKTROLLEN = ['Eigentümer', 'Pächter', 'Bewirtschafter', 'Gemeinde/Verwaltung', 'Kontaktvermittler', 'sonstiger Projektkontakt'];
export const KONTAKTWEGE = ['persönliche Ansprache vor Ort', 'Gemeinde/Amtsverwaltung', 'Grundbuchauskunft (berechtigtes Interesse dokumentiert)', 'Bauernverband/Landgesellschaft', 'Weiterleitung über Dritte', 'Eigentümeranfrage über Website', 'sonstiger Weg'];
export const VERSUCH_STATUS = ['geplant', 'durchgeführt – Rückmeldung offen', 'erreicht – Interesse', 'erreicht – kein Interesse', 'nicht erreicht', 'Kontakt nicht erwünscht'];
export const HERKUNFT = ['Testdatensatz (synthetisch)', 'Angabe der betroffenen Person', 'eigene Erhebung vor Ort', 'Gemeinde/Amtsverwaltung', 'Grundbuchauskunft', 'Bauernverband/Landgesellschaft', 'Vermittlung durch Dritte', 'Website-Anfrage', 'öffentlich zugängliche Quelle'];
export const RECHTSGRUNDLAGEN = ['noch nicht festgelegt', 'Art. 6 Abs. 1 lit. a DSGVO (Einwilligung)', 'Art. 6 Abs. 1 lit. b DSGVO (vorvertraglich, auf Anfrage der Person)', 'Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse, Abwägung dokumentiert)'];
export const ART14 = ['offen – Information ausstehend', 'nicht erforderlich – bei der Person erhoben (Art. 13 erfüllt)', 'informiert', 'Ausnahme nach Art. 14 Abs. 5 geprüft'];
export const PRUEFSTATUS = ['unbestätigt', 'geprüft', 'Prüfung erforderlich'];
export const NETZSTUFEN = ['keine Prüfung', 'Vorprüfung', 'Anfrage gestellt', 'Angebot erhalten', 'Zusage/Reservierung', 'Netzanschlussvertrag'];
export const PLANUNGSRECHT = ['ungeprüft', 'Außenbereich – Privilegierung zu prüfen', 'Bebauungsplan erforderlich', 'Gewerbe- oder Industriegebiet', 'Gemeinde signalisiert Unterstützung', 'Gemeinde ablehnend'];
export const SICHERUNG = ['kein Kontakt', 'Kontakt aufgenommen', 'Gespräch geführt', 'Entwurf übergeben', 'Option/Vertrag unterzeichnet', 'abgelehnt'];
export const QUALI_STATUS = ['Vorprüfung – nicht bestätigt', 'vorqualifiziert (intern)', 'zurückgestellt', 'nicht geeignet'];
const VORQUALIFIZIERT = 'vorqualifiziert (intern)', OFFEN_Q = 'Vorprüfung – nicht bestätigt';
const ART14_OFFEN = ART14[0];

const heute = () => new Date().toISOString().slice(0, 10);
const plusTage = (n, von = Date.now()) => new Date(von + n * 864e5).toISOString().slice(0, 10);
const datum = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
const txt = (v, n) => String([].concat(v ?? '')[0] ?? '').trim().slice(0, n);
const zahl = (v) => { const t = txt(v, 20); const n = Number(t.replace(',', '.')); return t && Number.isFinite(n) && n >= 0 ? n : null; };
const aus = (liste, v, def) => (liste.includes(txt(v, 200)) ? txt(v, 200) : def);
const mehrfach = (liste, v) => [...new Set([].concat(v ?? []).filter((x) => liste.includes(x)))];
const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
const leer = (v) => !v || v === '–';
const opt = (v, cur) => html`<option${v === cur ? raw(' selected') : ''}>${v}</option>`;
const csrfFeld = (s) => html`<input type="hidden" name="_csrf" value="${s.csrf}">`;
const markOk = (t) => html`<span class="mark mark-ok">${t}</span>`, markWarn = (t) => html`<span class="mark mark-warn">${t}</span>`;
const testMark = (x) => (x?.testdaten ? html` <span class="mark mark-demo">Testdatensatz</span>` : '');

export const herkunftVon = (p) => (p.source?.inquiryId ? 'Anfrage' : p.source?.art === 'aktive_akquise' ? 'Aktive Akquise' : 'Bestand');
const projektIntern = (u, id) => (P.internalProjectIds(u).has(id) ? P.getProject(u, id) : null);
const darfAnlegen = (u) => regionenFuer(u).length > 0;

// ---------- Datenschutz-Freigabetor (P0) ----------
function testdatenPruefen(fields) {
  if (config.akquiseEchtdaten) return;
  if (fields.testdaten !== 'ja') throw new HttpError(422, 'Datenschutz-Freigabetor: Bis zur Freigabe des Datenschutzkonzepts werden in der aktiven Akquise nur synthetische Testdatensätze erfasst. Bitte als Testdatensatz kennzeichnen und keine echten Personen- oder Eigentümerdaten eingeben.');
}
const testFeld = () => (config.akquiseEchtdaten ? '' : html`<label class="check"><input type="checkbox" name="testdaten" value="ja" required> Synthetischer Testdatensatz – keine echten Personen- oder Eigentümerdaten (Pflicht bis zur Datenschutzfreigabe)</label>`);
const art14Faellig = (c) => c.datenschutz && c.datenschutz.art14 === ART14_OFFEN && c.datenschutz.erhobenAm && plusTage(30, Date.parse(c.datenschutz.erhobenAm)) < heute();
const gesperrt = (c) => !!c.datenschutz?.gesperrt;

// ---------- Flurstücke ----------
const FLURFELDER = [['bundesland', 'Bundesland', 40], ['gemeinde', 'Gemeinde', 80], ['gemarkung', 'Gemarkung', 80], ['flur', 'Flur', 20], ['flurstueck', 'Flurstückskennzeichen', 40], ['areaHa', 'Grundstücksfläche in ha', 12], ['karte', 'Kartenreferenz oder Koordinaten', 160], ['datenquelle', 'Datenquelle', 160], ['erhobenAm', 'Erhebungsdatum', 10]];
function flurFormular(x = {}, pre) {
  const wert = (k) => (x[k] == null || x[k] === '–' ? '' : x[k]);
  return html`${FLURFELDER.map(([k, l, n]) => html`<label for="${pre}-${k}">${l} <span class="muted small">freiwillig</span></label><input id="${pre}-${k}" name="${k}"${k === 'erhobenAm' ? raw(' type="date"') : raw(` maxlength="${n}"`)}${k === 'areaHa' ? raw(' inputmode="decimal"') : ''} value="${wert(k)}">`)}
  <label for="${pre}-ps">Prüfstatus</label><select id="${pre}-ps" name="pruefstatus">${PRUEFSTATUS.map((v) => opt(v, x.pruefstatus || 'unbestätigt'))}</select>`;
}
function flurAusFormular(f) {
  const o = {};
  for (const [k, , n] of FLURFELDER) o[k] = k === 'areaHa' ? zahl(f[k]) : k === 'erhobenAm' ? datum(f[k]) : txt(f[k], n);
  o.pruefstatus = aus(PRUEFSTATUS, f.pruefstatus, 'unbestätigt');
  for (const k of ['gemarkung', 'flur', 'flurstueck']) o[k] ||= '–'; // Bestandsdarstellung: fehlende Angabe als „–“
  return o;
}
export const flurLage = (x) => [x.bundesland, x.gemeinde, leer(x.gemarkung) ? '' : x.gemarkung, leer(x.flur) ? '' : `Flur ${x.flur}`, leer(x.flurstueck) ? '' : `Flurstück ${x.flurstueck}`].filter(Boolean).join(', ') || 'Lage noch nicht erfasst';
// Altbestand: Freitext lag vor AW-021 vollständig in „gemarkung“, Flur und Flurstück leer
const altangabe = (x) => x.altangabe || (!x.strukturiert && leer(x.flur) && leer(x.flurstueck) && !leer(x.gemarkung) ? x.gemarkung : '');
// Lesende Prüfung des Bestands (tools/akquise-altdaten.mjs, Standortakte): schreibt nichts
export function altdatenPruefen(db) {
  return db.parcels.map((x) => {
    const alt = altangabe(x), v = alt && flurstueckParsen(alt);
    const r = { id: x.id, projectId: x.projectId, flurstueck: !alt ? 'strukturiert oder leer' : v ? 'eindeutig zerlegbar – Übernahme nur nach Bestätigung' : 'nicht eindeutig – Prüfaufgabe', vorschlag: v || null };
    const c = x.ownerContactId && db.contacts.find((y) => y.id === x.ownerContactId);
    const rl = rolleLautAnfrage(c);
    r.eigentuemer = !x.ownerContactId ? 'keine Zuordnung' : rl ? `Zuordnung prüfen – Rolle laut Anfrage: ${rl}` : db.contracts.some((k) => k.parcelId === x.id && k.ownerContactId === x.ownerContactId) ? 'Vertrag vorhanden' : 'Selbstauskunft oder unbelegt – nicht bestätigt';
    return r;
  });
}

// ---------- Beteiligte (Kontakt ↔ Flurstück mit Rolle) ----------
const aktiveBeteiligte = (x) => (x.beteiligte || []).filter((b) => !b.beendetAm);
// Bestand: ownerContactId (Vertrag, Anfrage) bleibt unverändert maßgeblich für das Eigentümerportal
// Nur ein Vertrag zum Flurstück gilt als Grundlage; eine Zuordnung aus einer Anfrage beruht auf Selbstauskunft.
const BESTAND_VERTRAG = 'Bestand (Vertrag)', BESTAND_OFFEN = 'Bestand – nicht geprüft';
const belegt = (b) => b.eigentum === 'bestätigt' || b.eigentum === BESTAND_VERTRAG;
function beteiligteVon(db, x) {
  const liste = aktiveBeteiligte(x).map((b) => ({ ...b, kontakt: db.contacts.find((c) => c.id === b.contactId) }));
  if (x.ownerContactId && !liste.some((b) => b.contactId === x.ownerContactId && b.rolle === 'Eigentümer')) {
    const vertrag = db.contracts.some((k) => k.parcelId === x.id && k.ownerContactId === x.ownerContactId);
    liste.unshift({ id: null, contactId: x.ownerContactId, rolle: 'Eigentümer', eigentum: vertrag ? BESTAND_VERTRAG : BESTAND_OFFEN, kontakt: db.contacts.find((c) => c.id === x.ownerContactId) });
  }
  return liste;
}
// Übernahme aus Anfrage vor AW-021: Kontakt wurde unabhängig von der angegebenen Rolle als Eigentümer zugeordnet
const NICHT_EIGENTUEMER = ['Pächter/in', 'Bewirtschafter/in', 'Bevollmächtigt oder Verwaltung', 'Gemeinde oder Verwaltung', 'Hinweis auf eine Fläche (vermittelnd)', 'Sonstiges'];
export const rolleLautAnfrage = (c) => NICHT_EIGENTUEMER.find((r) => String(c?.note || '').startsWith(`${r} · aus Anfrage`)) || (String(c?.note || '').startsWith('aus Anfrage') ? 'keine Angabe' : null);
// Historische Fehlzuordnung (DQ-1): Eigentümerkontakt aus einer Anfrage ohne Eigentümerrolle → prüfbedürftig, nie automatisch geändert
export const eigentumPruefen = (db, c) => !!c && c.kind === 'Grundstückseigentümer' && !!rolleLautAnfrage(c) && !db.parcels.some((x) => aktiveBeteiligte(x).some((b) => b.contactId === c.id && b.rolle === 'Eigentümer' && b.eigentum === 'bestätigt'));
// Kopfzeile „Eigentümer“ der Standortakte: immer mit Status; Fehlzuordnungen aus Anfragen als prüfbedürftig (DQ-1)
export function eigentuemerText(db, p, contacts) {
  const eig = db.parcels.filter((x) => x.projectId === p.id).flatMap((x) => beteiligteVon(db, x)).filter((b) => b.rolle === 'Eigentümer');
  const text = eig.map((b) => `${b.kontakt?.name || '–'} (${b.eigentum}${b.id === null && rolleLautAnfrage(b.kontakt) ? `; Rolle laut Anfrage: ${rolleLautAnfrage(b.kontakt)} – prüfen` : ''})`);
  const ohne = contacts.filter((c) => c.kind === 'Grundstückseigentümer' && !eig.some((b) => b.contactId === c.id)).map((c) => `${c.name} (${BESTAND_OFFEN})`);
  return [...new Set([...text, ...ohne])].join(', ');
}

// ---------- Dubletten (Kontakte, Grundstücke, Standorte) ----------
function sichtbar(db, u, d) {
  if (d.art === 'Grundstück') { const x = db.parcels.find((y) => y.id === d.id); return P.getProject(u, x?.projectId) ? d : { ...d, text: 'Grundstück eines Standorts ohne Ihren Zugriff', href: null }; }
  if (d.art === 'Standort') return P.getProject(u, d.id) ? d : { ...d, text: 'Standort ohne Ihren Zugriff', href: null };
  if (d.art === 'Kontakt') return P.getContact(u, d.id) ? { ...d, href: `/portal/kontakte/${d.id}` } : { ...d, text: 'Kontakt ohne Ihren Zugriff', href: null };
  return d;
}
export function flaechenDubletten(db, u, o) {
  const out = dubletten(db, { id: null, gemarkung: leer(o.gemarkung) ? '' : o.gemarkung, flur: leer(o.flur) ? '' : o.flur, flurstueck: leer(o.flurstueck) ? '' : o.flurstueck });
  const g = norm(o.gemeinde);
  if (g.length >= 3) for (const p of db.projects) if (norm(p.location).includes(g) || norm(p.name).includes(g)) out.push({ art: 'Standort', id: p.id, text: `${p.code} ${p.name}`, href: `/portal/projekte/${p.id}`, gruende: ['Gemeinde'] });
  return out.map((d) => sichtbar(db, u, d));
}
export function kontaktDubletten(db, u, k, ohneId) {
  const out = dubletten(db, { id: null, email: k.email, phone: k.phone }).filter((d) => d.id !== ohneId);
  const n = norm(k.name);
  if (n.length >= 5) for (const c of db.contacts) if (c.id !== ohneId && norm(c.name) === n && !out.some((d) => d.id === c.id)) out.push({ art: 'Kontakt', id: c.id, text: c.name, gruende: ['Name'] });
  return out.map((d) => sichtbar(db, u, d));
}
const dublettenListe = (d) => (d.length ? html`<div class="alert" role="alert"><strong>Mögliche Dubletten</strong> – bitte prüfen. Treffer werden nicht automatisch zusammengeführt.<ul class="assume">${d.map((x) => html`<li>${x.art}: ${x.href ? html`<a href="${x.href}">${x.text}</a>` : x.text} <span class="small">(${x.gruende.join(', ')})</span></li>`)}</ul></div>` : '');

// ---------- Suchprofil (veränderbar, keine Mindestanforderung) ----------
const suchprofil = (db) => db.meta.suchprofil || null;
const suchprofilText = (db) => { const sp = suchprofil(db); return sp && (sp.szenarien || sp.flaeche) ? html`<p class="small">Suchprofil (veränderbar, keine Mindestanforderung): ${sp.szenarien || '–'}${sp.flaeche ? html` · Fläche: ${sp.flaeche}` : ''} <span class="muted">(${nameVon(db, sp.by)}, ${fmtDate(sp.at)})</span></p>` : html`<p class="small muted">Kein festes Suchprofil hinterlegt. Projektgrößen und Flächen werden je Standort als veränderbare Szenarien geführt.</p>`; };

// ---------- Vorqualifizierung ----------
function szenarienParsen(t) {
  const out = [];
  for (const m of String(t || '').matchAll(/(\d+(?:[.,]\d+)?)\s*MW(?!h)(?:\s*\/\s*(\d+(?:[.,]\d+)?)\s*MWh)?/gi)) out.push({ mw: Number(m[1].replace(',', '.')), mwh: m[2] ? Number(m[2].replace(',', '.')) : null });
  return out.slice(0, 6);
}
const szenarienText = (l) => (l || []).map((x) => `${fmtNum(x.mw, 1)} MW${x.mwh ? ` / ${fmtNum(x.mwh, 1)} MWh` : ''}`).join('; ');
export function fehlendeAngaben(db, p, vq) {
  const f = [];
  if (vq.flaecheHa == null) f.push('Fläche');
  if (vq.abstandNvpKm == null) f.push('Abstand Netzverknüpfungspunkt');
  if (vq.netzstufe === 'keine Prüfung') f.push('Netzanschlussstatus');
  if (!vq.zuschnitt) f.push('Zuschnitt/Erschließung');
  if (!vq.zufahrt) f.push('Zufahrt/Nebenflächen');
  if (vq.planungsrecht === 'ungeprüft') f.push('planungsrechtlicher Status');
  if (['kein Kontakt', 'abgelehnt'].includes(vq.sicherung)) f.push('Kontakt-/Flächensicherungsstatus');
  const eig = db.parcels.filter((x) => x.projectId === p.id).some((x) => beteiligteVon(db, x).some((b) => b.rolle === 'Eigentümer' && belegt(b)));
  if (!eig) f.push('bestätigter Eigentümer');
  return f;
}

// ---------- Ansichten ----------
export function kandidatenListe({ db, u, s }) {
  if (!config.aktiveAkquise || !P.isInternal(u)) return '';
  const projekte = P.listProjects(u).filter((p) => p.kandidat && P.internalProjectIds(u).has(p.id));
  const wv = (p) => db.tasks.filter((t) => t.projectId === p.id && t.status !== 'erledigt').map((t) => t.due).sort()[0];
  return html`<section class="panel" id="akquise"><div class="panel-head"><h2>Flächenkandidaten (aktive Akquise)</h2>${darfAnlegen(u) ? html`<a class="btn btn-primary btn-small" href="/portal/grundstuecke/neu">Fläche erfassen</a>` : ''}</div>
  <p class="small muted">Flächen ohne eingehende Anfrage. Nach der Vorqualifizierung werden geeignete Flächen in die Pipeline übernommen. Keine Eignungszusage.</p>
  ${suchprofilText(db)}
  ${projekte.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Standort</th><th>Lage</th><th>Vorqualifizierung</th><th>Zuständig</th><th>Wiedervorlage</th></tr></thead><tbody>${projekte.map((p) => {
    const xs = db.parcels.filter((x) => x.projectId === p.id), w = wv(p);
    return html`<tr><td data-l="Standort"><a href="/portal/projekte/${p.id}"><strong>${p.code}</strong> ${p.name}</a>${testMark(p)}</td><td data-l="Lage" class="small">${xs.length ? flurLage(xs[0]) : '–'}${xs.length > 1 ? html`<br>und ${xs.length - 1} weitere Flurstücke` : ''}</td>
    <td data-l="Vorqualifizierung">${p.vorqualifizierung?.status === VORQUALIFIZIERT ? markOk(VORQUALIFIZIERT) : markWarn(p.vorqualifizierung?.status || OFFEN_Q)}</td><td data-l="Zuständig">${p.responsible ? nameVon(db, p.responsible) : html`<span class="bad">nicht zugeordnet</span>`}</td>
    <td data-l="Wiedervorlage" class="${w && w < heute() ? 'bad' : ''}">${w ? fmtDate(w) : '–'}</td></tr>`;
  })}</tbody></table></div>` : html`<p class="muted">Keine Flächenkandidaten in Ihrem Zugriff.</p>`}
  ${P.isAdmin(u) ? html`<details><summary>Suchprofil bearbeiten (Administration)</summary><form method="post" action="/portal/grundstuecke/suchprofil" class="stack">${csrfFeld(s)}
    <label for="sp-sz">Leistungsszenarien</label><input id="sp-sz" name="szenarien" maxlength="300" value="${suchprofil(db)?.szenarien || ''}" placeholder="z. B. 10 MW / 20 MWh; 20 MW / 40 MWh">
    <label for="sp-fl">Flächenbandbreite</label><input id="sp-fl" name="flaeche" maxlength="200" value="${suchprofil(db)?.flaeche || ''}">
    <button class="btn" type="submit">Suchprofil speichern</button><p class="small muted">Orientierung für die Recherche, keine Mindestanforderung und keine Ausschlussregel.</p></form></details>` : ''}
</section>`;
}

function kandidatFormular({ db, u, s, werte = {}, dub = [] }) {
  const kontakte = P.listContacts(u);
  return html`${dublettenListe(dub)}<section class="panel"><h2>Fläche erfassen</h2>
  <p class="small muted">Für recherchierte Flächen ohne eingehende Anfrage. Grobe Ersterfassung genügt; Angaben lassen sich in der Standortakte ergänzen. Legt einen Standort (Phase 1, Flächenkandidat), das Flurstück und eine Wiedervorlage an – ohne Rechtevergabe.</p>
  <form method="post" action="/portal/grundstuecke/neu" class="stack">${csrfFeld(s)}
    <label for="k-rg">Region</label><select id="k-rg" name="region">${regionenFuer(u).map((r) => html`<option value="${r}"${werte.region === r ? raw(' selected') : ''}>${REGIONEN[r]}</option>`)}</select>
    <label for="k-n">Arbeitstitel <span class="muted small">freiwillig</span></label><input id="k-n" name="name" maxlength="80" value="${werte.name || ''}">
    ${flurFormular(werte, 'k')}
    <label for="k-nu">Aktuelle Nutzung <span class="muted small">freiwillig</span></label><input id="k-nu" name="use" maxlength="60" value="${werte.use || ''}">
    <label for="k-c">Vorhandenen Kontakt verknüpfen <span class="muted small">freiwillig</span></label><select id="k-c" name="contactId"><option value="">später</option>${kontakte.map((c) => html`<option value="${c.id}"${werte.contactId === c.id ? raw(' selected') : ''}>${c.name}</option>`)}</select>
    <label for="k-cr">Rolle des Kontakts</label><select id="k-cr" name="rolle">${KONTAKTROLLEN.map((r) => opt(r, werte.rolle || 'sonstiger Projektkontakt'))}</select>
    ${testFeld()}
    ${dub.length ? html`<label class="check"><input type="checkbox" name="dublettenGeprueft" value="ja" required> Dubletten geprüft – trotzdem anlegen</label>` : ''}
    <button class="btn btn-primary" type="submit">Fläche anlegen</button>
  </form><p class="small">Kontakt fehlt noch? <a href="/portal/kontakte/neu">Kontakt anlegen</a></p></section>`;
}

function kontaktFormular({ db, u, s, c = null, werte = {}, dub = [], projekte = [] }) {
  const v = c || werte;
  const ziel = c ? `/portal/kontakte/${c.id}/bearbeiten` : '/portal/kontakte/neu';
  const ds = c?.datenschutz || werte;
  return html`${dublettenListe(dub)}<form method="post" action="${ziel}" class="stack">${csrfFeld(s)}
    <label for="kt-n">Name oder Bezeichnung</label><input id="kt-n" name="name" required maxlength="120" value="${v.name || ''}">
    <fieldset class="checks"><legend>Rollen</legend><p class="small muted">Mehrere möglich. „Eigentümer“ gilt erst mit Grundlage am Flurstück als bestätigt.</p>${KONTAKTROLLEN.map((r) => html`<label><input type="checkbox" name="rollen" value="${r}"${(v.rollen || []).includes(r) ? raw(' checked') : ''}> ${r}</label>`)}</fieldset>
    <label for="kt-e">E-Mail <span class="muted small">freiwillig</span></label><input id="kt-e" name="email" type="email" maxlength="160" value="${v.email || ''}">
    <label for="kt-t">Telefon <span class="muted small">freiwillig</span></label><input id="kt-t" name="phone" maxlength="60" value="${v.phone || ''}">
    <label for="kt-o">Verantwortlich</label><select id="kt-o" name="owner">${intern(db).map((x) => html`<option value="${x.id}"${x.id === (v.owner || u.id) ? raw(' selected') : ''}>${x.name}</option>`)}</select>
    ${c ? '' : html`<label for="kt-r">Region</label><select id="kt-r" name="region">${regionenFuer(u).map((r) => html`<option value="${r}"${werte.region === r ? raw(' selected') : ''}>${REGIONEN[r]}</option>`)}</select>
    <label for="kt-p">Mit Standort verknüpfen <span class="muted small">freiwillig</span></label><select id="kt-p" name="projectId"><option value="">ohne Standort</option>${projekte.map((p) => html`<option value="${p.id}"${werte.projectId === p.id ? raw(' selected') : ''}>${p.code} · ${p.name}</option>`)}</select>
    <label for="kt-h">Herkunft der Daten</label><select id="kt-h" name="herkunft">${HERKUNFT.map((x) => opt(x, ds.herkunft || HERKUNFT[0]))}</select>
    <label for="kt-q">Quelle im Einzelnen <span class="muted small">freiwillig, z. B. „Gespräch vor Ort am Feldrand“</span></label><input id="kt-q" name="quelle" maxlength="200" value="${ds.quelle || ''}">
    <label for="kt-rg">Rechtsgrundlage</label><select id="kt-rg" name="rechtsgrundlage">${RECHTSGRUNDLAGEN.map((x) => opt(x, ds.rechtsgrundlage || RECHTSGRUNDLAGEN[0]))}</select>
    <label for="kt-a">Information nach Art. 13/14 DSGVO</label><select id="kt-a" name="art14">${ART14.map((x) => opt(x, ds.art14 || ART14_OFFEN))}</select>`}
    <label for="kt-no">Notiz <span class="muted small">freiwillig, nur Erforderliches</span></label><textarea id="kt-no" name="note" rows="2" maxlength="500">${v.note || ''}</textarea>
    ${c ? '' : testFeld()}
    ${dub.length ? html`<label class="check"><input type="checkbox" name="dublettenGeprueft" value="ja" required> Dubletten geprüft – trotzdem speichern</label>` : ''}
    <button class="btn btn-primary" type="submit">${c ? 'Speichern' : 'Kontakt anlegen'}</button>
  </form>`;
}

function kontaktDetail({ db, u, s, c, msg }) {
  const ds = c.datenschutz;
  const projekte = (c.projectIds || []).map((id) => P.getProject(u, id)).filter(Boolean);
  const links = db.parcels.filter((x) => P.getProject(u, x.projectId)).flatMap((x) => beteiligteVon(db, x).filter((b) => b.contactId === c.id).map((b) => ({ x, b })));
  const versuche = [...(c.kontaktversuche || [])].reverse();
  return html`${msg ? html`<div class="notice" role="status">${msg}</div>` : ''}
${gesperrt(c) ? html`<div class="alert" role="alert"><strong>Verarbeitung gesperrt</strong> – ${ds.sperrgrund || 'Widerspruch oder Kontakt nicht erwünscht'}. Keine weiteren Kontaktversuche.</div>` : ''}
${eigentumPruefen(db, c) ? html`<div class="alert" role="alert"><strong>Eigentümerstatus prüfen</strong> – als Grundstückseigentümer geführt, laut Anfrage aber „${rolleLautAnfrage(c)}“. Keine automatische Korrektur; Eigentum nur mit Grundlage bestätigen.</div>` : ''}
${art14Faellig(c) ? html`<div class="alert" role="alert"><strong>Art.-14-Information überfällig</strong> – Daten seit ${fmtDate(ds.erhobenAm)} erhoben, Information spätestens nach einem Monat bzw. beim ersten Kontakt.</div>` : ''}
<section class="grid-2">
  <div class="panel"><h2>Kontakt${testMark(c)}</h2>${kontaktFormular({ db, u, s, c })}</div>
  <div class="panel"><h2>Datenschutz</h2>${ds ? html`<dl class="kv">
    <div><dt>Herkunft</dt><dd>${ds.herkunft}${ds.quelle ? html`<br><span class="small muted">${ds.quelle}</span>` : ''}</dd></div>
    <div><dt>Erhoben am</dt><dd>${fmtDate(ds.erhobenAm)}</dd></div>
    <div><dt>Rechtsgrundlage</dt><dd>${ds.rechtsgrundlage === RECHTSGRUNDLAGEN[0] ? markWarn(ds.rechtsgrundlage) : ds.rechtsgrundlage}</dd></div>
    <div><dt>Information Art. 13/14</dt><dd>${ds.art14 === ART14_OFFEN ? markWarn(ds.art14) : ds.art14}${ds.art14Am ? html`<br><span class="small">${fmtDate(ds.art14Am)} · ${ds.art14Art || ''}</span>` : ''}</dd></div>
    <div><dt>Prüftermin Löschung</dt><dd>${fmtDate(ds.pruefenAm)} <span class="small muted">(Vorschlag; Löschfrist noch nicht freigegeben)</span></dd></div>
  </dl>` : html`<p class="muted">Bestandskontakt ohne erfasste Herkunft (vor AW-021, z. B. aus einer Anfrage mit Einwilligung).</p>`}
  <details><summary>Datenschutzangaben bearbeiten</summary><form method="post" action="/portal/kontakte/${c.id}/datenschutz" class="stack">${csrfFeld(s)}
    <label for="ds-h">Herkunft</label><select id="ds-h" name="herkunft">${HERKUNFT.map((x) => opt(x, ds?.herkunft || HERKUNFT[0]))}</select>
    <label for="ds-q">Quelle im Einzelnen</label><input id="ds-q" name="quelle" maxlength="200" value="${ds?.quelle || ''}">
    <label for="ds-r">Rechtsgrundlage</label><select id="ds-r" name="rechtsgrundlage">${RECHTSGRUNDLAGEN.map((x) => opt(x, ds?.rechtsgrundlage || RECHTSGRUNDLAGEN[0]))}</select>
    <label for="ds-a">Information Art. 13/14</label><select id="ds-a" name="art14">${ART14.map((x) => opt(x, ds?.art14 || ART14_OFFEN))}</select>
    <label for="ds-ad">Informiert am</label><input id="ds-ad" name="art14Am" type="date" value="${ds?.art14Am || ''}">
    <label for="ds-aa">Art der Information</label><input id="ds-aa" name="art14Art" maxlength="120" value="${ds?.art14Art || ''}" placeholder="z. B. Informationsblatt persönlich übergeben">
    <label for="ds-p">Prüftermin Löschung</label><input id="ds-p" name="pruefenAm" type="date" value="${ds?.pruefenAm || ''}">
    <label class="check"><input type="checkbox" name="gesperrt" value="ja"${gesperrt(c) ? raw(' checked') : ''}> Widerspruch oder Kontakt nicht erwünscht – Verarbeitung sperren</label>
    <label for="ds-sg">Sperrgrund</label><input id="ds-sg" name="sperrgrund" maxlength="200" value="${ds?.sperrgrund || ''}">
    <button class="btn" type="submit">Datenschutzangaben speichern</button></form></details></div>
</section>
<section class="panel"><h2>Flurstücke und Standorte</h2>${links.length ? html`<ul class="assume">${links.map(({ x, b }) => html`<li><a href="/portal/projekte/${x.projectId}">${db.projects.find((p) => p.id === x.projectId)?.code}</a> · ${flurLage(x)} · ${b.rolle} <span class="small muted">(${b.eigentum || 'Rolle'})</span></li>`)}</ul>` : projekte.length ? html`<p>${projekte.map((p) => html`<a href="/portal/projekte/${p.id}">${p.code}</a> `)}</p>` : html`<p class="muted">Noch nicht mit einem Standort verknüpft. Verknüpfung in der Standortakte unter „Beteiligte verknüpfen“.</p>`}</section>
<section class="panel"><h2>Kontaktversuche</h2>${versuche.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Datum</th><th>Kontaktweg</th><th>Status</th><th>Ergebnis / nächste Aktion</th><th>Verantwortlich</th></tr></thead><tbody>${versuche.map((k) => html`<tr><td data-l="Datum">${fmtDate(k.datum)}</td><td data-l="Kontaktweg">${k.weg}</td><td data-l="Status">${k.status}</td><td data-l="Ergebnis">${k.ergebnis || '–'}${k.naechsteAktion ? html`<br><span class="small">Nächste Aktion: ${k.naechsteAktion}</span>` : ''}${k.wiedervorlage ? html`<br><span class="small ${k.wiedervorlage < heute() ? 'bad' : 'muted'}">Wiedervorlage ${fmtDate(k.wiedervorlage)}</span>` : ''}</td><td data-l="Verantwortlich">${nameVon(db, k.verantwortlich)}<br><span class="small muted">erfasst ${nameVon(db, k.by)}</span></td></tr>`)}</tbody></table></div>` : html`<p class="muted">Noch keine Kontaktversuche dokumentiert.</p>`}
  ${gesperrt(c) ? '' : html`<details${versuche.length ? '' : raw(' open')}><summary>Kontaktversuch dokumentieren</summary><form method="post" action="/portal/kontakte/${c.id}/kontaktversuch" class="stack">${csrfFeld(s)}
    <label for="kv-d">Datum</label><input id="kv-d" name="datum" type="date" value="${heute()}">
    <label for="kv-w">Kontaktweg</label><select id="kv-w" name="weg">${KONTAKTWEGE.map((x) => opt(x, KONTAKTWEGE[0]))}</select>
    <label for="kv-s">Status</label><select id="kv-s" name="status">${VERSUCH_STATUS.map((x) => opt(x, VERSUCH_STATUS[0]))}</select>
    <label for="kv-e">Ergebnis <span class="muted small">freiwillig, nur Erforderliches</span></label><input id="kv-e" name="ergebnis" maxlength="300">
    <label for="kv-n">Nächste Aktion</label><input id="kv-n" name="naechsteAktion" maxlength="200">
    <label for="kv-wv">Wiedervorlage</label><input id="kv-wv" name="wiedervorlage" type="date">
    <label for="kv-v">Verantwortlich</label><select id="kv-v" name="verantwortlich">${intern(db).map((x) => html`<option value="${x.id}"${x.id === (c.owner || u.id) ? raw(' selected') : ''}>${x.name}</option>`)}</select>
    ${projekte.length ? html`<label for="kv-p">Wiedervorlage als Aufgabe am Standort</label><select id="kv-p" name="projectId"><option value="">keine Aufgabe</option>${projekte.map((p) => html`<option value="${p.id}">${p.code} · ${p.name}</option>`)}</select>` : ''}
    <label class="check"><input type="checkbox" name="art14Erteilt" value="ja"> Information nach Art. 14 DSGVO bei diesem Kontakt erteilt</label>
    <p class="small muted">Grundbuchauskunft nur bei dokumentiertem berechtigtem Interesse (§ 12 GBO). Die Plattform stellt kein berechtigtes Interesse fest.</p>
    <button class="btn btn-primary" type="submit">Kontaktversuch speichern</button></form></details>`}
</section>`;
}

// Standortakte: Arbeitsablauf, Flurstücke, Beteiligte, Vorqualifizierung (nur interne Rollen mit Standortzugriff)
export function akquiseAkte({ db, u, s, p, msg }) {
  if (!config.aktiveAkquise || !projektIntern(u, p.id)) return '';
  const parcels = P.listParcels(u, p.id);
  const kontakte = P.listContacts(u);
  const vq = p.vorqualifizierung || {};
  const alleBet = parcels.flatMap((x) => beteiligteVon(db, x));
  const kids = new Set([...alleBet.map((b) => b.contactId), ...db.contacts.filter((c) => (c.projectIds || []).includes(p.id)).map((c) => c.id)]);
  const versuche = db.contacts.filter((c) => kids.has(c.id)).flatMap((c) => c.kontaktversuche || []);
  const offeneAufgaben = db.tasks.filter((t) => t.projectId === p.id && t.status !== 'erledigt');
  const eigStatus = alleBet.some((b) => b.rolle === 'Eigentümer' && belegt(b)) ? 'bestätigt' : alleBet.some((b) => b.rolle === 'Eigentümer') ? 'vermutet, nicht bestätigt' : null;
  const schritte = [
    ['Fläche identifiziert', true, herkunftVon(p)],
    ['Grundstück angelegt', parcels.length > 0, `${parcels.length} Flurstück(e)`],
    ['Eigentümer-/Kontaktstatus geprüft', eigStatus === 'bestätigt', eigStatus || 'kein Eigentümer erfasst'],
    ['Kontaktweg gewählt', versuche.length > 0, versuche.at(-1)?.weg || 'offen'],
    ['Zuständigkeit festgelegt', !!p.responsible, p.responsible ? nameVon(db, p.responsible) : 'offen'],
    ['Kontaktaufnahme dokumentiert', versuche.some((k) => k.status !== 'geplant'), `${versuche.length} Versuch(e)`],
    ['Wiedervorlage gesetzt', offeneAufgaben.length > 0, offeneAufgaben.map((t) => t.due).sort()[0] ? `nächste ${fmtDate(offeneAufgaben.map((t) => t.due).sort()[0])}` : 'keine offene Aufgabe'],
    ['Vorqualifizierung', vq.status === VORQUALIFIZIERT, vq.status || OFFEN_Q],
    ['In der Pipeline', !p.kandidat, p.kandidat ? 'Flächenkandidat' : p.pipelineAm ? `seit ${fmtDate(p.pipelineAm)}` : 'Bestand'],
  ];
  const summeHa = parcels.reduce((n, x) => n + (Number(x.areaHa) || 0), 0) || null; // Vorschlag aus den Flurstücken, veränderbar
  const fehlend = fehlendeAngaben(db, p, { flaecheHa: vq.flaecheHa ?? summeHa, abstandNvpKm: vq.abstandNvpKm ?? null, netzstufe: vq.netzstufe || 'keine Prüfung', zuschnitt: vq.zuschnitt, zufahrt: vq.zufahrt, planungsrecht: vq.planungsrecht || 'ungeprüft', sicherung: vq.sicherung || 'kein Kontakt' });
  const sp = suchprofil(db);
  return html`${msg ? html`<div class="notice" role="status">${msg}</div>` : ''}<section class="panel" id="flaechenakquise"><div class="panel-head"><h2>Flächenakquise und Vorqualifizierung</h2><span class="small muted">Herkunft: ${herkunftVon(p)}${p.kandidat ? ' · Flächenkandidat, noch nicht in der Pipeline' : ''}${testMark(p)}</span></div>
  <h3>Arbeitsablauf</h3><ol class="assume">${schritte.map(([t, ok, info]) => html`<li>${ok ? markOk('erledigt') : markWarn('offen')} ${t} <span class="small muted">· ${info}</span></li>`)}</ol>
  <p class="small muted">Reihenfolge ist eine Orientierung, kein Zwang. Aufgaben und Benachrichtigungen laufen über die bestehende Aufgabenliste.</p>

  <h3>Flurstücke</h3>${parcels.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Lage</th><th>Fläche</th><th>Karte / Quelle</th><th>Prüfstatus</th><th>Beteiligte</th></tr></thead><tbody>${parcels.map((x) => {
    const alt = altangabe(x), vs = alt && flurstueckParsen(alt);
    return html`<tr><td data-l="Lage">${flurLage(x)}${alt ? html`<br><span class="small">Altangabe: „${alt}“</span>${vs ? html`<form method="post" action="/portal/projekte/${p.id}/flurstueck/${x.id}/vorschlag" class="inline-form">${csrfFeld(s)}<button class="btn btn-small">Vorschlag übernehmen: ${vs.gemarkung}, Flur ${vs.flur}, Flurstück ${vs.flurstueck}</button></form>` : html`<form method="post" action="/portal/projekte/${p.id}/flurstueck/${x.id}/pruefaufgabe" class="inline-form">${csrfFeld(s)}<button class="btn btn-small">Nicht eindeutig – Prüfaufgabe anlegen</button></form>`}` : ''}</td>
      <td data-l="Fläche" class="num">${x.areaHa ? `${fmtNum(x.areaHa, 2)} ha` : '–'}</td>
      <td data-l="Karte / Quelle" class="small">${x.karte || '–'}${x.datenquelle ? html`<br>${x.datenquelle}` : ''}${x.erhobenAm ? html`<br>erhoben ${fmtDate(x.erhobenAm)}` : ''}</td>
      <td data-l="Prüfstatus">${x.pruefstatus === 'geprüft' ? markOk('geprüft') : markWarn(x.pruefstatus || 'unbestätigt')}</td>
      <td data-l="Beteiligte" class="small">${beteiligteVon(db, x).map((b) => html`${b.kontakt ? html`<a href="/portal/kontakte/${b.contactId}">${b.kontakt.name}</a>` : '–'} · ${b.rolle}${b.rolle === 'Eigentümer' ? html` ${belegt(b) ? markOk(b.eigentum) : markWarn(b.eigentum)}${b.id === null && rolleLautAnfrage(b.kontakt) ? html` <span class="mark mark-warn">Rolle laut Anfrage: ${rolleLautAnfrage(b.kontakt)}</span>` : ''}` : ''}${b.id ? html` <form method="post" action="/portal/projekte/${p.id}/beteiligte/${b.id}/beenden" class="inline-form">${csrfFeld(s)}<input type="hidden" name="parcelId" value="${x.id}"><button class="btn btn-small" title="Verknüpfung beenden (bleibt im Verlauf)">beenden</button></form>` : ''}<br>`)}${beteiligteVon(db, x).length ? '' : '–'}</td></tr>
      <tr><td colspan="5"><details><summary>Flurstück bearbeiten</summary><form method="post" action="/portal/projekte/${p.id}/flurstueck/${x.id}" class="stack">${csrfFeld(s)}${flurFormular(x, `e-${x.id}`)}<button class="btn" type="submit">Flurstück speichern</button><p class="small muted">Eine bisherige Freitextangabe bleibt als Altangabe erhalten.</p></form></details></td></tr>`;
  })}</tbody></table></div>` : html`<p class="muted">Noch kein Flurstück erfasst.</p>`}
  <details><summary>Weiteres Flurstück hinzufügen</summary><form method="post" action="/portal/projekte/${p.id}/flurstueck" class="stack">${csrfFeld(s)}${flurFormular({}, 'n')}${testFeld()}<button class="btn" type="submit">Flurstück hinzufügen</button></form></details>

  <h3>Beteiligte verknüpfen</h3>${parcels.length ? html`<form method="post" action="/portal/projekte/${p.id}/beteiligte" class="stack">${csrfFeld(s)}
    <label for="bt-x">Flurstück</label><select id="bt-x" name="parcelId">${parcels.map((x) => html`<option value="${x.id}">${flurLage(x)}</option>`)}</select>
    <label for="bt-c">Kontakt</label><select id="bt-c" name="contactId" required><option value="">wählen …</option>${kontakte.filter((c) => !gesperrt(c)).map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select>
    <label for="bt-r">Rolle</label><select id="bt-r" name="rolle">${KONTAKTROLLEN.map((r) => opt(r, 'sonstiger Projektkontakt'))}</select>
    <label for="bt-e">Eigentum</label><select id="bt-e" name="eigentum"><option>nicht bestätigt</option><option>bestätigt</option></select>
    <label for="bt-g">Grundlage der Bestätigung <span class="muted small">Pflicht für „bestätigt“, z. B. Grundbuchauszug, Vertrag, Vollmacht</span></label><input id="bt-g" name="grundlage" maxlength="200">
    <button class="btn" type="submit">Verknüpfen</button><p class="small muted">Bewirtschafter und Pächter sind nicht Eigentümer. „Bestätigt“ nur mit Grundlage und nur für die Rolle Eigentümer. <a href="/portal/kontakte/neu">Neuen Kontakt anlegen</a></p></form>` : html`<p class="muted">Zuerst ein Flurstück erfassen.</p>`}

  <h3>Vorqualifizierung</h3>
  <p>${vq.status === VORQUALIFIZIERT ? markOk(VORQUALIFIZIERT) : markWarn(vq.status || OFFEN_Q)}${vq.at ? html` <span class="small muted">${nameVon(db, vq.by)}, ${fmtDateTime(vq.at)}</span>` : ''}</p>
  ${fehlend.length ? html`<p class="small">Für eine Vorqualifizierung fehlen: ${fehlend.join(', ')}.</p>` : ''}
  <p class="small muted">Interne Einschätzung, keine Eignungs- oder Netzzusage. Größen sind veränderbare Szenarien, keine Mindestanforderung. Auslegung und Wirtschaftlichkeit über ${rolesOfIp(u) ? html`<a href="/portal/anlagenplanung/${p.id}">Anlagenplanung & Investition</a> und ` : ''}<a href="/portal/wirtschaftlichkeit/${p.id}">STROMKAI-WM</a>.</p>
  ${sp?.szenarien ? html`<p class="small">Suchprofil: ${sp.szenarien}</p>` : ''}
  <details${vq.at ? '' : raw(' open')}><summary>Vorqualifizierung bearbeiten</summary><form method="post" action="/portal/projekte/${p.id}/vorqualifizierung" class="stack">${csrfFeld(s)}
    <label for="vq-f">Verfügbare Fläche in ha${vq.flaecheHa == null && summeHa ? html` <span class="muted small">Vorschlag aus den Flurstücken</span>` : ''}</label><input id="vq-f" name="flaecheHa" inputmode="decimal" value="${vq.flaecheHa ?? (summeHa ? String(summeHa).replace('.', ',') : '')}">
    <label for="vq-s">Leistungsszenarien (MW / MWh)</label><input id="vq-s" name="szenarien" maxlength="200" value="${szenarienText(vq.szenarien)}" placeholder="z. B. 10 MW / 20 MWh; 15 MW / 30 MWh">
    <label for="vq-a">Abstand Netzverknüpfungspunkt in km</label><input id="vq-a" name="abstandNvpKm" inputmode="decimal" value="${vq.abstandNvpKm ?? ''}">
    <label for="vq-n">Netzanschlussstatus</label><select id="vq-n" name="netzstufe">${NETZSTUFEN.map((x) => opt(x, vq.netzstufe || NETZSTUFEN[0]))}</select>
    <label for="vq-z">Zuschnitt und Erschließung</label><input id="vq-z" name="zuschnitt" maxlength="200" value="${vq.zuschnitt || ''}">
    <label for="vq-zu">Zufahrt und Nebenflächen</label><input id="vq-zu" name="zufahrt" maxlength="200" value="${vq.zufahrt || ''}">
    <label for="vq-p">Planungsrechtlicher Status</label><select id="vq-p" name="planungsrecht">${PLANUNGSRECHT.map((x) => opt(x, vq.planungsrecht || PLANUNGSRECHT[0]))}</select>
    <label for="vq-k">Kontakt- und Flächensicherungsstatus</label><select id="vq-k" name="sicherung">${SICHERUNG.map((x) => opt(x, vq.sicherung || SICHERUNG[0]))}</select>
    <label for="vq-r">Ausschluss- und Risikokriterien <span class="muted small">je Zeile</span></label><textarea id="vq-r" name="risiken" rows="3" maxlength="800">${(vq.risiken || []).join('\n')}</textarea>
    <label class="check"><input type="checkbox" name="ausschluss" value="ja"${vq.ausschluss ? raw(' checked') : ''}> Ein Ausschlusskriterium liegt vor</label>
    <label for="vq-st">Einschätzung</label><select id="vq-st" name="status">${QUALI_STATUS.map((x) => opt(x, vq.status || OFFEN_Q))}</select>
    <button class="btn" type="submit">Vorqualifizierung speichern</button></form></details>
  ${p.kandidat && vq.status === VORQUALIFIZIERT ? html`<form method="post" action="/portal/projekte/${p.id}/pipeline" class="stack">${csrfFeld(s)}<button class="btn btn-primary" type="submit">In die Pipeline übernehmen</button><p class="small muted">Der Standort erscheint danach in der Pipeline (Phase 1). Keine Rechtevergabe, keine Projektgesellschaft.</p></form>` : ''}

  <h3>Wiedervorlage</h3><form method="post" action="/portal/aufgaben/neu" class="stack">${csrfFeld(s)}<input type="hidden" name="projectId" value="${p.id}">
    <label for="wv-t">Nächste Aktion</label><input id="wv-t" name="title" required maxlength="200">
    <label for="wv-d">Frist</label><input id="wv-d" name="due" type="date" required value="${plusTage(14)}">
    <label for="wv-a">Zuständig</label><select id="wv-a" name="assignee">${intern(db).filter((x) => P.internalProjectIds(x).has(p.id)).map((x) => html`<option value="${x.id}"${x.id === (p.responsible || u.id) ? raw(' selected') : ''}>${x.name}</option>`)}</select>
    <button class="btn" type="submit">Wiedervorlage anlegen</button></form>
</section>`;
}
const rolesOfIp = (u) => P.rolesOf(u).some((r) => r === 'admin' || r === 'projektleitung');

export function kontakteKopf(u) {
  if (!config.aktiveAkquise || !darfAnlegen(u)) return '';
  return html`<p><a class="btn btn-primary btn-small" href="/portal/kontakte/neu">Kontakt anlegen</a> <span class="small muted">Kontakte lassen sich unabhängig von einer Anfrage anlegen und später mit Flurstücken verknüpfen.</span></p>`;
}

// ---------- Routen ----------
export async function handleFlaechen({ res, path, method, u, s, view, post, url }) {
  if (!config.aktiveAkquise) return null;
  const kp = /^\/portal\/kontakte\/([\w-]+)(?:\/(bearbeiten|datenschutz|kontaktversuch))?$/.exec(path);
  const pp = /^\/portal\/projekte\/([\w-]+)\/(flurstueck|beteiligte|vorqualifizierung|pipeline)(?:\/([\w-]+)(?:\/(vorschlag|pruefaufgabe|beenden))?)?$/.exec(path);
  const gp = path === '/portal/grundstuecke/neu' || path === '/portal/grundstuecke/suchprofil';
  if (!kp && !pp && !gp) return null;
  if (!P.isInternal(u)) throw notFound();
  const db = getDb();
  const projekteIntern = () => P.listProjects(u).filter((p) => P.internalProjectIds(u).has(p.id));

  // ----- Suchprofil (Administration) -----
  if (path === '/portal/grundstuecke/suchprofil') {
    if (method !== 'POST' || !P.isAdmin(u)) throw notFound();
    const { fields } = await post();
    db.meta.suchprofil = { szenarien: txt(fields.szenarien, 300), flaeche: txt(fields.flaeche, 200), by: u.id, at: now() };
    persist(); audit('suchprofil_geaendert', u, {});
    return redirect(res, '/portal/grundstuecke#akquise');
  }

  // ----- Fläche erfassen (ohne Anfrage) -----
  if (path === '/portal/grundstuecke/neu') {
    if (!darfAnlegen(u)) throw notFound();
    if (method === 'GET') return view('Fläche erfassen', kandidatFormular({ db, u, s }), 'Aktive Akquise · Grundstücke');
    if (method !== 'POST') throw notFound();
    const { fields } = await post();
    const region = txt(fields.region, 10);
    if (!regionenFuer(u).includes(region)) throw new HttpError(403, 'Anlage nur für die eigene Region.');
    testdatenPruefen(fields);
    const o = flurAusFormular(fields);
    const kontakt = fields.contactId ? P.getContact(u, txt(fields.contactId, 40)) : null;
    if (fields.contactId && !kontakt) throw notFound();
    if (kontakt && gesperrt(kontakt)) throw new HttpError(409, 'Für diesen Kontakt ist die Verarbeitung gesperrt.');
    const dub = flaechenDubletten(db, u, o);
    const werte = { ...o, region, name: txt(fields.name, 80), use: txt(fields.use, 60), contactId: kontakt?.id, rolle: aus(KONTAKTROLLEN, fields.rolle, 'sonstiger Projektkontakt') };
    if (dub.length && fields.dublettenGeprueft !== 'ja') return view('Fläche erfassen', kandidatFormular({ db, u, s, werte, dub }), 'Aktive Akquise · Dubletten prüfen');
    const pid = newId('p');
    const code = `STK-${region === 'nord' ? 'N' : 'S'}-${String((db.meta.standortSeq || 0) + 1).padStart(3, '0')}`;
    db.projects.push({ id: pid, code, name: werte.name || `Flächenkandidat ${o.gemeinde || (leer(o.gemarkung) ? '' : o.gemarkung) || code}`.trim(), region, location: [o.gemeinde, o.bundesland].filter(Boolean).join(', ') || 'Lage offen', spvId: null, phase: 1, kandidat: true,
      gridStatus: 'nicht begonnen', permitStatus: 'nicht begonnen', contractStatus: 'Flächenkandidat (aktive Akquise)',
      tech: { powerMW: null, capacityMWh: null, connection: 'offen', areaHa: null, variant: 'noch keine Auslegung' },
      econ: null, risks: ['Eigentümer- und Kontaktstatus offen', 'Netzkapazität und Anschlusspunkt ungeprüft', 'Planungsrechtliche Einordnung offen'], ownerUpdates: [], publicRelease: { state: 'nicht freigegeben' },
      responsible: u.id, source: { art: 'aktive_akquise', by: u.id, at: now() }, testdaten: !config.akquiseEchtdaten, createdAt: now() });
    // ohne Rechteänderung: der Standort muss für die anlegende Person über ihre bestehende Rolle sichtbar sein
    if (!P.getProject(u, pid)) { db.projects.pop(); throw new HttpError(403, 'Der Standort wäre für Sie nicht sichtbar. Bitte durch die Administration anlegen lassen.'); }
    db.meta.standortSeq = (db.meta.standortSeq || 0) + 1;
    const x = { id: newId('x'), projectId: pid, ownerContactId: null, ...o, devAreaHa: null, use: werte.use || 'unbekannt', status: 'Flächenkandidat', strukturiert: true, altangabe: '', beteiligte: [], testdaten: !config.akquiseEchtdaten, angelegtVon: u.id, angelegtAm: now() };
    db.parcels.push(x);
    if (kontakt) verknuepfen(kontakt, x, werte.rolle, 'nicht bestätigt', '', u);
    const t = { id: newId('t'), projectId: pid, title: 'Eigentümer- und Kontaktstatus prüfen, Kontaktweg festlegen', due: plusTage(14), assignee: null, status: 'offen', createdBy: u.id, createdAt: now(), log: [{ at: now(), by: u.id, byName: u.name, text: `Aus aktiver Akquise angelegt (${code})` }] };
    db.tasks.push(t); aufgabeZuweisen(db, t, u.id, u);
    persist(); audit('flaeche_erfasst', u, { projekt: pid, grundstueck: x.id, dubletten: dub.length });
    return redirect(res, `/portal/projekte/${pid}?m=erfasst#flaechenakquise`);
  }

  // ----- Kontakte -----
  if (kp) {
    if (kp[1] === 'neu' && !kp[2]) {
      if (!darfAnlegen(u)) throw notFound();
      if (method === 'GET') return view('Kontakt anlegen', html`<section class="panel">${kontaktFormular({ db, u, s, projekte: projekteIntern() })}</section>`, 'Aktive Akquise · Kontakte');
      if (method !== 'POST') throw notFound();
      const { fields } = await post();
      testdatenPruefen(fields);
      const werte = kontaktAusFormular(db, fields, u);
      werte.region = txt(fields.region, 10);
      if (!regionenFuer(u).includes(werte.region)) throw new HttpError(403, 'Anlage nur für die eigene Region.');
      const projekt = fields.projectId ? projekteIntern().find((p) => p.id === fields.projectId) : null;
      if (fields.projectId && !projekt) throw notFound();
      const ds = { herkunft: aus(HERKUNFT, fields.herkunft, HERKUNFT[0]), quelle: txt(fields.quelle, 200), erhobenAm: heute(), rechtsgrundlage: aus(RECHTSGRUNDLAGEN, fields.rechtsgrundlage, RECHTSGRUNDLAGEN[0]), art14: aus(ART14, fields.art14, ART14_OFFEN), art14Am: null, art14Art: '', pruefenAm: plusTage(180), gesperrt: false };
      if (config.akquiseEchtdaten && (ds.herkunft === HERKUNFT[0] || ds.rechtsgrundlage === RECHTSGRUNDLAGEN[0])) throw new HttpError(422, 'Herkunft und Rechtsgrundlage sind für echte Kontaktdaten Pflicht.');
      if (!werte.name) throw new HttpError(422, 'Bitte einen Namen oder eine Bezeichnung angeben.');
      const dub = kontaktDubletten(db, u, werte);
      if (dub.length && fields.dublettenGeprueft !== 'ja') return view('Kontakt anlegen', html`<section class="panel">${kontaktFormular({ db, u, s, werte: { ...werte, ...ds, projectId: projekt?.id }, dub, projekte: projekteIntern() })}</section>`, 'Aktive Akquise · Dubletten prüfen');
      const c = { id: newId('c'), ...werte, kind: 'Projektkontakt', projectIds: projekt ? [projekt.id] : [], datenschutz: ds, kontaktversuche: [], source: { art: 'aktive_akquise', by: u.id, at: now() }, testdaten: !config.akquiseEchtdaten, angelegtAm: now() };
      db.contacts.push(c);
      if (c.owner !== u.id) benachrichtigen(db, { userId: c.owner, art: 'kontakt_zugewiesen', ref: c.id, text: `Kontakt zugewiesen von ${u.name}`, href: `/portal/kontakte/${c.id}` });
      persist(); audit('kontakt_angelegt', u, { kontakt: c.id, projekt: projekt?.id || null, dubletten: dub.length });
      return redirect(res, `/portal/kontakte/${c.id}?m=angelegt`);
    }
    const c = P.getContact(u, kp[1]);
    if (!c) throw notFound();
    if (!kp[2] && method === 'GET') return view(c.name, kontaktDetail({ db, u, s, c, msg: { angelegt: 'Kontakt angelegt.', gespeichert: 'Gespeichert.', versuch: 'Kontaktversuch gespeichert.' }[url.searchParams.get('m')] }), 'Kontakt');
    if (method !== 'POST' || !kp[2]) throw notFound();
    const { fields } = await post();
    if (kp[2] === 'bearbeiten') {
      const werte = kontaktAusFormular(db, fields, u);
      if (!werte.name) throw new HttpError(422, 'Bitte einen Namen oder eine Bezeichnung angeben.');
      const alt = c.owner;
      Object.assign(c, werte);
      if (c.owner !== alt && c.owner !== u.id) benachrichtigen(db, { userId: c.owner, art: 'kontakt_zugewiesen', ref: `${c.id}:${now()}`, text: `Kontakt zugewiesen von ${u.name}`, href: `/portal/kontakte/${c.id}` });
      persist(); audit('kontakt_bearbeitet', u, { kontakt: c.id });
      return redirect(res, `/portal/kontakte/${c.id}?m=gespeichert`);
    }
    if (kp[2] === 'datenschutz') {
      const ds = c.datenschutz ??= { erhobenAm: null, nachgetragen: now() };
      Object.assign(ds, { herkunft: aus(HERKUNFT, fields.herkunft, HERKUNFT[0]), quelle: txt(fields.quelle, 200), rechtsgrundlage: aus(RECHTSGRUNDLAGEN, fields.rechtsgrundlage, RECHTSGRUNDLAGEN[0]), art14: aus(ART14, fields.art14, ART14_OFFEN), art14Am: datum(fields.art14Am) || null, art14Art: txt(fields.art14Art, 120), pruefenAm: datum(fields.pruefenAm) || ds.pruefenAm || null });
      const sperre = fields.gesperrt === 'ja';
      if (sperre !== !!ds.gesperrt) { ds.gesperrt = sperre; ds.gesperrtAm = sperre ? now() : null; ds.gesperrtVon = u.id; audit(sperre ? 'kontakt_verarbeitung_gesperrt' : 'kontakt_sperre_aufgehoben', u, { kontakt: c.id }); }
      ds.sperrgrund = txt(fields.sperrgrund, 200);
      persist(); audit('kontakt_datenschutz_geaendert', u, { kontakt: c.id });
      return redirect(res, `/portal/kontakte/${c.id}?m=gespeichert`);
    }
    if (kp[2] === 'kontaktversuch') {
      if (gesperrt(c)) throw new HttpError(409, 'Für diesen Kontakt ist die Verarbeitung gesperrt (Widerspruch oder Kontakt nicht erwünscht).');
      const verantwortlich = intern(db).some((x) => x.id === fields.verantwortlich) ? fields.verantwortlich : u.id;
      const k = { id: newId('kv'), datum: datum(fields.datum) || heute(), weg: aus(KONTAKTWEGE, fields.weg, 'sonstiger Weg'), status: aus(VERSUCH_STATUS, fields.status, 'geplant'), ergebnis: txt(fields.ergebnis, 300), naechsteAktion: txt(fields.naechsteAktion, 200), wiedervorlage: datum(fields.wiedervorlage) || null, verantwortlich, by: u.id, at: now() };
      const projekt = fields.projectId && (c.projectIds || []).includes(fields.projectId) ? projektIntern(u, fields.projectId) : null;
      // Aufgaben sind nur über den Standort sichtbar: zuständig nur, wer den Standort ohne Rechteänderung sieht (Prüfung vor jeder Änderung)
      if (k.wiedervorlage && projekt && !P.internalProjectIds(db.users.find((x) => x.id === verantwortlich)).has(projekt.id)) throw new HttpError(422, 'Die zuständige Person hat keinen Zugriff auf diesen Standort. Bitte eine Person mit Zugriff wählen.');
      (c.kontaktversuche ??= []).push(k);
      if (fields.art14Erteilt === 'ja' && c.datenschutz) Object.assign(c.datenschutz, { art14: 'informiert', art14Am: k.datum, art14Art: `beim Kontakt: ${k.weg}` });
      if (k.status === 'Kontakt nicht erwünscht') { const ds = c.datenschutz ??= { nachgetragen: now() }; Object.assign(ds, { gesperrt: true, gesperrtAm: now(), gesperrtVon: u.id, sperrgrund: 'Kontakt nicht erwünscht (Kontaktversuch)' }); audit('kontakt_verarbeitung_gesperrt', u, { kontakt: c.id }); }
      if (k.wiedervorlage && projekt) {
        const t = { id: newId('t'), projectId: projekt.id, contactId: c.id, title: `Wiedervorlage ${c.name}: ${k.naechsteAktion || k.weg}`.slice(0, 200), due: k.wiedervorlage, assignee: null, status: 'offen', createdBy: u.id, createdAt: now(), log: [{ at: now(), by: u.id, byName: u.name, text: 'Aus Kontaktversuch angelegt' }] };
        db.tasks.push(t); aufgabeZuweisen(db, t, verantwortlich, u); k.aufgabeId = t.id;
      } else if (verantwortlich !== u.id) benachrichtigen(db, { userId: verantwortlich, art: 'kontaktversuch_zugewiesen', ref: k.id, text: `Kontaktversuch zugewiesen: ${k.naechsteAktion || k.weg}${k.wiedervorlage ? ` (Wiedervorlage ${fmtDate(k.wiedervorlage)})` : ''}`, href: `/portal/kontakte/${c.id}` });
      persist(); audit('kontaktversuch', u, { kontakt: c.id, weg: k.weg, status: k.status }); // Protokoll ohne Ergebnistext
      return redirect(res, `/portal/kontakte/${c.id}?m=versuch`);
    }
    throw notFound();
  }

  // ----- Standortakte: Flurstücke, Beteiligte, Vorqualifizierung, Pipeline -----
  const p = projektIntern(u, pp[1]);
  if (!p || method !== 'POST') throw notFound();
  const { fields } = await post();
  const zurueck = (m) => redirect(res, `/portal/projekte/${p.id}?m=${m}#flaechenakquise`);
  const flst = (id) => { const x = db.parcels.find((y) => y.id === id && y.projectId === p.id); if (!x) throw notFound(); return x; };
  if (pp[2] === 'flurstueck' && !pp[3]) {
    testdatenPruefen(fields);
    const o = flurAusFormular(fields);
    db.parcels.push({ id: newId('x'), projectId: p.id, ownerContactId: null, ...o, devAreaHa: null, use: 'unbekannt', status: p.kandidat ? 'Flächenkandidat' : 'Erstkontakt', strukturiert: true, altangabe: '', beteiligte: [], testdaten: !config.akquiseEchtdaten, angelegtVon: u.id, angelegtAm: now() });
    persist(); audit('flurstueck_angelegt', u, { projekt: p.id, grundstueck: db.parcels.at(-1).id });
    return zurueck('flurstueck');
  }
  if (pp[2] === 'flurstueck') {
    const x = flst(pp[3]);
    if (pp[4] === 'vorschlag') {
      const alt = altangabe(x), v = alt && flurstueckParsen(alt);
      if (!v) throw new HttpError(422, 'Kein eindeutiger Vorschlag vorhanden.');
      Object.assign(x, { altangabe: alt, ...v, strukturiert: true, pruefstatus: 'unbestätigt' });
      (x.aenderungen ??= []).push({ at: now(), by: u.id, felder: ['gemarkung', 'flur', 'flurstueck'], art: 'Vorschlag aus Altangabe bestätigt' });
      persist(); audit('flurstueck_strukturiert', u, { projekt: p.id, grundstueck: x.id });
      return zurueck('flurstueck');
    }
    if (pp[4] === 'pruefaufgabe') {
      x.pruefstatus = 'Prüfung erforderlich';
      const t = { id: newId('t'), projectId: p.id, title: `Flurstücksangabe prüfen und strukturiert erfassen (${p.code})`, due: plusTage(14), assignee: null, status: 'offen', createdBy: u.id, createdAt: now(), parcelId: x.id, log: [{ at: now(), by: u.id, byName: u.name, text: 'Altangabe nicht eindeutig zerlegbar' }] };
      db.tasks.push(t); aufgabeZuweisen(db, t, p.responsible && intern(db).some((y) => y.id === p.responsible) ? p.responsible : u.id, u);
      persist(); audit('flurstueck_pruefaufgabe', u, { projekt: p.id, grundstueck: x.id });
      return zurueck('flurstueck');
    }
    if (pp[4]) throw notFound();
    const o = flurAusFormular(fields);
    const alt = altangabe(x);
    const geaendert = Object.keys(o).filter((k) => String(o[k] ?? '') !== String(x[k] ?? ''));
    if (geaendert.length) {
      Object.assign(x, o, { strukturiert: true, altangabe: alt });
      (x.aenderungen ??= []).push({ at: now(), by: u.id, felder: geaendert });
      persist(); audit('flurstueck_geaendert', u, { projekt: p.id, grundstueck: x.id, felder: geaendert.join(',') });
    }
    return zurueck('flurstueck');
  }
  if (pp[2] === 'beteiligte') {
    const x = flst(txt(fields.parcelId, 40));
    if (pp[3]) {
      const b = (x.beteiligte || []).find((y) => y.id === pp[3]);
      if (pp[4] !== 'beenden' || !b) throw notFound();
      if (!b.beendetAm) { b.beendetAm = now(); b.beendetVon = u.id; eigentumAbgleichen(db, x, b, db.contacts.find((c) => c.id === b.contactId)); persist(); audit('beteiligung_beendet', u, { projekt: p.id, grundstueck: x.id, kontakt: b.contactId }); }
      return zurueck('beteiligte');
    }
    const c = P.getContact(u, txt(fields.contactId, 40));
    if (!c) throw notFound();
    if (gesperrt(c)) throw new HttpError(409, 'Für diesen Kontakt ist die Verarbeitung gesperrt.');
    const rolle = aus(KONTAKTROLLEN, fields.rolle, 'sonstiger Projektkontakt');
    const eigentum = txt(fields.eigentum, 20) === 'bestätigt' ? 'bestätigt' : 'nicht bestätigt';
    const grundlage = txt(fields.grundlage, 200);
    if (eigentum === 'bestätigt' && rolle !== 'Eigentümer') throw new HttpError(422, 'Nur die Rolle Eigentümer kann als bestätigt gelten. Bewirtschafter und Pächter sind nicht Eigentümer.');
    if (eigentum === 'bestätigt' && !grundlage) throw new HttpError(422, 'Für ein bestätigtes Eigentum ist die Grundlage anzugeben (z. B. Grundbuchauszug, Vertrag, Vollmacht).');
    eigentumAbgleichen(db, x, verknuepfen(c, x, rolle, eigentum, grundlage, u), c);
    persist(); audit('beteiligung_verknuepft', u, { projekt: p.id, grundstueck: x.id, kontakt: c.id, rolle, eigentum });
    return zurueck('beteiligte');
  }
  if (pp[2] === 'vorqualifizierung' && !pp[3]) {
    const vq = { flaecheHa: zahl(fields.flaecheHa), szenarien: szenarienParsen(fields.szenarien), abstandNvpKm: zahl(fields.abstandNvpKm), netzstufe: aus(NETZSTUFEN, fields.netzstufe, NETZSTUFEN[0]), zuschnitt: txt(fields.zuschnitt, 200), zufahrt: txt(fields.zufahrt, 200),
      planungsrecht: aus(PLANUNGSRECHT, fields.planungsrecht, PLANUNGSRECHT[0]), sicherung: aus(SICHERUNG, fields.sicherung, SICHERUNG[0]), risiken: String(fields.risiken || '').split(/\r?\n/).map((r) => r.trim().slice(0, 200)).filter(Boolean).slice(0, 12), ausschluss: fields.ausschluss === 'ja', status: aus(QUALI_STATUS, fields.status, OFFEN_Q), at: now(), by: u.id };
    vq.fehlend = fehlendeAngaben(db, p, vq);
    let m = 'vorqualifizierung';
    if (vq.status === VORQUALIFIZIERT && (vq.fehlend.length || vq.ausschluss)) { vq.status = OFFEN_Q; m = 'unvollstaendig'; }
    p.vorqualifizierung = vq;
    persist(); audit('vorqualifizierung_gespeichert', u, { projekt: p.id, status: vq.status });
    return zurueck(m);
  }
  if (pp[2] === 'pipeline' && !pp[3]) {
    if (!p.kandidat || p.vorqualifizierung?.status !== VORQUALIFIZIERT) throw new HttpError(409, 'Übernahme erst nach bestätigter Vorqualifizierung.');
    p.kandidat = false; p.pipelineAm = now(); p.pipelineVon = u.id;
    if (p.contractStatus === 'Flächenkandidat (aktive Akquise)') p.contractStatus = p.vorqualifizierung.sicherung;
    persist(); audit('kandidat_in_pipeline', u, { projekt: p.id });
    return zurueck('pipeline');
  }
  throw notFound();
}

function kontaktAusFormular(db, f, u) {
  const owner = intern(db).some((x) => x.id === f.owner) ? f.owner : u.id;
  return { name: txt(f.name, 120), rollen: mehrfach(KONTAKTROLLEN, f.rollen), email: txt(f.email, 160), phone: txt(f.phone, 60), owner, note: txt(f.note, 500) };
}
function verknuepfen(c, x, rolle, eigentum, grundlage, u) {
  x.beteiligte ??= [];
  const b = x.beteiligte.find((y) => y.contactId === c.id && y.rolle === rolle && !y.beendetAm);
  if (b) Object.assign(b, { eigentum, grundlage, geaendertAm: now(), geaendertVon: u.id });
  else x.beteiligte.push({ id: newId('bt'), contactId: c.id, rolle, eigentum, grundlage, at: now(), by: u.id });
  if (!(c.projectIds ||= []).includes(x.projectId)) c.projectIds.push(x.projectId);
  if (!(c.rollen ||= []).includes(rolle)) c.rollen.push(rolle);
  return b || x.beteiligte.at(-1);
}
// Bestätigtes Eigentum (Rolle Eigentümer + Grundlage) ist der einzige Weg zum Eigentümerstatus (DQ-1): setzt die bestehende
// Zuordnung ownerContactId nur, wenn das Flurstück noch keinen Eigentümer hat, und kind für Vergütung/Einladung.
// Wird die Bestätigung beendet oder zurückgenommen, wird nur zurückgesetzt, was diese Bestätigung gesetzt hat.
function eigentumAbgleichen(db, x, b, c) {
  if (!c) return;
  const bestaetigt = (y) => !y.beendetAm && y.rolle === 'Eigentümer' && y.eigentum === 'bestätigt';
  if (bestaetigt(b)) {
    if (!x.ownerContactId) { x.ownerContactId = c.id; b.ownerGesetzt = true; }
    if (c.kind !== 'Grundstückseigentümer') { c.kindVorher ??= c.kind || 'Projektkontakt'; c.kind = 'Grundstückseigentümer'; }
    return;
  }
  if (b.ownerGesetzt && x.ownerContactId === c.id) { x.ownerContactId = null; b.ownerGesetzt = false; }
  if (c.kindVorher && !db.parcels.some((y) => (y.beteiligte || []).some((z) => z.contactId === c.id && bestaetigt(z)))) { c.kind = c.kindVorher; delete c.kindVorher; }
}

export const AKQUISE_MELDUNGEN = { erfasst: 'Fläche erfasst. Bitte Eigentümer- und Kontaktstatus prüfen.', flurstueck: 'Flurstück gespeichert.', beteiligte: 'Beteiligte gespeichert.', vorqualifizierung: 'Vorqualifizierung gespeichert.', unvollstaendig: 'Gespeichert als „Vorprüfung – nicht bestätigt“: Für eine Vorqualifizierung fehlen Angaben oder ein Ausschlusskriterium liegt vor.', pipeline: 'In die Pipeline übernommen.' };
