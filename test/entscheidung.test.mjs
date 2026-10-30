// Entscheidungsübersicht (Folgeauftrag „Fachliche Transparenz und visuelle Entscheidungsgrundlage“): Datenbindung der Darstellungen
// an die Rechenkerne, Kapitalwert-Abgleich (Wasserfall), Sensitivität, Netzkosten, Datenqualität, Versionsstatus und
// Gleichheit der Werte in Ansicht, CSV und Bericht. Erwartungswerte des Abgleichs aus der Rechenabstimmung vom 30.10.2026.
// Aufruf: node --test test/entscheidung.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as IP from '../src/lib/planer/planer.mjs';
import * as AW from '../src/lib/planer/auswertung.mjs';
import * as WM from '../src/lib/finance/wirtschaftlichkeit.mjs';
import * as REF from '../src/lib/finance/referenz.mjs';
import { demoParameter } from '../src/lib/finance/demo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const nah = (a, b, tol = 0.005, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} ≠ ${b}`);
const ERG = JSON.parse(readFileSync(join(ROOT, 'src', 'strommarkt-daten', 'ergebnisse.json'), 'utf8')).ergebnisse;
const V4 = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'wm-v4-qa-params.json'), 'utf8')).params;
// Planungsstand wie QA-Stand V6/V10: Netz 12/12/15, Variante A 10 MW / 20 MWh (Erlöse WM), Variante B 15 MW / 30 MWh (gesperrt)
const G = { ...structuredClone(IP.GRUNDSTUECK_START), bezeichnung: 'QA-Demo-Grundstück R1 (synthetisch)', flaecheM2: 12000, laengeM: 120, breiteM: 100, grenzabstandM: 3, nichtNutzbarM2: null, zufahrtM2: 600, feuerwehrM2: 400, nebenanlagenM2: 300, netzMW: 12, einspeiseMW: 12, bezugMW: 15 };
const STAND = { status: 'gespeichert', grundstueck: G, annahmen: { ...IP.ANNAHMEN_START }, finanzierung: structuredClone(IP.FINANZIERUNG_START), varianten: [] };
const VA = { key: 'A', name: 'Variante A', kosten: {}, systemRef: { systemId: 'sys-ph-2h', version: 1 }, leistungMW: 10, kapazitaetMWh: 20, erloesQuelle: 'wm' };
const BASIS = REF.referenzParameter('p-n01');
const rA = IP.rechneVariante({ stand: STAND, v: VA, katalog: IP.KATALOG_START, angebote: [], basis: BASIS, ergebnisse: ERG });

test('Abgleich V4 → Referenzvariante A reproduziert die Rechenabstimmung ungerundet; Summe der Schritte = Gesamtdifferenz', () => {
  assert.equal(WM.parameterPruefsumme(V4), 'efde375623819213');
  const soll = { konservativ: [-4036048.72, 1062910.09, -525255.42, -271041.30, -3769435.35], basis: [-1123590.85, 1076230.56, -495784.24, -246401.18, -789545.72], optimistisch: [855870.95, 1080641.15, -481870.59, -234081.12, 1220560.39] };
  for (const [sz, [a, g, f, k, e]] of Object.entries(soll)) {
    const ab = AW.kapitalwertAbgleich(V4, rA.params, sz);
    nah(ab.anfang.kapitalwert, a, 0.005, `${sz} Anfang`); nah(ab.ende.kapitalwert, e, 0.005, `${sz} Ende`);
    nah(ab.schritte[0].delta, g, 0.005, `${sz} G`); nah(ab.schritte[1].delta, f, 0.005, `${sz} F`); nah(ab.schritte[2].delta, k, 0.005, `${sz} Kostenbasis`);
    for (const x of ab.schritte.slice(3)) nah(x.delta, 0, 1e-6, `${sz} ${x.key}`);
    nah(ab.schritte.reduce((s, x) => s + x.delta, 0) + ab.rest, ab.gesamt, 1e-6, 'Summe = Gesamt');
    nah(ab.rest, 0, 1e-6, 'kein Rest');
    // Rundungsnachweis: gerundete Einzelschritte können um 1 € von der gerundeten Gesamtdifferenz abweichen
    assert.ok(Math.abs(ab.rundung.summeGerundet - ab.rundung.gesamtGerundet) <= 1);
  }
  // Gleiche Parameter: kein Effekt
  const null0 = AW.kapitalwertAbgleich(rA.params, rA.params);
  assert.ok(null0.schritte.every((x) => x.delta === 0) && null0.rest === 0);
});

