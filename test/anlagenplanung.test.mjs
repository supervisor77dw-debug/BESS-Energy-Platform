// Investitions- und Anlagenplaner (AW-STROMKAI-20261029-INVESTITIONSPLANER-016): Formeln gegen unabhängige Kontrollrechnungen,
// Einheiten, Finanzierung und Tilgung, Doppelzählung, Datenherkunft, Regression STROMKAI-WM 1.0 → 1.1, Trading-Export,
// Rechte, Mandantentrennung, Versionierung, Angebote, Übergabe an STROMKAI-WM.
// Aufruf: node --test test/anlagenplanung.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as IP from '../src/lib/planer/planer.mjs';
import * as WM from '../src/lib/finance/wirtschaftlichkeit.mjs';
import { demoParameter } from '../src/lib/finance/demo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const nah = (a, b, tol = 1e-6, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg || ''} ${a} ≠ ${b}`);
const SYS2 = IP.KATALOG_START.find((x) => x.systemId === 'sys-ph-2h');
const SYS4 = IP.KATALOG_START.find((x) => x.systemId === 'sys-ph-4h');
const G = { ...structuredClone(IP.GRUNDSTUECK_START), flaecheM2: 12000, laengeM: 120, breiteM: 100, grenzabstandM: 3, zufahrtM2: 600, feuerwehrM2: 400, nebenanlagenM2: 300, netzMW: 12, einspeiseMW: 12, bezugMW: 15 };
const ANN = structuredClone(IP.ANNAHMEN_START);
const ERG = JSON.parse(readFileSync(join(ROOT, 'src', 'strommarkt-daten', 'ergebnisse.json'), 'utf8')).ergebnisse;

// ---------- Fläche, Dimensionierung, Einheiten ----------
test('Flächenbilanz: Rechteck und vereinfachte Quadratannahme, nichts doppelt abgezogen', () => {
  const b = IP.flaechenbilanz(G);
  assert.equal(b.brutto, 12000); assert.ok(b.rechteck);
  nah(b.innen, 114 * 94); nah(b.abzug.grenzabstand, 12000 - 114 * 94);
  nah(b.fuerBloecke, 114 * 94 - 600 - 400 - 300);
  nah(b.brutto - b.abzug.grenzabstand - b.abzug.nichtNutzbar - b.abzug.zufahrt - b.abzug.feuerwehr - b.abzug.nebenanlagen, b.fuerBloecke, 1e-9, 'Bilanz geht auf');
  const q = IP.flaechenbilanz({ ...G, laengeM: null, breiteM: null, flaecheM2: 10000 });
  assert.ok(!q.rechteck); nah(q.innen, 94 * 94); assert.ok(q.hinweise.some((x) => /quadratisch/.test(x))); assert.ok(q.fehlend.includes('Länge und Breite bzw. Geometrie'));
  const leer = IP.flaechenbilanz({ ...IP.GRUNDSTUECK_START });
  assert.equal(leer.fuerBloecke, 0); assert.ok(leer.fehlend.includes('Grundstücksfläche') && leer.fehlend.includes('Verfügbare Netzanschlussleistung'));
});

test('Dimensionierung: Blöcke, Kapazität, PCS, Trafo, Netzbegrenzung, Fläche (Kontrollrechnung)', () => {
  const d = IP.dimensioniere({ leistungMW: 15, kapazitaetMWh: 30 }, SYS2, G, ANN);
  const n = Math.max(Math.ceil(30 / SYS2.kapNutzbarMWh), Math.ceil(15 / SYS2.leistungMW));
  assert.equal(d.bloecke, n); nah(d.kapNutzbar, n * SYS2.kapNutzbarMWh); nah(d.kapNominal, n * SYS2.kapNominalMWh);
  assert.equal(d.pcsMW, 15); assert.equal(d.trafos, Math.ceil(15 / 0.95 / 5));
  assert.equal(d.einspeise, 12, 'Netz 12 MW begrenzt 15-MW-Anlage'); assert.equal(d.bezug, 12, 'Bezug durch Netzanschluss 12 MW begrenzt');
  assert.ok(d.meldungen.some((m) => /begrenzt die Einspeisung auf 12 MW/.test(m.text)));
  nah(d.flaecheBloecke, n * (SYS2.laengeM + SYS2.abstandStirnM) * (SYS2.breiteM + SYS2.abstandSeiteM));
  nah(d.rest, d.bilanz.fuerBloecke - d.flaecheBloecke - d.trafos * ANN.flaecheJeTrafoM2);
  nah(d.dauerH, d.kapNutzbar / 12);
  // Zu kleine Fläche (-017: gemeinsames Flächenmodell): 30 × 20 m, Grenzabstand 3 m → Innenfläche 24 × 14 m; die Zufahrt (600 m²,
  // also 25 m tief über 24 m Länge) ist tiefer als die Innenfläche → Reservierungen übersteigen die Fläche, Anlage passt nicht
  const klein = IP.dimensioniere({ leistungMW: 15, kapazitaetMWh: 30 }, SYS2, { ...G, flaecheM2: 600, laengeM: 30, breiteM: 20 }, ANN);
  assert.equal(klein.passt, false); assert.ok(klein.rest < 0); assert.equal(klein.layout.bloecke.length, 0);
  assert.ok(klein.meldungen.some((m) => m.art === 'bad' && /belegen die gesamte Innenfläche/.test(m.text)));
  // Flächenbilanz reicht, Anordnung nicht (schmales Grundstück)
  const schmal = IP.dimensioniere({ leistungMW: 10, kapazitaetMWh: 40 }, SYS4, { ...G, flaecheM2: null, laengeM: 400, breiteM: 14, zufahrtM2: 0, feuerwehrM2: 0, nebenanlagenM2: 0 }, ANN);
  assert.ok(!schmal.layout.passt); assert.ok(schmal.meldungen.some((m) => /schematischen Anordnung/.test(m.text)));
  // Ungültige Eingaben
  assert.ok(IP.dimensioniere({ leistungMW: 0, kapazitaetMWh: 10 }, SYS2, G, ANN).fehler.length);
  assert.ok(IP.dimensioniere({ leistungMW: 5, kapazitaetMWh: 10 }, null, G, ANN).fehler.length);
});

