// Abnahmeprüfung des ÖFFENTLICHEN Abnahmekandidaten (Testszenarien 1–5 aus AW-20261028-GE-CLAUDE-BESS-PUBLIC-PORTAL-005).
// Liest die Zugangsdatei nur im Speicher; gibt keine Passwörter oder MFA-Geheimnisse aus.
// Achtung: Erstanmeldung von Dirk und Markus (MFA + Testpasswort). Danach Konten neu provisionieren
// (tools/provision-vercel.mjs --stage abnahme + Deployment), damit beide ihren Zugang selbst einrichten.
// Aufruf: node tools/preview/verify-abnahme.mjs --url https://… --zugaenge <ZUGAENGE_STROMKAI-Abnahme_…txt>
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { totp } from '../../src/lib/auth.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const base = arg('--url').replace(/\/$/, '');
const txt = readFileSync(arg('--zugaenge'), 'utf8');
const acc = [...txt.matchAll(/Benutzername \(E-Mail-Feld\):\s+(\S+)\s+Startpasswort \(einmalig\):\s+(\S+)/g)].map((m) => ({ email: m[1], pw: m[2] }));
const dirk = acc.find((a) => a.email.startsWith('dirk@')), markus = acc.find((a) => a.email.startsWith('markus@'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'FEHL'} ${name}${detail ? ' – ' + detail : ''}`); };

class C {
  jar = {};
  async req(p, o = {}) {
    const r = await fetch(base + p, { redirect: 'manual', ...o, headers: { ...(o.headers || {}), cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) this.jar[k] = v; else delete this.jar[k]; }
    return r;
  }
  form(p, f) { return this.req(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(f).toString() }); }
  async text(p) { const r = await this.req(p); return [r, await r.text()]; }
}
const tok = (b, k) => new RegExp(`name="${k}" value="([^"]+)"`).exec(b)?.[1];

