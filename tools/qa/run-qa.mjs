// Browser-QA (nicht Teil der Laufzeit): Viewports Desktop/Tablet/Smartphone, horizontaler Überlauf,
// axe-core-Barrierefreiheit, Tastaturbedienung, Screenshots. Nutzt lokal vorhandenes playwright-core und
// das installierte Microsoft Edge (Kanal "msedge") – es werden keine Browser heruntergeladen.
// Aufruf: QA_PLAYWRIGHT=<pfad zu playwright-core> QA_AXE=<pfad zu axe.min.js> node tools/qa/run-qa.mjs <ausgabeordner>
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.argv[2] || join(ROOT, 'qa-out');
mkdirSync(join(OUT, 'screens'), { recursive: true });
const pw = createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT);
const ENGINE = process.env.QA_ENGINE || 'chromium'; // chromium (Edge) | webkit | firefox
const { totp } = await import('../../src/lib/auth.mjs');

const DIR = mkdtempSync(join(tmpdir(), 'bess-qa-'));
execFileSync(process.execPath, [join(ROOT, 'data', 'seed.mjs'), DIR]);
const PORT = ENGINE === 'chromium' ? 4720 : 4725, base = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [join(ROOT, 'server.mjs')], { env: { ...process.env, BESS_PORT: String(PORT), BESS_DATA_DIR: DIR, BESS_PREVIEW_HELPERS: '1' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
const SEED = JSON.parse((await import('node:fs')).readFileSync(join(DIR, 'db.json'), 'utf8'));
const PW = 'Vorschau!Speicher-2026';

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, tablet_hoch: { width: 820, height: 1180 }, tablet_quer: { width: 1180, height: 820 }, smartphone: { width: 390, height: 844 } };
const PUBLIC = ['/', '/unternehmen', '/technologie', '/standortentwicklung', '/grundstueckseigentuemer', '/standort-anbieten', '/kommunen', '/investoren', '/projekte', '/kontakt', '/impressum', '/datenschutz'];
const result = { zeit: new Date().toISOString(), browser: ENGINE === 'chromium' ? 'Microsoft Edge (Chromium) via playwright-core' : `${ENGINE} (Playwright-Build) via playwright-core`, overflow: [], axe: [], keyboard: {}, portal: [] };

const browser = ENGINE === 'chromium' ? await pw.chromium.launch({ channel: 'msedge', headless: true }) : await pw[ENGINE].launch({ headless: true });
const name = (p) => (p === '/' ? 'start' : p.replace(/^\//, '').replace(/\//g, '_'));

async function axe(page, label) {
  await page.addScriptTag({ path: process.env.QA_AXE });
  const r = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] })).violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, beispiel: v.nodes[0]?.target?.join(' ') })));
  result.axe.push({ seite: label, verstoesse: r });
}

for (const [vp, size] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ viewport: size, bypassCSP: true, reducedMotion: 'reduce', locale: 'de-DE' });
  const page = await ctx.newPage();
  for (const p of PUBLIC) {
    await page.goto(base + p, { waitUntil: 'networkidle' });
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
    if (o.sw > o.w + 1) result.overflow.push({ viewport: vp, seite: p, ...o });
    if (vp === 'desktop' || vp === 'smartphone') await axe(page, `${vp} ${p}`);
    if (['/', '/grundstueckseigentuemer', '/standort-anbieten', '/unternehmen', '/standortentwicklung', '/kontakt'].includes(p)) await page.screenshot({ path: join(OUT, 'screens', `${vp}_${name(p)}.png`), fullPage: vp !== 'desktop' ? false : false });
  }
  await ctx.close();
}

