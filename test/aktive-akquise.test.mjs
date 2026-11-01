// Aktive Grundstücksakquise und Standortqualifizierung (AW-20261101-GE-CLAUDE-STROMKAI-AKTIVE-AKQUISE-021).
// Prüft mit synthetischen Daten: Fläche und Kontakt ohne Anfrage, Datenschutz-Freigabetor, Mehrfachrollen, mehrere
// Flurstücke und Kontakte je Standort, Dubletten, strukturierte Flurstücksfelder, unveränderte Altbestände, regionale
// Rechte, Verarbeitungssperre, Wiedervorlagen, Vorqualifizierung und Übernahme in die Pipeline, Schalter.
// Aufruf: node --test test/aktive-akquise.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = mkdtempSync(join(tmpdir(), 'bess-aktiv-'));
process.env.BESS_DATA_DIR = DIR;
process.env.BESS_PREVIEW_HELPERS = '0';
delete process.env.BESS_MFA;
delete process.env.BESS_AKTIVE_AKQUISE;
delete process.env.BESS_AKQUISE_ECHTDATEN;
const PW = 'Vorschau!Speicher-2026';

let server, base, db, bestand;
before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'data', 'seed.mjs'), DIR]);
  const store = await import('../src/lib/store.mjs');
  await store.openStore(DIR);
  db = store.getDb();
  const { hashPassword } = await import('../src/lib/auth.mjs');
  // synthetisches Testkonto Vertrieb Süd (nur in diesem Testlauf)
  db.users.push({ id: 'u-sued', email: 'sued.vertrieb@demo.invalid', name: 'Vertrieb Süd (Test)', role: 'vertrieb_sued', mfa: false, active: true, pw: hashPassword(PW), createdAt: new Date().toISOString() });
  bestand = JSON.stringify(seedStand());
  const { createApp } = await import('../server.mjs');
  server = createApp();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); rmSync(DIR, { recursive: true, force: true }); });

class Client {
  constructor() { this.cookie = ''; }
  async req(path, opts = {}) {
    const res = await fetch(base + path, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(this.cookie ? { cookie: this.cookie } : {}) } });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    return res;
  }
  async text(path) { const r = await this.req(path); return { r, body: await r.text() }; }
  async form(path, fields) {
    const b = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) b.append(k, x);
    return this.req(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: b.toString() });
  }
  async csrf(path = '/portal/grundstuecke') { return /name="_csrf" value="([^"]+)"/.exec((await this.text(path)).body)?.[1]; }
}
async function login(email) {
  const c = new Client();
  const { body } = await c.text('/portal/login');
  const r = await c.form('/portal/anmelden', { _t: /name="_t" value="([^"]+)"/.exec(body)[1], email, password: PW });
  assert.equal(r.status, 303, `Login ${email}`);
  c.token = await c.csrf();
  return c;
}
const neu = (a, b) => b.find((x) => !a.includes(x));
const SEED = { p: ['p-n01', 'p-n02', 'p-s01'], x: ['x-1', 'x-2', 'x-3'], c: ['c-own-a', 'c-own-b', 'c-kom', 'c-s1'] };
const seedStand = () => JSON.parse(JSON.stringify({ p: db.projects.filter((p) => SEED.p.includes(p.id)), x: db.parcels.filter((x) => SEED.x.includes(x.id)), c: db.contacts.filter((c) => SEED.c.includes(c.id)), k: db.contracts }));
let K, X1, C1, C2; // Kandidat, erstes Flurstück, Kontakte

test('Fläche ohne Anfrage erfassen: Datenschutz-Freigabetor, Region, grobe Ersterfassung, keine Pipeline', async () => {
  const m = await login('markus@demo.invalid');
  const form = (await m.text('/portal/grundstuecke/neu')).body;
  for (const n of ['bundesland', 'gemeinde', 'gemarkung', 'flur', 'flurstueck', 'areaHa', 'karte', 'datenquelle', 'erhobenAm', 'pruefstatus', 'testdaten']) assert.match(form, new RegExp(`name="${n}"`), n);
  assert.ok(!/value="sued"/.test(form), 'nur eigene Region');
  const vorher = db.projects.length;
  // ohne Testdatenkennzeichnung: Freigabetor greift
  assert.equal((await m.form('/portal/grundstuecke/neu', { _csrf: m.token, region: 'nord', gemeinde: 'Testhausen' })).status, 422);
  assert.equal((await m.form('/portal/grundstuecke/neu', { _csrf: m.token, region: 'sued', testdaten: 'ja' })).status, 403, 'fremde Region');
  assert.equal(db.projects.length, vorher, 'nichts angelegt');
  // grobe Ersterfassung: nur Region und Testkennzeichnung
  const ids = db.projects.map((p) => p.id);
  const r = await m.form('/portal/grundstuecke/neu', { _csrf: m.token, region: 'nord', testdaten: 'ja', bundesland: 'Schleswig-Holstein', gemeinde: 'Testhausen', gemarkung: 'Testmark', flur: '4', flurstueck: '21/2', areaHa: '4,2', karte: '54.1, 10.2 (synthetisch)', datenquelle: 'eigene Recherche (synthetisch)', erhobenAm: '2026-11-01' });
  assert.equal(r.status, 303);
  K = db.projects.find((p) => p.id === neu(ids, db.projects.map((p) => p.id)));
  assert.equal(K.kandidat, true);
  assert.equal(K.source.art, 'aktive_akquise');
  assert.equal(K.phase, 1);
  assert.match(K.code, /^STK-N-\d{3}$/, 'bestehendes Kennungsschema');
  assert.equal(K.testdaten, true);
  X1 = db.parcels.find((x) => x.projectId === K.id);
  assert.deepEqual([X1.gemarkung, X1.flur, X1.flurstueck, X1.gemeinde, X1.bundesland, X1.areaHa, X1.pruefstatus], ['Testmark', '4', '21/2', 'Testhausen', 'Schleswig-Holstein', 4.2, 'unbestätigt']);
  assert.equal(X1.ownerContactId, null, 'kein Eigentümer unterstellt');
  const t = db.tasks.find((x) => x.projectId === K.id);
  assert.equal(t.assignee, 'u-markus');
  assert.ok(!db.grants.some((g) => g.projectId === K.id), 'keine Rechtevergabe');
  // nicht in der Pipeline, aber unter Grundstücke und in der Standortakte
  assert.ok(!(await m.text('/portal/pipeline')).body.includes(K.code));
  assert.match((await m.text('/portal/pipeline')).body, /Flächenkandidat\(en\) in der Vorqualifizierung/);
  assert.match((await m.text('/portal/grundstuecke')).body, new RegExp(K.code));
  const akte = (await m.text(`/portal/projekte/${K.id}`)).body;
  for (const s of ['Flächenakquise und Vorqualifizierung', 'Herkunft: Aktive Akquise', 'Arbeitsablauf', 'Vorprüfung – nicht bestätigt', 'Testdatensatz']) assert.ok(akte.includes(s), s);
  // grobe Erfassung ohne Lagedaten bleibt möglich
  assert.equal((await m.form('/portal/grundstuecke/neu', { _csrf: m.token, region: 'nord', testdaten: 'ja' })).status, 303);
});

