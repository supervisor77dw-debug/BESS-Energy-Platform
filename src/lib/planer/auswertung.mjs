// Auswertungen für die Entscheidungsübersicht (Folgeauftrag „Fachliche Transparenz und visuelle Entscheidungsgrundlage“).
// Reine Funktionen auf den vorhandenen Rechenkernen: keine eigenen Kennzahlen, jede Zahl ist eine Neuberechnung mit
// STROMKAI-WM (berechne) bzw. dem Investitionsplaner (rechneVariante). Ungerundet; gerundet wird nur in der Anzeige.
import * as WM from '../finance/wirtschaftlichkeit.mjs';
import { OPEX_POSTEN } from '../finance/wirtschaftlichkeit.mjs';
import { rechneVariante, DATENSTATUS, ANGABE_STATUS, FIN_STATUS } from './planer.mjs';

// Ungerundeter Kapitalwert aus den Projekt-Cashflows (WM rundet die Kennzahl auf Cent)
export const kapitalwertRoh = (r) => r.cashflows.projekt.reduce((a, c, t) => a + c / (1 + r.meta.diskontsatz) ** t, 0);
const kurz = (r) => ({ kapitalwert: kapitalwertRoh(r), kapitalwertCent: r.kennzahlen.kapitalwert, projektIRR: r.kennzahlen.projektIRR, dscrMin: r.kennzahlen.dscrMin, gesamtinvestition: r.kennzahlen.gesamtinvestition });

// ---------- Kapitalwert-Abgleich zweier Parametersätze (Wasserfall) ----------
// Schrittweiser Austausch der Parametergruppen von „start“ nach „ziel“ in fester Reihenfolge; jeder Schritt ist eine vollständige
// Neuberechnung. Die Summe der Einzeleffekte ist ungerundet exakt die Gesamtdifferenz (Rest nur bei abweichenden Restfeldern).
const mitVerschleiss = (t, z) => { const n = { ...t }; if (z.verschleissEURMWh == null) delete n.verschleissEURMWh; else n.verschleissEURMWh = z.verschleissEURMWh; return n; };
export const ABGLEICH_SCHRITTE = [
  ['erloese', 'Erlösannahmen (Erlösquellen, Preise, Vollzyklen)', (p, z) => ({ ...p, einnahmen: structuredClone(z.einnahmen), technik: { ...p.technik, zyklenJahr: z.technik.zyklenJahr } })],
  ['verschleiss', 'Batterieverschleiß', (p, z) => ({ ...p, technik: mitVerschleiss(p.technik, z.technik) })],
  ['betriebskosten', 'Betriebskosten (einschließlich Netz- und Messkosten)', (p, z) => ({ ...p, opex: structuredClone(z.opex) })],
  ['investition', 'Investition und Finanzierung', (p, z) => ({ ...p, capex: structuredClone(z.capex), finanzierung: structuredClone(z.finanzierung) })],
  ['technik', 'Übrige Technik (Leistung, Kapazität, Wirkungsgrad, Degradation, Betriebsdauer)', (p, z) => ({ ...p, technik: structuredClone(z.technik) })],
  ['bewertung', 'Bewertung, Szenarioparameter und Standort', (p, z) => { const n = { ...p, bewertung: structuredClone(z.bewertung), standort: structuredClone(z.standort) }; if (z.szenarien) n.szenarien = structuredClone(z.szenarien); else delete n.szenarien; return n; }],
];
export function kapitalwertAbgleich(start, ziel, szenario = 'basis') {
  const rech = (p) => kurz(WM.berechne(p, szenario));
  const anfang = rech(start);
  let p = structuredClone(start), vorher = anfang;
  const schritte = [];
  for (const [key, label, f] of ABGLEICH_SCHRITTE) {
    p = f(p, ziel);
    const jetzt = rech(p);
    schritte.push({ key, label, delta: jetzt.kapitalwert - vorher.kapitalwert, nachher: jetzt, deltaIRR: jetzt.projektIRR != null && vorher.projektIRR != null ? jetzt.projektIRR - vorher.projektIRR : null, deltaDSCR: jetzt.dscrMin != null && vorher.dscrMin != null ? jetzt.dscrMin - vorher.dscrMin : null });
    vorher = jetzt;
  }
  const ende = rech(ziel);
  const rest = ende.kapitalwert - vorher.kapitalwert;
  return { szenario, anfang, ende, schritte, rest, gesamt: ende.kapitalwert - anfang.kapitalwert,
    rundung: { summeGerundet: schritte.reduce((a, x) => a + Math.round(x.delta), 0) + Math.round(rest), gesamtGerundet: Math.round(ende.kapitalwert - anfang.kapitalwert) } };
}