test('Einheiten: MW, MWh, kW, kWh, EUR, EUR je MW und je kWh', () => {
  const v = { leistungMW: 10, kapazitaetMWh: 20, kosten: {} };
  const d = IP.dimensioniere(v, SYS2, G, ANN);
  const pos = IP.kostenpositionen(v, d, SYS2, []);
  const p1 = pos.find((x) => x.nr === 1), p2 = pos.find((x) => x.nr === 2);
  // -017: Die Demo-Vorbelegung 120 EUR/kWh bezieht sich auf nominale kWh (demo.mjs/STROMKAI-WM), daher Menge = nominale kWh
  assert.equal(p1.einheit, 'kWh nominal'); assert.equal(p1.preisBasis, 'nominal'); nah(p1.menge, d.kapNominal * 1000, 1e-12, 'MWh → kWh');
  nah(p1.gesamt, d.kapNominal * 1000 * 120, 1e-12, 'EUR/kWh × kWh');
  assert.equal(p2.einheit, 'MW'); nah(p2.gesamt, 10 * 30000, 1e-12, 'EUR/MW × MW');
  const r = IP.rechneVariante({ stand: { grundstueck: G, annahmen: ANN, finanzierung: IP.FINANZIERUNG_START }, v: { ...v, key: 'A', systemRef: { systemId: SYS2.systemId, version: 1 } }, katalog: IP.KATALOG_START, angebote: [], basis: demoParameter(20, 40, 26400) });
  const w = WM.berechne(r.params, 'basis');
  nah(w.kennzahlen.investitionJeKWh, r.finErg.gesamt / (r.dim.kapNominal * 1000), 1e-9, 'WM bezieht EUR/kWh auf nominale kWh');
  nah(r.params.technik.kapazitaetMWh * r.params.technik.nutzbarAnteil, d.kapNutzbar, 1e-12, 'nutzbare MWh an WM');
  // -017: WM erhält die installierte PCS-Leistung und die Netzgrenzen getrennt
  assert.equal(r.params.technik.leistungMW, d.pcsMW, 'PCS-Leistung an WM'); assert.equal(r.params.technik.einspeiseMW, d.einspeise); assert.equal(r.params.technik.bezugMW, d.bezug);
});

// ---------- Finanzierung ----------
test('Bauzeitzinsen: geschlossene Lösung = unabhängige Iteration über die Abrufe', () => {
  const fin = { ...structuredClone(IP.FINANZIERUNG_START), fkAnteil: 0.75, bauzeitMonate: 15, abrufplan: [{ monat: 0, anteil: 0.2 }, { monat: 5, anteil: 0.5 }, { monat: 12, anteil: 0.3 }],
    tranchen: [{ name: 'A', anteil: 0.6, zins: 0.05, laufzeitJahre: 15, tilgungsfreiJahre: 2, modell: 'annuitaet', gebuehrAnteil: 0.015 }, { name: 'B', anteil: 0.4, zins: 0.07, laufzeitJahre: 10, tilgungsfreiJahre: 0, modell: 'linear', gebuehrAnteil: 0.02 }] };
  const B = 10_000_000, r = 0.05;
  const f = IP.finanzierung(B, fin, r);
  // Kontrolle: I = Σ FK-Abruf × Zins × Restbauzeit; Abruf = Anteil × (B + r·(B+I)) × FK-Anteil; Fixpunktiteration
  let I = 0;
  for (let i = 0; i < 200; i++) { const S = B + r * (B + I); I = fin.abrufplan.reduce((a, x) => a + x.anteil * S * 0.75 * (0.6 * 0.05 + 0.4 * 0.07) * (15 - x.monat) / 12, 0); }
  nah(f.bauzeitzinsen, I, 1e-9, 'Bauzeitzinsen');
  nah(f.gesamt, (B + I) * (1 + r), 1e-12); nah(f.reserve, (B + I) * r, 1e-12); nah(f.fk + f.ek, f.gesamt, 1e-12);
  nah(f.gebuehren, f.fk * (0.6 * 0.015 + 0.4 * 0.02), 1e-12, 'Gebühren gewichtet');
  nah(f.jahre.reduce((a, x) => a + x.tilgung, 0), f.fk, 1e-9, 'Tilgung = Fremdkapital');
  assert.ok(f.jahre.at(-1).restschuld < 1e-6, 'Restschuld 0');
  // Tranche A tilgungsfrei in Jahr 1–2: Tilgung kommt nur aus Tranche B (linear über 10 Jahre)
  nah(f.jahre[0].tilgung, f.fk * 0.4 / 10, 1e-9); nah(f.jahre[0].zinsen, f.fk * (0.6 * 0.05 + 0.4 * 0.07), 1e-9);
  assert.equal(f.jahre.length, 15);
  nah(f.bauphase.reduce((a, x) => a + x.betrag, 0) + f.bauzeitzinsen, f.gesamt, 1e-9, 'Liquiditätsverlauf deckt die Investition');
});

