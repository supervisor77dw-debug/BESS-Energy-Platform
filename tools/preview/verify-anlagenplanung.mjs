// QA-Prüfung des Investitionsplaners und der Navigation gegen die geschützte QA-Vorschau (AW-STROMKAI-20261029-INVESTITIONSPLANER-016).
// Nur QA-Testkonten aus der Zugangsdatei (nie persönliche Konten der öffentlichen Plattform). Schreibt nur Demo-Daten der QA-Vorschau:
// einen Planungsstand und eine STROMKAI-WM-Übergabe für das Demo-Projekt DEMO-N01. Aufruf wie verify-zentrale.mjs.
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
const csrfVon = async (c) => tok((await c.text('/portal/anlagenplanung'))[1], '_csrf');
const { c: a, ziel } = await sitzung('dirk@bess-vorschau.invalid');
check('QA-Administration landet in der Zentrale', ziel === '/portal/zentrale', ziel);
const [, css] = await a.text('/static/css/portal.css');
check('Navigation: beschriftete Leiste ausgeliefert (keine feste 76-px-Spalte)', /\.rail \{ width: max-content; min-width: 220px/.test(css) &&!/grid-template-columns: 76px 1fr/.test(css));
check('Navigationsskript ausgeliefert', (await a.req('/static/js/portal.js')).status === 200);
const [zr, zb] = await a.text('/portal/zentrale');
const kacheln = [...zb.matchAll(/<a class="modul" href="([^"]+)"><span class="modul-kopf"><strong>([^<]+)<\/strong>/g)].map((m) => [ent(m[1]), ent(m[2])]);
check('Zentrale mit 11 Bereichen inkl. Anlagenplanung', zr.status === 200 && kacheln.length === 11 && kacheln.some(([, t]) => t === 'Anlagenplanung & Investition'), String(kacheln.length));
for (const [h, t] of kacheln) check(`Kachel „${t}“ aufrufbar`, (await a.req(h)).status === 200, h);
check('Menü: Anlagenplanung & Investition, Gruppen', /href="\/portal\/anlagenplanung"/.test(zb) && /rail-group-title/.test(zb));
for (const s of ['grundstueck', 'technik', 'kosten', 'finanzierung', 'wirtschaftlichkeit', 'vergleich']) check(`Schritt ${s} (DEMO-N01)`, (await a.req(`/portal/anlagenplanung/p-n01?schritt=${s}`)).status === 200);
check('Speichersystem-Katalog', (await a.req('/portal/anlagenplanung/katalog')).status === 200);
// Ablauf: Grundstück und Technik speichern, Variante B an STROMKAI-WM übergeben
let csrf = await csrfVon(a);
let r = await a.form('/portal/anlagenplanung/p-n01/speichern', { _csrf: csrf, schritt: 'grundstueck', 'g.bezeichnung': 'QA-Demo-Grundstück (synthetisch)', 'g.flaecheM2': '12000', 'g.laengeM': '120', 'g.breiteM': '100', 'g.grenzabstandM': '3', 'g.zufahrtM2': '600', 'g.feuerwehrM2': '400', 'g.nebenanlagenM2': '300', 'g.netzMW': '12', 'g.einspeiseMW': '12', 'g.bezugMW': '15', 'a.flaeche.status': 'angenommen', 'a.geometrie.status': 'angenommen', 'a.abstaende.status': 'angenommen', 'a.netz.status': 'angenommen', notiz: 'QA-Prüfung AW-016' });
const v1 = new URL(r.headers.get('location') || '/', base).searchParams.get('v');
check('Grundstück gespeichert (neue Version)', r.status === 303 && !!v1, String(r.status));
r = await a.form('/portal/anlagenplanung/p-n01/speichern', { _csrf: csrf, schritt: 'technik', v: v1, 'v.A.name': 'Variante A', 'v.A.system': 'sys-ph-2h', 'v.A.mw': '10', 'v.A.mwh': '20', 'v.A.erloes': 'wm', 'v.B.name': 'Variante B', 'v.B.system': 'sys-ph-2h', 'v.B.mw': '15', 'v.B.mwh': '30', 'v.B.erloes': 'b2_A', 'v.C.name': 'Variante C', 'v.C.system': 'sys-ph-4h', 'v.C.mw': '10', 'v.C.mwh': '40', 'v.C.erloes': 'b2_B', 'a.cosPhi': '0,95', 'a.mvaJeTrafo': '5', 'a.flaecheJeTrafoM2': '40', 'a.zufahrtBreiteM': '5', 'a.reserveAnteil': '5', 'a.opexSkalierung': 'skaliert', notiz: 'QA-Prüfung AW-016' });
const v2 = new URL(r.headers.get('location') || '/', base).searchParams.get('v');
check('Varianten gespeichert (neue Version)', r.status === 303 && v2 && v2 !== v1);
const [, vb] = await a.text(`/portal/anlagenplanung/p-n01?schritt=vergleich&v=${v2}`);
check('Vergleich: drei Varianten, Netzentgelt A/B, keine „beste Variante“', /Variante C/.test(vb) && /Kapitalwert Netzentgelt B/.test(vb) && /Keine Variante wird als „beste“ ausgewiesen/.test(vb));
const [, wb] = await a.text(`/portal/anlagenplanung/p-n01?schritt=wirtschaftlichkeit&v=${v2}&var=B`);
check('Wirtschaftlichkeit: Datenversion, B2, Zeitraum, Hinweis', /Datenversion dv-/.test(wb) && /Strategie B2/.test(wb) && /keine garantierten Zukunftserlöse/.test(wb));
r = await a.form('/portal/anlagenplanung/p-n01/wm', { _csrf: csrf, v: v2, var: 'B' });
const fm = new URL(r.headers.get('location') || '/', base).searchParams.get('fm');
check('Übergabe an STROMKAI-WM', r.status === 303 && !!fm);
const [ak, akb] = await a.text(`/portal/wirtschaftlichkeit/p-n01?v=${fm}`);
check('WM-Akte zeigt übergebene Version (STROMKAI-WM 1.1)', ak.status === 200 && /Investitionsplaner DEMO-N01/.test(akb) && /STROMKAI-WM 1\.1/.test(akb));
r = await a.form('/portal/anlagenplanung/p-n01/freigeben', { _csrf: csrf, v: v2 });
check('Freigabe mit Platzhaltern abgewiesen', r.status === 422);
const csv = await a.req(`/portal/anlagenplanung/p-n01/export.csv?v=${v2}`);
check('CSV-Export', csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type') || ''));
check('Kalkulationsbericht', (await a.req(`/portal/anlagenplanung/p-n01/bericht?v=${v2}`)).status === 200);
const { c: pl } = await sitzung('projektleitung@demo.invalid');
check('Projektleitung: eigenes Projekt ja, fremdes nein', (await pl.req('/portal/anlagenplanung/p-n01')).status === 200 && (await pl.req('/portal/anlagenplanung/p-s01')).status === 404);
check('Projektleitung: keine Katalogpflege', (await pl.form('/portal/anlagenplanung/katalog', { _csrf: await csrfVon(pl), datenstatus: 'platzhalter' })).status === 404);
for (const e of ['eigentuemer.a@demo.invalid', 'investor.a@demo.invalid']) {
  const { c } = await sitzung(e);
  let ok = true; for (const p of ['/portal/anlagenplanung', '/portal/anlagenplanung/katalog', '/portal/anlagenplanung/p-n01', '/portal/anlagenplanung/p-n01/export.csv']) ok &&= (await c.req(p)).status === 404;
  const [, nb] = await c.text('/portal');
  check(`${e}: kein Zugriff, kein Menüpunkt`, ok && !/Anlagenplanung/.test(nb));
}
check('Ohne Anmeldung kein Zugriff', ![200].includes((await new C().req('/portal/anlagenplanung')).status));
console.log(`\n${results.filter(Boolean).length}/${results.length} bestanden`);
process.exit(results.every(Boolean) ? 0 : 1);
