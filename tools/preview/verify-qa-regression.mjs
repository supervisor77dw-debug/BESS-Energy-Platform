// Vollständige Portalregression der geschützten QA-Vorschau (ersetzt die Portalprüfung aus verify-preview.mjs, Stand -004).
// Berücksichtigt den Ablauf seit -005: Schranke → Login → MFA (Einrichtung) → Pflicht-Passwortwechsel → rollenabhängiger Einstieg.
// Prüft je Konto Rollen, Dokumentzugriffe und Mandantentrennung, Sitzungen, CSRF und Abmeldung.
// Zustand danach wie vorher: Jedes Konto erhält sein Startpasswort aus der Zugangsdatei zurück (Wechsel über ein
// zufälliges Zwischenpasswort, nur im Speicher). Danach setzt Dirk die MFA-Einrichtung aller MFA-Konten zurück.
// Bekannte Folge: Der Pflichtwechsel-Merker ist danach für die geprüften QA-Konten erfüllt (siehe Bericht).
// Keine Zugangsdaten, Geheimnisse oder Zwischenpasswörter werden ausgegeben oder gespeichert.
// Aufruf: [BESS_SHARE_URL=…] node tools/preview/verify-qa-regression.mjs --url <basis> --zugaenge <ZUGAENGE_…txt>
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { totp } from '../../src/lib/auth.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const base = arg('--url').replace(/\/$/, '');
const txt = readFileSync(arg('--zugaenge'), 'utf8');
const gate = Object.fromEntries([...txt.matchAll(/Prüferkennung: (\w+)\s+Passwort: (\S+)/g)].map((m) => [m[1], m[2]]));
const pw = Object.fromEntries([...txt.matchAll(/(\S+@\S+\.invalid)\s+Passwort: (\S+)/g)].map((m) => [m[1], m[2]]));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'OK  ' : 'FEHL'} ${name}${detail ? ' – ' + detail : ''}`); };
const loc = (r) => r.headers.get('location') || '';
const tok = (b, n) => new RegExp(`name="${n}" value="([^"]+)"`).exec(b)?.[1];

class C {
  jar = {};
  async req(p, o = {}) {
    const r = await fetch(p.startsWith('http') ? p : base + p, { redirect: 'manual', ...o, headers: { ...(o.headers || {}), cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) this.jar[k] = v; else delete this.jar[k]; }
    return r;
  }
  form(p, f) { return this.req(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(f).toString() }); }
  async text(p) { const r = await this.req(p); return [r, await r.text()]; }
}
const share = process.env.BESS_SHARE_URL;
async function client(who = 'dirk') {
  const c = new C();
  if (share) await c.req(share);
  const [, b] = await c.text('/_vorschau/anmelden');
  const g = await c.form('/_vorschau/anmelden', { _t: tok(b, '_t'), next: '/', user: who, password: gate[who] });
  if (g.status !== 303) throw new Error(`Schranke für ${who}: Status ${g.status}`);
  return c;
}
const secrets = {}; // TOTP-Geheimnisse aus der Ersteinrichtung (nur im Speicher)

