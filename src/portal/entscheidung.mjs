// Entscheidungsübersicht eines Planungsstands (Folgeauftrag „Fachliche Transparenz und visuelle Entscheidungsgrundlage“).
// Ebene 1 (Management): Kennzahlen mit Erläuterung, Anlagenfluss, Investitionsstruktur, Szenarien, Cashflow, Abgleich,
// Sensitivität, Datenqualität. Ebene 2 (Fachprüfung): aufklappbare Eingangsparameter, Formeln, Quellen, Versionen, Prüfsummen.
// Alle Werte stammen aus rechneVariante/WM.berechne (siehe src/lib/planer/auswertung.mjs); Diagramme haben je eine Datentabelle.
import { html, raw, esc, fmtDateTime } from '../lib/html.mjs';
import { eur, num, pct } from '../lib/finance/geld.mjs';
import * as WM from '../lib/finance/wirtschaftlichkeit.mjs';
import * as IP from '../lib/planer/planer.mjs';
import * as AW from '../lib/planer/auswertung.mjs';
import * as REF from '../lib/finance/referenz.mjs';

const SZ = Object.keys(WM.SZENARIEN);
const n1 = (x) => num(x, 1);
const vz = (x) => (x == null || !Number.isFinite(x) ? '' : x < 0 ? 'ed-neg' : x > 0 ? 'ed-pos' : '');
const eurV = (x) => (x == null ? '–' : `${x > 0 ? '+' : ''}${eur(x, true)}`);
const qmark = (st) => html`<span class="mark ${AW.QUALITAET[st]?.mark || 'mark-aud'}">${AW.QUALITAET[st]?.name || st}</span>`;
const GRENZEN = 'Vereinfachtes Jahresmodell vor Steuern: keine Steuern, kein Working Capital, kein Restwert, keine Bankkovenants, Sculpting oder Cash-Sweeps.';
const DSCR_TEXT = 'Modell-DSCR vor Steuern = EBITDA / Schuldendienst je Jahr. Kein bankfähiger DSCR: CFADS, Steuern, Working Capital, Cash-Sweep und Covenants sind nicht berücksichtigt.';

// Balkenspur als SVG mit Prozentkoordinaten (die Content-Security-Policy erlaubt keine Inline-Styles)
const spur = (teile, null0, ref = null) => raw(`<svg class="ed-bar-t" aria-hidden="true" focusable="false"><rect class="ed-track" x="0" y="0" width="100%" height="100%" rx="3"/>${teile.map(([l, w, cls, t]) => `<rect class="ed-bar ${cls}" x="${l.toFixed(2)}%" y="3" width="${Math.max(0.4, w).toFixed(2)}%" height="12" rx="2">${t ? `<title>${esc(t)}</title>` : ''}</rect>`).join('')}${ref != null ? `<line class="ed-ref" x1="${ref.toFixed(2)}%" x2="${ref.toFixed(2)}%" y1="0" y2="100%"/>` : ''}${null0 != null ? `<line class="ed-zero" x1="${null0.toFixed(2)}%" x2="${null0.toFixed(2)}%" y1="0" y2="100%"/>` : ''}</svg>`);
// Horizontales Balkendiagramm in HTML (Null-Linie sichtbar, symmetrische Skala bei gemischten Vorzeichen)
// neutral: Beträge ohne Wertung (z. B. Kosten), sonst Vorzeichenfarbe
function balken(zeilen, { format = (x) => eur(x, true), titel, referenz, neutral = false } = {}) {
  const werte = zeilen.map((z) => z.wert).filter((x) => x != null && Number.isFinite(x));
  const max = Math.max(...werte.map(Math.abs), referenz ? Math.abs(referenz.wert) : 0, 1e-9);
  const neg = werte.some((x) => x < 0), pos = werte.some((x) => x > 0);
  const lo = neg ? -max : 0, hi = pos || !neg ? max : 0;
  const x = (v) => ((v - lo) / (hi - lo)) * 100;
  const null0 = x(0);
  return html`<div class="ed-bars" role="figure" aria-label="${titel || ''}">${zeilen.map((z) => {
    if (z.wert == null || !Number.isFinite(z.wert)) return html`<div class="ed-bar-row"><span class="ed-bar-l">${z.label}</span>${spur([], null)}<span class="ed-bar-v muted">${z.leer || '–'}</span></div>`;
    const a = Math.min(x(z.wert), null0), b = Math.max(x(z.wert), null0);
    return html`<div class="ed-bar-row"><span class="ed-bar-l">${z.label}</span>${spur([[a, b - a, z.klasse || (z.wert < 0 ? 'ed-bar-neg' : 'ed-bar-pos')]], null0, referenz ? x(referenz.wert) : null)}<span class="ed-bar-v ${neutral ? '' : vz(z.wert)}">${format(z.wert)}</span></div>`;
  })}${referenz ? html`<p class="small muted">Senkrechte Linie: ${referenz.label}</p>` : ''}</div>`;
}
const tabelle = (kopf, zeilen, cls = 'tbl-num') => html`<div class="tbl-wrap"><table class="tbl tbl-compact ${cls}"><thead><tr>${kopf.map((k, i) => html`<th${i ? raw(' class="num"') : ''}>${k}</th>`)}</tr></thead><tbody>${zeilen.map((z) => html`<tr>${z.map((c, i) => (i ? html`<td class="num">${c}</td>` : html`<th scope="row">${c}</th>`))}</tr>`)}</tbody></table></div>`;
const alsTabelle = (titel, kopf, zeilen) => html`<details class="small ed-daten"><summary>${titel} als Tabelle</summary>${tabelle(kopf, zeilen)}</details>`;

