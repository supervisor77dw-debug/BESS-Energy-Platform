// Zentrale Administrationsoberfläche (AW-STROMKAI-20261029-ADMIN-DASHBOARD-INTEGRATION-015).
// Ein Login, alle freigegebenen Bereiche: verlinkt ausschließlich auf vorhandene, funktionsfähige Module der Plattform.
// Keine eigene Berechnungslogik: Wirtschaftlichkeit = STROMKAI-WM (finanzen.mjs), Strommarkt/Backtesting/KI/Netzentgelt =
// geprüfter Export des STROMKAI-Trading-Systems (strommarkt-daten), Shadow-Trading = Export der Shadow-Ablage (nur Simulation).
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../lib/store.mjs';
import { html, raw, fmtNum, fmtDateTime } from '../lib/html.mjs';
import * as P from '../lib/policy.mjs';
import { eur, pct } from '../lib/finance/geld.mjs';
import * as D from '../lib/strommarkt/daten.mjs';
import { darfStrommarkt } from './strommarkt.mjs';
import { MODELL_VERSION as WM_VERSION } from '../lib/finance/wirtschaftlichkeit.mjs';

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'strommarkt-daten');

// Modulregister: Stand, Umgebung und Herkunft je Bereich. Status: live | qa | demo | geplant | gesperrt
export const MODULE = [
  { key: 'projekte', titel: 'Projekte & Projektgesellschaften', text: 'Projektgesellschaften, technische Auslegung, Bearbeitungsstand', href: '/portal/projekte', status: 'live', daten: 'demo', auftrag: '-005/-009', recht: (u) => P.isInternal(u) },
  { key: 'wirtschaftlichkeit', titel: 'Wirtschaftlichkeitsrechner', text: 'STROMKAI-WM: CAPEX, OPEX, Cashflow, Kapitalwert, IRR, DSCR, Amortisation je Projektgesellschaft', href: '/portal/wirtschaftlichkeit', status: 'live', daten: 'demo', auftrag: '-010/-011', recht: (u) => P.rolesOf(u).some((r) => ['admin', 'projektleitung', 'vertrieb_nord', 'vertrieb_sued'].includes(r)) },
  { key: 'anlagenplanung', titel: 'Anlagenplanung & Investition', text: 'Grundstück, Speichersystem, Dimensionierung, Investitionskosten und Finanzierung als Eingangsgrößen für STROMKAI-WM', href: '/portal/anlagenplanung', status: 'qa', daten: 'demo', auftrag: '-016', recht: (u) => P.rolesOf(u).some((r) => r === 'admin' || r === 'projektleitung') },
  { key: 'strommarkt', titel: 'Strommarkt', text: 'Historische Day-Ahead-Preise 2024–2026 (SMARD), Kennzahlen, Diagramme, Handelstage', href: '/portal/strommarkt?b=preise', status: 'qa', daten: 'markt', auftrag: '-012/-013', recht: darfStrommarkt },
  { key: 'backtesting', titel: 'Backtesting', text: 'Theoretisches Optimum (A) gegen realistische Strategien (B2 Rolling Horizon), Monate, Jahre, Kosten, Anlagengrößen', href: '/portal/strommarkt?b=vergleich', status: 'qa', daten: 'markt', auftrag: '-012/-013', recht: darfStrommarkt },
  { key: 'ki', titel: 'KI-Handelsanalyse', text: 'B2-Referenz gegen KI-Strategien, Prognosegüte, Modellstände (Out-of-Sample)', href: '/portal/strommarkt?b=modelle', status: 'qa', daten: 'markt', auftrag: '-012/-013', recht: darfStrommarkt },
  { key: 'netzentgelt', titel: 'Netzentgelt-Szenarien', text: 'Variante A „befreit“ gegen Variante B „ohne Befreiung“ je Anlage, Zeitraum und Strategie', href: '/portal/netzentgelt', status: 'qa', daten: 'markt', auftrag: '-013', recht: darfStrommarkt },
  { key: 'verguetung', titel: 'Eigentümer & Vergütungen', text: 'Verträge in 6 Stufen, Ansprüche Vereinbart/Fällig/Bezahlt/Prognose, Demo-Buchungen', href: '/portal/wirtschaftlichkeit', status: 'live', daten: 'demo', auftrag: '-010/-011', recht: (u) => P.isAdmin(u) || P.hasRole(u, 'projektleitung') },
  { key: 'shadow', titel: 'Shadow-Trading', text: 'Täglicher simulierter Handelsplan (B2 und KI), Risikoprüfung, spätere Bewertung – ohne Börsenzugang', href: '/portal/shadow-trading', status: 'qa', daten: 'markt', auftrag: '-013', recht: darfStrommarkt },
  { key: 'benutzer', titel: 'Benutzer & Berechtigungen', text: 'Einladen, Rollen und Projektrechte, Sperren, Sitzungen, Änderungsprotokoll', href: '/portal/admin/benutzer', status: 'live', daten: 'real', auftrag: '-009/-014', recht: (u) => P.isAdmin(u) },
  { key: 'entwicklung', titel: 'Entwicklungsstand', text: 'Module mit Umgebung, Version, Datenart und offenen Prüfpunkten', href: '/portal/entwicklungsstand', status: 'live', daten: 'real', auftrag: '-015', recht: (u) => P.isAdmin(u) },
];
const STATUS = { live: ['Live', 'mark-ok'], qa: ['QA', 'mark-info'], demo: ['Demo', 'mark-demo'], geplant: ['Geplant', 'mark-aud'], gesperrt: ['Gesperrt', 'mark-warn'] };
const DATEN = { demo: 'Synthetische Demo-Daten', markt: 'Reale Marktdaten (SMARD) und Simulation', real: 'Echte Plattformdaten' };
const datum = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('.') : iso || '–');
const status = (k) => html`<span class="mark ${STATUS[k][1]}">${STATUS[k][0]}</span>`;

