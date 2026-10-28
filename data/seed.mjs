// Schreibt den synthetischen Datenbestand in einen lokalen Ordner (Entwicklung, Tests, Tailscale-Vorschau).
// Aufruf: node data/seed.mjs [zielordner]   (Standard: data/runtime)
// Lokale Demo-Konten nutzen DEMO_PASSWORD (seed-lib.mjs); BESS_SEED_EXTERNAL=1 erzeugt Zufallspasswörter → BESS_SEED_CREDS.
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeed } from './seed-lib.mjs';
export { DEMO_PASSWORD } from './seed-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(process.argv[2] || join(here, 'runtime'));
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, 'files'), { recursive: true });
const { db, files, creds } = buildSeed({ external: process.env.BESS_SEED_EXTERNAL === '1' });
for (const f of files) writeFileSync(join(dir, 'files', f.name), f.data);
writeFileSync(join(dir, 'db.json'), JSON.stringify(db, null, 1));
if (process.env.BESS_SEED_EXTERNAL === '1') writeFileSync(process.env.BESS_SEED_CREDS, JSON.stringify(creds, null, 1), { mode: 0o600 });
console.log(`Synthetischer Datenbestand geschrieben: ${dir} (${db.users.length} Konten, ${db.projects.length} Projekte, ${db.documents.length} Dokumente)`);