test('Rechte: externe Rollen 404, Projektleitung ohne Region legt nichts an, Vertrieb Süd sieht Nord-Kandidaten nicht', async () => {
  for (const e of ['investor.a@demo.invalid', 'eigentuemer.a@demo.invalid', 'gemeinde@demo.invalid', 'technik@demo.invalid']) {
    const c = await login(e);
    for (const p of ['/portal/grundstuecke/neu', '/portal/kontakte/neu', `/portal/kontakte/c-own-a`, `/portal/projekte/${K.id}`]) assert.equal((await c.req(p)).status, 404, `${e} ${p}`);
    assert.equal((await c.form(`/portal/projekte/${K.id}/vorqualifizierung`, { _csrf: c.token, status: 'nicht geeignet' })).status, 404);
    assert.ok(!(await c.text('/portal/grundstuecke')).body.includes('Flächenkandidaten'), 'keine Kandidatenliste extern');
  }
  const pl = await login('projektleitung@demo.invalid');
  assert.equal((await pl.req('/portal/grundstuecke/neu')).status, 404);
  assert.equal((await pl.req(`/portal/projekte/${K.id}`)).status, 404, 'Projektleitung ohne Zuordnung sieht den Kandidaten nicht');
  const sd = await login('sued.vertrieb@demo.invalid');
  assert.equal((await sd.req(`/portal/projekte/${K.id}`)).status, 404);
  assert.equal((await sd.form(`/portal/projekte/${K.id}/flurstueck`, { _csrf: sd.token, testdaten: 'ja' })).status, 404);
  assert.ok(!(await sd.text('/portal/grundstuecke')).body.includes(K.code));
  const ad = await login('admin@demo.invalid');
  assert.equal((await ad.req(`/portal/projekte/${K.id}`)).status, 200, 'Administration sieht alle Regionen');
});

test('Kontakt ohne Anfrage: Mehrfachrollen, Herkunft, Regionssichtbarkeit, Dublettenprüfung', async () => {
  const m = await login('markus@demo.invalid');
  assert.equal((await m.form('/portal/kontakte/neu', { _csrf: m.token, name: 'Hof Probe (synthetisch)', region: 'nord' })).status, 422, 'Freigabetor');
  const ids = db.contacts.map((c) => c.id);
  assert.equal((await m.form('/portal/kontakte/neu', { _csrf: m.token, name: 'Hof Probe (synthetisch)', rollen: ['Eigentümer', 'Bewirtschafter'], email: 'hof.probe@example.invalid', region: 'nord', herkunft: 'eigene Erhebung vor Ort', rechtsgrundlage: 'noch nicht festgelegt', testdaten: 'ja' })).status, 303);
  C1 = db.contacts.find((c) => c.id === neu(ids, db.contacts.map((c) => c.id)));
  assert.deepEqual(C1.rollen, ['Eigentümer', 'Bewirtschafter']);
  assert.equal(C1.kind, 'Projektkontakt', 'keine Eigentümereinstufung ohne Grundlage');
  assert.deepEqual(C1.projectIds, []);
  assert.equal(C1.datenschutz.herkunft, 'eigene Erhebung vor Ort');
  assert.equal(C1.datenschutz.art14, 'offen – Information ausstehend');
  assert.ok(C1.datenschutz.pruefenAm);
  assert.match((await m.text('/portal/kontakte')).body, /Hof Probe/);
  assert.equal((await (await login('sued.vertrieb@demo.invalid')).req(`/portal/kontakte/${C1.id}`)).status, 404, 'andere Region');
  // Dublette (gleiche E-Mail): Hinweis, nichts angelegt; nach Bestätigung angelegt
  const n = db.contacts.length;
  const d = await m.form('/portal/kontakte/neu', { _csrf: m.token, name: 'Hof Probe Zwei (synthetisch)', email: 'HOF.probe@example.invalid ', region: 'nord', testdaten: 'ja' });
  assert.equal(d.status, 200);
  assert.match(await d.text(), /Mögliche Dubletten[\s\S]*Hof Probe/);
  assert.equal(db.contacts.length, n);
  assert.equal((await m.form('/portal/kontakte/neu', { _csrf: m.token, name: 'Pächterin Probe (synthetisch)', rollen: 'Pächter', region: 'nord', testdaten: 'ja', projectId: K.id })).status, 303);
  C2 = db.contacts.at(-1);
  assert.deepEqual(C2.projectIds, [K.id]);
  // Projektfremde Region kann nicht verknüpft werden
  assert.equal((await m.form('/portal/kontakte/neu', { _csrf: m.token, name: 'X', region: 'nord', testdaten: 'ja', projectId: 'p-s01' })).status, 404);
});

