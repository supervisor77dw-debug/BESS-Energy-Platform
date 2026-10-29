// Geldbeträge, Rundung und Formatierung (EUR). Rechnen in Gleitkomma, gerundet wird an definierten Stellen:
// Zahlungsansprüche und Ausgaben auf volle Cent (kaufmännisch, halbe Cent vom Nullpunkt weg), Kennzahlen nur in der Anzeige.
export const WAEHRUNG = 'EUR';

export function cent(x) {
  if (!Number.isFinite(x)) throw new RangeError(`Kein gültiger Betrag: ${x}`);
  const s = Math.sign(x), a = Math.abs(x);
  // Korrektur gegen binäre Darstellungsfehler (z. B. 1.005 → 1.01)
  return s * Math.round((a + Number.EPSILON * a) * 100 + 1e-9) / 100;
}
export const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const sumCent = (xs) => cent(sum(xs.map(cent)));

const fmtEur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: WAEHRUNG, minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtEur0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: WAEHRUNG, maximumFractionDigits: 0 });
export const eur = (x, ganz = false) => (x == null || !Number.isFinite(x) ? '–' : (ganz ? fmtEur0 : fmtEur).format(ganz ? x : cent(x)));
export const num = (x, d = 0) => (x == null || !Number.isFinite(x) ? '–' : new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(x));
export const pct = (x, d = 1) => (x == null || !Number.isFinite(x) ? '–' : `${num(x * 100, d)} %`);

// Zahlenwerte aus deutschsprachigen Formularen („1.234,56“ oder „1234.56“)
export function parseZahl(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(/\s|€|%/g, '');
  if (!s) return NaN;
  // deutsches Format: Tausenderpunkte (3.000 / 1.234.567,89) und Dezimalkomma; sonst Punkt als Dezimaltrenner
  const deutsch = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /,\d+$/.test(s) || (s.includes(',') && !s.includes('.'));
  const n = deutsch ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  return Number(n);
}