// Shadow-Export laden und Prüfsumme kontrollieren
export function shadowStand() {
  const p = join(DIR, 'shadow.json');
  if (!existsSync(p)) return null;
  const buf = readFileSync(p);
  if (createHash('sha256').update(buf).digest('hex') !== readFileSync(join(DIR, 'shadow.sha256'), 'utf8').trim()) throw new Error('Prüfsumme Shadow-Export stimmt nicht');
  const s = JSON.parse(buf.toString('utf8'));
  if (s.format !== 'stromkai.portal.shadow/1') throw new Error('Unbekanntes Shadow-Format');
  return s;
}

const VAR = { befreit: 'A – befreit', ohne_befreiung: 'B – ohne Befreiung' };
const PER = { KJ2024: 'Kalenderjahr 2024', KJ2025: 'Kalenderjahr 2025', KJ2026_bis: '2026 bis 28.10.', R24M: 'Rollierend 24 Monate' };
const STRAT = { A: 'A – theoretisches Optimum', A_tag: 'A – Tagesoptimum', B1: 'B1', B2: 'B2 – Rolling Horizon (Referenz)', B3: 'B3', C_gbm: 'KI C_gbm', C_ridge: 'KI C_ridge', C_mlp: 'KI C_mlp', C_gbm_fund: 'KI C_gbm_fund' };

function zentrale(u) {
  const db = getDb();
  const sichtbar = MODULE.filter((m) => m.recht(u));
  const meta = D.verfuegbar() ? D.lade('meta.json') : null;
  const erg = meta ? D.lade('ergebnisse.json') : null;
  const ref = erg?.ergebnisse.find((r) => r.anlage === 'Simulationsanlage 15 MW / 30 MWh' && r.netzvariante === 'befreit' && r.periode === 'R24M' && r.strategie === 'B2');
  const sh = shadowStand();
  const plan = sh?.plaene.at(-1);
  const kpis = [
    ['Projekte', P.listProjects(u).length, '/portal/projekte', 'synthetisch'],
    ['Projektgesellschaften', db.spvs.length, '/portal/projekte', 'synthetisch'],
    ['Aktive Benutzer', db.users.filter((x) => x.active).length, '/portal/admin/benutzer', ''],
    ['B2 Netto-DB 15/30 (24 M.)', ref ? `${fmtNum(ref.summen.netto_db_eur_je_mw_jahr / 1000, 0)} T€/MW/a` : '–', '/portal/strommarkt?b=vergleich', 'Simulation'],
  ];
  return html`<section class="kpis" aria-label="Kennzahlen">${kpis.map(([l, v, h, hinweis]) => html`<a class="kpi" href="${h}"><span class="kpi-v num">${v}</span><span class="kpi-l">${l}${hinweis ? html` · ${hinweis}` : ''}</span></a>`)}</section>
<section class="panel"><div class="panel-head"><h2>Bereiche</h2><a class="btn btn-small" href="/portal/entwicklungsstand">Entwicklungsstand</a></div>
<div class="modul-grid">${sichtbar.map((m) => html`<a class="modul" href="${m.href}"><span class="modul-kopf"><strong>${m.titel}</strong>${status(m.status)}</span><span class="modul-text">${m.text}</span><span class="modul-fuss">${DATEN[m.daten]}</span></a>`)}</div></section>
<section class="panel"><h2>Datenstand</h2><div class="kv">
<div><span>Wirtschaftlichkeit</span><strong>Modell ${WM_VERSION} · ${db.finanzmodelle?.length || 0} Berechnungsversionen (synthetisch)</strong></div>
<div><span>Strommarkt & Backtesting</span><strong>${meta ? html`Lauf ${fmtDateTime(meta.lauf.berechnet_utc)} · Datenversion ${meta.datenversion} · ${meta.lauf.qualitaetsstatus}` : 'kein Export'}</strong></div>
<div><span>Shadow-Trading</span><strong>${plan ? html`Plan für ${datum(plan.liefertag)} (${plan.status}) · ${sh.bewertungen.length} Bewertung(en)` : 'noch kein Lauf'}</strong></div>
<div><span>Handel</span><strong>Keine realen Handelsaufträge, kein Börsenzugang</strong></div></div></section>`;
}