// Anmeldung bis zum Portal; prüft unterwegs MFA und Pflicht-Passwortwechsel
async function anmelden(c, email, password, label, { pruefePflicht = false, neu } = {}) {
  const [, lb] = await c.text('/portal/login');
  const l = await c.form('/portal/anmelden', { _t: tok(lb, '_t'), email, password });
  let next = loc(l);
  if (l.status !== 303) { check(`${label}: Anmeldung`, false, `Status ${l.status}`); return null; }
  if (next === '/portal/mfa') {
    check(`${label}: vor MFA kein Portalzugriff`, loc(await c.req('/portal/admin')) === '/portal/mfa');
    const [, mb] = await c.text('/portal/mfa');
    if (/Zweiten Faktor einrichten/.test(mb)) {
      const s = /<code>([A-Z2-7 ]+)<\/code>/.exec(mb)?.[1]?.replace(/ /g, '');
      check(`${label}: MFA-Ersteinrichtung mit QR`, /data:image\/gif;base64/.test(mb) && !!s);
      secrets[email] = s;
    }
    check(`${label}: falscher MFA-Code abgelehnt`, (await c.form('/portal/mfa', { _csrf: tok(mb, '_csrf'), code: '000000' })).status === 401);
    const m = await c.form('/portal/mfa', { _csrf: tok(mb, '_csrf'), code: secrets[email] ? totp(secrets[email]) : '000000' });
    check(`${label}: MFA bestanden, Sitzung erneuert`, m.status === 303 && m.headers.getSetCookie().some((x) => x.startsWith('bess_sid=')));
    next = loc(m);
  }
  if (next === '/portal/passwort') {
    if (pruefePflicht) {
      for (const p of ['/portal', '/portal/admin', '/portal/dokumente/d-n01-own-a-vertrag/download', '/portal/projekte/p-n01'])
        check(`${label}: vor Passwortwechsel ${p} gesperrt`, loc(await c.req(p)) === '/portal/passwort');
      const [, pb] = await c.text('/portal/passwort');
      const user = email.split('@')[0];
      check(`${label}: falsches bisheriges Passwort abgelehnt`, (await c.form('/portal/passwort', { _csrf: tok(pb, '_csrf'), current: 'falsch-' + Date.now(), neu: 'Ein-Gutes-Passwort-2026', neu2: 'Ein-Gutes-Passwort-2026' })).status === 401);
      check(`${label}: zu kurzes Passwort abgelehnt`, (await c.form('/portal/passwort', { _csrf: tok(pb, '_csrf'), current: password, neu: 'kurz', neu2: 'kurz' })).status === 422);
      check(`${label}: Passwort mit Benutzername abgelehnt`, (await c.form('/portal/passwort', { _csrf: tok(pb, '_csrf'), current: password, neu: user + '-Speicher-2026', neu2: user + '-Speicher-2026' })).status === 422);
      check(`${label}: Passwortwechsel ohne CSRF-Token abgewiesen`, (await c.form('/portal/passwort', { current: password, neu: neu, neu2: neu })).status === 403);
    }
    const [, pb] = await c.text('/portal/passwort');
    const w = await c.form('/portal/passwort', { _csrf: tok(pb, '_csrf'), current: password, neu, neu2: neu });
    check(`${label}: Pflicht-Passwortwechsel durchgeführt`, w.status === 303 && loc(w) !== '/portal/passwort');
    next = loc(w);
    return { next, changed: true };
  }
  return { next, changed: false };
}

async function abmelden(c, label) {
  const [pr, pb] = await c.text('/portal');
  const sid = c.jar.bess_sid;
  const ohne = await c.form('/portal/abmelden', {});
  check(`${label}: Abmelden ohne CSRF-Token abgewiesen`, ohne.status === 403);
  const a = await c.form('/portal/abmelden', { _csrf: tok(pb, '_csrf') });
  check(`${label}: Abmeldung`, pr.status === 200 && a.status === 303 && loc(a) === '/portal/login');
  const after = await fetch(base + '/portal', { redirect: 'manual', headers: { cookie: Object.entries({ ...c.jar, bess_sid: sid }).map(([k, v]) => `${k}=${v}`).join('; ') } });
  check(`${label}: alte Sitzung serverseitig ungültig`, loc(after) === '/portal/login', `Status ${after.status} → ${loc(after)}`);
}

// Passwort zurück auf den Ausgangswert (Zugangsdatei bleibt gültig)
async function zuruecksetzen(email, label, zwischen) {
  const c = await client();
  const r = await anmelden(c, email, zwischen, label);
  if (!r) return;
  const [, pb] = await c.text('/portal/passwort');
  const w = await c.form('/portal/passwort', { _csrf: tok(pb, '_csrf'), current: zwischen, neu: pw[email], neu2: pw[email] });
  check(`${label}: Startpasswort wiederhergestellt`, w.status === 303);
  const [, b] = await c.text('/portal'); await c.form('/portal/abmelden', { _csrf: tok(b, '_csrf') });
}

