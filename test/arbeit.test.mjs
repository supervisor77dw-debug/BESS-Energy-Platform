// Operativer Arbeitsleitstand (AW-STROMKAI-20261031-CONSOLIDATION-ACQUISITION-020, Folgeauftrag UX/Workflow):
// End-to-End-Abläufe 1–8, Entdoppelung, ehrliche Outbox ohne Versand, rollenabhängige Navigation ohne Rechteausweitung,
// verständliche Kennzahl. Synthetische Testkonten aus data/seed.mjs. Aufruf: node --test test/arbeit.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = mkdtempSync(join(tmpdir(), 'bess-arbeit-'));
process.env.BESS_DATA_DIR = DIR;
process.env.BESS_PREVIEW_HELPERS = '0';
for (const k of ['BESS_MFA', 'BESS_SLA_ERSTKONTAKT_TAGE', 'BESS_MAIL_AKTIV', 'BESS_SMTP_HOST', 'BESS_MAIL_FROM']) delete process.env[k];
const PW = 'Vorschau!Speicher-2026';

let server, base, db, A;
before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'data', 'seed.mjs'), DIR]);
  const store = await import('../src/lib/store.mjs');
  await store.openStore(DIR);
  db = store.getDb();
  A = await import('../src/portal/arbeit.mjs');
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
  async text(path) { return (await this.req(path)).text(); }
  async form(path, fields) { return this.req(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() }); }
  async csrf(path = '/portal') { return /name="_csrf" value="([^"]+)"/.exec(await this.text(path))?.[1]; }
}
async function login(email) {
  const c = new Client();
  const t = /name="_t" value="([^"]+)"/.exec(await c.text('/portal/login'))[1];
  assert.equal((await c.form('/portal/anmelden', { _t: t, email, password: PW })).status, 303, email);
  return c;
}
const nav = (h) => /<nav class="rail"[\s\S]*?<\/nav>/.exec(h)?.[0] || '';
const navHrefs = (h) => [...nav(h).matchAll(/<a href="(\/portal[^"]*)"/g)].map((m) => m[1]).filter((x) => x !== '/portal' || true);
const bn = (userId) => db.benachrichtigungen.filter((n) => n.userId === userId);

async function anfrage(felder) {
  const html = await (await fetch(base + '/standort-anbieten')).text();
  const t = /name="_t" value="([^"]+)"/.exec(html)[1];
  await new Promise((r) => setTimeout(r, 1600));
  const f = new FormData();
  Object.entries({ _t: t, nutzung: 'Acker', umspannwerk: 'unter 1 km', dsgvo: 'ja', ...felder }).forEach(([k, v]) => f.set(k, v));
  assert.equal((await fetch(base + '/standort-anbieten', { method: 'POST', body: f, redirect: 'manual' })).status, 303);
  return db.inquiries.at(-1);
}

let I1, I2;
test('E2E 1: Eigentümeranfrage bis zur Mitarbeiterzuordnung (Kennung, Region, Zuständigkeit, nächste Aktion, Historie, Benachrichtigung)', async () => {
  I1 = await anfrage({ name: 'Arbeit Test Nord', email: 'nord1@example.invalid', lage: 'Nordort', region: 'nord' });
  assert.match(I1.ref, /^ANF-\d{4}-\d{4}$/);
  assert.equal(I1.region, 'nord');
  assert.equal(I1.assignee, 'u-markus');
  assert.equal(I1.status, 'neu');
  assert.equal(I1.nextAction, 'Anfrage prüfen und Erstkontakt aufnehmen');
  assert.equal(I1.followUp, undefined, 'kein SLA ohne Entscheidung');
  assert.match(I1.log.map((x) => x.text).join(' | '), /Eingang .* Status neu .* nächste Aktion/);
  assert.equal(bn('u-markus').filter((n) => n.ref === I1.id).length, 1);
  // Wiederholte Verarbeitung erzeugt nichts doppelt
  const vorher = { bn: db.benachrichtigungen.length, log: I1.log.length, ob: db.outbox.length };
  A.anfrageEingang(db, I1); A.anfrageEingang(db, I1);
  assert.deepEqual({ bn: db.benachrichtigungen.length, log: I1.log.length, ob: db.outbox.length }, vorher);
  // Ohne Region: keine Zuständigkeit, Zuordnungswarteschlange und Hinweis an die Administration
  I2 = await anfrage({ name: 'Arbeit Test Ohne Region', email: 'ohne@example.invalid', lage: 'Irgendwo' });
  assert.equal(I2.assignee, undefined);
  assert.match(I2.log.at(-1).text, /noch nicht zugewiesen/);
  assert.equal(bn('u-admin').filter((n) => n.ref === I2.id && n.art === 'anfrage_unzugewiesen').length, 1);
});