test('Flurstücke und Beteiligte: mehrere Flurstücke und Kontakte, Eigentum nur mit Grundlage, Bewirtschafter ≠ Eigentümer', async () => {
  const m = await login('markus@demo.invalid');
  assert.equal((await m.form(`/portal/projekte/${K.id}/flurstueck`, { _csrf: m.token, gemarkung: 'Testmark', flur: '4', flurstueck: '22', testdaten: 'ja' })).status, 303);
  const xs = db.parcels.filter((x) => x.projectId === K.id);
  assert.equal(xs.length, 2, 'mehrere Flurstücke je Standort');
  const bet = (f) => m.form(`/portal/projekte/${K.id}/beteiligte`, { _csrf: m.token, parcelId: X1.id, ...f });
  assert.equal((await bet({ contactId: C1.id, rolle: 'Eigentümer', eigentum: 'bestätigt' })).status, 422, 'ohne Grundlage');
  assert.equal((await bet({ contactId: C1.id, rolle: 'Bewirtschafter', eigentum: 'bestätigt', grundlage: 'Pachtvertrag' })).status, 422, 'Bewirtschafter nicht Eigentümer');
  assert.equal((await bet({ contactId: C1.id, rolle: 'Bewirtschafter', eigentum: 'nicht bestätigt' })).status, 303);
  assert.equal((await bet({ contactId: C2.id, rolle: 'Pächter' })).status, 303);
  assert.equal((await bet({ contactId: C1.id, rolle: 'Eigentümer', eigentum: 'nicht bestätigt' })).status, 303);
  let akte = (await m.text(`/portal/projekte/${K.id}`)).body;
  assert.match(akte, /Eigentümer \(laut Angabe\)[\s\S]*Eigentümerstatus: nicht geprüft/);
  assert.equal(X1.beteiligte.length, 3, 'mehrere Kontakte und Rollen je Flurstück');
  assert.equal((await bet({ contactId: C1.id, rolle: 'Eigentümer', eigentum: 'bestätigt', grundlage: 'Grundbuchauszug (synthetisch)' })).status, 303);
  assert.equal(X1.beteiligte.filter((b) => b.rolle === 'Eigentümer').length, 1, 'aktualisiert statt doppelt');
  assert.equal(X1.beteiligte.find((b) => b.rolle === 'Eigentümer').eigentum, 'bestätigt');
  assert.ok(C1.projectIds.includes(K.id), 'Kontakt nachträglich mit Standort verknüpft');
  // DQ-1: erst die Bestätigung mit Grundlage ordnet das Flurstück dem Eigentümer zu (keine Konto- oder Rechtevergabe)
  assert.equal(X1.ownerContactId, C1.id);
  assert.equal(C1.kind, 'Grundstückseigentümer');
  assert.ok(!db.users.some((x) => x.contactId === C1.id), 'kein Portalkonto angelegt');
  // Verknüpfung beenden statt löschen
  const b2 = X1.beteiligte.find((b) => b.contactId === C2.id);
  assert.equal((await m.form(`/portal/projekte/${K.id}/beteiligte/${b2.id}/beenden`, { _csrf: m.token, parcelId: X1.id })).status, 303);
  assert.ok(b2.beendetAm && X1.beteiligte.includes(b2), 'Eintrag bleibt erhalten');
  akte = (await m.text(`/portal/projekte/${K.id}`)).body;
  assert.match(akte, /Hof Probe[\s\S]*bestätigt/);
});

test('Dubletten: gleiches Flurstück, gleiche Gemeinde; fremde Region ohne Namensnennung', async () => {
  const m = await login('markus@demo.invalid');
  const n = db.projects.length;
  const r = await m.form('/portal/grundstuecke/neu', { _csrf: m.token, region: 'nord', testdaten: 'ja', gemarkung: 'testmark ', flur: '4', flurstueck: '21/2' });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Mögliche Dubletten[\s\S]*Grundstück/);
  assert.equal(db.projects.length, n);
  // Seed-Flurstück aus Nord (x-1) erkannt
  assert.match(await (await m.form('/portal/grundstuecke/neu', { _csrf: m.token, region: 'nord', testdaten: 'ja', gemarkung: 'Demo-Gemarkung 1', flur: '3', flurstueck: '12/4' })).text(), /Mögliche Dubletten/);
  // Vertrieb Süd: Treffer im Norden ohne Namen und Link
  const sd = await login('sued.vertrieb@demo.invalid');
  const t = await (await sd.form('/portal/grundstuecke/neu', { _csrf: sd.token, region: 'sued', testdaten: 'ja', gemarkung: 'Testmark', flur: '4', flurstueck: '21/2' })).text();
  assert.match(t, /ohne Ihren Zugriff/);
  assert.ok(!t.includes(K.code));
  assert.equal(db.projects.length, n);
  // mit Bestätigung angelegt
  assert.equal((await m.form('/portal/grundstuecke/neu', { _csrf: m.token, region: 'nord', testdaten: 'ja', gemarkung: 'Testmark', flur: '4', flurstueck: '21/2', dublettenGeprueft: 'ja' })).status, 303);
  assert.equal(db.projects.length, n + 1);
});

test('Kontaktversuche: Kontaktweg, Wiedervorlage als Aufgabe mit Benachrichtigung, Art.-14-Nachweis, Verarbeitungssperre, Protokoll ohne Personendaten', async () => {
  const m = await login('markus@demo.invalid');
  const t0 = db.tasks.length;
  assert.equal((await m.form(`/portal/kontakte/${C1.id}/kontaktversuch`, { _csrf: m.token, datum: '2026-11-01', weg: 'persönliche Ansprache vor Ort', status: 'erreicht – Interesse', ergebnis: 'Interesse an Gespräch (synthetisch)', naechsteAktion: 'Unterlagen vorbeibringen', wiedervorlage: '2026-11-15', verantwortlich: 'u-admin', projectId: K.id, art14Erteilt: 'ja' })).status, 303);
  const k = C1.kontaktversuche.at(-1);
  assert.equal(k.weg, 'persönliche Ansprache vor Ort');
  assert.equal(k.by, 'u-markus');
  assert.equal(C1.datenschutz.art14, 'informiert');
  assert.equal(C1.datenschutz.art14Am, '2026-11-01');
  const t = db.tasks.at(-1);
  assert.equal(db.tasks.length, t0 + 1);
  assert.equal(t.projectId, K.id);
  assert.equal(t.assignee, 'u-admin');
  assert.equal(t.due, '2026-11-15');
  assert.ok(db.benachrichtigungen.some((b) => b.userId === 'u-admin' && b.art === 'aufgabe_zugewiesen'), 'Benachrichtigung über bestehenden Mechanismus');
  // Zuständige ohne Standortzugriff (Projektleitung ohne Zuordnung) erhalten keine unsichtbare Aufgabe
  assert.equal((await m.form(`/portal/kontakte/${C1.id}/kontaktversuch`, { _csrf: m.token, weg: 'Gemeinde/Amtsverwaltung', status: 'geplant', wiedervorlage: '2026-11-20', verantwortlich: 'u-pl', projectId: K.id })).status, 422);
  const detail = (await m.text(`/portal/kontakte/${C1.id}`)).body;
  for (const s of ['Kontaktversuche', 'persönliche Ansprache vor Ort', 'Unterlagen vorbeibringen', '§ 12 GBO', 'Datenschutz']) assert.ok(detail.includes(s), s);
  // erfolgloser Versuch, dann Widerspruch → Sperre
  assert.equal((await m.form(`/portal/kontakte/${C2.id}/kontaktversuch`, { _csrf: m.token, weg: 'Weiterleitung über Dritte', status: 'nicht erreicht' })).status, 303);
  assert.equal((await m.form(`/portal/kontakte/${C2.id}/kontaktversuch`, { _csrf: m.token, weg: 'Gemeinde/Amtsverwaltung', status: 'Kontakt nicht erwünscht' })).status, 303);
  assert.equal(C2.datenschutz.gesperrt, true);
  assert.equal((await m.form(`/portal/kontakte/${C2.id}/kontaktversuch`, { _csrf: m.token, weg: 'persönliche Ansprache vor Ort', status: 'geplant' })).status, 409, 'Verarbeitungssperre');
  assert.equal((await m.form(`/portal/projekte/${K.id}/beteiligte`, { _csrf: m.token, parcelId: X1.id, contactId: C2.id, rolle: 'Pächter' })).status, 409);
  assert.match((await m.text(`/portal/kontakte/${C2.id}`)).body, /Verarbeitung gesperrt/);
  // Protokoll: Kennungen, keine Namen, E-Mails oder Ergebnistexte
  const log = JSON.stringify(db.audit.filter((e) => ['kontakt_angelegt', 'kontaktversuch', 'beteiligung_verknuepft', 'flaeche_erfasst', 'kontakt_verarbeitung_gesperrt'].includes(e.event)));
  for (const s of ['Hof Probe', 'hof.probe@', 'Interesse an Gespräch', 'Pächterin Probe']) assert.ok(!log.includes(s), s);
  // Datenschutzangaben nachtragen: Sperre aufheben nur bewusst
  assert.equal((await m.form(`/portal/kontakte/${C2.id}/datenschutz`, { _csrf: m.token, herkunft: 'Vermittlung durch Dritte', rechtsgrundlage: 'noch nicht festgelegt', art14: 'offen – Information ausstehend', gesperrt: 'ja', sperrgrund: 'Widerspruch' })).status, 303);
  assert.equal(C2.datenschutz.gesperrt, true);
  assert.equal(C2.datenschutz.herkunft, 'Vermittlung durch Dritte');
});

