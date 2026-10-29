// Abnahmeablauf Benutzerverwaltung (AW-BESS-STROMKAI-BENUTZERVERWALTUNG-009, Abschnitt 8, Schritte 1–9) gegen eine laufende Instanz.
// Legt einen eindeutig benannten Testbenutzer an („Abnahmetest …“, @demo.invalid), prüft Einladung, Aktivierung, Rechte, Entzug
// und Sperre und lässt ihn am Ende GESPERRT zurück. Gibt keine Zugangsdaten, Links oder Passwörter aus.
// Aufruf: [BESS_SHARE_URL=…] node tools/preview/verify-benutzerverwaltung.mjs --url <basis> --zugaenge <ZUGAENGE_…txt> [--schranke]
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const base = arg('--url').replace(/\/$/, '');
const txt = readFileSync(arg('--zugaenge'), 'utf8');
const gate = Object.fromEntries([...txt.matchAll(/Prüferkennung: (\w+)\s+Passwort: (\S+)/g)].map((m) => [m[1], m[2]]));
const pw = Object.fromEntries([...txt.matchAll(/(\S+@\S+\.invalid)\s+Passwort: (\S+)/g)].map((m) => [m[1], m[2]]));
const DIRK = arg('--admin') || Object.keys(pw).find((e) => e.startsWith('dirk@'));
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'OK  ' : 'FEHL'} ${n}${d ? ' – ' + d : ''}`); };
const tok = (b, n) => new RegExp(`name="${n}" value="([^"]+)"`).exec(b)?.[1];
const loc = (r) => r.headers.get('location') || '';
class C {
  jar = {};
  async req(p, o = {}) { const r = await fetch(p.startsWith('http') ? p : base + p, { redirect: 'manual', ...o, headers: { ...(o.headers || {}), cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') } }); for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) this.jar[k] = v; else delete this.jar[k]; } return r; }
  form(p, f) { const q = new URLSearchParams(); for (const [k, v] of Object.entries(f)) for (const x of [].concat(v)) q.append(k, x); return this.req(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: q.toString() }); }
  async text(p) { const r = await this.req(p); return [r, await r.text()]; }
  async csrf(p) { return tok((await this.text(p))[1], '_csrf'); }
}
async function client() {
  const c = new C();
  if (process.env.BESS_SHARE_URL) await c.req(process.env.BESS_SHARE_URL);
  if (process.argv.includes('--schranke')) { const [, b] = await c.text('/_vorschau/anmelden'); await c.form('/_vorschau/anmelden', { _t: tok(b, '_t'), next: '/', user: 'dirk', password: gate.dirk }); }
  return c;
}
async function login(c, email, password) { const [, b] = await c.text('/portal/login'); return c.form('/portal/anmelden', { _t: tok(b, '_t'), email, password }); }

// 1 – Dirk nur mit E-Mail und Passwort
const dirk = await client();
const l = await login(dirk, DIRK, pw[DIRK]);
check('1 Dirk: Anmeldung nur mit E-Mail und Passwort (keine MFA)', l.status === 303 && loc(l) !== '/portal/mfa', `→ ${loc(l)}`);
if (loc(l) === '/portal/passwort') { console.log('Hinweis: Startpasswort verlangt einmaligen Passwortwechsel – Prüfung bricht hier ab (Zustand nicht verändern).'); process.exit(2); }
const [ar, ab] = await dirk.text('/portal/admin/benutzer');
check('Dirk: Menüpunkt „Benutzer & Berechtigungen“ erreichbar', ar.status === 200 && /Benutzerübersicht/.test(ab));

// 2/3 – Testbenutzer einladen, Rolle Investor, Projekt Nord A
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const email = `abnahmetest.${stamp}@demo.invalid`;
const r2 = await dirk.form('/portal/admin/benutzer/neu', { _csrf: await dirk.csrf('/portal/admin/benutzer/neu'), name: `Abnahmetest ${stamp}`, email, roles: 'investor', projects: 'p-n01' });
const ib = await r2.text();
const t = /aktivieren\?t=([\w-]+)/.exec(ib)?.[1];
check('2/3 Testbenutzer eingeladen mit Rolle und Projekt, einmaliger Link erzeugt', r2.status === 200 && !!t);
const id = /\/portal\/admin\/benutzer\/(u-[\w-]+)"/.exec(ib)?.[1];

// 4 – Aktivierung und erste Anmeldung
const neu = `Abnahme-${randomBytes(9).toString('base64url')}!`;
const a1 = await (await client()).form('/portal/aktivieren', { t, neu, neu2: neu });
check('4 Aktivierung über Link', a1.status === 303 && loc(a1) === '/portal/login?m=aktiviert');
check('4 Link nur einmal verwendbar', (await (await client()).req(`/portal/aktivieren?t=${t}`)).status === 410);
const user = await client();
const l2 = await login(user, email, neu);
check('4 erste Anmeldung → Datenraum', loc(l2) === '/portal/dokumente', `→ ${loc(l2)}`);

// 5 – nur freigegebene Inhalte
const st = async (p) => (await user.req(p)).status;
check('5 eigenes Projektdokument (Nord A, Investor) sichtbar', await st('/portal/dokumente/d-n01-inv-teaser/download') === 200);
for (const p of ['/portal/dokumente/d-n02-inv-teaser/download', '/portal/dokumente/d-n01-fin-intern/download', '/portal/dokumente/d-n01-own-a-vertrag/download', '/portal/projekte/p-s01', '/portal/admin/benutzer', '/portal/protokoll'])
  check(`5 nicht freigegeben ${p} → 404`, await st(p) === 404);
check('5 keine Rechteausweitung über Verwaltungsaktion', (await user.form(`/portal/admin/benutzer/${id}/rollen`, { _csrf: await user.csrf('/portal/dokumente'), roles: 'admin', confirm_admin: 'ja' })).status === 404);

// 6/7 – Berechtigung entziehen → sofort verweigert
const [, eb] = await dirk.text(`/portal/admin/benutzer/${id}`);
const gid = /\/zugriff\/(g-[\w-]+)\/entziehen/.exec(eb)?.[1];
const e = await dirk.form(`/portal/admin/benutzer/${id}/zugriff/${gid}/entziehen`, { _csrf: tok(eb, '_csrf') });
check('6 Dirk entzieht Projektberechtigung', e.status === 303);
check('7 Zugriff unmittelbar verweigert (gleiche Sitzung)', await st('/portal/dokumente/d-n01-inv-teaser/download') === 404);

// 8/9 – Sperre, Sitzungen ungültig
const s = await dirk.form(`/portal/admin/benutzer/${id}/sperren`, { _csrf: await dirk.csrf(`/portal/admin/benutzer/${id}`), grund: 'Abnahmetest – bleibt gesperrt' });
check('8 Dirk sperrt den Benutzer', s.status === 303);
const after = await user.req('/portal/dokumente');
check('9 bestehende Sitzung sofort ungültig', loc(after) === '/portal/login', `→ ${loc(after)}`);
check('9 Anmeldung des gesperrten Benutzers abgewiesen', (await login(await client(), email, neu)).status === 401);
const [, cl] = await dirk.text('/portal/admin/aenderungen');
check('Änderungsprotokoll enthält Einladung, Entzug und Sperre', /Benutzer eingeladen/.test(cl) && /Projektrecht entzogen/.test(cl) && /Benutzer gesperrt/.test(cl));
await dirk.form('/portal/abmelden', { _csrf: await dirk.csrf('/portal') });
console.log(`\nErgebnis: ${results.filter(Boolean).length}/${results.length}  (Testbenutzer „Abnahmetest ${stamp}“ bleibt gesperrt)`);
process.exit(results.every(Boolean) ? 0 : 1);
