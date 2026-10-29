// Ende-zu-Ende-Prüfung des einmaligen administrativen Startpassworts gegen eine laufende Instanz (AW-014), nur mit
// einem isolierten Testkonto: anmelden ohne Pflichtwechsel/MFA → Einstieg → Bereiche → abmelden → erneut anmelden.
// Liest Adresse und Passwort aus der Übergabedatei (nur im Speicher, keine Ausgabe).
// Aufruf: [BESS_SHARE_URL=…] node tools/preview/verify-startpasswort.mjs --url <basis> --uebergabe <datei> [--schranke <zugaenge> ] [--bereiche /a,/b]
import { readFileSync } from 'node:fs';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const base = arg('--url').replace(/\/$/, '');
const ue = readFileSync(arg('--uebergabe'), 'utf8');
const email = /E-Mail-Adresse: (\S+)/.exec(ue)[1], pw = /Passwort: (\S+)/.exec(ue)[1];
const schranke = arg('--schranke') ? /Prüferkennung: dirk\s+Passwort: (\S+)/.exec(readFileSync(arg('--schranke'), 'utf8'))?.[1] : null;
const bereiche = (arg('--bereiche') || '/portal').split(',');
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'OK  ' : 'FEHL'} ${name}${detail ? ' – ' + detail : ''}`); };
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
async function sitzung() {
  const c = new C();
  if (process.env.BESS_SHARE_URL) await c.req(process.env.BESS_SHARE_URL);
  if (schranke) { const [, b] = await c.text('/_vorschau/anmelden'); await c.form('/_vorschau/anmelden', { _t: tok(b, '_t'), next: '/', user: 'dirk', password: schranke }); }
  const [, lb] = await c.text('/portal/login');
  const l = await c.form('/portal/anmelden', { _t: tok(lb, '_t'), email, password: pw });
  return { c, l };
}
const { c, l } = await sitzung();
const ziel = l.headers.get('location') || '';
check('Anmeldung mit E-Mail und Startpasswort', l.status === 303 && !ziel.startsWith('/portal/login'), `${l.status} → ${ziel}`);
check('kein Pflicht-Passwortwechsel', ziel !== '/portal/passwort');
check('keine MFA', ziel !== '/portal/mfa');
check(`Einstieg ${ziel} erreichbar`, (await c.req(ziel)).status === 200);
for (const p of bereiche) check(`Bereich ${p} erreichbar`, (await c.req(p)).status === 200);
const [, hb] = await c.text('/portal');
check('„Passwort ändern“ im Kopfbereich', /href="\/portal\/passwort"/.test(hb));
const sid = c.jar.bess_sid;
const a = await c.form('/portal/abmelden', { _csrf: tok(hb, '_csrf') });
const nach = await c.req('/portal');
check('Abmeldung, Sitzung beendet', a.status === 303 && (nach.headers.get('location') || '') === '/portal/login' && !!sid);
const zwei = await sitzung();
check('erneute Anmeldung ohne Passwortaufforderung', zwei.l.status === 303 && !['/portal/passwort', '/portal/mfa', '/portal/login'].includes(zwei.l.headers.get('location')));
const [, hb2] = await zwei.c.text('/portal');
await zwei.c.form('/portal/abmelden', { _csrf: tok(hb2, '_csrf') });
console.log(`\n${results.filter(Boolean).length}/${results.length} bestanden`);
process.exit(results.every(Boolean) ? 0 : 1);