test('Sensitivität: jede Zeile ist eine Neuberechnung mit genau einer geänderten Größe', () => {
  const s = AW.sensitivitaet({ stand: STAND, v: VA, katalog: IP.KATALOG_START, angebote: [], basis: BASIS, ergebnisse: ERG, r: rA });
  nah(s.ausgang.kapitalwert, -789545.72);
  const z = Object.fromEntries(s.zeilen.map((x) => [x.key, x]));
  // Verschleiß +50 %: 8 → 12 €/MWh
  nah(z.verschleiss.hoch.kapitalwert, AW.kapitalwertRoh(WM.berechne({ ...rA.params, technik: { ...rA.params.technik, verschleissEURMWh: 12 } }, 'basis')), 1e-6);
  // Batteriepreis +10 %: Position 1 = 24.000 kWh × 132 € → Investition steigt um 288.000 € zuzüglich Bauzeitzinsen und Reserve
  const rb = IP.rechneVariante({ stand: STAND, v: { ...VA, kosten: { 1: { einzelpreis: 132 } } }, katalog: IP.KATALOG_START, angebote: [], basis: BASIS, ergebnisse: ERG });
  assert.equal(rb.pos.find((x) => x.nr === 1).gesamt, 24000 * 132);
  nah(z.batteriepreis.hoch.kapitalwert, AW.kapitalwertRoh(WM.berechne(rb.params, 'basis')), 1e-6);
  // Erlösniveau ±10 % über den Szenariofaktor; Betriebsdauer nur −5 Jahre
  nah(z.erloese.hoch.kapitalwert, AW.kapitalwertRoh(WM.berechne({ ...rA.params, szenarien: { basis: { erloes: 1.1 } } }, 'basis')), 1e-6);
  assert.equal(z.laufzeit.hoch, null); assert.ok(z.laufzeit.tief.kapitalwert < s.ausgang.kapitalwert);
  // Zins wirkt auf den Projekt-Kapitalwert nur über die Bauzeitzinsen (Investition)
  assert.ok(z.zins.hoch.gesamtinvestition > rA.wm?.basis?.kennzahlen?.gesamtinvestition || z.zins.hoch.gesamtinvestition > WM.berechne(rA.params, 'basis').kennzahlen.gesamtinvestition);
  // sortiert nach Spannweite
  for (let i = 1; i < s.zeilen.length; i++) assert.ok(s.zeilen[i - 1].spanne >= s.zeilen[i].spanne);
});

test('Netz- und Messkosten: getrennte Positionen, Status, Wirkung der Einordnung = −246.401,18 € (Variante A, Basis)', () => {
  const nk = AW.netzkosten(rA, BASIS);
  const z = Object.fromEntries(nk.zeilen.map((x) => [x.key, x]));
  assert.equal(z.netzanschlussBetrieb.wert, 40000); assert.equal(z.netzanschlussBetrieb.status, 'pruefung'); assert.equal(z.netzanschlussBetrieb.regel, 'fix je Netzanschluss');
  assert.equal(z.messstelle.wert, 0); assert.match(z.messstelle.text, /nicht nachweislich/);
  assert.equal(z.netzentgeltLeistung.status, 'fehlt'); assert.equal(z.pcsInstandhaltung.wert, 0); assert.match(z.pcsInstandhaltung.text, /keine Doppelzählung/);
  assert.match(z.netzanschlussBetrieb.text, /Keine Netzbetreiberforderung, kein Marktpreis/);
  nah(nk.faktor, 0.5, 1e-12); nah(nk.wirkung.basis, -246401.18); nah(nk.wirkung.konservativ, -271041.30); nah(nk.wirkung.optimistisch, -234081.12);
});

test('Datenqualität: Statuszuordnung; positiver Kapitalwert ist nie automatisch entscheidungsreif', () => {
  const dq = AW.datenqualitaet({ stand: STAND, r: rA, referenz: { referenzbasis: { kennung: 'REF-T', herkunft: [] } } });
  assert.equal(dq.entscheidungsreif, false); assert.ok(dq.zaehler.synthetisch > 0 && dq.zaehler.fehlt > 0 && dq.zaehler.pruefung > 0);
  assert.ok(dq.punkte.some((x) => x.name === 'Fachliche Freigabe des Planungsstands' && x.status === 'fehlt'));
  // hypothetisch positiver Kapitalwert (optimistisch) ändert nichts an der Reife
  assert.ok(rA.params && WM.berechne(rA.params, 'optimistisch').kennzahlen.kapitalwert > 0);
  // fehlende Referenzbasis wird als fehlend ausgewiesen
  assert.ok(AW.datenqualitaet({ stand: STAND, r: rA, referenz: null }).punkte.some((x) => x.name === 'WM-Referenzbasis' && x.status === 'fehlt'));
});

