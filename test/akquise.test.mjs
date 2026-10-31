// Eigentümerakquise und Standortakte (AW-STROMKAI-20261031-CONSOLIDATION-ACQUISITION-020).
// Prüft: Formular mit Rolle/PLZ und lesbarer Kennung, Bearbeitung mit Historie und Wiedervorlage, Rechte,
// Dublettenprüfung, Übernahme in die bestehende Projektstruktur, Standortakte, Löschkonzept, öffentliche Inhalte.
// Aufruf: node --test test/akquise.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = mkdtempSync(join(tmpdir(), 'bess-akquise-'));
process.env.BESS_DATA_DIR = DIR;
process.env.BESS_PREVIEW_HELPERS = '0';
delete process.env.BESS_MFA;
const PW = 'Vorschau!Speicher-2026';

let server, base, db;
before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'data', 'seed.mjs'), DIR]);
  const store = await import('../src/lib/store.mjs');
  await store.openStore(DIR);
  db = store.getDb();
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
  async form(path, fields) { return this.req(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() }); }
  async csrf(path = '/portal/anfragen') { return /name="_csrf" value="([^"]+)"/.exec((await this.text(path)).body)?.[1]; }
}
async function login(email) {
  const c = new Client();
  const { body } = await c.text('/portal/login');
  const r = await c.form('/portal/anmelden', { _t: /name="_t" value="([^"]+)"/.exec(body)[1], email, password: PW });
  assert.equal(r.status, 303, `Login ${email}`);
  return c;
}
const text = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

async function anfrage(felder, datei) {
  const html = await (await fetch(base + '/standort-anbieten')).text();
  const t = /name="_t" value="([^"]+)"/.exec(html)[1];
  await new Promise((r) => setTimeout(r, 1600));
  const f = new FormData();
  Object.entries({ _t: t, nutzung: 'Acker', umspannwerk: 'unter 1 km', dsgvo: 'ja', ...felder }).forEach(([k, v]) => f.set(k, v));
  if (datei) f.set('datei', new Blob([Buffer.from('%PDF-1.4 lageplan')], { type: 'application/pdf' }), 'lageplan.pdf');
  return fetch(base + '/standort-anbieten', { method: 'POST', body: f, redirect: 'manual' });
}

let A, B; // A: neue Anfrage mit Unterlage, B: Dublette zu A

test('Formular: Rolle, PLZ, Gemeinde; lesbare Kennung; PLZ geprüft; wenige Pflichtfelder', async () => {
  const form = await (await fetch(base + '/standort-anbieten')).text();
  for (const n of ['name', 'rolle', 'email', 'phone', 'plz', 'lage', 'flaeche', 'nutzung', 'flurstueck', 'nachricht', 'datei']) assert.match(form, new RegExp(`name="${n}"`), n);
  assert.equal((form.match(/ required/g) || []).length, 2, 'nur Name und Gemeinde als HTML-Pflichtfeld');
  assert.equal((await anfrage({ name: 'Test', email: 'x@example.invalid', lage: 'Ort', plz: '12a' })).status, 422, 'ungültige PLZ');
  assert.equal((await anfrage({ name: 'Hof Test', rolle: 'Eigentümer/in', email: 'hof@example.invalid', phone: '0431 123456', plz: '24100', lage: 'Testdorf', flaeche: '3,5', flurstueck: 'Gemarkung Test, Flur 2, Flurstück 17/3' }, true)).status, 303);
  A = db.inquiries.at(-1);
  assert.match(A.ref, /^ANF-\d{4}-\d{4}$/);
  assert.equal(A.rolle, 'Eigentümer/in');
  assert.equal(A.plz, '24100');
  assert.ok(A.fileId);
  assert.equal((await anfrage({ name: 'Hof Test Zwei', rolle: 'manipuliert', phone: '0431-123456', lage: 'Testdorf', plz: '24100' })).status, 303);
  B = db.inquiries.at(-1);
  assert.equal(B.rolle, '', 'unbekannte Rolle wird nicht übernommen');
  assert.notEqual(A.ref, B.ref);
});

test('Rechte: nur interne Rollen sehen Anfragen; externe erhalten 404', async () => {
  for (const email of ['investor.a@demo.invalid', 'eigentuemer.a@demo.invalid', 'gemeinde@demo.invalid']) {
    const c = await login(email);
    assert.equal((await c.req('/portal/anfragen')).status, 404, email);
    assert.equal((await c.req(`/portal/anfragen/${A.id}`)).status, 404, email);
    assert.equal((await c.req(`/portal/anfragen/${A.id}/anlage`)).status, 404, email);
  }
  assert.equal((await fetch(`${base}/portal/anfragen/${A.id}`, { redirect: 'manual' })).status, 303, 'ohne Anmeldung zur Anmeldung');
});

