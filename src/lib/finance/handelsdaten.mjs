// Schnittstelle für Ergebnisse eines Stromhandels- und Dispatchsystems (nur Übernahme von Daten, keine Handelsaufträge).
// Ein Datensatz je Projekt und Monat. Spezifikation: docs/HANDELSDATEN_SCHNITTSTELLE.md
import { cent, parseZahl } from './geld.mjs';

export const SCHNITTSTELLEN_VERSION = 'STROMKAI-HD 1.0';
export const FELDER = [
  ['projektId', 'Projekt-ID', 'text'], ['periode', 'Periode (JJJJ-MM)', 'periode'],
  ['bezugMWh', 'Strombezug MWh', 'menge'], ['einspeisungMWh', 'Stromeinspeisung MWh', 'menge'],
  ['handelsumsatz', 'Handelsumsätze EUR', 'betrag'], ['handelskosten', 'Handelskosten EUR', 'betrag'], ['gebuehren', 'Gebühren EUR', 'betrag'],
  ['speicherverlusteMWh', 'Speicherverluste MWh', 'menge'], ['verschleissKosten', 'Batterieverschleiß EUR', 'betrag'],
  ['realisierterErtrag', 'Realisierte Erlöse EUR', 'betrag'], ['prognoseErtrag', 'Prognose Erlöse EUR', 'betrag'],
];

// Prüft und normalisiert Datensätze. Ergebnis: { datensaetze, fehler[], hinweise[] }. Bei Fehlern wird nichts übernommen.
export function pruefe(roh, { projektIds }) {
  const fehler = [], hinweise = [], datensaetze = [];
  const seen = new Set();
  roh.forEach((r, i) => {
    const z = `Zeile ${i + 1}`;
    const d = {};
    for (const [k, name, typ] of FELDER) {
      const v = r[k];
      if (typ === 'text') { d[k] = String(v ?? '').trim(); if (!d[k]) fehler.push(`${z}: ${name} fehlt.`); continue; }
      if (typ === 'periode') { d[k] = String(v ?? '').trim(); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(d[k])) fehler.push(`${z}: ${name} muss im Format JJJJ-MM vorliegen.`); continue; }
      const n = parseZahl(v);
      if (!Number.isFinite(n)) { fehler.push(`${z}: ${name} ist keine Zahl.`); continue; }
      if (typ === 'menge' && n < 0) fehler.push(`${z}: ${name} darf nicht negativ sein.`);
      if (['handelskosten', 'gebuehren', 'verschleissKosten'].includes(k) && n < 0) fehler.push(`${z}: ${name} darf nicht negativ sein.`);
      d[k] = typ === 'betrag' ? cent(n) : n;
    }
    if (d.projektId && projektIds && !projektIds.includes(d.projektId)) fehler.push(`${z}: Projekt „${d.projektId}“ ist nicht bekannt.`);
    const key = `${d.projektId}|${d.periode}`;
    if (seen.has(key)) fehler.push(`${z}: Projekt und Periode sind doppelt enthalten.`);
    seen.add(key);
    if (Number.isFinite(d.bezugMWh) && Number.isFinite(d.einspeisungMWh) && Number.isFinite(d.speicherverlusteMWh)) {
      const diff = d.bezugMWh - d.einspeisungMWh - d.speicherverlusteMWh;
      if (Math.abs(diff) > Math.max(1, 0.02 * d.bezugMWh)) hinweise.push(`${z}: Bezug − Einspeisung − Verluste ergibt ${diff.toFixed(1)} MWh (Bilanz prüfen).`);
    }
    d.abweichung = Number.isFinite(d.realisierterErtrag) && Number.isFinite(d.prognoseErtrag) ? cent(d.realisierterErtrag - d.prognoseErtrag) : null;
    datensaetze.push(d);
  });
  return { datensaetze: fehler.length ? [] : datensaetze, fehler, hinweise };
}

// CSV mit Semikolon und deutschem Dezimalkomma; Kopfzeile mit den Feldschlüsseln
export function parseCsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const kopf = lines[0].split(';').map((x) => x.trim());
  return lines.slice(1).map((l) => Object.fromEntries(l.split(';').map((v, i) => [kopf[i], v.trim()])));
}

// Übernahme: ersetzt vorhandene Datensätze gleicher Projekt-Periode (Korrekturlieferung), mit Importkennung
export function uebernehmen(db, datensaetze, { von, quelle }) {
  const importId = `hd-${Date.now().toString(36)}`;
  for (const d of datensaetze) {
    db.handelsdaten = db.handelsdaten.filter((x) => !(x.projektId === d.projektId && x.periode === d.periode));
    db.handelsdaten.push({ id: `hd-${d.projektId}-${d.periode}`, ...d, importId, quelle: quelle || 'Import', importiertVon: von, importiertAm: new Date().toISOString(), schnittstelle: SCHNITTSTELLEN_VERSION });
  }
  return importId;
}