// ---------- Sensitivität (Tornado) ----------
// Jede Zeile ist eine Neuberechnung des Basisszenarios mit genau einer geänderten Eingangsgröße. Die Spannweiten sind
// dokumentierte Rechenannahmen der Sensitivität, keine Prognosen: ±10 % für Preise und Niveaus mit Marktbezug,
// ±50 % für unbestätigte Demo-Annahmen (Verschleiß, Netzkosten), ±1 Prozentpunkt Zins, −5 Jahre Betriebsdauer (länger nicht
// möglich, da die Lebensdauer des Systems die Betriebsdauer begrenzt).
const NETZ_KEYS = ['netzMess', 'netzanschlussBetrieb', 'messstelle', 'netzentgeltLeistung', 'pcsInstandhaltung'];
export const SENSITIVITAETEN = [
  { key: 'erloese', label: 'Erlösniveau', tief: '−10 %', hoch: '+10 %', p: (pa, s) => ({ ...pa, szenarien: { ...(pa.szenarien || {}), basis: { ...(pa.szenarien?.basis || {}), erloes: 1 + s * 0.1 } } }) },
  { key: 'batteriepreis', label: 'Batteriepreis (Position 1)', tief: '−10 %', hoch: '+10 %', planer: true, v: (v, s, pos1) => { const alt = { ...(v.kosten?.[1] || {}) }; delete alt.angebotId; return { ...v, kosten: { ...v.kosten, 1: { ...alt, einzelpreis: pos1.einzelpreis * (1 + s * 0.1) } } }; } },
  { key: 'betriebskosten', label: 'Betriebskosten gesamt', tief: '−10 %', hoch: '+10 %', p: (pa, s) => ({ ...pa, szenarien: { ...(pa.szenarien || {}), basis: { ...(pa.szenarien?.basis || {}), opex: 1 + s * 0.1 } } }) },
  { key: 'verschleiss', label: 'Batterieverschleiß (Demo-Annahme)', tief: '−50 %', hoch: '+50 %', p: (pa, s) => ({ ...pa, technik: { ...pa.technik, verschleissEURMWh: (pa.technik.verschleissEURMWh || 0) * (1 + s * 0.5) } }) },
  { key: 'netz', label: 'Netz- und Messkosten (Demo-Annahme)', tief: '−50 %', hoch: '+50 %', p: (pa, s) => ({ ...pa, opex: { ...pa.opex, ...Object.fromEntries(NETZ_KEYS.filter((k) => k in pa.opex).map((k) => [k, pa.opex[k] * (1 + s * 0.5)])) } }) },
  { key: 'zins', label: 'Fremdkapitalzins (alle Tranchen)', tief: '−1 Pp.', hoch: '+1 Pp.', planer: true, stand: (st, s) => ({ ...st, finanzierung: { ...st.finanzierung, tranchen: st.finanzierung.tranchen.map((t) => ({ ...t, zins: Math.max(0, t.zins + s * 0.01) })) } }) },
  { key: 'laufzeit', label: 'Betriebsdauer', tief: '−5 Jahre', hoch: null, p: (pa, s) => (s < 0 ? { ...pa, technik: { ...pa.technik, betriebsjahre: pa.technik.betriebsjahre - 5 } } : null) },
];
export function sensitivitaet({ stand, v, katalog, angebote, basis, ergebnisse, datenversion, r }) {
  if (!r?.params) return null;
  const pos1 = r.pos.find((x) => x.nr === 1);
  const rechne = (params) => { try { return kurz(WM.berechne(params, 'basis')); } catch (e) { return { fehler: (e.fehler || [e.message]).join(' ') }; } };
  const ausgang = rechne(r.params);
  const zeilen = SENSITIVITAETEN.map((x) => {
    const lauf = (s) => {
      if (x.planer) {
        const st = x.stand ? x.stand(stand, s) : stand;
        const vv = x.v ? x.v(v, s, pos1) : v;
        const rr = rechneVariante({ stand: st, v: vv, katalog, angebote, basis, ergebnisse, datenversion });
        return rr.params ? rechne(rr.params) : { fehler: 'keine Parameter' };
      }
      const pa = x.p(r.params, s);
      return pa ? rechne(pa) : null;
    };
    const tief = lauf(-1), hoch = x.hoch ? lauf(1) : null;
    return { key: x.key, label: x.label, tiefText: x.tief, hochText: x.hoch, tief, hoch, spanne: Math.max(...[tief, hoch].filter((y) => y && !y.fehler).map((y) => Math.abs(y.kapitalwert - ausgang.kapitalwert)), 0) };
  }).sort((a, b) => b.spanne - a.spanne);
  return { ausgang, zeilen };
}