// ---------- 1. Kennzahlen ----------
const KZ_TEXT = {
  leistung: 'Installierte Wechselrichterleistung (PCS): so viel kann die Anlage höchstens gleichzeitig laden oder entladen – begrenzt durch den Netzanschluss.',
  kapazitaet: 'Nominale Kapazität ist die Preisbasis der Batterie; nutzbar ist der Anteil, der tatsächlich geladen und entladen wird.',
  investition: 'Alle Investitionskosten bis zur Inbetriebnahme einschließlich Reserve und Bauzeitzinsen.',
  kapitalwert: 'Wie viel Wert bleibt heute übrig, wenn alle künftigen Zahlungen mit dem Kalkulationszins abgezinst und die Investition abgezogen wird? Negativ: die Anlage verdient ihre Kosten im Modell nicht.',
  irr: 'Verzinsung des eingesetzten Kapitals über die Laufzeit vor Finanzierung. Zum Vergleich: Kalkulationszins.',
  dscr: 'Wie oft deckt der operative Cashflow den Schuldendienst im schwächsten Jahr? Unter 1,0 reicht er nicht. Modellkennzahl vor Steuern, kein Bank-DSCR.',
  erloese: 'Bruttoerlöse im ersten Betriebsjahr aus allen Vermarktungswegen.',
  kosten: 'Laufende Kosten im ersten Jahr: Betriebskosten einschließlich Batterieverschleiß und Vermarktung.',
  ek: 'Eigenkapital, das die Gesellschafter einbringen müssen: Investition abzüglich Kredit, zuzüglich Finanzierungsgebühren und Schuldendienstreserve.',
};
function kennzahlen(r, w) {
  const k = w.kennzahlen, j1 = w.jahre[0], d = r.dim, zins = w.meta.diskontsatz;
  const kachel = (label, wert, text, cls = '', zusatz = '') => html`<div class="ed-kpi ${cls}"><span class="ed-kpi-l">${label}</span><span class="ed-kpi-v">${wert}</span>${zusatz ? html`<span class="ed-kpi-z">${zusatz}</span>` : ''}<span class="ed-kpi-e">${text}</span></div>`;
  return html`<div class="ed-kpis">
${kachel('Anlagenleistung', `${n1(d.pcsMW)} MW`, KZ_TEXT.leistung, '', `Netzgrenzen: Einspeisung ${d.netz?.grenzeEinspeise == null ? 'unbekannt' : `${n1(d.netz.grenzeEinspeise)} MW`} · Bezug ${d.netz?.grenzeBezug == null ? 'unbekannt' : `${n1(d.netz.grenzeBezug)} MW`}`)}
${kachel('Speicherkapazität', `${n1(d.kapNominal)} MWh`, KZ_TEXT.kapazitaet, '', `nominal · ${n1(d.kapNutzbar)} MWh nutzbar`)}
${kachel('Gesamtinvestition', eur(k.gesamtinvestition, true), KZ_TEXT.investition, '', `${eur(k.investitionJeKWh)} je nominaler kWh`)}
${kachel('Kapitalwert (NPV)', eur(k.kapitalwert, true), KZ_TEXT.kapitalwert, vz(k.kapitalwert), `Kalkulationszins ${pct(zins)}`)}
${kachel('Projekt-IRR', pct(k.projektIRR), KZ_TEXT.irr, k.projektIRR == null ? 'ed-neg' : k.projektIRR < zins ? 'ed-neg' : 'ed-pos', k.projektIRR == null ? 'nicht berechenbar' : `${k.projektIRR < zins ? 'unter' : 'über'} dem Kalkulationszins ${pct(zins)}`)}
${kachel('Modell-DSCR minimal (vor Steuern)', k.dscrMin == null ? '–' : num(k.dscrMin, 2), KZ_TEXT.dscr, k.dscrMin != null && k.dscrMin < 1 ? 'ed-neg' : 'ed-pos', 'vor Steuern, kein Bank-DSCR')}
${kachel('Erlöse Jahr 1', eur(j1.brutto, true), KZ_TEXT.erloese)}
${kachel('Laufende Kosten Jahr 1', eur(j1.opex + j1.vermarktung, true), KZ_TEXT.kosten, '', `davon Verschleiß ${eur(j1.opexPosten.find((x) => x.key === 'verschleiss')?.betrag || 0, true)}`)}
${kachel('Eigenkapitalbedarf', eur(k.eigenkapitalbedarf, true), KZ_TEXT.ek, '', `Kredit ${eur(k.fremdkapital, true)}`)}
</div>`;
}
// Kurze Begründung aus den Rechenergebnissen (keine freie Bewertung)
function begruendung(r, w, sens) {
  const k = w.kennzahlen, j1 = w.jahre[0], zins = w.meta.diskontsatz, s = [];
  s.push(k.kapitalwert < 0 ? `Im Basisszenario reicht der Überschuss nicht, um die Investition von ${eur(k.gesamtinvestition, true)} bei ${pct(zins)} Kalkulationszins zu tragen: Kapitalwert ${eur(k.kapitalwert, true)}.`
    : `Im Basisszenario trägt der Überschuss die Investition von ${eur(k.gesamtinvestition, true)} bei ${pct(zins)} Kalkulationszins: Kapitalwert ${eur(k.kapitalwert, true)}. Das ist eine Modellrechnung, keine Investitionsfreigabe.`);
  s.push(`Jahr 1: Erlöse ${eur(j1.brutto, true)} minus laufende Kosten ${eur(j1.opex + j1.vermarktung, true)} ergeben ${eur(j1.ebitda, true)} operativen Cashflow; der Schuldendienst beträgt ${eur(j1.schuldendienst || k.schuldendienstJahr, true)} (ab dem ersten Tilgungsjahr ${eur(k.schuldendienstJahr, true)}).`);
  if (k.dscrMin != null && k.dscrMin < 1) s.push(`Der operative Cashflow deckt den Schuldendienst nicht in jedem Jahr (Modell-DSCR minimal ${num(k.dscrMin, 2)}).`);
  if (sens?.zeilen?.length) s.push(`Größter Einfluss auf den Kapitalwert: ${sens.zeilen.slice(0, 3).map((z) => z.label).join(', ')} (siehe Sensitivität).`);
  return s;
}

