import { html, raw } from '../lib/html.mjs';
import { brand, isPreview, config, brandLogo } from '../config.mjs';

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
<link rel="canonical" href="${brand.domain}${path}">
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
${isPreview() ? html`<aside class="preview-bar" aria-label="Hinweis zur Vorschau">Abnahmevorschau · Arbeitsname „${brand.name}“ · nicht öffentlich · Illustrationen sind Beispiele</aside>` : ''}
<header class="site-head">
  <div class="wrap head-row">
    <a class="brand" href="/" aria-label="${brand.name} – Startseite">${logo}<span>${brand.wordmark}</span></a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="hauptnavigation">Menü</button>
    <nav id="hauptnavigation" class="main-nav" aria-label="Hauptnavigation">
      <ul>${nav}</ul>
      <div class="nav-actions">
        <a class="btn btn-quiet" href="/portal/login">Portal</a>
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
        <li><a href="/portal/login">Portal-Anmeldung</a></li>
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

export const illus = (src, alt, caption, cls = '') => html`<figure class="illus ${cls}">
  <img src="/static/img/${src}" alt="${alt}" loading="lazy" decoding="async" width="1600" height="900">
  <figcaption><span class="tag-illus">Beispielhafte Illustration</span> ${caption}</figcaption>
</figure>`;
