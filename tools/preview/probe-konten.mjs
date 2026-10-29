// Prüft NICHT VERBRAUCHEND den Zustand persönlicher Konten der öffentlichen Abnahmestufe:
// Anmeldung mit Startpasswort bis zur MFA- bzw. Passwortwechsel-Stufe, danach Abbruch (keine MFA-Einrichtung, kein Passwortwechsel).
// Nebenwirkung: Zeitpunkt der letzten Anmeldung wird aktualisiert.
// Ergebnis je Konto: „Startzugang unbenutzt“ (→ /portal/mfa mit Ersteinrichtung), „MFA eingerichtet“ oder
// „eigenes Passwort gesetzt“ (Startpasswort abgelehnt). Gibt keine Zugangsdaten aus.
// Aufruf: node tools/preview/probe-konten.mjs --url https://… --zugaenge <ZUGAENGE_STROMKAI-Abnahme_…txt>
import { readFileSync } from 'node:fs';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const base = arg('--url').replace(/\/$/, '');
const txt = readFileSync(arg('--zugaenge'), 'utf8');
const acc = [...txt.matchAll(/Benutzername \(E-Mail-Feld\):\s+(\S+)\s+Startpasswort \(einmalig\):\s+(\S+)/g)].map((m) => [m[1], m[2]]);
for (const [email, pw] of acc) {
  const jar = {};
  const req = async (p, o = {}) => { const r = await fetch(base + p, { redirect: 'manual', ...o, headers: { ...(o.headers || {}), cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } }); for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; };
  const lb = await (await req('/portal/login')).text();
  const t = /name="_t" value="([^"]+)"/.exec(lb)?.[1];
  const l = await req('/portal/anmelden', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _t: t, email, password: pw }).toString() });
  let state = `Status ${l.status}`;
  if (l.status === 401) state = 'Startpasswort nicht mehr gültig → eigenes Passwort gesetzt (Konto in Nutzung)';
  else if (l.headers.get('location') === '/portal/passwort') state = 'Anmeldung nur mit E-Mail und Passwort erfolgreich (keine MFA); Startzugang unbenutzt, einmaliger Passwortwechsel steht aus';
  else if (l.status === 303 && l.headers.get('location') !== '/portal/mfa') state = `Anmeldung ohne MFA erfolgreich → ${l.headers.get('location')}`;
  else if (l.headers.get('location') === '/portal/mfa') {
    const mb = await (await req('/portal/mfa')).text();
    state = /Zweiten Faktor einrichten/.test(mb) ? 'Startzugang unbenutzt (MFA-Ersteinrichtung wartet)' : 'Startpasswort gültig, MFA bereits eingerichtet';
  }
  console.log(`${email.split('@')[0]}: ${state}`);
}
