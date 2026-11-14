// S-2 Erstübernahme in der Produktionslaufzeit (AW-20261114-GE-CLAUDE-STROMKAI-GOLIVE-VORBEREITUNG-022).
// Durchgespielt wie in Vercel, aber mit einer Datei-Attrappe des Blob-Speichers und Platzhalter-Tokens:
//  1. bisherige Produktion schreibt ihren Bestand in den alten Store (dazu QA- und Wurzelobjekte als Altbestand)
//  2. lokale Sicherung mit Manifest (wie tools/blob-sicherung.mjs)
//  3. neue Produktion startet mit eigenem Store + BESS_MIGRATION_QUELLE → übernimmt, prüft, liefert aus
// Nachweise: Anzahl, Prüfsummen, Altbestand byte-gleich, QA-/Wurzelobjekte nicht übernommen, Neustart idempotent,
// Abbruch bei verändertem Altbestand, fremden Objekten oder falscher Umgebung. Aufruf: node --test test/erstuebernahme.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = mkdtempSync(join(tmpdir(), 'bess-erstuebernahme-'));
const ATTRAPPE = pathToFileURL(join(ROOT, 'test', 'helpers', 'blob-datei-attrappe.mjs')).href;
const tok = (id) => ['vercel', 'blob', 'rw', id, 'platzhalterOhneGeheimnis'].join('_');
const ALT = 'A8KSoIBxmYMplN9S', NEU = 'NEUPRODTEST00001';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const walk = (d, pre = '') => existsSync(d) ? readdirSync(d).flatMap((n) => statSync(join(d, n)).isDirectory() ? walk(join(d, n), pre + n + '/') : [pre + n]) : [];
const abbild = (id) => Object.fromEntries(walk(join(DIR, id)).map((p) => [p, sha(readFileSync(join(DIR, id, p)))]));
let ACCOUNTS, MANIFEST;

// Startet die Anwendung wie eine Vercel-Funktion in einem eigenen Prozess und ruft Pfade ab
function laufzeit(env, pfade = ['/', '/portal/login']) {
  const skript = join(DIR, 'lauf.mjs');
  writeFileSync(skript, "import { createServer } from 'node:http';"
    + ` const { vercelHandler } = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'server.mjs')).href)});`
    + " const s = createServer((q, r) => vercelHandler(q, r).catch((e) => { console.log('FEHLER ' + e.message); if (!r.headersSent) { r.statusCode = 503; r.end(); } }));"
    + " await new Promise((ok) => s.listen(0, '127.0.0.1', ok)); const out = [];"
    + ` for (const p of ${JSON.stringify(pfade)}) out.push((await fetch('http://127.0.0.1:' + s.address().port + p, { redirect: 'manual' })).status);`
    + " console.log('STATUS ' + out.join(',')); s.close();");
  return execFileSync(process.execPath, ['--import', ATTRAPPE, skript], {
    cwd: ROOT, encoding: 'utf8',
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ATTRAPPE_DIR: DIR, VERCEL: '1', VERCEL_ENV: 'production', BESS_STAGE: 'abnahme', BESS_GATE: '0', BESS_ACCOUNTS: ACCOUNTS, ...env },
  });
}
const NEU_ENV = () => ({ BLOB_READ_WRITE_TOKEN: tok(NEU), BESS_PRODUKTIONSSPEICHER: `store_${NEU}`, BESS_MIGRATION_QUELLE: tok(ALT), BESS_MIGRATION_MANIFEST: MANIFEST });

before(async () => {
  const { hashPassword } = await import('../src/lib/auth.mjs');
  ACCOUNTS = JSON.stringify({ users: [{ id: 'u-admin', email: 'admin@test.invalid', pw: hashPassword('Platzhalter!Kennwort-1'), mustChangePassword: false }] });
  // 1. bisherige Produktion (gemeinsamer Store) legt ihren Bestand an
  assert.match(laufzeit({ BLOB_READ_WRITE_TOKEN: tok(ALT) }), /STATUS 200,200/);
  for (const [p, t] of [['qa-020/state/db.json', '{"qa":1}'], ['state/db.json', '{"wurzel":1}'], ['files/alt.pdf', '%PDF-alt']]) { mkdirSync(dirname(join(DIR, ALT, p)), { recursive: true }); writeFileSync(join(DIR, ALT, p), t); }
  // 2. lokale Sicherung des Bereichs abnahme/ und Manifest für die Produktionsvariable
  process.env.ATTRAPPE_DIR = DIR;
  await import(ATTRAPPE); // Attrappe auch im Testprozess (für die Sicherung)
  const B = await import('../tools/blob-sicherung.mjs');
  await B.sichern({ sdk: globalThis.__bessBlobSdk, token: tok(ALT), prefix: 'abnahme/', ziel: join(DIR, 'sicherung') });
  MANIFEST = execFileSync(process.execPath, [join(ROOT, 'tools', 'blob-sicherung.mjs'), 'manifest-env', '--quelle', join(DIR, 'sicherung')], { encoding: 'utf8' });
});
after(() => rmSync(DIR, { recursive: true, force: true }));