test('Tilgungsmodelle: Annuität (Formel), Ratentilgung, endfällig; Schuldendienstplan in WM = Annuitätenrechnung von WM', () => {
  const t = (modell, frei = 0) => IP.finanzierung(1_000_000, { ...IP.FINANZIERUNG_START, fkAnteil: 0.5, bauzeitMonate: 0, abrufplan: [{ monat: 0, anteil: 1 }], tranchen: [{ name: 'T', anteil: 1, zins: 0.06, laufzeitJahre: 10, tilgungsfreiJahre: frei, modell, gebuehrAnteil: 0 }] }, 0);
  const an = t('annuitaet'); const rate = 500_000 * 0.06 / (1 - 1.06 ** -10);
  for (const j of an.jahre) nah(j.schuldendienst, rate, 1e-9, 'konstante Annuität');
  const li = t('linear'); for (const j of li.jahre) nah(j.tilgung, 50_000, 1e-9);
  const en = t('endfaellig'); assert.ok(en.jahre.slice(0, 9).every((j) => j.tilgung === 0)); nah(en.jahre[9].tilgung, 500_000, 1e-9); nah(en.zinsaufwand, 500_000 * 0.06 * 10, 1e-9);
  const fr = t('annuitaet', 3); assert.ok(fr.jahre.slice(0, 3).every((j) => j.tilgung === 0)); nah(fr.jahre[3].schuldendienst, 500_000 * 0.06 / (1 - 1.06 ** -7), 1e-9);
  // WM mit Schuldendienstplan der Annuität = WM ohne Plan (eigene Annuitätenrechnung)
  const p = demoParameter(10, 20, 0);
  const plan = IP.finanzierung(1, { ...IP.FINANZIERUNG_START, fkAnteil: 0.7, bauzeitMonate: 0, abrufplan: [{ monat: 0, anteil: 1 }], tranchen: [{ name: 'T', anteil: 1, zins: 0.055, laufzeitJahre: 15, tilgungsfreiJahre: 0, modell: 'annuitaet', gebuehrAnteil: 0.02 }] }, 0).plan;
  for (const sz of Object.keys(WM.SZENARIEN)) {
    const a = WM.berechne(p, sz), b = WM.berechne({ ...p, finanzierung: { ...p.finanzierung, schuldendienstplan: plan } }, sz);
    if (sz === 'basis') for (const k of ['dscrMin', 'eigenkapitalIRR', 'eigenkapitalbedarf', 'schuldendienstJahr']) nah(b.kennzahlen[k], a.kennzahlen[k], 1e-6, `${sz} ${k}`);
    nah(b.kennzahlen.kapitalwert, a.kennzahlen.kapitalwert, 1e-9, 'Projekt-CF unabhängig von der Finanzierung');
  }
  assert.ok(WM.pruefeParameter({ ...p, finanzierung: { ...p.finanzierung, schuldendienstplan: [{ zinsen: 0.05, tilgung: 0.5 }] } }).some((x) => /100 %/.test(x)), 'unvollständige Tilgung abgewiesen');
  assert.ok(IP.pruefeFinanzierung({ ...IP.FINANZIERUNG_START, status: 'zugesagt', zusageRef: '' }).some((x) => /Dokumentreferenz/.test(x)), 'Zusage ohne Nachweis abgewiesen');
  assert.ok(IP.pruefeFinanzierung({ ...IP.FINANZIERUNG_START, tranchen: [{ ...IP.FINANZIERUNG_START.tranchen[0], anteil: 0.8 }] }).length);
});

// ---------- Doppelzählung und Datenherkunft ----------
// Netz in beiden Richtungen ausreichend: Diese Tests prüfen Kosten, Doppelzählung und Export, nicht Netzgrenzen.
// Seit -017-R1 rechnet WM bei Netzgrenze < PCS nicht mehr (siehe anlagenplanung-korrektur.test.mjs, B und R1).
const G_WM = { ...G, netzMW: 20, einspeiseMW: 20, bezugMW: 20 };
const standX = { grundstueck: G_WM, annahmen: ANN, finanzierung: IP.FINANZIERUNG_START };
const rechneX = (v, extra = {}) => IP.rechneVariante({ stand: standX, v: { key: 'A', kosten: {}, systemRef: { systemId: SYS2.systemId, version: 1 }, erloesQuelle: 'wm', ...v }, katalog: IP.KATALOG_START, angebote: [], basis: demoParameter(20, 40, 26400), ergebnisse: ERG, ...extra });

