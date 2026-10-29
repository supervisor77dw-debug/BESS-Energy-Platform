// Portal: Projektwirtschaftlichkeit, Vergütung, Vertragsversionierung, Zahlungen, Handelsdaten und finanzielle Mandantentrennung.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = mkdtempSync(join(tmpdir(), 'bess-fin-'));
process.env.BESS_DATA_DIR = DIR;
process.env.BESS_PREVIEW_HELPERS = '0';
delete process.env.BESS_MFA;
const PW = 'Vorschau!Speicher-2026';
let server, base, db;
let admin, pl, markus, invA, invB, ownA, ownB;
before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'data', 'seed.mjs'), DIR]);
  const store = await import('../src/lib/store.mjs');
  await store.openStore(DIR);
  db = store.getDb();
  const { createApp } = await import('../server.mjs');
  server = createApp();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await new C().login('admin@demo.invalid'); pl = await new C().login('projektleitung@demo.invalid'); markus = await new C().login('markus@demo.invalid');
  invA = await new C().login('investor.a@demo.invalid'); invB = await new C().login('investor.b@demo.invalid');
  ownA = await new C().login('eigentuemer.a@demo.invalid'); ownB = await new C().login('eigentuemer.b@demo.invalid');
});
after(() => { server?.close(); rmSync(DIR, { recursive: true, force: true }); });

class C {
  constructor() { this.cookie = ''; }
  async req(path, opts = {}) { const r = await fetch(base + path, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(this.cookie ? { cookie: this.cookie } : {}) } }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; return r; }
  async text(p) { const r = await this.req(p); return { r, body: await r.text() }; }
  form(p, f) { const q = new URLSearchParams(); for (const [k, v] of Object.entries(f)) for (const x of [].concat(v)) q.append(k, x); return this.req(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: q.toString() }); }
  async login(email) { const { body } = await this.text('/portal/login'); await this.form('/portal/anmelden', { _t: /name="_t" value="([^"]+)"/.exec(body)[1], email, password: PW }); return this; }
  async csrf(p = '/portal') { const { body } = await this.text(p); return /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; }
}
const st = async (c, p) => (await c.req(p)).status;

test('Demo-Daten: drei Projektgesellschaften mit unterschiedlichen Modellen und separater variabler Vergütung, alles synthetisch', () => {
  const typen = Object.fromEntries(['k-1', 'k-2', 'k-3', 'k-1v'].map((v) => [v, db.vertragsstaende.filter((x) => x.vertragId === v).at(-1)?.typ]));
  assert.deepEqual(typen, { 'k-1': 'festpacht', 'k-2': 'kaufoption', 'k-3': 'pacht_spaeterer_kauf', 'k-1v': 'variabel' });
  assert.equal(db.finanzmodelle.length, 3);
  assert.ok(db.zahlungen.length && db.zahlungen.every((z) => z.synthetisch), 'keine Demo-Zahlung als real');
  assert.ok(db.vertragsstaende.some((x) => x.vertragId === 'k-3' && x.stufe === 'nachtrag' && x.version === 2));
});

test('Administration: Projektakte mit Szenarien, Metadaten und CSV-Export', async () => {
  const { r, body } = await admin.text('/portal/wirtschaftlichkeit/p-n01');
  assert.equal(r.status, 200);
  for (const t of ['Konservativ', 'Basis', 'Optimistisch', 'Projekt-IRR', 'Eigenkapital-IRR', 'DSCR minimal', 'Kapitalwert', 'STROMKAI-WM 1.1', 'synthetisch', 'Prüfsumme']) assert.match(body, new RegExp(t));
  const csv = await admin.req('/portal/wirtschaftlichkeit/p-n01/export.csv?s=konservativ');
  assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/);
  const t = await csv.text(); assert.match(t, /Szenario;Konservativ/); assert.match(t, /Modellversion;STROMKAI-WM 1.1/);
});

