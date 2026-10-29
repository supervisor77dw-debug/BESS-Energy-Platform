// Prüft den öffentlichen Abnahmekandidaten ohne Anmeldung: Übernahme von Texten und Bildwelt 2.0 (V1.3),
// alle Bilddateien (Desktop und Mobil), Kennzeichnungen, Rechtstexte als Entwurf, keine QA-Spuren.
// Aufruf: node tools/preview/verify-oeffentlich-v13.mjs --url https://bess-energy-platform.vercel.app
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const base = arg('--url').replace(/\/$/, '');
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'OK  ' : 'FEHL'} ${n}${d ? ' – ' + d : ''}`); };
const get = (p) => fetch(base + p, { redirect: 'manual' });
const PAGES = ['/', '/unternehmen', '/technologie', '/standortentwicklung', '/grundstueckseigentuemer', '/standort-anbieten', '/investoren', '/kommunen', '/projekte', '/kontakt', '/impressum', '/datenschutz'];
const MIT_BILD = new Set(['/', '/unternehmen', '/technologie', '/standortentwicklung', '/grundstueckseigentuemer', '/investoren', '/kommunen']);
const html = {};
for (const p of PAGES) {
  const r = await get(p); const b = await r.text(); html[p] = b;
  const ok = r.status === 200 && /noindex/.test(b) && /Vorläufiger Abnahmekandidat/.test(b) && /href="\/portal\/login"/.test(b) && !/bess-vorschau\.invalid|demo\.invalid|Interne QA-Vorschau|_vorschau\/anmelden/.test(b);
  check(`Seite ${p}: 200, noindex, vorläufig gekennzeichnet, Login, keine QA-Spuren`, ok, `Status ${r.status}`);
  if (MIT_BILD.has(p)) check(`Seite ${p}: Visualisierungen gekennzeichnet`, (b.match(/class="tag-vis"/g) || []).length >= 1 && !/<figure class="photo[^"]*">(?:(?!Visualisierung)[\s\S])*?<\/figure>/.test(b));
}
const T = (p) => html[p].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
check('Text V1.3: Startseite neu', /Batteriespeicher dort entwickeln, wo das Netz sie braucht/.test(T('/')));
check('Text V1.3: Wahlrecht beim Projektentwickler', /entscheidet der Projektentwickler/.test(T('/grundstueckseigentuemer')));
check('Text V1.3: Vorkaufsrecht, vier Wochen Frist, Arbeitsstand', /Vorkaufsrecht/.test(T('/grundstueckseigentuemer')) && /vier Wochen Frist/.test(T('/grundstueckseigentuemer')) && /Arbeitsstand, Änderungen vorbehalten/.test(T('/grundstueckseigentuemer')));
check('Text V1.3: Investoren – Projektrisiken', /Projektrisiken, die wir offen benennen/.test(T('/investoren')));
check('Text V1.3: Kommunen – Notstrom nur als Option', /nicht als Standardleistung/.test(T('/kommunen')));
check('Text V1.3: UL 9540A als Prüfverfahren', /Prüfverfahren UL 9540A/.test(T('/technologie')) && /keine Zertifizierung der gesamten Anlage/.test(T('/technologie')));
check('Rechtstexte als Entwurf gekennzeichnet', /Entwurf/.test(T('/impressum')) && /Entwurf/.test(T('/datenschutz')));
check('Hero mit Visualisierungshinweis', /hero-photo/.test(html['/']) && /Visualisierung einer Beispielanlage/.test(html['/']));
const mr = await get('/static/img/v2/manifest.json'); const m = await mr.json();
const files = [];
for (const [k, v] of Object.entries(m)) if (!k.startsWith('_')) for (const kind of ['d', 'm']) for (const w of v[kind]) for (const ext of ['avif', 'webp']) files.push(`/static/img/v2/${k}-${kind}-${w}.${ext}?v=${m._v}`);
let ok = 0, kb = 0, cc = '', mobil = 0;
for (const f of files) { const r = await get(f); const b = await r.arrayBuffer(); cc = r.headers.get('cache-control'); if (r.status === 200 && /image\/(avif|webp)/.test(r.headers.get('content-type'))) { ok++; kb += b.byteLength / 1024; if (f.includes('-m-')) mobil++; } }
check(`Bildwelt: ${ok}/${files.length} Dateien (davon ${mobil} Mobilvarianten), 8 Motive`, ok === files.length && Object.keys(m).filter((k) => !k.startsWith('_')).length === 8, `${kb.toFixed(0)} KB gesamt, Cache-Control: ${cc}`);
const refs = [...new Set(Object.values(html).flatMap((b) => [...b.matchAll(/\/static\/img\/v2\/[^" ,?]+/g)].map((x) => x[0])))];
check(`alle in den Seiten referenzierten Bilder vorhanden (${refs.length})`, refs.every((r) => files.some((f) => f.startsWith(r))));
check('Portal ohne Anmeldung → Login', (await get('/portal')).headers.get('location') === '/portal/login');
check('Dokument ohne Anmeldung → Login', (await get('/portal/dokumente/d-n01-own-a-vertrag/download')).headers.get('location') === '/portal/login');
check('keine öffentliche JSON-API', (await get('/api/projekte')).status === 404);
console.log(`\nErgebnis: ${results.filter(Boolean).length}/${results.length}`);
process.exit(results.every(Boolean) ? 0 : 1);