test('Vertrieb bearbeitet: Status, Zuständigkeit, nächste Aktion, Wiedervorlage, Historie; CSRF erforderlich', async () => {
  const c = await login('markus@demo.invalid');
  const liste = (await c.text('/portal/anfragen')).body;
  assert.match(liste, new RegExp(A.ref));
  assert.match(liste, /mögliche Dublette/);
  assert.equal((await c.form(`/portal/anfragen/${A.id}/bearbeiten`, { status: 'in Prüfung' })).status, 403, 'ohne CSRF');
  const csrf = await c.csrf(`/portal/anfragen/${A.id}`);
  const r = await c.form(`/portal/anfragen/${A.id}/bearbeiten`, { _csrf: csrf, status: 'Gespräch vereinbart', assignee: 'u-markus', nextAction: 'Termin vor Ort', followUp: '2020-01-01', note: 'Telefonat geführt' });
  assert.equal(r.status, 303);
  assert.equal(A.status, 'Gespräch vereinbart');
  assert.equal(A.assignee, 'u-markus');
  assert.equal(A.followUp, '2020-01-01');
  assert.match(A.log.at(-1).text, /Telefonat geführt/);
  assert.equal(A.log.at(-1).by, 'u-markus');
  // Statuswert „als Standort übernommen“ ist nur über die Übernahme erreichbar, fremde Zuständige werden verworfen
  await c.form(`/portal/anfragen/${A.id}/bearbeiten`, { _csrf: csrf, status: 'als Standort übernommen', assignee: 'u-inv-a', nextAction: 'Termin vor Ort', followUp: '2020-01-01' });
  assert.equal(A.status, 'Gespräch vereinbart');
  assert.equal(A.assignee, 'u-markus');
  assert.match((await c.text('/portal/anfragen?f=faellig')).body, new RegExp(A.ref), 'fällige Wiedervorlage gefiltert');
  assert.match((await c.text('/portal')).body, /Wiedervorlage/, 'Kennzahl in der Übersicht');
  // Detail zeigt Dubletten und Historie, Vertrieb darf nicht übernehmen
  const d = (await c.text(`/portal/anfragen/${A.id}`)).body;
  assert.match(d, /Mögliche Dubletten/);
  assert.match(d, /Telefon/);
  assert.match(d, /Standort anlegen/);
  assert.ok(!/value="sued"/.test(d), 'Vertrieb Nord wählt nur die eigene Region');
  assert.equal((await c.form(`/portal/anfragen/${A.id}/standort`, { _csrf: csrf, name: 'X', region: 'sued', dublettenGeprueft: 'ja' })).status, 403, 'fremde Region');
  // Projektleitung ohne Regionsrolle: Standort wäre ohne Rechteänderung nicht sichtbar → keine Übernahme
  const pl = await login('projektleitung@demo.invalid');
  const plCsrf = await pl.csrf(`/portal/anfragen/${A.id}`);
  assert.ok(!/Standort anlegen/.test((await pl.text(`/portal/anfragen/${A.id}`)).body));
  const n = db.projects.length;
  assert.equal((await pl.form(`/portal/anfragen/${A.id}/standort`, { _csrf: plCsrf, name: 'X', region: 'nord', dublettenGeprueft: 'ja' })).status, 403);
  assert.equal(db.projects.length, n, 'nichts angelegt');
  // Unterlage nur intern, als Download
  const dl = await c.req(`/portal/anfragen/${A.id}/anlage`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /attachment/);
});

