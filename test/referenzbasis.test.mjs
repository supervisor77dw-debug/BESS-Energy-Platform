// Folgeauftrag -017-R1 „Neue Referenzbasis und Berechnungsketten“: WM-Referenzbasis mit Verschleiß und Kostenbasis nach Ursache,
// feste Referenz statt neuester WM-Version (Befund G), Versionskennungen, Reproduzierbarkeit über Prüfsummen und Negativtests.
// Erwartungswerte aus dem Demo-Modell von Hand nachgerechnet (siehe Kommentare).
// Aufruf: node --test test/referenzbasis.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as IP from '../src/lib/planer/planer.mjs';
import * as WM from '../src/lib/finance/wirtschaftlichkeit.mjs';
import * as REF from '../src/lib/finance/referenz.mjs';
import { demoParameter } from '../src/lib/finance/demo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const nah = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg} ${a} ≠ ${b}`);
const ERG = JSON.parse(readFileSync(join(ROOT, 'src', 'strommarkt-daten', 'ergebnisse.json'), 'utf8')).ergebnisse;
const G = { ...structuredClone(IP.GRUNDSTUECK_START), flaecheM2: 12000, laengeM: 120, breiteM: 100, grenzabstandM: 3, zufahrtM2: 600, feuerwehrM2: 400, nebenanlagenM2: 300, netzMW: 12, einspeiseMW: 12, bezugMW: 15 };
const stand = (g = G) => ({ grundstueck: g, annahmen: { ...IP.ANNAHMEN_START }, finanzierung: IP.FINANZIERUNG_START, varianten: [] });
const v = (mw, mwh, erl = 'wm', sys = 'sys-ph-2h') => ({ key: 'A', name: 'A', kosten: {}, systemRef: { systemId: sys, version: 1 }, leistungMW: mw, kapazitaetMWh: mwh, erloesQuelle: erl });
const rv = (basis, vv, g = G, extra = {}) => IP.rechneVariante({ stand: stand(g), v: vv, katalog: IP.KATALOG_START, angebote: [], basis, ergebnisse: ERG, ...extra });

test('Versionen: Planer IP 1.1, Wirtschaftlichkeitsmodell WM 1.2', () => {
  assert.equal(IP.PLANER_VERSION, 'STROMKAI-IP 1.1'); assert.equal(WM.MODELL_VERSION, 'STROMKAI-WM 1.2');
});

test('Referenzparameter: aktuelles Demo-Modell, Verschleiß gesetzt, Netz/Mess nach Ursache umgegliedert, Summe unverändert', () => {
  const p = REF.referenzParameter('p-n01'), d = demoParameter(20, 40, 26400);
  assert.equal(p.technik.verschleissEURMWh, 8, 'Verschleiß 8 EUR/MWh ausdrücklich');
  assert.deepEqual(p.technik, d.technik); assert.deepEqual(p.capex, d.capex); assert.deepEqual(p.einnahmen, d.einnahmen); assert.deepEqual(p.finanzierung, d.finanzierung);
  // 2.000 EUR/MW × 20 MW = 40.000 EUR als Festbetrag Netzanschluss; pauschale Position 0; PCS, Messstelle, Leistungspreis 0 (enthalten bzw. befreit)
  assert.equal(p.opex.netzMess, 0); assert.equal(p.opex.netzanschlussBetrieb, 40000); assert.equal(p.opex.pcsInstandhaltung, 0); assert.equal(p.opex.messstelle, 0); assert.equal(p.opex.netzentgeltLeistung, 0);
  const summe = (o) => WM.OPEX_POSTEN.reduce((a, [k]) => a + (o[k] || 0), 0);
  assert.equal(summe(p.opex), summe(d.opex), 'Umgliederung ohne Betragsänderung');
  // Beim Demo-Projekt (20 MW) rechnet die Referenzbasis daher wie das Demo-Modell (Unterschied nur in der Summationsreihenfolge, < 1e-12)
  const kp = WM.berechne(p, 'basis').kennzahlen, kd = WM.berechne(d, 'basis').kennzahlen;
  for (const k of Object.keys(kd)) if (kd[k] != null) nah(kp[k], kd[k], 1e-12, k);
  assert.equal(REF.referenzParameter('p-unbekannt'), null);
});

