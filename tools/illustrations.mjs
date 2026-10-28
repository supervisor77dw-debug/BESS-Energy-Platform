// Erzeugt die technischen Illustrationen als SVG (static/img). Alle Motive sind beispielhaft,
// zeigen keine gebaute Anlage und enthalten keine Herstellerlogos.
// Aufruf: node tools/illustrations.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'img');
mkdirSync(OUT, { recursive: true });

export const C = {
  ink: '#16302d', ink2: '#3d5653', line: '#8a9a96', pale: '#dfe5e2', paper: '#f4f6f4', white: '#fbfcfb',
  copper: '#9c5424', copperLight: '#d9a27a', teal: '#256f68', tealLight: '#9cc9c2',
  field1: '#c9d6b8', field2: '#b7c9a3', field3: '#d8dfc6', knick: '#5f7f4e', knick2: '#4b6a3d', gravel: '#d7d6cf', sky: '#e8eeec', road: '#c4c3bb',
};
const f = (n) => Math.round(n * 10) / 10;
const svg = (w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t"><title id="t">${title}</title>
<style>text{font-family:"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;fill:${C.ink}}.lbl{font-size:15px}.lbl-s{font-size:12.5px;fill:${C.ink2}}.lbl-b{font-size:17px;font-weight:600}</style>
${body}</svg>`;

// ---------- Primitive ----------
// Container in Schrägansicht: Front (w×h), Dach versetzt um (dx,dy)
export function container(x, y, w = 120, h = 44, dx = 22, dy = -12, opt = {}) {
  const front = opt.front || C.white, top = opt.top || '#eef1ef', side = opt.side || '#cfd7d4';
  let s = `<g>`;
  s += `<polygon points="${f(x)},${f(y)} ${f(x + dx)},${f(y + dy)} ${f(x + w + dx)},${f(y + dy)} ${f(x + w)},${f(y)}" fill="${top}" stroke="${C.line}" stroke-width="1"/>`;
  s += `<polygon points="${f(x + w)},${f(y)} ${f(x + w + dx)},${f(y + dy)} ${f(x + w + dx)},${f(y + dy + h)} ${f(x + w)},${f(y + h)}" fill="${side}" stroke="${C.line}" stroke-width="1"/>`;
  s += `<rect x="${f(x)}" y="${f(y)}" width="${w}" height="${h}" fill="${front}" stroke="${C.line}" stroke-width="1"/>`;
  const doors = opt.doors ?? 4;
  for (let i = 1; i < doors; i++) s += `<line x1="${f(x + (w * i) / doors)}" y1="${f(y + 3)}" x2="${f(x + (w * i) / doors)}" y2="${f(y + h - 3)}" stroke="${C.pale}" stroke-width="1"/>`;
  s += `<rect x="${f(x + w - 16)}" y="${f(y + 6)}" width="10" height="${f(h * 0.35)}" fill="none" stroke="${C.line}" stroke-width=".8"/>`;
  return s + `</g>`;
}
export function turbine(x, y, h, rot = 0, sw = 2) {
  const hub = [x, y - h];
  let s = `<line x1="${x}" y1="${y}" x2="${x}" y2="${f(y - h)}" stroke="${C.line}" stroke-width="${sw}"/>`;
  for (let i = 0; i < 3; i++) {
    const a = ((rot + i * 120) * Math.PI) / 180, L = h * 0.42;
    s += `<line x1="${hub[0]}" y1="${f(hub[1])}" x2="${f(hub[0] + Math.cos(a) * L)}" y2="${f(hub[1] + Math.sin(a) * L)}" stroke="${C.line}" stroke-width="${sw * 0.8}" stroke-linecap="round"/>`;
  }
  return s + `<circle cx="${hub[0]}" cy="${f(hub[1])}" r="${sw * 1.2}" fill="${C.line}"/>`;
}
export function pylon(x, y, h, w = 34) {
  const top = y - h;
  let s = `<g stroke="${C.ink2}" stroke-width="1.4" fill="none">`;
  s += `<path d="M${f(x - w / 2)},${y} L${f(x - 4)},${f(top)} L${f(x + 4)},${f(top)} L${f(x + w / 2)},${y}"/>`;
  for (let i = 1; i < 6; i++) { const yy = y - (h * i) / 6, ww = w / 2 - ((w / 2 - 4) * i) / 6; s += `<line x1="${f(x - ww)}" y1="${f(yy)}" x2="${f(x + ww)}" y2="${f(yy)}"/>`; }
  s += `<line x1="${f(x - w * 0.9)}" y1="${f(top + h * 0.12)}" x2="${f(x + w * 0.9)}" y2="${f(top + h * 0.12)}"/><line x1="${f(x - w * 0.7)}" y1="${f(top + h * 0.3)}" x2="${f(x + w * 0.7)}" y2="${f(top + h * 0.3)}"/>`;
  return s + `</g>`;
}
export function tree(x, y, r, col = C.knick) {
  return `<circle cx="${f(x)}" cy="${f(y - r)}" r="${f(r)}" fill="${col}"/><circle cx="${f(x + r * 0.7)}" cy="${f(y - r * 0.8)}" r="${f(r * 0.75)}" fill="${C.knick2}" opacity=".55"/>`;
}
export function knick(x1, x2, y, seed = 1, scale = 1) {
  let s = `<rect x="${x1}" y="${f(y - 6 * scale)}" width="${x2 - x1}" height="${f(8 * scale)}" fill="${C.knick2}" opacity=".5" rx="3"/>`;
  let r = seed;
  for (let x = x1; x < x2; x += 14 * scale) { r = (r * 9301 + 49297) % 233280; s += tree(x, y, (7 + (r / 233280) * 9) * scale, r % 3 ? C.knick : C.knick2); }
  return s;
}
function transformer(x, y, s = 1) {
  return `<g><rect x="${x}" y="${f(y - 34 * s)}" width="${f(44 * s)}" height="${f(34 * s)}" fill="${C.pale}" stroke="${C.ink2}" stroke-width="1.2"/>`
    + [0, 1, 2].map((i) => `<rect x="${f(x + (6 + i * 13) * s)}" y="${f(y - 48 * s)}" width="${f(5 * s)}" height="${f(14 * s)}" fill="${C.copperLight}" stroke="${C.ink2}" stroke-width=".8"/>`).join('')
    + `<g stroke="${C.line}" stroke-width="1">${[0, 1, 2, 3, 4].map((i) => `<line x1="${f(x + 4 * s)}" y1="${f(y - 28 * s + i * 5 * s)}" x2="${f(x + 40 * s)}" y2="${f(y - 28 * s + i * 5 * s)}"/>`).join('')}</g></g>`;
}
function gantry(x, y, w, h) {
  return `<g stroke="${C.ink2}" stroke-width="1.3" fill="none"><line x1="${x}" y1="${y}" x2="${x}" y2="${y - h}"/><line x1="${x + w}" y1="${y}" x2="${x + w}" y2="${y - h}"/><line x1="${x - 6}" y1="${y - h}" x2="${x + w + 6}" y2="${y - h}"/><path d="M${x},${y - h + 10} L${x + w / 2},${y - h} L${x + w},${y - h + 10}"/></g>`;
}

// ---------- 1 Hero: Netzschnitt Norddeutschland ----------
export function heroSvg({ inline = false } = {}) {
  const W = 1600, H = 760, hz = 470;
  let b = `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe8e6"/><stop offset="1" stop-color="#f1f4f2"/></linearGradient></defs>`;
  b += `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  // ferne Windenergieanlagen
  [[120, 0.55, 10], [250, 0.62, 70], [380, 0.5, 35], [1180, 0.52, 50], [1330, 0.6, 15], [1460, 0.48, 85]].forEach(([x, s, r]) => { b += turbine(x, hz + 2, 190 * s, r, 1.6); });
  // Felder bis zum Horizont
  b += `<polygon points="0,${hz} ${W},${hz} ${W},${H} 0,${H}" fill="${C.field3}"/>`;
  b += `<polygon points="0,${hz + 40} ${W},${hz + 16} ${W},${hz + 90} 0,${hz + 140}" fill="${C.field1}"/>`;
  b += `<polygon points="0,${hz + 220} ${W},${hz + 150} ${W},${H} 0,${H}" fill="${C.field2}"/>`;
  b += knick(0, 620, hz + 8, 3, 0.9) + knick(1040, W, hz + 4, 7, 0.9);
  // Hochspannungstrasse
  const pyl = [[70, hz + 120, 230], [400, hz + 70, 200], [700, hz + 40, 170]];
  pyl.forEach(([x, y, h]) => { b += pylon(x, y, h); });
  for (const k of [0.12, 0.3]) for (const side of [-1, 1]) {
    const pts = pyl.map(([x, y, h]) => [x + side * 30 * (k === 0.12 ? 0.9 : 0.7), y - h + h * k]);
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, c] = [pts[i], pts[i + 1]]; const mx = (a[0] + c[0]) / 2, my = (a[1] + c[1]) / 2 + 22;
      b += `<path d="M${f(a[0])},${f(a[1])} Q${f(mx)},${f(my)} ${f(c[0])},${f(c[1])}" stroke="${C.ink2}" stroke-width="1" fill="none"/>`;
    }
  }
  // Umspannwerk
  b += `<polygon points="680,${hz + 70} 980,${hz + 58} 1010,${hz + 120} 690,${hz + 138}" fill="${C.gravel}"/>`;
  [[720, hz + 118, 50, 70], [790, hz + 114, 50, 74], [860, hz + 110, 50, 70]].forEach(([x, y, w, h]) => { b += gantry(x, y, w, h); });
  b += transformer(925, hz + 118, 1.1);
  b += `<path d="M700,${f(hz + 40 - 170 + 20)} L745,${hz + 48}" stroke="${C.ink2}" stroke-width="1" fill="none"/>`;
  // Speicheranlage im Vordergrund
  const gx = 760, gy = 610;
  b += `<polygon points="${gx - 40},${gy + 110} ${gx + 760},${gy + 70} ${gx + 840},${gy - 60} ${gx + 70},${gy - 30}" fill="${C.gravel}"/>`;
  // Zaun
  b += `<polyline points="${gx - 40},${gy + 110} ${gx + 760},${gy + 70} ${gx + 840},${gy - 60}" fill="none" stroke="${C.line}" stroke-width="1.2" stroke-dasharray="2 5"/>`;
  for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++) {
    const x = gx + 70 + i * 165 + row * 40, y = gy - 4 + row * 52 - i * 6;
    b += container(x, y, 128, 42, 20, -11);
  }
  b += `<g>${[0, 1].map((i) => `<rect x="${gx + 10 + i * 30}" y="${gy + 30 - i * 3}" width="22" height="28" fill="${C.pale}" stroke="${C.ink2}" stroke-width="1"/>`).join('')}</g>`;
  b += transformer(gx + 690, gy + 92, 0.9);
  // Zufahrt
  b += `<polygon points="${gx - 40},${gy + 110} ${gx + 20},${gy + 106} ${gx - 120},${H} ${gx - 240},${H}" fill="${C.road}"/>`;
  b += knick(gx + 860, W, gy + 70, 11, 1.5) + knick(0, 420, H - 20, 5, 1.7);
  // Stromflusslinie (Erdkabel): Windpark → Umspannwerk → Speicher
  const flow = `M330,${hz + 4} C470,${hz + 30} 560,${hz + 60} 700,${hz + 108} S900,${hz + 132} 950,${hz + 128} S1050,${gy - 10} ${gx + 300},${gy + 36}`;
  b += `<path d="${flow}" fill="none" stroke="${C.copper}" stroke-width="2.2" stroke-dasharray="7 6" opacity=".55"/>`;
  b += `<path class="flow-pulse" d="${flow}" fill="none" stroke="${C.copper}" stroke-width="3.2" stroke-linecap="round" pathLength="1000"/>`;
  return inline
    ? `<svg class="hero-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false">${b}</svg>`
    : svg(W, H, b, 'Beispielhafte Illustration: Batteriespeicher neben einem Umspannwerk in norddeutscher Landschaft');
}

// ---------- 2 Perspektive mit Landschaftseinbindung ----------
function perspektive() {
  const W = 1600, H = 900;
  let b = `<rect width="${W}" height="${H}" fill="${C.sky}"/><polygon points="0,420 ${W},400 ${W},${H} 0,${H}" fill="${C.field1}"/>`;
  b += turbine(1350, 405, 150, 30, 1.5) + turbine(1460, 410, 120, 80, 1.4);
  b += knick(0, W, 420, 2, 1.1);
  b += `<polygon points="180,780 1340,730 1450,520 330,545" fill="${C.gravel}"/>`;
  for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) b += container(330 + i * 250 + row * 35, 585 + row * 62 - i * 7, 190, 54, 26, -14);
  b += transformer(1230, 735, 1.3) + transformer(1300, 728, 1.3);
  b += `<polyline points="180,780 1340,730 1450,520" fill="none" stroke="${C.line}" stroke-width="1.4" stroke-dasharray="2 6"/>`;
  b += knick(80, 700, 860, 9, 2.1) + knick(1000, 1600, 830, 4, 2.2);
  b += `<polygon points="120,${H} 300,780 340,780 220,${H}" fill="${C.road}"/>`;
  b += `<g class="lbl-s"><text x="350" y="500">Einfriedung mit Abstand zur Wallhecke</text><text x="1120" y="815">Transformatoren</text><text x="250" y="885">Zufahrt für Bau, Wartung und Feuerwehr</text><text x="40" y="400">Bestehender Knick bleibt erhalten und wird ergänzt</text></g>`;
  return svg(W, H, b, 'Beispielhafte Illustration: Speicheranlage mit Eingrünung durch Wallhecken');
}

// ---------- 3 Luftbildartige Draufsicht nahe Umspannwerk ----------
function luftbild() {
  const W = 1600, H = 900;
  let b = `<rect width="${W}" height="${H}" fill="${C.field3}"/>`;
  const fields = [[0, 0, 520, 380, C.field1], [520, 0, 600, 300, C.field2], [1120, 0, 480, 420, C.field1], [0, 380, 640, 520, C.field2], [640, 300, 520, 600, C.field3], [1160, 420, 440, 480, C.field2]];
  fields.forEach(([x, y, w, h, c]) => { b += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`; for (let i = 14; i < h; i += 18) b += `<line x1="${x + 6}" y1="${y + i}" x2="${x + w - 6}" y2="${y + i}" stroke="#fff" stroke-opacity=".18"/>`; });
  // Knicks als Feldgrenzen
  [[0, 380, 640, 380], [640, 300, 640, 900], [520, 0, 520, 380], [1120, 0, 1120, 300], [1160, 420, 1600, 420]].forEach(([a, c, d, e]) => { b += `<line x1="${a}" y1="${c}" x2="${d}" y2="${e}" stroke="${C.knick}" stroke-width="14" stroke-linecap="round"/>`; });
  // Straße
  b += `<path d="M0,620 C400,600 900,640 1600,560" stroke="${C.road}" stroke-width="22" fill="none"/>`;
  // Umspannwerk
  b += `<rect x="220" y="120" width="230" height="170" fill="${C.gravel}" stroke="${C.line}"/>`;
  for (let i = 0; i < 4; i++) b += `<rect x="${240 + i * 52}" y="140" width="34" height="60" fill="none" stroke="${C.ink2}"/>`;
  b += `<rect x="250" y="220" width="60" height="44" fill="${C.pale}" stroke="${C.ink2}"/><rect x="340" y="220" width="60" height="44" fill="${C.pale}" stroke="${C.ink2}"/>`;
  // Freileitung
  b += `<path d="M0,170 L220,190 M450,200 L1600,90" stroke="${C.ink2}" stroke-width="2" stroke-dasharray="1 0"/>`;
  [[110, 180], [700, 175], [1000, 147], [1350, 113]].forEach(([x, y]) => { b += `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" fill="none" stroke="${C.ink2}" stroke-width="2"/>`; });
  // Speicher
  b += `<rect x="700" y="380" width="360" height="200" fill="${C.gravel}" stroke="${C.line}" stroke-dasharray="3 5"/>`;
  for (let r = 0; r < 3; r++) for (let i = 0; i < 5; i++) b += `<rect x="${725 + i * 64}" y="${400 + r * 50}" width="50" height="22" fill="${C.white}" stroke="${C.ink2}"/>`;
  b += `<rect x="1010" y="400" width="34" height="34" fill="${C.pale}" stroke="${C.ink2}"/>`;
  // Kabeltrasse
  b += `<path d="M450,240 C560,260 620,330 700,420" stroke="${C.copper}" stroke-width="3.5" fill="none" stroke-dasharray="10 7"/>`;
  b += `<path d="M880,580 L880,610" stroke="${C.road}" stroke-width="12"/>`;
  b += `<g><rect x="40" y="790" width="560" height="84" fill="${C.white}" opacity=".92"/><g class="lbl-s"><line x1="60" y1="815" x2="100" y2="815" stroke="${C.copper}" stroke-width="3.5" stroke-dasharray="10 7"/><text x="112" y="820">Erdkabel zum Umspannwerk (Trasse projektabhängig)</text><rect x="60" y="836" width="40" height="18" fill="${C.gravel}" stroke="${C.line}" stroke-dasharray="3 5"/><text x="112" y="850">Betriebsfläche Speicher mit Einfriedung</text></g></g>`;
  b += `<g class="lbl"><text x="232" y="110">Umspannwerk</text><text x="712" y="370">Speicheranlage</text></g>`;
  return svg(W, H, b, 'Beispielhafte Illustration: Draufsicht auf Speicheranlage nahe einem Umspannwerk');
}

