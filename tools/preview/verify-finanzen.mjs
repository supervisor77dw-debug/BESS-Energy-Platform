// Prüfung der Finanzmodule (AW-STROMKAI-20261029-DESIGN-FINANCE-010) gegen eine laufende geschützte Instanz.
// Prüft je Rolle Sichtbarkeit und Rechte von Projektwirtschaftlichkeit, Vergütungsrechner, „Meine Vergütung“, Investorenkennzahlen,
// Handelsdaten und Exporten sowie Demo-Kennzeichnung. Schreibt nichts außer Anmeldungen (kein Neuberechnen, keine Zahlung, kein Import).
// Steht bei einem Konto der Pflicht-Passwortwechsel noch aus, wird er über ein zufälliges Zwischenpasswort durchlaufen und das
// Startpasswort aus der Zugangsdatei sofort zurückgesetzt (wie verify-qa-regression). Gibt keine Zugangsdaten aus.
// Aufruf: [BESS_SHARE_URL=…] node tools/preview/verify-finanzen.mjs --url <basis> --zugaenge <ZUGAENGE_…txt> [--dscr 1,15]
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const base = arg('--url').replace(/\/$/, '');
const txt = readFileSync(arg('--zugaenge'), 'utf8');
const gate = Object.fromEntries([...txt.matchAll(/Prüferkennung: (\w+)\s+Passwort: (\S+)/g)].map((m) => [m[1], m[2]]));
const pw = Object.fromEntries([...txt.matchAll(/(\S+@\S+\.invalid)\s+Passwort: (\S+)/g)].map((m) => [m[1], m[2]]));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'OK  ' : 'FEHL'} ${name}${detail ? ' – ' + detail : ''}`); };
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

async function sitzung(email, label) {
  const c = new C();
  if (share) await c.req(share);
  const [, gb] = await c.text('/_vorschau/anmelden');
  const g = await c.form('/_vorschau/anmelden', { _t: tok(gb, '_t'), next: '/', user: 'dirk', password: gate.dirk });
  if (g.status !== 303) { check(`${label}: Vorschau-Schranke`, false, `Status ${g.status}`); return null; }
  const [, lb] = await c.text('/portal/login');
  const l = await c.form('/portal/anmelden', { _t: tok(lb, '_t'), email, password: pw[email] });
  if (l.status !== 303) { check(`${label}: Anmeldung`, false, `Status ${l.status}`); return null; }
  if (loc(l) === '/portal/passwort') {
    const zw = `Zw-${randomBytes(9).toString('base64url')}-7!`;
    let [, pb] = await c.text('/portal/passwort');
    const w = await c.form('/portal/passwort', { _csrf: tok(pb, '_csrf'), current: pw[email], neu: zw, neu2: zw });
    [, pb] = await c.text('/portal/passwort');
    const z = await c.form('/portal/passwort', { _csrf: tok(pb, '_csrf'), current: zw, neu: pw[email], neu2: pw[email] });
    check(`${label}: offener Pflichtwechsel durchlaufen, Startpasswort wiederhergestellt`, w.status === 303 && z.status === 303);
  } else if (loc(l) === '/portal/mfa') { check(`${label}: Anmeldung ohne MFA-Abfrage`, false, 'MFA verlangt'); return null; }
  check(`${label}: angemeldet`, (await c.req('/portal')).status === 200);
  return c;
}
const st = async (c, p) => (await c.req(p)).status;

// Administration
const a = await sitzung('dirk@bess-vorschau.invalid', 'Administration');
if (a) {
  const [r1, b1] = await a.text('/portal/wirtschaftlichkeit');
  check('Admin: Übersicht Wirtschaftlichkeit mit allen Demo-SPVs', r1.status === 200 && /DEMO-N01/.test(b1) && /DEMO-S01/.test(b1));
  const [r2, b2] = await a.text('/portal/wirtschaftlichkeit/p-n01');
  check('Admin: Projektakte mit Szenarien, Kennzahlen und Metadaten', r2.status === 200 && ['Konservativ', 'Basis', 'Optimistisch', 'DSCR minimal', 'Projekt-IRR', 'Eigenkapital-IRR', 'Kapitalwert', 'STROMKAI-WM 1.1', 'Prüfsumme', 'synthetisch'].every((t) => b2.includes(t)));
  const dscr = arg('--dscr');
  if (dscr) check(`Admin: Basis-DSCR der Demo ${dscr}×`, b2.includes(`${dscr}×`));
  check('Admin: Eingabe Batterieverschleiß vorhanden', /Batterieverschleiß/.test(b2));
  const csv = await a.req('/portal/wirtschaftlichkeit/p-n01/export.csv');
  const ct = await csv.text();
  check('Admin: CSV-Export mit Modellversion und Semikolon', csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type') || '') && /STROMKAI-WM 1.1/.test(ct) && ct.includes(';'));
  const [r3, b3] = await a.text('/portal/verguetung/p-s01');
  check('Admin: Vergütung intern mit Vertragsstufen und Nachtrag', r3.status === 200 && /Unterzeichneter Vertrag/.test(b3) && /Nachtrag/.test(b3));
  const [r4, b4] = await a.text('/portal/admin/handelsdaten');
  check('Admin: Handelsdaten-Seite, Demo-Daten gekennzeichnet', r4.status === 200 && /2028-01/.test(b4) && /synthetisch/.test(b4));
  check('Admin: keine Handelsauftrags-Funktion', !/(Order|Gebot|Handelsauftrag) (senden|absenden|platzieren)/i.test(b2 + b4));
}

// Projektleitung
const pl = await sitzung('projektleitung@demo.invalid', 'Projektleitung');
if (pl) {
  check('Projektleitung: zugeordnete Akte Nord B sichtbar', await st(pl, '/portal/wirtschaftlichkeit/p-n02') === 200);
  check('Projektleitung: fremde Akte Süd A verborgen (404)', await st(pl, '/portal/wirtschaftlichkeit/p-s01') === 404);
  check('Projektleitung: keine Handelsdaten', await st(pl, '/portal/admin/handelsdaten') === 404);
}

// Vertrieb (Markus)
const m = await sitzung('markus@bess-vorschau.invalid', 'Markus');
if (m) {
  const [r, b] = await m.text('/portal/verguetung/p-n01');
  check('Markus: Vergütungsrechner erreichbar', r.status === 200 && /Simulation/.test(b));
  check('Markus: keine internen Projektkosten im Rechner', !/Gesamtinvestition|Schuldendienst|Eigenkapital|Handelsumsätze|Day-Ahead|Regelreserve/.test(b));
  for (const p of ['/portal/wirtschaftlichkeit/p-n01', '/portal/wirtschaftlichkeit/p-n01/export.csv', '/portal/admin/handelsdaten', '/portal/admin/benutzer'])
    check(`Markus: ${p} nicht erreichbar`, [403, 404].includes(await st(m, p)));
}

// Eigentümer A
const e = await sitzung('eigentuemer.a@demo.invalid', 'Eigentümer A');
if (e) {
  const [r, b] = await e.text('/portal/verguetung');
  check('Eigentümer A: Meine Vergütung mit Vereinbart/Fällig/Bezahlt/Prognose', r.status === 200 && ['Vereinbart', 'Fällig', 'Bezahlt', 'Prognose'].every((t) => b.includes(t)));
  check('Eigentümer A: Demo-Buchung nicht als reale Zahlung', /keine reale Zahlung/.test(b));
  check('Eigentümer A: Demo-Verträge gekennzeichnet, keine Zahlungsansprüche', /Demo-Vertrag/.test(b) && /begründen keine Zahlungsansprüche/.test(b));
  check('Eigentümer A: nur eigene Verträge (kein Süd A, kein Nord B)', !/Demo-Standort Süd|Demo-Standort Nord B/.test(b));
  check('Eigentümer A: keine Projektkalkulation', !/Gesamtinvestition|Schuldendienst|Projekt-IRR/.test(b) && await st(e, '/portal/wirtschaftlichkeit/p-n01') === 404);
  const pdf = await e.req('/portal/verguetung/vertrag/k-1/pdf');
  check('Eigentümer A: PDF der eigenen Übersicht', pdf.status === 200 && /pdf/.test(pdf.headers.get('content-type') || ''));
  check('Eigentümer A: PDF fremden Vertrags verweigert', [403, 404].includes(await st(e, '/portal/verguetung/vertrag/k-3/pdf')));
}

// Investor A
const i = await sitzung('investor.a@demo.invalid', 'Investor A');
if (i) {
  const [r, b] = await i.text('/portal/projekte/p-n01');
  check('Investor A: freigegebene Kennzahlen Nord A sichtbar', r.status === 200 && /Projekt-IRR/.test(b) && /Gesamtinvestition/.test(b));
  check('Investor A: keine Kostenpositionen/Strategie', !/Batteriesysteme|Day-Ahead|Regelreserve|Vermarktungskosten/.test(b));
  check('Investor A: keine Projektakte, keine Vergütungsseiten', await st(i, '/portal/wirtschaftlichkeit/p-n01') === 404 && [403, 404].includes(await st(i, '/portal/verguetung/p-n01')));
}

const fail = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - fail}/${results.length} bestanden`);
process.exit(fail ? 1 : 0);