test('Kostenbasis: keine Doppelzählung, fehlender Verschleiß und pauschale Netzkosten werden abgewiesen', () => {
  const p = REF.referenzParameter('p-n01');
  assert.ok(!REF.kostenbasisPruefung(p).some((x) => x.art === 'bad'));
  const ohne = structuredClone(p); delete ohne.technik.verschleissEURMWh;
  assert.ok(REF.kostenbasisPruefung(ohne).some((x) => x.art === 'bad' && /verschleiß/i.test(x.text)));
  const doppelt = structuredClone(p); doppelt.opex.netzMess = 40000;
  assert.ok(REF.kostenbasisPruefung(doppelt).some((x) => x.art === 'bad' && /Doppelzählung/.test(x.text)));
  const alt = demoParameter(20, 40, 26400);
  assert.ok(REF.kostenbasisPruefung(alt).some((x) => x.art === 'bad' && /ohne Kostenursache/.test(x.text)));
  // Herkunft: jeder Einzelwert hat eine dokumentierte Herkunft
  const h = REF.herkunft(p);
  assert.ok(h.length > 40); assert.ok(h.every((x) => x.herkunft && x.status === 'synthetisch'));
  assert.match(h.find((x) => x.feld === 'technik.verschleissEURMWh').herkunft, /synthetische Demo-Annahme/);
});

test('Betriebskosten nach Kostenursache: Netzanschluss fix, PCS je MW, Leistungspreis je MW Bezug, keine pauschale PCS-Skalierung', () => {
  const p = REF.referenzParameter('p-n01');
  const ausreichend = { ...G, netzMW: 20, einspeiseMW: 20, bezugMW: 20 };
  const a10 = rv(p, v(10, 20), ausreichend), a15 = rv(p, v(15, 30), ausreichend);
  assert.equal(a10.params.opex.netzanschlussBetrieb, 40000); assert.equal(a15.params.opex.netzanschlussBetrieb, 40000, 'nicht mit PCS skaliert');
  // Wartung kapazitätsbezogen: 160.000 × 22,8 / 36 (6 Blöcke × 3,8 MWh; Demo 40 MWh × 90 %)
  nah(a10.params.opex.wartung, 160000 * 22.8 / 36);
  const mit = structuredClone(p); mit.opex.pcsInstandhaltung = 20000; mit.opex.netzentgeltLeistung = 10000;
  const b = rv(mit, v(15, 30), { ...G, netzMW: 20, einspeiseMW: 20, bezugMW: 16 });
  nah(b.params.opex.pcsInstandhaltung, 20000 * 15 / 20, 1e-12, 'PCS 15 MW / Demo 20 MW');
  nah(b.params.opex.netzentgeltLeistung, 10000 * 15 / 20, 1e-12, 'Bezug min(PCS 15, Netz 16) = 15 MW / Demo 20 MW');
  // Altposition „Netz- und Messkosten“ (bis WM 1.1) wird nicht mehr mit der PCS-Leistung skaliert
  const legacy = rv(demoParameter(20, 40, 26400), v(10, 20), ausreichend);
  assert.equal(legacy.params.opex.netzMess, 40000);
});