// ---------- 4 Schnitt durch ein Batteriesystem ----------
function schnitt() {
  const W = 1600, H = 900;
  let b = `<rect width="${W}" height="${H}" fill="${C.paper}"/>`;
  const x0 = 160, y0 = 220, w = 980, h = 420;
  b += `<polygon points="${x0},${y0} ${x0 + 80},${y0 - 60} ${x0 + w + 80},${y0 - 60} ${x0 + w},${y0}" fill="#eef1ef" stroke="${C.ink2}"/>`;
  b += `<polygon points="${x0 + w},${y0} ${x0 + w + 80},${y0 - 60} ${x0 + w + 80},${y0 + h - 60} ${x0 + w},${y0 + h}" fill="#d4dbd8" stroke="${C.ink2}"/>`;
  b += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="${C.white}" stroke="${C.ink2}" stroke-width="1.5"/>`;
  // Racks
  for (let r = 0; r < 6; r++) {
    const rx = x0 + 40 + r * 118;
    b += `<rect x="${rx}" y="${y0 + 40}" width="96" height="${h - 80}" fill="#e9eeec" stroke="${C.ink2}"/>`;
    for (let m = 0; m < 8; m++) b += `<rect x="${rx + 8}" y="${y0 + 52 + m * 40}" width="80" height="30" fill="${m % 2 ? '#dce6e3' : '#e4ecea'}" stroke="${C.line}"/><rect x="${rx + 12}" y="${y0 + 60 + m * 40}" width="20" height="4" fill="${C.teal}" opacity=".6"/>`;
  }
  // BMS / Schaltschrank, Klima, Brandschutz
  b += `<rect x="${x0 + 760}" y="${y0 + 40}" width="80" height="${h - 80}" fill="${C.pale}" stroke="${C.ink2}"/>`;
  b += `<rect x="${x0 + 860}" y="${y0 + 40}" width="90" height="150" fill="#e3ebf0" stroke="${C.ink2}"/>`;
  for (let i = 0; i < 6; i++) b += `<line x1="${x0 + 870}" y1="${y0 + 60 + i * 20}" x2="${x0 + 940}" y2="${y0 + 60 + i * 20}" stroke="${C.line}"/>`;
  b += `<rect x="${x0 + 860}" y="${y0 + 220}" width="90" height="160" fill="#f2e6dd" stroke="${C.ink2}"/>`;
  b += `<line x1="${x0 + 20}" y1="${y0 + 22}" x2="${x0 + 740}" y2="${y0 + 22}" stroke="${C.copper}" stroke-width="2"/>${[0, 1, 2, 3, 4, 5].map((i) => `<circle cx="${x0 + 88 + i * 118}" cy="${y0 + 22}" r="5" fill="${C.copper}"/>`).join('')}`;
  b += `<line x1="${x0 + 40}" y1="${y0 + h - 22}" x2="${x0 + 760}" y2="${y0 + h - 22}" stroke="${C.ink}" stroke-width="3"/>`;
  // PCS + Trafo außen
  b += `<rect x="1300" y="380" width="130" height="200" fill="${C.pale}" stroke="${C.ink2}"/><g stroke="${C.line}">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<line x1="1312" y1="${400 + i * 22}" x2="1418" y2="${400 + i * 22}"/>`).join('')}</g>`;
  b += transformer(1460, 640, 1.4);
  b += `<path d="M${x0 + w},${y0 + h - 22} L1300,${y0 + h - 22}" stroke="${C.ink}" stroke-width="3"/><path d="M1430,560 L1475,560 L1475,595" stroke="${C.copper}" stroke-width="3" fill="none"/>`;
  const L = (x1, y1, x2, y2, t, anchor = 'start') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.ink2}" stroke-width="1"/><circle cx="${x1}" cy="${y1}" r="3.5" fill="${C.ink}"/><text class="lbl" x="${x2 + (anchor === 'end' ? -6 : 6)}" y="${y2 + 5}" text-anchor="${anchor}">${t}</text>`;
  b += L(x0 + 140, y0 + 120, x0 + 140, 110, 'Batteriemodule (z. B. LFP) in Racks');
  b += L(x0 + 800, y0 + 200, x0 + 800, 110, 'Batteriemanagement (BMS) und Schaltgeräte');
  b += L(x0 + 905, y0 + 120, 1290, 150, 'Klimatisierung hält die Zellen im Temperaturfenster');
  b += L(x0 + 905, y0 + 300, 1290, 300, 'Branderkennung, Gas- und Rauchmelder, Löschkonzept');
  b += L(x0 + 300, y0 + 22, x0 + 300, 735, 'Gleichstromsammelschiene (DC)');
  b += L(1365, 480, 1365, 735, 'Wechselrichter / PCS: DC ↔ AC');
  b += L(1480, 600, 1480, 790, 'Transformator zur Netzebene');
  return svg(W, H, b, 'Beispielhafte Illustration: Schnitt durch ein containerisiertes Batteriesystem');
}