test('Keine Doppelzählung: Planer-Gesamtinvestition = WM-Gesamtinvestition; jede Position genau einmal', () => {
  const r = rechneX({ leistungMW: 15, kapazitaetMWh: 30 });
  const w = WM.berechne(r.params, 'basis');
  nah(w.kennzahlen.gesamtinvestition, r.finErg.gesamt, 1e-7, 'Gesamtinvestition (WM rundet auf Cent)');
  nah(w.capex.reserve, r.finErg.reserve, 1e-7, 'Reserve einmal (WM rundet auf Cent)');
  nah(w.capex.posten.find((x) => x.key === 'bauzeitzinsen').betrag, r.finErg.bauzeitzinsen, 1e-7, 'Bauzeitzinsen einmal');
  nah(w.capex.finanzierungskosten, r.finErg.gebuehren, 1e-7, 'Gebühren nur im Eigenkapitalbedarf, nicht im CAPEX');
  nah(w.capex.posten.reduce((a, x) => a + x.betrag, 0), r.basisSumme + r.finErg.bauzeitzinsen, 1e-9);
  assert.equal(new Set(IP.POSITIONEN.map((p) => p.nr)).size, 19);
  for (const p of IP.POSITIONEN) assert.ok(p.wm === 'reserve' || WM.CAPEX_POSTEN.some(([k]) => k === p.wm), `Position ${p.nr} hat WM-Ziel`);
  for (const p of r.pos.filter((x) => x.datenstatus === 'enthalten')) { assert.equal(p.gesamt, 0, `${p.nr} enthalten → 0`); assert.ok(r.pos.find((x) => x.nr === p.enthaltenIn).gesamt > 0, `${p.nr} Träger bepreist`); }
  for (const p of r.pos.filter((x) => x.datenstatus === 'fehlt')) assert.equal(p.gesamt, 0);
  // CAPEX enthält keine Betriebskosten, keinen Verschleiß, keine Netzentgelte
  assert.ok(!r.pos.some((p) => /Betrieb|Verschleiß|Netzentgelt|Degradation/.test(p.name)));
  assert.equal(w.jahre[0].opexPosten.filter((o) => o.key === 'verschleiss').length, 1, 'Verschleiß einmal in OPEX');
});

test('Trading-Export: Referenz aus B2, nur Preise und Mengen; Netto-DB nicht als Erlös; Netzentgelt nicht still null', () => {
  const s = ERG.find((x) => x.anlage === 'Simulationsanlage 15 MW / 30 MWh' && x.periode === 'R24M' && x.strategie === 'B2' && x.netzvariante === 'ohne_befreiung').summen;
  const ref = IP.erloesReferenz(ERG, 2, 'ohne_befreiung');
  assert.equal(ref.strategie, 'B2'); assert.equal(ref.periode, 'R24M');
  nah(ref.verkaufEURMWh, s.verkaufserloes_eur / s.entladen_mwh); nah(ref.einkaufEURMWh, s.bezugskosten_eur / s.geladen_mwh);
  nah(ref.variableKostenEURMWh, (s.hilfsenergie_eur + s.boersengebuehren_eur + s.bilanzierung_eur + s.netzentgelte_eur + s.steuern_abgaben_eur) / s.entladen_mwh);
  assert.ok(ref.netzentgeltEURMWh > 0, 'Szenario B mit Netzentgelt');
  assert.equal(IP.erloesReferenz(ERG, 2, 'befreit').netzentgeltEURMWh, 0);
  assert.match(IP.erloesReferenz(ERG, 1, 'befreit').fehler, /Keine Simulation mit passender Speicherdauer/, '1-h-Speicher ohne Simulation');
  // In WM: eine Energie-Vermarktung zu 100 %, variable Kosten und Vermarktung/Verschleiß je einmal
  const r = rechneX({ leistungMW: 15, kapazitaetMWh: 30, erloesQuelle: 'b2_B' });
  assert.equal(r.params.einnahmen.length, 1); assert.equal(r.params.einnahmen[0].anteil, 1);
  const w = WM.berechne(r.params, 'basis');
  const aus = w.jahre[0].ausgespeichertMWh;
  nah(aus, ref.entladenJeMWhJahr * r.dim.kapNutzbar * 1 /* Jahr 1 ohne Degradation */, 1e-9, 'ausgespeicherte MWh skaliert');
  nah(w.jahre[0].opexPosten.find((o) => o.key === 'variabel').betrag, aus * ref.variableKostenEURMWh, 1e-9);
  assert.ok(!JSON.stringify(r.params.einnahmen).includes(String(s.netto_arbitrage_db_eur)));
  // Variante ohne passende Simulation fällt sichtbar auf WM-Erlöse zurück
  const r1 = IP.rechneVariante({ stand: standX, v: { key: 'X', kosten: {}, systemRef: { systemId: 'sys-ph-1h', version: 1 }, leistungMW: 10, kapazitaetMWh: 10, erloesQuelle: 'b2_A' }, katalog: IP.KATALOG_START, angebote: [], basis: demoParameter(20, 40, 26400), ergebnisse: ERG });
  assert.ok(r1.hinweise.some((x) => /nicht anwendbar/.test(x)));
});

