// Minimaler, sicherer Templating-Helfer: alle Interpolationen werden escaped,
// außer sie sind ausdrücklich als raw() markiert oder stammen aus html``.
class Raw { constructor(s) { this.s = String(s); } toString() { return this.s; } }

export const raw = (s) => new Raw(s);

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Raw(out);
}

export const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }) : '–';
export const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }) : '–';
export const fmtNum = (n, d = 0) => n == null ? '–' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