// ---------- 2. Anlagenfluss ----------
function anlagenfluss(r, w) {
  const d = r.dim, gesperrt = r.belastbarkeit === 'netzgrenzen';
  const j1 = w?.jahre?.[0];
  const engpass = d.einspeise != null && d.einspeise < d.pcsMW - 1e-9 || d.bezug != null && d.bezug < d.pcsMW - 1e-9;
  const erl = r.params?.einnahmen || [];
  const knoten = (titel, zeilen, cls = '') => html`<div class="ed-node ${cls}"><strong>${titel}</strong><ul>${zeilen.filter(Boolean).map((z) => html`<li>${z}</li>`)}</ul></div>`;
  const pfeil = (text, cls = '') => html`<div class="ed-link ${cls}" aria-hidden="true"><span>${text}</span></div>`;
  return html`<div class="ed-flow${gesperrt ? ' ed-flow-gesperrt' : ''}">
${knoten('Netzanschluss', [`zulässiger Bezug ${d.netz?.grenzeBezug == null ? 'unbekannt' : `${n1(d.netz.grenzeBezug)} MW`}`, `zulässige Einspeisung ${d.netz?.grenzeEinspeise == null ? 'unbekannt' : `${n1(d.netz.grenzeEinspeise)} MW`}`, IP.NETZSTATUS[d.netzStatus]], engpass ? 'ed-node-bad' : '')}
${pfeil(gesperrt ? `Engpass: Netz < PCS – gesperrt` : j1 ? `Laden ${num(j1.eingespeichertMWh, 0)} MWh/Jahr ⇄ Entladen ${num(j1.ausgespeichertMWh, 0)} MWh/Jahr` : 'Laden ⇄ Entladen', gesperrt ? 'ed-link-bad' : '')}
${knoten('Wechselrichter (PCS) und Trafos', [`installiert ${n1(d.pcsMW)} MW`, `${d.trafos} Trafostation(en), ${n1(d.mva)} MVA`])}
${pfeil(j1 ? `Verluste ${num(j1.eingespeichertMWh - j1.ausgespeichertMWh, 0)} MWh/Jahr (Wirkungsgrad ${pct(r.sys.wirkungsgrad, 0)})` : `Wirkungsgrad ${pct(r.sys.wirkungsgrad, 0)}`)}
${knoten('Batteriespeicher', [`${d.bloecke} × ${r.sys.produkt}`, `nominal ${n1(d.kapNominal)} MWh · nutzbar ${n1(d.kapNutzbar)} MWh`, `Batterieleistung ${n1(d.batterieMW)} MW · Dauer ${n1(d.dauerAnlageH)} h`, `Degradation ${pct(r.sys.degradationJahr)} p. a.`])}
${pfeil('Einsatzplanung')}
${knoten('Steuerung (EMS)', ['Im Modell nur Kostenposition (Positionen 11, 12)', 'Einsatz als Jahresmodell, nicht zeitaufgelöst'])}
${pfeil('Vermarktung')}
${knoten('Vermarktungswege', gesperrt ? ['Nicht berechnet (Netzgrenzen) – keine Erlösquelle verwendet'] : erl.map((e) => `${e.name}: ${pct(e.anteil, 0)} ${e.art === 'leistung' ? 'der Leistung' : 'der Energie'}`), gesperrt ? 'ed-node-bad' : '')}
</div>
${gesperrt ? html`<p class="small bad">Diese Konfiguration ist gesperrt: Die zulässige Netzleistung liegt unter der PCS-Leistung. Das Jahresmodell kann die Netzgrenze nicht abbilden; es werden keine Kennzahlen ausgewiesen.</p>` : ''}
<p class="small muted">Dargestellt sind nur Größen aus Planungsstand, Katalog und WM-Rechnung (Energie Jahr 1 im Basisszenario). Keine Aussage über Schutztechnik, Netzverträglichkeit oder Fahrpläne.</p>`;
}

// ---------- 3. Investitionsstruktur ----------
function investition(r, w) {
  const gruppen = {};
  for (const x of r.pos) { if (x.gesamt <= 0 && x.datenstatus !== 'fehlt') continue; const g = gruppen[x.nr] = { label: `${x.nr} ${x.name}`, wert: x.gesamt, status: x.datenstatus }; void g; }
  const bzz = r.finErg.bauzeitzinsen, res = r.finErg.reserve;
  const zeilen = Object.values(gruppen).sort((a, b) => b.wert - a.wert).map((g) => ({ label: html`${g.label} ${raw(`<span class="mark ${IP.DATENSTATUS[g.status]?.mark || 'mark-aud'}">${esc(IP.DATENSTATUS[g.status]?.name || g.status)}</span>`)}`, wert: g.wert, klasse: `ed-bar-st-${g.status}` }));
  zeilen.push({ label: html`17 Bauzeitzinsen ${raw('<span class="mark mark-info">Berechnet</span>')}`, wert: bzz, klasse: 'ed-bar-st-berechnet' }, { label: html`18 Reserve (${pct(r.finErg.reserve / (r.finErg.basis + bzz), 0)}) ${raw('<span class="mark mark-info">Berechnet</span>')}`, wert: res, klasse: 'ed-bar-st-berechnet' });
  const p1 = r.pos.find((x) => x.nr === 1), d = r.dim, k = w?.kennzahlen;
  return html`${balken(zeilen, { titel: 'Investitionskosten je Position', neutral: true })}
<p class="small">Summe Investition ${eur(r.finErg.gesamt, true)}${k && Math.abs(k.gesamtinvestition - r.finErg.gesamt) > 1 ? ` (WM: ${eur(k.gesamtinvestition, true)})` : ''}. Zusätzlich zur Investition, aus Eigenkapital: Finanzierungsgebühren ${eur(w?.capex?.finanzierungskosten ?? r.finErg.gebuehren, true)}, Schuldendienstreserve ${eur(w?.capex?.dsra, true)}. Messstellenbetrieb ist keine Investitions-, sondern eine Betriebskostenposition.</p>
<div class="ed-legende small"><span class="ed-sw ed-bar-st-bestaetigtes_angebot"></span>Angebot <span class="ed-sw ed-bar-st-marktbenchmark"></span>Benchmark <span class="ed-sw ed-bar-st-schaetzung"></span>Schätzung <span class="ed-sw ed-bar-st-platzhalter"></span>Platzhalter (synthetisch) <span class="ed-sw ed-bar-st-berechnet"></span>berechnet <span class="ed-sw ed-bar-st-fehlt"></span>fehlt</div>
<div class="ed-box small"><strong>Batterie (Position 1):</strong> ${num(p1.menge, 0)} ${p1.einheit} × ${eur(p1.einzelpreis)} = ${eur(p1.gesamt, true)} · Preisbasis ${IP.PREISBASIS[p1.preisBasis] || p1.preisBasis} · nominal ${n1(d.kapNominal)} MWh, nutzbar ${n1(d.kapNutzbar)} MWh (Differenz ${n1(d.kapNominal - d.kapNutzbar)} MWh, nutzbar ${pct(d.kapNutzbar / d.kapNominal, 0)}) · je nutzbarer kWh ${eur(p1.gesamt / (d.kapNutzbar * 1000))}</div>
${alsTabelle('Investitionskosten', ['Position', 'Betrag', 'Datenstatus'], [...r.pos.filter((x) => x.gesamt > 0 || x.datenstatus === 'fehlt').map((x) => [`${x.nr} ${x.name}`, eur(x.gesamt, true), IP.DATENSTATUS[x.datenstatus]?.name || x.datenstatus]), ['17 Bauzeitzinsen', eur(bzz, true), 'Berechnet'], ['18 Reserve', eur(res, true), 'Berechnet'], ['Summe', eur(r.finErg.gesamt, true), '']])}`;
}