test('Outbox ehrlich: kein Versand ohne freigegebenen Versandweg; Konfiguration nur über Umgebung', async () => {
  const ob = db.outbox.filter((o) => o.benachrichtigungId === bn('u-markus').find((n) => n.ref === I1.id).id);
  assert.equal(ob.length, 1);
  assert.equal(ob[0].status, 'nicht_eingerichtet');
  assert.ok(!db.outbox.some((o) => o.status === 'versandt'));
  const mail = await import('../src/lib/mail.mjs');
  // Selbst mit gesetzten Variablen bleibt der Versandweg ohne Transport aus
  const env = { BESS_MAIL_AKTIV: '1', BESS_SMTP_HOST: 'smtp.example.invalid', BESS_MAIL_FROM: 'test@example.invalid' };
  assert.equal(mail.mailKonfig(env).aktiv, false);
  assert.deepEqual(await mail.outboxVerarbeiten(db), { verarbeitet: 0, grund: 'nicht_eingerichtet' });
  // Mit Transport (nur im Test): Versand, Fehler und Wiederholungen werden dokumentiert
  Object.assign(process.env, env);
  try {
    const t = { users: [{ id: 'x', email: 'empf@example.invalid', active: true }], outbox: [] };
    let fail = true;
    mail.registriereTransport(async () => { if (fail) throw new Error('SMTP 451'); return { messageId: 'm1' }; });
    mail.inOutbox(t, { id: 'n1', userId: 'x', text: 'Test', at: new Date(0).toISOString() });
    assert.equal(t.outbox[0].status, 'wartend');
    await mail.outboxVerarbeiten(t, new Date(1000));
    assert.equal(t.outbox[0].status, 'fehler'); assert.equal(t.outbox[0].versuche, 1); assert.match(t.outbox[0].letzterFehler, /451/);
    fail = false;
    await mail.outboxVerarbeiten(t, new Date(Date.now() + 864e5));
    assert.equal(t.outbox[0].status, 'versandt'); assert.equal(t.outbox[0].versuche, 2);
  } finally { mail.registriereTransport(null); for (const k of Object.keys(env)) delete process.env[k]; }
});