// ---- Test 1 + 5: nicht angemeldeter Besucher (ohne Vercel-Anmeldung, ohne Freigabelink) ----
const PUBLIC = ['/', '/unternehmen', '/technologie', '/standortentwicklung', '/grundstueckseigentuemer', '/standort-anbieten', '/investoren', '/kommunen', '/projekte', '/kontakt', '/impressum', '/datenschutz'];
const SECRETS = ['Demo-Standort', 'Musterkreis', 'DEMO-N0', 'Speicherprojekt Nord', 'CAPEX', 'Eigentümer A', 'Investor A', 'Demo-Gemarkung', 'scrypt$', 'sessionKey', 'Vorschau!Speicher', '.invalid', 'BLOB_READ_WRITE', 'BESS_ACCOUNTS', 'vercel_blob_rw'];
const anon = new C();
const links = new Set();
for (const p of PUBLIC) {
  const [r, body] = await anon.text(p);
  const leaks = SECRETS.filter((s) => body.includes(s));
  check(`öffentlich ${p}`, r.status === 200 && !leaks.length && /noindex/.test(r.headers.get('x-robots-tag') || '') && /Login \/ Partnerportal/.test(body), `Status ${r.status}${leaks.length ? ' Leck: ' + leaks.join(',') : ''}`);
  for (const m of body.matchAll(/(?:href|src)="(\/[^"#?]*)"/g)) links.add(m[1]);
}
const assets = [...links].filter((l) => l.startsWith('/static/'));
let assetOk = 0; for (const a of assets) if ((await anon.req(a)).status === 200) assetOk++;
check(`öffentliche Bilder/CSS/JS ohne Anmeldung (${assets.length})`, assetOk === assets.length && assets.length >= 10, `${assetOk}/${assets.length}`);
const pages = [...links].filter((l) => !l.startsWith('/static/') && !l.startsWith('/portal'));
let navOk = 0; for (const l of pages) if ((await anon.req(l)).status === 200) navOk++;
check(`öffentliche Navigation: alle internen Links erreichbar (${pages.length})`, navOk === pages.length, `${navOk}/${pages.length}`);
const [lr, lb] = await anon.text('/portal/login');
check('Login-Seite erreichbar, ohne Demo-Zugänge', lr.status === 200 && !/Demo-Zugänge|Passwort für alle|\.invalid/.test(lb));
check('HTTPS mit HSTS', base.startsWith('https://') && /max-age/.test(lr.headers.get('strict-transport-security') || ''));

// ---- Test 4: unberechtigte Direktzugriffe ----
for (const p of ['/portal', '/portal/admin', '/portal/protokoll', '/portal/projekte/p-n01', '/portal/grundstuecke', '/portal/dokumente', '/portal/dokumente/d-n01-inv-fin/download', '/portal/dokumente/d-n01-own-a-vertrag/download', '/portal/dokumente/d-n01-fin-intern/download', '/portal/nachrichten', '/portal/kontakte']) {
  const r = await anon.req(p);
  check(`ohne Anmeldung abgewiesen ${p}`, r.status === 303 && r.headers.get('location') === '/portal/login', `Status ${r.status}`);
}
for (const [p, f] of [['/portal/admin/zugriff', { userId: 'u-inv-a', projectId: 'p-n02' }], ['/portal/admin/passwort-neu', { userId: 'u-admin' }], ['/portal/admin/konto', { name: 'x', email: 'x@y.de', role: 'investor' }], ['/portal/freigaben/ap-1/entscheiden', { decision: 'genehmigt' }]]) {
  const r = await anon.form(p, f); const t = await r.text();
  check(`Verwaltungs-Aktion ohne Anmeldung abgewiesen ${p}`, [303, 403].includes(r.status) && !/Einmalpasswort|angelegt/.test(t), `Status ${r.status}`);
}
check('keine öffentliche JSON-API', (await anon.req('/api/projekte')).status === 404);

// ---- Test 2/3: Dirk und Markus über die reguläre Login-Seite ----
async function person(label, a, expect, expectLanding) {
  const c = new C();
  const [, home] = await c.text('/');
  check(`${label}: öffentliche Website ohne Anmeldung, Login-Menüpunkt vorhanden`, /href="\/portal\/login"/.test(home));
  const [, lp] = await c.text('/portal/login');
  const r1 = await c.form('/portal/anmelden', { _t: tok(lp, '_t'), email: a.email, password: a.pw });
  check(`${label}: Benutzername + Startpasswort → MFA`, r1.headers.get('location') === '/portal/mfa', `→ ${r1.headers.get('location')}`);
  const [, mb] = await c.text('/portal/mfa');
  const secret = /<code>([A-Z2-7 ]+)<\/code>/.exec(mb)?.[1]?.replace(/ /g, '');
  check(`${label}: MFA-Ersteinrichtung mit QR-Code`, !!secret && /data:image\/gif;base64/.test(mb));
  check(`${label}: falscher MFA-Code abgelehnt`, (await c.form('/portal/mfa', { _csrf: tok(mb, '_csrf'), code: '000000' })).status === 401);
  const r2 = await c.form('/portal/mfa', { _csrf: tok(mb, '_csrf'), code: secret ? totp(secret) : '000000' });
  check(`${label}: MFA bestätigt → eigenes Passwort festlegen`, r2.headers.get('location') === '/portal/passwort');
  const [, pp] = await c.text('/portal/passwort');
  const neu = `Test-${randomBytes(9).toString('base64url')}`;
  const r3 = await c.form('/portal/passwort', { _csrf: tok(pp, '_csrf'), current: a.pw, neu, neu2: neu });
  check(`${label}: eigenes Passwort gesetzt → Startbereich`, r3.headers.get('location') === expectLanding, `→ ${r3.headers.get('location')}`);
  for (const [p, st] of expect) { const r = await c.req(p); check(`${label}: ${p} → ${st}`, r.status === st, `Status ${r.status}`); }
  const [, pb] = await c.text(expectLanding);
  const sid = c.jar.bess_sid;
  await c.form('/portal/abmelden', { _csrf: tok(pb, '_csrf') });
  const after = await fetch(base + '/portal', { redirect: 'manual', headers: { cookie: `bess_sid=${sid}` } });
  check(`${label}: Abmeldung serverseitig wirksam`, after.headers.get('location') === '/portal/login');
}
await person('Dirk', dirk, [['/portal', 200], ['/portal/admin', 200], ['/portal/protokoll', 200], ['/portal/projekte/p-s01', 200], ['/portal/dokumente/d-n01-fin-intern/download', 200], ['/portal/freigaben', 200]], '/portal');
await person('Markus', markus, [['/portal/pipeline', 200], ['/portal/projekte/p-n01', 200], ['/portal/projekte/p-n02', 200], ['/portal/dokumente/d-n01-own-a-vertrag/download', 200], ['/portal/projekte/p-s01', 404], ['/portal/admin', 404], ['/portal/protokoll', 404], ['/portal/dokumente/d-n01-inv-fin/download', 404], ['/portal/dokumente/d-n01-fin-intern/download', 404], ['/portal/dokumente/d-s01-intern/download', 404]], '/portal/pipeline');

const failed = results.filter((r) => !r.ok);
console.log(`\nErgebnis: ${results.length - failed.length}/${results.length} bestanden${failed.length ? ' – FEHLER: ' + failed.map((f) => f.name).join('; ') : ''}`);
process.exit(failed.length ? 1 : 0);
