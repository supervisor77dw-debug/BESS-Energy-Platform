import { readFileSync } from 'node:fs';
import { html, raw } from '../lib/html.mjs';
import { brand, isPreview, config, brandLogo, realDomain } from '../config.mjs';

const previewNote = () => config.stage === 'abnahme'
  ? `Vorläufiger Abnahmekandidat · Arbeitsname „${brand.name}“ · Inhalte und Rechtstexte in Prüfung · Bilder sind Visualisierungen von Beispielanlagen`
  : `Interne QA-Vorschau · Arbeitsname „${brand.name}“ · nicht öffentlich · Bilder sind Visualisierungen von Beispielanlagen`;

export const NAV = [
  ['/unternehmen', 'Unternehmen'],
  ['/technologie', 'Technologie'],
  ['/standortentwicklung', 'Standortentwicklung'],
  ['/grundstueckseigentuemer', 'Für Eigentümer'],
  ['/kommunen', 'Für Kommunen'],
  ['/investoren', 'Für Investoren'],
  ['/projekte', 'Projekte'],
];

const logo = raw(brandLogo());

export function page({ path, title, description, body, ogType = 'website', jsonld }) {
  const fullTitle = path === '/' ? `${brand.name} – ${brand.claim}` : `${title} | ${brand.name}`;
  const nav = NAV.map(([href, label]) => html`<li><a href="${href}"${path === href ? raw(' aria-current="page"') : ''}>${label}</a></li>`);
  return html`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${description}">
${isPreview() ? raw('<meta name="robots" content="noindex, nofollow">') : ''}
${realDomain() ? html`<link rel="canonical" href="${realDomain()}${path}">` : ''}
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="${ogType}">
<meta property="og:locale" content="de_DE">
<meta name="theme-color" content="#16302d">
<link rel="icon" href="${brand.favicon}" type="image/svg+xml">
<link rel="stylesheet" href="/static/css/site.css">
${jsonld ? raw(`<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>`) : ''}
<script src="/static/js/site.js" defer></script>
</head>
<body>
<a class="skip" href="#inhalt">Zum Inhalt springen</a>
${isPreview() ? html`<aside class="preview-bar" aria-label="Hinweis zur Vorschau">${previewNote()}</aside>` : ''}
<header class="site-head">
  <div class="wrap head-row">
    <a class="brand" href="/" aria-label="${brand.name} – Startseite">${logo}<span>${brand.wordmark}</span></a>
    <a class="btn btn-line btn-login head-login" href="/portal/login" aria-label="Login / Partnerportal"><span class="lg-full">Login / Partnerportal</span><span class="lg-short" aria-hidden="true">Login</span></a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="hauptnavigation">Menü</button>
    <nav id="hauptnavigation" class="main-nav" aria-label="Hauptnavigation">
      <ul>${nav}</ul>
      <div class="nav-actions">
        <a class="btn btn-solid" href="/kontakt">Kontakt</a>
      </div>
    </nav>
  </div>
</header>
<main id="inhalt">
${body}
</main>
<footer class="site-foot">
  <div class="wrap foot-grid">
    <div>
      <a class="brand brand-foot" href="/">${logo}<span>${brand.wordmark}</span></a>
      <p class="foot-claim">${brand.claim}.</p>
      <p class="muted small">Die einzelnen Speicherprojekte werden von eigenständigen Projektgesellschaften getragen.</p>
    </div>
    <nav aria-label="Seiten">
      <h2 class="foot-h">Plattform</h2>
      <ul class="foot-list">
        <li><a href="/unternehmen">Unternehmen und Netzwerk</a></li>
        <li><a href="/technologie">Batteriespeicher und Technologie</a></li>
        <li><a href="/standortentwicklung">Standortentwicklung</a></li>
        <li><a href="/projekte">Projekte</a></li>
      </ul>
    </nav>
    <nav aria-label="Zielgruppen">
      <h2 class="foot-h">Zusammenarbeit</h2>
      <ul class="foot-list">
        <li><a href="/grundstueckseigentuemer">Für Grundstückseigentümer</a></li>
        <li><a href="/kommunen">Für Kommunen</a></li>
        <li><a href="/investoren">Für Investoren</a></li>
        <li><a href="/standort-anbieten">Fläche anbieten</a></li>
      </ul>
    </nav>
    <nav aria-label="Rechtliches">
      <h2 class="foot-h">Kontakt</h2>
      <ul class="foot-list">
        <li><a href="/kontakt">Ansprechpartner</a></li>
        <li><a href="/portal/login">Login / Partnerportal</a></li>
        <li><a href="/impressum">Impressum</a></li>
        <li><a href="/datenschutz">Datenschutz</a></li>
      </ul>
    </nav>
  </div>
  <div class="wrap foot-base small muted">© ${new Date().getFullYear()} ${brand.legal.operator}</div>
</footer>
</body>
</html>`;
}