// Tastatur: Skip-Link zuerst, sichtbarer Fokus, Menü per Tastatur auf Smartphone
{
  const ctx = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await ctx.newPage();
  await page.goto(base + '/grundstueckseigentuemer');
  const stops = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    stops.push(await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { el: e.tagName + (e.className ? '.' + String(e.className).split(' ')[0] : ''), text: (e.textContent || e.value || '').trim().slice(0, 40), fokusSichtbar: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 }; }));
  }
  result.keyboard.desktop = { ersterStopp: stops[0], alleSichtbar: stops.every((s) => s.fokusSichtbar), stopps: stops };
  await page.setViewportSize(VIEWPORTS.smartphone);
  await page.goto(base + '/');
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => document.activeElement.classList.contains('nav-toggle'))) break; }
  await page.keyboard.press('Enter');
  const open = await page.evaluate(() => document.getElementById('hauptnavigation').classList.contains('open'));
  await page.keyboard.press('Escape');
  const closed = await page.evaluate(() => !document.getElementById('hauptnavigation').classList.contains('open') && document.activeElement.classList.contains('nav-toggle'));
  result.keyboard.mobilMenue = { oeffnetMitEnter: open, schliesstMitEscape: closed };
  // Formular per Tastatur absenden, Fehlerzustand prüfen
  await page.goto(base + '/kontakt');
  await page.focus('#name'); await page.keyboard.type('Test');
  await page.waitForTimeout(1600);
  await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')]);
  result.keyboard.formularFehler = await page.evaluate(() => ({ alert: !!document.querySelector('[role=alert]'), ariaInvalid: document.querySelectorAll('[aria-invalid=true]').length }));
  await ctx.close();
}

// Portal je Rolle: Screenshots, axe, Überlauf
async function portal(email, pages, vp = 'desktop') {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[vp], bypassCSP: true, locale: 'de-DE' });
  const page = await ctx.newPage();
  await page.goto(base + '/portal/login');
  await page.fill('#email', email); await page.fill('#pw', PW); await page.click('button[type=submit]');
  await page.waitForLoadState('networkidle');
  if (page.url().endsWith('/portal/mfa')) {
    const u = SEED.users.find((x) => x.email === email);
    await page.fill('#code', totp(u.totp)); await page.click('button[type=submit]'); await page.waitForLoadState('networkidle');
  }
  for (const [p, label] of pages) {
    await page.goto(base + p, { waitUntil: 'networkidle' });
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
    if (o.sw > o.w + 1) result.overflow.push({ viewport: vp, seite: p, rolle: email, ...o });
    await axe(page, `${vp} ${email} ${p}`);
    await page.screenshot({ path: join(OUT, 'screens', `portal_${vp}_${label}.png`) });
    result.portal.push({ rolle: email, seite: p, status: 'ok' });
  }
  await ctx.close();
}
await portal('admin@demo.invalid', [['/portal', 'admin_uebersicht'], ['/portal/projekte/p-n01', 'admin_projekt'], ['/portal/freigaben', 'admin_freigaben'], ['/portal/admin', 'admin_verwaltung']]);
await portal('markus@demo.invalid', [['/portal', 'vertrieb-nord_uebersicht'], ['/portal/grundstuecke', 'vertrieb-nord_grundstuecke']]);
await portal('eigentuemer.a@demo.invalid', [['/portal', 'eigentuemer_uebersicht'], ['/portal/grundstuecke', 'eigentuemer_grundstuecke'], ['/portal/nachrichten', 'eigentuemer_nachrichten']], 'smartphone');
await portal('investor.a@demo.invalid', [['/portal', 'investor_uebersicht'], ['/portal/projekte/p-n01', 'investor_projekt'], ['/portal/dokumente', 'investor_datenraum']]);
await portal('gemeinde@demo.invalid', [['/portal/projekte/p-n01', 'kommune_projekt']], 'tablet_hoch');

await browser.close();
srv.kill();
rmSync(DIR, { recursive: true, force: true });
const ernst = result.axe.flatMap((a) => a.verstoesse.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({ seite: a.seite, ...v })));
result.zusammenfassung = { ueberlauf: result.overflow.length, axeSeiten: result.axe.length, axeErnstOderKritisch: ernst.length, axeGesamt: result.axe.reduce((n, a) => n + a.verstoesse.length, 0) };
writeFileSync(join(OUT, 'qa-ergebnis.json'), JSON.stringify(result, null, 1));
console.log(JSON.stringify({ ...result.zusammenfassung, keyboard: { ersterStopp: result.keyboard.desktop.ersterStopp, alleSichtbar: result.keyboard.desktop.alleSichtbar, ...result.keyboard.mobilMenue, ...result.keyboard.formularFehler }, ernst: ernst.slice(0, 25) }, null, 1));