// ---------- 4. Szenarien ----------
function szenarien(r) {
  const k = (s) => r.wm[s].kennzahlen;
  const zeile = (s, f) => ({ label: WM.SZENARIEN[s].name, wert: f(k(s)) });
  return html`<div class="ed-grid2">
<div><h4>Kapitalwert</h4>${balken(SZ.map((s) => zeile(s, (x) => x.kapitalwert)), { titel: 'Kapitalwert je Szenario' })}</div>
<div><h4>Projekt-IRR</h4>${balken(SZ.map((s) => zeile(s, (x) => x.projektIRR)), { format: (x) => pct(x, 2), titel: 'Projekt-IRR je Szenario', referenz: { wert: r.wm.basis.meta.diskontsatz, label: `Kalkulationszins ${pct(r.wm.basis.meta.diskontsatz)}` } })}</div>
<div><h4>Modell-DSCR minimal (vor Steuern)</h4>${balken(SZ.map((s) => zeile(s, (x) => x.dscrMin)), { format: (x) => num(x, 2), titel: 'Modell-DSCR je Szenario', referenz: { wert: 1, label: 'Deckung 1,0' } })}</div>
<div><h4>Gesamtinvestition und Eigenkapital</h4>${balken(SZ.flatMap((s) => [{ label: `${WM.SZENARIEN[s].name}: Investition`, wert: k(s).gesamtinvestition, klasse: 'ed-bar-neutral' }, { label: `${WM.SZENARIEN[s].name}: Eigenkapital`, wert: k(s).eigenkapitalbedarf, klasse: 'ed-bar-neutral2' }]), { titel: 'Investition und Eigenkapital je Szenario', neutral: true })}</div>
</div>
${alsTabelle('Szenariovergleich', ['Kennzahl', ...SZ.map((s) => WM.SZENARIEN[s].name)], [['Kapitalwert', ...SZ.map((s) => eur(k(s).kapitalwert, true))], ['Projekt-IRR', ...SZ.map((s) => pct(k(s).projektIRR, 2))], ['Modell-DSCR minimal (vor Steuern)', ...SZ.map((s) => (k(s).dscrMin == null ? '–' : num(k(s).dscrMin, 2)))], ['Gesamtinvestition', ...SZ.map((s) => eur(k(s).gesamtinvestition, true))], ['Eigenkapitalbedarf', ...SZ.map((s) => eur(k(s).eigenkapitalbedarf, true))]])}
<p class="small muted">Szenarioparameter: ${SZ.map((s) => { const x = WM.SZENARIEN[s]; return `${x.name}: Erlöse ×${num(x.erloes, 2)}, Investition ×${num(x.capex, 2)}, Betriebskosten ×${num(x.opex, 2)}, Zins ${x.zinsDelta >= 0 ? '+' : ''}${num(x.zinsDelta * 100, 1)} Pp., Degradation ${x.degradationDelta >= 0 ? '+' : ''}${num(x.degradationDelta * 100, 1)} Pp.`; }).join(' · ')}</p>`;
}

// ---------- 5. Cashflow und Finanzierung ----------
function cashflow(r, w) {
  const J = w.jahre, W = 760, H = 300, pl = 54, pr = 12, pt = 14, pb = 30;
  const oben = J.map((j) => j.brutto), unten = J.map((j) => j.opex + j.vermarktung + j.schuldendienst);
  const ek = J.map((j) => j.ekCF);
  const max = Math.max(...oben, ...ek, 1), min = Math.min(0, ...unten.map((x) => -x), ...ek);
  const y = (v) => pt + (max - v) / (max - min) * (H - pt - pb);
  const bw = (W - pl - pr) / J.length;
  const s = [];
  const grid = [max, max / 2, 0, min / 2, min].filter((v, i, a) => a.indexOf(v) === i);
  for (const g of grid) s.push(`<line class="c-grid" x1="${pl}" x2="${W - pr}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}"/><text x="${pl - 6}" y="${(y(g) + 4).toFixed(1)}" text-anchor="end">${esc(num(g / 1e6, 1))}</text>`);
  J.forEach((j, i) => {
    const x = pl + i * bw, b = bw * 0.62, x0 = x + (bw - b) / 2;
    s.push(`<rect class="cf-erl" x="${x0.toFixed(1)}" y="${y(j.brutto).toFixed(1)}" width="${b.toFixed(1)}" height="${(y(0) - y(j.brutto)).toFixed(1)}"><title>Jahr ${j.jahr}: Erlöse ${esc(eur(j.brutto, true))}</title></rect>`);
    let acc = 0;
    for (const [cls, v, n] of [['cf-opex', j.opex + j.vermarktung, 'Betriebskosten und Vermarktung'], ['cf-zins', j.zinsen, 'Zinsen'], ['cf-tilg', j.tilgung, 'Tilgung']]) {
      if (!(v > 0)) continue;
      s.push(`<rect class="${cls}" x="${x0.toFixed(1)}" y="${y(-acc).toFixed(1)}" width="${b.toFixed(1)}" height="${(y(-acc - v) - y(-acc)).toFixed(1)}"><title>Jahr ${j.jahr}: ${n} ${esc(eur(v, true))}</title></rect>`);
      acc += v;
    }
    if (j.jahr === 1 || j.jahr % 5 === 0) s.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle">${j.jahr}</text>`);
  });
  s.push(`<line class="cf-null" x1="${pl}" x2="${W - pr}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>`);
  s.push(`<polyline class="cf-ek" points="${J.map((j, i) => `${(pl + i * bw + bw / 2).toFixed(1)},${y(j.ekCF).toFixed(1)}`).join(' ')}"/>`);
  s.push(`<polyline class="cf-ebitda" points="${J.map((j, i) => `${(pl + i * bw + bw / 2).toFixed(1)},${y(j.ebitda).toFixed(1)}`).join(' ')}"/>`);
  const tr = r.finErg;
  return html`<div class="ed-scroll"><figure class="chart ed-cf"><svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="ed-cf-t"><title id="ed-cf-t">Jährliche Zahlungsströme in Mio. EUR, Szenario ${w.meta.szenarioName}</title>${raw(s.join(''))}</svg>
<figcaption><span class="lg lg-cf-erl">Erlöse</span> <span class="lg lg-cf-opex">Betriebskosten und Vermarktung</span> <span class="lg lg-cf-zins">Zinsen</span> <span class="lg lg-cf-tilg">Tilgung</span> <span class="lg lg-cf-ebitda">EBITDA (Linie)</span> <span class="lg lg-cf-ek">Verbleibender Cashflow nach Schuldendienst (Linie)</span> <span class="muted small">Mio. EUR je Betriebsjahr · Szenario ${w.meta.szenarioName}</span></figcaption></figure></div>
${alsTabelle('Cashflow', ['Jahr', 'Erlöse', 'Betriebskosten', 'Vermarktung', 'EBITDA', 'Zinsen', 'Tilgung', 'Schuldendienst', 'Modell-DSCR (vor Steuern)', 'Verbleibend'], J.map((j) => [j.jahr, eur(j.brutto, true), eur(j.opex, true), eur(j.vermarktung, true), eur(j.ebitda, true), eur(j.zinsen, true), eur(j.tilgung, true), eur(j.schuldendienst, true), j.dscr == null ? '–' : num(j.dscr, 2), eur(j.ekCF, true)]))}
<h4>Finanzierung</h4>
${tabelle(['Tranche', 'Anteil', 'Zins', 'Laufzeit', 'tilgungsfrei', 'Tilgung', 'Gebühr'], r.finErg && r.dim ? (r.stand?.finanzierung?.tranchen || []).map((t) => [t.name, pct(t.anteil, 0), pct(t.zins, 2), `${t.laufzeitJahre} J.`, `${t.tilgungsfreiJahre} J.`, IP.TILGUNGSMODELLE[t.modell] || t.modell, pct(t.gebuehrAnteil, 1)]) : [])}
<p class="small">Fremdkapital ${eur(tr.fk, true)} (${pct(tr.fk / tr.gesamt, 0)}), Bauzinssatz gewichtet ${pct(tr.zinsBau, 2)}, Bauzeitzinsen ${eur(tr.bauzeitzinsen, true)}, Gebühren ${eur(tr.gebuehren, true)}. Szenariozins: konservativ +1 Pp., optimistisch −0,5 Pp. als Delta auf die Restschuld je Jahr.</p>
${alsTabelle('Tilgungsplan (Basis)', ['Jahr', 'Zinsen', 'Tilgung', 'Schuldendienst', 'Restschuld'], tr.jahre.map((x) => [x.jahr, eur(x.zinsen, true), eur(x.tilgung, true), eur(x.schuldendienst, true), eur(x.restschuld, true)]))}
<p class="small muted">${DSCR_TEXT}</p>`;
}