test('Datenherkunft: Platzhalter ohne Preis, Demo-Vorbelegung gekennzeichnet, Angebot ersetzt Position nachvollziehbar', () => {
  for (const x of IP.KATALOG_START) { assert.equal(x.datenstatus, 'platzhalter'); assert.equal(x.preisEURkWh, null); assert.match(x.hersteller, /Platzhalter/); assert.deepEqual(IP.pruefeSystem(x), []); }
  for (const [nr, vb] of Object.entries(IP.VORBELEGUNG)) { assert.ok(vb.quelle, `Quelle ${nr}`); assert.ok(!['bestaetigtes_angebot', 'marktbenchmark'].includes(vb.datenstatus), `Position ${nr} nicht als Angebot/Benchmark ausgegeben`); }
  assert.ok(IP.pruefeSystem({ ...IP.KATALOG_START[0], datenstatus: 'bestaetigtes_angebot', angebotsdatum: null }).some((x) => /Angebotsdatum/.test(x)));
  const ang = { id: 'ang-1', positionNr: 2, lieferant: 'Lieferant X', einzelpreis: 41000, datum: '2026-10-20' };
  const v = { leistungMW: 10, kapazitaetMWh: 20, kosten: { 2: { angebotId: 'ang-1' } } };
  const d = IP.dimensioniere(v, SYS2, G, ANN);
  const p2 = IP.kostenpositionen(v, d, SYS2, [ang]).find((x) => x.nr === 2);
  assert.equal(p2.datenstatus, 'bestaetigtes_angebot'); assert.equal(p2.einzelpreis, 41000); assert.match(p2.quelle, /Lieferant X/); nah(p2.gesamt, 410000);
  // Fremdes Angebot (andere Position) wird nicht angewendet
  assert.equal(IP.kostenpositionen({ ...v, kosten: { 3: { angebotId: 'ang-1' } } }, d, SYS2, [ang]).find((x) => x.nr === 3).datenstatus, 'platzhalter');
  // Katalogpreis ersetzt die Demo-Annahme nur mit Herkunft
  const p1 = IP.kostenpositionen(v, d, { ...SYS2, preisEURkWh: 150, datenstatus: 'marktbenchmark', kostenstand: '2026-09' }, []).find((x) => x.nr === 1);
  assert.equal(p1.datenstatus, 'marktbenchmark'); assert.match(p1.quelle, /Katalog/); assert.equal(p1.preisstand, '2026-09');
});

test('Regression: STROMKAI-WM 1.1 rechnet ohne neue Angaben identisch zu 1.0', () => {
  const ref = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'wm-1.0-referenz.json'), 'utf8'));
  assert.equal(ref.modellVersion, 'STROMKAI-WM 1.0'); assert.equal(WM.MODELL_VERSION, 'STROMKAI-WM 1.1');
  const faelle = { 'n01-20-40': demoParameter(20, 40, 26400), 'n02-10-20': demoParameter(10, 20, 0), 's01-50-100': demoParameter(50, 100, 52000) };
  let n = 0;
  for (const [k, p] of Object.entries(faelle)) for (const sz of Object.keys(WM.SZENARIEN)) {
    const r = WM.berechne(p, sz, { quelle: 'x', berechnetAm: '2026-10-29T00:00:00Z' });
    assert.deepEqual(r.kennzahlen, ref.faelle[k][sz].kennzahlen, `${k} ${sz}`);
    assert.deepEqual(r.jahre.map((j) => ({ brutto: j.brutto, opex: j.opex, ebitda: j.ebitda, schuldendienst: j.schuldendienst, restschuld: j.restschuld, ekCF: j.ekCF })), ref.faelle[k][sz].jahre, `${k} ${sz} Jahre`);
    n++;
  }
  assert.equal(n, 9);
});

// ---------- Portal: Rechte, Versionen, Übergabe ----------
const DIR = mkdtempSync(join(tmpdir(), 'bess-ip-'));
const PW = 'Vorschau!Speicher-2026';
let server, base;
before(async () => {
  process.env.BESS_DATA_DIR = DIR; process.env.BESS_PREVIEW_HELPERS = '0'; delete process.env.BESS_MFA;
  execFileSync(process.execPath, [join(ROOT, 'data', 'seed.mjs'), DIR]);
  const store = await import('../src/lib/store.mjs');
  await store.openStore(DIR);
  const { createApp } = await import('../server.mjs');
  server = createApp();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); rmSync(DIR, { recursive: true, force: true }); });
class C {
  cookie = '';
  async req(p, o = {}) { const r = await fetch(base + p, { redirect: 'manual', ...o, headers: { ...(o.headers || {}), ...(this.cookie ? { cookie: this.cookie } : {}) } }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; return r; }
  async text(p) { const r = await this.req(p); return { r, body: await r.text() }; }
  async login(email) { const { body } = await this.text('/portal/login'); return this.req('/portal/anmelden', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _t: /name="_t" value="([^"]+)"/.exec(body)[1], email, password: PW }).toString() }); }
  async form(p, felder) { const { body } = await this.text('/portal/anlagenplanung'); const csrf = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; return this.req(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, ...felder }).toString() }); }
}
const sitz = {};
const als = async (e) => { if (!sitz[e]) { sitz[e] = new C(); await sitz[e].login(e); } return sitz[e]; };
const db = async () => (await import('../src/lib/store.mjs')).getDb();
const GRUND = { schritt: 'grundstueck', 'g.bezeichnung': 'Testfläche Nord A', 'g.flaecheM2': '12000', 'g.laengeM': '120', 'g.breiteM': '100', 'g.grenzabstandM': '3', 'g.nichtNutzbarM2': '0', 'g.zufahrtM2': '600', 'g.feuerwehrM2': '400', 'g.nebenanlagenM2': '300', 'g.netzMW': '12', 'g.einspeiseMW': '12', 'g.bezugMW': '15', 'a.flaeche.status': 'bestaetigt', 'a.flaeche.quelle': 'Lageplan (Test)', 'a.geometrie.status': 'angenommen', 'a.netz.status': 'angenommen', 'a.abstaende.status': 'angenommen' };

