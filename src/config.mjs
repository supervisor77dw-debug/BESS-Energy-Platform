import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Umgebungswerte bereinigt (Leerzeichen/Zeilenumbrüche aus Shell-Eingaben dürfen keine Einstellung verfälschen)
const env = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, typeof v === 'string' && k.startsWith('BESS_') && k !== 'BESS_ACCOUNTS' ? v.trim() : v]));

// Betriebsstufe und Blob-Bereich vorab (AW-020, Datenisolierung R-1): Die Produktionsstufe 'abnahme' liest und schreibt nur
// unter 'abnahme/'; jede andere Stufe nur in ihrem eigenen Präfix, das nie mit 'abnahme' beginnen darf (fail closed).
const STAGE = env.BESS_STAGE || (env.VERCEL_ENV === 'production' ? 'abnahme' : 'qa');
function blobPrefix() {
  if (STAGE === 'abnahme') return 'abnahme/';
  const p = env.BESS_BLOB_PREFIX || '';
  if (p && (!/^[a-z0-9][a-z0-9-]{0,40}\/$/.test(p) || p.startsWith('abnahme'))) throw new Error(`BESS_BLOB_PREFIX ungültig oder Produktionsbereich: ${p}`);
  return p;
}
// QA-Identitätsspiegel (AW-020): Anmeldung in der QA mit der bestehenden STROMKAI-Administrationsidentität der Produktion.
// Nur Stufe 'qa', nie im Production-Ziel, nur mit ausdrücklichem Schalter; die Produktion wird dabei ausschließlich gelesen.
const QA_SPIEGEL = env.BESS_QA_ADMIN_SPIEGEL === '1' && STAGE === 'qa' && env.VERCEL_ENV !== 'production';

// S-2 Speichertrennung (AW-022): Die Produktion arbeitet auf einem EIGENEN Vercel-Blob-Store, dessen Kennung (nicht geheim)
// in BESS_PRODUKTIONSSPEICHER steht und in ALLEN Umgebungen gesetzt wird. Technisch erzwungen (fail closed beim Öffnen
// des Speichers): keine Produktionsstufe außerhalb des Vercel-Production-Ziels und keine Nicht-Produktionsumgebung mit
// einem Token des Produktions-Stores. Der bisherige gemeinsame Store gilt nie als Produktionsspeicher.
export const GEMEINSAME_SPEICHER = ['store_A8KSoIBxmYMplN9S']; // „bess-energy-platform-preview“, bis 14.11.2026 Production+Preview+Development
const storeKennung = (v) => { const t = String(v || '').trim(); if (!t) return ''; const id = t.startsWith('vercel_blob_rw_') ? t.split('_')[3] || '' : t.replace(/^store_/, ''); return id ? `store_${id}` : ''; };
export function speicherVerstoesse(e = env, stage = STAGE) {
  const v = [];
  const prod = storeKennung(e.BESS_PRODUKTIONSSPEICHER), ist = storeKennung(e.BLOB_READ_WRITE_TOKEN);
  if (e.VERCEL_ENV && e.VERCEL_ENV !== 'production' && stage === 'abnahme') v.push(`Produktionsstufe „abnahme“ im Vercel-Ziel „${e.VERCEL_ENV}“ unzulässig`);
  if (stage !== 'abnahme' && prod && ist === prod) v.push('Nicht-Produktionsumgebung ist mit dem Produktionsspeicher verbunden');
  if (stage === 'abnahme' && prod && ist && ist !== prod) v.push('Produktion ist nicht mit dem festgelegten Produktionsspeicher verbunden');
  if (prod && GEMEINSAME_SPEICHER.includes(prod)) v.push('BESS_PRODUKTIONSSPEICHER zeigt auf den gemeinsamen Store – kein getrennter Produktionsspeicher');
  return v;
}
// Getrennt = eigener, festgelegter Produktions-Store, Token gehört dazu, kein Verstoß
export function speicherGetrennt(e = env, stage = STAGE) {
  const prod = storeKennung(e.BESS_PRODUKTIONSSPEICHER);
  return stage === 'abnahme' && !!prod && storeKennung(e.BLOB_READ_WRITE_TOKEN) === prod && speicherVerstoesse(e, stage).length === 0;
}

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
  // Mit QA-Identitätsspiegel entfällt die Schranke als zusätzliche Anmeldestufe (äußerer Schutz: Vercel Deployment Protection);
  // BESS_GATE=1 erzwingt sie weiterhin.
  gate: env.BESS_GATE === '1' || (!!env.VERCEL && env.BESS_GATE !== '0' && STAGE !== 'abnahme' && !QA_SPIEGEL),
  // Nur hinter einem lokalen Reverse-Proxy (z. B. Tailscale Funnel) X-Forwarded-For auswerten.
  trustProxy: env.BESS_TRUST_PROXY === '1' || !!env.VERCEL,
  onVercel: !!env.VERCEL,
  // Betriebsstufe: 'qa' (geschützte Entwicklungs-/QA-Vorschau) | 'abnahme' (öffentlicher, vorläufiger Abnahmekandidat).
  // Auf Vercel: Production-Ziel = Abnahme, Preview-Ziele = QA.
  // MFA: 'aus' (Abnahmeplattform, Standard) | 'privilegiert' (Administration, Projektleitung) | 'konto' (je Konto laut Merker mfa)
  mfa: ['aus', 'privilegiert', 'konto'].includes(env.BESS_MFA) ? env.BESS_MFA : 'aus',
  inviteTtlMs: Number(env.BESS_INVITE_TTL_MS || 1000 * 60 * 60 * 72),
  resetTtlMs: Number(env.BESS_RESET_TTL_MS || 1000 * 60 * 60 * 24),
  stage: STAGE,
  blobPrefix: blobPrefix(),
  qaSpiegel: QA_SPIEGEL,
  sessionTtlMs: Number(env.BESS_SESSION_TTL_MS || 1000 * 60 * 60 * 8),
  idleTtlMs: Number(env.BESS_IDLE_TTL_MS || 1000 * 60 * 30),
  gateTtlMs: Number(env.BESS_GATE_TTL_MS || 1000 * 60 * 60 * 12),
  uploadMaxBytes: 10 * 1024 * 1024,
  // Aktive Grundstücksakquise (AW-021): in QA und lokal an, im öffentlichen Abnahmekandidaten nur mit ausdrücklichem Schalter
  aktiveAkquise: env.BESS_AKTIVE_AKQUISE ? env.BESS_AKTIVE_AKQUISE === '1' : STAGE !== 'abnahme',
  // Datenschutz-Freigabetor (P0): echte Kontaktdaten aus aktiver Akquise erst nach dokumentierter Freigabe des Konzepts;
  // in Vorschauen nie (PROJECT_RULES §4 Nr. 1) – bis dahin nimmt das Board nur gekennzeichnete synthetische Testdatensätze an
  akquiseEchtdaten: env.BESS_AKQUISE_ECHTDATEN === '1' && STAGE === 'abnahme',
  // Öffentliche Formulare Kontakt/Fläche (AW-022, Entscheidung G-11): standardmäßig AUS. Ohne Schalter nimmt der Server
  // keine Formulardaten an (Abbruch vor dem Lesen des Request-Bodys) und speichert nichts. In der Produktionsstufe zusätzlich
  // nur mit technisch nachgewiesenem eigenem Produktionsspeicher (speicherGetrennt), nie im gemeinsamen QA-/Produktions-Store.
  formulare: env.BESS_FORMULARE === '1' && (STAGE !== 'abnahme' || speicherGetrennt(env, STAGE)),
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

