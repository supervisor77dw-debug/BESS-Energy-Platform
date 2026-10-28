import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const env = process.env;

export const config = {
  host: env.BESS_HOST || '127.0.0.1',
  port: Number(env.BESS_PORT || 4710),
  // 'preview' = Abnahmevorschau: komplette Seite noindex, Vorschau-Hinweise sichtbar.
  // 'production' nur nach ausdrücklicher Freigabe (Produktivstart ist nicht Teil dieses Auftrags).
  mode: env.BESS_MODE || 'preview',
  dataDir: resolve(env.BESS_DATA_DIR || join(ROOT, 'data', 'runtime')),
  // Vorschau-Hilfen (Demo-Zugänge, aktueller MFA-Code auf der Login-Seite). In Produktion zwingend aus.
  // Hinter der Vorschau-Schranke (externe Vorschau) sind die Hilfen immer aus.
  previewHelpers: env.BESS_GATE !== '1' && !env.VERCEL && (env.BESS_PREVIEW_HELPERS ?? (env.BESS_MODE === 'production' ? '0' : '1')) === '1',
  secureCookies: env.BESS_SECURE_COOKIES === '1' || !!env.VERCEL,
  // Vorschau-Zugangsschranke vor der gesamten Website (externe Vorschau). Zugänge in <dataDir>/gate.json (nur Hashes).
  gate: env.BESS_GATE === '1' || (!!env.VERCEL && env.BESS_GATE !== '0'), // auf Vercel standardmäßig an
  // Nur hinter einem lokalen Reverse-Proxy (z. B. Tailscale Funnel) X-Forwarded-For auswerten.
  trustProxy: env.BESS_TRUST_PROXY === '1' || !!env.VERCEL,
  onVercel: !!env.VERCEL,
  sessionTtlMs: Number(env.BESS_SESSION_TTL_MS || 1000 * 60 * 60 * 8),
  idleTtlMs: Number(env.BESS_IDLE_TTL_MS || 1000 * 60 * 30),
  gateTtlMs: Number(env.BESS_GATE_TTL_MS || 1000 * 60 * 60 * 12),
  uploadMaxBytes: 10 * 1024 * 1024,
};

export const isPreview = () => config.mode !== 'production';

export function loadBrand() {
  return JSON.parse(readFileSync(join(ROOT, 'brand.json'), 'utf8'));
}
export const brand = loadBrand();

// Bildmarke aus der zentralen Markendatei (inline, damit Farben über CSS gesteuert werden).
let logoSvg = null;
export function brandLogo(cls = 'logo-mark') {
  logoSvg ??= readFileSync(join(ROOT, brand.logo), 'utf8').trim();
  return logoSvg.replace('<svg ', `<svg class="${cls}" `);
}