test('Neu berechnen erzeugt eine neue Version; ungültige Eingaben (Doppelzählung) werden abgewiesen', async () => {
  const csrf = await admin.csrf('/portal/wirtschaftlichkeit/p-n01');
  const ok = await admin.form('/portal/wirtschaftlichkeit/p-n01/berechnen', { _csrf: csrf, 'technik.zyklenJahr': '300', quelle: 'Testannahme', notiz: 'weniger Zyklen' });
  assert.equal(ok.status, 303);
  const vs = db.finanzmodelle.filter((x) => x.projectId === 'p-n01');
  assert.equal(vs.length, 2); assert.equal(vs[1].params.technik.zyklenJahr, 300); assert.equal(vs[0].params.technik.zyklenJahr, 365, 'Version 1 unverändert');
  const bad = await admin.form('/portal/wirtschaftlichkeit/p-n01/berechnen', { _csrf: csrf, 'einnahmen.dayahead.anteil': '80' });
  assert.equal(bad.status, 422); assert.match(await bad.text(), /doppelt/);
  assert.equal(db.finanzmodelle.filter((x) => x.projectId === 'p-n01').length, 2);
  const txt = await admin.form('/portal/wirtschaftlichkeit/p-n01/berechnen', { _csrf: csrf, 'technik.leistungMW': 'viel' });
  assert.equal(txt.status, 422);
  assert.equal((await admin.form('/portal/wirtschaftlichkeit/p-n01/berechnen', { 'technik.zyklenJahr': '1' })).status, 403, 'ohne CSRF');
});

test('Projektleitung: Wirtschaftlichkeit nur für zugeordnete Projekte, keine Investorenfreigabe', async () => {
  assert.equal(await st(pl, '/portal/wirtschaftlichkeit/p-n02'), 200);
  assert.equal(await st(pl, '/portal/wirtschaftlichkeit/p-s01'), 404);
  const csrf = await pl.csrf('/portal/wirtschaftlichkeit/p-n02');
  assert.equal((await pl.form('/portal/wirtschaftlichkeit/p-n02/freigeben', { _csrf: csrf, v: 'fm-p-n02-1', s: 'basis' })).status, 404);
});