function netzentgelt(url) {
  const erg = D.lade('ergebnisse.json');
  const anlagen = [...new Set(erg.ergebnisse.map((r) => r.anlage))];
  const anlage = anlagen.includes(url.searchParams.get('anlage')) ? url.searchParams.get('anlage') : anlagen[0];
  const periode = PER[url.searchParams.get('periode')] ? url.searchParams.get('periode') : 'R24M';
  const strategien = Object.keys(STRAT).filter((k) => erg.ergebnisse.some((r) => r.strategie === k));
  const row = (v, k) => erg.ergebnisse.find((r) => r.anlage === anlage && r.periode === periode && r.netzvariante === v && r.strategie === k);
  return html`<section class="panel"><p class="lead-sm">Wirkung der Netzentgelte auf den Arbeitspreis des Speicherbezugs. Variante A unterstellt die Befreiung – <strong>die Befreiung ist nicht gesichert</strong>. Variante B: ohne Befreiung mit 10 €/MWh Arbeitspreis, Leistungspreis nicht quantifiziert. Simulation neutraler Anlagengrößen mit realen SMARD-Preisen, keine Projektdaten.</p>
<form method="get" class="stack-inline"><label>Anlage<select name="anlage">${anlagen.map((a) => html`<option${a === anlage ? raw(' selected') : ''}>${a}</option>`)}</select></label>
<label>Zeitraum<select name="periode">${Object.entries(PER).map(([k, l]) => html`<option value="${k}"${k === periode ? raw(' selected') : ''}>${l}</option>`)}</select></label><button class="btn" type="submit">Anzeigen</button></form></section>
<section class="panel"><h2>${anlage} · ${PER[periode]}</h2><div class="tbl-wrap"><table class="tbl tbl-num"><thead><tr><th>Strategie</th><th class="num">Netto-DB A</th><th class="num">Netto-DB B</th><th class="num">Netzentgelte B</th><th class="num">Unterschied</th><th class="num">€/MW/Jahr A</th><th class="num">€/MW/Jahr B</th></tr></thead><tbody>
${strategien.map((k) => { const a = row('befreit', k), b = row('ohne_befreiung', k); if (!a || !b) return ''; return html`<tr${k === 'B2' ? raw(' class="row-current"') : ''}><th scope="row">${STRAT[k]}</th><td class="num">${eur(a.summen.netto_arbitrage_db_eur, true)}</td><td class="num">${eur(b.summen.netto_arbitrage_db_eur, true)}</td><td class="num">${eur(-b.summen.netzentgelte_eur, true)}</td><td class="num">${eur(b.summen.netto_arbitrage_db_eur - a.summen.netto_arbitrage_db_eur, true)}</td><td class="num">${eur(a.summen.netto_db_eur_je_mw_jahr, true)}</td><td class="num">${eur(b.summen.netto_db_eur_je_mw_jahr, true)}</td></tr>`; })}
</tbody></table></div><p class="small muted">Netto-Arbitrage-Deckungsbeitrag nach Börsen-, Bilanzierungs-, Dienstleister-, Verschleiß- und Netzkosten, vor Fixkosten und Finanzierung. B2 ist Referenz, solange kein wirtschaftlicher Vorteil eines KI-Modells out-of-sample belegt ist.</p></section>
<section class="panel"><h2>Verbindung zum Wirtschaftlichkeitsrechner</h2><p>Die Varianten A/B sind im Trading-System berechnet. In STROMKAI-WM sind sie <span class="mark mark-aud">noch nicht als Eingabe integriert</span>; die Erlösannahmen im Rechner sind getrennt einzugeben. Fixe Betriebskosten aus Kostenplan und Kostenmodell widersprechen sich <span class="mark mark-warn">KLÄRUNGSBEDARF</span> und werden nicht automatisch übernommen.</p></section>`;
}

