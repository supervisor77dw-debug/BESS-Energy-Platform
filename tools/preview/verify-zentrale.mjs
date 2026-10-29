// Prüfung der Zentrale gegen eine laufende geschützte Instanz (AW-STROMKAI-20261029-ADMIN-DASHBOARD-INTEGRATION-015):
// QA-Administration landet in der Zentrale, jede Kachel ist aufrufbar, Projektleitung ohne Zentrale, Eigentümer/Investor ohne
// interne Bereiche. Nur QA-Testkonten aus der Zugangsdatei (nie persönliche Konten der öffentlichen Plattform). Schreibt nichts.
// Aufruf: [BESS_SHARE_URL=…] node tools/preview/verify-zentrale.mjs --url <basis> --zugaenge <ZUGAENGE_…txt>
import { readFileSync } from 'node:fs';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const base = arg('--url').replace(/\/$/, '');
const txt = readFileSync(arg('--zugaenge'), 'utf8');
const gate = Object.fromEntries([...txt.matchAll(/Prüferkennung: (\w+)\s+Passwort: (\S+)/g)].map((m) => [m[1], m[2]]));
const pw = Object.fromEntries([...txt.matchAll(/(\S+@\S+\.invalid)\s+Passwort: (\S+)/g)].map((m) => [m[1], m[2]]));
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'OK  ' : 'FEHL'} ${n}${d ? ' – ' + d : ''}`); };
const tok = (b, n) => new RegExp(`name="${n}" value="([^"]+)"`).exec(b)?.[1];
const ent = (s) => s.replace(/&amp;/g, '&');
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
async function sitzung(email) {
  const c = new C();
  if (process.env.BESS_SHARE_URL) await c.req(process.env.BESS_SHARE_URL);
  const [, gb] = await c.text('/_vorschau/anmelden');
  await c.form('/_vorschau/anmelden', { _t: tok(gb, '_t'), next: '/', user: 'dirk', password: gate.dirk });
  const [, lb] = await c.text('/portal/login');
  const l = await c.form('/portal/anmelden', { _t: tok(lb, '_t'), email, password: pw[email] });
  let ziel = l.headers.get('location') || '';
  if (ziel === '/portal/passwort') { // offener Pflichtwechsel eines QA-Kontos: über Zwischenpasswort durchlaufen und zurücksetzen
    const zw = `Zw-${Math.random().toString(36).slice(2)}-7!Q`;
    let [, pb] = await c.text('/portal/passwort'); await c.form('/portal/passwort', { _csrf: tok(pb, '_csrf'), current: pw[email], neu: zw, neu2: zw });
    [, pb] = await c.text('/portal/passwort'); await c.form('/portal/passwort', { _csrf: tok(pb, '_csrf'), current: zw, neu: pw[email], neu2: pw[email] });
    ziel = '/portal';
  }
  return { c, ziel };
}
const { c: a, ziel } = await sitzung('dirk@bess-vorschau.invalid');
check('QA-Administration landet in der Zentrale', ziel === '/portal/zentrale', ziel);
const [zr, zb] = await a.text('/portal/zentrale');
const kacheln = [...zb.matchAll(/<a class="modul" href="([^"]+)"><span class="modul-kopf"><strong>([^<]+)<\/strong>/g)].map((m) => [ent(m[1]), ent(m[2])]);
check('Zentrale mit 10 Bereichen', zr.status === 200 && kacheln.length === 10, String(kacheln.length));
for (const [h, t] of kacheln) check(`Kachel „${t}“ aufrufbar`, (await a.req(h)).status === 200, h);
const [, sb] = await a.text('/portal/shadow-trading');
check('Shadow-Trading ohne Handelsfunktion', /Keine realen Handelsaufträge, kein Börsenzugang/.test(sb) && !/Kostenplan/.test(sb));
const { c: pl } = await sitzung('projektleitung@demo.invalid');
check('Projektleitung: Zentrale verborgen, Trading-Bereiche sichtbar', (await pl.req('/portal/zentrale')).status === 404 && (await pl.req('/portal/shadow-trading')).status === 200);
for (const e of ['eigentuemer.a@demo.invalid', 'investor.a@demo.invalid']) {
  const { c } = await sitzung(e);
  let ok = true; for (const p of ['/portal/zentrale', '/portal/netzentgelt', '/portal/shadow-trading', '/portal/strommarkt', '/portal/entwicklungsstand']) ok &&= (await c.req(p)).status === 404;
  check(`${e}: keine internen Bereiche`, ok);
}
console.log(`\n${results.filter(Boolean).length}/${results.length} bestanden`);
process.exit(results.every(Boolean) ? 0 : 1);
