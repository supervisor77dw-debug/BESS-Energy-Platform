// HTTP-Hilfen: Cookies, Formular- und Multipart-Parsing, Antworten, Sicherheitsheader, Ratenbegrenzung.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config, isPreview } from '../config.mjs';

// Schlüssel für Formular-Token: aus dem gemeinsamen privaten Schlüssel abgeleitet (gleich auf allen Instanzen).
import { getDb } from './store.mjs';
const FALLBACK_KEY = randomBytes(32);
const formKey = () => { const k = getDb()?.meta?.sessionKey; return k ? createHmac('sha256', Buffer.from(k, 'base64')).update('formular-token').digest() : FALLBACK_KEY; };

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        // Rest verwerfen und danach sauber mit 413 antworten; nur bei grobem Missbrauch Verbindung trennen.
        if (!tooBig) { tooBig = true; chunks.length = 0; }
        if (size > limit * 4) { reject(Object.assign(new Error('zu groß'), { status: 413 })); req.destroy(); }
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => tooBig ? reject(Object.assign(new Error('zu groß'), { status: 413 })) : resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function parseForm(req) {
  const type = req.headers['content-type'] || '';
  if (type.startsWith('multipart/form-data')) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(type);
    if (!m) throw Object.assign(new Error('boundary fehlt'), { status: 400 });
    const body = await readBody(req, config.uploadMaxBytes + 64 * 1024);
    return parseMultipart(body, m[1] || m[2]);
  }
  const body = await readBody(req, 64 * 1024);
  const fields = Object.fromEntries(new URLSearchParams(body.toString('utf8')));
  return { fields, files: [] };
}

function parseMultipart(buf, boundary) {
  const fields = {}; const files = [];
  const delim = Buffer.from('--' + boundary);
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    const start = pos + delim.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    const next = buf.indexOf(delim, start);
    if (next === -1) break;
    const part = buf.slice(start + 2, next - 2); // CRLF nach Delimiter / vor nächstem
    const sep = part.indexOf('\r\n\r\n');
    if (sep > -1) {
      const head = part.slice(0, sep).toString('utf8');
      const content = part.slice(sep + 4);
      const name = /name="([^"]*)"/i.exec(head)?.[1];
      const filename = /filename="([^"]*)"/i.exec(head)?.[1];
      if (name != null) {
        if (filename != null) { if (filename && content.length) files.push({ field: name, filename, data: content }); }
        else fields[name] = content.toString('utf8');
      }
    }
    pos = next;
  }
  return { fields, files };
}

// Erlaubte Upload-Typen anhand der Dateisignatur (nicht anhand der Endung).
export function sniffType(data) {
  if (data.slice(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (data[0] === 0x89 && data.slice(1, 4).toString('latin1') === 'PNG') return { mime: 'image/png', ext: 'png' };
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  return null;
}

// Signierte Formular-Tokens für öffentliche Formulare (ohne Sitzung).
export function formToken() {
  const ts = Date.now().toString(36);
  const sig = createHmac('sha256', formKey()).update(ts).digest('base64url');
  return `${ts}.${sig}`;
}
export function checkFormToken(tok, minAgeMs = 1500) {
  const [ts, sig] = String(tok || '').split('.');
  if (!ts || !sig) return false;
  const exp = createHmac('sha256', formKey()).update(ts).digest('base64url');
  if (exp.length !== sig.length || !timingSafeEqual(Buffer.from(exp), Buffer.from(sig))) return false;
  const age = Date.now() - parseInt(ts, 36);
  return age >= minAgeMs && age < 1000 * 60 * 60 * 6; // Mindestzeit gegen Bots, Höchstalter 6 h
}

export function securityHeaders(res, { portal = false } = {}) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (portal) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Cache-Control', 'no-store');
  } else if (isPreview()) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
}

export function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.end(body);
}
export function redirect(res, to, status = 303) { res.statusCode = status; res.setHeader('Location', to); res.end(); }

// Einfache Ratenbegrenzung (gleitendes Fenster je Schlüssel).
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const t = Date.now();
  const arr = (buckets.get(key) || []).filter((x) => t - x < windowMs);
  arr.push(t); buckets.set(key, arr);
  return arr.length <= max;
}
// Fehlversuchszähler: nur Fehlschläge zählen, damit legitime Anmeldungen nicht blockiert werden.
export function tooMany(key, max, windowMs) {
  const t = Date.now();
  const arr = (buckets.get(key) || []).filter((x) => t - x < windowMs);
  buckets.set(key, arr);
  return arr.length >= max;
}
export function hit(key) { const arr = buckets.get(key) || []; arr.push(Date.now()); buckets.set(key, arr); }
export function clientIp(req) {
  const peer = req.socket.remoteAddress || 'unbekannt';
  const local = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  if (config.trustProxy && (local || config.onVercel) && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return peer;
}