function shadow() {
  const sh = shadowStand();
  if (!sh) return html`<section class="panel"><p>Es liegt noch kein Shadow-Export vor.</p></section>`;
  const lauf = sh.laeufe.at(-1);
  return html`<section class="panel"><p class="lead-sm"><span class="mark mark-demo">Simulation</span> ${sh.hinweis} Keine realen Handelsaufträge, kein Börsenzugang.</p>
<div class="kv"><div><span>Letzter Lauf</span><strong>${lauf ? fmtDateTime(lauf.lauf_utc) : '–'}</strong></div><div><span>Datenstand</span><strong>${lauf?.datenversion || '–'}</strong></div><div><span>Export</span><strong>${fmtDateTime(sh.erzeugt_utc)} · ${sh.register_eintraege} Registereinträge</strong></div></div></section>
${[...sh.plaene].reverse().map((p) => html`<section class="panel"><div class="panel-head"><h2>Plan für Liefertag ${datum(p.liefertag)}</h2><span class="mark ${p.status === 'RECHTZEITIG' ? 'mark-ok' : 'mark-warn'}">${p.status}</span></div>
<p class="meta-line">${p.anlage.name} · ${p.anlage.p_mw} MW / ${p.anlage.e_mwh} MWh · erstellt ${fmtDateTime(p.erstellt_utc)} · Gebotsschluss ${fmtDateTime(p.gebotsschluss_lokal)} · Preise bis ${datum(p.preise_bis)} · Modell ${p.modell?.version || '–'} (Training bis ${datum(p.modell?.trainingsdaten_bis)}, ${p.modell?.echtzeitgetreu ? 'echtzeitgetreu' : 'nicht echtzeitgetreu'})</p>
<div class="tbl-wrap"><table class="tbl tbl-num"><thead><tr><th>Strategie</th><th class="num">Virtuelle Käufe</th><th class="num">Virtuelle Verkäufe</th><th class="num">Viertelstunden Kauf/Verkauf</th><th class="num">Erwarteter Handelssaldo (Prognosepreise)</th><th class="num">Ergebnis nach Bewertung</th></tr></thead><tbody>
${Object.entries(p.strategien).map(([k, s]) => { const b = sh.bewertungen.find((x) => x.liefertag === p.liefertag); const e = b?.ergebnisse?.[k]; return html`<tr><th scope="row">${STRAT[k] || k}</th><td class="num">${fmtNum(s.kauf_mwh, 1)} MWh</td><td class="num">${fmtNum(s.verkauf_mwh, 1)} MWh</td><td class="num">${s.kauf_viertelstunden} / ${s.verkauf_viertelstunden}</td><td class="num">${eur(s.prognose_handelssaldo_eur, true)}</td><td class="num">${e ? eur(e.netto_arbitrage_db_eur ?? e.netto_db_eur ?? NaN, true) : html`<span class="muted">ausstehend</span>`}</td></tr>`; })}
</tbody></table></div>
<p class="small muted">Risikoprüfung: ${Object.entries(p.risiko.gebote).map(([k, v]) => `${k} ${v}`).join(' · ')} · Verstöße ${p.risiko.verstoesse.length} · Prüfkette ${p.risiko.auditkette_ok ? 'in Ordnung' : 'FEHLER'}. ${p.risiko.hinweis || ''} Erwarteter Handelssaldo vor Kosten, auf Prognosepreisen; maßgeblich ist die spätere Bewertung mit Ist-Preisen.</p></section>`)}
<section class="panel"><h2>Laufprotokoll</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Lauf</th><th>Ziel-Liefertag</th><th>Datenversion</th><th>Plan</th><th class="num">Auktionen</th><th class="num">Bewertet</th></tr></thead><tbody>
${[...sh.laeufe].reverse().map((l) => html`<tr><td>${fmtDateTime(l.lauf_utc)}</td><td>${datum(l.ziel_liefertag)}</td><td>${l.datenversion}</td><td>${l.plan_status || l.fehler || '–'}</td><td class="num">${l.auktionen}</td><td class="num">${l.bewertet}</td></tr>`)}</tbody></table></div></section>`;
}