test('Vorqualifizierung: fehlende Angaben → nicht bestätigt; vollständig → vorqualifiziert; Übernahme in die Pipeline', async () => {
  const m = await login('markus@demo.invalid');
  assert.equal((await m.form(`/portal/projekte/${K.id}/pipeline`, { _csrf: m.token })).status, 409, 'ohne Vorqualifizierung keine Übernahme');
  const r = await m.form(`/portal/projekte/${K.id}/vorqualifizierung`, { _csrf: m.token, flaecheHa: '3,5', szenarien: '10 MW / 20 MWh; 15 MW / 30 MWh', status: 'vorqualifiziert (intern)' });
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location'), /m=unvollstaendig/);
  assert.equal(K.vorqualifizierung.status, 'Vorprüfung – nicht bestätigt', 'keine Eignungszusage bei fehlenden Daten');
  assert.deepEqual(K.vorqualifizierung.szenarien, [{ mw: 10, mwh: 20 }, { mw: 15, mwh: 30 }]);
  assert.ok(K.vorqualifizierung.fehlend.includes('Netzanschlussstatus'));
  const voll = { _csrf: m.token, flaecheHa: '3,5', szenarien: '5 MW / 10 MWh', abstandNvpKm: '1,8', netzstufe: 'Vorprüfung', zuschnitt: 'rechteckig, Wirtschaftsweg', zufahrt: 'über Kreisstraße', planungsrecht: 'Außenbereich – Privilegierung zu prüfen', sicherung: 'Gespräch geführt', risiken: 'Wasserschutzgebiet prüfen', status: 'vorqualifiziert (intern)' };
  await m.form(`/portal/projekte/${K.id}/vorqualifizierung`, { ...voll, ausschluss: 'ja' });
  assert.equal(K.vorqualifizierung.status, 'Vorprüfung – nicht bestätigt', 'Ausschlusskriterium blockiert');
  await m.form(`/portal/projekte/${K.id}/vorqualifizierung`, voll);
  assert.equal(K.vorqualifizierung.status, 'vorqualifiziert (intern)');
  assert.deepEqual(K.vorqualifizierung.fehlend, []);
  assert.equal(K.gridStatus, 'nicht begonnen', 'Bestandsfeld Netzstatus nicht überschrieben');
  assert.equal((await m.form(`/portal/projekte/${K.id}/pipeline`, { _csrf: m.token })).status, 303);
  assert.equal(K.kandidat, false);
  assert.equal(K.contractStatus, 'Gespräch geführt');
  assert.match((await m.text('/portal/pipeline')).body, new RegExp(K.code));
  assert.match((await m.text(`/portal/projekte/${K.id}`)).body, /In die Pipeline übernommen/);
});

test('Altbestand: strukturierte Übernahme aus Anfrage, Altangabe bleibt, Vorschlag nur nach Bestätigung, lesende Prüfung, Seed unverändert', async () => {
  const { altdatenPruefen } = await import('../src/portal/flaechen.mjs');
  const vor = JSON.stringify(db.parcels);
  const befund = altdatenPruefen(db);
  assert.equal(JSON.stringify(db.parcels), vor, 'Prüfung schreibt nichts');
  assert.equal(befund.find((b) => b.id === 'x-3').flurstueck, 'nicht eindeutig – Prüfaufgabe');
  assert.equal(befund.find((b) => b.id === 'x-1').eigentuemer, 'Vertrag vorhanden');
  // Altstand vor AW-021 nachbilden: Freitext komplett in „gemarkung“, Flur/Flurstück leer, Eigentümer aus Anfrage mit Rolle Pächter
  db.contacts.push({ id: 'c-alt', name: 'Alt Pächter (synthetisch)', kind: 'Grundstückseigentümer', email: '', phone: '', projectIds: ['p-n02'], owner: 'u-markus', note: 'Pächter/in · aus Anfrage ANF-2026-0099' });
  db.parcels.push({ id: 'x-alt', projectId: 'p-n02', ownerContactId: 'c-alt', gemarkung: 'Gemarkung Altdorf, Flur 7, Flurstück 3/1', flur: '–', flurstueck: '–', areaHa: 2, devAreaHa: null, use: 'Acker', status: 'Erstkontakt' });
  const alt = db.parcels.at(-1);
  const b = altdatenPruefen(db).find((x) => x.id === 'x-alt');
  assert.deepEqual(b.vorschlag, { gemarkung: 'Altdorf', flur: '7', flurstueck: '3/1' });
  assert.match(b.eigentuemer, /Zuordnung prüfen – Rolle laut Anfrage: Pächter\/in/);
  assert.equal(alt.gemarkung, 'Gemarkung Altdorf, Flur 7, Flurstück 3/1', 'keine automatische Korrektur');
  const m = await login('markus@demo.invalid');
  const akte = (await m.text('/portal/projekte/p-n02')).body;
  assert.match(akte, /Altangabe/);
  assert.match(akte, /Vorschlag übernehmen/);
  assert.match(akte, /Rolle laut Anfrage: Pächter\/in/);
  assert.equal((await m.form('/portal/projekte/p-n02/flurstueck/x-alt/vorschlag', { _csrf: m.token })).status, 303);
  assert.deepEqual([alt.gemarkung, alt.flur, alt.flurstueck, alt.altangabe], ['Altdorf', '7', '3/1', 'Gemarkung Altdorf, Flur 7, Flurstück 3/1']);
  assert.equal(alt.aenderungen.at(-1).by, 'u-markus');
  // nicht eindeutige Altangabe → Prüfaufgabe, kein Umschreiben
  const ad = await login('admin@demo.invalid');
  const t0 = db.tasks.length;
  assert.equal((await ad.form('/portal/projekte/p-s01/flurstueck/x-3/pruefaufgabe', { _csrf: ad.token })).status, 303);
  assert.equal(db.tasks.length, t0 + 1);
  assert.equal(db.parcels.find((x) => x.id === 'x-3').gemarkung, 'Demo-Gemarkung Süd');
  assert.equal(db.parcels.find((x) => x.id === 'x-3').pruefstatus, 'Prüfung erforderlich');
  // Bearbeitung eines Altdatensatzes behält die Altangabe
  db.parcels.push({ id: 'x-alt2', projectId: 'p-n02', ownerContactId: null, gemarkung: 'am Waldrand hinter dem Hof', flur: '–', flurstueck: '–', areaHa: null, devAreaHa: null, use: 'Acker', status: 'Erstkontakt' });
  assert.equal((await m.form('/portal/projekte/p-n02/flurstueck/x-alt2', { _csrf: m.token, gemarkung: 'Walddorf', flur: '1', flurstueck: '5' })).status, 303);
  const a2 = db.parcels.at(-1);
  assert.equal(a2.altangabe, 'am Waldrand hinter dem Hof');
  assert.equal(a2.flurstueck, '5');
  // Seed-Bestand (Projekte p-*, Grundstücke x-1..3 außer Prüfstatus x-3, Kontakte c-*, Verträge) unverändert
  const jetzt = seedStand();
  assert.equal(jetzt.x[2].pruefstatus, 'Prüfung erforderlich');
  delete jetzt.x[2].pruefstatus; // einzige gewollte Änderung (Prüfaufgabe)
  assert.deepEqual(jetzt, JSON.parse(bestand));
});