// ---------- Netz- und Messkosten: Positionen, Status und Wirkung der Einordnung ----------
export function netzkosten(r, basis) {
  if (!r?.params || !basis) return null;
  const o = r.params.opex, regel = { netzanschlussBetrieb: 'fix je Netzanschluss', messstelle: 'fix je Messstelle', netzentgeltLeistung: 'je MW zulässigem Bezug', pcsInstandhaltung: 'je MW PCS', netzMess: 'Altposition, nicht skaliert' };
  const zeilen = [
    { key: 'netzanschlussBetrieb', name: 'Netzanschluss: Betrieb und Instandhaltung Übergabestation', wert: o.netzanschlussBetrieb ?? 0, status: 'pruefung', text: 'Synthetische, unbestätigte Demo-Annahme (bisherige Demo-Annahme 2.000 €/MW × 20 MW als Festbetrag). Keine Netzbetreiberforderung, kein Marktpreis.' },
    { key: 'messstelle', name: 'Messstellenbetrieb', wert: o.messstelle ?? 0, status: 'pruefung', text: 'Nicht separat bepreist und nicht nachweislich in einer anderen Position enthalten.' },
    { key: 'netzentgeltLeistung', name: 'Netzentgelt Leistungspreis', wert: o.netzentgeltLeistung ?? 0, status: 'fehlt', text: 'Szenario A: Befreiung angenommen (nicht bestätigt). Szenario B: Leistungspreis fehlt; nur der Arbeitspreis ist über die Erlösreferenz enthalten.' },
    { key: 'pcsInstandhaltung', name: 'PCS-Wartung und -Instandhaltung', wert: o.pcsInstandhaltung ?? 0, status: 'synthetisch', text: 'In „Wartung“ (Demo-Annahme 4 €/kWh) enthalten; deshalb 0, keine Doppelzählung.' },
  ].map((x) => ({ ...x, regel: regel[x.key] }));
  if ((o.netzMess || 0) > 0) zeilen.push({ key: 'netzMess', name: 'Netz- und Messkosten (pauschal, bis WM 1.1)', wert: o.netzMess, status: 'pruefung', regel: regel.netzMess, text: 'Altposition ohne Kostenursache.' });
  // Wirkung der Einordnung „fix je Netzanschluss“ gegenüber der früheren Skalierung mit der PCS-Leistung (Neuberechnung)
  const faktor = r.dim.pcsMW / basis.technik.leistungMW;
  const alt = { ...r.params, opex: { ...o, netzanschlussBetrieb: (o.netzanschlussBetrieb || 0) * faktor } };
  const wirkung = Object.fromEntries(Object.keys(WM.SZENARIEN).map((s) => [s, kapitalwertRoh(WM.berechne(r.params, s)) - kapitalwertRoh(WM.berechne(alt, s))]));
  return { zeilen, faktor, wirkung, summe: zeilen.reduce((a, x) => a + x.wert, 0) };
}

