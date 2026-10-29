// ABGELÖST durch tools/preview/verify-qa-regression.mjs (AW-BESS-STROMKAI-FINAL-QA-007): kennt den Pflicht-Passwortwechsel (-005) nicht,
// und die MFA-Rücksetzprüfung wertete jede Weiterleitung als Erfolg (falsch positiv). Nicht mehr für Abnahmen verwenden.
// Abnahmeprüfung der laufenden (externen) Vorschau mit den ECHTEN Prüferkonten Dirk und Markus.
// Liest die Zugangsdatei nur im Speicher; es werden keine Passwörter oder MFA-Geheimnisse ausgegeben.
// Achtung: richtet MFA für beide Konten ein. Mit BESS_RESET_MFA=1 setzt das Skript die Einrichtung am Ende
// über die Verwaltung zurück (Cloud); lokal alternativ tools/preview/reset-mfa.mjs.
// BESS_SHARE_URL: Vercel-Freigabelink (Deployment Protection) – wird nicht ausgegeben.
// Aufruf: node tools/preview/verify-preview.mjs --url https://grafik-engine.tail01a4a3.ts.net --zugaenge <ZUGAENGE_…txt>
import { readFileSync } from 'node:fs';
import { totp } from '../../src/lib/auth.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const base = arg('--url').replace(/\/$/, '');
const txt = readFileSync(arg('--zugaenge'), 'utf8');
const gate = Object.fromEntries([...txt.matchAll(/Prüferkennung: (\w+)\s+Passwort: (\S+)/g)].map((m) => [m[1], m[2]]));
const pw = Object.fromEntries([...txt.matchAll(/(\S+@\S+\.invalid)\s+Passwort: (\S+)/g)].map((m) => [m[1], m[2]]));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'OK  ' : 'FEHL'} ${name}${detail ? ' – ' + detail : ''}`); };

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
const tok = (b, n) => new RegExp(`name="${n}" value="([^"]+)"`).exec(b)?.[1];

// 0. Vercel Deployment Protection (falls BESS_SHARE_URL gesetzt): ohne Freigabelink kein Zugriff
const share = process.env.BESS_SHARE_URL;
const withShare = async (c) => { if (share) await c.req(share.replace(base, '')); return c; };
if (share) { const r = await fetch(base + '/', { redirect: 'manual' }); check('Vercel-Schutz ohne Freigabelink', [302, 401, 403].includes(r.status) && !/_vorschau/.test(r.headers.get('location') || ''), `Status ${r.status}`); }

// 1. Ohne Schranke
const anon = await withShare(new C());
for (const p of ['/', '/grundstueckseigentuemer', '/projekte', '/portal/login', '/robots.txt', '/portal/dokumente/d-n01-own-a-vertrag/download']) {
  const r = await anon.req(p);
  check(`ohne Schranke ${p}`, r.status === 303 && /^\/_vorschau\/anmelden/.test(r.headers.get('location') || ''), `Status ${r.status}`);
}
for (const p of ['/static/img/hero.svg', '/static/img/schnitt-batteriesystem.svg', '/static/js/site.js']) check(`ohne Schranke ${p}`, (await anon.req(p)).status === 401);
check('ohne Schranke POST /standort-anbieten', (await anon.form('/standort-anbieten', { name: 'x' })).status === 401);
const [gp, gb] = await anon.text('/_vorschau/anmelden');
check('Schrankenseite noindex, keine Zugangsdaten', /noindex/.test(gp.headers.get('x-robots-tag') || '') && !/demo\.invalid|bess-vorschau\.invalid|Passwort für alle|Vorschau!Speicher/.test(gb));
check('HTTPS-Schutz: HSTS gesetzt (bei https)', !base.startsWith('https') || /max-age/.test(gp.headers.get('strict-transport-security') || ''), gp.headers.get('strict-transport-security') || '-');
check('falsches Schrankenpasswort abgelehnt', (await anon.form('/_vorschau/anmelden', { _t: tok(gb, '_t'), user: 'dirk', password: 'falsch-' + Date.now() })).status === 401);

