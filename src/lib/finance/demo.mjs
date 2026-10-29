// Synthetische Demo-Daten für Projektwirtschaftlichkeit und Eigentümervergütung (Entwicklungsphase).
// Alle Werte sind erfunden und als synthetisch gekennzeichnet; sie sind weder Marktdaten noch Vertragsinhalte realer Personen.
// Demo-Zahlungen tragen immer synthetisch: true und werden nie als tatsächlich geleistet angezeigt.
// Vor einem Echtbetrieb mit realen Daten ist dieser Aufruf zu entfernen (siehe docs/FINANZMODELL.md).
import { neuerStand } from './vertraege.mjs';
import { berechneSzenarien } from './wirtschaftlichkeit.mjs';

export const DEMO_VERTRAEGE = ['k-1', 'k-2', 'k-3', 'k-1v'];
export const DEMO_QUELLE = 'Synthetische Demo-Annahmen (keine Marktdaten)';

export function demoParameter(mw, mwh, grundstueckJahr) {
  const kwh = mwh * 1000;
  return {
    standort: { grundstueck: 'Demo-Flurstück (synthetisch)', flaecheHa: 0, optionsflaecheHa: 0, betriebsflaecheHa: 0, netzanschluss: 'Demo-Umspannwerk', grundstuecksmodell: 'pacht' },
    technik: { leistungMW: mw, kapazitaetMWh: mwh, nutzbarAnteil: 0.9, wirkungsgrad: 0.86, verfuegbarkeit: 0.97, degradationJahr: 0.015, zyklenJahr: 365, verschleissEURMWh: 8, betriebsjahre: 20 },
    capex: { batterie: 120 * kwh, pcs: 30000 * mw, trafo: 20000 * mw, netzanschluss: 60000 * mw, bau: 25 * kwh, erschliessung: 8 * kwh, brandschutz: 6 * kwh, planung: 10 * kwh, genehmigung: 5 * kwh, nebenkosten: 7 * kwh, reserveAnteil: 0.05 },
    opex: { wartung: 4 * kwh, versicherung: 2 * kwh, grundstueck: grundstueckJahr, netzMess: 2000 * mw, it: 15000, monitoring: 1.5 * kwh, ersatzteile: 0.8 * kwh, rueckbau: 0.6 * kwh, vermarktungAnteil: 0.08, steigerung: 0.02 },
    finanzierung: { fkAnteil: 0.7, zins: 0.055, laufzeitJahre: 15, finanzierungskostenAnteil: 0.02, dsraMonate: 6 },
    einnahmen: [
      { key: 'dayahead', name: 'Day-Ahead-Arbitrage', art: 'energie', anteil: 0.5, verkaufEURMWh: 165, einkaufEURMWh: 50 },
      { key: 'intraday', name: 'Intraday-Handel', art: 'energie', anteil: 0.2, verkaufEURMWh: 180, einkaufEURMWh: 55 },
      { key: 'regelreserve', name: 'Regelreserve (aFRR/FCR)', art: 'leistung', anteil: 0.3, eurJeMWJahr: 135000 },
    ],
    bewertung: { diskontsatz: 0.07 },
  };
}