// ---------- 6. Kapitalwert-Abgleich (Wasserfall) ----------
function wasserfall(ab) {
  let lauf = ab.anfang.kapitalwert;
  const alle = [ab.anfang.kapitalwert, ab.ende.kapitalwert];
  const stufen = ab.schritte.filter((x) => Math.abs(x.delta) >= 0.005).map((x) => { const von = lauf; lauf += x.delta; alle.push(von, lauf); return { ...x, von, bis: lauf }; });
  const max = Math.max(...alle.map(Math.abs), 1e-9), lo = Math.min(0, ...alle) < 0 ? -max : 0, hi = Math.max(0, ...alle) > 0 ? max : 0;
  const x = (v) => ((v - lo) / (hi - lo || 1)) * 100;
  const z = x(0);
  const zeile = (label, a, b, cls, wert) => { const l = Math.min(x(a), x(b)), rgt = Math.max(x(a), x(b)); return html`<div class="ed-bar-row"><span class="ed-bar-l">${label}</span>${spur([[l, rgt - l, cls]], z)}<span class="ed-bar-v ${vz(wert)}">${wert === null ? '' : cls === 'ed-bar-summe' ? eur(wert, true) : eurV(wert)}</span></div>`; };
  return html`<div class="ed-bars ed-wf" role="figure" aria-label="Kapitalwert-Abgleich (hypothetische Rechenabstimmung)">
${zeile('Ausgangswert', 0, ab.anfang.kapitalwert, 'ed-bar-summe', ab.anfang.kapitalwert)}
${stufen.map((s) => zeile(s.label, s.von, s.bis, s.delta < 0 ? 'ed-bar-neg' : 'ed-bar-pos', s.delta))}
${Math.abs(ab.rest) >= 0.005 ? zeile('Rest (nicht zugeordnet)', lauf, ab.ende.kapitalwert, 'ed-bar-aud', ab.rest) : ''}
${zeile('Ergebnis', 0, ab.ende.kapitalwert, 'ed-bar-summe', ab.ende.kapitalwert)}</div>`;
}
function abgleichTeil(p, stand, r, vgl, db, aktivSz) {
  const versionen = db.finanzmodelle.filter((m) => m.projectId === p.id).sort((a, b) => b.version - a.version);
  const basisLink = (id, sz = aktivSz) => `/portal/anlagenplanung/${p.id}?schritt=uebersicht&v=${stand.id}&var=${encodeURIComponent(r.v.key)}&vgl=${encodeURIComponent(id)}&sz=${sz}#abgleich`;
  const auswahl = html`<p class="small">Vergleich mit WM-Version: ${versionen.map((m, i) => html`${i ? ' · ' : ''}<a href="${basisLink(m.id)}"${vgl?.id === m.id ? raw(' aria-current="true"') : ''}>V${m.version}</a>`)}</p>`;
  if (!vgl) return html`${auswahl}<p class="small muted">Eine WM-Version wählen: Der Abgleich tauscht deren Eingangsgrößen schrittweise gegen die dieser Variante aus und rechnet jeden Schritt vollständig neu.</p>`;
  const abs = Object.fromEntries(SZ.map((s) => [s, AW.kapitalwertAbgleich(vgl.params, r.params, s)]));
  const ab = abs[aktivSz];
  const gespeichert = vgl.ergebnis?.[aktivSz]?.kennzahlen?.kapitalwert;
  return html`${auswahl}
<nav class="seg" aria-label="Szenario des Abgleichs">${SZ.map((s) => html`<a href="${basisLink(vgl.id, s)}"${s === aktivSz ? raw(' aria-current="true"') : ''}>${WM.SZENARIEN[s].name}</a>`)}</nav>
<p class="notice-info small"><strong>Hypothetische Rechenabstimmung, keine historische Aussage.</strong> Die Annahmen der gewählten Version werden mit dem heutigen Modell (${WM.MODELL_VERSION}) neu gerechnet und Gruppe für Gruppe ersetzt. Die Zwischenstufen hat es nie als Version gegeben; gespeicherte Versionen und Ergebnisse bleiben unverändert.</p>
<p class="small">WM V${vgl.version} (${vgl.notiz || vgl.quelle || ''}) → ${r.v.name} dieses Stands, Szenario ${WM.SZENARIEN[aktivSz].name}. Ausgangswert mit ${WM.MODELL_VERSION} aus den gespeicherten Parametern neu gerechnet${gespeichert != null ? `; gespeicherter Wert ${eur(gespeichert, true)}${Math.abs(gespeichert - ab.anfang.kapitalwertCent) > 0.01 ? ' (abweichend: Modellversion beachten)' : ' (identisch)'}` : ''}.</p>
${wasserfall(ab)}
${tabelle(['Schritt', ...SZ.map((s) => WM.SZENARIEN[s].name)], [
    ['Ausgangswert', ...SZ.map((s) => eur(abs[s].anfang.kapitalwert))],
    ...AW.ABGLEICH_SCHRITTE.map(([k, l], i) => [l, ...SZ.map((s) => eurV2(abs[s].schritte[i].delta))]),
    ['Rest', ...SZ.map((s) => eurV2(abs[s].rest))],
    ['Ergebnis', ...SZ.map((s) => eur(abs[s].ende.kapitalwert))],
    ['Gesamtdifferenz (ungerundet)', ...SZ.map((s) => eurV2(abs[s].gesamt))],
    ['Summe der auf € gerundeten Schritte / Gesamt gerundet', ...SZ.map((s) => `${num(abs[s].rundung.summeGerundet, 0)} / ${num(abs[s].rundung.gesamtGerundet, 0)} (Rundung ${num(abs[s].rundung.gesamtGerundet - abs[s].rundung.summeGerundet, 0)} €)`)],
  ])}
<p class="small muted">Reihenfolge: ${AW.ABGLEICH_SCHRITTE.map(([, l]) => l).join(' → ')}. Die Einzeleffekte hängen von der Reihenfolge ab; ihre ungerundete Summe ist immer genau die Gesamtdifferenz. Beträge auf Cent, Differenzen aus ungerundeten Kapitalwerten.</p>`;
}
const eurV2 = (x) => `${x > 0 ? '+' : ''}${eur(x)}`;

