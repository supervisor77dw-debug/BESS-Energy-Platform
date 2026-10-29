// Zentrale Administrationsoberfläche (AW-STROMKAI-20261029-ADMIN-DASHBOARD-INTEGRATION-015): alle Kacheln aufrufbar,
// Netzentgelt-Szenarien und Shadow-Trading aus den geprüften Exporten, Rechte und Mandantentrennung, keine Handelsfunktion.
// Aufruf: node --test test/zentrale.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = mkdtempSync(join(tmpdir(), 'bess-ze-'));
process.env.BESS_DATA_DIR = DIR;
process.env.BESS_PREVIEW_HELPERS = '0';
delete process.env.BESS_MFA;
const PW = 'Vorschau!Speicher-2026';

let server, base;
before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'data', 'seed.mjs'), DIR]);
  const store = await import('../src/lib/store.mjs');
  await store.openStore(DIR);
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
    const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    return res;
  }
  async text(path) { const r = await this.req(path); return { r, body: await r.text() }; }
  async login(email) { const { body } = await this.text('/portal/login'); return this.req('/portal/anmelden', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _t: /name="_t" value="([^"]+)"/.exec(body)[1], email, password: PW }).toString() }); }
}
const ent = (s) => s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
const eurGanz = (x) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(x);
const txt = (b) => ent(b).replace(/<[^>]+>/g, ' ').replace(/ | /g, ' ').replace(/\s+/g, ' ');
const sessions = {};
const als = async (email) => { if (!sessions[email]) { sessions[email] = new Client(); await sessions[email].login(email); } return sessions[email]; };

