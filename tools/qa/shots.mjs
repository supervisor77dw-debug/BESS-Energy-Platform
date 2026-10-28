// Seitenaufnahmen öffentlicher Seiten für Vorher-nachher-Vergleich und Layoutprüfung (Desktop, Tablet, Smartphone).
// Misst zusätzlich horizontalen Überlauf, Bildgewicht und Ladezeit je Seite.
// Aufruf: QA_PLAYWRIGHT=<pfad zu playwright-core> node tools/qa/shots.mjs <basis-url> <ausgabeordner> [--full]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, out] = process.argv.slice(2);
const full = process.argv.includes('--full');
mkdirSync(out, { recursive: true });
const pw = createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT);
const VIEW = { desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, smartphone: { width: 390, height: 844 } };
const PAGES = ['/', '/unternehmen', '/technologie', '/standortentwicklung', '/grundstueckseigentuemer', '/investoren', '/kommunen', '/projekte', '/kontakt', '/standort-anbieten', '/impressum', '/datenschutz'];
const browser = await pw.chromium.launch({ channel: 'msedge' });
const report = [];
for (const [vn, vp] of Object.entries(VIEW)) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: vn === 'smartphone' ? 2 : 1, isMobile: vn === 'smartphone' });
  const page = await ctx.newPage();
  for (const p of PAGES) {
    const t0 = Date.now();
    await page.goto(base + p, { waitUntil: 'load' });
    if (full) { await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); }); await page.waitForLoadState('networkidle'); }
    const ms = Date.now() - t0;
    const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1, h: document.body.scrollHeight, bytes: performance.getEntriesByType('resource').filter((e) => /\.(avif|webp|png|jpe?g|svg)(\?|$)/.test(e.name)).reduce((a, e) => a + (e.encodedBodySize || 0), 0), imgs: [...document.images].filter((i) => i.currentSrc.includes('/v2/')).map((i) => i.currentSrc.split('/').pop()) }));
    const name = `${vn}${p === '/' ? '_start' : p.replace(/\//g, '_')}`;
    await page.screenshot({ path: join(out, `${name}.png`), fullPage: full });
    report.push({ ansicht: vn, seite: p, ladezeitMs: ms, bildKB: Math.round(m.bytes / 1024), ueberlauf: m.overflow, bilder: m.imgs });
  }
  await ctx.close();
}
await browser.close();
writeFileSync(join(out, 'messwerte.json'), JSON.stringify(report, null, 1));
console.log(report.map((r) => `${r.ansicht.padEnd(10)} ${r.seite.padEnd(26)} ${String(r.ladezeitMs).padStart(5)} ms ${String(r.bildKB).padStart(6)} KB${r.ueberlauf ? '  ÜBERLAUF' : ''}`).join('\n'));