// Bildwelt 2.0: 3D-Visualisierungen (tools/render) als AVIF/WebP in mehreren Breiten, Mobilzuschnitt 4:5.
// Jede Verwendung trägt den Hinweis „Visualisierung“ – die Motive zeigen Beispielanlagen, keine realen Standorte.
const IMG = (() => { try { return JSON.parse(readFileSync(new URL('../../static/img/v2/manifest.json', import.meta.url), 'utf8')); } catch { return {}; } })();
const srcset = (key, kind, fmt) => (IMG[key]?.[kind] || []).map((w) => `/static/img/v2/${key}-${kind}-${w}.${fmt}?v=${IMG._v} ${w}w`).join(', ');
export function picture(key, alt, { eager = false, sizes = '100vw', mobile = true, cls = '' } = {}) {
  const m = IMG[key]; if (!m) return '';
  const d = m.d, last = d[d.length - 1], fb = d.find((w) => w >= 1280) || last;
  const pos = m.focus ? raw(` style="object-position:${m.focus[0]}% ${m.focus[1]}%"`) : '';
  return html`<picture${cls ? raw(` class="${cls}"`) : ''}>
    ${mobile && m.m ? html`<source media="(max-width: 700px)" type="image/avif" srcset="${srcset(key, 'm', 'avif')}" sizes="100vw"><source media="(max-width: 700px)" type="image/webp" srcset="${srcset(key, 'm', 'webp')}" sizes="100vw">` : ''}
    <source type="image/avif" srcset="${srcset(key, 'd', 'avif')}" sizes="${sizes}">
    <source type="image/webp" srcset="${srcset(key, 'd', 'webp')}" sizes="${sizes}">
    <img src="/static/img/v2/${key}-d-${fb}.webp?v=${IMG._v}" alt="${alt}" width="${m.w}" height="${m.h}"${pos}${eager ? raw(' fetchpriority="high"') : raw(' loading="lazy"')} decoding="async">
  </picture>`;
}
export const photo = (key, alt, caption, { cls = '', sizes = '(min-width: 1180px) 640px, (min-width: 760px) 55vw, 100vw' } = {}) => html`<figure class="photo ${cls}">
  ${picture(key, alt, { sizes, mobile: false })}
  <figcaption><span class="tag-vis">Visualisierung</span> ${caption}</figcaption>
</figure>`;
// Bildband unter dem Seitenkopf (volle Breite, mobil 4:5)
export const band = (key, alt, caption) => html`<figure class="photo-band">
  ${picture(key, alt, { sizes: '100vw' })}
  <figcaption class="wrap"><span class="tag-vis">Visualisierung</span> ${caption}</figcaption>
</figure>`;

export const illus = (src, alt, caption, cls = '') => html`<figure class="illus ${cls}">
  <img src="/static/img/${src}" alt="${alt}" loading="lazy" decoding="async" width="1600" height="900">
  <figcaption><span class="tag-illus">Beispielhafte Illustration</span> ${caption}</figcaption>
</figure>`;