// 2. Prüferablauf
async function prüfer(who, email, expect, nachher) {
  const c = await withShare(new C());
  const [, b] = await c.text('/_vorschau/anmelden');
  const g = await c.form('/_vorschau/anmelden', { _t: tok(b, '_t'), next: '/', user: who, password: gate[who] });
  check(`${who}: Schranke`, g.status === 303 && /HttpOnly; SameSite=Lax; Secure/.test(g.headers.getSetCookie().join(';')));
  const [h] = await c.text('/grundstueckseigentuemer');
  check(`${who}: Website nach Schranke erreichbar`, h.status === 200);
  const [, lb] = await c.text('/portal/login');
  check(`${who}: Login ohne Demo-Zugänge`, !/Demo-Zugänge|Vorschau!Speicher/.test(lb));
  const l = await c.form('/portal/anmelden', { _t: tok(lb, '_t'), email, password: pw[email] });
  check(`${who}: Passwort → MFA erforderlich`, l.headers.get('location') === '/portal/mfa');
  check(`${who}: vor MFA kein Portal`, (await c.req('/portal')).headers.get('location') === '/portal/mfa');
  const [, mb] = await c.text('/portal/mfa');
  const enroll = /Zweiten Faktor einrichten/.test(mb);
  const secret = /<code>([A-Z2-7 ]+)<\/code>/.exec(mb)?.[1]?.replace(/ /g, '');
  check(`${who}: MFA-Ersteinrichtung mit QR`, enroll && /data:image\/gif;base64/.test(mb) && !!secret);
  check(`${who}: falscher MFA-Code abgelehnt`, (await c.form('/portal/mfa', { _csrf: tok(mb, '_csrf'), code: '000000' })).status === 401);
  check(`${who}: richtiger MFA-Code`, (await c.form('/portal/mfa', { _csrf: tok(mb, '_csrf'), code: secret ? totp(secret) : '000000' })).status === 303);
  for (const [p, st] of expect) { const r = await c.req(p); check(`${who}: ${p} → ${st}`, r.status === st, `Status ${r.status}${r.headers.get('location') ? ' → ' + r.headers.get('location') : ''}`); }
  if (nachher) await nachher(c);
  const [, pb] = await c.text('/portal');
  const sid = c.jar.bess_sid;
  await c.form('/portal/abmelden', { _csrf: tok(pb, '_csrf') });
  const after = await fetch(base + '/portal', { redirect: 'manual', headers: { cookie: Object.entries({ ...c.jar, bess_sid: sid }).map(([k, v]) => `${k}=${v}`).join('; ') } });
  check(`${who}: Logout serverseitig`, after.headers.get('location') === '/portal/login', `Status ${after.status} → ${after.headers.get('location')}`);
  await c.req('/_vorschau/abmelden');
  check(`${who}: Schranken-Logout`, (await c.req('/')).status === 303);
}
const dirkChecks = [['/portal/admin', 200], ['/portal/projekte/p-s01', 200], ['/portal/dokumente/d-n01-fin-intern/download', 200], ['/portal/protokoll', 200]];
const resetMfa = async (c) => { for (const id of ['u-markus', 'u-admin']) { const [, ab] = await c.text('/portal/admin'); const r = await c.form('/portal/admin/mfa-zuruecksetzen', { _csrf: tok(ab, '_csrf'), userId: id }); check(`dirk: MFA-Einrichtung für ${id} zurückgesetzt`, r.status === 303); } };
await prüfer('markus', 'markus@bess-vorschau.invalid', [['/portal/projekte/p-n01', 200], ['/portal/projekte/p-n02', 200], ['/portal/projekte/p-s01', 404], ['/portal/admin', 404], ['/portal/protokoll', 404], ['/portal/dokumente/d-n01-inv-fin/download', 404], ['/portal/dokumente/d-n01-fin-intern/download', 404], ['/portal/dokumente/d-n01-own-a-vertrag/download', 200], ['/portal/dokumente/d-s01-intern/download', 404]]);
// Dirk zuletzt: Abschlussprüfung, danach MFA-Einrichtung für Markus und Dirk zurücksetzen (sie richten sie selbst ein)
await prüfer('dirk', 'dirk@bess-vorschau.invalid', dirkChecks, process.env.BESS_RESET_MFA === '1' ? resetMfa : undefined);

const failed = results.filter((r) => !r.ok);
console.log(`\nErgebnis: ${results.length - failed.length}/${results.length} bestanden${failed.length ? ' – FEHLER: ' + failed.map((f) => f.name).join('; ') : ''}`);
process.exit(failed.length ? 1 : 0);
