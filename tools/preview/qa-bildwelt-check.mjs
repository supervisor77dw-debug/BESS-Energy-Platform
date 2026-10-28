// Prüft auf der geschützten QA-Vorschau: neue Texte, Bildwelt-Dateien (Typ, Caching), alle öffentlichen Seiten.
// Nutzt den Vercel-Freigabelink (BESS_SHARE_URL) und die Prüferkennung „dirk“ der Vorschau-Schranke; gibt keine Zugangsdaten aus.
// Aufruf: BESS_SHARE_URL=… node tools/preview/qa-bildwelt-check.mjs <basis-url> <ZUGAENGE_…txt>
import { readFileSync } from 'node:fs';
const base = process.argv[2].replace(/\/$/, ''), txt = readFileSync(process.argv[3], 'utf8');
const gate = Object.fromEntries([...txt.matchAll(/Prüferkennung: (\w+)\s+Passwort: (\S+)/g)].map((m) => [m[1], m[2]]));
const jar = {};
async function req(p, o = {}) {
  const r = await fetch(p.startsWith('http') ? p : base + p, { redirect: 'manual', ...o, headers: { ...(o.headers || {}), cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) jar[k] = v; else delete jar[k]; }
  return r;
}
const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'OK  ' : 'FEHL'} ${n}${d ? ' – ' + d : ''}`); };
await req(process.env.BESS_SHARE_URL);
const [, gb] = await req('/_vorschau/anmelden').then(async (r) => [r, await r.text()]);
const t = /name="_t" value="([^"]+)"/.exec(gb)?.[1];
const g = await req('/_vorschau/anmelden', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _t: t, user: 'dirk', password: gate.dirk }).toString() });
check('Vorschau-Schranke', g.status === 303);
const h = await req('/'); const html = await h.text();
check('Startseite mit neuem Text', h.status === 200 && /Batteriespeicher dort entwickeln/.test(html));
check('Hero-Visualisierung mit Kennzeichnung', /hero-photo/.test(html) && /Visualisierung einer Beispielanlage/.test(html));
const imgs = [...new Set([...html.matchAll(/\/static\/img\/v2\/[^" ,]+/g)].map((m) => m[0]))];
let ok = 0, kb = 0, cc = '';
for (const u of imgs) { const r = await req(u); const b = await r.arrayBuffer(); cc = r.headers.get('cache-control'); if (r.status === 200 && /image\/(avif|webp)/.test(r.headers.get('content-type'))) { ok++; kb += b.byteLength / 1024; } }
check(`Bilddateien Startseite ${ok}/${imgs.length}`, imgs.length > 0 && ok === imgs.length, `alle Varianten zusammen ${kb.toFixed(0)} KB, Cache-Control: ${cc}`);
for (const p of ['/unternehmen', '/technologie', '/standortentwicklung', '/grundstueckseigentuemer', '/standort-anbieten', '/investoren', '/kommunen', '/projekte', '/kontakt', '/impressum', '/datenschutz']) {
  const r = await req(p); const b = await r.text();
  check(`${p}`, r.status === 200 && /noindex/.test(b), p === '/projekte' || p === '/kontakt' || p === '/standort-anbieten' || p === '/impressum' || p === '/datenschutz' ? '' : (/tag-vis/.test(b) ? 'mit Visualisierungen' : 'ohne Bild'));
}
check('Portal weiterhin nur mit Anmeldung', (await req('/portal')).headers.get('location')?.startsWith('/portal/login'));
console.log(`\nErgebnis: ${res.filter(Boolean).length}/${res.length}`);