test('Referenzprüfung: fehlend, unbekannt, nicht freigegeben, verändert, veraltet → verständliche Sperre', () => {
  const at = '2026-10-30T09:00:00.000Z';
  const db = { finanzmodelle: [] };
  const p = { id: 'p-n01', code: 'DEMO-N01', spvId: 'spv-n01' };
  db.finanzmodelle.push({ id: 'fm-p-n01-1', projectId: 'p-n01', version: 1, params: demoParameter(20, 40, 26400) });
  const { fm } = REF.neueReferenzbasis(db, p, { von: { id: 'u-admin', name: 'Admin' }, at });
  db.finanzmodelle.push(fm);
  assert.equal(fm.version, 2); assert.equal(fm.referenzbasis.kennung, 'REF-DEMO-N01-1'); assert.equal(fm.referenzbasis.modellVersion, WM.MODELL_VERSION);
  assert.equal(fm.referenzbasis.pruefsumme, WM.parameterPruefsumme(fm.params)); assert.equal(fm.ergebnis.basis.meta.parameterPruefsumme, fm.referenzbasis.pruefsumme);
  // Reproduzierbarkeit: gespeicherte Kennzahlen = Neuberechnung aus den gespeicherten Parametern, alle drei Szenarien
  for (const sz of Object.keys(WM.SZENARIEN)) assert.deepEqual(WM.berechne(fm.params, sz).kennzahlen, fm.ergebnis[sz].kennzahlen, sz);
  const verweis = REF.verweisAuf(fm, { name: 'Admin' }, at, 'Test');
  assert.equal(REF.referenzPruefung(db, 'p-n01', verweis).fm, fm);
  assert.match(REF.referenzPruefung(db, 'p-n01', null).fehler, /Keine WM-Referenzbasis zugeordnet/);
  assert.match(REF.referenzPruefung(db, 'p-n01', { ...verweis, fmId: 'fm-x' }).fehler, /nicht vorhanden/);
  assert.match(REF.referenzPruefung(db, 'p-n02', verweis).fehler, /nicht vorhanden/, 'fremdes Projekt');
  assert.match(REF.referenzPruefung(db, 'p-n01', { ...verweis, fmId: 'fm-p-n01-1' }).fehler, /keine freigegebene Referenzbasis/, 'Demo-V1 ist keine Basis');
  assert.match(REF.referenzPruefung(db, 'p-n01', { ...verweis, pruefsumme: '0000000000000000' }).fehler, /Prüfsumme/);
  assert.match(REF.referenzPruefung(db, 'p-n01', { ...verweis, modellVersion: 'STROMKAI-WM 1.1' }).fehler, /gehört zu STROMKAI-WM 1\.2|gerechnet wird mit/);
  const veraendert = structuredClone(fm); veraendert.params.technik.verschleissEURMWh = 0;
  assert.match(REF.referenzPruefung({ finanzmodelle: [veraendert] }, 'p-n01', verweis).fehler, /Prüfsumme/, 'nachträglich veränderte Parameter');
  const alt = structuredClone(fm); alt.referenzbasis.modellVersion = 'STROMKAI-WM 1.1';
  assert.match(REF.referenzPruefung({ finanzmodelle: [alt] }, 'p-n01', verweis).fehler, /gehört zu STROMKAI-WM 1\.1/, 'veraltete Modellversion');
  assert.deepEqual(REF.auswahlbar({ finanzmodelle: [alt, db.finanzmodelle[0]] }, 'p-n01'), [], 'weder veraltete Basis noch normale Version auswählbar');
  // Planer: mit Sperrgrund keine WM-Parameter, keine Erlösquelle, keine Übergabe
  const r = rv(fm.params, v(10, 20, 'b2_A'), G, { basisFehler: 'Keine WM-Referenzbasis zugeordnet.' });
  assert.equal(r.belastbarkeit, 'referenz'); assert.equal(r.params, null); assert.equal(r.erloes.verwendet, null); assert.equal(r.erloes.gesperrt, 'referenz'); assert.equal(r.referenz, null);
  assert.equal(IP.wmUebergabeErlaubt(r), false); assert.ok(r.sperren.includes(IP.BELASTBARKEIT.referenz)); assert.ok(r.hinweise.includes('Keine WM-Referenzbasis zugeordnet.'));
});