test('Öffentliches Formular: Gemarkung/Flur/Flurstück getrennt und freiwillig, neue Rollen; Übernahme strukturiert', async () => {
  const form = await (await fetch(base + '/standort-anbieten')).text();
  for (const n of ['gemarkung', 'flur', 'flurstueck']) assert.match(form, new RegExp(`name="${n}"`));
  assert.equal((form.match(/ required/g) || []).length, 2, 'weiterhin nur zwei Pflichtfelder');
  for (const r of ['Bewirtschafter/in', 'Gemeinde oder Verwaltung', 'Hinweis auf eine Fläche (vermittelnd)']) assert.ok(form.includes(r), r);
  assert.match(form, /keine Daten Dritter/);
  for (const s of ['Rendite', 'garantiert', 'Grundbuch']) assert.ok(!form.includes(s), `keine Aussage ${s}`);
  const t = /name="_t" value="([^"]+)"/.exec(form)[1];
  await new Promise((r) => setTimeout(r, 1600));
  const f = new FormData();
  Object.entries({ _t: t, name: 'Bewirtschafter Test (synthetisch)', rolle: 'Bewirtschafter/in', email: 'bw@example.invalid', lage: 'Feldhausen', gemarkung: 'Feldmark', flur: '9', flurstueck: '44', nutzung: 'Acker', umspannwerk: 'unter 1 km', dsgvo: 'ja' }).forEach(([k, v]) => f.set(k, v));
  assert.equal((await fetch(base + '/standort-anbieten', { method: 'POST', body: f, redirect: 'manual' })).status, 303);
  const i = db.inquiries.at(-1);
  assert.deepEqual([i.gemarkung, i.flur, i.flurstueck, i.rolle], ['Feldmark', '9', '44', 'Bewirtschafter/in']);
  const m = await login('markus@demo.invalid');
  const csrf = await m.csrf(`/portal/anfragen/${i.id}`);
  assert.match((await m.text(`/portal/anfragen/${i.id}`)).body, /Feldmark, Flur 9, Flurstück 44/);
  assert.equal((await m.form(`/portal/anfragen/${i.id}/standort`, { _csrf: csrf, name: 'Feldhausen', region: 'nord', dublettenGeprueft: 'ja' })).status, 303);
  const x = db.parcels.at(-1);
  assert.deepEqual([x.gemarkung, x.flur, x.flurstueck, x.gemeinde], ['Feldmark', '9', '44', 'Feldhausen']);
  assert.match(x.datenquelle, /^Anfrage ANF-/);
  // DQ-1: Bewirtschafterin wird Kontaktperson mit ihrer Rolle, nicht Eigentümerin
  assert.equal(x.ownerContactId, null);
  assert.deepEqual(x.beteiligte.map((b) => [b.rolle, b.eigentum]), [['Bewirtschafter', 'nicht bestätigt']]);
  // Freitext-Altform weiterhin: nicht eindeutig → Altangabe + Prüfung erforderlich
  const { flurstueckParsen } = await import('../src/portal/akquise.mjs');
  assert.equal(flurstueckParsen('hinter der Scheune'), null);
});