export function ensureFinanceDemo(db) {
  for (const k of ['finanzmodelle', 'verguetungsangebote', 'vertragsstaende', 'zahlungen', 'handelsdaten', 'finanzFreigaben']) db[k] ??= [];
  // Stand 1 (AW-010): Demo-Vertragsstände ohne eigenes Kennzeichen → nur Kennzeichnung nachziehen, Werte und Versionen bleiben unverändert
  if (db.meta?.finanzDemo === 1) {
    for (const x of [...db.vertragsstaende, ...db.verguetungsangebote]) if (DEMO_VERTRAEGE.includes(x.vertragId)) x.synthetisch = true;
    db.meta.finanzDemo = 2;
    return true;
  }
  if (db.meta?.finanzDemo || !db.projects?.some((p) => p.id === 'p-n01')) return false;
  const von = 'system-demo';
  const at = '2026-10-29T08:00:00.000Z';
  const modelle = [['p-n01', 'spv-n01', 20, 40, 26400], ['p-n02', 'spv-n02', 10, 20, 0], ['p-s01', 'spv-s01', 50, 100, 52000]];
  for (const [pid, spv, mw, mwh, gs] of modelle) {
    const params = demoParameter(mw, mwh, gs);
    const s = berechneSzenarien(params, { quelle: DEMO_QUELLE, berechnetAm: at });
    db.finanzmodelle.push({ id: `fm-${pid}-1`, projectId: pid, spvId: spv, version: 1, status: 'simulation', synthetisch: true, params, ergebnis: Object.fromEntries(Object.entries(s).map(([k, r]) => [k, { meta: r.meta, kennzahlen: r.kennzahlen }])), erstelltVon: von, erstelltAm: at, notiz: 'Demo-Ausgangsmodell' });
  }
  // Freigabe ausgewählter Kennzahlen für Investoren (nur Nord A, Basisszenario)
  const fm = db.finanzmodelle.find((x) => x.projectId === 'p-n01');
  const kb = fm.ergebnis.basis.kennzahlen;
  db.finanzFreigaben.push({ id: 'ff-p-n01-1', projectId: 'p-n01', modellId: fm.id, modellVersion: fm.ergebnis.basis.meta.modellVersion, szenario: 'basis', synthetisch: true,
    kennzahlen: { gesamtinvestition: kb.gesamtinvestition, investitionJeKWh: kb.investitionJeKWh, projektIRR: kb.projektIRR, dscrMin: kb.dscrMin, eigenkapitalbedarf: kb.eigenkapitalbedarf },
    freigegebenVon: 'u-admin', freigegebenAm: at, hinweis: 'Vorläufige Projektkennzahlen auf Basis synthetischer Annahmen; keine Anlageberatung.' });

  const vpi = { rate: 0.02, anteil: 1, intervallJahre: 1 };
  // 1) Festpacht – Eigentümer A, Nord A
  neuerStand(db, { synthetisch: true, vertragId: 'k-1', projectId: 'p-n01', ownerContactId: 'c-own-a', stufe: 'simulation', typ: 'festpacht', von: 'u-markus', notiz: 'Erste Simulation im Gespräch',
    bedingungen: { option: { beginn: '2026-09-12', grundMonate: 24, verlaengerungen: [12, 12], entgelte: [2500, 2500, 3500, 4500] }, bau: { jahresbetrag: 9000 }, pacht: { flaecheHa: 1.2, pachtJeHa: 20000, mindestpacht: 22000, laufzeitJahre: 20, vpi } } });
  neuerStand(db, { synthetisch: true, vertragId: 'k-1', projectId: 'p-n01', ownerContactId: 'c-own-a', stufe: 'vorschlag', typ: 'festpacht', von: 'u-markus', notiz: 'Verhandlungsvorschlag nach Gespräch',
    bedingungen: { option: { beginn: '2026-09-12', grundMonate: 24, verlaengerungen: [12, 12], entgelte: [2500, 2500, 3500, 4500] }, bau: { jahresbetrag: 9000 }, pacht: { flaecheHa: 1.2, pachtJeHa: 22000, mindestpacht: 24000, laufzeitJahre: 20, vpi } } });
  neuerStand(db, { synthetisch: true, vertragId: 'k-1', projectId: 'p-n01', ownerContactId: 'c-own-a', stufe: 'unterzeichnet', typ: 'festpacht', von: 'u-admin', dokumentRef: 'd-n01-own-a-vertrag', gueltigAb: '2026-09-12', freigabeEigentuemer: true,
    bedingungen: { option: { beginn: '2026-09-12', grundMonate: 24, verlaengerungen: [12, 12], verlaengerungenGenutzt: 0, entgelte: [2500, 2500, 3500, 4500] }, bau: { jahresbetrag: 9000 }, pacht: { flaecheHa: 1.2, pachtJeHa: 22000, mindestpacht: 24000, laufzeitJahre: 20, vpi } } });
  // 2) Kaufoption – Eigentümerin B, Nord B (Eckdaten vereinbart, Vertrag noch nicht unterzeichnet)
  neuerStand(db, { synthetisch: true, vertragId: 'k-2', projectId: 'p-n02', ownerContactId: 'c-own-b', stufe: 'eckdaten', typ: 'kaufoption', von: 'u-admin', gueltigAb: '2026-11-01', freigabeEigentuemer: true, notiz: 'Eckdaten laut Gesprächsprotokoll; Vertrag in Abstimmung',
    bedingungen: { option: { beginn: '2026-11-01', grundMonate: 24, verlaengerungen: [12], entgelte: [2000, 2000, 3000] }, kauf: { flaecheHa: 1.0, referenzwert: 5.5, faktor: 2, praemie: 2.5, mindestpreis: 11, hoechstpreis: 18, indexierung: 0.02, bisBetriebsjahr: 0 } } });
  // 3) Pacht mit späterem Kauf – Eigentümer Süd, Süd A (mit Nachtrag: erste Verlängerung ausgeübt)
  const s3 = { option: { beginn: '2025-03-01', grundMonate: 24, verlaengerungen: [12, 12], verlaengerungenGenutzt: 0, entgelte: [3000, 3000, 4000, 5000] }, bau: { jahresbetrag: 15000 },
    pacht: { flaecheHa: 2.6, pachtJeHa: 18000, mindestpacht: 40000, laufzeitJahre: 20, vpi: { anteil: 0.8, intervallJahre: 3, rate: 0.02 } },
    kauf: { flaecheHa: 2.6, referenzwert: 4, faktor: 2.5, praemie: 2, mindestpreis: 10, hoechstpreis: 16, indexierung: 0.02, bisBetriebsjahr: 10 } };
  neuerStand(db, { synthetisch: true, vertragId: 'k-3', projectId: 'p-s01', ownerContactId: 'c-s1', stufe: 'unterzeichnet', typ: 'pacht_spaeterer_kauf', von: 'u-admin', dokumentRef: 'DEMO-VERTRAG-S01', gueltigAb: '2025-03-01', freigabeEigentuemer: true, bedingungen: s3 });
  neuerStand(db, { synthetisch: true, vertragId: 'k-3', projectId: 'p-s01', ownerContactId: 'c-s1', stufe: 'nachtrag', typ: 'pacht_spaeterer_kauf', von: 'u-admin', dokumentRef: 'DEMO-NACHTRAG-S01-1', gueltigAb: '2027-03-01', freigabeEigentuemer: true, notiz: 'Erste Optionsverlängerung ausgeübt',
    bedingungen: { ...s3, option: { ...s3.option, verlaengerungenGenutzt: 1 } } });
  // 4) Gesondertes Beispiel: ausdrücklich vereinbarte variable Vergütung (eigener Vertragstyp, zusätzlich zur Festpacht)
  neuerStand(db, { synthetisch: true, vertragId: 'k-1v', projectId: 'p-n01', ownerContactId: 'c-own-a', stufe: 'eckdaten', typ: 'variabel', von: 'u-admin', freigabeEigentuemer: true, notiz: 'Beispiel einer gesondert vereinbarten Erfolgsbeteiligung (Demo)',
    bedingungen: { variabel: { anteil: 0.02, mindestbetrag: 0, deckel: 20000, bemessung: 'Realisierter Handelsertrag nach Handelskosten und Gebühren, jährlich; ohne Abzug des Batterieverschleißes', verschleissAbziehen: false } } });

  // Demo-Zahlungen (abgerechnet, aber ausdrücklich keine realen Zahlungen)
  for (const [vertragId, key, betrag, am] of [['k-1', 'option-1', 2500, '2026-09-20'], ['k-3', 'option-1', 3000, '2025-03-10'], ['k-3', 'option-2', 3000, '2026-03-09']])
    db.zahlungen.push({ id: `z-${vertragId}-${key}`, vertragId, anspruchKey: key, betrag, bezahltAm: am, referenz: 'DEMO', synthetisch: true, erfasstVon: von, erfasstAm: at });

  // Beispiel-Handelsdaten (synthetisch) für die variable Vergütung von Nord A
  for (let m = 1; m <= 12; m++) {
    const periode = `2028-${String(m).padStart(2, '0')}`;
    const bezug = 2400 + 150 * Math.sin(m), ein = bezug * 0.86;
    const umsatz = Math.round(ein * 128), kosten = Math.round(bezug * 57);
    db.handelsdaten.push({ id: `hd-p-n01-${periode}`, projektId: 'p-n01', periode, bezugMWh: Math.round(bezug * 10) / 10, einspeisungMWh: Math.round(ein * 10) / 10, handelsumsatz: umsatz, handelskosten: kosten, gebuehren: 1800,
      speicherverlusteMWh: Math.round((bezug - ein) * 10) / 10, verschleissKosten: 6500, realisierterErtrag: umsatz, prognoseErtrag: Math.round(umsatz * 0.95), abweichung: Math.round(umsatz * 0.05),
      importId: 'hd-demo', quelle: 'Synthetische Beispieldaten', synthetisch: true, importiertVon: von, importiertAm: at, schnittstelle: 'STROMKAI-HD 1.0' });
  }
  db.meta.finanzDemo = 2;
  return true;
}