test('Markus: Vergütungsrechner und Angebote, aber keine Projektkalkulation, keine Verträge, keine Zahlungen', async () => {
  const { r, body } = await markus.text('/portal/wirtschaftlichkeit');
  assert.equal(r.status, 200); assert.match(body, /DEMO-N01/); assert.doesNotMatch(body, /DEMO-S01/); assert.doesNotMatch(body, /href="\/portal\/wirtschaftlichkeit\/p-/, 'kein Link zur Projektakte');
  for (const p of ['/portal/wirtschaftlichkeit/p-n01', '/portal/wirtschaftlichkeit/p-n01/export.csv', '/portal/verguetung/p-s01', '/portal/admin/handelsdaten']) assert.equal(await st(markus, p), 404, p);
  const v = await markus.text('/portal/verguetung/p-n01?flaecheHa=1,5&pachtJeHa=25000&mindestpacht=30000&referenzwert=6&faktor=2&praemie=3&mindestpreis=12&hoechstpreis=20');
  assert.equal(v.r.status, 200);
  assert.match(v.body, /37\.500,00/, 'Jahrespacht wie Excel'); assert.match(v.body, /225\.000,00/, 'Kaufpreis wie Excel');
  assert.doesNotMatch(v.body, /Gesamtinvestition|Schuldendienst|Eigenkapital|Handelsumsätze|Day-Ahead|Regelreserve/, "keine Vollfinanzdaten, keine Handelsstrategie");
  const before = JSON.stringify(db.vertragsstaende);
  const ownerBefore = (await ownA.text('/portal/verguetung')).body.replace(/name="_csrf" value="[^"]+"/, '');
  const csrf = await markus.csrf('/portal/verguetung/p-n01');
  const sim = await markus.form('/portal/verguetung/p-n01/simulation', { _csrf: csrf, ownerContactId: 'c-own-a', stufe: 'vorschlag', typ: 'festpacht', flaecheHa: '1,5', pachtJeHa: '99.000', mindestpacht: '30000' });
  assert.equal(sim.status, 303);
  assert.equal(JSON.stringify(db.vertragsstaende), before, 'Vorschlag ändert keinen Vertrag');
  const ownerAfter = (await ownA.text('/portal/verguetung')).body.replace(/name="_csrf" value="[^"]+"/, '');
  assert.equal(ownerAfter, ownerBefore, 'Eigentümeransicht unverändert');
  const a = db.verguetungsangebote.filter((x) => x.vertragId === 'k-1').at(-1);
  assert.equal(a.stufe, 'vorschlag'); assert.equal(a.bedingungen.pacht.pachtJeHa, 99000);
  assert.equal((await markus.form('/portal/verguetung/p-n01/verbindlich', { _csrf: csrf, angebotId: a.id, stufe: 'eckdaten' })).status, 404);
  assert.equal((await markus.form('/portal/verguetung/p-n01/zahlung', { _csrf: csrf, vertragId: 'k-1', anspruchKey: 'option-2', betrag: '1' })).status, 404);
});

test('Verbindlicher Stand nur durch Projektleitung/Administration; unterzeichnet braucht Dokument; neue Version, alte bleibt', async () => {
  const a = db.verguetungsangebote.filter((x) => x.vertragId === 'k-2').at(-1) || null;
  const csrf = await pl.csrf('/portal/verguetung/p-n02');
  const sim = await pl.form('/portal/verguetung/p-n02/simulation', { _csrf: csrf, ownerContactId: 'c-own-b', stufe: 'vorschlag', typ: 'kaufoption', flaecheHa: '1', referenzwert: '6' });
  assert.equal(sim.status, 303);
  const ang = db.verguetungsangebote.filter((x) => x.projectId === 'p-n02').at(-1);
  assert.ok(ang && ang !== a);
  const ohneDok = await pl.form('/portal/verguetung/p-n02/verbindlich', { _csrf: csrf, angebotId: ang.id, stufe: 'unterzeichnet' });
  assert.equal(ohneDok.status, 400);
  const v1 = db.vertragsstaende.filter((x) => x.vertragId === ang.vertragId).length;
  const ok = await pl.form('/portal/verguetung/p-n02/verbindlich', { _csrf: csrf, angebotId: ang.id, stufe: 'unterzeichnet', dokumentRef: 'd-n02-own-b-vertrag', freigabe: 'ja' });
  assert.equal(ok.status, 303);
  const staende = db.vertragsstaende.filter((x) => x.vertragId === ang.vertragId);
  assert.equal(staende.length, v1 + 1); assert.equal(staende.at(-1).stufe, 'unterzeichnet'); assert.equal(staende.at(-1).dokumentRef, 'd-n02-own-b-vertrag');
  assert.equal(staende[0].stufe, 'eckdaten', 'frühere Version unverändert');
});

test('Zahlungen nur durch Administration und in der Vorschau stets als Demo-Buchung', async () => {
  const csrf = await admin.csrf('/portal/verguetung/p-n01');
  const r = await admin.form('/portal/verguetung/p-n01/zahlung', { _csrf: csrf, vertragId: 'k-1', anspruchKey: 'option-1', betrag: '100', synthetisch: 'nein' });
  assert.equal(r.status, 303);
  assert.equal(db.zahlungen.at(-1).synthetisch, true, 'auch auf Wunsch „nein“ keine reale Zahlung in der Vorschau');
  assert.equal((await pl.form('/portal/verguetung/p-n01/zahlung', { _csrf: await pl.csrf(), vertragId: 'k-1', anspruchKey: 'option-1', betrag: '1' })).status, 404);
});

test('Eigentümer A: Meine Vergütung nur eigene Verträge, Status getrennt, PDF; keine fremden oder internen Daten', async () => {
  const { r, body } = await ownA.text('/portal/verguetung');
  assert.equal(r.status, 200);
  for (const t of ['Demo-Standort Nord A', 'Vereinbart', 'Fällig', 'Bezahlt', 'Prognose', 'Demo-Buchung', 'keine reale Zahlung', 'Optionsvergütung', 'Laufende Pacht', 'Indexanpassung', 'Variable Vergütung', 'eine Festpacht ist nicht am Handelsergebnis beteiligt']) assert.match(body, new RegExp(t));
  assert.doesNotMatch(body, /Nord B|Süd A|Kaufpreisregelung|Gesamtinvestition|Projekt-IRR|99\.000/, 'nur eigene Daten, keine Interna, keine unverbindlichen Vorschläge');
  const pdf = await ownA.req('/portal/verguetung/vertrag/k-1/pdf');
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  for (const p of ['/portal/verguetung/vertrag/k-2/pdf', '/portal/verguetung/vertrag/k-3/pdf', '/portal/verguetung/p-n01', '/portal/wirtschaftlichkeit', '/portal/wirtschaftlichkeit/p-n01', '/portal/admin/handelsdaten']) assert.equal(await st(ownA, p), 404, p);
});

test('Eigentümerin B: Kaufoption mit Kaufpreisregelung, nur freigegebene Stände', async () => {
  const { body } = await ownB.text('/portal/verguetung');
  assert.match(body, /Kaufpreisregelung/); assert.match(body, /Demo-Standort Nord B/); assert.doesNotMatch(body, /Nord A|Variable Vergütung/);
  assert.equal(await st(ownB, '/portal/verguetung/vertrag/k-1/pdf'), 404);
});

test('Investoren: nur freigegebene Kennzahlen ihres Projekts, keine Kostenpositionen', async () => {
  const { body } = await invA.text('/portal/projekte/p-n01');
  assert.match(body, /Freigegebene Finanzkennzahlen/); assert.match(body, /Projekt-IRR/);
  assert.doesNotMatch(body, /Wartung|Versicherung|Handelsstrategie|Vermarktung|Day-Ahead/);
  for (const p of ['/portal/wirtschaftlichkeit', '/portal/wirtschaftlichkeit/p-n01', '/portal/verguetung/p-n01', '/portal/verguetung']) assert.equal(await st(invA, p), 404, p);
  const b = await invB.text('/portal/projekte/p-n02');
  assert.doesNotMatch(b.body, /Freigegebene Finanzkennzahlen/, 'ohne Freigabe keine Kennzahlen');
  assert.equal(await st(invB, '/portal/projekte/p-n01'), 404);
});

test('Handelsdaten: Import nur Administration, Prüfung vor Übernahme, keine Handelsaufträge', async () => {
  const csv = 'projektId;periode;bezugMWh;einspeisungMWh;handelsumsatz;handelskosten;gebuehren;speicherverlusteMWh;verschleissKosten;realisierterErtrag;prognoseErtrag\np-n02;2028-01;100;86;10.000;3.000;100;14;500;10.000;9.500';
  const csrf = await admin.csrf('/portal/admin/handelsdaten');
  const ok = await admin.form('/portal/admin/handelsdaten', { _csrf: csrf, inhalt: csv });
  assert.equal(ok.status, 200); assert.match(await ok.text(), /1 Datensätze übernommen/);
  assert.ok(db.handelsdaten.some((h) => h.projektId === 'p-n02' && h.periode === '2028-01' && h.handelsumsatz === 10000));
  const bad = await admin.form('/portal/admin/handelsdaten', { _csrf: csrf, inhalt: csv.replace('p-n02', 'p-xyz') });
  assert.equal(bad.status, 422); assert.match(await bad.text(), /Nichts übernommen/);
  assert.equal((await admin.form('/portal/admin/handelsdaten', { inhalt: csv })).status, 403);
  assert.equal(await st(pl, '/portal/admin/handelsdaten'), 404);
});

test('Navigation: Wirtschaftlichkeit intern, Meine Vergütung für Eigentümer', async () => {
  assert.match((await admin.text('/portal')).body, /href="\/portal\/wirtschaftlichkeit"/);
  assert.match((await markus.text('/portal/pipeline')).body, /href="\/portal\/wirtschaftlichkeit"/);
  const o = (await ownA.text('/portal')).body;
  assert.match(o, /href="\/portal\/verguetung"/); assert.doesNotMatch(o, /href="\/portal\/wirtschaftlichkeit"/);
  assert.doesNotMatch((await invA.text('/portal/dokumente')).body, /href="\/portal\/(wirtschaftlichkeit|verguetung)"/);
});
