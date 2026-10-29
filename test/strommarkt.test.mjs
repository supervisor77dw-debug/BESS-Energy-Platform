// Portalmodul „Strommarkt & Backtesting“: Rechte, Mandantentrennung, Inhalte, Tagesauswahl, Integrität (AW-20261029-GE-CLAUDE-STROMKAI-STUFE2-013).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = mkdtempSync(join(tmpdir(), 'bess-sm-'));
process.env.BESS_DATA_DIR = DIR;
process.env.BESS_PREVIEW_HELPERS = '0';
delete process.env.BESS_MFA;
const PW = 'Vorschau!Speicher-2026';
let server, base;
const K = {};
before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'data', 'seed.mjs'), DIR]);
  const store = await import('../src/lib/store.mjs');
  await store.openStore(DIR);
  const { createApp } = await import('../server.mjs');
  server = createApp();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, e] of Object.entries({ admin: 'admin', pl: 'projektleitung', markus: 'markus', invA: 'investor.a', ownA: 'eigentuemer.a', gemeinde: 'gemeinde', technik: 'technik' })) K[k] = await new C().login(`${e}@demo.invalid`);
});
after(() => { server?.close(); rmSync(DIR, { recursive: true, force: true }); });

class C {
  constructor() { this.cookie = ''; }
  async req(path, opts = {}) { const r = await fetch(base + path, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(this.cookie ? { cookie: this.cookie } : {}) } }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; return r; }
  async text(p) { const r = await this.req(p); return { r, body: await r.text() }; }
  form(p, f) { const q = new URLSearchParams(f); return this.req(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: q.toString() }); }
  async login(email) { const { body } = await this.text('/portal/login'); await this.form('/portal/anmelden', { _t: /name="_t" value="([^"]+)"/.exec(body)[1], email, password: PW }); return this; }
}

test('Zugriff nur für Administration und Projektleitung; alle anderen Rollen 404, ohne Anmeldung Umleitung', async () => {
  for (const k of ['admin', 'pl']) assert.equal((await K[k].req('/portal/strommarkt')).status, 200, k);
  for (const k of ['invA', 'ownA', 'markus', 'gemeinde', 'technik']) assert.equal((await K[k].req('/portal/strommarkt')).status, 404, k);
  const anon = await new C().req('/portal/strommarkt');
  assert.ok([302, 303].includes(anon.status));
  assert.match(anon.headers.get('location'), /\/portal\/login/);
});

test('Navigation zeigt das Modul nur berechtigten Rollen', async () => {
  assert.match((await K.admin.text('/portal')).body, /href="\/portal\/strommarkt"/);
  for (const k of ['invA', 'ownA', 'markus']) assert.doesNotMatch((await K[k].text('/portal/projekte')).body, /\/portal\/strommarkt/, k);
});

test('Alle Bereiche rendern mit Pflichtinhalten und Kennzeichnungen', async () => {
  const pflicht = {
    uebersicht: ['Referenzmodell B2', 'KI-Strategie C_gbm', 'nicht handelbar|Zukunftswissen', 'kein Gewinn'],
    markt: ['Datenversion', 'dv-', 'Bundesnetzagentur', 'CC BY 4.0', 'Produktumstellung'],
    preise: ['Historische Strompreise', 'Tagesprofil', 'Stunden mit negativem Preis', '<svg'],
    tag: ['Lade- und Entladefahrplan', 'Speicherfüllstand', 'Gekauft MWh', 'Verkauft MWh', 'Handelskosten', 'Tagesergebnis'],
    vergleich: ['Theoretisches Optimum', 'Zukunftswissen', 'Referenzmodell', 'KI · out-of-sample', 'nicht vollständig echtzeitgetreu'],
    ergebnisse: ['Monatsergebnisse', 'Erlöse und Handelskosten', 'Börse und Clearing', 'Netto-Arbitrage-DB'],
    groessen: ['Anlagengrößen im Vergleich', 'Simulationen, keine geplanten Projektgrößen', '20 MW / 80 MWh'],
    modelle: ['Prognosequalität', 'Modellversionen', 'Walk-forward', 'Baseline'],
  };
  for (const [b, muster] of Object.entries(pflicht)) {
    const { r, body } = await K.admin.text(`/portal/strommarkt?b=${b}`);
    assert.equal(r.status, 200, b);
    for (const m of muster) assert.match(body, new RegExp(m), `${b}: ${m}`);
    assert.doesNotMatch(body, /<script/i, `${b}: kein Skript`);
  }
});

test('Handelstag: anderer Tag zeigt andere Simulation; Zeitumstellung; unbekannter Tag', async () => {
  const a = (await K.admin.text('/portal/strommarkt?b=tag&tag=2025-06-15')).body;
  const b = (await K.admin.text('/portal/strommarkt?b=tag&tag=2025-01-15')).body;
  const ergebnis = (s) => /Tagesergebnis \(Netto-DB\)[\s\S]*?<\/table>/.exec(s)[0];
  assert.notEqual(ergebnis(a), ergebnis(b));
  const herbst = (await K.admin.text('/portal/strommarkt?b=tag&tag=2025-10-26')).body;   // 100 Viertelstunden
  assert.match(herbst, /Preis und Prognosen · 2025-10-26/);
  const fehlt = (await K.admin.text('/portal/strommarkt?b=tag&tag=2030-01-01')).body;
  assert.match(fehlt, /keine Simulation vor/);
});

test('Eingaben werden escaped; ungültiger Bereich fällt auf Übersicht zurück', async () => {
  const { body } = await K.admin.text('/portal/strommarkt?b=%22%3E%3Cscript%3Ealert(1)%3C/script%3E&anlage=%3Cimg%20src=x%3E&tag=%3Cx%3E');
  assert.doesNotMatch(body, /<script>alert|<img src=x>/);
  assert.match(body, /aria-current="page">Übersicht/);
});

test('Keine Projekt-, Standort- oder Finanzdaten im Modul (Vorschauregel)', async () => {
  for (const b of ['uebersicht', 'markt', 'vergleich', 'ergebnisse', 'groessen']) {
    const { body } = await K.admin.text(`/portal/strommarkt?b=${b}`);
    assert.doesNotMatch(body, /Schoenberg|Schönberg|Kostenplan|Kostenmodell|CAPEX|Projektgesellschaft/i, b);
  }
});

test('Datendateien: Prüfsummen stimmen, nicht öffentlich ausgeliefert, nur GET', async () => {
  const dir = join(ROOT, 'src', 'strommarkt-daten');
  const sums = JSON.parse(readFileSync(join(dir, 'SHA256SUMS.json'), 'utf8'));
  for (const [n, h] of Object.entries(sums)) assert.equal(createHash('sha256').update(readFileSync(join(dir, n))).digest('hex'), h, n);
  for (const p of ['/static/../src/strommarkt-daten/meta.json', '/src/strommarkt-daten/meta.json', '/strommarkt-daten/meta.json']) {
    const r = await new C().req(p);
    assert.notEqual(r.status, 200, p);
  }
  assert.equal((await K.admin.req('/portal/strommarkt', { method: 'POST' })).status, 405);
});
