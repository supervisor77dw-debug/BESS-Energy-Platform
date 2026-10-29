// Prüft die Notfall-Wiederherstellung auf einer laufenden Instanz OHNE sie zu benutzen (AW-014):
// ausschließlich GET-Abrufe – kein Absenden, kein Fehlversuch, kein Verbrauch des einmaligen Codes.
// Aktiv = Formular erscheint (setzt gültige BESS_RECOVERY, nicht abgelaufen, nicht verbraucht, Zielkonto aktiv und Administrator).
// Aufruf: node tools/preview/verify-wiederherstellung.mjs --url https://… [--erwartet aktiv|inaktiv]
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const base = arg('--url').replace(/\/$/, '');
const erwartet = arg('--erwartet') || 'aktiv';
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'OK  ' : 'FEHL'} ${name}${detail ? ' – ' + detail : ''}`); };

const r = await fetch(base + '/portal/wiederherstellen', { redirect: 'manual' });
const b = await r.text();
if (erwartet === 'aktiv') {
  check('Wiederherstellungsseite aktiv (gültige Einrichtung, Zielkonto aktiv und Administrator)', r.status === 200 && /Administratorzugang wiederherstellen/.test(b), String(r.status));
  check('Formular sendet per POST an dieselbe Adresse, Code-Feld verdeckt', /method="post" action="\/portal\/wiederherstellen"/.test(b) && /name="code" type="password"/.test(b));
  check('kein Code, keine Prüfsumme, keine Kennung im Seiteninhalt', !/[0-9a-f]{64}/.test(b) && !/wh-\d{12}/.test(b));
  check('E-Mail-Adresse des Zielkontos wird nicht vorausgefüllt oder angezeigt', !/@abnahme\.stromkai\.invalid/.test(b));
} else check('Wiederherstellung nicht verfügbar', r.status === 404, String(r.status));
const q = await fetch(base + '/portal/wiederherstellen?code=x&t=y', { redirect: 'manual' });
check('Parameter in der URL werden ignoriert (kein Code per Link)', q.status === r.status && !/value="x"|value="y"/.test(await q.text()));
check('keine Zwischenspeicherung der Seite', !/public/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control') || '–');
console.log(`\n${results.filter(Boolean).length}/${results.length} bestanden`);
process.exit(results.every(Boolean) ? 0 : 1);
