// WM-Referenzbasis (Folgeauftrag -017-R1, Befunde F und G der Rechenabstimmung vom 30.10.2026).
// Eine Referenzbasis ist eine eigene, nur anhängend angelegte STROMKAI-WM-Version mit dokumentierter Herkunft jedes Eingangsparameters,
// Prüfsumme und Modellversion. Der Investitionsplaner rechnet ausschließlich gegen eine ausdrücklich zugeordnete, freigegebene
// Referenzbasis derselben Modellversion – nie implizit gegen die zuletzt angelegte WM-Version (die Übergaben selbst sind keine Basis).
// Bestehende WM-Versionen werden dabei weder verändert noch umgedeutet.
import { demoParameter, DEMO_MODELLE, DEMO_QUELLE } from './demo.mjs';
import { MODELL_VERSION, OPEX_POSTEN, berechneSzenarien, parameterPruefsumme } from './wirtschaftlichkeit.mjs';

// Betriebskosten nach Kostenursache: Skalierung im Investitionsplaner (kapazitaet = nutzbare MWh, pcs = PCS-Leistung,
// bezug = zulässige Bezugsleistung, fix = je Projekt bzw. Netzanschluss). Keine Position wird ohne dokumentierte Ursache skaliert.
export const KOSTENREGELN = {
  wartung: { skalierung: 'kapazitaet', ursache: 'Wartung der Speicheranlage je nutzbarer Kapazität; die Demo-Annahme 4 EUR/kWh schließt Wechselrichter (PCS) ein' },
  versicherung: { skalierung: 'kapazitaet', ursache: 'Versicherung nach Anlagenwert, angenähert über die Kapazität' },
  grundstueck: { skalierung: 'fix', ursache: 'Pacht laut Grundstücksmodell des Projekts' },
  netzMess: { skalierung: 'fix', ursache: 'Pauschale Altposition bis WM 1.1 ohne dokumentierte Kostenursache; wird nicht skaliert, in Referenzbasen 0' },
  it: { skalierung: 'fix', ursache: 'IT und Kommunikation je Anlage' },
  monitoring: { skalierung: 'kapazitaet', ursache: 'Betriebsführung und Monitoring je Kapazität' },
  ersatzteile: { skalierung: 'kapazitaet', ursache: 'Ersatzteile (ohne Zelltausch; dieser liegt im Batterieverschleiß)' },
  rueckbau: { skalierung: 'kapazitaet', ursache: 'Rückbauvorsorge je Kapazität' },
  pcsInstandhaltung: { skalierung: 'pcs', ursache: 'Wartung und Instandhaltung der Wechselrichter, nur wenn nicht in „Wartung“ enthalten' },
  netzanschlussBetrieb: { skalierung: 'fix', ursache: 'Betrieb und Instandhaltung der Übergabestation je Netzanschluss, unabhängig von der PCS-Leistung' },
  messstelle: { skalierung: 'fix', ursache: 'Messstellenbetrieb je Messstelle' },
  netzentgeltLeistung: { skalierung: 'bezug', ursache: 'Leistungspreis des Netzentgelts nach zulässiger Bezugsleistung' },
};
export const SKALIERUNG = { kapazitaet: 'je nutzbarer MWh', pcs: 'je MW PCS', bezug: 'je MW zulässigem Bezug', fix: 'nicht skaliert' };

// Erlösherkunft der Demo-Referenzbasis
const ERLOES_DEMO = { quelle: 'WM-Demo-Annahmen (synthetisch)', strategie: 'Day-Ahead 50 %, Intraday 20 %, Regelreserve 30 % der Leistung; Netzentgelt-Befreiung angenommen (keine arbeitsabhängigen Netzentgelte)' };

// Parameter einer Referenzbasis aus dem aktuellen Demo-Ausgangsmodell. Gegenüber demoParameter wird nur die pauschale Position
// „Netz- und Messkosten“ (2.000 EUR/MW) nach Kostenursache umgegliedert: als Festbetrag je Netzanschluss übernommen, keine Skalierung mit der PCS-Leistung.
export function referenzParameter(pid) {
  const d = DEMO_MODELLE.find(([id]) => id === pid);
  if (!d) return null;
  const [, , mw, mwh, gs] = d;
  const p = demoParameter(mw, mwh, gs);
  const umgegliedert = { netzMess: 0, pcsInstandhaltung: 0, netzanschlussBetrieb: p.opex.netzMess || 0, messstelle: 0, netzentgeltLeistung: 0 };
  p.opex = { ...Object.fromEntries(OPEX_POSTEN.map(([k]) => [k, umgegliedert[k] ?? p.opex[k] ?? 0])), vermarktungAnteil: p.opex.vermarktungAnteil, steigerung: p.opex.steigerung };
  return p;
}

