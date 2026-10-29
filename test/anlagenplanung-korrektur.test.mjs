// Regressionstests zur Korrektur AW-20261029-DK-STROMKAI-INVESTITIONSPLANER-KORREKTUR-017:
// A Flächenbilanz und Anordnung, B Netzgrenzen und Belastbarkeit, C verwendete Erlösquelle, D Preisbasis Batterie,
// E Finanzierungskennzahlen. Erwartungswerte sind von Hand nachgerechnet (siehe Kommentare), nicht aus dem Code übernommen.
// Aufruf: node --test test/anlagenplanung-korrektur.test.mjs
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
const nah = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg} ${a} ≠ ${b}`);
const SYS2 = IP.KATALOG_START.find((x) => x.systemId === 'sys-ph-2h'); // 6,06 × 2,44 m, Abstände 3 / 1,5 m, 4 MWh nominal, 3,8 nutzbar, 2 MW
const SYS1 = IP.KATALOG_START.find((x) => x.systemId === 'sys-ph-1h');
const ANN = { ...IP.ANNAHMEN_START };
const ERG = JSON.parse(readFileSync(join(ROOT, 'src', 'strommarkt-daten', 'ergebnisse.json'), 'utf8')).ergebnisse;
const leer = { ...structuredClone(IP.GRUNDSTUECK_START), grenzabstandM: 0, nichtNutzbarM2: 0, zufahrtM2: 0, feuerwehrM2: 0, nebenanlagenM2: 0 };
const summeZonen = (z) => z.zufahrt + z.feuerwehr + z.nichtNutzbar + z.stationen + z.blockzone;

// ---------- A: Flächenbilanz und Anordnung ----------
test('A1 ohne zusätzliche Abzüge: ganze Fläche ist Blockzone; Raster von Hand gerechnet', () => {
  const g = { ...leer, laengeM: 100, breiteM: 50 };
  const m = IP.flaechenmodell(g, { ...ANN, zufahrtBreiteM: 0 }, 0);
  assert.equal(m.innen, 5000); assert.equal(m.zonen.blockzone, 5000); nah(summeZonen(m.zonen), 5000);
  // Spalten: (100 − 3) / (6,06 + 3) = 10,7 → 10; Reihen: (50 − 1,5) / (2,44 + 1,5) = 12,3 → 12; 120 Plätze
  const lay = IP.layout(m, SYS2, 200);
  assert.equal(lay.cols, 10); assert.equal(lay.rows, 12); assert.equal(lay.plaetze, 120);
  assert.equal(lay.bloecke.length, 120, 'nie mehr Blöcke als Plätze'); assert.equal(lay.passt, false); assert.equal(lay.ueberzaehlig, 80);
});

test('A2 Zufahrt und Nebenanlagen: Zufahrt mindestens 5 m breit, Nebenanlagen genau einmal', () => {
  const g = { ...leer, laengeM: 100, breiteM: 50, zufahrtM2: 400, nebenanlagenM2: 450 };
  const m = IP.flaechenmodell(g, ANN, 0);
  // Zufahrt: max(5 m, 400 / 100 = 4 m) = 5 m → 500 m²; Nebenanlagen 450 m² auf 45 m Höhe → 10 m Breite; Blockzone 90 × 45 = 4050
  nah(m.geo.hz, 5); nah(m.zonen.zufahrt, 500); nah(m.zonen.stationen, 450); nah(m.zonen.blockzone, 4050); nah(summeZonen(m.zonen), 5000);
  assert.ok(m.hinweise.some((x) => /Zufahrt geometrisch mit 5 m Breite/.test(x)), 'Mehrfläche der Zufahrt wird erklärt');
  const b = IP.flaechenbilanz(g, ANN);
  nah(b.fuerBloecke, 4050); nah(b.abzug.zufahrt + b.abzug.nebenanlagen + b.fuerBloecke, 5000);
  // Mit Anlagenstationen (10 MW → ⌈10 / 0,95 / 5⌉ = 3 Stationen à 40 m² = 120 m²): Blockzone = 4050 − 120 = 3930
  const d = IP.dimensioniere({ leistungMW: 10, kapazitaetMWh: 20 }, SYS2, g, ANN);
  assert.equal(d.trafos, 3); nah(d.flaecheStationen, 120); nah(d.modell.zonen.blockzone, 3930, 1e-9, 'Stationen nicht doppelt');
  nah(d.rest, 3930 - d.bloecke * 9.06 * 3.94, 1e-9);
});

test('A3 gesonderte Feuerwehrflächen werden als eigener Streifen reserviert', () => {
  const g = { ...leer, laengeM: 100, breiteM: 50, feuerwehrM2: 300 };
  const m = IP.flaechenmodell(g, ANN, 0);
  // Zufahrt 5 m (500 m²), Feuerwehr 3 m (300 m²), Blockzone 100 × 42 = 4200
  nah(m.geo.hf, 3); nah(m.zonen.feuerwehr, 300); nah(m.zonen.blockzone, 4200); nah(summeZonen(m.zonen), 5000);
  const d = IP.dimensioniere({ leistungMW: 4, kapazitaetMWh: 8 }, SYS2, g, ANN);
  for (const x of d.layout.bloecke) assert.ok(x.y + x.h <= d.modell.geo.hz + d.modell.geo.zoneH + 1e-9, 'kein Block in der Feuerwehrfläche');
});

test('A4 unzureichende Fläche: negative Restfläche, nicht passend', () => {
  // 40 × 30 m, kein Grenzabstand, Zufahrt 5 m → Blockzone 40 × 25 = 1000 m² minus 3 Stationen (120 m²) = 880 m²;
  // 30 MWh / 3,8 = 8, 15 MW / 2 = 8 → 8 Blöcke à 9,06 × 3,94 = 35,7 m²; das passt. 60 MWh → 16 Blöcke … reicht ebenfalls.
  // Mit 400 MWh / 3,8 → 106 Blöcke × 35,7 m² = 3784 m² > Blockzone → Fehlbetrag
  const d = IP.dimensioniere({ leistungMW: 15, kapazitaetMWh: 400 }, SYS2, { ...leer, laengeM: 40, breiteM: 30 }, ANN);
  assert.equal(d.bloecke, 106); assert.ok(d.rest < 0); assert.equal(d.passt, false);
  assert.ok(d.meldungen.some((m) => m.art === 'bad' && /passt rechnerisch nicht/.test(m.text)));
});

test('A5 Gesamtfläche reicht, Anordnung geometrisch unmöglich', () => {
  // 400 × 14 m, Grenzabstand 3 → innen 394 × 8; Zufahrt 5 m → Blockzone 3 m hoch < 2,44 + 2 · 1,5 = 5,44 m → 0 Reihen
  const d = IP.dimensioniere({ leistungMW: 10, kapazitaetMWh: 20 }, SYS2, { ...leer, laengeM: 400, breiteM: 14, grenzabstandM: 3 }, ANN);
  assert.ok(d.rest > 0, 'Fläche reicht rechnerisch'); assert.equal(d.layout.rows, 0); assert.equal(d.layout.plaetze, 0);
  assert.equal(d.passt, false); assert.ok(d.meldungen.some((m) => /Fläche reicht rechnerisch, aber/.test(m.text)));
});

test('A6 Bilanz vor und nach der Anordnung: keine Doppelzählung, Blöcke in der Blockzone mit vollem Abstand', () => {
  const g = { ...leer, laengeM: 120, breiteM: 100, grenzabstandM: 3, zufahrtM2: 600, feuerwehrM2: 400, nebenanlagenM2: 300, nichtNutzbarM2: 500 };
  const vor = IP.flaechenbilanz(g, ANN);
  const d = IP.dimensioniere({ leistungMW: 15, kapazitaetMWh: 30 }, SYS2, g, ANN);
  nah(summeZonen(vor.zonen), vor.innen, 1e-9, 'vor Anordnung'); nah(summeZonen(d.modell.zonen), d.modell.innen, 1e-9, 'nach Anordnung');
  nah(vor.fuerBloecke - d.flaecheStationen, d.modell.zonen.blockzone, 1e-9, 'Stationen genau einmal abgezogen');
  for (const k of ['zufahrt', 'feuerwehr', 'nichtNutzbar']) nah(d.modell.zonen[k], vor.zonen[k], 1e-9, k);
  const z = d.modell.geo;
  for (const x of d.layout.bloecke) assert.ok(x.x >= z.wn + SYS2.abstandStirnM - 1e-9 && x.x + x.w <= z.wn + z.zoneW - SYS2.abstandStirnM + 1e-9 && x.y >= z.hz + SYS2.abstandSeiteM - 1e-9 && x.y + x.h <= z.hz + z.zoneH - SYS2.abstandSeiteM + 1e-9, 'Block mit Abstand in der Blockzone');
  for (let i = 0; i < d.layout.bloecke.length; i++) for (let j = i + 1; j < d.layout.bloecke.length; j++) {
    const a = d.layout.bloecke[i], b = d.layout.bloecke[j];
    const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)), dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
    assert.ok(dx >= SYS2.abstandStirnM - 1e-9 || dy >= SYS2.abstandSeiteM - 1e-9, 'Abstand zwischen Blöcken');
  }
  assert.equal(d.passt, true);
  // Abstand 0 m: nicht passend
  const ohne = IP.dimensioniere({ leistungMW: 15, kapazitaetMWh: 30 }, { ...SYS2, abstandSeiteM: 0 }, g, ANN);
  assert.equal(ohne.passt, false); assert.ok(ohne.meldungen.some((m) => /abstand des Systems ist 0 m/i.test(m.text)));
});

// ---------- B: Netzgrenzen und Belastbarkeit ----------
const stand = (g) => ({ grundstueck: { ...leer, laengeM: 120, breiteM: 100, ...g }, annahmen: ANN, finanzierung: IP.FINANZIERUNG_START });
const rv = (g, v = {}) => IP.rechneVariante({ stand: stand(g), v: { key: 'A', kosten: {}, systemRef: { systemId: 'sys-ph-2h', version: 1 }, leistungMW: 10, kapazitaetMWh: 20, erloesQuelle: 'wm', ...v }, katalog: IP.KATALOG_START, angebote: [], basis: demoParameter(20, 40, 26400), ergebnisse: ERG, datenversion: 'dv-test' });

test('B1–B3 Einspeisung oder Bezug kleiner als PCS, unterschiedliche Grenzen: Anlage unverändert, eingeschränkt, gesperrt', () => {
  const e = rv({ einspeiseMW: 8, bezugMW: 20 });
  assert.equal(e.dim.pcsMW, 10); assert.equal(e.dim.batterieMW, 12); assert.equal(e.dim.einspeise, 8); assert.equal(e.dim.bezug, 10);
  assert.equal(e.dim.netzStatus, 'eingeschraenkt'); assert.equal(e.belastbarkeit, 'eingeschraenkt'); assert.ok(e.sperren.length);
  assert.equal(e.params.technik.leistungMW, 10, 'Netzgrenze überschreibt die Anlagenleistung nicht'); assert.equal(e.params.technik.einspeiseMW, 8);
  const b = rv({ einspeiseMW: 20, bezugMW: 6 });
  assert.equal(b.dim.bezug, 6); assert.equal(b.dim.einspeise, 10); assert.equal(b.belastbarkeit, 'eingeschraenkt');
  const u = rv({ einspeiseMW: 8, bezugMW: 6 });
  assert.equal(u.params.technik.einspeiseMW, 8); assert.equal(u.params.technik.bezugMW, 6);
  assert.ok(u.dim.meldungen.some((m) => /begrenzt die Einspeisung auf 8 MW/.test(m.text)) && u.dim.meldungen.some((m) => /begrenzt den Bezug auf 6 MW/.test(m.text)));
});

test('B4 ausreichende Netzleistung in beiden Richtungen: Modellrechnung ohne Netzsperre', () => {
  const r = rv({ netzMW: 20, einspeiseMW: 20, bezugMW: 20 });
  assert.equal(r.dim.netzStatus, 'ausreichend'); assert.equal(r.belastbarkeit, 'modellrechnung');
  assert.ok(!r.sperren.some((x) => /Netz|Jahresmodell|ungeprüft/.test(x)));
  assert.doesNotThrow(() => WM.berechne(r.params, 'basis'));
});

test('B5 fehlende Netzanschlussdaten: ungeprüft, Freigabe gesperrt, keine erfundene Grenze', () => {
  const r = rv({});
  assert.equal(r.dim.netzStatus, 'ungeprueft'); assert.equal(r.belastbarkeit, 'ungeprueft'); assert.equal(r.dim.netz.grenzeEinspeise, null);
  assert.equal(r.params.technik.einspeiseMW, 10, 'ohne Angabe nur die PCS-Leistung, keine angenommene Netzgrenze'); assert.ok(r.sperren.length);
});

test('B6 Einspeisung oder Bezug gleich null: keine Wirtschaftlichkeit, keine Division durch null', () => {
  for (const g of [{ einspeiseMW: 0 }, { bezugMW: 0 }, { netzMW: 0 }]) {
    const r = rv(g);
    assert.equal(r.dim.netzStatus, 'unzulaessig'); assert.equal(r.belastbarkeit, 'nicht_berechenbar'); assert.equal(r.params, null);
    assert.ok(r.dim.dauerH === null || Number.isFinite(r.dim.dauerH));
  }
  assert.match(IP.erloesReferenz(ERG, null, 'befreit').fehler, /Speicherdauer/); assert.match(IP.erloesReferenz(ERG, Infinity, 'befreit').fehler, /Speicherdauer/);
});

test('B7 unzulässige oder widersprüchliche Leistungswerte; WM prüft den Jahresdurchsatz gegen die Netzgrenzen', () => {
  assert.equal(rv({ bezugMW: -1 }).belastbarkeit, 'nicht_berechenbar');
  const w = rv({ netzMW: 12, einspeiseMW: 15, bezugMW: 12 });
  assert.equal(w.dim.einspeise, 10); assert.ok(w.dim.meldungen.some((m) => /Widersprüchlich: Einspeiseleistung 15 MW über der Netzanschlussleistung 12 MW/.test(m.text)));
  // WM: 40 MWh nominal × 0,9 × 365 Zyklen × 0,97 × 0,7 (Energieanteile) ≈ 8.926 MWh/a; 0,5 MW × 8760 h × 0,97 = 4.249 MWh → unmöglich
  const p = demoParameter(20, 40, 0);
  assert.ok(WM.pruefeParameter({ ...p, technik: { ...p.technik, einspeiseMW: 0.5 } }).some((x) => /übersteigt, was die Einspeiseleistung/.test(x)));
  assert.ok(WM.pruefeParameter({ ...p, technik: { ...p.technik, bezugMW: 0.5 } }).some((x) => /Ladeenergie/.test(x)));
  assert.deepEqual(WM.pruefeParameter({ ...p, technik: { ...p.technik, einspeiseMW: 20, bezugMW: 20 } }), []);
  // Leistungserlöse höchstens mit der in beide Richtungen zulässigen Leistung
  const voll = WM.berechne(p, 'basis'), grenze = WM.berechne({ ...p, technik: { ...p.technik, einspeiseMW: 20, bezugMW: 10 } }, 'basis');
  const rr = (x) => x.jahre[0].erloese.find((e) => e.key === 'regelreserve').betrag;
  nah(rr(grenze), rr(voll) * 10 / 20, 1e-12);
});

// ---------- C: Erlösquelle ----------
test('C1–C4 passende B2-Referenz, keine passende Dauer, fehlende Kombination, Rückfall', () => {
  const ok = rv({ netzMW: 20, einspeiseMW: 20, bezugMW: 20 }, { erloesQuelle: 'b2_A' });
  assert.deepEqual({ ...ok.erloes, referenz: { ...ok.erloes.referenz } }, { angefordert: 'b2_A', verwendet: 'b2_A', rueckfall: false, grund: null, referenz: { anlage: ok.referenz.anlage, dauerRefH: 2, periode: 'R24M', strategie: 'B2', netzvariante: 'befreit', datenversion: 'dv-test' } });
  assert.equal(ok.params.einnahmen.length, 1); assert.match(ok.params.einnahmen[0].name, /B2/);
  const r1 = IP.rechneVariante({ ...{ stand: stand({ netzMW: 20, einspeiseMW: 20, bezugMW: 20 }) }, v: { key: 'X', kosten: {}, systemRef: { systemId: 'sys-ph-1h', version: 1 }, leistungMW: 10, kapazitaetMWh: 10, erloesQuelle: 'b2_A' }, katalog: IP.KATALOG_START, angebote: [], basis: demoParameter(20, 40, 0), ergebnisse: ERG, datenversion: 'dv-test' });
  assert.equal(r1.erloes.angefordert, 'b2_A'); assert.equal(r1.erloes.verwendet, 'wm'); assert.equal(r1.erloes.rueckfall, true); assert.equal(r1.erloes.referenz, null);
  assert.match(r1.erloes.grund, /Speicherdauer/); assert.deepEqual(r1.params.einnahmen, demoParameter(20, 40, 0).einnahmen, 'Rückfall: WM-Erlösannahmen');
  assert.ok(r1.hinweise.some((x) => /nicht anwendbar/.test(x)));
  assert.match(IP.erloesReferenz(ERG, 2, 'befreit', 'KJ2099').fehler, /enthält B2\/KJ2099\/befreit/);
  assert.match(IP.erloesReferenz(ERG, 2, 'befreit', 'R24M', 'X9').fehler, /enthält X9/);
  assert.match(IP.erloesReferenz(null, 2, 'befreit').fehler, /nicht verfügbar/);
});

// ---------- D: Preisbasis ----------
const dim2 = IP.dimensioniere({ leistungMW: 10, kapazitaetMWh: 20 }, SYS2, { ...leer, laengeM: 120, breiteM: 100 }, ANN); // 6 Blöcke: 24 MWh nominal, 22,8 nutzbar
const p1 = (sys, v = {}, ang = []) => IP.kostenpositionen({ leistungMW: 10, kapazitaetMWh: 20, kosten: {}, ...v }, dim2, sys, ang).find((x) => x.nr === 1);

test('D1–D3 gleicher Preis, explizite Basis: nominal × 24.000 kWh, nutzbar × 22.800 kWh', () => {
  assert.equal(dim2.bloecke, 6); nah(dim2.kapNominal, 24); nah(dim2.kapNutzbar, 22.8);
  const nom = p1({ ...SYS2, preisEURkWh: 100, preisBasis: 'nominal' }), nutz = p1({ ...SYS2, preisEURkWh: 100, preisBasis: 'nutzbar' });
  nah(nom.gesamt, 2_400_000); nah(nutz.gesamt, 2_280_000); assert.equal(nom.einheit, 'kWh nominal'); assert.equal(nutz.einheit, 'kWh nutzbar');
  nah(nom.gesamt / nutz.gesamt, 1 / 0.95, 1e-12, 'nutzbarer Anteil 95 %');
  // Vorbelegung (Demo 120 EUR/kWh) ist nominal wie in STROMKAI-WM: 24.000 kWh × 120
  const vb = p1(SYS2); assert.equal(vb.preisBasis, 'nominal'); nah(vb.gesamt, 2_880_000); assert.match(vb.quelle, /Demo-Annahme.*synthetisch.*nominaler kWh/);
  const wmDemo = demoParameter(24, 24, 0).capex.batterie; nah(wmDemo, 120 * 24 * 1000, 1e-12, 'WM-Demo rechnet mit derselben Basis');
});

test('D4 Lieferkosten getrennt und einmal; Angebot ersetzt Katalogpreis samt Lieferkosten', () => {
  const sys = { ...SYS2, preisEURkWh: 100, preisBasis: 'nutzbar', lieferkostenEURBlock: 5000 };
  const mit = p1(sys); nah(mit.lieferkosten, 30_000); nah(mit.gesamt, 2_280_000 + 30_000); assert.equal(mit.einzelpreis, 100, 'Preis nicht mit Lieferkosten vermischt');
  const ohne = p1({ ...sys, lieferkostenEURBlock: null }); nah(ohne.lieferkosten, 0); nah(ohne.gesamt, 2_280_000);
  const ang = [{ id: 'a1', positionNr: 1, lieferant: 'X', einzelpreis: 90, datum: '2026-10-01', preisBasis: 'nominal' }];
  const mitAng = p1(sys, { kosten: { 1: { angebotId: 'a1' } } }, ang);
  nah(mitAng.lieferkosten, 0); nah(mitAng.gesamt, 90 * 24_000); assert.equal(mitAng.preisBasis, 'nominal');
});

test('D5 unbekannte Preisbasis: gekennzeichnet, gesperrt; Katalog ohne Basis abgewiesen', () => {
  const r = p1({ ...SYS2, preisEURkWh: 100, preisBasis: 'unbekannt' });
  assert.equal(r.preisBasisUnklar, true);
  assert.ok(IP.pruefeSystem({ ...SYS2, preisEURkWh: 100, preisBasis: null }).some((x) => /Preisbasis/.test(x)));
  const rr = IP.rechneVariante({ stand: stand({ netzMW: 20, einspeiseMW: 20, bezugMW: 20 }), v: { key: 'A', kosten: { 1: { einzelpreis: 100, preisBasis: 'unbekannt' } }, systemRef: { systemId: 'sys-ph-2h', version: 1 }, leistungMW: 10, kapazitaetMWh: 20, erloesQuelle: 'wm' }, katalog: IP.KATALOG_START, angebote: [], basis: demoParameter(20, 40, 0) });
  assert.ok(rr.sperren.some((x) => /Preisbasis/.test(x)));
  // Investition je kWh nutzbar aus derselben Investitionssumme
  const ok = rv({ netzMW: 20, einspeiseMW: 20, bezugMW: 20 });
  const w = WM.berechne(ok.params, 'basis');
  nah(w.kennzahlen.gesamtinvestition / (ok.dim.kapNutzbar * 1000), ok.finErg.gesamt / (ok.dim.kapNutzbar * 1000), 1e-7);
});

// ---------- E: Finanzierung ----------
const fin2 = { ...structuredClone(IP.FINANZIERUNG_START), fkAnteil: 0.7, tranchen: [
  { name: 'A', anteil: 0.6, zins: 0.04, laufzeitJahre: 12, tilgungsfreiJahre: 2, modell: 'linear', gebuehrAnteil: 0.01 },
  { name: 'B', anteil: 0.4, zins: 0.08, laufzeitJahre: 8, tilgungsfreiJahre: 0, modell: 'annuitaet', gebuehrAnteil: 0.02 }] };
const rvF = (fin) => IP.rechneVariante({ stand: { ...stand({ netzMW: 20, einspeiseMW: 20, bezugMW: 20 }), finanzierung: fin }, v: { key: 'A', kosten: {}, systemRef: { systemId: 'sys-ph-2h', version: 1 }, leistungMW: 10, kapazitaetMWh: 20, erloesQuelle: 'wm' }, katalog: IP.KATALOG_START, angebote: [], basis: demoParameter(20, 40, 26400) });

test('E1–E3 mehrere Tranchen: Planer und WM identisch; Szenariozins = Plan + Delta × Restschuld (Korrektur)', () => {
  const r = rvF(fin2);
  const b = WM.berechne(r.params, 'basis'), k = WM.berechne(r.params, 'konservativ');
  for (const [i, j] of r.finErg.jahre.entries()) { nah(b.jahre[i].zinsen, j.zinsen, 1e-7, `Zinsen J${i + 1}`); nah(b.jahre[i].tilgung, j.tilgung, 1e-7, `Tilgung J${i + 1}`); }
  nah(b.jahre.reduce((a, x) => a + x.zinsen, 0), r.finErg.zinsaufwand, 1e-7); nah(b.kennzahlen.schuldendienstJahr, r.finErg.schuldendienstMax, 1e-7);
  // konservativ: +1 %-Punkt auf alle Tranchen bei festem Tilgungsverlauf. Das Szenario erhöht auch den CAPEX (× 1,1), daher in
  // Anteilen des jeweiligen Fremdkapitals rechnen: Zinsen_j = FK_konservativ × (Planzins_j / FK + 0,01 × offener Anteil zu Jahresbeginn)
  const fkK = k.kennzahlen.fremdkapital, fk = r.finErg.fk;
  let offen = 1;
  for (const [i, j] of r.finErg.jahre.entries()) { nah(k.jahre[i].zinsen, fkK * (j.zinsen / fk + 0.01 * offen), 1e-7, `konservativ J${i + 1}`); offen -= j.tilgung / fk; }
  // Die frühere proportionale Skalierung (Planzins × (z̄ + 0,01) / z̄) stimmt nur, solange die Restschuld noch im Verhältnis der
  // Tranchengewichte steht (Jahr 1). Sobald die Tranchen (4 % linear nach 2 Freijahren, 8 % Annuität) unterschiedlich tilgen, weicht sie ab.
  const abw = r.finErg.jahre.map((j, i) => Math.abs(fkK * (j.zinsen / fk) * (r.finErg.zinsBau + 0.01) / r.finErg.zinsBau - k.jahre[i].zinsen));
  assert.ok(abw[0] < 0.01, 'Jahr 1 gleich (auf Cent)'); assert.ok(Math.max(...abw) > 100, `Befund E: proportionale Skalierung weicht ab (max. ${Math.round(Math.max(...abw))} EUR)`);
});

test('E4–E8 tilgungsfreie Zeit, Bauzeitzinsen, Gebühren, DSRA, DSCR, vollständige Rückzahlung', () => {
  const r = rvF(fin2), w = WM.berechne(r.params, 'basis');
  // tilgungsfrei: Tranche A tilgt in J1–J2 nicht; Tilgung kommt nur aus B
  const bJ1 = r.finErg.jahre[0].tilgung; assert.ok(bJ1 > 0 && bJ1 < r.finErg.fk * 0.4 / 4);
  // Bauzeitzinsen einmal im CAPEX, Gebühren einmal im Eigenkapitalbedarf
  nah(w.capex.posten.find((x) => x.key === 'bauzeitzinsen').betrag, r.finErg.bauzeitzinsen, 1e-7); nah(w.capex.finanzierungskosten, r.finErg.gebuehren, 1e-7);
  // DSRA = max. Schuldendienst × 6/12; EK-Bedarf = Investition − FK + Gebühren + DSRA; Freigabe im letzten Planjahr
  nah(w.capex.dsra, r.finErg.schuldendienstMax * 6 / 12, 1e-7);
  nah(w.kennzahlen.eigenkapitalbedarf, w.kennzahlen.gesamtinvestition - w.kennzahlen.fremdkapital + w.capex.finanzierungskosten + w.capex.dsra, 1e-7);
  const n = r.finErg.laufzeitJahre; const j = w.jahre[n - 1];
  nah(j.ekCF, j.operativerCF - j.schuldendienst + w.capex.dsra, 1e-7, 'DSRA-Freigabe');
  // vollständige Rückzahlung
  nah(w.jahre.reduce((a, x) => a + x.tilgung, 0), w.kennzahlen.fremdkapital, 1e-7); assert.ok(w.jahre[n - 1].restschuld < 1e-6); assert.ok(w.jahre.slice(n).every((x) => x.schuldendienst === 0 && x.dscr === null));
  // DSCR je Jahr = operativer Cashflow / Schuldendienst
  for (const x of w.jahre.filter((y) => y.schuldendienst > 0)) nah(x.dscr, x.operativerCF / x.schuldendienst, 1e-12);
  // ausreichend / unzureichend: Erlöse verdoppelt bzw. halbiert
  const hoch = WM.berechne({ ...r.params, einnahmen: r.params.einnahmen.map((e) => ({ ...e, verkaufEURMWh: e.verkaufEURMWh && e.verkaufEURMWh * 2, eurJeMWJahr: e.eurJeMWJahr && e.eurJeMWJahr * 2 })) }, 'basis');
  const tief = WM.berechne({ ...r.params, einnahmen: r.params.einnahmen.map((e) => ({ ...e, verkaufEURMWh: e.verkaufEURMWh && e.verkaufEURMWh * 0.5, eurJeMWJahr: e.eurJeMWJahr && e.eurJeMWJahr * 0.5 })) }, 'basis');
  assert.ok(hoch.kennzahlen.dscrMin > 1, `ausreichend ${hoch.kennzahlen.dscrMin}`); assert.ok(tief.kennzahlen.dscrMin < 1, `unzureichend ${tief.kennzahlen.dscrMin}`);
});

// ---------- C5: Quelle konsistent in Oberfläche, Vergleich, CSV und Bericht ----------
const DIR = mkdtempSync(join(tmpdir(), 'bess-ipk-'));
let server, base;
before(async () => {
  process.env.BESS_DATA_DIR = DIR; process.env.BESS_PREVIEW_HELPERS = '0'; delete process.env.BESS_MFA;
  execFileSync(process.execPath, [join(ROOT, 'data', 'seed.mjs'), DIR]);
  const store = await import('../src/lib/store.mjs'); await store.openStore(DIR);
  const { createApp } = await import('../server.mjs'); server = createApp();
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); rmSync(DIR, { recursive: true, force: true }); });
test('C5 Rückfall wird in Wirtschaftlichkeit, Vergleich, CSV und Bericht gleich ausgewiesen; Übergabe trägt die Quelle', async () => {
  let cookie = '';
  const req = async (p, o = {}) => { const r = await fetch(base + p, { redirect: 'manual', ...o, headers: { ...(o.headers || {}), cookie } }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return r; };
  const lb = await (await req('/portal/login')).text();
  await req('/portal/anmelden', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _t: /name="_t" value="([^"]+)"/.exec(lb)[1], email: 'admin@demo.invalid', password: 'Vorschau!Speicher-2026' }).toString() });
  const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await req('/portal/anlagenplanung')).text())[1];
  const form = (p, f) => req(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, ...f }).toString() });
  let r = await form('/portal/anlagenplanung/p-n02/speichern', { schritt: 'grundstueck', 'g.bezeichnung': 'Test', 'g.laengeM': '120', 'g.breiteM': '100', 'g.grenzabstandM': '3', 'g.netzMW': '20', 'g.einspeiseMW': '20', 'g.bezugMW': '20' });
  const v1 = new URL(r.headers.get('location'), base).searchParams.get('v');
  r = await form('/portal/anlagenplanung/p-n02/speichern', { schritt: 'technik', v: v1, 'v.A.name': 'Variante A', 'v.A.system': 'sys-ph-2h', 'v.A.mw': '10', 'v.A.mwh': '20', 'v.A.erloes': 'b2_A', 'v.B.name': 'Variante B', 'v.B.system': 'sys-ph-1h', 'v.B.mw': '10', 'v.B.mwh': '10', 'v.B.erloes': 'b2_A',
    'a.cosPhi': '0,95', 'a.mvaJeTrafo': '5', 'a.flaecheJeTrafoM2': '40', 'a.zufahrtBreiteM': '5', 'a.reserveAnteil': '5', 'a.opexSkalierung': 'skaliert' });
  const v2 = new URL(r.headers.get('location'), base).searchParams.get('v');
  const ws = await (await req(`/portal/anlagenplanung/p-n02?schritt=wirtschaftlichkeit&v=${v2}&var=B`)).text();
  assert.match(ws, /Verwendete Erlösquelle:<\/strong> Erlösannahmen der aktuellen STROMKAI-WM-Version des Projekts · RÜCKFALL statt/);
  assert.doesNotMatch(ws.split('Verwendete Erlösquelle')[1].split('</p>')[0], /Strategie B2/, 'keine B2-Angabe bei Rückfall');
  const wa = await (await req(`/portal/anlagenplanung/p-n02?schritt=wirtschaftlichkeit&v=${v2}&var=A`)).text();
  assert.match(wa, /Verwendete Erlösquelle:<\/strong> Backtest B2 \(Referenzstrategie\), Netzentgelt-Szenario A „befreit“ · Strategie B2 .*Simulationsanlage .*Zeitraum R24M .*Datenversion dv-/);
  const vg = await (await req(`/portal/anlagenplanung/p-n02?schritt=vergleich&v=${v2}`)).text();
  assert.match(vg, /Nicht unmittelbar vergleichbar/); assert.match(vg, /WM-Annahmen – Rückfall/); assert.match(vg, /B2, Szen\. A</);
  const csvText = await (await req(`/portal/anlagenplanung/p-n02/export.csv?v=${v2}`)).text();
  const zeile = csvText.split('\r\n').find((x) => x.startsWith('Erlösquelle verwendet;'));
  assert.match(zeile, /RÜCKFALL statt/); assert.match(zeile, /Datenversion dv-/);
  assert.match(csvText, /Rückfall auf WM-Annahmen;nein;"?ja: Keine Simulation mit passender Speicherdauer/);
  const ber = await (await req(`/portal/anlagenplanung/p-n02/bericht?v=${v2}`)).text();
  assert.match(ber, /Erlösquelle: Erlösannahmen der aktuellen STROMKAI-WM-Version des Projekts · RÜCKFALL statt/);
  // Übergabe von B: Quelle in der WM-Version
  assert.equal((await form('/portal/anlagenplanung/p-n02/wm', { v: v2, var: 'B' })).status, 303);
  const db = (await import('../src/lib/store.mjs')).getDb();
  const fm = db.finanzmodelle.filter((x) => x.projectId === 'p-n02').sort((a, b) => b.version - a.version)[0];
  assert.equal(fm.planerRef.erloes.verwendet, 'wm'); assert.equal(fm.planerRef.erloes.rueckfall, true); assert.match(fm.quelle, /RÜCKFALL/);
});