const KONTEN = [
  ['Markus (Vertrieb Nord)', 'markus@bess-vorschau.invalid', '/portal/pipeline', [['/portal/projekte/p-n01', 200], ['/portal/projekte/p-n02', 200], ['/portal/projekte/p-s01', 404], ['/portal/admin', 404], ['/portal/protokoll', 404], ['/portal/dokumente/d-n01-inv-fin/download', 404], ['/portal/dokumente/d-n01-fin-intern/download', 404], ['/portal/dokumente/d-n01-own-a-vertrag/download', 200], ['/portal/dokumente/d-s01-intern/download', 404]]],
  ['Eigentümer A', 'eigentuemer.a@demo.invalid', null, [['/portal/dokumente/d-n01-own-a-vertrag/download', 200], ['/portal/dokumente/d-n02-own-b-vertrag/download', 404], ['/portal/dokumente/d-n01-inv-fin/download', 404], ['/portal/dokumente/d-n01-fin-intern/download', 404], ['/portal/projekte/p-n02', 404], ['/portal/admin', 404]]],
  ['Eigentümerin B', 'eigentuemer.b@demo.invalid', null, [['/portal/dokumente/d-n02-own-b-vertrag/download', 200], ['/portal/dokumente/d-n01-own-a-vertrag/download', 404], ['/portal/admin', 404]]],
  ['Investor A', 'investor.a@demo.invalid', '/portal/dokumente', [['/portal/dokumente/d-n01-inv-teaser/download', 200], ['/portal/dokumente/d-n02-inv-teaser/download', 404], ['/portal/dokumente/d-n01-inv-netz-entwurf/download', 404], ['/portal/dokumente/d-n01-fin-intern/download', 404], ['/portal/dokumente/d-n01-own-a-vertrag/download', 404], ['/portal/admin', 404]]],
  ['Investor B', 'investor.b@demo.invalid', '/portal/dokumente', [['/portal/dokumente/d-n02-inv-teaser/download', 200], ['/portal/dokumente/d-n01-inv-teaser/download', 404], ['/portal/dokumente/d-n01-inv-fin/download', 404]]],
  ['Gemeinde', 'gemeinde@demo.invalid', '/portal/projekte', [['/portal/dokumente/d-n01-kom-brand/download', 200], ['/portal/dokumente/d-n02-tech-spec/download', 404], ['/portal/dokumente/d-n01-inv-fin/download', 404], ['/portal/admin', 404]]],
  ['Technikpartner', 'technik@demo.invalid', '/portal/projekte', [['/portal/dokumente/d-n02-tech-spec/download', 200], ['/portal/dokumente/d-n01-kom-brand/download', 404], ['/portal/admin', 404]]],
  ['Dirk (Administration)', 'dirk@bess-vorschau.invalid', null, [['/portal/admin', 200], ['/portal/projekte/p-s01', 200], ['/portal/dokumente/d-n01-fin-intern/download', 200], ['/portal/protokoll', 200], ['/portal/dokumente/d-s01-intern/download', 200]]],
];