// Herkunft je Eingangsparameter (Feld, Wert, Herkunft, Status). Alle Demo-Werte sind synthetisch.
const HERKUNFT_EINZELN = {
  'technik.verschleissEURMWh': 'Batterieverschleiß (Zyklenkosten, Rücklage für Zelltausch/Augmentierung) 8 EUR je ausgespeicherter MWh – synthetische Demo-Annahme, keine Herstellerangabe (Demo-Modell seit ef18c4c)',
  'opex.netzMess': 'Pauschale Altposition bis WM 1.1: in der Referenzbasis 0, Betrag nach Kostenursache umgegliedert',
  'opex.netzanschlussBetrieb': 'Bisherige Demo-Annahme „Netz- und Messkosten“ 2.000 EUR/MW × Demo-Leistung, als Festbetrag je Netzanschluss übernommen; Aufteilung auf Messstelle PRÜFUNGSBEDÜRFTIG',
  'opex.messstelle': 'In „Netzanschluss: Betrieb“ enthalten (keine getrennte Demo-Annahme) – 0, um Doppelzählung zu vermeiden',
  'opex.pcsInstandhaltung': 'In „Wartung“ enthalten (Demo-Annahme 4 EUR/kWh schließt PCS ein) – 0, um Doppelzählung zu vermeiden',
  'opex.netzentgeltLeistung': 'Netzentgelt-Befreiung angenommen (Szenario A) – 0; für Szenario B ohne Befreiung KLÄRUNGSBEDARF',
};
export function herkunft(params) {
  const zeilen = [];
  const lauf = (o, pfad) => {
    for (const [k, v] of Object.entries(o)) {
      const feld = pfad ? `${pfad}.${k}` : k;
      if (Array.isArray(v)) v.forEach((x, i) => lauf(x, `${feld}[${x.key || i}]`));
      else if (v && typeof v === 'object') lauf(v, feld);
      else zeilen.push({ feld, wert: v, herkunft: HERKUNFT_EINZELN[feld] || `${DEMO_QUELLE} (demo.mjs, demoParameter)`, status: 'synthetisch' });
    }
  };
  lauf(params, '');
  return zeilen;
}

// Prüfung der Kostenbasis auf fehlende Pflichtgrößen und Doppelzählungen (bad = Referenzbasis nicht anlegbar)
export function kostenbasisPruefung(params) {
  const o = params.opex || {}, t = params.technik || {}, c = params.capex || {};
  const r = [];
  if (t.verschleissEURMWh == null) r.push({ art: 'bad', text: 'Batterieverschleiß ist nicht gesetzt (Parameter fehlt).' });
  else r.push({ art: 'ok', text: `Batterieverschleiß ausdrücklich gesetzt: ${t.verschleissEURMWh} EUR/MWh (synthetische Demo-Annahme).` });
  const neu = ['pcsInstandhaltung', 'netzanschlussBetrieb', 'messstelle', 'netzentgeltLeistung'];
  if ((o.netzMess || 0) > 0 && neu.some((k) => (o[k] || 0) > 0)) r.push({ art: 'bad', text: 'Pauschale Netz- und Messkosten zusätzlich zu den getrennten Positionen: Doppelzählung.' });
  else if ((o.netzMess || 0) > 0) r.push({ art: 'bad', text: 'Pauschale Netz- und Messkosten ohne Kostenursache: in einer Referenzbasis nach Ursache gliedern.' });
  else r.push({ art: 'ok', text: 'Netz- und Messkosten nach Kostenursache gegliedert; keine pauschale Position.' });
  if ((o.pcsInstandhaltung || 0) > 0) r.push({ art: 'warn', text: 'PCS-Instandhaltung gesetzt: prüfen, dass „Wartung“ den Wechselrichter nicht bereits enthält.' });
  if ((c.bauzeitzinsen || 0) > 0 || (c.leittechnik || 0) > 0 || (c.sonstige || 0) > 0) r.push({ art: 'warn', text: 'Investitionspositionen aus einer Planung in der Referenzbasis: der Planer ersetzt die Investition vollständig.' });
  r.push({ art: 'ok', text: 'Investition: der Planer ersetzt alle Positionen der Referenzbasis durch die eigene Kostenstruktur (keine Addition).' });
  r.push({ art: 'ok', text: 'Ersatzteile ohne Zelltausch, Zelltausch im Batterieverschleiß, Kapazitätsverlust über die Degradation: getrennte Ursachen.' });
  r.push({ art: 'ok', text: 'Arbeitsabhängige Netzentgelte nur als variable Kosten je MWh der Erlösreferenz (Netzentgelt-Szenario B), nicht in den Betriebskosten.' });
  return r;
}