// ---------- 5 Energiefluss ----------
function energiefluss() {
  const W = 1600, H = 820;
  let b = `<rect width="${W}" height="${H}" fill="${C.paper}"/><defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.copper}"/></marker><marker id="at" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.teal}"/></marker></defs>`;
  const node = (x, y, w, h, t, s) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${C.white}" stroke="${C.ink2}" stroke-width="1.3"/><text class="lbl-b" x="${x + 18}" y="${y + 34}">${t}</text><text class="lbl-s" x="${x + 18}" y="${y + 58}">${s}</text>`;
  b += node(80, 90, 330, 90, 'Windenergie', 'wetterabhängige Einspeisung');
  b += node(80, 230, 330, 90, 'Photovoltaik', 'Erzeugungsspitze zur Mittagszeit');
  b += turbine(370, 170, 60, 20, 1.5);
  b += node(620, 320, 360, 120, 'Stromnetz', 'Übertragungs- und Verteilnetz');
  b += node(1180, 120, 340, 90, 'Verbraucher', 'Haushalte, Gewerbe, Industrie');
  b += `<rect x="620" y="560" width="360" height="150" rx="6" fill="${C.ink}"/><text x="645" y="600" style="fill:#fff;font-size:19px;font-weight:600">Batteriespeicher</text><text x="645" y="628" style="fill:#cfe0dc;font-size:13.5px">lädt bei Überschuss, speist bei Bedarf ein</text>`;
  for (let i = 0; i < 6; i++) b += `<rect x="${648 + i * 52}" y="${648}" width="40" height="40" fill="none" stroke="#5e807b"/><rect x="${652 + i * 52}" y="${652 + (i < 4 ? 0 : 18)}" width="32" height="${i < 4 ? 32 : 14}" fill="${C.tealLight}" opacity=".8"/>`;
  b += `<path d="M410,135 C520,135 560,330 618,350" stroke="${C.copper}" stroke-width="3" fill="none" marker-end="url(#ar)"/>`;
  b += `<path d="M410,275 C500,275 560,370 618,380" stroke="${C.copper}" stroke-width="3" fill="none" marker-end="url(#ar)"/>`;
  b += `<path d="M982,350 C1080,330 1100,170 1178,165" stroke="${C.copper}" stroke-width="3" fill="none" marker-end="url(#ar)"/>`;
  b += `<path d="M740,442 L740,556" stroke="${C.copper}" stroke-width="3.5" fill="none" marker-end="url(#ar)"/><text class="lbl" x="580" y="505" text-anchor="end">Laden: Überschuss aufnehmen</text>`;
  b += `<path d="M860,558 L860,444" stroke="${C.teal}" stroke-width="3.5" fill="none" marker-end="url(#at)"/><text class="lbl" x="878" y="505">Entladen: Leistung bereitstellen</text>`;
  b += `<g><rect x="1160" y="420" width="410" height="300" rx="6" fill="${C.white}" stroke="${C.pale}"/><text class="lbl-b" x="1200" y="456">Netzdienliche Aufgaben</text>${['Frequenzhaltung (Regelleistung)', 'Ausgleich zwischen Erzeugung und Verbrauch', 'Weniger Abregelung erneuerbarer Anlagen', 'Spannungs- und Blindleistungsstützung', 'Engpassmanagement in Abstimmung mit dem Netzbetreiber'].map((t, i) => `<circle cx="1206" cy="${492 + i * 42}" r="4" fill="${C.copper}"/><text class="lbl" x="1222" y="${497 + i * 42}">${t}</text>`).join('')}</g>`;
  return svg(W, H, b, 'Schema: Stromflüsse zwischen erneuerbaren Erzeugern, Netz, Verbrauchern und Batteriespeicher');
}