// 0. Schutzschichten
if (share) check('Vercel-Schutz ohne Freigabelink', [302, 401, 403].includes((await fetch(base + '/', { redirect: 'manual' })).status));
const anon = new C(); if (share) await anon.req(share);
check('ohne Schranke kein Zugriff (Website)', loc(await anon.req('/grundstueckseigentuemer')).startsWith('/_vorschau/anmelden'));
check('ohne Schranke kein Zugriff (Dokument)', loc(await anon.req('/portal/dokumente/d-n01-own-a-vertrag/download')).startsWith('/_vorschau/anmelden'));
check('ohne Schranke kein Zugriff (Bild)', (await anon.req('/static/img/v2/manifest.json')).status === 401);
const [, gb] = await anon.text('/_vorschau/anmelden');
check('falsches Schrankenpasswort abgelehnt', (await anon.form('/_vorschau/anmelden', { _t: tok(gb, '_t'), user: 'dirk', password: 'falsch-' + Date.now() })).status === 401);
const c0 = await client();
const [, lb0] = await c0.text('/portal/login');
check('Login-Seite ohne Demo-Zugänge', !/Demo-Zugänge|Vorschau!Speicher/.test(lb0));
check('falsches Passwort abgelehnt', (await c0.form('/portal/anmelden', { _t: tok(lb0, '_t'), email: 'markus@bess-vorschau.invalid', password: 'falsch-' + Date.now() })).status === 401);
check('ohne Anmeldung kein Portal', loc(await c0.req('/portal/admin')) === '/portal/login');

// 1. Je Konto: Ablauf, Rollen, Mandantentrennung, Abmeldung
const zwischen = {};
for (const [label, email, landing, expect] of KONTEN) {
  if (!pw[email]) { check(`${label}: Zugang in Zugangsdatei`, false); continue; }
  const c = await client(email.startsWith('markus') ? 'markus' : 'dirk');
  zwischen[email] = 'QA-' + randomBytes(12).toString('base64url');
  let r;
  try { r = await anmelden(c, email, pw[email], label, { pruefePflicht: true, neu: zwischen[email] }); } catch (e) { check(`${label}: Ablauf`, false, e.message); }
  if (!r) continue;
  if (!r.changed) check(`${label}: Pflicht-Passwortwechsel verlangt`, false, 'Konto ohne Pflichtwechsel – Ausgangszustand abweichend');
  if (landing) check(`${label}: Einstieg ${landing}`, r.next === landing, r.next);
  for (const [p, st] of expect) { const x = await c.req(p); check(`${label}: ${p} → ${st}`, x.status === st, `Status ${x.status}${loc(x) ? ' → ' + loc(x) : ''}`); }
  const sc = (await c.req('/portal')).headers.get('cache-control') || '';
  check(`${label}: Portalseiten nicht zwischenspeicherbar`, /no-store/.test(sc), sc);
  await abmelden(c, label);
  // sofort zurücksetzen: Zwischenpasswort lebt nur für die Dauer dieses Kontos
  if (r.changed) await zuruecksetzen(email, label, zwischen[email]).catch((e) => check(`${label}: Startpasswort wiederhergestellt`, false, e.message));
}
// 2. MFA-Einrichtungen zurücksetzen (Prüfer richten sie selbst ein)
{
  const c = await client();
  const r = await anmelden(c, 'dirk@bess-vorschau.invalid', pw['dirk@bess-vorschau.invalid'], 'Dirk (Rücksetzung)');
  const [ar, ab] = await c.text('/portal/admin');
  const users = [...ab.matchAll(/name="userId" value="([^"]+)"/g)].map((m) => m[1]);
  for (const id of ['u-markus', 'u-inv-a', 'u-inv-b', 'u-pl', 'u-admin']) {
    if (!users.includes(id)) continue;
    const [, b] = await c.text('/portal/admin');
    const x = await c.form('/portal/admin/mfa-zuruecksetzen', { _csrf: tok(b, '_csrf'), userId: id });
    if (id !== 'u-admin') check(`Rücksetzung: MFA-Einrichtung ${id}`, ar.status === 200 && x.status === 303 && loc(x).startsWith('/portal/admin'), `Status ${x.status} → ${loc(x)}`);
    else check('Rücksetzung: MFA-Einrichtung u-admin (eigene, Sitzung endet)', x.status === 303, `→ ${loc(x)}`);
  }
}
const failed = results.filter((r) => !r.ok);
console.log(`\nErgebnis: ${results.length - failed.length}/${results.length} bestanden${failed.length ? ' – FEHLER: ' + failed.map((f) => f.name).join('; ') : ''}`);
process.exit(failed.length ? 1 : 0);
