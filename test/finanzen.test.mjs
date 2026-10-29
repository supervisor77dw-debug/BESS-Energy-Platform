// Formeltests Wirtschaftlichkeit und Eigentümervergütung (AW-STROMKAI-20261029-DESIGN-FINANCE-010).
// Referenzwerte: Excel „BESS_Flaechensicherung_Verguetungsmodell_v0_2.xlsx“ (Beispielwerte Blatt Vor_Ort/Variantenvergleich)
// sowie von Hand nachgerechnete Fälle. Abweichungen zur Arbeitsmappe sind ausdrücklich als Korrektur getestet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cent, eur, parseZahl, sumCent } from '../src/lib/finance/geld.mjs';
import * as VG from '../src/lib/finance/verguetung.mjs';
import * as WM from '../src/lib/finance/wirtschaftlichkeit.mjs';
import * as VT from '../src/lib/finance/vertraege.mjs';
import * as HD from '../src/lib/finance/handelsdaten.mjs';
import { berechnungCsv, verguetungPdf } from '../src/lib/finance/export.mjs';
import { demoParameter } from '../src/lib/finance/demo.mjs';

const near = (a, b, eps = 0.01, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} erwartet ${b}, erhalten ${a}`);

test('Rundung und Währung: kaufmännisch auf Cent, deutsches Format, Eingabe mit Dezimalkomma', () => {
  assert.equal(cent(1.005), 1.01); assert.equal(cent(-1.005), -1.01); assert.equal(cent(0.1 + 0.2), 0.3); assert.equal(cent(2.675), 2.68);
  assert.equal(sumCent([0.1, 0.2, 0.3]), 0.6);
  assert.equal(eur(1234.567).replace(/\s/g, ' '), '1.234,57 €');
  assert.equal(parseZahl('1.234,56'), 1234.56); assert.equal(parseZahl('3.000'), 3000); assert.equal(parseZahl('1.234.567,89'), 1234567.89); assert.equal(parseZahl('0.5'), 0.5); assert.equal(parseZahl('1234.56'), 1234.56); assert.equal(parseZahl('12,5 %'), 12.5); assert.ok(Number.isNaN(parseZahl('')));
  assert.throws(() => cent(NaN));
});

test('Pacht mit Mindestpacht (Excel Vor_Ort!B39)', () => {
  assert.equal(VG.jahrespacht({ flaecheHa: 1.5, pachtJeHa: 25000, mindestpacht: 30000 }), 37500);
  assert.equal(VG.jahrespacht({ flaecheHa: 1.0, pachtJeHa: 25000, mindestpacht: 30000 }), 30000, 'Mindestpacht greift');
  assert.throws(() => VG.jahrespacht({ flaecheHa: -1, pachtJeHa: 1 }));
});

test('Kaufpreisformel mit Mindestpreis und Cap (Excel Vor_Ort!B40/B41)', () => {
  const p = { flaecheHa: 1.5, referenzwert: 6, faktor: 2, praemie: 3, mindestpreis: 12, hoechstpreis: 20 };
  const k = VG.kaufpreis(p);
  assert.equal(k.wert, 15); assert.equal(k.betrag, 225000); assert.equal(k.begrenzt, null);
  assert.equal(VG.kaufpreisJeM2({ ...p, referenzwert: 10 }).wert, 20); assert.equal(VG.kaufpreisJeM2({ ...p, referenzwert: 10 }).begrenzt, 'Höchstpreis');
  assert.equal(VG.kaufpreisJeM2({ ...p, referenzwert: 3, praemie: 1 }).wert, 12); assert.equal(VG.kaufpreisJeM2({ ...p, referenzwert: 3, praemie: 1 }).begrenzt, 'Mindestpreis');
  assert.throws(() => VG.kaufpreisJeM2({ ...p, mindestpreis: 25 }), /Höchstpreis/, 'Mindestpreis über Cap wird abgewiesen (in Excel ungeprüft)');
  assert.equal(VG.kaufpreis(p, { jahre: 5, indexierung: 0.02 }).betrag, 248418.18, 'Indexierung 2 % über 5 Jahre (Excel D26)');
});

test('Optionsentgelte (Excel Vor_Ort!B44) und anteilige Optionsjahre', () => {
  const o = VG.optionsentgelte({ grundMonate: 24, verlaengerungen: [12, 12], entgelte: [1500, 2000, 3000, 4000] });
  assert.equal(o.summe, 10500); assert.equal(o.monate, 48); assert.deepEqual(o.jahre.map((j) => j.verlaengerung), [false, false, true, true]);
  const t = VG.optionsentgelte({ grundMonate: 30, entgelte: [1500, 2000, 3000] });
  assert.equal(t.summe, 5000, '30 Monate: drittes Jahr zur Hälfte');
});

test('VPI-Anpassung: Rate × Weitergabeanteil, Intervall, echte Indexstände vor Prognose', () => {
  near(VG.vpiFaktor(1, { rate: 0.02 }).faktor, 1, 1e-12);
  near(VG.vpiFaktor(3, { rate: 0.02, anteil: 1 }).faktor, 1.0404, 1e-12);
  near(VG.vpiFaktor(3, { rate: 0.02, anteil: 0.5 }).faktor, 1.0201, 1e-12);
  near(VG.vpiFaktor(3, { rate: 0.02, intervallJahre: 3 }).faktor, 1, 1e-12, 'vor erster Anpassung');
  near(VG.vpiFaktor(4, { rate: 0.02, intervallJahre: 3 }).faktor, 1.061208, 1e-9);
  const idx = { basis: 100, 3: 106 };
  assert.deepEqual(VG.vpiFaktor(4, { intervallJahre: 3, indexStaende: idx, anteil: 1 }), { faktor: 1.06, quelle: 'Index' });
  near(VG.vpiFaktor(4, { intervallJahre: 3, indexStaende: idx, anteil: 0.75 }).faktor, 1.045, 1e-12);
  assert.equal(VG.vpiFaktor(7, { intervallJahre: 3, indexStaende: idx, rate: 0.02 }).quelle, 'Prognose');
  const v = VG.pachtverlauf({ startpacht: 37500, jahre: 3, vpi: { rate: 0.02 } });
  assert.deepEqual(v.map((x) => x.betrag), [37500, 38250, 39015]);
});

test('Bauphasenvergütung nur bei Nutzung, zeitanteilig', () => {
  assert.equal(VG.bauphasenverguetung({ jahresbetrag: 12000, bauMonate: 9, variante: 'pacht' }).betrag, 9000);
  assert.equal(VG.bauphasenverguetung({ jahresbetrag: 12000, bauMonate: 9, variante: 'kauf' }).betrag, 0);
});

test('Variantenvergleich: Excel-Werte reproduziert, Hybrid-Fehler der Arbeitsmappe korrigiert', () => {
  const r = VG.variantenvergleich({ startpacht: 37500, kaufpreisHeute: 225000, laufzeitJahre: 20, pachtSteigerung: 0.02, kaufJahr: 5, kaufIndexierung: 0.02, diskont: 0.06 });
  const [a, b, c] = r.varianten;
  near(a.nominal, 911151.37, 0.01, 'A nominal (Excel B15)'); near(a.barwert, 503132.42, 0.01, 'A Barwert (Excel C15)');
  assert.equal(b.nominal, 225000);
  near(c.nominal, 443569.69, 0.01, 'C nominal (Excel B17)'); near(c.barwert, 349663.70, 0.01, 'C Barwert (Excel C17)');
  near(r.verlauf[4].kumHybrid, 443569.69, 0.01, 'Jahr 5 enthält den Kaufpreis (Excel E26 zeigt fälschlich 195.151,51)');
  near(r.verlauf[19].kumHybrid, 443569.69, 0.01, 'nach dem Kauf keine weiteren Zahlungen');
  near(r.verlauf[0].bwPacht, 35377.36, 0.01, 'Excel F22'); near(r.verlauf[0].kaufpreisIndexiert, 229500, 0.01, 'Excel D22');
});

test('Variable Vergütung nur bei ausdrücklich vereinbartem Vertragstyp', () => {
  const per = [{ realisierterErtrag: 100000, handelskosten: 10000, gebuehren: 5000 }, { realisierterErtrag: 50000, handelskosten: 5000, gebuehren: 0 }];
  assert.throws(() => VG.variableVerguetung({ typ: 'festpacht' }, per), /Festpacht ist nicht am Handelsergebnis beteiligt/);
  assert.deepEqual(VG.variableVerguetung({ typ: 'variabel', variabel: { anteil: 0.05 } }, per), { basis: 130000, betrag: 6500 });
  assert.equal(VG.variableVerguetung({ typ: 'variabel', variabel: { anteil: 0.05, deckel: 5000 } }, per).betrag, 5000);
  assert.equal(VG.variableVerguetung({ typ: 'variabel', variabel: { anteil: 0.05, mindestbetrag: 1000 } }, [{ realisierterErtrag: 0, handelskosten: 100, gebuehren: 0 }]).betrag, 1000);
});

test('Finanzmathematik: Kapitalwert, IRR, Annuität, Amortisation', () => {
  near(WM.npv(0.1, [-100, 110]), 0, 1e-9);
  near(WM.irr([-100, 60, 60]), 0.130662, 1e-5);
  assert.equal(WM.irr([100, 50]), null, 'ohne Vorzeichenwechsel kein IRR');
  near(WM.annuitaet(100000, 0.05, 10), 12950.46, 0.01);
  near(WM.annuitaet(100000, 0, 10), 10000, 1e-9);
  near(WM.amortisation([-100, 40, 40, 40]), 2.5, 1e-9);
  assert.equal(WM.amortisation([-100, 10, 10]), null);
});

const basisParams = (over = {}) => ({
  technik: { leistungMW: 10, kapazitaetMWh: 20, nutzbarAnteil: 1, wirkungsgrad: 1, verfuegbarkeit: 1, degradationJahr: 0, zyklenJahr: 100, betriebsjahre: 2, ...(over.technik || {}) },
  capex: { batterie: 1000000, reserveAnteil: 0.1, ...(over.capex || {}) },
  opex: { wartung: 10000, vermarktungAnteil: 0.1, steigerung: 0, ...(over.opex || {}) },
  finanzierung: { fkAnteil: 0, zins: 0.05, laufzeitJahre: 2, ...(over.finanzierung || {}) },
  einnahmen: over.einnahmen || [{ key: 'dayahead', name: 'Day-Ahead', art: 'energie', anteil: 1, verkaufEURMWh: 100, einkaufEURMWh: 50 }],
  bewertung: { diskontsatz: 0, ...(over.bewertung || {}) },
});

test('Wirtschaftlichkeit: Erlöse, Kosten, EBITDA, Kennzahlen (nachgerechnet)', () => {
  const r = WM.berechne(basisParams(), 'basis', { berechnetAm: '2026-10-29T10:00:00Z' });
  const k = r.kennzahlen;
  assert.equal(k.gesamtinvestition, 1100000); assert.equal(k.investitionJeKWh, 55);
  assert.equal(k.bruttoerloeseJahr1, 100000); assert.equal(k.vermarktungskostenJahr1, 10000); assert.equal(k.betriebskostenJahr1, 10000); assert.equal(k.ebitdaJahr1, 80000);
  assert.equal(k.operativerCFJahr1, 80000); assert.equal(k.eigenkapitalbedarf, 1100000); assert.equal(k.dscrMin, null);
  assert.equal(k.kapitalwert, -940000, 'Diskontsatz 0: −1,1 Mio. + 2 × 80.000');
  assert.equal(r.meta.modellVersion, WM.MODELL_VERSION); assert.equal(r.meta.berechnetAm, '2026-10-29T10:00:00Z'); assert.match(r.meta.parameterPruefsumme, /^[0-9a-f]{16}$/);
  // Wirkungsgradverluste: Einkauf 20.000 / 0,8 = 2.500 MWh
  const w = WM.berechne(basisParams({ technik: { wirkungsgrad: 0.8 } }));
  assert.equal(w.kennzahlen.bruttoerloeseJahr1, 75000);
  near(w.jahre[0].eingespeichertMWh, 2500, 1e-9);
  // Degradation 10 %: Jahr 2 nur 1.800 MWh
  const d = WM.berechne(basisParams({ technik: { degradationJahr: 0.1 } }));
  near(d.jahre[1].ausgespeichertMWh, 1800, 1e-9);
});

test('Wirtschaftlichkeit: Finanzierung, Schuldendienst, DSCR, Eigenkapital-IRR', () => {
  const r = WM.berechne(basisParams({ finanzierung: { fkAnteil: 0.5, zins: 0.05, laufzeitJahre: 2, finanzierungskostenAnteil: 0.02, dsraMonate: 0 } }));
  const k = r.kennzahlen;
  assert.equal(k.fremdkapital, 550000);
  near(k.schuldendienstJahr, 295792.68, 0.01);
  near(r.jahre[0].zinsen, 27500, 1e-6); near(r.jahre[0].tilgung, 268292.68, 0.01);
  near(r.jahre[1].restschuld, 0, 1e-6, 'nach Laufzeit getilgt');
  near(k.dscrMin, 80000 / WM.annuitaet(550000, 0.05, 2), 1e-9);
  assert.equal(k.eigenkapitalbedarf, 550000 + 11000);
  assert.equal(k.eigenkapitalIRR, null, 'negative Eigenkapital-Cashflows ohne Vorzeichenwechsel');
});

test('Keine Doppelzählung parallel vermarkteter Leistung; Szenarien wirken', () => {
  const doppelt = basisParams({ einnahmen: [{ key: 'da', name: 'Day-Ahead', art: 'energie', anteil: 0.7, verkaufEURMWh: 100, einkaufEURMWh: 50 }, { key: 'rr', name: 'Regelreserve', art: 'leistung', anteil: 0.5, eurJeMWJahr: 100000 }] });
  assert.throws(() => WM.berechne(doppelt), /doppelt/);
  assert.ok(WM.pruefeParameter(doppelt).some((f) => f.includes('120 %')));
  const ok = basisParams({ einnahmen: [{ key: 'da', name: 'Day-Ahead', art: 'energie', anteil: 0.5, verkaufEURMWh: 100, einkaufEURMWh: 50 }, { key: 'rr', name: 'Regelreserve', art: 'leistung', anteil: 0.5, eurJeMWJahr: 100000 }] });
  const s = WM.berechneSzenarien(ok);
  assert.equal(s.basis.kennzahlen.bruttoerloeseJahr1, 50000 + 500000);
  assert.equal(s.konservativ.kennzahlen.bruttoerloeseJahr1, 440000, 'Erlösfaktor 0,8');
  assert.equal(s.konservativ.kennzahlen.gesamtinvestition, 1210000, 'CAPEX-Faktor 1,1');
  assert.ok(s.optimistisch.kennzahlen.kapitalwert > s.basis.kennzahlen.kapitalwert && s.basis.kennzahlen.kapitalwert > s.konservativ.kennzahlen.kapitalwert);
});

const dbLeer = () => ({ vertragsstaende: [], verguetungsangebote: [], zahlungen: [], handelsdaten: [] });
const bed = { option: { beginn: '2025-01-01', grundMonate: 24, verlaengerungen: [12, 12], verlaengerungenGenutzt: 0, entgelte: [1500, 2000, 3000, 4000] },
  bau: { jahresbetrag: 12000 }, pacht: { flaecheHa: 1.5, pachtJeHa: 20000, mindestpacht: 25000, laufzeitJahre: 20, vpi: { rate: 0.02, anteil: 1, intervallJahre: 1 } } };

test('Versionierung: Simulation verändert nie den Vertrag; Pflicht zur Dokumentreferenz; Nachtrag als neue Version', () => {
  const db = dbLeer();
  assert.throws(() => VT.neuerStand(db, { vertragId: 'k1', stufe: 'unterzeichnet', typ: 'festpacht', bedingungen: bed, von: 'u' }), /Dokumentreferenz/);
  assert.throws(() => VT.neuerStand(db, { vertragId: 'k1', stufe: 'nachtrag', typ: 'festpacht', bedingungen: bed, dokumentRef: 'd', von: 'u' }), /unterzeichneten Vertrag/);
  const v1 = VT.neuerStand(db, { vertragId: 'k1', stufe: 'unterzeichnet', typ: 'festpacht', bedingungen: bed, dokumentRef: 'd-1', von: 'u' });
  const vorher = JSON.stringify(VT.ansprueche(VT.gueltigerStand(db, 'k1'), { heute: '2026-06-01' }));
  const sim = VT.neuerStand(db, { vertragId: 'k1', stufe: 'simulation', typ: 'festpacht', bedingungen: { ...bed, pacht: { ...bed.pacht, pachtJeHa: 99999 } }, von: 'u' });
  assert.equal(db.verguetungsangebote.length, 1); assert.equal(db.vertragsstaende.length, 1);
  assert.equal(JSON.stringify(VT.ansprueche(VT.gueltigerStand(db, 'k1'), { heute: '2026-06-01' })), vorher, 'Ansprüche unverändert nach Simulation');
  assert.throws(() => { v1.bedingungen.pacht = null; }, TypeError, 'verbindliche Bedingungen sind unveränderlich');
  const v2 = VT.neuerStand(db, { vertragId: 'k1', stufe: 'nachtrag', typ: 'festpacht', bedingungen: { ...bed, option: { ...bed.option, verlaengerungenGenutzt: 1 } }, dokumentRef: 'd-2', von: 'u' });
  assert.equal(v2.version, 2); assert.equal(VT.gueltigerStand(db, 'k1').id, v2.id); assert.equal(db.vertragsstaende[0].version, 1, 'Version 1 bleibt erhalten');
  assert.equal(sim.version, 1);
});

test('Eigentümeransprüche: Vereinbart, Fällig, Bezahlt, Demo, Prognose', () => {
  const db = dbLeer();
  const s = VT.neuerStand(db, { vertragId: 'k1', stufe: 'unterzeichnet', typ: 'festpacht', bedingungen: bed, dokumentRef: 'd-1', von: 'u' });
  const zahlungen = [{ vertragId: 'k1', anspruchKey: 'option-1', betrag: 1500, bezahltAm: '2025-01-05', synthetisch: true }];
  const a = VT.ansprueche(s, { heute: '2026-06-01', zahlungen });
  const by = Object.fromEntries(a.map((x) => [x.key, x]));
  assert.equal(by['option-1'].status, 'demo', 'Demo-Zahlung nie als bezahlt');
  assert.equal(by['option-2'].status, 'faellig'); assert.equal(by['option-2'].faellig, '2026-01-01');
  assert.equal(by['option-3'].status, 'prognose', 'Verlängerung nicht ausgeübt');
  assert.equal(by.bau.status, 'prognose'); assert.equal(by['pacht-1'].status, 'prognose', 'ohne Inbetriebnahme Prognose');
  const real = VT.ansprueche(s, { heute: '2026-06-01', zahlungen: [{ ...zahlungen[0], synthetisch: false }] });
  assert.equal(real[0].status, 'bezahlt');
  const mitCod = { ...s, bedingungen: { ...bed, bau: { jahresbetrag: 12000, beginn: '2027-01-01', ende: '2027-10-01' }, pacht: { ...bed.pacht, inbetriebnahme: '2027-10-01', vpi: { anteil: 1, intervallJahre: 1, indexStaende: { basis: 100, 1: 102 } } } } };
  const b = Object.fromEntries(VT.ansprueche(mitCod, { heute: '2026-06-01' }).map((x) => [x.key, x]));
  assert.equal(b.bau.betrag, 9000); assert.equal(b.bau.status, 'vereinbart');
  assert.equal(b['pacht-1'].betrag, 30000); assert.equal(b['pacht-1'].status, 'vereinbart');
  assert.equal(b['pacht-2'].betrag, 30600); assert.equal(b['pacht-2'].vpiQuelle, 'Index'); assert.equal(b['pacht-3'].status, 'prognose');
  const sum = VT.summenNachStatus(a);
  assert.equal(sum.demo, 1500); assert.equal(sum.faellig, 2000);
});

test('Kaufpreisregelung nur bei Kaufoption bzw. Pacht mit späterem Kauf', () => {
  const k = { flaecheHa: 1, referenzwert: 6, faktor: 2, praemie: 3, mindestpreis: 12, hoechstpreis: 20, indexierung: 0.02, bisBetriebsjahr: 10 };
  assert.equal(VT.kaufpreisregelung({ typ: 'festpacht', bedingungen: { kauf: k } }), null);
  const r = VT.kaufpreisregelung({ typ: 'kaufoption', bedingungen: { kauf: k } });
  assert.equal(r.heute.betrag, 150000); assert.equal(r.spaetestens.betrag, cent(150000 * 1.02 ** 10));
});

test('Handelsdaten: Prüfung, deutsches CSV, Korrekturlieferung ersetzt Periode', () => {
  const csv = 'projektId;periode;bezugMWh;einspeisungMWh;handelsumsatz;handelskosten;gebuehren;speicherverlusteMWh;verschleissKosten;realisierterErtrag;prognoseErtrag\np-n01;2027-01;1.000,5;880;95.000,10;4.000;500;120,5;3.000;91.000;88.000';
  const rows = HD.parseCsv(csv);
  const r = HD.pruefe(rows, { projektIds: ['p-n01'] });
  assert.deepEqual(r.fehler, []); assert.equal(r.datensaetze[0].bezugMWh, 1000.5); assert.equal(r.datensaetze[0].abweichung, 3000);
  assert.ok(HD.pruefe([{ ...rows[0], projektId: 'x' }], { projektIds: ['p-n01'] }).fehler.some((f) => f.includes('nicht bekannt')));
  assert.ok(HD.pruefe([rows[0], rows[0]], { projektIds: ['p-n01'] }).fehler.some((f) => f.includes('doppelt')));
  assert.ok(HD.pruefe([{ ...rows[0], gebuehren: '-5' }], { projektIds: ['p-n01'] }).fehler.length);
  assert.ok(HD.pruefe([{ ...rows[0], periode: '2027-13' }], { projektIds: ['p-n01'] }).fehler.length);
  assert.ok(HD.pruefe([{ ...rows[0], speicherverlusteMWh: '0' }], { projektIds: ['p-n01'] }).hinweise.length, 'Energiebilanz-Hinweis');
  const db = { handelsdaten: [] };
  HD.uebernehmen(db, r.datensaetze, { von: 'u' });
  HD.uebernehmen(db, [{ ...r.datensaetze[0], realisierterErtrag: 92000 }], { von: 'u' });
  assert.equal(db.handelsdaten.length, 1); assert.equal(db.handelsdaten[0].realisierterErtrag, 92000);
});

test('Export: CSV (Semikolon, Dezimalkomma, Metadaten) und PDF-Vergütungsübersicht', () => {
  const r = WM.berechne(basisParams(), 'basis', { berechnetAm: '2026-10-29T10:00:00Z', quelle: 'Test' });
  const csv = berechnungCsv(r, { projektName: 'Demo; Nord' });
  assert.ok(csv.startsWith('﻿')); assert.match(csv, /Modellversion;STROMKAI-WM 1.1/); assert.match(csv, /Gesamtinvestition;1100000,00;EUR/); assert.match(csv, /"Demo; Nord"/);
  const db = dbLeer();
  const s = VT.neuerStand(db, { vertragId: 'k1', stufe: 'unterzeichnet', typ: 'festpacht', bedingungen: bed, dokumentRef: 'd-1', von: 'u' });
  const pdf = verguetungPdf({ eigentuemer: 'Eigentümer A', projekt: 'Demo', stand: s, ansprueche: VT.ansprueche(s, { heute: '2026-06-01' }), kauf: null, stichtag: '2026-06-01', synthetisch: true });
  const t = pdf.toString('latin1');
  assert.ok(t.startsWith('%PDF-1.4')); assert.match(t, /SYNTHETISCHE DEMO-DATEN/); assert.match(t, /Eigentuemer A/); assert.doesNotMatch(t, /€/);
});

test('Batterieverschleiß: Zyklenkosten je ausgespeicherter MWh mindern EBITDA, ohne Doppelzählung mit den Erlösen', () => {
  const p = demoParameter(20, 40, 0);
  const ohne = WM.berechne({ ...p, technik: { ...p.technik, verschleissEURMWh: 0 } }, 'basis', { berechnetAm: 'x' });
  const mit = WM.berechne({ ...p, technik: { ...p.technik, verschleissEURMWh: 10 } }, 'basis', { berechnetAm: 'x' });
  const j1o = ohne.jahre[0], j1m = mit.jahre[0];
  const v = j1m.opexPosten.find((x) => x.key === 'verschleiss');
  assert.ok(Math.abs(v.betrag - j1m.ausgespeichertMWh * 10) < 1e-6, 'Kosten = ausgespeicherte MWh × Satz');
  assert.ok(Math.abs((j1o.ebitda - j1m.ebitda) - v.betrag) < 1e-6, 'EBITDA sinkt genau um die Verschleißkosten');
  assert.equal(j1m.brutto, j1o.brutto, 'Erlöse unverändert');
  // Jahr 2: Kosten folgen Durchsatz (Degradation) und Kostensteigerung
  const v2 = mit.jahre[1].opexPosten.find((x) => x.key === 'verschleiss').betrag;
  assert.ok(Math.abs(v2 - mit.jahre[1].ausgespeichertMWh * 10 * (1 + p.opex.steigerung)) < 1e-6);
  assert.throws(() => WM.berechne({ ...p, technik: { ...p.technik, verschleissEURMWh: -1 } }), /Batterieverschleiß/);
});

test('Variable Vergütung: Verschleißabzug nur bei ausdrücklicher Vertragsgrundlage', () => {
  const per = [{ realisierterErtrag: 100000, handelskosten: 30000, gebuehren: 5000, verschleissKosten: 15000 }];
  const basis = { typ: 'variabel', variabel: { anteil: 0.1 } };
  assert.equal(VG.variableVerguetung(basis, per).basis, 65000);
  assert.equal(VG.variableVerguetung({ typ: 'variabel', variabel: { anteil: 0.1, verschleissAbziehen: true } }, per).basis, 50000);
});

test('Demo-Kennzeichen vererbt sich auf neue verbindliche Stände und erzwingt synthetische Zahlungen', () => {
  const db = { vertragsstaende: [], verguetungsangebote: [] };
  const bed = { pacht: { flaecheHa: 1, pachtJeHa: 10000, laufzeitJahre: 20 } };
  VT.neuerStand(db, { vertragId: 'd1', stufe: 'simulation', typ: 'festpacht', bedingungen: bed, von: 'u', synthetisch: true });
  const s = VT.neuerStand(db, { vertragId: 'd1', stufe: 'unterzeichnet', typ: 'festpacht', bedingungen: bed, dokumentRef: 'x', von: 'u' });
  assert.equal(s.synthetisch, true);
  const echt = VT.neuerStand(db, { vertragId: 'e1', stufe: 'eckdaten', typ: 'festpacht', bedingungen: bed, von: 'u' });
  assert.equal(echt.synthetisch, false);
});

test('Demo-Bestand Stand 1 wird nur nachgekennzeichnet, Werte und Versionen bleiben', async () => {
  const { ensureFinanceDemo } = await import('../src/lib/finance/demo.mjs');
  const alt = { vertragId: 'k-1', version: 3, bedingungen: { pacht: { pachtJeHa: 22000 } } };
  const echt = { vertragId: 'k-real', version: 1, bedingungen: {} };
  const db = { meta: { finanzDemo: 1 }, projects: [{ id: 'p-n01' }], finanzmodelle: [{ id: 'fm-x', params: { technik: {} } }], vertragsstaende: [alt, echt], verguetungsangebote: [], zahlungen: [], handelsdaten: [], finanzFreigaben: [] };
  ensureFinanceDemo(db);
  assert.equal(alt.synthetisch, true); assert.equal(echt.synthetisch, undefined);
  assert.equal(alt.version, 3); assert.equal(alt.bedingungen.pacht.pachtJeHa, 22000);
  assert.equal(db.finanzmodelle.length, 1, 'keine neuen Demo-Modelle'); assert.equal(db.meta.finanzDemo, 2);
});