test('Rechte: Administration und Projektleitung (nur eigene Projekte); Eigentümer, Investor, Vertrieb, Gäste nicht', async () => {
  const a = await als('admin@demo.invalid');
  for (const p of ['/portal/anlagenplanung', '/portal/anlagenplanung/katalog', '/portal/anlagenplanung/p-s01?schritt=vergleich']) assert.equal((await a.req(p)).status, 200, p);
  const pl = await als('projektleitung@demo.invalid');
  assert.equal((await pl.req('/portal/anlagenplanung/p-n01')).status, 200);
  assert.equal((await pl.req('/portal/anlagenplanung/p-s01')).status, 404, 'fremdes Projekt');
  assert.doesNotMatch((await pl.text('/portal/anlagenplanung')).body, /DEMO-S01/);
  assert.equal((await pl.form('/portal/anlagenplanung/katalog', { systemId: '', datenstatus: 'platzhalter' })).status, 404, 'Katalogpflege nur Administration');
  for (const e of ['eigentuemer.a@demo.invalid', 'investor.a@demo.invalid', 'markus@demo.invalid']) {
    const c = await als(e);
    for (const p of ['/portal/anlagenplanung', '/portal/anlagenplanung/katalog', '/portal/anlagenplanung/p-n01', '/portal/anlagenplanung/p-n01/export.csv', '/portal/anlagenplanung/p-n01/bericht']) assert.equal((await c.req(p)).status, 404, `${e} ${p}`);
    assert.doesNotMatch((await c.text('/portal')).body, /Anlagenplanung/, `${e}: kein Menüpunkt`);
  }
  assert.equal((await new C().req('/portal/anlagenplanung')).headers.get('location'), '/portal/login');
  assert.match((await a.text('/portal/zentrale')).body, /href="\/portal\/anlagenplanung"/, 'Kachel in der Zentrale');
});