// Go-live-Sperre der öffentlichen Website (AW-20261114-GE-CLAUDE-STROMKAI-GOLIVE-VORBEREITUNG-022).
// Bewusst getrennt von config.mode/isPreview(): Der öffentliche Start schaltet weder das Portal in den Produktionsmodus
// noch Echtdaten frei (akquiseEchtdaten und synthetische Finanzstände bleiben unberührt). Indexierbar und ohne
// Vorschau-Hinweis wird die Website nur, wenn ALLE Bedingungen erfüllt sind; sonst bleibt alles wie bisher (noindex).
const PLATZHALTER = /\[|\]|noch festzulegen|nach Eintragung|nach Erteilung|example\.|\.invalid/i;
const PFLICHT = [
  ['operator', 'Rechtsträger und Rechtsform'],
  ['address', 'Anschrift'],
  ['representatives', 'Vertretungsberechtigte Person(en)'],
  ['register', 'Registergericht und Registernummer (oder ausdrücklich „entfällt“ mit Begründung)'],
];
const istGesetzt = (v) => { const t = [].concat(v ?? '').join(' '); return !!t.trim() && !PLATZHALTER.test(t); };
// mfa: MFA-Betriebsart des Portals (nur noch informativ; keine Go-live-Bedingung, siehe unten).
export function goLiveSperren(b = brand, e = process.env, stage = config.stage, mfa = config.mfa) {
  const s = [];
  if (e.BESS_OEFFENTLICH !== '1') s.push('Freigabeschalter BESS_OEFFENTLICH=1 nicht gesetzt (nur nach Produktivfreigabe durch Dirk)');
  if (stage !== 'abnahme') s.push('nur in der Produktionsstufe „abnahme“ zulässig');
  if (/\.invalid$|example\./i.test(b.domain || '')) s.push('Hauptdomain in brand.json nicht festgelegt');
  const L = b.legal || {};
  for (const [k, label] of PFLICHT) if (!istGesetzt(L[k])) s.push(`Pflichtangabe fehlt: ${label}`);
  if (L.stand?.status !== 'BESTAETIGT') s.push(`Betreiberangaben nicht bestätigt (legal.stand.status = ${L.stand?.status || 'fehlt'}; offen: ${L.stand?.offen || 'aktueller Registerauszug'})`);
  if (L.mstv?.einschlaegig !== true && L.mstv?.einschlaegig !== false) s.push('§ 18 Abs. 2 MStV: Einschlägigkeit nicht entschieden (legal.mstv.einschlaegig)');
  else if (L.mstv.einschlaegig === true && !istGesetzt(L.mstv.verantwortlich)) s.push('Pflichtangabe fehlt: Verantwortlich nach § 18 Abs. 2 MStV');
  if (L.vatId && !/^DE\d{9}$/.test(String(L.vatId).replace(/\s/g, ''))) s.push('USt-IdNr. ungültig (leer lassen oder DE + 9 Ziffern)');
  const mail = String(b.contact?.email || '');
  if (PLATZHALTER.test(mail) || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(mail)) s.push('Kontakt-E-Mail fehlt (Impressumspflicht)');
  else if (!kontaktAdressen(b).some((a) => a.email.toLowerCase() === mail.toLowerCase())) s.push('Kontakt-E-Mail nicht als empfangsbereit bestätigt (brand.contact.adressen)');
  if (!istGesetzt(b.contact?.phone) && !(stage === 'abnahme' && e.BESS_FORMULARE === '1' && speicherGetrennt(e, stage))) s.push('Zweiter direkter Kontaktweg neben E-Mail fehlt (Telefon; Formulare sind aus) – § 5 DDG, Kanzlei prüfen');
  const f = b.freigaben || {};
  if (f.impressum !== true) s.push('Impressum nicht rechtlich freigegeben');
  if (f.datenschutz !== true) s.push('Datenschutzerklärung nicht rechtlich freigegeben');
  if (f.marke !== true) s.push('Markenprüfung nicht abgeschlossen');
  if (f.traegerschaft !== true) s.push('Projektträgerschaft nicht freigegeben (Unternehmensgegenstand, Zustimmung Geschäftsführung/Gesellschafter)');
  if (e.BESS_MIGRATION_QUELLE) s.push('S-2: Migrationszugang zum bisherigen Store (BESS_MIGRATION_QUELLE) noch gesetzt – nach der Erstübernahme entfernen und neu bereitstellen');
  if (e.VERCEL && !speicherGetrennt(e, stage)) s.push('S-2: Produktion nicht auf eigenem Blob-Store (BESS_PRODUKTIONSSPEICHER = Store des Produktions-Tokens, nicht der gemeinsame Store)');
  // MFA ist keine Go-live-Bedingung mehr (Entscheidung Dirk 14.11.2026, AW-022: keine MFA-Pflicht für Dirk und Markus;
  // Standard ohne BESS_MFA bleibt 'aus'). Der Parameter mfa bleibt für Aufrufer erhalten.
  void mfa;
  return s;
}

