// Exporte: Wirtschaftlichkeitsberechnung als CSV (Excel-tauglich: Semikolon, Dezimalkomma, UTF-8 mit BOM)
// und Vergütungsübersicht des Eigentümers als PDF (eine Seite, Hinweis auf Unverbindlichkeit und Datenstand).
import { makePdf } from '../pdf.mjs';
import { ANSPRUCH_STATUS, VERTRAGSTYPEN, STUFEN } from './vertraege.mjs';

const zahl = (x, d = 2) => (x == null || !Number.isFinite(x) ? '' : x.toFixed(d).replace('.', ','));
const zelle = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const zeile = (arr) => arr.map(zelle).join(';');

export function berechnungCsv(ergebnis, { projektName }) {
  const m = ergebnis.meta, k = ergebnis.kennzahlen;
  const out = [
    zeile(['STROMKAI Projektwirtschaftlichkeit', projektName]),
    zeile(['Modellversion', m.modellVersion]), zeile(['Berechnet am', m.berechnetAm]), zeile(['Szenario', m.szenarioName]), zeile(['Datenquelle', m.quelle]),
    zeile(['Parameter-Prüfsumme', m.parameterPruefsumme]), zeile(['Hinweis', m.hinweis]), '',
    zeile(['Kennzahl', 'Wert', 'Einheit']),
    zeile(['Gesamtinvestition', zahl(k.gesamtinvestition), 'EUR']), zeile(['Investition je kWh', zahl(k.investitionJeKWh), 'EUR/kWh']),
    zeile(['Eigenkapitalbedarf', zahl(k.eigenkapitalbedarf), 'EUR']), zeile(['Fremdkapital', zahl(k.fremdkapital), 'EUR']), zeile(['Schuldendienst p. a.', zahl(k.schuldendienstJahr), 'EUR']),
    zeile(['DSCR minimal', zahl(k.dscrMin, 2), 'x']), zeile(['DSCR Durchschnitt', zahl(k.dscrDurchschnitt, 2), 'x']),
    zeile(['Kapitalwert', zahl(k.kapitalwert), 'EUR']), zeile(['Projekt-IRR', zahl(k.projektIRR == null ? null : k.projektIRR * 100, 2), '%']), zeile(['Eigenkapital-IRR', zahl(k.eigenkapitalIRR == null ? null : k.eigenkapitalIRR * 100, 2), '%']),
    zeile(['Amortisation', zahl(k.amortisationJahre, 1), 'Jahre']), '',
    zeile(['Jahr', 'Bruttoerlöse', 'Vermarktung', 'Betriebskosten', 'EBITDA', 'Operativer Cashflow', 'Zinsen', 'Tilgung', 'Schuldendienst', 'DSCR', 'Eigenkapital-Cashflow', 'Ausgespeichert MWh']),
    ...ergebnis.jahre.map((j) => zeile([j.jahr, zahl(j.brutto), zahl(j.vermarktung), zahl(j.opex), zahl(j.ebitda), zahl(j.operativerCF), zahl(j.zinsen), zahl(j.tilgung), zahl(j.schuldendienst), zahl(j.dscr), zahl(j.ekCF), zahl(j.ausgespeichertMWh, 1)])),
  ];
  return '﻿' + out.join('\r\n') + '\r\n';
}

const eurPdf = (x) => (x == null ? '-' : `${x.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`);

export function verguetungPdf({ eigentuemer, projekt, stand, ansprueche, kauf, stichtag, synthetisch }) {
  const lines = [
    `Eigentuemer: ${eigentuemer}`, `Projekt: ${projekt}`,
    `Vertrag: ${VERTRAGSTYPEN[stand.typ]} - ${STUFEN[stand.stufe].name}, Version ${stand.version}${stand.dokumentRef ? `, Dokument ${stand.dokumentRef}` : ''}`,
    `Stichtag: ${stichtag}`, '',
    ...ansprueche.map((a) => `${a.bezeichnung}: ${eurPdf(a.status === 'bezahlt' || a.status === 'demo' ? a.bezahlt : a.betrag)} - ${ANSPRUCH_STATUS[a.status]}${a.faellig ? ` (faellig ${a.faellig})` : ''}`),
  ];
  if (kauf) lines.push('', `Kaufpreisregelung: ${kauf.heute.wert.toLocaleString('de-DE')} EUR/m2 heute${kauf.heute.begrenzt ? ` (${kauf.heute.begrenzt})` : ''}, ausuebbar bis Betriebsjahr ${kauf.bisBetriebsjahr ?? '-'}`);
  lines.push('', 'Prognosewerte sind unverbindlich. Massgeblich ist allein der unterzeichnete Vertrag.');
  return makePdf('Verguetungsuebersicht', lines.map((l) => l.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')),
    synthetisch ? 'SYNTHETISCHE DEMO-DATEN - KEINE REALEN ZAHLUNGEN' : 'Stand gemaess Vertrag');
}