test('Administration landet nach der Anmeldung in der Zentrale', async () => {
  const c = new Client(); const r = await c.login('admin@demo.invalid');
  assert.equal(r.headers.get('location'), '/portal/zentrale');
  const { r: z, body } = await c.text('/portal/zentrale');
  assert.equal(z.status, 200);
  assert.match(body, /href="\/portal\/zentrale"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/portal\/zentrale"/, 'Zentrale in der Navigation markiert');
});

test('Zentrale: alle 10 Bereiche vorhanden und jede Kachel tatsächlich aufrufbar (200)', async () => {
  const a = await als('admin@demo.invalid');
  const { body } = await a.text('/portal/zentrale');
  const kacheln = [...body.matchAll(/<a class="modul" href="([^"]+)"><span class="modul-kopf"><strong>([^<]+)<\/strong>/g)].map((m) => [ent(m[1]), ent(m[2])]);
  for (const t of ['Projekte & Projektgesellschaften', 'Wirtschaftlichkeitsrechner', 'Strommarkt', 'Backtesting', 'KI-Handelsanalyse', 'Netzentgelt-Szenarien', 'Eigentümer & Vergütungen', 'Shadow-Trading', 'Benutzer & Berechtigungen', 'Entwicklungsstand'])
    assert.ok(kacheln.some(([, x]) => x === t), `Kachel ${t}`);
  for (const [href, t] of kacheln) assert.equal((await a.req(href)).status, 200, `${t} → ${href}`);
  assert.match(txt(body), /Keine realen Handelsaufträge/);
});

test('Netzentgelt-Szenarien: Werte entsprechen dem geprüften Export; Anlagen- und Zeitraumwechsel', async () => {
  const erg = JSON.parse(readFileSync(join(ROOT, 'src', 'strommarkt-daten', 'ergebnisse.json'), 'utf8'));
  const a = await als('admin@demo.invalid');
  for (const [anlage, periode] of [['Simulationsanlage 15 MW / 30 MWh', 'R24M'], ['Simulationsanlage 10 MW / 20 MWh', 'KJ2025']]) {
    const { r, body } = await a.text(`/portal/netzentgelt?anlage=${encodeURIComponent(anlage)}&periode=${periode}`);
    assert.equal(r.status, 200);
    const t = txt(body);
    for (const v of ['befreit', 'ohne_befreiung']) {
      const row = erg.ergebnisse.find((x) => x.anlage === anlage && x.periode === periode && x.netzvariante === v && x.strategie === 'B2');
      assert.ok(t.includes(eurGanz(row.summen.netto_arbitrage_db_eur).replace(/ /g, ' ')), `${anlage} ${periode} ${v}`);
    }
    assert.match(t, /Befreiung ist nicht gesichert/);
  }
  const { body } = await a.text('/portal/netzentgelt?anlage=<script>&periode=x');
  assert.doesNotMatch(body, /<script>/, 'ungültige Auswahl fällt auf Standard zurück');
});

test('Shadow-Trading: letzter Lauf, Plan mit virtuellen Käufen/Verkäufen, Risiko, keine Handelsfunktion', async () => {
  const sh = JSON.parse(readFileSync(join(ROOT, 'src', 'strommarkt-daten', 'shadow.json'), 'utf8'));
  assert.equal(createHash('sha256').update(readFileSync(join(ROOT, 'src', 'strommarkt-daten', 'shadow.json'))).digest('hex'), readFileSync(join(ROOT, 'src', 'strommarkt-daten', 'shadow.sha256'), 'utf8').trim());
  const a = await als('admin@demo.invalid');
  const { r, body } = await a.text('/portal/shadow-trading');
  assert.equal(r.status, 200);
  const t = txt(body);
  const p = sh.plaene.at(-1);
  assert.match(t, new RegExp(`Plan für Liefertag ${p.liefertag.split('-').reverse().join('.')}`));
  assert.doesNotMatch(t, /Kostenplan|Schoenberg|Schönberg/, 'neutrale Anlagenbezeichnung');
  assert.ok(t.includes(new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(p.strategien.B2.kauf_mwh)), 'virtuelle Käufe B2');
  assert.match(t, /Keine realen Handelsaufträge, kein Börsenzugang/);
  assert.match(t, /Verstöße 0/);
  const posts = [...body.matchAll(/<form[^>]+method="post"[^>]*action="([^"]+)"/gi)].map((m) => m[1]).filter((x) => x !== '/portal/abmelden');
  assert.deepEqual(posts, [], 'keine absendbaren Aktionen außer Abmelden');
  assert.equal((await a.req('/portal/shadow-trading', { method: 'POST' })).status, 405);
});

test('Entwicklungsstand: Module mit Status und offene Prüfpunkte, nur Administration', async () => {
  const a = await als('admin@demo.invalid');
  const t = txt((await a.text('/portal/entwicklungsstand')).body);
  for (const s of ['KLÄRUNGSBEDARF', 'Fixe Betriebskosten', 'K1–K8', 'B2 bleibt Referenz', 'GESPERRT']) assert.ok(t.includes(s), s);
  assert.doesNotMatch(t, /136\.000|408\.000|Schönberg|Schoenberg/, 'keine Projektzahlen in der Vorschau');
  assert.equal((await (await als('projektleitung@demo.invalid')).req('/portal/entwicklungsstand')).status, 404);
});

test('Rechte: Projektleitung sieht Trading-Bereiche, aber nicht die Zentrale; Eigentümer, Investor, Vertrieb sehen nichts davon', async () => {
  const pl = await als('projektleitung@demo.invalid');
  for (const p of ['/portal/netzentgelt', '/portal/shadow-trading', '/portal/strommarkt']) assert.equal((await pl.req(p)).status, 200, p);
  assert.equal((await pl.req('/portal/zentrale')).status, 404);
  for (const email of ['eigentuemer.a@demo.invalid', 'investor.a@demo.invalid', 'markus@demo.invalid']) {
    const c = await als(email);
    for (const p of ['/portal/zentrale', '/portal/netzentgelt', '/portal/shadow-trading', '/portal/entwicklungsstand', '/portal/strommarkt']) assert.equal((await c.req(p)).status, 404, `${email} ${p}`);
    const nav = (await c.text('/portal')).body;
    assert.doesNotMatch(nav, /Shadow-Trading|Netzentgelt-Szenarien|Strommarkt|Zentrale/, `${email}: keine internen Menüpunkte`);
  }
});

test('ohne Anmeldung: alle neuen Bereiche geschützt', async () => {
  for (const p of ['/portal/zentrale', '/portal/netzentgelt', '/portal/shadow-trading', '/portal/entwicklungsstand']) {
    const r = await new Client().req(p);
    assert.equal(r.headers.get('location'), '/portal/login', p);
  }
});