test('Versionsstatus: Demo-Referenz, Variante, historisch, ohne Referenz, Investorenfreigabe prüfungsbedürftig, Hinweise', () => {
  const at = '2026-10-30T09:00:00.000Z';
  const v1p = demoParameter(20, 40, 26400); delete v1p.technik.verschleissEURMWh;
  const v1 = { id: 'fm-p-n01-1', projectId: 'p-n01', version: 1, notiz: 'Demo-Ausgangsmodell', synthetisch: true, params: v1p, ergebnis: { basis: { meta: { modellVersion: 'STROMKAI-WM 1.1' } } } };
  const v4 = { id: 'fm-v4', projectId: 'p-n01', version: 4, params: V4, planerRef: { version: 6, variante: 'A' }, ergebnis: { basis: { meta: { modellVersion: 'STROMKAI-WM 1.1' } } } };
  const db = { finanzmodelle: [v1, v4], finanzFreigaben: [{ modellId: 'fm-p-n01-1', szenario: 'basis', freigegebenAm: '2026-10-29T08:00:00.000Z', synthetisch: true }], wmVersionshinweise: [] };
  const { fm: ref } = REF.neueReferenzbasis(db, { id: 'p-n01', code: 'DEMO-N01', spvId: 's' }, { von: { id: 'u', name: 'Admin' }, at });
  db.finanzmodelle.push(ref);
  const uebergabe = { id: 'fm-v6', projectId: 'p-n01', version: 6, params: rA.params, planerRef: { version: 10, variante: 'A', wmBasis: REF.verweisAuf(ref, { name: 'Admin' }, at, 'Test') }, ergebnis: { basis: { meta: { modellVersion: WM.MODELL_VERSION } } } };
  db.finanzmodelle.push(uebergabe);
  const keys = (fm) => REF.versionStatus(db, fm).map((x) => x.key);
  assert.deepEqual(keys(ref), ['referenz']); assert.match(REF.versionStatus(db, ref)[0].name, /Demo-Referenzbasis – aktuell verwendbar/);
  assert.deepEqual(keys(uebergabe), ['variante']);
  assert.deepEqual(keys(v4), ['ohne_referenz', 'historisch']);
  assert.deepEqual(keys(v1), ['demo', 'historisch', 'investor', 'investor_pruefung']);
  assert.match(REF.versionStatus(db, v1).find((x) => x.key === 'investor_pruefung').text, /Batterieverschleiß ist nicht gesetzt/);
  db.wmVersionshinweise.push({ fmId: 'fm-v4', status: 'pruefreferenz', text: 'Prüfreferenz -017-R1', von: 'Admin', am: at });
  assert.ok(keys(v4).includes('pruefreferenz')); assert.match(REF.versionStatus(db, v4).at(-1).name, /Prüfreferenz – nicht entscheidungsrelevant/);
  // Status sind getrennt: keine Version ist zugleich „aktuell verwendbar“ und „historisch“
  for (const fm of db.finanzmodelle) { const k = keys(fm); assert.ok(!(k.some((x) => ['referenz', 'variante'].includes(x)) && k.includes('historisch')), fm.id); }
});

// ---------- Portal ----------
const DIR = mkdtempSync(join(tmpdir(), 'bess-ed-'));
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
const loc = (r, k = 'v') => new URL(r.headers.get('location'), base).searchParams.get(k);
const plain = (b) => b.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\u00a0|\u202f/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');