test('Übernahme als Standort durch Vertrieb Nord: Dublettenbestätigung, Kontakt, Projekt, Grundstück, Aufgabe; Standortakte', async () => {
  const c = await login('markus@demo.invalid');
  const csrf = await c.csrf(`/portal/anfragen/${A.id}`);
  const vorher = { p: db.projects.length, c: db.contacts.length, x: db.parcels.length, t: db.tasks.length };
  assert.equal((await c.form(`/portal/anfragen/${A.id}/standort`, { _csrf: csrf, name: 'Testdorf Ost', region: 'nord' })).status, 422, 'Dublettenprüfung muss bestätigt werden');
  assert.equal(db.projects.length, vorher.p);
  assert.equal((await c.form(`/portal/anfragen/${A.id}/standort`, { _csrf: csrf, name: 'Testdorf Ost', region: 'nord', dublettenGeprueft: 'ja' })).status, 303);
  const p = db.projects.at(-1);
  assert.equal(db.projects.length, vorher.p + 1);
  assert.equal(db.contacts.length, vorher.c + 1);
  assert.equal(db.parcels.length, vorher.x + 1);
  assert.equal(db.tasks.length, vorher.t + 1);
  assert.match(p.code, /^STK-N-\d{3}$/);
  assert.equal(p.phase, 1);
  assert.equal(p.spvId, null, 'keine Projektgesellschaft angelegt');
  assert.equal(p.source.inquiryId, A.id);
  assert.equal(A.status, 'als Standort übernommen');
  assert.equal(A.projectId, p.id);
  assert.equal(db.parcels.at(-1).areaHa, 3.5);
  assert.equal(db.tasks.at(-1).title, 'Termin vor Ort');
  assert.ok(!db.grants.some((g) => g.projectId === p.id), 'keine Rechtevergabe');
  assert.equal((await c.form(`/portal/anfragen/${A.id}/standort`, { _csrf: csrf, name: 'doppelt', region: 'nord', dublettenGeprueft: 'ja' })).status, 403, 'keine zweite Übernahme');
  // Standort erscheint für Vertrieb Nord (Region) und Administration mit Standortakte, ohne Rechteänderung
  const v = c;
  assert.equal((await (await login('admin@demo.invalid')).req(`/portal/projekte/${p.id}`)).status, 200);
  assert.match((await v.text('/portal/pipeline')).body, /Testdorf Ost/);
  const akte = (await v.text(`/portal/projekte/${p.id}`)).body;
  for (const s of ['Standortakte', 'Herkunft: ' + A.ref, 'Netzanschluss', 'Genehmigung', 'Vertrag / Option', 'Verantwortlich', 'Nächste Maßnahmen', 'Termin vor Ort', 'Entscheidungen und Freigaben', 'Aus Anfrage übernommen', 'noch keine – Gründung bei Projektreife']) assert.ok(akte.includes(s), s);
  // Investor sieht Standort und Akte nicht
  const inv = await login('investor.a@demo.invalid');
  assert.equal((await inv.req(`/portal/projekte/${p.id}`)).status, 404);
  const invAkte = (await inv.text('/portal/projekte/p-n01')).body;
  assert.ok(!invAkte.includes('Standortakte'), 'Akte nur intern');
  // Bestandsprojekte zeigen die Akte ebenfalls (ohne Herkunftsanfrage)
  assert.match((await v.text('/portal/projekte/p-n01')).body, /Standortakte[\s\S]*Flächensicherung unterzeichnet/);
});

test('Löschkonzept: nur Administration, nur abgeschlossene Anfragen; Angaben, Notizen und Unterlage entfernt', async () => {
  const pl = await login('projektleitung@demo.invalid');
  const csrfPl = await pl.csrf(`/portal/anfragen/${B.id}`);
  assert.equal((await pl.form(`/portal/anfragen/${B.id}/anonymisieren`, { _csrf: csrfPl })).status, 403, 'Projektleitung darf nicht löschen');
  const a = await login('admin@demo.invalid');
  const csrf = await a.csrf(`/portal/anfragen/${B.id}`);
  assert.equal((await a.form(`/portal/anfragen/${B.id}/anonymisieren`, { _csrf: csrf })).status, 403, 'offene Anfrage nicht löschbar');
  await a.form(`/portal/anfragen/${B.id}/bearbeiten`, { _csrf: csrf, status: 'nicht geeignet', note: 'Herr Zwei wünscht keinen Kontakt' });
  // zusätzliche Anfrage mit Datei, um die Dateilöschung zu prüfen
  assert.equal((await anfrage({ name: 'Mit Datei', email: 'datei@example.invalid', lage: 'Anderswo' }, true)).status, 303);
  const C = db.inquiries.at(-1);
  const datei = join(DIR, 'files', C.fileId);
  assert.ok(existsSync(datei));
  await a.form(`/portal/anfragen/${C.id}/bearbeiten`, { _csrf: csrf, status: 'abgeschlossen' });
  for (const x of [B, C]) assert.equal((await a.form(`/portal/anfragen/${x.id}/anonymisieren`, { _csrf: csrf })).status, 303);
  assert.ok(!existsSync(datei), 'Unterlage gelöscht');
  for (const x of [B, C]) {
    assert.ok(x.anonymisiert);
    assert.equal(x.name, 'gelöscht');
    assert.equal(x.email || x.phone || x.nachricht || x.flurstueck || '', '');
    assert.equal(x.fileId, null);
    assert.ok(x.ref, 'Kennung bleibt als Nachweis');
  }
  assert.ok(!JSON.stringify(B.log).includes('Herr Zwei'), 'Notiz entfernt');
  assert.ok(db.audit.some((e) => e.event === 'anfrage_anonymisiert' && e.anfrage === B.id));
  // A hat nach der Löschung von B keine Dublette mehr aus B
  const { dubletten } = await import('../src/portal/akquise.mjs');
  assert.ok(!dubletten(db, A).some((d) => d.id === B.id));
});

