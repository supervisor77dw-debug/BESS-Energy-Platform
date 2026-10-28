// Lädt die CC0-Assets der Bildwelt 2.0 von Poly Haven (https://polyhaven.com, Lizenz CC0) nach C:\dev\bess-assets.
// Freigabe: Nutzer 2026-10-28, bis 500 MB, keine kostenpflichtigen Dienste. Assets werden nicht ins Repository übernommen.
// Schreibt ASSETS.json (Name, Typ, Lizenz, Veröffentlichung, Dateien mit URL, Größe, MD5) als Lizenz- und Quellennachweis.
// Aufruf: node tools/render/fetch-assets.mjs [--out C:\dev\bess-assets]
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'C:\\dev\\bess-assets';
const LIMIT = 480 * 1024 * 1024;
const ASSETS = {
  hdris: ['kloofendal_48d_partly_cloudy_puresky', 'belfast_sunset_puresky', 'autumn_field_puresky'],
  textures: ['container_side', 'corrugated_iron_02', 'rocky_gravel', 'gravel_floor_02', 'aerial_grass_rock', 'dirt_aerial_02', 'clean_asphalt', 'metal_plate', 'red_brick_03', 'roof_tiles', 'concrete_floor_02'],
  models: ['tree_small_02', 'grass_medium_01'],
};
const MAPS = ['Diffuse', 'nor_gl', 'Rough', 'Displacement', 'Metal', 'arm'];
const api = async (p) => { const r = await fetch(`https://api.polyhaven.com${p}`, { headers: { 'User-Agent': 'BESS-Bildwelt/1.0 (CC0 asset fetch)' } }); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); };

let total = 0; const log = [];
async function get(url, dest) {
  if (existsSync(dest)) { total += statSync(dest).size; return statSync(dest).size; }
  const head = await fetch(url, { method: 'HEAD' }); const size = Number(head.headers.get('content-length') || 0);
  if (total + size > LIMIT) throw new Error(`Grenze erreicht vor ${basename(dest)}`);
  const r = await fetch(url); const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(dest, buf); total += buf.length; return buf.length;
}
for (const [type, ids] of Object.entries(ASSETS)) {
  for (const id of ids) {
    let info, files;
    try { info = await api(`/info/${id}`); files = await api(`/files/${id}`); } catch (e) { console.warn('übersprungen', id, e.message); continue; }
    const dir = join(OUT, type, id); mkdirSync(dir, { recursive: true });
    const picked = [];
    if (type === 'hdris') picked.push(files.hdri['4k'].hdr);
    else if (type === 'textures') for (const m of MAPS) { const f = files[m]?.['2k']?.jpg || files[m]?.['2k']?.png; if (f) picked.push(f); }
    else { const g = files.gltf?.['2k']?.gltf; if (g) { picked.push(g); for (const inc of Object.values(g.include || {})) picked.push({ ...inc, rel: true }); } }
    const rec = { id, name: info.name, type, license: 'CC0 1.0 (Poly Haven)', source: `https://polyhaven.com/a/${id}`, published: new Date(info.date_published * 1000).toISOString().slice(0, 10), authors: info.authors, files: [] };
    for (const f of picked) {
      const rel = f.rel ? f.url.split(`/${id}/`).pop() : basename(f.url);
      const dest = join(dir, f.rel ? rel.split('/').slice(-2).join('/') : rel);
      mkdirSync(join(dest, '..'), { recursive: true });
      const size = await get(f.url, dest);
      rec.files.push({ file: dest.slice(OUT.length + 1), url: f.url, size, md5: f.md5 });
    }
    log.push(rec); console.log(`${type}/${id}: ${rec.files.length} Dateien, gesamt ${(total / 1048576).toFixed(0)} MB`);
  }
}
writeFileSync(join(OUT, 'ASSETS.json'), JSON.stringify({ geladen: new Date().toISOString(), gesamtBytes: total, assets: log }, null, 1));
console.log('fertig', (total / 1048576).toFixed(0), 'MB');
