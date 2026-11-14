// Lokale Sichtprüfung des Go-live-Kandidaten (AW-20261114-GE-CLAUDE-STROMKAI-GOLIVE-VORBEREITUNG-022).
// Startet den Server mit synthetischem Datenbestand in einem temporären Ordner (wird bei Bedarf neu erzeugt).
// Formulare bleiben wie in der Produktion aus. Aufruf: node tools/vorschau-lokal.mjs [port] [--mfa privilegiert] [--stufe abnahme]
// --mfa/--stufe: MFA-QA wie in der Produktion (S-1), mit eigenem Datenordner je Port
import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const opt = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
if (opt('--mfa')) process.env.BESS_MFA = opt('--mfa');
if (opt('--stufe')) process.env.BESS_STAGE = opt('--stufe');
const DATEN = join(tmpdir(), opt('--mfa') ? `bess-golive-vorschau-mfa-${process.argv[2] || '4723'}` : 'bess-golive-vorschau');
process.env.BESS_PORT = (/^\d+$/.test(process.argv[2] || '') && process.argv[2]) || process.env.BESS_PORT || '4722';
process.env.BESS_DATA_DIR = DATEN;
process.env.BESS_PREVIEW_HELPERS = '0';
delete process.env.BESS_FORMULARE;
if (!existsSync(DATEN) || readdirSync(DATEN).length === 0) execFileSync(process.execPath, [join(ROOT, 'data', 'seed.mjs'), DATEN], { stdio: 'inherit' });
const { openStore } = await import('../src/lib/store.mjs');
const { config } = await import('../src/config.mjs');
const { createApp } = await import('../server.mjs');
await openStore(config.dataDir);
createApp().listen(config.port, config.host, () => console.log(`Go-live-Kandidat (lokal, synthetisch) auf http://${config.host}:${config.port} · formulare=${config.formulare} · mfa=${config.mfa} · stufe=${config.stage}`));
