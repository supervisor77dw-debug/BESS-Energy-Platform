// Bildwelt 2.0: bereitet die Blender-Renderings (PNG, 16 bit) für die Website auf.
//  - Desktop-Zuschnitt 16:9 in mehreren Breiten, Mobilzuschnitt 4:5 um einen Bildschwerpunkt
//  - AVIF und WebP, ohne Metadaten; static/img/v2/manifest.json für das Layout
//  - Motiv „planung“ erhält eine Planüberlagerung (Entwicklungsfläche, Betriebsfläche, Zufahrt, Kabeltrasse)
// Aufruf: node tools/render/export-bildwelt.mjs <ordner-mit-png> [--sharp <pfad-zu-sharp>]
//         node tools/render/export-bildwelt.mjs --leitstand <ausgabe.png>   (Bildschirminhalt für Motiv „betrieb“)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const require = createRequire(import.meta.url);
const sharp = require(arg('--sharp', process.env.BESS_SHARP || 'sharp'));

// Motive: Bildschwerpunkt (x %, y %) für Mobilzuschnitt und object-position, Breiten
export const MOTIVE = {
  hero: { focus: [62, 58], d: [960, 1440, 1920, 2560], m: [480, 720, 1080] },
  feld: { focus: [48, 55], d: [640, 960, 1280, 1920, 2560], m: [480, 720, 1080] },
  modul: { focus: [55, 55], d: [640, 960, 1280, 1920, 2560], m: [480, 720, 1080] },
  netz: { focus: [50, 55], d: [640, 960, 1280, 1920, 2560], m: [480, 720, 1080] },
  planung: { focus: [55, 50], d: [640, 960, 1280, 1920, 2560], m: [480, 720, 1080] },
  investor: { focus: [52, 55], d: [640, 960, 1280, 1920, 2560], m: [480, 720, 1080] },
  kommune: { focus: [52, 50], d: [640, 960, 1280, 1920, 2560], m: [480, 720, 1080] },
  betrieb: { focus: [50, 50], d: [640, 960, 1280, 1920, 2560], m: [480, 720, 1080] },
};

// Planüberlagerung im Koordinatensystem des Renderings (3200 × 1800, Ortho-Kamera, 5,714 px je Meter, Mitte x = −60 m)
function planOverlay(W, H) {
  const k = W / 560, cx = W / 2, cy = H / 2, X = (x) => cx + (x + 60) * k, Y = (y) => cy - y * k;
  const rect = (x0, y0, x1, y1) => `${X(x0)},${Y(y0)} ${X(x1)},${Y(y0)} ${X(x1)},${Y(y1)} ${X(x0)},${Y(y1)}`;
  const fs = Math.round(W / 95);
  const label = (x, y, t, anchor = 'start') => `<g font-family="Segoe UI, Arial, sans-serif" font-size="${fs}" font-weight="600">
    <text x="${X(x)}" y="${Y(y)}" text-anchor="${anchor}" fill="none" stroke="#0c1a18" stroke-width="${fs / 4}" stroke-linejoin="round" opacity=".55">${t}</text>
    <text x="${X(x)}" y="${Y(y)}" text-anchor="${anchor}" fill="#ffffff">${t}</text></g>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <polygon points="${rect(-95, -92, 100, 92)}" fill="rgba(217,162,122,.10)" stroke="#f1c7a5" stroke-width="${W / 700}" stroke-dasharray="${W / 120} ${W / 220}"/>
  <polygon points="${rect(-50, -48, 50, 50)}" fill="rgba(255,255,255,.16)" stroke="#ffffff" stroke-width="${W / 520}"/>
  <polyline points="${X(-50)},${Y(10)} ${X(-118)},${Y(10)} ${X(-118)},${Y(60)} ${X(-155)},${Y(60)}" fill="none" stroke="#9fd6ce" stroke-width="${W / 520}" stroke-dasharray="${W / 90} ${W / 260}"/>
  <polyline points="${X(10)},${Y(-48)} ${X(10)},${Y(-125)} ${X(128)},${Y(-125)}" fill="none" stroke="#ffffff" stroke-width="${W / 700}" opacity=".8"/>
  ${label(-90, 82, 'Entwicklungsfläche (Option)')}
  ${label(-44, 40, 'Betriebsfläche (Planung)')}
  ${label(-150, 72, 'Kabeltrasse zum Umspannwerk', 'start')}
  ${label(16, -112, 'Zufahrt')}
  ${label(-190, 102, 'Umspannwerk', 'middle')}
</svg>`);
}

