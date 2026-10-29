import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Umgebungswerte bereinigt (Leerzeichen/Zeilenumbrüche aus Shell-Eingaben dürfen keine Einstellung verfälschen)
const env = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, typeof v === 'string' && k.startsWith('BESS_') && k !== 'BESS_ACCOUNTS' ? v.trim() : v]));

export const config = {
  host: env.BESS_HOST || '127.0.0.1',
  port: Number(env.BESS_PORT || 4710),
  // 'preview' = Abnahmevorschau: komplette Seite noindex, Vorschau-Hinweise sichtbar.
  // 'production' nur nach ausdrücklicher Freigabe (Produktivstart ist nicht Teil dieses Auftrags).
  mode: env.BESS_MODE || 'preview',
  dataDir: resolve(env.BESS_DATA_DIR || join(ROOT, 'data', 'runtime')),
  // Vorschau-Hilfen (Demo-Zugänge, aktueller MFA-Code auf der Login-Seite). In Produktion zwingend aus.
  // Hinter der Vorschau-Schranke (externe Vorschau) sind die Hilfen immer aus.
  // Vorschau-Hilfen nur lokal: nie hinter der Schranke, nie auf Vercel, nie im Abnahmekandidaten
  previewHelpers: env.BESS_GATE !== '1' && !env.VERCEL && !env.VERCEL_ENV && env.BESS_STAGE !== 'abnahme' && (env.BESS_PREVIEW_HELPERS ?? (env.BESS_MODE === 'production' ? '0' : '1')) === '1',
  secureCookies: env.BESS_SECURE_COOKIES === '1' || !!env.VERCEL,
  // Vorschau-Zugangsschranke vor der gesamten Website (externe Vorschau). Zugänge in <dataDir>/gate.json (nur Hashes).
  // Vorschau-Schranke: auf Vercel in der QA-Stufe standardmäßig an, im öffentlichen Abnahmekandidaten aus.
  gate: env.BESS_GATE === '1' || (!!env.VERCEL && env.BESS_GATE !== '0' && (env.BESS_STAGE || (env.VERCEL_ENV === 'production' ? 'abnahme' : 'qa')) !== 'abnahme'),
  // Nur hinter einem lokalen Reverse-Proxy (z. B. Tailscale Funnel) X-Forwarded-For auswerten.
  trustProxy: env.BESS_TRUST_PROXY === '1' || !!env.VERCEL,
  onVercel: !!env.VERCEL,
  // Betriebsstufe: 'qa' (geschützte Entwicklungs-/QA-Vorschau) | 'abnahme' (öffentlicher, vorläufiger Abnahmekandidat).
  // Auf Vercel: Production-Ziel = Abnahme, Preview-Ziele = QA.
  // MFA: 'aus' (Abnahmeplattform, Standard) | 'privilegiert' (Administration, Projektleitung) | 'konto' (je Konto laut Merker mfa)
  mfa: ['aus', 'privilegiert', 'konto'].includes(env.BESS_MFA) ? env.BESS_MFA : 'aus',
  inviteTtlMs: Number(env.BESS_INVITE_TTL_MS || 1000 * 60 * 60 * 72),
  resetTtlMs: Number(env.BESS_RESET_TTL_MS || 1000 * 60 * 60 * 24),
  stage: env.BESS_STAGE || (env.VERCEL_ENV === 'production' ? 'abnahme' : 'qa'),
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

// Echte Domain oder null, solange in brand.json nur ein Platzhalter steht (dann keine kanonischen Links/Domainangaben).
export const realDomain = () => (/\.invalid$|example\./i.test(brand.domain || '') ? null : brand.domain);
