// Portalmodul „Strommarkt & Backtesting“ (intern). Auftrag AW-20261029-GE-CLAUDE-STROMKAI-STUFE2-013.
// Rechte: nur Plattformadministration und Projektleitung; alle anderen Rollen erhalten 404 (wie nicht vorhanden).
// Inhalt: reale DA-Preise (SMARD, CC BY 4.0) und Simulationen neutraler Anlagengrößen. Keine Projektzuordnung,
// keine Projektfinanzdaten, keine Handelsfunktion. Diagramme werden serverseitig als SVG erzeugt (CSP ohne Inline-Skripte).
import { html, raw, fmtNum, fmtDateTime } from '../lib/html.mjs';
import { rolesOf } from '../lib/policy.mjs';
import * as D from '../lib/strommarkt/daten.mjs';

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
export const darfStrommarkt = (u) => rolesOf(u).some((r) => r === 'admin' || r === 'projektleitung');

const BEREICHE = [['uebersicht', 'Übersicht'], ['markt', 'Marktdaten & Qualität'], ['preise', 'Preisanalyse'], ['tag', 'Handelstag'],
  ['vergleich', 'Strategievergleich'], ['ergebnisse', 'Monate, Jahre & Kosten'], ['groessen', 'Anlagengrößen'], ['modelle', 'KI-Modelle']];
const PER = { KJ2024: 'Kalenderjahr 2024', KJ2025: 'Kalenderjahr 2025', KJ2026_bis: '2026 bis 28.10.', R24M: '29.10.2024–28.10.2026' };
const ORDER = ['A', 'A_tag', 'B1', 'B2', 'B3', 'C_gbm', 'C_ridge', 'C_mlp', 'C_gbm_fund'];
const eur = (v) => (v == null ? '–' : `${fmtNum(v)} €`);
const n1 = (v) => fmtNum(v, 1);

function herkunft(k) {
  if (k === 'A' || k === 'A_tag') return html`<span class="mark mark-warn" title="Mit Zukunftswissen berechnet">Zukunftswissen · nicht handelbar</span>`;
  if (k === 'C_gbm_fund') return html`<span class="mark mark-demo" title="Prognosefassungen nicht als damalige Version belegt">nicht vollständig echtzeitgetreu</span>`;
  if (k?.startsWith('C_')) return html`<span class="mark mark-info">KI · out-of-sample</span>`;
  if (k === 'B2') return html`<span class="mark mark-ok">Referenzmodell</span>`;
  return html`<span class="mark mark-ok">nur damals bekannte Daten</span>`;
}