// ---------- 7 Gründung und Erschließung ----------
function gruendung() {
  const W = 1600, H = 820;
  let b = `<rect width="${W}" height="${H}" fill="${C.paper}"/>`;
  const g = 470;
  b += `<rect x="0" y="${g}" width="${W}" height="${H - g}" fill="#cdb99b"/><rect x="0" y="${g}" width="${W}" height="40" fill="#8f7a5b" opacity=".45"/>`;
  for (let i = 0; i < 160; i++) { const x = (i * 97) % W, y = g + 50 + ((i * 53) % (H - g - 60)); b += `<circle cx="${x}" cy="${y}" r="${1 + (i % 3)}" fill="#a8916f" opacity=".6"/>`; }
  // Schotterplanum
  b += `<rect x="220" y="${g - 6}" width="1060" height="46" fill="${C.gravel}" stroke="${C.line}"/>`;
  for (let i = 0; i < 140; i++) b += `<circle cx="${230 + ((i * 37) % 1040)}" cy="${g + 2 + ((i * 13) % 34)}" r="2.2" fill="#b4b3aa"/>`;
  // Streifenfundamente / Punktfundamente
  [[300, 'Streifen- oder Punktfundament nach Statik'], [700, ''], [1080, '']].forEach(([x]) => { b += `<rect x="${x}" y="${g - 18}" width="120" height="86" fill="#bfc4c1" stroke="${C.ink2}"/>`; });
  // Container
  b += container(280, g - 18 - 120, 300, 120, 0, 0, { doors: 6 }) + container(680, g - 18 - 120, 300, 120, 0, 0, { doors: 6 });
  b += `<rect x="1060" y="${g - 18 - 110}" width="160" height="110" fill="${C.pale}" stroke="${C.ink2}"/>`;
  // Kabelkanal, Entwässerung
  b += `<rect x="560" y="${g + 60}" width="160" height="40" fill="none" stroke="${C.copper}" stroke-width="2"/><circle cx="600" cy="${g + 80}" r="7" fill="${C.copper}"/><circle cx="640" cy="${g + 80}" r="7" fill="${C.copper}"/><circle cx="680" cy="${g + 80}" r="7" fill="${C.copper}"/>`;
  b += `<path d="M1300,${g + 30} L1420,${g + 90}" stroke="${C.teal}" stroke-width="10" stroke-linecap="round"/><path d="M1290,${g + 4} C1340,${g + 30} 1380,${g + 50} 1440,${g + 60}" stroke="${C.teal}" stroke-width="2" fill="none" stroke-dasharray="6 5"/>`;
  // Zufahrt + Abstand
  b += `<rect x="0" y="${g - 4}" width="200" height="22" fill="${C.road}"/>`;
  b += `<line x1="580" y1="${g - 170}" x2="680" y2="${g - 170}" stroke="${C.copper}" stroke-width="1.5"/><line x1="580" y1="${g - 178}" x2="580" y2="${g - 162}" stroke="${C.copper}"/><line x1="680" y1="${g - 178}" x2="680" y2="${g - 162}" stroke="${C.copper}"/>`;
  const T = (x, y, t, s = 'lbl') => `<text class="${s}" x="${x}" y="${y}">${t}</text>`;
  b += T(500, g - 186, 'Brandschutzabstand oder Trennwand nach Konzept');
  b += T(240, g + 160, 'Fundamente: Art und Größe nach Baugrundgutachten und Statik');
  b += T(240, g + 185, 'Schottertragschicht: wasserdurchlässig, aber verdichtet – keine vollständige Entsiegelung zugesichert', 'lbl-s');
  b += T(560, g + 130, 'Kabelkanäle / Leerrohre', 'lbl-s');
  b += T(1240, g + 130, 'Entwässerung und Versickerung nach Fachplanung', 'lbl-s');
  b += T(20, g - 16, 'Zufahrt (Feuerwehr, Wartung)', 'lbl-s');
  b += `<g><rect x="40" y="40" width="760" height="120" rx="6" fill="${C.white}" stroke="${C.pale}"/><text class="lbl-b" x="64" y="80">Flächenschonend, aber projektabhängig</text><text class="lbl" x="64" y="110">Wie viel Fläche befestigt wird, ergibt sich aus Baugrund, Tragfähigkeit,</text><text class="lbl" x="64" y="134">Entwässerung, Brandschutz und Zufahrten – nicht aus einem Standardversprechen.</text></g>`;
  return svg(W, H, b, 'Beispielhafte Illustration: Schnitt durch Gründung, Schottertragschicht und Erschließung');
}