test('Portal: Entscheidungsübersicht – Werte gleich in Ansicht, Tabelle, CSV und Bericht; gesperrte Variante; keine Inline-Styles', async () => {
  const db = (await import('../src/lib/store.mjs')).getDb();
  const a = await sitzung('admin@demo.invalid');
  // QA-ähnlich: WM V4-Parameter als ältere Version (nur Testdaten)
  db.finanzmodelle.push({ id: 'fm-test-v4', projectId: 'p-n01', spvId: 'spv-n01', version: 2, status: 'simulation', synthetisch: true, params: V4, ergebnis: Object.fromEntries(Object.keys(WM.SZENARIEN).map((s) => { const r = WM.berechne(V4, s); return [s, { meta: { ...r.meta, modellVersion: 'STROMKAI-WM 1.1' }, kennzahlen: r.kennzahlen }]; })), planerRef: { version: 6, variante: 'A' }, erstelltVon: 'u-admin', erstelltAm: '2026-10-29T21:37:00Z', notiz: 'V4 (Test)' });
  const ref = loc(await a.form('/portal/wirtschaftlichkeit/p-n01/referenzbasis', {}));
  const v1 = loc(await a.form('/portal/anlagenplanung/p-n01/speichern', { schritt: 'grundstueck', 'g.bezeichnung': 'QA-Demo-Grundstück R1 (synthetisch)', 'g.flaecheM2': '12000', 'g.laengeM': '120', 'g.breiteM': '100', 'g.grenzabstandM': '3', 'g.zufahrtM2': '600', 'g.feuerwehrM2': '400', 'g.nebenanlagenM2': '300', 'g.netzMW': '12', 'g.einspeiseMW': '12', 'g.bezugMW': '15', 'a.flaeche.status': 'angenommen', 'a.geometrie.status': 'angenommen', 'a.netz.status': 'angenommen', 'a.abstaende.status': 'angenommen' }));
  const st = loc(await a.form('/portal/anlagenplanung/p-n01/speichern', { 'wm.basis': ref, schritt: 'technik', v: v1, 'v.A.name': 'Variante A', 'v.A.system': 'sys-ph-2h', 'v.A.mw': '10', 'v.A.mwh': '20', 'v.A.erloes': 'wm', 'v.B.name': 'Variante B', 'v.B.system': 'sys-ph-2h', 'v.B.mw': '15', 'v.B.mwh': '30', 'v.B.erloes': 'b2_A', 'a.cosPhi': '0,95', 'a.mvaJeTrafo': '5', 'a.flaecheJeTrafoM2': '40', 'a.zufahrtBreiteM': '5', 'a.reserveAnteil': '5', 'a.opexSkalierung': 'skaliert' }));
  const seite = await a.text(`/portal/anlagenplanung/p-n01?schritt=uebersicht&v=${st}&var=A&vgl=fm-test-v4&sz=basis`);
  assert.doesNotMatch(seite, /style="/, 'keine Inline-Styles (CSP style-src self)');
  const t = plain(seite);
  for (const x of ['Entscheidungsübersicht Variante A', 'Kapitalwert (NPV)', '-789.546 €', 'Keine Investitionsfreigabe', 'Synthetische Demo-Daten', 'Modell-DSCR minimal', 'kein Bank-DSCR', 'Anlagenkonfiguration', 'Woraus besteht die Investition?', 'Wie robust ist das Ergebnis?', 'Zahlungsströme und Finanzierung', 'Netz- und Messkosten', 'Welche Annahmen bewegen das Ergebnis am stärksten?', 'Kapitalwert-Abgleich', 'Datenqualität und Entscheidungsreife', 'Nicht entscheidungsreif', 'Fachprüfung', 'Berechnungsformeln', 'Bekannte Modellgrenzen'])
    assert.ok(t.includes(x), x);
  // Abgleich mit V4: ungerundete Werte in der Tabelle
  for (const x of ['-1.123.590,85 €', '+1.076.230,56 €', '-495.784,24 €', '-246.401,18 €', '-789.545,72 €', '+334.045,14 €', '334.046 / 334.045 (Rundung -1 €)']) assert.ok(t.includes(x), x);
  // Netzkosten-Wirkung
  assert.ok(t.includes('Basis -246.401,18 €'));
  // Gleiche Werte in CSV und Bericht
  const csv = await a.text(`/portal/anlagenplanung/p-n01/export.csv?v=${st}`);
  const kw = csv.split('\r\n').find((x) => x.startsWith('Kapitalwert Basis EUR;')).split(';')[1];
  assert.equal(Number(kw.replace(',', '.')).toFixed(2), '-789545.72');
  assert.match(plain(await a.text(`/portal/anlagenplanung/p-n01/bericht?v=${st}`)), /-789\.546 €/);
  // Kennzeichnung: Wasserfall als hypothetische Rechenabstimmung, DSCR einheitlich als Modell-DSCR vor Steuern
  assert.ok(t.includes('Kapitalwert-Abgleich mit einer WM-Version (hypothetische Rechenabstimmung)') && t.includes('Hypothetische Rechenabstimmung, keine historische Aussage.'));
  assert.ok(t.includes('Modell-DSCR minimal (vor Steuern)'));
  assert.ok(csv.includes('Modell-DSCR min. vor Steuern (Basis);'));
  const ohneModell = /(?<!Modell-)DSCR (minimal|min\b|Durchschnitt)/;
  for (const pfad of [`/portal/anlagenplanung/p-n01?schritt=wirtschaftlichkeit&v=${st}`, `/portal/anlagenplanung/p-n01?schritt=vergleich&v=${st}`, '/portal/wirtschaftlichkeit/p-n01', '/portal/wirtschaftlichkeit/p-n01/export.csv?s=basis']) {
    const b = await a.text(pfad); assert.match(b, /Modell-DSCR/, pfad); assert.doesNotMatch(b, ohneModell, pfad);
  }
  assert.match(await a.text('/portal/wirtschaftlichkeit/p-n01/export.csv?s=basis'), /Modell-DSCR minimal \(vor Steuern\)/);
  const inv = plain(await (await sitzung('investor.a@demo.invalid')).text('/portal/projekte/p-n01'));
  assert.ok(inv.includes('Freigegebene Finanzkennzahlen') && inv.includes('Modell-DSCR minimal (vor Steuern)') && !ohneModell.test(inv), 'Investorenansicht');
  // Gesperrte Variante B: Status, Engpass, keine Kennzahlen
  const tb = plain(await a.text(`/portal/anlagenplanung/p-n01?schritt=uebersicht&v=${st}&var=B`));
  assert.ok(tb.includes('Nicht berechnet (Netzgrenzen)') && tb.includes('Engpass: Netz < PCS – gesperrt'));
  assert.ok(!/Kapitalwert \(NPV\)/.test(tb) && !/Modell-DSCR minimal/.test(tb));
  // Stand ohne Referenzbasis: Grund statt Kennzahlen
  const ohne = loc(await a.form('/portal/anlagenplanung/p-n01/speichern', { schritt: 'technik', v: v1, 'v.A.name': 'Variante A', 'v.A.system': 'sys-ph-2h', 'v.A.mw': '10', 'v.A.mwh': '20', 'v.A.erloes': 'wm', 'a.cosPhi': '0,95', 'a.mvaJeTrafo': '5', 'a.flaecheJeTrafoM2': '40', 'a.zufahrtBreiteM': '5', 'a.reserveAnteil': '5', 'a.opexSkalierung': 'skaliert' }));
  assert.match(plain(await a.text(`/portal/anlagenplanung/p-n01?schritt=uebersicht&v=${ohne}&var=A`)), /Keine WM-Referenzbasis zugeordnet/);
});

test('Portal: Versionsstatus in der WM-Akte; Versionshinweis nur Administration, nur anhängend', async () => {
  const db = (await import('../src/lib/store.mjs')).getDb();
  const a = await sitzung('admin@demo.invalid');
  const akte = plain(await a.text('/portal/wirtschaftlichkeit/p-n01?v=fm-p-n01-1'));
  assert.ok(akte.includes('Demo-Ausgangsmodell') && akte.includes('Für Investoren freigegeben'));
  const vorher = JSON.stringify(db.finanzmodelle.find((x) => x.id === 'fm-test-v4'));
  const pl = await sitzung('projektleitung@demo.invalid');
  assert.equal((await pl.form('/portal/wirtschaftlichkeit/p-n01/versionshinweis', { v: 'fm-test-v4', status: 'pruefreferenz', text: 'x' })).status, 404);
  assert.equal((await a.form('/portal/wirtschaftlichkeit/p-n01/versionshinweis', { v: 'fm-test-v4', status: 'pruefreferenz', text: '' })).status, 422);
  const r = await a.form('/portal/wirtschaftlichkeit/p-n01/versionshinweis', { v: 'fm-test-v4', status: 'pruefreferenz', text: 'Prüfreferenz -017-R1 (Test)', quelle: 'Kennzeichnung 30.10.2026' });
  assert.equal(r.status, 303);
  assert.equal(JSON.stringify(db.finanzmodelle.find((x) => x.id === 'fm-test-v4')), vorher, 'WM-Version unverändert');
  assert.equal(db.wmVersionshinweise.length, 1);
  const t = plain(await a.text('/portal/wirtschaftlichkeit/p-n01?v=fm-test-v4'));
  assert.ok(t.includes('Prüfreferenz – nicht entscheidungsrelevant') && t.includes('Ohne feste Referenzbasis') && t.includes('Historisch'));
});