function entwicklungsstand() {
  const meta = D.verfuegbar() ? D.lade('meta.json') : null;
  const offen = [
    ['Fixe Betriebskosten', 'Kostenplan und Kostenmodell widersprechen sich (Faktor 3); keine automatische Übernahme', 'KLÄRUNGSBEDARF'],
    ['Excel-Vergütungsmodell K1–K8', 'Bauzeit, Mindestpreis/Cap, Optionsmonate, Fläche, 4.000 vs. 25.000 €/ha, Bauphasenvergütung, Zahlungszeitpunkt, VPI auf Mindestpacht', 'KLÄRUNGSBEDARF'],
    ['Netzentgelt A/B im Rechner', 'Varianten im Trading-System berechnet, in STROMKAI-WM noch keine Eingabe', 'GEPLANT'],
    ['KI gegenüber B2', 'B2 bleibt Referenz, bis ein wirtschaftlicher Vorteil out-of-sample belegt ist; historische Prognosen mit Einschränkung', 'PRÜFUNGSBEDÜRFTIG'],
    ['Shadow-Bewertung', 'Erste Bewertung nach Vorliegen der Ist-Preise des ersten Liefertags', 'AUSSTEHEND'],
    ['Persistente Datenbank', 'Blob-JSON-Speicher nicht produktionsreif; Plan in docs/FINANZMODELL.md §8, nichts bestellt', 'GEPLANT'],
    ['Modulrechte je Benutzer', 'Rechte heute über Rollen und Projektrechte; zeitlich begrenzte Modulfreigaben noch nicht umgesetzt', 'GEPLANT'],
    ['Echtbetrieb', 'Demo-Daten entfernen, reale Abrechnung und Handel nicht freigegeben', 'GESPERRT'],
  ];
  return html`<section class="panel"><h2>Module</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bereich</th><th>Status</th><th>Umgebung</th><th>Daten</th><th>Aufträge</th></tr></thead><tbody>
${MODULE.map((m) => html`<tr><td><a href="${m.href}">${m.titel}</a></td><td>${status(m.status)}</td><td>${m.status === 'live' ? 'Öffentlicher Abnahmekandidat und QA' : 'Nur geschützte QA-Vorschau'}</td><td>${DATEN[m.daten]}</td><td>${m.auftrag}</td></tr>`)}</tbody></table></div>
<p class="small muted">Trading-Ergebnisse: STROMKAI-Trading-System ${meta ? html`(Software ${meta.software}, Lauf ${meta.lauf.git}, Datenversion ${meta.datenversion})` : ''}, als geprüfter Export eingebunden; das lokale Trading-Dashboard bleibt Entwicklungswerkzeug und benötigt keinen eigenen Zugang.</p></section>
<section class="panel"><h2>Offene Prüfpunkte</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Thema</th><th>Stand</th><th>Status</th></tr></thead><tbody>${offen.map(([t, d, s]) => html`<tr><td>${t}</td><td>${d}</td><td><span class="mark ${s === 'GESPERRT' ? 'mark-warn' : s === 'GEPLANT' || s === 'AUSSTEHEND' ? 'mark-aud' : 'mark-info'}">${s}</span></td></tr>`)}</tbody></table></div></section>`;
}

export function handleZentrale({ path, method, u, view, url }) {
  const routen = { '/portal/zentrale': 'zentrale', '/portal/netzentgelt': 'netzentgelt', '/portal/shadow-trading': 'shadow', '/portal/entwicklungsstand': 'entwicklung' };
  const k = routen[path];
  if (!k) return null;
  const m = MODULE.find((x) => x.key === k);
  const darf = k === 'zentrale' ? P.isAdmin(u) : m.recht(u);
  if (!darf) throw new HttpError(404, 'Nicht gefunden');
  if (method !== 'GET') throw new HttpError(405, 'Nicht erlaubt');
  if (k === 'zentrale') return view('Zentrale', zentrale(u), 'Alle Bereiche mit einem Login');
  if (k === 'netzentgelt') return D.verfuegbar() ? view('Netzentgelt-Szenarien', netzentgelt(url), 'Variante A und B · Simulation · intern') : view('Netzentgelt-Szenarien', html`<section class="panel"><p>Kein Export vorhanden.</p></section>`);
  if (k === 'shadow') return view('Shadow-Trading', shadow(), 'Täglicher simulierter Handelsplan · ohne Börsenzugang');
  return view('Entwicklungsstand', entwicklungsstand(), 'Module, Umgebungen, offene Prüfpunkte');
}