test('DQ-1: Übernahme vergibt nie automatisch Eigentümerstatus; Rolle, Zuordnung und Bestätigung getrennt; ANF-2026-0006 nachgebildet', async () => {
  const { naechsteKennung } = await import('../src/portal/akquise.mjs');
  const m = await login('markus@demo.invalid');
  // gespeicherte Flächenanfragen je Rolle (synthetisch); Übernahme über die echte Route
  const anfrage = (rolle, name, extra = {}) => { const i = { id: `inq-dq1-${db.inquiries.length}`, ref: naechsteKennung(db), at: new Date().toISOString(), kind: 'flaeche', status: 'neu', name, rolle, email: `${db.inquiries.length}.dq1@example.invalid`, phone: '', plz: '', lage: `DQ1-Ort ${db.inquiries.length}`, flaeche: '', nutzung: 'Acker', umspannwerk: 'Weiß ich nicht', flurstueck: '', log: [], ...extra }; db.inquiries.push(i); return i; };
  const uebernehmen = async (i) => {
    const csrf = await m.csrf(`/portal/anfragen/${i.id}`);
    assert.equal((await m.form(`/portal/anfragen/${i.id}/standort`, { _csrf: csrf, name: i.lage, region: 'nord', dublettenGeprueft: 'ja' })).status, 303, i.rolle);
    const p = db.projects.find((y) => y.id === i.projectId);
    return { p, x: db.parcels.find((y) => y.projectId === p.id), c: db.contacts.find((y) => (y.projectIds || []).includes(p.id) && y.source?.inquiryId === i.id) };
  };
  const faelle = [['Eigentümer/in', 'Eigentümer'], ['Miteigentümer/in oder Erbengemeinschaft', 'Eigentümer'], ['Pächter/in', 'Pächter'], ['Bewirtschafter/in', 'Bewirtschafter'], ['Gemeinde oder Verwaltung', 'Gemeinde/Verwaltung'], ['Hinweis auf eine Fläche (vermittelnd)', 'Kontaktvermittler'], ['Bevollmächtigt oder Verwaltung', 'sonstiger Projektkontakt'], ['Sonstiges', 'sonstiger Projektkontakt'], ['', 'sonstiger Projektkontakt']];
  const ergebnis = {};
  for (const [rolle, erwartet] of faelle) {
    const { x, c } = await uebernehmen(anfrage(rolle, `DQ1 ${rolle || 'ohne Rolle'} (synthetisch)`));
    assert.equal(x.ownerContactId, null, `${rolle}: kein Eigentümer am Flurstück`);
    assert.equal(c.kind, 'Projektkontakt', `${rolle}: kein Eigentümerkontakt`);
    assert.deepEqual(c.rollen, [erwartet]);
    assert.deepEqual(x.beteiligte.map((b) => [b.contactId, b.rolle, b.eigentum, b.angabe]), [[c.id, erwartet, 'nicht bestätigt', rolle || 'keine Angabe']]);
    ergebnis[rolle] = { x, c };
  }
  // Eigentümerangabe ohne Grundlage: Kopfzeile mit Status, nicht für Vergütung auswählbar (kind), Vorqualifizierung verlangt Bestätigung
  const E = ergebnis['Eigentümer/in'];
  let akte = (await m.text(`/portal/projekte/${E.x.projectId}`)).body;
  assert.match(akte, /<dt>Eigentümer<\/dt><dd>DQ1 Eigentümer\/in \(synthetisch\) \(nicht geprüft\)/);
  const { fehlendeAngaben } = await import('../src/portal/flaechen.mjs');
  assert.ok(fehlendeAngaben(db, db.projects.find((p) => p.id === E.x.projectId), { netzstufe: 'keine Prüfung', planungsrecht: 'ungeprüft', sicherung: 'kein Kontakt' }).includes('bestätigter Eigentümer'));
  // Eigentümeranfrage mit dokumentierter Grundlage → Zuordnung und Eigentümerstatus; Beenden nimmt beides zurück
  const bet = (p, f) => m.form(`/portal/projekte/${p}/beteiligte`, { _csrf: m.token, ...f });
  assert.equal((await bet(E.x.projectId, { parcelId: E.x.id, contactId: E.c.id, rolle: 'Eigentümer', eigentum: 'bestätigt' })).status, 422, 'ohne Grundlage');
  assert.equal(E.x.ownerContactId, null);
  assert.equal((await bet(E.x.projectId, { parcelId: E.x.id, contactId: E.c.id, rolle: 'Eigentümer', eigentum: 'bestätigt', grundlage: 'Grundbuchauszug vom 01.11.2026 (synthetisch)' })).status, 303);
  assert.equal(E.x.ownerContactId, E.c.id);
  assert.equal(E.c.kind, 'Grundstückseigentümer');
  assert.equal(E.x.beteiligte.length, 1, 'bestehende Beteiligung aktualisiert');
  akte = (await m.text(`/portal/projekte/${E.x.projectId}`)).body;
  assert.match(akte, /<dt>Eigentümer<\/dt><dd>DQ1 Eigentümer\/in \(synthetisch\) \(bestätigt\)/);
  assert.equal((await m.form(`/portal/projekte/${E.x.projectId}/beteiligte/${E.x.beteiligte[0].id}/beenden`, { _csrf: m.token, parcelId: E.x.id })).status, 303);
  assert.equal(E.x.ownerContactId, null, 'Zuordnung zurückgenommen');
  assert.equal(E.c.kind, 'Projektkontakt');
  // Pächter, Bewirtschafter, Gemeinde, Hinweisgeber: nie als Eigentümer bestätigbar über ihre Rolle
  for (const r of ['Pächter/in', 'Bewirtschafter/in', 'Gemeinde oder Verwaltung', 'Hinweis auf eine Fläche (vermittelnd)']) {
    const { x, c } = ergebnis[r];
    assert.equal((await bet(x.projectId, { parcelId: x.id, contactId: c.id, rolle: c.rollen[0], eigentum: 'bestätigt', grundlage: 'Vertrag' })).status, 422, r);
    assert.equal(x.ownerContactId, null);
  }
  // Mehrfachrollen: Pächterin ist zusätzlich nachweislich Miteigentümerin → nur mit Grundlage
  const PA = ergebnis['Pächter/in'];
  assert.equal((await bet(PA.x.projectId, { parcelId: PA.x.id, contactId: PA.c.id, rolle: 'Eigentümer', eigentum: 'bestätigt', grundlage: 'Erbschein und Grundbuchauszug (synthetisch)' })).status, 303);
  assert.deepEqual(PA.c.rollen, ['Pächter', 'Eigentümer']);
  assert.deepEqual(PA.x.beteiligte.map((b) => [b.rolle, b.eigentum]), [['Pächter', 'nicht bestätigt'], ['Eigentümer', 'bestätigt']]);
  assert.equal(PA.x.ownerContactId, PA.c.id);
  // Dubletten und erneute Übernahme: unverändert
  const doppel = anfrage('Pächter/in', 'DQ1 Doppel (synthetisch)', { email: ergebnis['Bewirtschafter/in'].c.email });
  const csrf = await m.csrf(`/portal/anfragen/${doppel.id}`);
  assert.equal((await m.form(`/portal/anfragen/${doppel.id}/standort`, { _csrf: csrf, name: 'x', region: 'nord' })).status, 422, 'Dublettenbestätigung');
  assert.equal((await m.form(`/portal/anfragen/${ergebnis['Sonstiges'].c.source.inquiryId}/standort`, { _csrf: csrf, name: 'x', region: 'nord', dublettenGeprueft: 'ja' })).status, 403, 'keine zweite Übernahme');

  // QA-Fall ANF-2026-0006 nachgebildet (öffentliches Formular → Übernahme)
  const form = await (await fetch(base + '/standort-anbieten')).text();
  const t = /name="_t" value="([^"]+)"/.exec(form)[1];
  await new Promise((r) => setTimeout(r, 1600));
  const f = new FormData();
  Object.entries({ _t: t, name: 'QA021 Pächter Formular (synthetisch)', rolle: 'Pächter/in', email: 'qa021.paechter@example.invalid', lage: 'QA021-Wiesenau (synthetisch)', plz: '24999', gemarkung: 'QA021-Wiesenmark', flur: '2', flurstueck: '7', flaeche: '2,5', nutzung: 'Acker', umspannwerk: 'Weiß ich nicht', dsgvo: 'ja' }).forEach(([k, v]) => f.set(k, v));
  assert.equal((await fetch(base + '/standort-anbieten', { method: 'POST', body: f, redirect: 'manual' })).status, 303);
  const Q = await uebernehmen(db.inquiries.at(-1));
  assert.equal(Q.x.ownerContactId, null);
  assert.equal(Q.c.kind, 'Projektkontakt');
  assert.deepEqual([Q.x.gemarkung, Q.x.flur, Q.x.flurstueck, Q.x.areaHa], ['QA021-Wiesenmark', '2', '7', 2.5]);
  akte = (await m.text(`/portal/projekte/${Q.p.id}`)).body;
  assert.match(akte, /<dt>Eigentümer<\/dt><dd>–<\/dd>/, 'Kopfzeile nennt die Pächterin nicht als Eigentümerin');
  assert.match(akte, /QA021 Pächter Formular \(synthetisch\)<\/a> · Pächter/);
  assert.ok(!/Rolle laut Anfrage/.test(akte), 'kein Altfall');

  // Historische Fehlzuordnung (Stand vor DQ-1): erkannt und markiert, nicht verändert
  db.contacts.push({ id: 'c-dq1-alt', name: 'DQ1 Altfall Pächter (synthetisch)', kind: 'Grundstückseigentümer', email: '', phone: '', projectIds: ['p-n02'], owner: 'u-markus', note: 'Pächter/in · aus Anfrage ANF-2026-0098' });
  db.parcels.push({ id: 'x-dq1-alt', projectId: 'p-n02', ownerContactId: 'c-dq1-alt', gemarkung: 'DQ1-Mark', flur: '1', flurstueck: '1', areaHa: null, devAreaHa: null, use: 'Acker', status: 'Erstkontakt' });
  const vorher = JSON.stringify([db.contacts.at(-1), db.parcels.at(-1)]);
  akte = (await m.text('/portal/projekte/p-n02')).body;
  assert.match(akte, /DQ1 Altfall Pächter \(synthetisch\) \(Prüfung erforderlich; Rolle laut Anfrage: Pächter\/in\)/);
  assert.match((await m.text('/portal/kontakte')).body, /Eigentümerstatus: Prüfung erforderlich \(laut Anfrage: Pächter\/in\)/);
  assert.match((await m.text('/portal/kontakte/c-dq1-alt')).body, /Eigentümerstatus: Prüfung erforderlich/);
  assert.equal(JSON.stringify([db.contacts.find((c) => c.id === 'c-dq1-alt'), db.parcels.find((x) => x.id === 'x-dq1-alt')]), vorher, 'keine automatische Änderung');
  // Bestandskontakte mit Vertrag unverändert und unmarkiert
  assert.equal(db.contacts.find((c) => c.id === 'c-own-a').kind, 'Grundstückseigentümer');
  assert.equal(db.parcels.find((x) => x.id === 'x-1').ownerContactId, 'c-own-a');
  assert.match((await m.text('/portal/kontakte')).body, /Eigentümer A \(synthetisch\)[\s\S]*?Eigentümer \(laut Bestand\)<br><span class="mark mark-ok"[^>]*>Eigentümerstatus: bestätigt/);
});