test('Prüfsumme Planungsstand: ab IP 1.1 mit Referenzbasis; Stände ohne Verweis behalten ihre bisherige Prüfsumme', () => {
  const s0 = { grundstueck: G, annahmen: IP.ANNAHMEN_START, varianten: [], finanzierung: IP.FINANZIERUNG_START };
  const alt = IP.pruefsumme(s0);
  assert.equal(IP.pruefsumme({ ...s0, wmBasis: null }), alt);
  const b = { fmId: 'fm-ref-p-n01-5', pruefsumme: 'abc', modellVersion: WM.MODELL_VERSION, uebernommenAm: '2026-10-30T09:00:00Z' };
  const mit = IP.pruefsumme({ ...s0, wmBasis: b });
  assert.notEqual(mit, alt); assert.equal(IP.pruefsumme({ ...s0, wmBasis: { ...b, uebernommenAm: 'später' } }), mit, 'Zeitpunkt der Übernahme ändert keine Rechengröße');
  assert.notEqual(IP.pruefsumme({ ...s0, wmBasis: { ...b, pruefsumme: 'xyz' } }), mit);
});

// ---------- Portal ----------
const DIR = mkdtempSync(join(tmpdir(), 'bess-ref-'));
let server, base;
before(async () => {
  process.env.BESS_DATA_DIR = DIR; process.env.BESS_PREVIEW_HELPERS = '0'; delete process.env.BESS_MFA;
  execFileSync(process.execPath, [join(ROOT, 'data', 'seed.mjs'), DIR]);
  const store = await import('../src/lib/store.mjs'); await store.openStore(DIR);
  const { createApp } = await import('../server.mjs'); server = createApp();
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); rmSync(DIR, { recursive: true, force: true }); });
async function sitzung(email) {
  let cookie = '';
  const req = async (p, o = {}) => { const r = await fetch(base + p, { redirect: 'manual', ...o, headers: { ...(o.headers || {}), cookie } }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return r; };
  const lb = await (await req('/portal/login')).text();
  await req('/portal/anmelden', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _t: /name="_t" value="([^"]+)"/.exec(lb)[1], email, password: 'Vorschau!Speicher-2026' }).toString() });
  const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await req('/portal/wirtschaftlichkeit')).text())?.[1];
  const form = (p, f) => req(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, ...f }).toString() });
  return { req, form, text: async (p) => (await req(p)).text() };
}
const loc = (r) => new URL(r.headers.get('location'), base).searchParams.get('v');
const GRUND = { schritt: 'grundstueck', 'g.bezeichnung': 'Referenz-QA (synthetisch)', 'g.flaecheM2': '12000', 'g.laengeM': '120', 'g.breiteM': '100', 'g.grenzabstandM': '3', 'g.zufahrtM2': '600', 'g.feuerwehrM2': '400', 'g.nebenanlagenM2': '300', 'g.netzMW': '12', 'g.einspeiseMW': '12', 'g.bezugMW': '15', 'a.flaeche.status': 'angenommen', 'a.geometrie.status': 'angenommen', 'a.abstaende.status': 'angenommen', 'a.netz.status': 'angenommen' };
const TECH = { schritt: 'technik', 'v.A.name': 'Variante A', 'v.A.system': 'sys-ph-2h', 'v.A.mw': '10', 'v.A.mwh': '20', 'v.A.erloes': 'wm', 'v.B.name': 'Variante B', 'v.B.system': 'sys-ph-2h', 'v.B.mw': '15', 'v.B.mwh': '30', 'v.B.erloes': 'b2_A', 'v.C.name': 'Variante C', 'v.C.system': 'sys-ph-4h', 'v.C.mw': '10', 'v.C.mwh': '40', 'v.C.erloes': 'b2_B',
  'a.cosPhi': '0,95', 'a.mvaJeTrafo': '5', 'a.flaecheJeTrafoM2': '40', 'a.zufahrtBreiteM': '5', 'a.reserveAnteil': '5', 'a.opexSkalierung': 'skaliert' };