// Betreiberzeile für Website und strukturierte Daten – nur aus brand.legal, keine juristische Person im Code (AW-022).
export function traegerZeile(b = brand) {
  return istGesetzt(b.legal?.operator) ? `${b.name} – ein Projekt der ${b.legal.operator}` : '';
}
export const betreiberBestaetigt = (b = brand) => b.legal?.stand?.status === 'BESTAETIGT';
export const isPublicLive = () => goLiveSperren().length === 0;

// Betriebsbereite E-Mail-Kontaktwege (AW-022): nur Einträge aus brand.contact.adressen mit bestaetigt === true und gültiger
// Adresse. Dirk setzt bestaetigt erst nach eingerichtetem Postfach und erfolgreichem Empfangstest. Unbestätigte Adressen
// werden auf der Website nicht angezeigt (keine irreführende Kontaktangabe).
export function kontaktAdressen(b = brand) {
  return (b.contact?.adressen || []).filter((a) => a && a.bestaetigt === true && !PLATZHALTER.test(String(a.email || '')) && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(a.email || '')));
}

// 308 von Nebendomains (brand.domainAliases) auf die Hauptdomain; andere Hosts (vercel.app, localhost) bleiben unberührt.
export function kanonischeWeiterleitung(host, pfad = '/') {
  const d = realDomain();
  if (!d) return null;
  const h = String(host || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
  if (!h || h === new URL(d).host) return null;
  const aliase = (brand.domainAliases || []).map((x) => String(x).toLowerCase());
  return aliase.includes(h) ? d.replace(/\/$/, '') + (String(pfad).startsWith('/') ? pfad : '/' + pfad) : null;
}