test('R-DQ-e/f: Rolle ≠ Status in Kontaktliste, Kontaktakte und Standortakte; Vergütung nur für bestätigte Eigentümer, auch bei direktem Aufruf', async () => {
  const m = await login('markus@demo.invalid');
  const pl = await login('projektleitung@demo.invalid');
  const zeile = (body, name) => { const i = body.indexOf(name); return i < 0 ? '' : body.slice(i, body.indexOf('</tr>', i)); };
  const verg = async (c, pid) => { const b = (await c.text(`/portal/verguetung/${pid}`)).body; return [...b.matchAll(/<option value="([\w-]+)"( disabled)?>([^<]+)<\/option>/g)].filter((x) => x[3].includes('Eigentümerstatus')).map((x) => ({ id: x[1], gesperrt: !!x[2], text: x[3] })); };
  const sim = (c, pid, ownerContactId) => c.form(`/portal/verguetung/${pid}/simulation`, { _csrf: c.token, ownerContactId, stufe: 'simulation', typ: 'festpacht', flaecheHa: '1', pachtJeHa: '10000', mindestpacht: '10000' });
  // Pächterin aus Anfrage + nachweislich Miteigentümerin (Mehrfachrolle) – Projekt aus dem DQ-1-Test
  const PA = db.contacts.find((c) => c.name === 'DQ1 Pächter/in (synthetisch)');
  const xPA = db.parcels.find((x) => (x.beteiligte || []).some((b) => b.contactId === PA.id));
  const bEig = xPA.beteiligte.find((b) => b.contactId === PA.id && b.rolle === 'Eigentümer' && !b.beendetAm);
  // Bestätigt: alle drei Ansichten zeigen Rolle und Status getrennt, Grundlage mit Zeitpunkt und Person
  let liste = (await m.text('/portal/kontakte')).body;
  assert.match(zeile(liste, 'DQ1 Pächter/in (synthetisch)'), /Pächter, Eigentümer \(laut Angabe\)<br><span class="mark mark-ok"[^>]*>Eigentümerstatus: bestätigt/);
  let akte = (await m.text(`/portal/kontakte/${PA.id}`)).body;
  assert.match(akte, /Kontaktrollen:<\/span> Pächter, Eigentümer \(laut Angabe\)/);
  assert.match(akte, /Grundlage: Erbschein und Grundbuchauszug \(synthetisch\) · bestätigt [\d.]+, [\d:]+ durch Markus/);
  let sakte = (await m.text(`/portal/projekte/${xPA.projectId}`)).body;
  assert.match(sakte, /<dt>Eigentümer<\/dt><dd>DQ1 Pächter\/in \(synthetisch\) \(bestätigt\)/);
  // Vergütung: bestätigte Person auswählbar und speicherbar (Projektleitung? nur zugeordnete Projekte → Admin)
  const ad = await login('admin@demo.invalid');
  let o = await verg(ad, xPA.projectId);
  assert.deepEqual(o.map((x) => [x.id, x.gesperrt]), [[PA.id, false]]);
  assert.equal((await sim(ad, xPA.projectId, PA.id)).status, 303);
  const angebot = db.verguetungsangebote.filter((a) => a.ownerContactId === PA.id).at(-1);
  // Rücknahme: Rolle bleibt historisch, Status nicht mehr bestätigt – überall
  assert.equal((await m.form(`/portal/projekte/${xPA.projectId}/beteiligte/${bEig.id}/beenden`, { _csrf: m.token, parcelId: xPA.id })).status, 303);
  liste = (await m.text('/portal/kontakte')).body;
  assert.match(zeile(liste, 'DQ1 Pächter/in (synthetisch)'), /Pächter, Eigentümer \(laut Angabe\)<br><span class="mark mark-warn"[^>]*>Eigentümerstatus: nicht geprüft/);
  assert.ok(!/Eigentümerstatus: bestätigt/.test(zeile(liste, 'DQ1 Pächter/in (synthetisch)')), 'kein Eindruck eines bestätigten Eigentümers');
  akte = (await m.text(`/portal/kontakte/${PA.id}`)).body;
  assert.ok(!/Grundlage: Erbschein/.test(akte));
  sakte = (await m.text(`/portal/projekte/${xPA.projectId}`)).body;
  assert.match(sakte, /<dt>Eigentümer<\/dt><dd>–<\/dd>/);
  // Vergütung nach Rücknahme: Auswahl gesperrt; direkter Aufruf (Simulation, Vorschlag, verbindliche Übernahme) → 409, nichts gespeichert
  o = await verg(ad, xPA.projectId);
  assert.deepEqual(o.map((x) => [x.id, x.gesperrt]), [[PA.id, true]]);
  const n = { a: db.verguetungsangebote.length, v: db.vertragsstaende.length };
  assert.equal((await sim(ad, xPA.projectId, PA.id)).status, 409);
  assert.equal((await ad.form(`/portal/verguetung/${xPA.projectId}/simulation`, { _csrf: ad.token, ownerContactId: PA.id, stufe: 'vorschlag', typ: 'festpacht', flaecheHa: '1' })).status, 409);
  assert.equal((await ad.form(`/portal/verguetung/${xPA.projectId}/verbindlich`, { _csrf: ad.token, angebotId: angebot.id, stufe: 'eckdaten' })).status, 409);
  assert.deepEqual({ a: db.verguetungsangebote.length, v: db.vertragsstaende.length }, n);
  assert.ok(db.verguetungsangebote.includes(angebot), 'vorhandenes Angebot nicht geändert oder gelöscht');
  assert.ok(db.audit.some((e) => e.event === 'verguetung_abgelehnt_eigentum' && e.kontakt === PA.id));
  // Kontakt ohne Eigentümerangabe (reine Pächterin) – direkter Aufruf ebenfalls abgelehnt
  const nurPaechter = db.contacts.find((c) => c.name === 'DQ1 Bewirtschafter/in (synthetisch)');
  assert.equal((await sim(ad, nurPaechter.projectIds[0], nurPaechter.id)).status, 409);
  // Altfall (wie STK-N-003): erkennbar, gesperrt; nach dokumentierter Bestätigung freigegeben
  const alt = db.contacts.find((c) => c.id === 'c-dq1-alt');
  o = await verg(ad, 'p-n02');
  assert.ok(o.some((x) => x.id === 'c-dq1-alt' && x.gesperrt && /Prüfung erforderlich \(laut Anfrage: Pächter\/in\)/.test(x.text)));
  assert.ok(o.some((x) => x.id === 'c-own-b' && !x.gesperrt && /bestätigt/.test(x.text)), 'Bestandseigentümerin mit Vertrag bleibt auswählbar');
  assert.equal((await sim(ad, 'p-n02', 'c-dq1-alt')).status, 409);
  assert.equal((await m.form('/portal/projekte/p-n02/beteiligte', { _csrf: m.token, parcelId: 'x-dq1-alt', contactId: alt.id, rolle: 'Eigentümer', eigentum: 'bestätigt', grundlage: 'Grundbuchauszug nach Prüfung (synthetisch)' })).status, 303);
  assert.equal(db.parcels.find((x) => x.id === 'x-dq1-alt').ownerContactId, 'c-dq1-alt', 'Bestandszuordnung unverändert');
  assert.ok(db.audit.some((e) => e.event === 'beteiligung_verknuepft' && e.kontakt === 'c-dq1-alt' && e.eigentum === 'bestätigt'), 'Wechsel in bestätigt protokolliert');
  o = await verg(ad, 'p-n02');
  assert.ok(o.some((x) => x.id === 'c-dq1-alt' && !x.gesperrt && /Eigentümerstatus: bestätigt/.test(x.text)));
  // Bestätigter Eigentümer mit Vertrag: unverändert auswählbar und speicherbar, Vertrag unverändert
  const k1 = JSON.stringify(db.contracts.find((k) => k.id === 'k-1'));
  assert.equal((await sim(ad, 'p-n01', 'c-own-a')).status, 303);
  assert.equal(JSON.stringify(db.contracts.find((k) => k.id === 'k-1')), k1);
  // Berechtigungen unverändert: Vertrieb ohne Vergütungsrecht im Projekt 404, externe Rollen 404
  for (const e of ['investor.a@demo.invalid', 'eigentuemer.a@demo.invalid']) assert.equal((await (await login(e)).req('/portal/verguetung/p-n01')).status, 404, e);
  assert.equal((await pl.req(`/portal/verguetung/${xPA.projectId}`)).status, 404, 'Projektleitung ohne Zuordnung');
});

test('Schalter: Abnahmestufe ohne aktive Akquise, Echtdaten nie in Vorschauen', () => {
  const lauf = (env) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', "const { config } = await import('./src/config.mjs'); console.log(JSON.stringify({ a: config.aktiveAkquise, e: config.akquiseEchtdaten }));"], { cwd: ROOT, env: { ...process.env, BESS_AKTIVE_AKQUISE: '', BESS_AKQUISE_ECHTDATEN: '', ...env } }).toString());
  assert.deepEqual(lauf({}), { a: true, e: false }, 'QA: an, nur Testdaten');
  assert.deepEqual(lauf({ BESS_AKQUISE_ECHTDATEN: '1' }), { a: true, e: false }, 'Echtdaten in QA wirkungslos');
  assert.deepEqual(lauf({ BESS_STAGE: 'abnahme' }), { a: false, e: false }, 'Abnahmekandidat: aus');
  assert.deepEqual(lauf({ BESS_STAGE: 'abnahme', BESS_AKTIVE_AKQUISE: '1' }), { a: true, e: false });
  assert.deepEqual(lauf({ BESS_AKTIVE_AKQUISE: '0' }), { a: false, e: false });
});