async function leitstand(out) {
  const svg = readFileSync(join(ROOT, 'static', 'img', 'monitoring.svg'));
  const full = await sharp(svg, { density: 300 }).resize(3200).png().toBuffer();
  const { width: fw, height: fh } = await sharp(full).metadata();
  // links: Kennzahlen und Verlauf vergrößert, Mitte: Gesamtansicht, rechts: Ereignisse und Sicherheit vergrößert
  const part = (l, t, w, h) => sharp(full).extract({ left: l, top: t, width: w, height: h }).resize(1600, 920, { fit: 'cover' }).png().toBuffer();
  const [a, b, c] = await Promise.all([
    part(0, 0, Math.round(fw * 0.62), Math.round(fh * 0.8)),
    sharp(full).resize(1600, 920, { fit: 'cover' }).png().toBuffer(),
    part(Math.round(fw * 0.5), Math.round(fh * 0.08), Math.round(fw * 0.5), Math.round(fh * 0.66))]);
  await sharp({ create: { width: 4800, height: 920, channels: 3, background: '#0b1514' } })
    .composite([{ input: a, left: 0, top: 0 }, { input: b, left: 1600, top: 0 }, { input: c, left: 3200, top: 0 }])
    .png().toFile(out);
  console.log('Leitstand-Textur:', out);
}

async function run(dir) {
  const OUT = join(ROOT, 'static', 'img', 'v2'); mkdirSync(OUT, { recursive: true });
  const manifest = {};
  for (const [key, cfg] of Object.entries(MOTIVE)) {
    const src = join(dir, `${key}.png`);
    if (!existsSync(src)) { console.warn('fehlt:', src); continue; }
    let base = sharp(src).toColourspace('srgb');
    const meta = await sharp(src).metadata();
    let buf = await base.png().toBuffer();
    if (key === 'planung') buf = await sharp(buf).composite([{ input: planOverlay(meta.width, meta.height) }]).png().toBuffer();
    const W = meta.width, H = Math.round(W * 9 / 16);
    const top = Math.max(0, Math.round((meta.height - H) / 2));
    const d16 = await sharp(buf).extract({ left: 0, top, width: W, height: Math.min(H, meta.height) }).png().toBuffer();
    for (const w of cfg.d) {
      const img = sharp(d16).resize(w);
      await img.clone().avif({ quality: 52, effort: 6 }).toFile(join(OUT, `${key}-d-${w}.avif`));
      await img.clone().webp({ quality: 74, effort: 6 }).toFile(join(OUT, `${key}-d-${w}.webp`));
    }
    // Mobil 4:5 um den Bildschwerpunkt
    const mh = meta.height, mw = Math.round(mh * 4 / 5);
    const ml = Math.min(Math.max(0, Math.round(W * cfg.focus[0] / 100 - mw / 2)), W - mw);
    const m45 = await sharp(buf).extract({ left: ml, top: 0, width: mw, height: mh }).png().toBuffer();
    for (const w of cfg.m) {
      const img = sharp(m45).resize(w);
      await img.clone().avif({ quality: 50, effort: 6 }).toFile(join(OUT, `${key}-m-${w}.avif`));
      await img.clone().webp({ quality: 72, effort: 6 }).toFile(join(OUT, `${key}-m-${w}.webp`));
    }
    if (key === 'hero') await sharp(d16).resize(1200, 630, { fit: 'cover', position: 'attention' }).jpeg({ quality: 80, mozjpeg: true }).toFile(join(OUT, 'og-hero.jpg'));
    manifest[key] = { w: 1600, h: 900, focus: cfg.focus, d: cfg.d, m: cfg.m };
    console.log('exportiert:', key);
  }
  manifest._v = Date.now().toString(36);
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
}

if (process.argv.includes('--leitstand')) await leitstand(arg('--leitstand'));
else await run(process.argv[2]);