const nr = (db, pid) => db.finanzmodelle.filter((m) => m.projectId === pid && m.referenzbasis).length + 1;
// Legt eine Referenzbasis als neue WM-Version an (der Aufrufer speichert); null, wenn das Projekt kein Demo-Projekt ist
export function neueReferenzbasis(db, p, { von, at, codeStand = null }) {
  const params = referenzParameter(p.id);
  if (!params) return { fehler: ['Für dieses Projekt gibt es kein Demo-Ausgangsmodell. Referenzbasen mit realen Daten brauchen einen eigenen Auftrag.'] };
  const pruefung = kostenbasisPruefung(params);
  if (pruefung.some((x) => x.art === 'bad')) return { fehler: pruefung.filter((x) => x.art === 'bad').map((x) => x.text) };
  const kennung = `REF-${p.code}-${nr(db, p.id)}`;
  const quelle = `Referenzbasis ${kennung}: ${DEMO_QUELLE}`;
  const ergebnis = Object.fromEntries(Object.entries(berechneSzenarien(params, { quelle, berechnetAm: at })).map(([k, x]) => [k, { meta: x.meta, kennzahlen: x.kennzahlen }]));
  const version = Math.max(0, ...db.finanzmodelle.filter((m) => m.projectId === p.id).map((m) => m.version)) + 1;
  return {
    fm: {
      id: `fm-ref-${p.id}-${version}`, projectId: p.id, spvId: p.spvId, version, status: 'simulation', synthetisch: true, params, ergebnis, quelle,
      referenzbasis: {
        kennung, status: 'freigegeben', modellVersion: MODELL_VERSION, pruefsumme: parameterPruefsumme(params), erloes: ERLOES_DEMO,
        grundlage: `Aktuelles Demo-Ausgangsmodell (demoParameter ${DEMO_MODELLE.find(([id]) => id === p.id).slice(2, 4).join(' MW / ')} MWh), Netz- und Messkosten nach Kostenursache`,
        codeStand, kostenregeln: KOSTENREGELN, kostenbasis: pruefung, herkunft: herkunft(params), freigegebenVon: von.name, freigegebenAm: at,
        hinweis: 'Rechenbasis für den Investitionsplaner. Keine Investorenfreigabe, keine Investitionsentscheidung.',
      },
      erstelltVon: von.id, erstelltAm: at, notiz: `Referenzbasis ${kennung} (synthetisch)`,
    },
  };
}

// Auswählbar sind nur freigegebene Referenzbasen der aktuellen Modellversion (neueste zuerst)
export const auswahlbar = (db, pid) => db.finanzmodelle.filter((m) => m.projectId === pid && m.referenzbasis?.status === 'freigegeben' && m.referenzbasis.modellVersion === MODELL_VERSION).sort((a, b) => b.version - a.version);

// Verweis eines Planungsstands auf seine Referenzbasis (Zeitpunkt und Herkunft der Übernahme)
export const verweisAuf = (fm, { name }, at, herkunftText) => ({
  fmId: fm.id, version: fm.version, kennung: fm.referenzbasis.kennung, pruefsumme: fm.referenzbasis.pruefsumme, modellVersion: fm.referenzbasis.modellVersion,
  erloes: fm.referenzbasis.erloes, uebernommenAm: at, uebernommenVon: name, herkunft: herkunftText,
});

// Prüft den Verweis eines Planungsstands: { fm } oder { fehler } mit verständlichem Grund
export function referenzPruefung(db, pid, verweis) {
  if (!verweis?.fmId) return { fehler: 'Keine WM-Referenzbasis zugeordnet. Bitte im Schritt „Technische Konfiguration“ eine freigegebene Referenzbasis wählen und speichern.' };
  const fm = db.finanzmodelle.find((m) => m.id === verweis.fmId && m.projectId === pid);
  if (!fm) return { fehler: `Die zugeordnete WM-Referenzbasis ${verweis.kennung || verweis.fmId} ist nicht vorhanden.` };
  if (fm.referenzbasis?.status !== 'freigegeben') return { fehler: `WM-Version V${fm.version} ist keine freigegebene Referenzbasis und darf nicht als Rechenbasis dienen.` };
  const ps = parameterPruefsumme(fm.params);
  if (ps !== fm.referenzbasis.pruefsumme || ps !== verweis.pruefsumme) return { fehler: `Prüfsumme der Referenzbasis ${fm.referenzbasis.kennung} stimmt nicht mit dem Verweis überein (gespeichert ${verweis.pruefsumme}, berechnet ${ps}).` };
  if (fm.referenzbasis.modellVersion !== MODELL_VERSION || verweis.modellVersion !== MODELL_VERSION) return { fehler: `Referenzbasis ${fm.referenzbasis.kennung} gehört zu ${fm.referenzbasis.modellVersion}, gerechnet wird mit ${MODELL_VERSION}. Bitte eine aktuelle Referenzbasis zuordnen.` };
  return { fm };
}