// ---------- 8 Kommunale Energieinfrastruktur ----------
function kommunal() {
  const W = 1600, H = 860;
  let b = `<rect width="${W}" height="${H}" fill="${C.sky}"/><polygon points="0,520 ${W},500 ${W},${H} 0,${H}" fill="${C.field1}"/>`;
  b += knick(0, 300, 520, 6, 1) + knick(1300, W, 505, 8, 1);
  // Ortschaft
  const house = (x, y, w, h, c = C.white) => `<rect x="${x}" y="${y - h}" width="${w}" height="${h}" fill="${c}" stroke="${C.ink2}"/><polygon points="${x - 6},${y - h} ${x + w / 2},${y - h - w * 0.45} ${x + w + 6},${y - h}" fill="#b9a493" stroke="${C.ink2}"/>`;
  b += house(120, 600, 70, 60) + house(210, 610, 80, 70) + house(310, 600, 60, 55) + house(80, 680, 90, 70);
  b += `<rect x="400" y="500" width="40" height="120" fill="${C.white}" stroke="${C.ink2}"/><polygon points="396,500 420,440 444,500" fill="#b9a493" stroke="${C.ink2}"/>`;
  b += `<rect x="480" y="560" width="200" height="90" fill="#e7ece9" stroke="${C.ink2}"/><text class="lbl-s" x="490" y="590">Feuerwehr / Bauhof</text>`;
  b += `<rect x="260" y="700" width="260" height="90" fill="#e7ece9" stroke="${C.ink2}"/><text class="lbl-s" x="272" y="730">Schule / Mehrzweckhalle</text>`;
  // Netz
  b += `<path d="M150,540 C400,520 700,520 960,560" stroke="${C.ink2}" stroke-width="2" fill="none"/><path d="M520,745 C700,720 860,660 960,590" stroke="${C.ink2}" stroke-width="2" fill="none"/>`;
  b += `<rect x="930" y="540" width="80" height="70" fill="${C.pale}" stroke="${C.ink2}"/><text class="lbl-s" x="900" y="635">Ortsnetzstation</text>`;
  // Speicher
  for (let i = 0; i < 3; i++) b += container(1080 + i * 150, 640 - i * 6, 120, 44, 20, -11);
  b += `<path d="M1010,575 C1060,590 1080,620 1100,640" stroke="${C.copper}" stroke-width="3" fill="none"/>`;
  // optionale Inselnetzkomponenten gestrichelt
  b += `<rect x="1060" y="720" width="460" height="100" rx="6" fill="none" stroke="${C.copper}" stroke-width="2" stroke-dasharray="8 6"/><text class="lbl" x="1080" y="752">Optional, zusätzlich auszurüsten:</text><text class="lbl-s" x="1080" y="778">netzbildende Wechselrichter, Trennstellen, Schutzkonzept,</text><text class="lbl-s" x="1080" y="800">Abstimmung mit Netzbetreiber – kein Bestandteil jedes Speichers</text>`;
  b += `<path d="M1060,770 C900,800 700,790 520,760" stroke="${C.copper}" stroke-width="2" fill="none" stroke-dasharray="8 6"/>`;
  b += turbine(1450, 505, 170, 50, 1.8) + turbine(1540, 510, 140, 10, 1.6);
  b += `<g><rect x="40" y="40" width="720" height="110" rx="6" fill="${C.white}" stroke="${C.pale}"/><text class="lbl-b" x="64" y="80">Regulärer Betrieb: netzgekoppelt</text><text class="lbl" x="64" y="108">Der Speicher arbeitet für das Netz. Eine Versorgung einzelner Gebäude bei</text><text class="lbl" x="64" y="132">Netzausfall ist nur mit zusätzlicher Technik und eigener Planung möglich.</text></g>`;
  return svg(W, H, b, 'Beispielhafte Illustration: Speicher als Teil kommunaler Energieinfrastruktur');
}