// ---------- Datenqualität und Entscheidungsreife ----------
export const QUALITAET = {
  bestaetigt: { name: 'Bestätigt', text: 'Durch belastbare Quelle belegt', mark: 'mark-ok' },
  synthetisch: { name: 'Synthetisch', text: 'Demo- oder Modellannahme', mark: 'mark-demo' },
  pruefung: { name: 'Prüfungsbedürftig', text: 'Plausibilität oder Kostenursache ungeklärt', mark: 'mark-warn' },
  fehlt: { name: 'Fehlend', text: 'Eingangsdaten fehlen', mark: 'mark-bad' },
  freigegeben: { name: 'Freigegeben', text: 'Ausdrückliche fachliche Freigabe liegt vor', mark: 'mark-ok' },
};
const ausDatenstatus = { bestaetigtes_angebot: 'bestaetigt', freigegeben: 'freigegeben', marktbenchmark: 'pruefung', schaetzung: 'pruefung', platzhalter: 'synthetisch', berechnet: 'synthetisch', fehlt: 'fehlt' };
const ausAngabe = { bestaetigt: 'bestaetigt', angenommen: 'pruefung', fehlt: 'fehlt' };
const ausFin = { zugesagt: 'bestaetigt', indikativ: 'pruefung', annahme: 'synthetisch' };
export function datenqualitaet({ stand, r, referenz }) {
  const p = [];
  for (const x of r?.pos || []) {
    if (x.datenstatus === 'enthalten') continue;
    p.push({ bereich: 'Investition', name: `${x.nr} ${x.name}`, status: ausDatenstatus[x.datenstatus] || 'pruefung', text: DATENSTATUS[x.datenstatus]?.name || x.datenstatus, betrag: x.gesamt });
  }
  for (const [k, n] of [['flaeche', 'Fläche'], ['geometrie', 'Geometrie'], ['abstaende', 'Abstände'], ['netz', 'Netzanschluss']]) {
    const st = stand.grundstueck.angaben?.[k]?.status || 'fehlt';
    p.push({ bereich: 'Grundstück und Netz', name: n, status: ausAngabe[st] || 'fehlt', text: `Angabe ${ANGABE_STATUS[st] || st}` });
  }
  if (r?.dim?.netzStatus) p.push({ bereich: 'Grundstück und Netz', name: 'Netzgrenzen', status: { ausreichend: ausAngabe[stand.grundstueck.angaben?.netz?.status] || 'pruefung', ungeprueft: 'fehlt', eingeschraenkt: 'pruefung', unzulaessig: 'fehlt' }[r.dim.netzStatus], text: r.dim.netzStatus === 'eingeschraenkt' ? 'Netzgrenze unter PCS-Leistung: Wirtschaftlichkeit gesperrt' : `Netzstatus ${r.dim.netzStatus}` });
  p.push({ bereich: 'Finanzierung', name: 'Finanzierungskonditionen', status: ausFin[stand.finanzierung.status] || 'synthetisch', text: FIN_STATUS[stand.finanzierung.status] || stand.finanzierung.status });
  if (referenz) {
    p.push({ bereich: 'Betrieb und Erlöse', name: `Referenzbasis ${referenz.referenzbasis?.kennung || ''} (${referenz.referenzbasis?.herkunft?.length || 0} Parameter)`, status: 'synthetisch', text: 'Demo-Ausgangsmodell, alle Parameter synthetisch' });
    p.push({ bereich: 'Betrieb und Erlöse', name: 'Batterieverschleiß 8 €/MWh', status: 'synthetisch', text: 'Synthetische Demo-Annahme, keine Herstellerangabe' });
    p.push({ bereich: 'Betrieb und Erlöse', name: 'Netzanschluss 40.000 €/a', status: 'pruefung', text: 'Unbestätigte Demo-Annahme, Kostenursache ungeklärt' });
    p.push({ bereich: 'Betrieb und Erlöse', name: 'Messstellenbetrieb', status: 'pruefung', text: 'Nicht separat bepreist' });
    p.push({ bereich: 'Betrieb und Erlöse', name: 'Leistungspreis Netzentgelt (Szenario B)', status: 'fehlt', text: 'Nicht quantifiziert' });
  } else p.push({ bereich: 'Betrieb und Erlöse', name: 'WM-Referenzbasis', status: 'fehlt', text: 'Keine gültige Referenzbasis zugeordnet' });
  if (r?.erloes?.verwendet?.startsWith('b2_')) p.push({ bereich: 'Betrieb und Erlöse', name: 'Erlöse aus Backtest B2', status: 'pruefung', text: 'Historische Simulation, keine garantierten Zukunftserlöse' });
  else if (r?.erloes?.verwendet === 'wm') p.push({ bereich: 'Betrieb und Erlöse', name: 'Erlöse aus WM-Demo-Annahmen', status: 'synthetisch', text: 'Synthetische Preise und Anteile' });
  p.push({ bereich: 'Entscheidung', name: 'Fachliche Freigabe des Planungsstands', status: stand.status === 'freigegeben' ? 'freigegeben' : 'fehlt', text: stand.status === 'freigegeben' ? `freigegeben von ${stand.freigegebenVon}` : 'Keine Freigabe zur Investitionsentscheidung' });
  const zaehler = Object.fromEntries(Object.keys(QUALITAET).map((k) => [k, p.filter((x) => x.status === k).length]));
  // Ein positiver Kapitalwert führt nie zu einer Freigabe: entscheidungsreif nur ohne Sperren, ohne fehlende, prüfungsbedürftige oder synthetische Angaben und mit Freigabe
  const offen = [...(r?.sperren || []), ...p.filter((x) => ['fehlt', 'pruefung', 'synthetisch'].includes(x.status)).map((x) => `${x.bereich}: ${x.name} – ${QUALITAET[x.status].name}`)];
  return { punkte: p, zaehler, offen, entscheidungsreif: offen.length === 0 && stand.status === 'freigegeben' };
}

// Betriebskosten Jahr 1 nach Position (für die Kostenübersicht)
export const opexJahr1 = (w) => w.jahre[0].opexPosten.map((x) => ({ key: x.key, name: x.name || OPEX_POSTEN.find(([k]) => k === x.key)?.[1] || x.key, betrag: x.betrag }));
