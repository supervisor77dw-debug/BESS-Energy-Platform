// BESS-Plattform – Server (Node >= 22). Lokal: node data/seed.mjs && node server.mjs → http://127.0.0.1:4710
// Auf Vercel: api/index.mjs ruft vercelHandler() (Speicher: Vercel Blob, siehe docs/HOSTING_VERCEL.md).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, ROOT, brand, isPreview } from './src/config.mjs';
import { openStore, getDb, persist, newId, now, audit, putFile, refresh, flush, storeKind } from './src/lib/store.mjs';
import { send, redirect, securityHeaders, parseForm, checkFormToken, rateLimit, clientIp, sniffType } from './src/lib/http.mjs';
import * as Pub from './src/public/pages.mjs';
import { handlePortal, HttpError } from './src/portal/routes.mjs';
import { esc } from './src/lib/html.mjs';
import { handleGate, loadGate } from './src/lib/gate.mjs';
import { ROLLEN, naechsteKennung, regionZuordnen, REGIONEN_OEFFENTLICH } from './src/portal/akquise.mjs';
import { anfrageEingang } from './src/portal/arbeit.mjs';

const STATIC = join(ROOT, 'static');
const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

async function serveStatic(res, pathname) {
  const rel = normalize(decodeURIComponent(pathname.slice('/static/'.length)));
  const file = join(STATIC, rel);
  if (!file.startsWith(STATIC + sep) || rel.includes('..')) return send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8');
  try {
    const data = await readFile(file);
    // Bildwelt-Dateien sind über ?v= versioniert und dürfen lange zwischengespeichert werden
    res.setHeader('Cache-Control', rel.startsWith('img' + sep + 'v2' + sep) && !rel.endsWith('.json') ? 'public, max-age=31536000, immutable' : isPreview() ? 'no-cache' : 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (isPreview()) res.setHeader('X-Robots-Tag', 'noindex');
    return send(res, 200, data, TYPES[extname(file)] || 'application/octet-stream');
  } catch { return send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8'); }
}

const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v);
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

async function handleSiteOffer(req, res) {
  const { fields, files } = await parseForm(req);
  if (fields.firma || !checkFormToken(fields._t)) return redirect(res, '/danke?k=flaeche'); // stilles Verwerfen von Bot-Einsendungen
  if (!rateLimit(`form:${clientIp(req)}`, 8, 60 * 60000)) return send(res, 429, 'Zu viele Anfragen. Bitte später erneut versuchen.', 'text/plain; charset=utf-8');
  const v = { name: clip(fields.name, 120), rolle: ROLLEN.includes(fields.rolle) ? fields.rolle : '', region: REGIONEN_OEFFENTLICH.includes(fields.region) ? fields.region : '', email: clip(fields.email, 160), phone: clip(fields.phone, 60), plz: clip(fields.plz, 10), lage: clip(fields.lage, 200), flurstueck: clip(fields.flurstueck, 200), flaeche: clip(fields.flaeche, 20), nutzung: clip(fields.nutzung, 40), umspannwerk: clip(fields.umspannwerk, 40), nachricht: clip(fields.nachricht, 3000), dsgvo: fields.dsgvo === 'ja' };
  const errors = {};
  if (!v.name) errors.name = 'Bitte geben Sie Ihren Namen an.';
  if (!v.email && !v.phone) errors.email = 'Bitte geben Sie eine E-Mail-Adresse oder Telefonnummer an.';
  else if (v.email && !isEmail(v.email)) errors.email = 'Bitte prüfen Sie die E-Mail-Adresse.';
  if (!v.lage) errors.lage = 'Bitte nennen Sie Gemeinde oder Ort der Fläche.';
  if (v.plz && !/^\d{5}$/.test(v.plz)) errors.plz = 'Bitte prüfen Sie die Postleitzahl (fünf Ziffern).';
  if (!v.dsgvo) errors.dsgvo = 'Ohne Ihr Einverständnis können wir die Anfrage nicht bearbeiten.';
  const f = files.find((x) => x.field === 'datei');
  let type = null;
  if (f) { type = sniffType(f.data); if (!type) errors.datei = 'Bitte nur PDF-, JPG- oder PNG-Dateien hochladen.'; }
  if (Object.keys(errors).length) { res.statusCode = 422; return send(res, 422, String(Pub.standortAnbieten({ errors, values: { ...fields, dsgvo: v.dsgvo ? 'ja' : '' } }))); }
  let fileId = null;
  if (f) { fileId = newId('in') + '.' + type.ext; await putFile(fileId, f.data, type.mime); }
  const db = getDb();
  const at = now();
  db.inquiries.push({ id: newId('inq'), ref: naechsteKennung(db, at), kind: 'flaeche', at, status: 'neu', ...v, dsgvo: true, fileId });
  regionZuordnen(db, db.inquiries.at(-1));
  anfrageEingang(db, db.inquiries.at(-1)); // nächste Aktion, Historie, Benachrichtigung (AW-020)
  persist(); audit('anfrage_flaeche', null, { anfrage: db.inquiries.at(-1).id }); // ohne Ort/Personenbezug (AW-020 R-4)
  return redirect(res, '/danke?k=flaeche');
}

async function handleContact(req, res) {
  const { fields } = await parseForm(req);
  if (fields.firma || !checkFormToken(fields._t)) return redirect(res, '/danke?k=kontakt');
  if (!rateLimit(`form:${clientIp(req)}`, 8, 60 * 60000)) return send(res, 429, 'Zu viele Anfragen. Bitte später erneut versuchen.', 'text/plain; charset=utf-8');
  const v = { anliegen: clip(fields.anliegen, 30), region: REGIONEN_OEFFENTLICH.includes(fields.region) ? fields.region : '', name: clip(fields.name, 120), org: clip(fields.org, 160), email: clip(fields.email, 160), phone: clip(fields.phone, 60), nachricht: clip(fields.nachricht, 4000), dsgvo: fields.dsgvo === 'ja' };
  const errors = {};
  if (!v.name) errors.name = 'Bitte geben Sie Ihren Namen an.';
  if (!isEmail(v.email)) errors.email = 'Bitte geben Sie eine gültige E-Mail-Adresse an.';
  if (!v.nachricht) errors.nachricht = 'Bitte schreiben Sie uns kurz Ihr Anliegen.';
  if (!v.dsgvo) errors.dsgvo = 'Ohne Ihr Einverständnis können wir die Nachricht nicht bearbeiten.';
  if (Object.keys(errors).length) return send(res, 422, String(Pub.kontakt({ errors, values: { ...fields, dsgvo: v.dsgvo ? 'ja' : '' } })));
  const db = getDb(), at = now();
  db.inquiries.push({ id: newId('inq'), ref: naechsteKennung(db, at), kind: 'kontakt', at, status: 'neu', ...v, dsgvo: true });
  regionZuordnen(db, db.inquiries.at(-1));
  anfrageEingang(db, db.inquiries.at(-1)); // nächste Aktion, Historie, Benachrichtigung (AW-020)
  persist(); audit('anfrage_kontakt', null, { anliegen: v.anliegen });
  return redirect(res, '/danke?k=kontakt');
}

function robots() {
  return isPreview() ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nDisallow: /portal/\nSitemap: ${brand.domain}/sitemap.xml\n`;
}
function sitemap() {
  const paths = [...Object.keys(Pub.PUBLIC_ROUTES), '/standort-anbieten', '/kontakt'];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${esc(brand.domain + p)}</loc></url>`).join('')}</urlset>\n`;
}

function errorPage(res, err, portal) {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  if (status === 404 && !portal) return send(res, 404, String(Pub.notFound()));
  const msg = status === 404 ? 'Diese Seite gibt es nicht oder Sie haben keinen Zugriff darauf.' : status === 403 ? (err.message || 'Kein Zugriff.') : status === 413 ? 'Die Datei ist zu groß (höchstens 10 MB).' : status < 500 ? (err.message || 'Ungültige Anfrage.') : 'Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.';
  const back = portal ? '/portal' : '/';
  return send(res, status, `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${status}</title><link rel="stylesheet" href="/static/css/portal.css"></head><body class="auth"><main class="auth-main"><div class="auth-card"><h1>${status === 404 ? 'Nicht gefunden' : status === 403 ? 'Kein Zugriff' : 'Hinweis'}</h1><p>${esc(msg)}</p><p><a class="btn btn-primary" href="${back}">Zurück</a></p></div></main></body></html>`);
}

export async function handleRequest(req, res) {
  {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const portal = p === '/portal' || p.startsWith('/portal/');
    try {
      if (config.gate) { if (!p.startsWith('/static/')) securityHeaders(res, { portal: true }); if (await handleGate(req, res, url)) return; }
      if (p.startsWith('/static/')) return await serveStatic(res, p);
      securityHeaders(res, { portal });
      if (portal) return await handlePortal(req, res, url);
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (p === '/robots.txt') return send(res, 200, robots(), 'text/plain; charset=utf-8');
        if (p === '/sitemap.xml') return send(res, 200, sitemap(), 'application/xml; charset=utf-8');
        if (p === '/healthz') return send(res, 200, 'ok', 'text/plain; charset=utf-8');
        if (p === '/standort-anbieten') return send(res, 200, String(Pub.standortAnbieten({ region: url.searchParams.get('region') })));
        if (p === '/kontakt') return send(res, 200, String(Pub.kontakt({ anliegen: url.searchParams.get('anliegen'), region: url.searchParams.get('region') })));
        if (p === '/danke') return send(res, 200, String(Pub.danke(url.searchParams.get('k'))));
        const key = p.length > 1 ? p.replace(/\/+$/, '') : p;
        if (Pub.PUBLIC_ROUTES[key]) return send(res, 200, String(Pub.PUBLIC_ROUTES[key]()));
        throw new HttpError(404);
      }
      if (req.method === 'POST' && p === '/standort-anbieten') return await handleSiteOffer(req, res);
      if (req.method === 'POST' && p === '/kontakt') return await handleContact(req, res);
      throw new HttpError(405, 'Methode nicht erlaubt');
    } catch (err) {
      if (res.headersSent) return res.end();
      return errorPage(res, err, portal);
    }
  }
}

export const createApp = () => createServer(handleRequest);

// ---- Vercel ----
// Je Instanz werden Anfragen nacheinander verarbeitet (konsistenter Zustand); vor dem Senden wird gespeichert.
let ready = null; let chain = Promise.resolve(); let sync = null;
export async function vercelHandler(req, res) {
  // Production-Ziel nur als ausdrücklich konfigurierter Abnahmekandidat (BESS_STAGE=abnahme) oder nach Produktivfreigabe
  const envFlag = (k) => String(process.env[k] || '').trim();
  if (process.env.VERCEL_ENV === 'production' && envFlag('BESS_STAGE') !== 'abnahme' && envFlag('BESS_ALLOW_PRODUCTION') !== '1') {
    res.statusCode = 503; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('X-Robots-Tag', 'noindex');
    return res.end('Produktivbetrieb nicht freigegeben.');
  }
  ready ??= (async () => {
    const { bootstrapFromEnv, syncAccounts } = await import('./src/lib/bootstrap.mjs');
    sync = syncAccounts;
    await openStore({ kind: 'blob', bootstrap: bootstrapFromEnv, prefix: config.blobPrefix });
  })().catch((e) => { ready = null; throw e; }); // nächster Aufruf versucht es erneut
  let release; const turn = chain; chain = new Promise((r) => (release = r));
  await turn;
  try {
    await ready; await refresh();
    if (sync(getDb())) { persist(); await flush(); } // neue Provisionierung übernehmen
    const end = res.end.bind(res);
    await new Promise((resolve) => {
      res.end = (...a) => {
        flush().then(() => end(...a), (e) => {
          console.error('Speichern fehlgeschlagen', e);
          if (!res.headersSent) { for (const h of ['Location', 'Set-Cookie', 'Content-Disposition', 'Content-Length']) res.removeHeader(h); res.statusCode = 503; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); }
          end('Die Änderung konnte nicht gespeichert werden. Bitte erneut versuchen.');
        }).finally(resolve);
        return res;
      };
      handleRequest(req, res).catch((e) => { console.error(e); if (!res.writableEnded) { res.statusCode = 500; res.end('Fehler'); } });
    });
  } finally { release(); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await openStore(config.dataDir);
  if (config.gate) console.log(`Vorschau-Schranke aktiv (${loadGate()} Prüferzugänge).`);
  createApp().listen(config.port, config.host, () => {
    console.log(`BESS-Plattform (${config.mode}) läuft auf http://${config.host}:${config.port}  – Daten: ${config.dataDir}`);
    if (config.previewHelpers) console.log('Vorschau-Hilfen aktiv (Demo-Zugänge auf der Login-Seite). In Produktion BESS_MODE=production setzen.');
  });
}