// ---------- 7. Sensitivität ----------
function sensitivitaetTeil(sens) {
  if (!sens) return '';
  const b = sens.ausgang.kapitalwert;
  const werte = sens.zeilen.flatMap((z) => [z.tief, z.hoch].filter((x) => x && !x.fehler).map((x) => x.kapitalwert - b));
  const max = Math.max(...werte.map(Math.abs), 1e-9);
  const x = (d) => 50 + (d / max) * 50;
  const seg = (y, cls) => { if (!y || y.fehler) return null; const d = y.kapitalwert - b; return [Math.min(x(d), 50), Math.abs(x(d) - 50), cls, eurV(d)]; };
  return html`<div class="ed-bars ed-tornado" role="figure" aria-label="Sensitivität des Kapitalwerts">${sens.zeilen.map((z) => html`<div class="ed-bar-row"><span class="ed-bar-l">${z.label}</span>${spur([seg(z.tief, z.tief && z.tief.kapitalwert < b ? 'ed-bar-neg' : 'ed-bar-pos'), seg(z.hoch, z.hoch && z.hoch.kapitalwert < b ? 'ed-bar-neg' : 'ed-bar-pos')].filter(Boolean), 50)}<span class="ed-bar-v small">${z.tiefText}: ${eurV(z.tief?.kapitalwert - b)}${z.hoch ? html`<br>${z.hochText}: ${eurV(z.hoch.kapitalwert - b)}` : ''}</span></div>`)}</div>
<p class="small">Mitte: Kapitalwert Basisszenario ${eur(b, true)}. Balken: Änderung des Kapitalwerts bei genau einer geänderten Eingangsgröße, jeweils vollständig neu berechnet.</p>
${alsTabelle('Sensitivität', ['Eingangsgröße', 'Änderung', 'Kapitalwert', 'Δ Kapitalwert', 'Projekt-IRR'], sens.zeilen.flatMap((z) => [[z.label, z.tiefText, z.tief], [z.label, z.hochText, z.hoch]].filter((y) => y[2]).map(([l, t, y]) => [l, t, y.fehler ? y.fehler : eur(y.kapitalwert, true), y.fehler ? '–' : eurV(y.kapitalwert - b), y.fehler ? '–' : pct(y.projektIRR, 2)])))}
<p class="small muted">Spannweiten sind Rechenannahmen der Sensitivität, keine Prognosen: ±10 % für Erlösniveau, Batteriepreis und Betriebskosten; ±50 % für die unbestätigten Demo-Annahmen Verschleiß und Netz-/Messkosten; ±1 Prozentpunkt Fremdkapitalzins (wirkt über Bauzeitzinsen auf die Investition, nicht über den Schuldendienst auf den Projekt-Kapitalwert); Betriebsdauer nur −5 Jahre, weil die Systemlebensdauer eine längere Laufzeit ausschließt.</p>`;
}

// ---------- 8. Netz- und Messkosten ----------
function netzTeil(nk) {
  if (!nk) return '';
  return html`${tabelle(['Position', 'Betrag Jahr 0 (€/a)', 'Skalierung', 'Status'], nk.zeilen.map((x) => [html`${x.name}<br><span class="small muted">${x.text}</span>`, eur(x.wert, true), x.regel, qmark(x.status)]), '')}
<p class="small">Wirkung der Einordnung „Festbetrag je Netzanschluss“ gegenüber der früheren Skalierung mit der PCS-Leistung (Faktor ${num(nk.faktor, 2)}), neu berechnet: Kapitalwert ${SZ.map((s) => `${WM.SZENARIEN[s].name} ${eurV2(nk.wirkung[s])}`).join(' · ')}.</p>
<p class="small muted">Die 40.000 €/a sind eine synthetische, unbestätigte Demo-Annahme – weder Netzbetreiberforderung noch Marktpreis. Arbeitsabhängige Netzentgelte stehen nur als variable Kosten in der Erlösreferenz (Netzentgelt-Szenario B).</p>`;
}