test('Öffentliche Seiten: Zielgruppen und nächster Schritt auf der Startseite, Eigentümerseite nach Konzept', async () => {
  const P = await import('../src/public/pages.mjs');
  const home = text(P.home());
  for (const s of ['Grundstückseigentümer', 'Gemeinden und Kreise', 'Investoren und Banken', 'Fläche prüfen lassen', 'eigene Projektgesellschaft']) assert.ok(home.includes(s), s);
  const own = text(P.eigentuemer());
  for (const s of ['Ihre Fläche kann mehr', 'Werden Sie Partner der Energiewende', 'Welche Flächen in Frage kommen', 'Worauf es bei der Lage ankommt', 'In fünf Schritten zum Projekt', 'Pacht- und Optionsmodell im Überblick', 'Wie hoch ist die Pacht?']) assert.ok(own.includes(s), s);
  assert.equal((String(P.eigentuemer()).match(/<ol class="owner-steps owner-steps-5">([\s\S]*?)<\/ol>/)[1].match(/<li>/g) || []).length, 5);
  assert.ok(!/Wer welches Risiko trägt/.test(own), 'Risikotabelle in FAQ und Schritte überführt');
  const unt = text(P.unternehmen());
  for (const s of ['Technische und kaufmännische Prüfung', 'Spezialisierte Fachpartner', 'Transparenz gegenüber Eigentümern', 'Projektgesellschaft']) assert.ok(unt.includes(s), s);
  for (const h of [home, own, unt]) assert.ok(!/garantiert|Referenzprojekt|\d+\s?(€|EUR)\s?(je|pro)\s?(ha|Hektar)/i.test(h));
});

test('Feinschliff K1–K4: Rückbau vertragskonform, Investitionsreife, Ansprechpartner Nord mit Formularzuordnung, Startseite', async () => {
  const P = await import('../src/public/pages.mjs');
  const own = text(P.eigentuemer()), home = text(P.home()), tech = text(P.technologie()), ent = text(P.standortentwicklung()), kon = text(P.kontakt({ region: 'nord' }));
  // K1: keine uneingeschränkte Rückbauzusage; Pflicht, Kosten und Sicherheit getrennt
  for (const t of [own, tech, ent]) assert.ok(!/vollständig zurückgebaut|Rückbau vor Baubeginn abgesichert|vertraglich abgesichert/.test(t));
  assert.match(own, /gesetzlichen und genehmigungsrechtlichen Vorgaben zurückgebaut/);
  assert.match(own, /Rückbaukosten tragen nach unserem Vertragsmodell nicht Sie/);
  assert.match(own, /soweit erforderlich/);
  // K2: keine starre Reihenfolge, Investitionsreife erklärt
  assert.ok(!/Erst wenn Netzanschluss, Genehmigung und Finanzierung stehen/.test(own));
  assert.match(own, /investitionsreif/);
  assert.match(own, /parallel erarbeitet/);
  assert.ok(!/erst, wenn Netzanschluss und Genehmigung gesichert sind/.test(ent));
  // K3: Markus als Ansprechpartner Nord, ohne erfundene Kontaktdaten
  assert.match(own, /Ansprechpartner für Norddeutschland: Markus/);
  assert.match(own, /Nachricht an Markus/);
  assert.match(kon, /Nachricht direkt an Markus/);
  assert.ok(!/tel:|mailto:markus/i.test(String(P.eigentuemer()) + String(P.kontakt({}))), 'keine erfundenen Kontaktdaten');
  // K4: Startseitenüberschrift
  assert.match(home, /Batteriespeicher an geeigneten Netzstandorten entwickeln\./);
  // Formularweg: Region Nord → Zuordnung an die (einzige) Vertriebskoordination Nord; ungültige Region verworfen
  const html = await (await fetch(base + '/kontakt?anliegen=eigentuemer&region=nord')).text();
  assert.match(html, /value="nord" selected/);
  const t = /name="_t" value="([^"]+)"/.exec(html)[1];
  await new Promise((r) => setTimeout(r, 1600));
  const send = (region) => fetch(base + '/kontakt', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _t: t, anliegen: 'eigentuemer', region, name: 'Test Nord', email: 'nord@example.invalid', nachricht: 'Bitte Rückruf', dsgvo: 'ja' }) });
  assert.equal((await send('nord')).status, 303);
  const i = db.inquiries.at(-1);
  assert.equal(i.region, 'nord');
  assert.equal(i.assignee, 'u-markus');
  assert.match(i.log[0].text, /Automatisch zugeordnet nach Region/);
  assert.equal((await send('<script>')).status, 303);
  assert.equal(db.inquiries.at(-1).region, '');
  assert.ok(!db.inquiries.at(-1).assignee);
});