test('Portal: Referenzbasis anlegen (nur Administration), bestehende Versionen unverändert, Anzeige mit Herkunft', async () => {
  const db = (await import('../src/lib/store.mjs')).getDb();
  const vorher = JSON.stringify(db.finanzmodelle);
  const pl = await sitzung('projektleitung@demo.invalid');
  assert.equal((await pl.form('/portal/wirtschaftlichkeit/p-n01/referenzbasis', {})).status, 404, 'Projektleitung legt keine Referenzbasis an');
  const a = await sitzung('admin@demo.invalid');
  const r = await a.form('/portal/wirtschaftlichkeit/p-n01/referenzbasis', {}); assert.equal(r.status, 303);
  const fm = db.finanzmodelle.find((x) => x.id === loc(r));
  assert.equal(fm.referenzbasis.kennung, 'REF-DEMO-N01-1'); assert.equal(fm.referenzbasis.status, 'freigegeben'); assert.equal(fm.params.technik.verschleissEURMWh, 8);
  assert.equal(JSON.stringify(db.finanzmodelle.filter((x) => x.id !== fm.id)), vorher, 'keine bestehende WM-Version verändert');
  assert.ok(!db.finanzFreigaben.some((x) => x.modellId === fm.id), 'keine Investorenfreigabe');
  const akte = await a.text(`/portal/wirtschaftlichkeit/p-n01?v=${fm.id}`);
  for (const t of ['Referenzbasis REF-DEMO-N01-1', fm.referenzbasis.pruefsumme, 'STROMKAI-WM 1.2', 'technik.verschleissEURMWh', 'Netzanschluss: Betrieb und Instandhaltung Übergabestation', 'nicht skaliert']) assert.ok(akte.includes(t), t);
  // Ältere Version: Anzeige nennt die gespeicherte Modellversion
  assert.match(await a.text('/portal/wirtschaftlichkeit/p-n02'), /Modell STROMKAI-WM 1\.2/);
});