// ---------- 9. Datenqualität ----------
function qualitaetTeil(dq) {
  const gruppen = [...new Set(dq.punkte.map((x) => x.bereich))];
  return html`<div class="ed-quali">${Object.entries(AW.QUALITAET).map(([k, q]) => html`<div class="ed-quali-k"><span class="mark ${q.mark}">${q.name}</span><strong>${dq.zaehler[k]}</strong><span class="small muted">${q.text}</span></div>`)}</div>
<div class="${dq.entscheidungsreif ? 'notice-info' : 'alert'} small"><strong>${dq.entscheidungsreif ? 'Entscheidungsreif' : 'Nicht entscheidungsreif'}:</strong> ${dq.entscheidungsreif ? 'Alle Angaben bestätigt oder freigegeben.' : `${dq.offen.length} offene Punkte. Ein positiver Kapitalwert führt nie automatisch zu einer Investitionsfreigabe.`}</div>
${gruppen.map((g) => html`<details class="small"><summary>${g} (${dq.punkte.filter((x) => x.bereich === g).length})</summary>${tabelle(['Angabe', 'Status', 'Erläuterung'], dq.punkte.filter((x) => x.bereich === g).map((x) => [x.name, qmark(x.status), x.text]), '')}</details>`)}
<details class="small"><summary>Was fehlt für eine belastbare Investitionsentscheidung (${dq.offen.length})</summary><ul class="assume">${dq.offen.map((x) => html`<li>${x}</li>`)}</ul></details>`;
}

// ---------- 10. Fachprüfung ----------
function flach(o, pfad = '') {
  return Object.entries(o || {}).flatMap(([k, v]) => { const f = pfad ? `${pfad}.${k}` : k; return Array.isArray(v) ? v.flatMap((x, i) => (x && typeof x === 'object' ? flach(x, `${f}[${x.key || i}]`) : [[`${f}[${i}]`, x]])) : v && typeof v === 'object' ? flach(v, f) : [[f, v]]; });
}
function fachpruefung(p, stand, r, w, ref, ex) {
  const zeilen = flach(r.params).filter(([f]) => !f.startsWith('finanzierung.schuldendienstplan'));
  return html`<details class="small"><summary>Eingangsparameter der WM-Rechnung (${zeilen.length} Werte, Prüfsumme ${w.meta.parameterPruefsumme})</summary>${tabelle(['Parameter', 'Wert'], zeilen.map(([f, v]) => [html`<code>${f}</code>`, typeof v === 'number' ? num(v, Math.abs(v) < 10 ? 6 : 2) : String(v)]), '')}<p class="muted">Schuldendienstplan (Anteile am Fremdkapital je Jahr) siehe Tilgungsplan.</p></details>
<details class="small"><summary>Berechnungsformeln</summary><ul class="assume">
<li>Ausgespeicherte Energie je Erlösquelle = nominale MWh × nutzbarer Anteil × Vollzyklen × Verfügbarkeit × Anteil × Kapazitätsfaktor (Degradation); eingespeichert = ausgespeichert / Wirkungsgrad.</li>
<li>Energieerlös = ausgespeichert × Verkaufspreis − eingespeichert × Einkaufspreis; Leistungserlös = min(PCS, Einspeisung, Bezug) × Anteil × €/MW·a × Verfügbarkeit; jeweils × Szenariofaktor.</li>
<li>Betriebskosten = Positionen der Referenzbasis, im Planer nach Kostenursache skaliert, × (1 + Steigerung)^(Jahr−1) × Szenariofaktor; Verschleiß = ausgespeicherte MWh × €/MWh; Vermarktung = Anteil der Bruttoerlöse.</li>
<li>EBITDA = Bruttoerlöse − Vermarktung − Betriebskosten = operativer Cashflow (vor Steuern).</li>
<li>Investition = Σ Kostenpositionen + Bauzeitzinsen + Reserve; Fremdkapital = Investition × FK-Anteil; Eigenkapital = Investition − FK + Gebühren + Schuldendienstreserve.</li>
<li>Kapitalwert = −Investition + Σ EBITDA_t / (1 + ${pct(w.meta.diskontsatz)})^t; Projekt-IRR = Zins, bei dem der Kapitalwert 0 ist; Modell-DSCR_t = EBITDA_t / Schuldendienst_t.</li></ul></details>
<details class="small"><summary>Datenquellen, Versionen, Prüfsummen und Zeitpunkte</summary><dl class="kv">
<div><dt>Planungsstand</dt><dd>V${stand.version} · Prüfsumme <code>${stand.pruefsumme || '–'}</code> · ${stand.planerVersion || IP.PLANER_VERSION} · gespeichert ${fmtDateTime(stand.erstelltAm)} von ${stand.erstelltVonName || '–'}</dd></div>
<div><dt>Referenzbasis</dt><dd>${stand.wmBasis ? html`${stand.wmBasis.kennung} · WM V${stand.wmBasis.version} · Datensatz ${stand.wmBasis.fmId} · Prüfsumme <code>${stand.wmBasis.pruefsumme}</code> · ${stand.wmBasis.modellVersion} · übernommen ${fmtDateTime(stand.wmBasis.uebernommenAm)} von ${stand.wmBasis.uebernommenVon} · <a href="/portal/wirtschaftlichkeit/${p.id}?v=${stand.wmBasis.fmId}">Herkunft je Parameter</a>` : '–'}</dd></div>
<div><dt>Wirtschaftlichkeitsmodell</dt><dd>${w.meta.modellVersion} · Parameter-Prüfsumme <code>${w.meta.parameterPruefsumme}</code> · Kalkulationszins ${pct(w.meta.diskontsatz)}</dd></div>
<div><dt>Erlösquelle</dt><dd>${IP.ERLOES_QUELLEN[r.erloes?.verwendet] || '–'}${r.erloes?.referenz ? ` · ${r.erloes.referenz.anlage}, ${r.erloes.referenz.periode}, Datenversion ${r.erloes.referenz.datenversion || ex?.datenversion || 'unbekannt'}` : ''}${ref?.referenzbasis?.erloes ? ` · Referenzbasis: ${ref.referenzbasis.erloes.strategie}` : ''}</dd></div>
<div><dt>Speichersystem</dt><dd>${r.sys.hersteller} ${r.sys.produkt} V${r.sys.version} · ${IP.DATENSTATUS[r.sys.datenstatus]?.name} · ${r.sys.quelle}</dd></div>
<div><dt>Szenarien</dt><dd>${SZ.map((s) => { const x = WM.SZENARIEN[s]; return `${x.name}: Erlöse ×${x.erloes}, Investition ×${x.capex}, Betriebskosten ×${x.opex}, Zins ${x.zinsDelta >= 0 ? '+' : ''}${x.zinsDelta * 100} Pp., Degradation ${x.degradationDelta >= 0 ? '+' : ''}${x.degradationDelta * 100} Pp.`; }).join(' · ')}</dd></div></dl></details>
<details class="small"><summary>Bekannte Modellgrenzen</summary><ul class="assume"><li>${GRENZEN}</li><li>${DSCR_TEXT}</li><li>Jahresmodell ohne zeitaufgelösten Einsatz: Netzgrenzen unter der PCS-Leistung sind nicht abbildbar (gesperrt).</li><li>Erlöse aus WM-Demo-Annahmen sind synthetisch; Erlöse aus dem Backtest B2 sind historische Simulationen, keine garantierten Zukunftserlöse.</li><li>Netzentgelt-Leistungspreis (Szenario B) nicht quantifiziert.</li></ul></details>`;
}