// ---------- SVG-Diagramme (Farben über Klassen in strommarkt.css) ----------
function skala(werte, mitNull = true) {
  let lo = Infinity, hi = -Infinity;
  for (const v of werte) if (v != null && Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  if (mitNull) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const pad = (hi - lo) * 0.06 || 1; return [lo - pad, hi + pad];
}
function ticks(lo, hi, n = 5) {
  const span = hi - lo || 1, roh = span / n, mag = 10 ** Math.floor(Math.log10(roh));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => span / s <= n) || roh;
  const t = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) t.push(+v.toFixed(8)); return t;
}
function diagramm({ labels, serien = [], balken = null, stufen = false, titel, einheit = '', hoehe = 240, xTicks = 8 }) {
  const W = 900, H = hoehe, L = 56, R = 12, T = 10, B = 26;
  const alle = [...serien.flatMap((s) => s.werte), ...(balken || [])];
  const [lo, hi] = skala(alle);
  const n = labels.length + (stufen ? 1 : 0);
  const X = (i) => L + (n <= 1 ? 0 : (i * (W - L - R)) / (n - 1));
  const Y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo || 1);
  const out = [`<svg class="sm-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${titel.replace(/"/g, '')}"><title>${titel.replace(/</g, '')}</title>`];
  for (const v of ticks(lo, hi)) out.push(`<line class="sm-grid" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="sm-ax" x="${L - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${fmtNum(v, Math.abs(v) < 10 && v !== 0 ? 1 : 0)}</text>`);
  if (lo < 0 && hi > 0) out.push(`<line class="sm-zero" x1="${L}" x2="${W - R}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>`);
  const every = Math.max(1, Math.ceil(labels.length / xTicks));
  labels.forEach((l, i) => { if (i % every === 0) out.push(`<text class="sm-ax" x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${String(l).replace(/[<&]/g, '')}</text>`); });
  if (balken) {
    const bw = Math.max(1, ((W - L - R) / Math.max(balken.length, 1)) * 0.72);
    balken.forEach((v, i) => { if (v == null) return; const y0 = Y(0), y1 = Y(v); out.push(`<rect class="${v < 0 ? 'sm-neg' : 'sm-bar'}" x="${(X(i) - bw / 2).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, Math.abs(y1 - y0)).toFixed(1)}"><title>${String(labels[i]).replace(/[<&]/g, '')}: ${fmtNum(v, 1)} ${einheit}</title></rect>`); });
  }
  for (const s of serien) {
    let d = '';
    s.werte.forEach((v, i) => {
      if (v == null) return;
      d += stufen ? `${d ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}L${X(i + 1).toFixed(1)},${Y(v).toFixed(1)}` : `${d ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
    });
    out.push(`<path class="sm-l ${s.klasse}" d="${d}"/>`);
  }
  out.push('</svg>');
  return raw(out.join(''));
}
const legende = (eintraege) => html`<p class="sm-legend">${eintraege.map(([k, t]) => html`<span><i class="sm-key ${k}"></i>${t}</span>`)}</p>`;

// ---------- Bereiche ----------
function kopf(meta) {
  const l = meta.lauf;
  return html`<section class="panel sm-hint"><p><span class="mark mark-info">reale Marktpreise</span> Day-Ahead DE-LU, Quelle Bundesnetzagentur | SMARD.de (CC BY 4.0).
<span class="mark mark-demo">Simulation</span> Anlagen, Kosten und Fahrpläne sind Simulationen ohne Projektzuordnung. Ergebnisse sind historische Deckungsbeiträge, kein Gewinn und keine Prognose. Kein Echtgeldhandel.</p>
<p class="small muted">Datenversion ${meta.datenversion} · Lauf ${l.lauf} vom ${fmtDateTime(l.berechnet_utc)} · Git ${l.git} · Ergebnis-Hash ${l.ergebnis_hash} · <span class="mark ${l.qualitaetsstatus === 'PHYSIK_GEPRUEFT' ? 'mark-ok' : 'mark-warn'}">${l.qualitaetsstatus}</span></p></section>`;
}

function ergebnisZeilen(rows, opts = {}) {
  const by = Object.fromEntries(rows.map((r) => [r.strategie, r]));
  const A = by.A?.summen.netto_arbitrage_db_eur, B2 = by.B2?.summen.netto_arbitrage_db_eur;
  return html`<div class="tbl-wrap"><table class="tbl tbl-num"><thead><tr><th>Strategie</th><th class="num">Brutto-Handelssaldo</th><th class="num">Variable Kosten</th><th class="num">Netto-Arbitrage-DB</th><th class="num">€/MW/Jahr</th><th class="num">Anteil am Optimum</th><th class="num">Δ zu B2</th><th class="num">Vollzyklen/Jahr</th><th class="num">Verlusttage</th></tr></thead><tbody>
${ORDER.filter((k) => by[k] && (!opts.nur || opts.nur.includes(k))).map((k) => { const s = by[k].summen; return html`<tr><td><strong>${k}</strong> ${herkunft(k)}<br><span class="small muted">${opts.labels?.[k] || ''}</span></td><td class="num">${eur(s.brutto_handelssaldo_eur)}</td><td class="num">${eur(s.brutto_handelssaldo_eur - s.netto_arbitrage_db_eur)}</td><td class="num"><strong>${eur(s.netto_arbitrage_db_eur)}</strong></td><td class="num">${fmtNum(s.netto_db_eur_je_mw_jahr)}</td><td class="num">${A ? `${n1((100 * s.netto_arbitrage_db_eur) / A)} %` : '–'}</td><td class="num">${B2 != null && k !== 'B2' ? eur(s.netto_arbitrage_db_eur - B2) : '–'}</td><td class="num">${fmtNum(s.vollzyklen_je_jahr)}</td><td class="num">${fmtNum(s.verlusttage)}</td></tr>`; })}
</tbody></table></div>`;
}

function auswahl(url, felder) {
  const b = BEREICHE.some(([k]) => k === url.searchParams.get('b')) ? url.searchParams.get('b') : 'uebersicht';
  return html`<form class="sm-form" method="get" action="/portal/strommarkt"><input type="hidden" name="b" value="${b}">${felder}<button class="btn btn-small" type="submit">Anzeigen</button></form>`;
}
const select = (name, wert, optionen) => html`<label>${optionen.label}<select name="${name}">${optionen.werte.map(([v, t]) => html`<option value="${v}"${v === wert ? raw(' selected') : ''}>${t}</option>`)}</select></label>`;

function bereichUebersicht(meta, erg) {
  const r = erg.ergebnisse.filter((x) => x.anlage.includes('15 MW') && x.netzvariante === 'befreit' && x.periode === 'R24M');
  const g = (k) => r.find((x) => x.strategie === k)?.summen;
  return html`<section class="kpis">
<div class="kpi"><span class="kpi-l">Optimum A (Zukunftswissen, nicht handelbar)</span><span class="kpi-v">${fmtNum(g('A')?.netto_db_eur_je_mw_jahr)} €</span><span class="small muted">je MW und Jahr, 24 Monate</span></div>
<div class="kpi"><span class="kpi-l">Referenzmodell B2 (Rolling Horizon)</span><span class="kpi-v">${fmtNum(g('B2')?.netto_db_eur_je_mw_jahr)} €</span><span class="small muted">${n1((100 * g('B2')?.netto_arbitrage_db_eur) / g('A')?.netto_arbitrage_db_eur)} % von A</span></div>
<div class="kpi"><span class="kpi-l">KI-Strategie C_gbm (out-of-sample)</span><span class="kpi-v">${fmtNum(g('C_gbm')?.netto_db_eur_je_mw_jahr)} €</span><span class="small muted">${n1((100 * g('C_gbm')?.netto_arbitrage_db_eur) / g('A')?.netto_arbitrage_db_eur)} % von A</span></div>
<div class="kpi"><span class="kpi-l">Datenbestand</span><span class="kpi-v">${fmtNum(meta.vollstaendigkeit.tage)} Tage</span><span class="small muted">${meta.tage[0]} bis ${meta.tage[1]}, ${meta.vollstaendigkeit.unvollstaendig} unvollständig</span></div></section>
<section class="panel"><h2>Bewertung</h2><p>Primäres Erfolgskriterium ist der wirtschaftliche Deckungsbeitrag unter realistischen Bedingungen. Das Referenzmodell ist <strong>B2</strong>. Die KI-Strategie C_gbm hat einen kleineren Prognosefehler, erreicht aber im Backtest <strong>nicht</strong> mehr Deckungsbeitrag als B2. Das Modell mit Fundamentaldaten (C_gbm_fund) gilt erst als belegt, wenn die damaligen Prognosefassungen und ihre Verfügbarkeit nachgewiesen sind.</p>
<p class="small muted">Simulationsanlage 15 MW / 30 MWh, Netzentgelt-Variante „befreit“ (Befreiung nach § 118 Abs. 6 EnWG nicht gesichert; Variante ohne Befreiung im Bereich „Monate, Jahre & Kosten“).</p></section>`;
}

function bereichMarkt(meta) {
  const q = meta.qualitaet, v = meta.vollstaendigkeit, ps = q.produktumstellung, ec = q.kontrolle_energy_charts || {};
  return html`<section class="panel"><h2>Datenbestand und Qualität</h2><div class="tbl-wrap"><table class="tbl"><tbody>
<tr><th>Datenversion</th><td>${meta.datenversion}</td></tr>
<tr><th>Zeitraum</th><td>${meta.tage[0]} bis ${meta.tage[1]} · ${fmtNum(q.zeitraum_importiert.intervalle)} Lieferintervalle</td></tr>
<tr><th>Produkte</th><td>Stundenprodukte bis 30.09.2025, Viertelstundenprodukte ab 01.10.2025 (jeweils nur das tatsächlich gehandelte Produkt)</td></tr>
<tr><th>Vollständigkeit</th><td>${v.unvollstaendig} unvollständige Tage, ${v.rasterbrueche} Rasterbrüche, ${v.zeitumstellungstage.length} Zeitumstellungstage vollständig</td></tr>
<tr><th>Unabhängige Kontrollrechnung</th><td>${Object.keys(q.kontrolle_unabhaengige_rechnung.abweichungen).length} Abweichungen auf ${fmtNum(q.kontrolle_unabhaengige_rechnung.tage_verglichen)} Tagen</td></tr>
<tr><th>Quervergleich Energy-Charts</th><td>${n1((ec.anteil_tage_diff_le_0_01 || 0) * 100)} % der Tage mit Abweichung ≤ 0,01 €/MWh (nur intern)</td></tr>
<tr><th>Produktumstellung</th><td>${ps.bewertung}</td></tr></tbody></table></div></section>
<section class="panel"><h2>Quellen und Lizenzen</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Quelle</th><th>Rolle</th><th>Lizenz / Status</th></tr></thead><tbody>
${Object.values(meta.quellen).map((s) => html`<tr><td>${s.name}</td><td>${s.role}</td><td>${s.license}</td></tr>`)}</tbody></table></div></section>`;
}

function bereichPreise(meta, preise) {
  const st = meta.statistik;
  const zeilen = [['Mittel (zeitgewichtet) €/MWh', 'mittel_zeitgewichtet'], ['Minimum €/MWh', 'min'], ['Maximum €/MWh', 'max'], ['Stunden mit negativem Preis', 'stunden_negativ'], ['Tagesspanne Mittel €/MWh', 'tagesspanne_mittel']];
  const t = preise.tage.filter((x) => x[0] >= '2024-01-01');
  const prof = Object.keys(PER).filter((p) => st[p]);
  return html`<section class="panel"><h2>Historische Strompreise (Tageswerte)</h2>${legende([['k1', 'Tagesmittel'], ['k4', 'Tagesmaximum'], ['k3', 'Tagesminimum']])}
${diagramm({ labels: t.map((x) => x[0]), serien: [{ werte: t.map((x) => x[3]), klasse: 'k4 thin' }, { werte: t.map((x) => x[2]), klasse: 'k3 thin' }, { werte: t.map((x) => x[1]), klasse: 'k1' }], titel: 'Tagespreise Day-Ahead', einheit: '€/MWh', hoehe: 260, xTicks: 10 })}</section>
<section class="panel"><h2>Kennzahlen</h2><div class="tbl-wrap"><table class="tbl tbl-num"><thead><tr><th>Kennzahl</th>${prof.map((p) => html`<th class="num">${PER[p]}</th>`)}</tr></thead><tbody>
${zeilen.map(([l, k]) => html`<tr><td>${l}</td>${prof.map((p) => html`<td class="num">${fmtNum(st[p][k], 1)}</td>`)}</tr>`)}</tbody></table></div></section>
<section class="grid-2"><div class="panel"><h2>Tagesprofil</h2>${legende(prof.map((p, i) => [`k${i + 1}`, PER[p]]))}
${diagramm({ labels: [...Array(24).keys()].map((h) => `${h}:00`), serien: prof.map((p, i) => ({ werte: Object.values(st[p].profil_stunde), klasse: `k${i + 1}` })), titel: 'Mittlerer Preis je Stunde', einheit: '€/MWh' })}</div>
<div class="panel"><h2>Wochentage (Mo–So)</h2>${diagramm({ labels: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], serien: prof.map((p, i) => ({ werte: Object.values(st[p].profil_wochentag), klasse: `k${i + 1}` })), titel: 'Mittlerer Preis je Wochentag', einheit: '€/MWh' })}</div></section>`;
}

function bereichTag(meta, url) {
  const datum = url.searchParams.get('tag') || '2025-06-15';
  const t = D.tag(datum);
  const form = auswahl(url, html`<label>Liefertag<input type="date" name="tag" value="${datum}" min="2024-01-01" max="${meta.tage[1]}"></label>`);
  if (!t) return html`<section class="panel">${form}<p>Für ${datum} liegt keine Simulation vor (verfügbar 01.01.2024 bis ${meta.tage[1]}).</p></section>`;
  const ks = ['A_tag', 'B2', 'C_gbm'];
  const kl = { A_tag: 'k7', B2: 'k5', C_gbm: 'k1' };
  return html`<section class="panel">${form}<p class="small muted">Simulationsanlage 15 MW / 30 MWh, Start- und Endfüllstand 50 %. Jeder Tag ist im Trading-System einzeln optimiert und zu tatsächlichen Preisen abgerechnet. Parameteränderungen sind im lokalen Labor möglich, nicht im Portal. KI-Modellversion: ${t.modellversion_c || '–'}.</p></section>
<section class="panel"><h2>Preis und Prognosen · ${datum}</h2>${legende([['k0', 'Tatsächlicher DA-Preis'], ['k5 dash', 'Prognose B2'], ['k1 dash', 'Prognose C_gbm']])}
${diagramm({ labels: t.t, serien: [{ werte: t.p, klasse: 'k0 thick' }, { werte: t.s.B2.prognose, klasse: 'k5 dash' }, { werte: t.s.C_gbm.prognose, klasse: 'k1 dash' }], titel: 'Preis und Prognosen', einheit: '€/MWh' })}</section>
<section class="grid-2"><div class="panel"><h2>Lade- und Entladefahrplan (MW, Einspeisung +)</h2>${legende(ks.map((k) => [kl[k], k]))}
${diagramm({ labels: t.t, serien: ks.map((k) => ({ werte: t.s[k].netz_mw, klasse: kl[k] })), stufen: true, titel: 'Fahrplan', einheit: 'MW' })}</div>
<div class="panel"><h2>Speicherfüllstand (MWh)</h2>${diagramm({ labels: [...t.t, '24:00'], serien: ks.map((k) => ({ werte: t.s[k].soc, klasse: kl[k] })), titel: 'Füllstand', einheit: 'MWh' })}</div></section>
<section class="panel"><h2>Tagesergebnis</h2><div class="tbl-wrap"><table class="tbl tbl-num"><thead><tr><th>Strategie</th><th class="num">Gekauft MWh</th><th class="num">Verkauft MWh</th><th class="num">Verkaufserlös</th><th class="num">Bezugskosten</th><th class="num">Handelskosten</th><th class="num">Verschleiß</th><th class="num">Tagesergebnis (Netto-DB)</th></tr></thead><tbody>
${ks.map((k) => { const e = t.s[k].e; return html`<tr><td><strong>${k}</strong> ${herkunft(k)}</td><td class="num">${n1(e.geladen_mwh)}</td><td class="num">${n1(e.entladen_mwh)}</td><td class="num">${eur(e.verkaufserloes_eur)}</td><td class="num">${eur(e.bezugskosten_eur)}</td><td class="num">${eur(e.boersengebuehren_eur + e.bilanzierung_eur + e.dienstleister_eur)}</td><td class="num">${eur(e.verschleiss_eur)}</td><td class="num"><strong>${eur(e.netto_arbitrage_db_eur)}</strong></td></tr>`; })}
</tbody></table></div></section>`;
}

function filterForm(url, erg, { mitStrategie = false } = {}) {
  const anlagen = [...new Set(erg.ergebnisse.map((x) => x.anlage))];
  const a = url.searchParams.get('anlage') || anlagen[0];
  const p = url.searchParams.get('periode') || 'R24M';
  const n = url.searchParams.get('netz') || 'befreit';
  const s = url.searchParams.get('strategie') || 'B2';
  const form = auswahl(url, html`${select('anlage', a, { label: 'Anlage', werte: anlagen.map((x) => [x, x]) })}${select('periode', p, { label: 'Zeitraum', werte: Object.entries(PER) })}${select('netz', n, { label: 'Netzentgelt', werte: [['befreit', 'befreit (nicht gesichert)'], ['ohne_befreiung', 'ohne Befreiung (Annahme)']] })}${mitStrategie ? select('strategie', s, { label: 'Strategie', werte: ORDER.map((k) => [k, k]) }) : ''}`);
  return { a, p, n, s, form, rows: erg.ergebnisse.filter((x) => x.anlage === a && x.periode === p && x.netzvariante === n) };
}

function bereichVergleich(meta, erg, url) {
  const f = filterForm(url, erg);
  return html`<section class="panel">${f.form}</section><section class="panel"><h2>Theoretisches Optimum, Referenzmodell und KI-Strategien</h2>${ergebnisZeilen(f.rows, { labels: meta.strategien })}
<p class="small muted">A und A_tag kennen die Preise im Voraus und dienen nur als Obergrenze. B und C nutzen nur Daten, die zum Gebotsschluss D−1 12:00 bekannt waren. Gebote sind preisunabhängige Mengengebote zum tatsächlichen Auktionspreis. Intraday und Regelleistung sind nicht enthalten.</p></section>`;
}

function bereichErgebnisse(meta, erg, url) {
  const f = filterForm(url, erg, { mitStrategie: true });
  const r = f.rows.find((x) => x.strategie === f.s);
  const posten = [['Verkaufserlös', 'verkaufserloes_eur', 1], ['Bezugskosten', 'bezugskosten_eur', -1], ['Restenergiewert', 'restenergiewert_eur', 1], ['Brutto-Handelssaldo', 'brutto_handelssaldo_eur', 1], ['Hilfsenergie', 'hilfsenergie_eur', -1], ['Börse und Clearing', 'boersengebuehren_eur', -1], ['Bilanzierung', 'bilanzierung_eur', -1], ['Netzentgelte Bezug', 'netzentgelte_eur', -1], ['Steuern und Abgaben', 'steuern_abgaben_eur', -1], ['Dienstleister', 'dienstleister_eur', -1], ['Batterieverschleiß', 'verschleiss_eur', -1], ['Netto-Arbitrage-DB', 'netto_arbitrage_db_eur', 1]];
  if (!r) return html`<section class="panel">${f.form}<p>Keine Daten.</p></section>`;
  const jahre = {};
  for (const m of r.monatlich) { const y = m.monat.slice(0, 4); jahre[y] = (jahre[y] || 0) + m.netto_arbitrage_db_eur; }
  return html`<section class="panel">${f.form}</section>
<section class="panel"><h2>Monatsergebnisse ${f.s} ${herkunft(f.s)}</h2>${diagramm({ labels: r.monatlich.map((m) => m.monat), balken: r.monatlich.map((m) => m.netto_arbitrage_db_eur), titel: 'Netto-Arbitrage-DB je Monat', einheit: '€' })}
<div class="tbl-wrap"><table class="tbl tbl-num tbl-compact"><thead><tr><th>Jahr (im gewählten Zeitraum)</th><th class="num">Netto-Arbitrage-DB</th></tr></thead><tbody>${Object.entries(jahre).map(([y, v]) => html`<tr><td>${y}</td><td class="num">${eur(v)}</td></tr>`)}</tbody></table></div></section>
<section class="panel"><h2>Erlöse und Handelskosten</h2><div class="tbl-wrap"><table class="tbl tbl-num"><tbody>${posten.map(([l, k, sg]) => html`<tr><td>${l}</td><td class="num">${eur(sg * r.summen[k])}</td></tr>`)}</tbody></table></div>
<p class="small muted">Annahmen mit Status: ${Object.entries(meta.annahmen).map(([k, v]) => html`<br>· ${k}: ${v}`)}</p></section>`;
}

function bereichGroessen(erg) {
  const g = erg.groessen;
  const anl = [...new Set(g.map((x) => x.anlage))];
  const v = (a, s, k) => g.find((x) => x.anlage === a && x.strategie === s)?.summen[k];
  return html`<section class="panel"><h2>Anlagengrößen im Vergleich (29.10.2024–28.10.2026)</h2><p><span class="mark mark-demo">Simulationen, keine geplanten Projektgrößen</span></p>
<div class="tbl-wrap"><table class="tbl tbl-num"><thead><tr><th>Anlage</th><th class="num">A €/MW/a</th><th class="num">B2 €/MW/a</th><th class="num">C_gbm €/MW/a</th><th class="num">B2 €/MWh/a</th><th class="num">B2 Zyklen/a</th><th class="num">B2 / A</th></tr></thead><tbody>
${anl.map((a) => html`<tr><td>${a}</td><td class="num">${fmtNum(v(a, 'A', 'netto_db_eur_je_mw_jahr'))}</td><td class="num">${fmtNum(v(a, 'B2', 'netto_db_eur_je_mw_jahr'))}</td><td class="num">${fmtNum(v(a, 'C_gbm', 'netto_db_eur_je_mw_jahr'))}</td><td class="num">${fmtNum(v(a, 'B2', 'netto_db_eur_je_mwh_nutzbar_jahr'))}</td><td class="num">${fmtNum(v(a, 'B2', 'vollzyklen_je_jahr'))}</td><td class="num">${n1((100 * v(a, 'B2', 'netto_db_eur_je_mw_jahr')) / v(a, 'A', 'netto_db_eur_je_mw_jahr'))} %</td></tr>`)}
</tbody></table></div>${diagramm({ labels: anl, balken: anl.map((a) => v(a, 'B2', 'netto_db_eur_je_mw_jahr')), titel: 'B2 je MW und Jahr', einheit: '€/MW/a', xTicks: 6 })}
<p class="small muted">Gleiche Speicherdauer ergibt je MW gleiche Werte, weil das Modell weder Preiswirkung noch Größenvorteile kennt.</p></section>`;
}

function bereichModelle(meta) {
  const mr = meta.modellregister;
  return html`${Object.entries(meta.prognosequalitaet).map(([p, rows]) => html`<section class="panel"><h2>Prognosequalität · ${PER[p]}</h2><div class="tbl-wrap"><table class="tbl tbl-num"><thead><tr><th>Modell</th><th class="num">MAE €/MWh</th><th class="num">RMSE €/MWh</th><th class="num">Bias</th><th class="num">Tagesprofil-Korrelation</th></tr></thead><tbody>
${rows.map((r) => html`<tr><td>${r.modell} ${r.modell === 'gbm_fund' ? herkunft('C_gbm_fund') : ['naiv_d1', 'saisonal_d7', 'saisonal_mix'].includes(r.modell) ? html`<span class="mark mark-aud">Baseline</span>` : ''}</td><td class="num">${fmtNum(r.MAE, 2)}</td><td class="num">${fmtNum(r.RMSE, 2)}</td><td class="num">${fmtNum(r.Bias, 2)}</td><td class="num">${fmtNum(r.Tagesprofil_Korrelation, 3)}</td></tr>`)}</tbody></table></div></section>`)}
<section class="panel"><h2>Modellversionen</h2><p>${mr.anzahl} Modellversionen, monatliches Neutraining nur mit Liefertagen vor dem Monatsbeginn (Walk-forward). Jüngster Stand:</p>
<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Modellversion</th><th>Trainiert (simuliert)</th><th>Trainingsdaten bis</th><th>Testzeitraum</th><th>Echtzeitgetreu</th></tr></thead><tbody>
${mr.letzte.map((r) => html`<tr><td>${r.modellversion}</td><td>${r.trainiert_simuliert_lokal}</td><td>${r.trainingsdaten_bis_liefertag}</td><td>${r.testzeitraum.join(' – ')}</td><td>${r.echtzeitgetreu ? 'ja' : html`<span class="mark mark-demo">nein</span>`}</td></tr>`)}</tbody></table></div>
<p class="small muted">Kein Sprachmodell als Preisprognose. Primäres Kriterium ist der Deckungsbeitrag, nicht der Prognosefehler.</p></section>`;
}

export function handleStrommarkt({ path, method, u, view, url }) {
  if (path !== '/portal/strommarkt') return null;
  if (!darfStrommarkt(u)) throw new HttpError(404, 'Nicht gefunden');
  if (method !== 'GET') throw new HttpError(405, 'Nicht erlaubt');
  if (!D.verfuegbar()) return view('Strommarkt & Backtesting', html`<section class="panel"><p>Es liegen noch keine Ergebnisdaten vor.</p></section>`);
  const meta = D.lade('meta.json'), erg = D.lade('ergebnisse.json');
  const b = BEREICHE.some(([k]) => k === url.searchParams.get('b')) ? url.searchParams.get('b') : 'uebersicht';
  const tabs = html`<nav class="tabs" aria-label="Bereiche">${BEREICHE.map(([k, t]) => html`<a href="/portal/strommarkt?b=${k}"${k === b ? raw(' aria-current="page"') : ''}>${t}</a>`)}</nav>`;
  const inhalt = { uebersicht: () => bereichUebersicht(meta, erg), markt: () => bereichMarkt(meta), preise: () => bereichPreise(meta, D.lade('preise_tage.json')),
    tag: () => bereichTag(meta, url), vergleich: () => bereichVergleich(meta, erg, url), ergebnisse: () => bereichErgebnisse(meta, erg, url),
    groessen: () => bereichGroessen(erg), modelle: () => bereichModelle(meta) }[b]();
  return view('Strommarkt & Backtesting', html`${raw('<link rel="stylesheet" href="/static/css/strommarkt.css">')}${tabs}${kopf(meta)}${inhalt}`, 'Historische Day-Ahead-Preise und BESS-Simulation · intern');
}

export { HttpError as StrommarktHttpError };