test('Portal: Planungsstand rechnet nur mit zugeordneter Referenzbasis; neuere WM-Versionen werden nicht übernommen', async () => {
  const db = (await import('../src/lib/store.mjs')).getDb();
  const a = await sitzung('admin@demo.invalid');
  const ref = REF.auswahlbar(db, 'p-n01')[0];
  let r = await a.form('/portal/anlagenplanung/p-n01/speichern', GRUND); const v1 = loc(r);
  // ohne Auswahl: gespeichert, aber Wirtschaftlichkeit gesperrt und Übergabe abgewiesen
  r = await a.form('/portal/anlagenplanung/p-n01/speichern', { ...TECH, v: v1 }); const ohne = loc(r);
  const wo = await a.text(`/portal/anlagenplanung/p-n01?schritt=wirtschaftlichkeit&v=${ohne}&var=A`);
  assert.match(wo, /Keine WM-Referenzbasis zugeordnet/); assert.doesNotMatch(wo.split('<h2>Varianten</h2>')[0].split('ip-ebenen')[1] || '', /Kapitalwert/);
  const anzahl = () => db.finanzmodelle.filter((x) => x.projectId === 'p-n01').length;
  const n0 = anzahl();
  const rw = await a.form('/portal/anlagenplanung/p-n01/wm', { v: ohne, var: 'A' });
  assert.equal(rw.status, 422); assert.match(await rw.text(), /Referenzbasis fehlt oder ungültig/); assert.equal(anzahl(), n0);
  // Negativ: nicht freigegebene WM-Version (Demo V1) als Basis → 422, kein neuer Stand
  const nStaende = db.planerStaende.length;
  r = await a.form('/portal/anlagenplanung/p-n01/speichern', { ...TECH, v: v1, 'wm.basis': 'fm-p-n01-1' });
  assert.equal(r.status, 422); assert.match(await r.text(), /keine freigegebene Referenzbasis/); assert.equal(db.planerStaende.length, nStaende);
  // mit Referenzbasis
  r = await a.form('/portal/anlagenplanung/p-n01/speichern', { ...TECH, v: v1, 'wm.basis': ref.id }); const mit = loc(r);
  const st = db.planerStaende.find((x) => x.id === mit);
  assert.deepEqual({ fmId: st.wmBasis.fmId, version: st.wmBasis.version, kennung: st.wmBasis.kennung, pruefsumme: st.wmBasis.pruefsumme, modellVersion: st.wmBasis.modellVersion }, { fmId: ref.id, version: ref.version, kennung: ref.referenzbasis.kennung, pruefsumme: ref.referenzbasis.pruefsumme, modellVersion: WM.MODELL_VERSION });
  assert.equal(st.wmBasis.erloes.quelle, ref.referenzbasis.erloes.quelle); assert.ok(st.wmBasis.uebernommenAm && st.wmBasis.uebernommenVon && st.wmBasis.herkunft);
  assert.equal(st.planerVersion, 'STROMKAI-IP 1.1'); assert.equal(st.pruefsumme, IP.pruefsumme(st));
  // Übergabe A: neue WM-Version mit vollständigem Bezug; danach rechnet der Stand weiter gegen die Referenzbasis, nicht gegen die Übergabe
  r = await a.form('/portal/anlagenplanung/p-n01/wm', { v: mit, var: 'A' }); assert.equal(r.status, 303);
  const ueb = db.finanzmodelle.filter((x) => x.projectId === 'p-n01').sort((x, y) => y.version - x.version)[0];
  assert.equal(ueb.planerRef.wmBasis.fmId, ref.id); assert.equal(ueb.planerRef.modellVersion, WM.MODELL_VERSION); assert.equal(ueb.referenzbasis, undefined);
  const csv1 = await a.text(`/portal/anlagenplanung/p-n01/export.csv?v=${mit}`);
  // eine weitere, neuere WM-Version (Neuberechnung in der Akte) ändert nichts an der Rechnung des Stands
  db.finanzmodelle.push({ ...structuredClone(ueb), id: 'fm-test-neuer', version: ueb.version + 1, params: { ...structuredClone(ueb.params), einnahmen: [] }, planerRef: undefined, notiz: 'neuere Version (Test)' });
  assert.equal(await a.text(`/portal/anlagenplanung/p-n01/export.csv?v=${mit}`), csv1, 'neueste WM-Version wird nicht implizit übernommen');
  assert.ok(!REF.auswahlbar(db, 'p-n01').some((x) => x.id === 'fm-test-neuer' || x.id === ueb.id), 'Übergaben und Neuberechnungen sind nicht auswählbar');
  // Altstand (IP 1.0, ohne Verweis) wird nicht stillschweigend mit IP 1.1 gerechnet
  db.planerStaende.push({ ...structuredClone(st), id: 'ip-alt-test', version: 99, planerVersion: 'STROMKAI-IP 1.0', wmBasis: undefined });
  const wa = await a.text('/portal/anlagenplanung/p-n01?schritt=wirtschaftlichkeit&v=ip-alt-test&var=A');
  assert.match(wa, /mit STROMKAI-IP 1\.0 gespeichert, aktuell gilt STROMKAI-IP 1\.1/);
  assert.equal((await a.form('/portal/anlagenplanung/p-n01/wm', { v: 'ip-alt-test', var: 'A' })).status, 422);
  // veraltete Referenzbasis (Modellversion) im Verweis → Sperre
  db.planerStaende.push({ ...structuredClone(st), id: 'ip-veraltet-test', version: 98, wmBasis: { ...st.wmBasis, modellVersion: 'STROMKAI-WM 1.1' } });
  assert.match(await a.text('/portal/anlagenplanung/p-n01?schritt=wirtschaftlichkeit&v=ip-veraltet-test&var=A'), /gerechnet wird mit STROMKAI-WM 1\.2/);
  assert.equal((await a.form('/portal/anlagenplanung/p-n01/wm', { v: 'ip-veraltet-test', var: 'A' })).status, 422);
  // Netzsperre bleibt: Variante B (15 MW PCS, 12 MW Einspeisung) auch mit Referenzbasis gesperrt
  const rb = await a.form('/portal/anlagenplanung/p-n01/wm', { v: mit, var: 'B' });
  assert.equal(rb.status, 422); assert.match(await rb.text(), /Nicht berechnet \(Netzgrenzen\)/);
});