test('Ablauf: speichern erzeugt Versionen, alte Versionen bleiben unverändert; Fehler werden abgewiesen', async () => {
  const a = await als('admin@demo.invalid');
  let r = await a.form('/portal/anlagenplanung/p-n01/speichern', GRUND);
  assert.equal(r.status, 303); const d = await db();
  const v1 = d.planerStaende.find((x) => x.projectId === 'p-n01' && x.version === 1);
  assert.equal(v1.grundstueck.flaecheM2, 12000); assert.equal(v1.grundstueck.angaben.flaeche.status, 'bestaetigt'); assert.match(v1.pruefsumme, /^[0-9a-f]{16}$/);
  const v1json = JSON.stringify(v1);
  const tech = { schritt: 'technik', v: v1.id, 'v.A.name': 'Variante A', 'v.A.system': 'sys-ph-2h', 'v.A.mw': '10', 'v.A.mwh': '20', 'v.A.erloes': 'wm', 'v.B.name': 'Variante B', 'v.B.system': 'sys-ph-2h', 'v.B.mw': '15', 'v.B.mwh': '30', 'v.B.erloes': 'b2_A', 'v.C.name': 'Variante C', 'v.C.system': 'sys-ph-4h', 'v.C.mw': '10', 'v.C.mwh': '40', 'v.C.erloes': 'b2_B',
    'a.cosPhi': '0,95', 'a.mvaJeTrafo': '5', 'a.flaecheJeTrafoM2': '40', 'a.zufahrtBreiteM': '5', 'a.reserveAnteil': '5', 'a.opexSkalierung': 'skaliert' };
  r = await a.form('/portal/anlagenplanung/p-n01/speichern', tech); assert.equal(r.status, 303);
  const v2 = d.planerStaende.find((x) => x.projectId === 'p-n01' && x.version === 2);
  assert.equal(v2.varianten.length, 3); assert.equal(v2.grundstueck.flaecheM2, 12000, 'Grundstück übernommen'); assert.equal(v2.basisVersion, 1);
  assert.equal(JSON.stringify(d.planerStaende.find((x) => x.id === v1.id)), v1json, 'V1 unverändert');
  // Ungültig: negative Leistung → 422, keine neue Version
  r = await a.form('/portal/anlagenplanung/p-n01/speichern', { ...tech, v: v2.id, 'v.A.mw': '-5' });
  assert.equal(r.status, 422); assert.equal(d.planerStaende.filter((x) => x.projectId === 'p-n01').length, 2);
  // Kostenposition überschreiben ohne Begründung → 422; mit Begründung → V3 mit Herkunft
  const { body } = await a.text(`/portal/anlagenplanung/p-n01?schritt=kosten&v=${v2.id}&var=A`);
  const felder = Object.fromEntries([...body.matchAll(/name="(k\.\d+\.[\w]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&')]));
  const kosten = { ...felder, schritt: 'kosten', v: v2.id, var: 'A', 'k.2.preis': '35.000,00', 'k.2.status': 'schaetzung' };
  r = await a.form('/portal/anlagenplanung/p-n01/speichern', kosten); assert.equal(r.status, 422);
  r = await a.form('/portal/anlagenplanung/p-n01/speichern', { ...kosten, 'k.2.begruendung': 'Eigene Schätzung nach Marktgespräch (Test)' }); assert.equal(r.status, 303);
  const v3 = d.planerStaende.find((x) => x.projectId === 'p-n01' && x.version === 3);
  const k2 = v3.varianten.find((v) => v.key === 'A').kosten[2];
  assert.equal(k2.einzelpreis, 35000); assert.equal(k2.datenstatus, 'schaetzung'); assert.equal(k2.geaendertVon, 'Dirk (Plattformadministration)'); assert.ok(k2.begruendung);
  assert.equal(Object.keys(v3.varianten.find((v) => v.key === 'A').kosten).length, 1, 'nur geänderte Position gespeichert');
  assert.deepEqual(v3.varianten.find((v) => v.key === 'B').kosten, {}, 'andere Varianten unberührt');
});

test('Angebote: erfassen, vergleichen, mit Begründung wählen; Phase wechselt; Mandantentrennung', async () => {
  const a = await als('admin@demo.invalid'); const d = await db();
  const v3 = d.planerStaende.filter((x) => x.projectId === 'p-n01').sort((x, y) => y.version - x.version)[0];
  for (const [lief, preis] of [['Lieferant Eins (Test)', '42000'], ['Lieferant Zwei (Test)', '39500']]) assert.equal((await a.form('/portal/anlagenplanung/p-n01/angebot', { v: v3.id, var: 'B', positionNr: '2', lieferant: lief, einzelpreis: preis, einheit: 'MW', datum: '2026-10-25', dokumentRef: 'TEST-ANG' })).status, 303);
  assert.equal((await a.form('/portal/anlagenplanung/p-n01/angebot', { v: v3.id, var: 'B', positionNr: '18', lieferant: 'x', einzelpreis: '1', datum: '2026-10-25' })).status, 422, 'Reserve nicht per Angebot');
  const ang = d.planerAngebote.find((x) => x.lieferant === 'Lieferant Zwei (Test)');
  const { body } = await a.text(`/portal/anlagenplanung/p-n01?schritt=kosten&v=${v3.id}&var=B`);
  assert.match(body, /Lieferant Zwei \(Test\)<\/th>|Lieferant Zwei \(Test\) <span class="mark mark-info">günstigstes/);
  assert.equal((await a.form('/portal/anlagenplanung/p-n01/angebot-waehlen', { v: v3.id, var: 'B', angebotId: ang.id, begruendung: '' })).status, 422, 'Auswahl ohne Begründung');
  assert.equal((await a.form('/portal/anlagenplanung/p-n01/angebot-waehlen', { v: v3.id, var: 'B', angebotId: ang.id, begruendung: 'Günstigstes vollständiges Angebot (Test)' })).status, 303);
  const v4 = d.planerStaende.find((x) => x.projectId === 'p-n01' && x.version === 4);
  assert.equal(v4.phase, 'angebotsphase'); assert.equal(v4.varianten.find((v) => v.key === 'B').kosten[2].angebotId, ang.id);
  assert.equal(v3.phase, 'vorplanung', 'früherer Stand unverändert');
  // Angebot aus p-n01 ist in p-n02 weder sichtbar noch wählbar; Stand-ID aus p-n01 greift in p-n02 nicht
  const n2 = (await a.text(`/portal/anlagenplanung/p-n02?schritt=kosten&v=${v4.id}`)).body;
  assert.doesNotMatch(n2, /Lieferant Zwei/); assert.doesNotMatch(n2, /Planungsstand V4/);
  assert.equal((await a.form('/portal/anlagenplanung/p-n02/angebot-waehlen', { var: 'B', angebotId: ang.id, begruendung: 'x' })).status, 404);
  // Investor sieht keine Angebote oder internen Kalkulationen
  const inv = await als('investor.a@demo.invalid');
  for (const p of ['/portal', '/portal/projekte/p-n01', '/portal/dokumente']) { const t = (await inv.text(p)).body; assert.doesNotMatch(t, /Lieferant Zwei|Anlagenplanung|Platzhalter-Block/, p); }
});

test('Übergabe an STROMKAI-WM: neue WM-Version mit Planerbezug, Kennzahlen identisch; Katalogversion ändert alten Stand nicht', async () => {
  const a = await als('admin@demo.invalid'); const d = await db();
  const v4 = d.planerStaende.find((x) => x.projectId === 'p-n01' && x.version === 4);
  const vorher = d.finanzmodelle.filter((x) => x.projectId === 'p-n01').length;
  const { body: wb } = await a.text(`/portal/anlagenplanung/p-n01?schritt=wirtschaftlichkeit&v=${v4.id}&var=B`);
  // -017-R1: Variante B (15 MW) liegt an einem 12-MW-Netzanschluss → keine WM-Rechnung, nur der Status, keine Kennzahlen und keine B2-Angaben
  assert.match(wb, /Nicht berechnet \(Netzgrenzen\)/); assert.match(wb, /Übergabe an STROMKAI-WM und Freigabe gesperrt/);
  const bereichB = wb.split('<h2>Wirtschaftliche Modellrechnung Variante B</h2>')[1].split('</section>')[0]; // ohne Navigation
  assert.doesNotMatch(bereichB, /Kapitalwert|EBITDA|DSCR|Strategie B2|Netzentgelt-Szenarien|rechnet mit/);
  // B2-Darstellung an Variante C (10 MW / 40 MWh, Netz ausreichend, Erlösquelle B2 Szenario B)
  const { body: wc } = await a.text(`/portal/anlagenplanung/p-n01?schritt=wirtschaftlichkeit&v=${v4.id}&var=C`);
  assert.match(wc, /Strategie B2/); assert.match(wc, /Datenversion dv-/); assert.match(wc, /R24M/); assert.match(wc, /keine garantierten Zukunftserlöse/); assert.match(wc, /Leistungspreis fehlt/); assert.match(wc, /Kapitalwert/);
  const gesperrt = await a.form('/portal/anlagenplanung/p-n01/wm', { v: v4.id, var: 'B' }); assert.equal(gesperrt.status, 422);
  assert.equal(d.finanzmodelle.filter((x) => x.projectId === 'p-n01').length, vorher, 'keine WM-Version bei gesperrter Übergabe');
  // Variante A (10 MW, Netz in beide Richtungen ausreichend) wird übergeben
  const r = await a.form('/portal/anlagenplanung/p-n01/wm', { v: v4.id, var: 'A' }); assert.equal(r.status, 303);
  const fm = d.finanzmodelle.filter((x) => x.projectId === 'p-n01').sort((x, y) => y.version - x.version)[0];
  assert.equal(d.finanzmodelle.filter((x) => x.projectId === 'p-n01').length, vorher + 1);
  assert.equal(fm.planerRef.standId, v4.id); assert.equal(fm.planerRef.version, 4); assert.equal(fm.planerRef.variante, 'A'); assert.equal(fm.planerRef.pruefsumme, v4.pruefsumme);
  assert.equal(fm.planerRef.belastbarkeit, 'modellrechnung'); assert.equal(fm.planerRef.erloes.verwendet, 'wm');
  assert.equal(fm.ergebnis.basis.meta.modellVersion, 'STROMKAI-WM 1.1');
  const neu = WM.berechne(fm.params, 'basis');
  assert.deepEqual(neu.kennzahlen, fm.ergebnis.basis.kennzahlen, 'gespeicherte WM-Kennzahlen reproduzierbar');
  const akte = (await a.text(`/portal/wirtschaftlichkeit/p-n01?v=${fm.id}`)).body;
  assert.match(akte, /Investitionsplaner DEMO-N01 V4, Variante A/);
  assert.match(akte, new RegExp(new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(fm.ergebnis.basis.kennzahlen.gesamtinvestition).replace(/\s/g, '.')));
  // Neue Katalogversion des 2-h-Systems mit Preis: alter Stand rechnet unverändert weiter
  const vorherCSV = await (await a.req(`/portal/anlagenplanung/p-n01/export.csv?v=${v4.id}`)).text();
  const kat = Object.fromEntries(IP.KATALOG_FELDER.map(([k, , , art]) => [k, art === 'text' ? 'Test' : '']));
  Object.assign(kat, { systemId: 'sys-ph-2h', datenstatus: 'marktbenchmark', preisBasis: 'nutzbar', laengeM: '6,06', breiteM: '2,44', hoeheM: '2,9', abstandStirnM: '3', abstandSeiteM: '1,5', kapNominalMWh: '4', kapNutzbarMWh: '3,8', leistungMW: '2', wirkungsgrad: '86', lebensdauerJahre: '20', degradationJahr: '1,5', preisEURkWh: '150' });
  assert.equal((await a.form('/portal/anlagenplanung/katalog', kat)).status, 303);
  assert.ok(d.planerKatalog.some((x) => x.systemId === 'sys-ph-2h' && x.version === 2));
  const nachherCSV = await (await a.req(`/portal/anlagenplanung/p-n01/export.csv?v=${v4.id}`)).text();
  assert.equal(nachherCSV, vorherCSV, 'Stand V4 verweist weiter auf Katalogversion 1');
  assert.match(nachherCSV, /^﻿?STROMKAI Anlagenplanung;/); assert.match(nachherCSV, /Kapitalwert Basis EUR/); assert.match(nachherCSV, /Datenstatus;Quelle;Preisstand;Lieferant;Ausschreibungsposition;WM-Position/);
});

test('Freigabe: nur Administration, nur ohne Platzhalter; Bericht und Vergleich ohne „beste Variante“', async () => {
  const a = await als('admin@demo.invalid'); const d = await db();
  const v4 = d.planerStaende.find((x) => x.projectId === 'p-n01' && x.version === 4);
  const r = await a.form('/portal/anlagenplanung/p-n01/freigeben', { v: v4.id }); assert.equal(r.status, 422);
  assert.match(await r.text(), /Platzhalter oder fehlen/);
  assert.equal((await (await als('projektleitung@demo.invalid')).form('/portal/anlagenplanung/p-n01/freigeben', { v: v4.id })).status, 404);
  const { body } = await a.text(`/portal/anlagenplanung/p-n01?schritt=vergleich&v=${v4.id}`);
  assert.match(body, /Keine Variante wird als „beste“ ausgewiesen/); assert.doesNotMatch(body.replace(/Keine Variante wird als „beste“ ausgewiesen/, ''), /beste Variante|Empfehlung: Variante/);
  for (const t of ['Technische Vorplanung', 'Wirtschaftliche Modellrechnung (STROMKAI-WM)', 'Kapitalwert Netzentgelt A', 'Kapitalwert Netzentgelt B', 'Finanzierungszusage', 'Fixe Betriebskosten']) assert.ok(body.includes(t), t);
  const ber = (await a.text(`/portal/anlagenplanung/p-n01/bericht?v=${v4.id}`)).body;
  assert.match(ber, /Kalkulationsbericht DEMO-N01 – Planungsstand V4/); assert.match(ber, /keine Finanzierungszusage/);
  assert.doesNotMatch(ber + body, /136\.000|408\.000|Schönberg|Schoenberg/, 'keine Projektzahlen aus dem Kostenplan');
});
