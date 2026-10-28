// Sicherung und Wiederherstellung des Laufzeitbestands (db.json, gate.json, files/).
// Sichern:        node tools/backup-runtime.mjs --runtime <dir> --backups <dir>
// Wiederherstellen (Server vorher stoppen): node tools/backup-runtime.mjs --runtime <dir> --backups <dir> --restore <sicherungsname>
// Auflisten:      node tools/backup-runtime.mjs --backups <dir> --list
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const runtime = arg('--runtime') && resolve(arg('--runtime'));
const backups = resolve(arg('--backups') || 'C:\\dev\\bess-preview\\backups');
const digest = (dir) => createHash('sha256').update(readFileSync(join(dir, 'db.json'))).digest('hex').slice(0, 16);

if (process.argv.includes('--list')) {
  for (const n of existsSync(backups) ? readdirSync(backups).sort() : []) console.log(n);
} else if (arg('--restore')) {
  const src = join(backups, arg('--restore'));
  if (!existsSync(join(src, 'db.json'))) { console.error(`Sicherung nicht gefunden: ${src}`); process.exit(2); }
  rmSync(runtime, { recursive: true, force: true });
  cpSync(src, runtime, { recursive: true });
  console.log(`Wiederhergestellt: ${src} → ${runtime} (db.json sha256:${digest(runtime)})`);
} else {
  const name = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const dst = join(backups, name);
  mkdirSync(backups, { recursive: true });
  cpSync(runtime, dst, { recursive: true });
  writeFileSync(join(dst, 'SICHERUNG.txt'), `Sicherung ${new Date().toISOString()} von ${runtime}\ndb.json sha256:${digest(dst)}\n`);
  console.log(name);
}