test('Erstübernahme: neue Produktion übernimmt genau den gesicherten Bestand, Altbestand bleibt byte-gleich', () => {
  const altVorher = abbild(ALT);
  const m = JSON.parse(MANIFEST);
  assert.ok(m.eintraege.length >= 2 && m.eintraege.every((e) => e.pfad.startsWith('abnahme/')));
  assert.doesNotMatch(MANIFEST, /vercel_blob_rw|platzhalterOhneGeheimnis/, 'Manifest ohne Token');
  const out = laufzeit(NEU_ENV());
  assert.match(out, /Erstübernahme [0-9a-f]{16}: \d+ Objekte geprüft, \d+ neu angelegt/);
  assert.match(out, /STATUS 200,200/, 'Website und Portal-Anmeldung liefern aus dem neuen Store');
  assert.doesNotMatch(out, /vercel_blob_rw|platzhalterOhneGeheimnis/, 'kein Token in der Ausgabe');
  const neu = abbild(NEU);
  for (const e of m.eintraege) if (!e.pfad.endsWith('state/db.json')) assert.equal(neu[e.pfad], e.sha256, `Prüfsumme ${e.pfad}`);
  assert.ok(Object.keys(neu).some((p) => /^abnahme\/\.erstuebernahme-[0-9a-f]{16}\.json$/.test(p)), 'Abschlussmarker');
  assert.ok(!Object.keys(neu).some((p) => p.startsWith('qa-020/') || !p.startsWith('abnahme/')), 'QA- und Wurzelobjekte nicht übernommen');
  assert.deepEqual(abbild(ALT), altVorher, 'bisheriger Store unverändert (inkl. qa-020/ und Wurzel)');
  // Wiederherstellung: Anwendung öffnet den übernommenen Zustand mit denselben Konten
  const db = JSON.parse(readFileSync(join(DIR, NEU, 'abnahme', 'state', 'db.json'), 'utf8'));
  const dbAlt = JSON.parse(readFileSync(join(DIR, 'sicherung', 'daten', 'abnahme', 'state', 'db.json'), 'utf8'));
  assert.deepEqual(db.users.map((u) => [u.id, u.active, u.role]), dbAlt.users.map((u) => [u.id, u.active, u.role]));
});

test('Erstübernahme: Neustart ist idempotent, nichts wird überschrieben', () => {
  const vorher = abbild(NEU), altVorher = abbild(ALT);
  const out = laufzeit(NEU_ENV());
  assert.match(out, /bereits abgeschlossen/); assert.match(out, /STATUS 200,200/);
  assert.deepEqual(Object.keys(abbild(NEU)).sort(), Object.keys(vorher).sort());
  assert.deepEqual(abbild(ALT), altVorher);
});

test('Erstübernahme: Abbruch (fail closed) bei verändertem Altbestand, fremden Objekten und falscher Umgebung', () => {
  const ZWEI = 'NEUPRODTEST00002';
  const env2 = { ...NEU_ENV(), BLOB_READ_WRITE_TOKEN: tok(ZWEI), BESS_PRODUKTIONSSPEICHER: `store_${ZWEI}` };
  // Altbestand seit der Sicherung verändert
  const datei = join(DIR, ALT, 'abnahme', 'state', 'db.json'); const original = readFileSync(datei);
  writeFileSync(datei, Buffer.concat([original, Buffer.from(' ')]));
  try {
    const out = laufzeit(env2, ['/']);
    assert.match(out, /Altbestand weicht von der geprüften Sicherung ab/); assert.match(out, /STATUS 503/);
    assert.ok(!Object.keys(abbild(ZWEI)).some((p) => p.includes('.erstuebernahme-')), 'kein Abschlussmarker');
  } finally { writeFileSync(datei, original); }
  // fremdes Objekt im Ziel
  mkdirSync(join(DIR, 'NEUPRODTEST00003', 'abnahme'), { recursive: true }); writeFileSync(join(DIR, 'NEUPRODTEST00003', 'abnahme', 'fremd.json'), '{}');
  assert.match(laufzeit({ ...env2, BLOB_READ_WRITE_TOKEN: tok('NEUPRODTEST00003'), BESS_PRODUKTIONSSPEICHER: 'store_NEUPRODTEST00003' }, ['/']), /fremde Objekte[\s\S]*STATUS 503/);
  // Ziel = gemeinsamer Store bzw. Quelle ≠ gemeinsamer Store
  assert.match(laufzeit({ ...NEU_ENV(), BLOB_READ_WRITE_TOKEN: tok(ALT), BESS_PRODUKTIONSSPEICHER: `store_${ALT}` }, ['/']), /STATUS 503/);
  assert.match(laufzeit({ ...NEU_ENV(), BESS_MIGRATION_QUELLE: tok('ANDERERSTORE001') }, ['/']), /nicht der bisherige gemeinsame Store[\s\S]*STATUS 503/);
});

test('Erstübernahme: in Vorschau/Entwicklung nie, und Go-live bleibt gesperrt, solange der Migrationszugang gesetzt ist', async () => {
  const { erstuebernahme } = await import('../src/lib/erstuebernahme.mjs');
  assert.deepEqual(await erstuebernahme({ sdk: {}, env: {}, stage: 'abnahme' }), { status: 'aus' });
  await assert.rejects(erstuebernahme({ sdk: {}, env: { BESS_MIGRATION_QUELLE: tok(ALT), VERCEL_ENV: 'preview' }, stage: 'qa' }), /nur im Vercel-Production-Ziel/);
  const { goLiveSperren } = await import('../src/config.mjs');
  assert.ok(goLiveSperren(undefined, { BESS_MIGRATION_QUELLE: 'x' }, 'abnahme', 'privilegiert').some((s) => /Migrationszugang/.test(s)));
});