test('E2E 2: Benachrichtigung und persönliche Arbeitsübersicht (Vertrieb)', async () => {
  const m = await login('markus@demo.invalid');
  const home = await m.text('/portal');
  for (const s of ['Mein Arbeitsbereich', 'meine offenen Anfragen', 'überfällig', 'Neue Anfragen und Erstkontakte', 'Nicht zugewiesen (meine Region)', I1.ref, I2.ref]) assert.ok(home.includes(s), s);
  assert.match(home, /class="badge">\d+<\/span> neu/, 'ungelesene Hinweise im Kopf');
  assert.ok(!/Simulierter Handels-Deckungsbeitrag|Netto-DB/.test(home), 'keine Handelskennzahlen in der Vertriebsübersicht');
  const seite = await m.text('/portal/benachrichtigungen');
  assert.match(seite, new RegExp(`Neue Flächenanfrage ${I1.ref} ist Ihnen zugewiesen`));
  assert.match(seite, /Keine E-Mail versandt – Versandweg nicht eingerichtet/);
  assert.ok(!/E-Mail versandt<\//.test(seite.replace(/Keine E-Mail versandt/g, '')), 'kein Versandschein');
  await m.form('/portal/benachrichtigungen/gelesen', { _csrf: await m.csrf('/portal/benachrichtigungen') });
  assert.equal(A.ungeleseneBenachrichtigungen(db, { id: 'u-markus' }).length, 0);
});

test('E2E 3: Erstkontakt, Statusänderung und Wiedervorlage – historisiert, überfällig hervorgehoben, Zuweisung benachrichtigt', async () => {
  const m = await login('markus@demo.invalid');
  const csrf = await m.csrf(`/portal/anfragen/${I1.id}`);
  await m.form(`/portal/anfragen/${I1.id}/bearbeiten`, { _csrf: csrf, status: 'Gespräch vereinbart', assignee: 'u-markus', nextAction: 'Erstkontakt erfolgt – Ortstermin', followUp: '2020-02-02', note: 'Telefon' });
  assert.equal(I1.status, 'Gespräch vereinbart');
  assert.match(I1.log.at(-1).text, /Status neu → Gespräch vereinbart/);
  const home = await m.text('/portal');
  assert.match(home, /<span class="kpi-v bad">[1-9]/, 'Überfällig-Kennzahl hervorgehoben');
  assert.match(await m.text('/portal/anfragen?f=faellig'), new RegExp(I1.ref));
  // Zuweisung an eine andere Person benachrichtigt diese genau einmal
  await m.form(`/portal/anfragen/${I2.id}/bearbeiten`, { _csrf: csrf, status: 'in Prüfung', assignee: 'u-pl', nextAction: 'Netz prüfen', followUp: '' });
  await m.form(`/portal/anfragen/${I2.id}/bearbeiten`, { _csrf: csrf, status: 'in Prüfung', assignee: 'u-pl', nextAction: 'Netz prüfen', followUp: '' });
  assert.equal(bn('u-pl').filter((n) => n.ref === I2.id).length, 1);
  assert.match(await m.text('/portal/anfragen?f=meine'), new RegExp(I1.ref));
});

let PID;
test('E2E 4 und 5: Übernahme als Standort ohne Dubletten; Weiterbearbeitung in der Projektakte mit verknüpfter Aufgabe', async () => {
  const m = await login('markus@demo.invalid');
  const csrf = await m.csrf(`/portal/anfragen/${I1.id}`);
  const n = { p: db.projects.length, t: db.tasks.length };
  assert.equal((await m.form(`/portal/anfragen/${I1.id}/standort`, { _csrf: csrf, name: 'Nordort Akte', region: 'nord', dublettenGeprueft: 'ja' })).status, 303);
  assert.equal((await m.form(`/portal/anfragen/${I1.id}/standort`, { _csrf: csrf, name: 'Nordort Akte', region: 'nord', dublettenGeprueft: 'ja' })).status, 403);
  assert.equal(db.projects.length, n.p + 1, 'genau ein Standort');
  assert.equal(db.tasks.length, n.t + 1, 'genau eine Aufgabe');
  const t = db.tasks.at(-1);
  PID = t.projectId;
  assert.equal(t.inquiryId, I1.id);
  assert.equal(t.title, 'Erstkontakt erfolgt – Ortstermin');
  const auf = await m.text('/portal/aufgaben?f=meine');
  assert.match(auf, new RegExp(`aus ${I1.ref}`));
  assert.match(await m.text(`/portal/projekte/${PID}`), /Standortakte[\s\S]*Erstkontakt erfolgt – Ortstermin/);
  await m.form(`/portal/aufgaben/${t.id}/erledigt`, { _csrf: csrf });
  assert.equal(t.status, 'erledigt');
  assert.equal(t.log.at(-1).text, 'Erledigt');
  assert.equal(t.doneBy, 'u-markus');
});

test('E2E 6: Nachrichten im Portal – Benachrichtigung an die Zuständigen, ungelesen erkennbar, nach Ansicht gelesen', async () => {
  const o = await login('eigentuemer.a@demo.invalid');
  const csrf = await o.csrf('/portal/nachrichten');
  assert.equal((await o.form('/portal/nachrichten', { _csrf: csrf, t: 'p-n01:u-own-a', text: 'Frage zum Vermesser' })).status, 303);
  const msg = db.messages.at(-1);
  assert.equal(bn('u-markus').filter((n) => n.ref === msg.id).length, 1, 'Kontaktverantwortung benachrichtigt');
  assert.ok(!db.benachrichtigungen.some((n) => n.ref === msg.id && n.userId === 'u-own-a'), 'Absender nicht');
  const m = await login('markus@demo.invalid');
  const eintrag = (h) => /<a href="\/portal\/nachrichten\?t=p-n01%3Au-own-a"[\s\S]*?<\/a>/.exec(h)?.[0] || '';
  assert.match(eintrag(await m.text('/portal/nachrichten?t=p-n02%3Au-own-b')), /\d+ neu<\/span>/, 'ungelesen erkennbar, solange nicht geöffnet');
  await m.text('/portal/nachrichten?t=p-n01%3Au-own-a'); // Unterhaltung öffnen
  assert.ok(!/neu<\/span>/.test(eintrag(await m.text('/portal/nachrichten?t=p-n02%3Au-own-b'))), 'nach Ansicht gelesen');
  // Antwort benachrichtigt die externe Person
  await m.form('/portal/nachrichten', { _csrf: await m.csrf('/portal/nachrichten'), t: 'p-n01:u-own-a', text: 'Termin folgt' });
  assert.equal(bn('u-own-a').filter((n) => n.art === 'nachricht').length, 1);
});

test('E2E 7: Sichtbarkeit nach Rollen – Navigation gruppiert, keine Rechteausweitung, Eigentümer unverändert', async () => {
  const erwartet = {
    'markus@demo.invalid': { hat: ['/portal/anfragen', '/portal/pipeline', '/portal/kontakte', '/portal/grundstuecke', '/portal/aufgaben', '/portal/nachrichten', '/portal/wirtschaftlichkeit', '/portal/benachrichtigungen'], nicht: ['/portal/strommarkt', '/portal/admin', '/portal/admin/benutzer', '/portal/zentrale', '/portal/anlagenplanung'], gruppen: ['Vertrieb &amp; Akquise', 'Projektentwicklung', 'Wirtschaftlichkeit'] },
    'projektleitung@demo.invalid': { hat: ['/portal/projekte', '/portal/aufgaben', '/portal/anlagenplanung', '/portal/strommarkt', '/portal/freigaben'], nicht: ['/portal/admin', '/portal/zentrale', '/portal/admin/handelsdaten'], gruppen: ['Energiehandel &amp; Analyse'] },
    'admin@demo.invalid': { hat: ['/portal/zentrale', '/portal/admin/benutzer', '/portal/strommarkt', '/portal/admin/handelsdaten', '/portal/entwicklungsstand'], nicht: [], gruppen: ['Administration', 'Energiehandel &amp; Analyse'] },
  };
  for (const [email, e] of Object.entries(erwartet)) {
    const c = await login(email);
    const h = await c.text('/portal');
    const hrefs = navHrefs(h);
    for (const x of e.hat) assert.ok(hrefs.includes(x), `${email} sieht ${x}`);
    for (const x of e.nicht) assert.ok(!hrefs.includes(x), `${email} sieht nicht ${x}`);
    for (const g of e.gruppen) assert.ok(nav(h).includes(`>${g}</p>`), `${email}: Gruppe ${g}`);
    // jeder Menüpunkt ist für die Rolle tatsächlich erreichbar (Navigation = Rechte)
    for (const x of hrefs) assert.equal((await c.req(x)).status, 200, `${email} ${x}`);
    for (const x of e.nicht) assert.equal((await c.req(x)).status, 404, `${email} ${x} gesperrt`);
  }
  // Eigentümer: Navigation exakt wie vor AW-020
  const o = await login('eigentuemer.a@demo.invalid');
  assert.deepEqual(navHrefs(await o.text('/portal')), ['/portal', '/portal/projekte', '/portal/grundstuecke', '/portal/dokumente', '/portal/verguetung', '/portal/nachrichten', '/portal/konto']);
  for (const x of ['/portal/benachrichtigungen', '/portal/anfragen', '/portal/aufgaben']) assert.equal((await o.req(x)).status, x === '/portal/benachrichtigungen' ? 200 : 404, x);
  // Investor: keine internen Bereiche
  const inv = await login('investor.a@demo.invalid');
  assert.ok(!navHrefs(await inv.text('/portal')).some((x) => ['/portal/anfragen', '/portal/aufgaben', '/portal/benachrichtigungen'].includes(x)));
  // Projektleitung: Projektleitstand in der Übersicht
  const pl = await login('projektleitung@demo.invalid');
  assert.match(await pl.text('/portal'), /Projektleitstand[\s\S]*Netzanschluss[\s\S]*Genehmigung/);
});

test('E2E 8: Nicht zugewiesene Aufgaben – Pflichtzuständigkeit, Zuordnungswarteschlange, Zuweisung mit Historie und Benachrichtigung', async () => {
  const pl = await login('projektleitung@demo.invalid');
  const csrf = await pl.csrf('/portal/aufgaben');
  assert.equal((await pl.form('/portal/aufgaben/neu', { _csrf: csrf, projectId: 'p-n01', title: 'Ohne Zuständigkeit', due: '2020-03-03' })).status, 422, 'Zuständigkeit Pflicht');
  assert.equal((await pl.form('/portal/aufgaben/neu', { _csrf: csrf, projectId: 'p-s01', title: 'Fremdprojekt', due: '2026-12-01', assignee: 'u-pl' })).status, 422, 'nur eigene Projekte');
  assert.equal((await pl.form('/portal/aufgaben/neu', { _csrf: csrf, projectId: 'p-n01', title: 'Schallgutachten beauftragen', due: '2020-03-03', warteschlange: 'ja' })).status, 303);
  const t = db.tasks.at(-1);
  assert.equal(t.assignee, null); assert.equal(t.warteschlange, true);
  assert.equal(bn('u-admin').filter((n) => n.ref === t.id && n.art === 'aufgabe_unzugewiesen').length, 1);
  const q = await pl.text('/portal/aufgaben?f=unzugewiesen');
  assert.match(q, /Aufgabe\(n\) ohne Zuständigkeit/);
  assert.match(q, /Schallgutachten beauftragen[\s\S]*nicht zugewiesen/);
  assert.match(q, /überfällig/);
  assert.equal((await pl.form(`/portal/aufgaben/${t.id}/zuweisen`, { _csrf: csrf, assignee: 'u-inv-a' })).status, 422, 'nur interne Konten');
  assert.equal((await pl.form(`/portal/aufgaben/${t.id}/zuweisen`, { _csrf: csrf, assignee: 'u-markus' })).status, 303);
  assert.equal(t.assignee, 'u-markus');
  assert.match(t.log.map((x) => x.text).join(' | '), /Angelegt von .*Zuordnungswarteschlange.*Zuständig: Markus/);
  assert.equal(bn('u-markus').filter((n) => n.art === 'aufgabe_zugewiesen' && n.ref.startsWith(t.id)).length, 1);
  // Admin-Gesamtüberblick zeigt Verantwortlichkeiten und Anfragen nach Region/Status
  const a = await login('admin@demo.invalid');
  const z = await a.text('/portal/zentrale');
  for (const s of ['Gesamtüberblick Vertrieb und Projekte', 'Offene Aufgaben je Verantwortlichem', 'Ausstehende Freigaben', 'ohne Region', 'Mein Arbeitsbereich']) assert.ok(z.includes(s), s);
  // Externe Rollen: keine Aufgabenrouten
  const o = await login('eigentuemer.a@demo.invalid');
  assert.equal((await o.form('/portal/aufgaben/neu', { _csrf: await o.csrf('/portal'), projectId: 'p-n01', title: 'x', due: '2026-12-01', assignee: 'u-markus' })).status, 404);
});

test('Kennzahlen verständlich: Handelskennzahl erklärt, Berechnung unverändert, nur in der Zentrale', async () => {
  const a = await login('admin@demo.invalid');
  const z = await a.text('/portal/zentrale');
  assert.ok(!/B2 Netto-DB 15\/30 \(24 M\.\)<\/span>/.test(z), 'Kurzbezeichnung nicht mehr als Beschriftung');
  assert.match(z, /Simulierter Handels-Deckungsbeitrag je MW Leistung und Jahr/);
  assert.match(z, /Netto-Arbitrage-Deckungsbeitrag = Brutto-Handelssaldo minus variable Kosten/);
  assert.match(z, /Rollierend 24 Monate|rollierend 24 Monate/);
  assert.match(z, /\d+ T€<\/span>/);
});