// ---------- 9 Monitoring-Dashboard ----------
function monitoring() {
  const W = 1600, H = 900;
  let b = `<rect width="${W}" height="${H}" fill="#0f2422"/><rect x="0" y="0" width="${W}" height="64" fill="#16302d"/><text x="32" y="40" style="fill:#e7efed;font-size:19px;font-weight:600">Leitstand · Demo-Anlage (synthetische Werte)</text><text x="${W - 32}" y="40" text-anchor="end" style="fill:#9cc9c2;font-size:14px">Status: Betrieb normal</text>`;
  const panel = (x, y, w, h, t) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#16302d" stroke="#264743"/><text x="${x + 20}" y="${y + 32}" style="fill:#9fb7b3;font-size:14px">${t}</text>`;
  b += panel(32, 92, 360, 170, 'Ladezustand (SoC)') + `<text x="52" y="200" style="fill:#fff;font-size:56px;font-weight:600">64 %</text><rect x="52" y="222" width="320" height="12" rx="6" fill="#264743"/><rect x="52" y="222" width="205" height="12" rx="6" fill="${C.tealLight}"/>`;
  b += panel(412, 92, 360, 170, 'Wirkleistung am Netzanschluss') + `<text x="432" y="200" style="fill:#fff;font-size:56px;font-weight:600">−8,4 MW</text><text x="432" y="238" style="fill:#d9a27a;font-size:14px">Laden</text>`;
  b += panel(792, 92, 360, 170, 'Zelltemperatur (min / max)') + `<text x="812" y="200" style="fill:#fff;font-size:44px;font-weight:600">23,1 / 26,8 °C</text>`;
  b += panel(1172, 92, 396, 170, 'Sicherheit') + ['Branderkennung: bereit', 'Gasdetektion: unauffällig', 'Zugang: gesichert'].map((t, i) => `<circle cx="1196" cy="${160 + i * 32}" r="6" fill="#7bc29a"/><text x="1212" y="${165 + i * 32}" style="fill:#e7efed;font-size:15px">${t}</text>`).join('');
  b += panel(32, 284, 1120, 420, 'Leistung und Ladezustand – letzte 24 Stunden');
  let p = '', q = '';
  for (let i = 0; i <= 96; i++) {
    const x = 62 + i * 11, v = Math.sin(i / 9) * 110 + Math.sin(i / 3.1) * 25, s = 120 - Math.cos(i / 9) * 70;
    p += `${i ? 'L' : 'M'}${f(x)},${f(500 - v)} `; q += `${i ? 'L' : 'M'}${f(x)},${f(380 + s * 0.9)} `;
  }
  b += `<line x1="62" y1="500" x2="1120" y2="500" stroke="#264743"/><path d="${p}" stroke="#d9a27a" stroke-width="2.5" fill="none"/><path d="${q}" stroke="${C.tealLight}" stroke-width="2" fill="none" stroke-dasharray="5 4"/>`;
  b += `<text x="62" y="680" style="fill:#d9a27a;font-size:13px">Wirkleistung (MW, + Einspeisung / − Laden)</text><text x="420" y="680" style="fill:#9cc9c2;font-size:13px">Ladezustand (%)</text>`;
  b += panel(1172, 284, 396, 420, 'Ereignisse');
  ['06:12 Regelleistungsabruf beendet', '07:40 Wartungsfenster Rack 3 geplant', '11:05 Fahrplan Intraday aktualisiert', '13:58 Klimagerät 2 Filterhinweis', '15:20 Ladeprogramm gestartet'].forEach((t, i) => { b += `<text x="1192" y="${350 + i * 40}" style="fill:#e7efed;font-size:14.5px">${t}</text>`; });
  b += panel(32, 726, 1536, 140, 'Verfügbarkeit Racks') + Array.from({ length: 24 }, (_, i) => `<rect x="${52 + i * 62}" y="${780}" width="52" height="56" rx="4" fill="${i === 13 ? '#5b4a2e' : '#1f4a44'}" stroke="${i === 13 ? '#d9a27a' : '#2f6b63'}"/>`).join('');
  return svg(W, H, b, 'Beispielhafte Illustration: Betriebs- und Monitoring-Oberfläche mit synthetischen Werten');
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#16302d"/><rect x="7" y="13" width="26" height="16" rx="1" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M7 21h7l3-4 3 8 3-4h10" fill="none" stroke="#d9a27a" stroke-width="2.4" stroke-linejoin="round"/></svg>`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = { 'hero.svg': heroSvg(), 'standort-perspektive.svg': perspektive(), 'luftbild-umspannwerk.svg': luftbild(), 'schnitt-batteriesystem.svg': schnitt(),
    'energiefluss.svg': energiefluss(), 'gruendung-erschliessung.svg': gruendung(), 'kommunale-infrastruktur.svg': kommunal(), 'monitoring.svg': monitoring(), 'favicon.svg': favicon };
  for (const [n, s] of Object.entries(files)) writeFileSync(join(OUT, n), s);
  console.log('Illustrationen geschrieben:', Object.keys(files).join(', '));
}