// ---------- Gesamtansicht ----------
export function entscheidungsuebersicht({ db, p, stand, rs, r, url, ctx, varTabs }) {
  const sz = WM.SZENARIEN[url.searchParams.get('sz')] ? url.searchParams.get('sz') : 'basis';
  const vglId = url.searchParams.get('vgl');
  const vgl = vglId ? db.finanzmodelle.find((m) => m.id === vglId && m.projectId === p.id) : null;
  const refP = REF.referenzPruefung(db, p.id, stand.wmBasis);
  const ref = refP.fm || null;
  const dq = r && !r.fehler?.length ? AW.datenqualitaet({ stand, r, referenz: ref }) : null;
  const status = html`<div class="ed-status">
<span class="mark ${r?.belastbarkeit === 'modellrechnung' ? 'mark-info' : 'mark-warn'}">${IP.BELASTBARKEIT[r?.belastbarkeit] || 'Nicht berechenbar'}</span>
${stand.status === 'freigegeben' ? html`<span class="mark mark-ok">Freigegeben zur Investitionsentscheidung</span>` : html`<span class="mark mark-bad">Keine Investitionsfreigabe</span>`}
<span class="mark mark-demo">Synthetische Demo-Daten</span>
${ref ? html`<span class="mark mark-aud">Referenzbasis ${ref.referenzbasis.kennung} · ${ref.referenzbasis.modellVersion}</span>` : html`<span class="mark mark-warn">Keine gültige Referenzbasis</span>`}
${dq ? html`<span class="small muted">Datenqualität: ${Object.entries(AW.QUALITAET).filter(([k]) => dq.zaehler[k]).map(([k, q]) => `${dq.zaehler[k]} ${q.name.toLowerCase()}`).join(' · ')}</span>` : ''}</div>`;
  const kopf = html`${raw('<svg class="sr" aria-hidden="true" focusable="false"><defs><pattern id="ed-schraffur" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="ed-schraffur-g"/><rect width="3" height="6" class="ed-schraffur-v"/></pattern></defs></svg>')}<section class="panel ed-kopf"><div class="panel-head"><h2>Entscheidungsübersicht ${r?.v.name || ''}</h2>${varTabs}</div>${status}`;
  if (!r || r.fehler?.length) return html`${kopf}<div class="alert">${(r?.fehler || ['Keine Variante.']).join(' ')}</div></section>`;
  if (!r.wm) {
    return html`${kopf}<div class="alert"><strong>${IP.BELASTBARKEIT[r.belastbarkeit] || 'Nicht berechnet'}</strong>${r.hinweise?.length ? html`: ${r.hinweise.join(' ')}` : ''}</div></section>
<section class="panel"><h3>Anlagenkonfiguration</h3>${anlagenfluss(r, null)}</section>
<section class="panel"><h3>Investitionskosten</h3>${investition(r, null)}</section>
${dq ? html`<section class="panel"><h3>Datenqualität und Entscheidungsreife</h3>${qualitaetTeil(dq)}</section>` : ''}`;
  }
  const w = r.wm[sz], wb = r.wm.basis;
  const sens = AW.sensitivitaet({ stand, v: r.v, katalog: ctx.katalog, angebote: ctx.angebote, basis: ref?.params, ergebnisse: ctx.ergebnisse, datenversion: ctx.datenversion, r });
  const nk = AW.netzkosten(r, ref?.params);
  const szNav = (anker) => html`<nav class="seg" aria-label="Szenario">${SZ.map((s) => html`<a href="/portal/anlagenplanung/${p.id}?schritt=uebersicht&v=${stand.id}&var=${encodeURIComponent(r.v.key)}&sz=${s}${vgl ? `&vgl=${vgl.id}` : ''}#${anker}"${s === sz ? raw(' aria-current="true"') : ''}>${WM.SZENARIEN[s].name}</a>`)}</nav>`;
  r.stand = stand;
  return html`${kopf}
<h3 class="ed-h">Ergebnis im Basisszenario</h3>${kennzahlen(r, wb)}
<ul class="ed-warum">${begruendung(r, wb, sens).map((x) => html`<li>${x}</li>`)}</ul></section>
<section class="panel" id="anlage"><h3>Anlagenkonfiguration</h3>${anlagenfluss(r, wb)}</section>
<section class="panel" id="investition"><h3>Woraus besteht die Investition?</h3>${investition(r, wb)}</section>
<section class="panel" id="szenarien"><h3>Wie robust ist das Ergebnis? Drei Szenarien</h3>${szenarien(r)}</section>
<section class="panel" id="cashflow"><div class="panel-head"><h3>Zahlungsströme und Finanzierung</h3>${szNav('cashflow')}</div>${cashflow(r, w)}</section>
<section class="panel" id="netz"><h3>Netz- und Messkosten</h3>${netzTeil(nk)}</section>
<section class="panel" id="sensitivitaet"><h3>Welche Annahmen bewegen das Ergebnis am stärksten?</h3>${sensitivitaetTeil(sens)}</section>
<section class="panel" id="abgleich"><h3>Kapitalwert-Abgleich mit einer WM-Version (hypothetische Rechenabstimmung)</h3>${abgleichTeil(p, stand, r, vgl, db, sz)}</section>
<section class="panel" id="qualitaet"><h3>Datenqualität und Entscheidungsreife</h3>${qualitaetTeil(dq)}</section>
<section class="panel" id="fachpruefung"><h3>Fachprüfung</h3><p class="small muted">Alle Werte dieser Seite lassen sich mit den folgenden Angaben nachrechnen.</p>${fachpruefung(p, stand, r, wb, ref, ctx)}</section>`;
}
