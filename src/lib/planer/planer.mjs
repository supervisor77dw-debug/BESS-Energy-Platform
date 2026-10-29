// BESS-Investitions- und Anlagenplaner (AW-STROMKAI-20261029-INVESTITIONSPLANER-016): technische Vorplanung und
// Kostenstruktur als Eingangsgrößen für STROMKAI-WM. Reine Funktionen ohne Speicherzugriff.
// Abgrenzung: Der Planer rechnet Fläche, Dimensionierung, Investitionskosten und den Finanzierungsplan. Erlöse, Betriebskosten,
// EBITDA, Kapitalwert, IRR, DSCR und Amortisation rechnet ausschließlich STROMKAI-WM (wmParameter → WM.berechne).
// Ergebnisse sind schematische Vorplanung: keine bau-, brandschutz- oder netztechnische Zulässigkeit, keine Herstellerzusage.
import { createHash } from 'node:crypto';
import { sum, cent } from '../finance/geld.mjs';
import { annuitaet, CAPEX_POSTEN } from '../finance/wirtschaftlichkeit.mjs';

export const PLANER_VERSION = 'STROMKAI-IP 1.0';

// Datenstatus je Wert, nach Belastbarkeit absteigend. „enthalten“ = in einer anderen Position bepreist (Schutz vor Doppelzählung).
export const DATENSTATUS = {
  bestaetigtes_angebot: { name: 'Bestätigtes Herstellerangebot', mark: 'mark-ok' },
  freigegeben: { name: 'Freigegeben und abgeglichen', mark: 'mark-ok' },
  marktbenchmark: { name: 'Dokumentierter Marktbenchmark', mark: 'mark-info' },
  schaetzung: { name: 'Eigene Kostenschätzung', mark: 'mark-warn' },
  platzhalter: { name: 'Platzhalter', mark: 'mark-demo' },
  berechnet: { name: 'Berechnet', mark: 'mark-info' },
  enthalten: { name: 'In anderer Position enthalten', mark: 'mark-aud' },
  fehlt: { name: 'Wert fehlt', mark: 'mark-warn' },
};
export const ANGABE_STATUS = { bestaetigt: 'bestätigt', angenommen: 'angenommen', fehlt: 'fehlt' };
export const PHASEN = {
  vorplanung: { name: 'Vorplanung', text: 'Standardwerte und dokumentierte Schätzungen' },
  angebotsphase: { name: 'Angebotsphase', text: 'Konkrete Hersteller- und Lieferantenangebote' },
  investitionsentscheidung: { name: 'Investitionsentscheidung', text: 'Freigegebene und abgeglichene Kosten' },
};
export const FIN_STATUS = { annahme: 'Annahme (keine Bankkondition)', indikativ: 'Indikatives Bankangebot', zugesagt: 'Finanzierungszusage liegt vor' };
export const ERLOES_QUELLEN = {
  wm: 'Erlösannahmen der aktuellen STROMKAI-WM-Version des Projekts',
  b2_A: 'Backtest B2 (Referenzstrategie), Netzentgelt-Szenario A „befreit“',
  b2_B: 'Backtest B2 (Referenzstrategie), Netzentgelt-Szenario B „ohne Befreiung“',
};

// ---------- Speichersystem-Katalog ----------
// Platzhalter ohne Herstellerbezug: Maße eines 20-Fuß-Containers, Kapazität und Leistung frei angenommen, kein Preis.
// Vor Verwendung durch Datenblatt und Angebot ersetzen (neue Katalogversion).
export const KATALOG_FELDER = [
  ['hersteller', 'Hersteller', '', 'text'], ['produkt', 'Produktbezeichnung', '', 'text'], ['bauform', 'Bauform', 'Container/Rack', 'text'],
  ['laengeM', 'Länge', 'm'], ['breiteM', 'Breite', 'm'], ['hoeheM', 'Höhe', 'm'],
  ['abstandStirnM', 'Abstand Stirnseite', 'm (Wartung/Brandschutz)'], ['abstandSeiteM', 'Abstand Längsseite', 'm (Wartung/Brandschutz)'],
  ['kapNominalMWh', 'Nominale Kapazität je Block', 'MWh'], ['kapNutzbarMWh', 'Nutzbare Kapazität je Block', 'MWh'], ['leistungMW', 'Max. Lade-/Entladeleistung je Block', 'MW'],
  ['wirkungsgrad', 'Wirkungsgrad (Zyklus, AC)', '%', 'prozent'], ['lebensdauerJahre', 'Lebensdauer', 'Jahre'], ['zyklenGarantie', 'Garantierte Zyklen', 'Vollzyklen'],
  ['degradationJahr', 'Degradation', '% p. a.', 'prozent'], ['kuehlung', 'Kühlung', '', 'text'], ['hilfsenergieKW', 'Hilfsenergie je Block', 'kW'],
  ['brandschutz', 'Brandschutzkonzept', '', 'text'], ['schnittstellen', 'Technische Schnittstellen', '', 'text'],
  ['preisEURkWh', 'Anschaffungspreis', 'EUR je nutzbarer kWh'], ['lieferkostenEURBlock', 'Lieferkosten', 'EUR je Block'],
  ['kostenstand', 'Kostenstand', 'Datum', 'text'], ['quelle', 'Quelle', '', 'text'], ['angebotsdatum', 'Angebotsdatum', '', 'text'], ['lieferstatus', 'Lieferstatus', '', 'text'],
];
const platzhalter = (systemId, produkt, kapMWh, mw) => ({
  id: `${systemId}-v1`, systemId, version: 1, datenstatus: 'platzhalter', hersteller: 'Platzhalter (kein Hersteller)', produkt, bauform: 'Container 20 ft',
  laengeM: 6.06, breiteM: 2.44, hoeheM: 2.9, abstandStirnM: 3, abstandSeiteM: 1.5, kapNominalMWh: kapMWh, kapNutzbarMWh: Math.round(kapMWh * 0.95 * 100) / 100, leistungMW: mw,
  wirkungsgrad: 0.86, lebensdauerJahre: 20, zyklenGarantie: null, degradationJahr: 0.015, kuehlung: 'Flüssigkeitskühlung (angenommen)', hilfsenergieKW: null,
  brandschutz: 'offen – Brandschutzkonzept fehlt', schnittstellen: 'offen', preisEURkWh: null, lieferkostenEURBlock: null, kostenstand: null,
  quelle: 'Platzhalter – kein Herstellerdatenblatt; Wirkungsgrad und Degradation aus den Demo-Annahmen von STROMKAI-WM', angebotsdatum: null, lieferstatus: 'kein Angebot',
  erfasstVon: 'system', erfasstAm: '2026-10-29T17:00:00.000Z',
});
export const KATALOG_START = [
  platzhalter('sys-ph-1h', 'Platzhalter-Block 1 h', 2.5, 2.5),
  platzhalter('sys-ph-2h', 'Platzhalter-Block 2 h', 4, 2),
  platzhalter('sys-ph-4h', 'Platzhalter-Block 4 h', 4, 1),
];
export function pruefeSystem(x) {
  const f = [];
  for (const k of ['laengeM', 'breiteM', 'kapNominalMWh', 'kapNutzbarMWh', 'leistungMW']) if (!(x[k] > 0)) f.push(`${KATALOG_FELDER.find((y) => y[0] === k)[1]} muss größer als 0 sein.`);
  if (x.kapNutzbarMWh > x.kapNominalMWh) f.push('Die nutzbare Kapazität darf die nominale nicht übersteigen.');
  if (!(x.wirkungsgrad > 0 && x.wirkungsgrad <= 1)) f.push('Wirkungsgrad muss zwischen 0 und 100 % liegen.');
  if (!(x.degradationJahr >= 0 && x.degradationJahr < 1)) f.push('Degradation muss zwischen 0 und 100 % liegen.');
  for (const k of ['abstandStirnM', 'abstandSeiteM']) if (!(x[k] >= 0)) f.push('Abstände müssen ≥ 0 m sein.');
  if (x.preisEURkWh != null && !(x.preisEURkWh >= 0)) f.push('Preis muss ≥ 0 sein.');
  if (!DATENSTATUS[x.datenstatus] || ['berechnet', 'enthalten', 'freigegeben'].includes(x.datenstatus)) f.push('Datenstatus des Systems ist ungültig.');
  if (x.datenstatus === 'bestaetigtes_angebot' && !(x.angebotsdatum && x.quelle)) f.push('Ein bestätigtes Angebot braucht Angebotsdatum und Quelle.');
  return f;
}
// Neueste Version je System; ältere Versionen bleiben für frühere Planungsstände erhalten.
export const aktuelleSysteme = (katalog) => Object.values(katalog.reduce((a, x) => ((!a[x.systemId] || a[x.systemId].version < x.version) && (a[x.systemId] = x), a), {}));
export const systemVersion = (katalog, ref) => katalog.find((x) => x.systemId === ref?.systemId && x.version === ref?.version) || null;

// ---------- Planungsannahmen (Platzhalter, editierbar je Planungsstand) ----------
export const ANNAHMEN_START = {
  cosPhi: 0.95, mvaJeTrafo: 5, flaecheJeTrafoM2: 40, zufahrtBreiteM: 5, reserveAnteil: 0.05, opexSkalierung: 'skaliert',
  quelle: 'Platzhalter – vor Verwendung mit Fachplanung, Brandschutzkonzept und Netzbetreiber abstimmen',
};
export const ANNAHMEN_FELDER = [
  ['cosPhi', 'Leistungsfaktor cos φ', ''], ['mvaJeTrafo', 'Bemessungsleistung je Trafostation', 'MVA'], ['flaecheJeTrafoM2', 'Stellfläche je Trafo-/PCS-Station', 'm²'],
  ['zufahrtBreiteM', 'Breite der inneren Zufahrt', 'm'], ['reserveAnteil', 'Reserve für Risiken', '% der Investition', 'prozent'],
];

// ---------- 1. Grundstück und Flächenbilanz ----------
export const GRUNDSTUECK_START = {
  bezeichnung: '', flaecheM2: null, laengeM: null, breiteM: null, grenzabstandM: 3, nichtNutzbarM2: 0, zufahrtM2: 0, feuerwehrM2: 0, nebenanlagenM2: 0,
  netzMW: null, einspeiseMW: null, bezugMW: null, gelaende: '', entwaesserung: '', erschliessung: '',
  angaben: { flaeche: { status: 'fehlt', quelle: '' }, geometrie: { status: 'fehlt', quelle: '' }, abstaende: { status: 'angenommen', quelle: 'Platzhalter 3 m Grenzabstand' }, netz: { status: 'fehlt', quelle: '' } },
};
export function flaechenbilanz(g, { flaecheStationenM2 = 0 } = {}) {
  const hinweise = [];
  const LB = g.laengeM > 0 && g.breiteM > 0 ? g.laengeM * g.breiteM : null;
  const brutto = g.flaecheM2 > 0 ? g.flaecheM2 : LB || 0;
  if (g.flaecheM2 > 0 && LB && Math.abs(LB - g.flaecheM2) / g.flaecheM2 > 0.05) hinweise.push(`Länge × Breite (${Math.round(LB)} m²) weicht mehr als 5 % von der angegebenen Fläche ab. Für die Draufsicht gelten Länge und Breite.`);
  const rechteck = !!LB;
  const L = rechteck ? g.laengeM : Math.sqrt(brutto), B = rechteck ? g.breiteM : Math.sqrt(brutto);
  if (!rechteck && brutto) hinweise.push('Keine Länge und Breite: vereinfachte Annahme eines quadratischen Grundstücks.');
  const a = Math.max(0, g.grenzabstandM || 0);
  const innenL = Math.max(0, L - 2 * a), innenB = Math.max(0, B - 2 * a);
  const innen = rechteck ? innenL * innenB : (brutto ? innenL * innenB : 0);
  const abzug = { grenzabstand: Math.max(0, (rechteck ? LB : brutto) - innen), nichtNutzbar: g.nichtNutzbarM2 || 0, zufahrt: g.zufahrtM2 || 0, feuerwehr: g.feuerwehrM2 || 0, nebenanlagen: Math.max(g.nebenanlagenM2 || 0, flaecheStationenM2 || 0) };
  const fuerBloecke = Math.max(0, innen - abzug.nichtNutzbar - abzug.zufahrt - abzug.feuerwehr - abzug.nebenanlagen);
  const fehlend = [];
  if (!brutto) fehlend.push('Grundstücksfläche');
  if (!rechteck) fehlend.push('Länge und Breite bzw. Geometrie');
  if (g.netzMW == null) fehlend.push('Verfügbare Netzanschlussleistung');
  if (g.einspeiseMW == null) fehlend.push('Maximale Einspeiseleistung');
  if (g.bezugMW == null) fehlend.push('Maximale Bezugsleistung');
  if (!g.feuerwehrM2) fehlend.push('Flächen für Feuerwehrzufahrt und Brandschutz');
  if (!g.nebenanlagenM2) fehlend.push('Flächen für Trafostation, Schaltanlage und Netzanschluss');
  for (const [k, n] of [['gelaende', 'Gelände'], ['entwaesserung', 'Entwässerung'], ['erschliessung', 'Erschließung']]) if (!String(g[k] || '').trim()) fehlend.push(`Einschränkungen ${n}`);
  for (const [k, n] of [['flaeche', 'Fläche'], ['geometrie', 'Geometrie'], ['abstaende', 'Abstände'], ['netz', 'Netzanschluss']]) if (g.angaben?.[k]?.status !== 'bestaetigt') fehlend.push(`Bestätigung ${n} (Status: ${ANGABE_STATUS[g.angaben?.[k]?.status] || 'fehlt'})`);
  return { brutto, rechteck, L, B, innenL, innenB, innen, abzug, fuerBloecke, hinweise, fehlend };
}

// ---------- 2. Dimensionierung je Variante ----------
const aufrunden = (x) => Math.ceil(x - 1e-9);
export function dimensioniere(v, sys, g, ann) {
  const meldungen = [];
  if (!sys) return { fehler: ['Kein Speichersystem gewählt.'] };
  if (!(v.leistungMW > 0) || !(v.kapazitaetMWh > 0)) return { fehler: ['Leistung und Kapazität müssen größer als 0 sein.'] };
  const bloecke = Math.max(aufrunden(v.kapazitaetMWh / sys.kapNutzbarMWh), aufrunden(v.leistungMW / sys.leistungMW));
  const kapNutzbar = bloecke * sys.kapNutzbarMWh, kapNominal = bloecke * sys.kapNominalMWh, leistungBloecke = bloecke * sys.leistungMW;
  if (kapNutzbar > v.kapazitaetMWh * 1.1) meldungen.push({ art: 'info', text: `Die Blockgröße führt zu ${num1(kapNutzbar)} MWh nutzbar statt ${num1(v.kapazitaetMWh)} MWh (Überdeckung ${Math.round((kapNutzbar / v.kapazitaetMWh - 1) * 100)} %).` });
  if (leistungBloecke > v.leistungMW * 1.25) meldungen.push({ art: 'info', text: `Die Blöcke könnten ${num1(leistungBloecke)} MW liefern; Wechselrichter und Netz sind auf ${num1(v.leistungMW)} MW ausgelegt. Das gewählte System passt schlecht zur Speicherdauer.` });
  const grenzen = [g.netzMW, g.einspeiseMW].filter((x) => x != null && x >= 0);
  const netzGrenze = grenzen.length ? Math.min(...grenzen) : null;
  const einspeise = netzGrenze == null ? v.leistungMW : Math.min(v.leistungMW, netzGrenze);
  const bezugGrenzen = [g.netzMW, g.bezugMW].filter((x) => x != null && x >= 0);
  const bezug = bezugGrenzen.length ? Math.min(v.leistungMW, ...bezugGrenzen) : v.leistungMW;
  const netzDatenFehlen = g.netzMW == null || g.einspeiseMW == null || g.bezugMW == null;
  const wirtschaftlichkeitSperre = netzDatenFehlen
    ? 'Wirtschaftlichkeitsrechnung gesperrt: Netzanschluss-, Einspeise- oder Bezugsleistung fehlt. Die technische Vorplanung ist möglich, die Erlösrechnung ist nicht belastbar.'
    : (einspeise < v.leistungMW - 1e-9 || bezug < v.leistungMW - 1e-9)
      ? `Wirtschaftlichkeitsrechnung gesperrt: Die Jahresmodellrechnung bildet getrennte Lade- und Entladeleistungsgrenzen nicht zeitaufgelöst ab (installiert ${num1(v.leistungMW)} MW, Einspeisung ${num1(einspeise)} MW, Bezug ${num1(bezug)} MW). Für belastbare Erlöse ist ein Backtest mit passenden Netzgrenzen erforderlich.`
      : null;
  if (wirtschaftlichkeitSperre) meldungen.push({ art: 'bad', text: wirtschaftlichkeitSperre });
  if (netzGrenze == null) meldungen.push({ art: 'warn', text: 'Netzanschluss- bzw. Einspeiseleistung unbekannt: Die Variante ist netzseitig ungeprüft.' });
  else if (v.leistungMW > netzGrenze + 1e-9) meldungen.push({ art: 'warn', text: `Der Netzanschluss begrenzt die Einspeisung auf ${num1(einspeise)} MW (Anlage ${num1(v.leistungMW)} MW). Die Wirtschaftlichkeit rechnet mit ${num1(einspeise)} MW.` });
  if (bezug < v.leistungMW - 1e-9) meldungen.push({ art: 'warn', text: `Der Bezug ist auf ${num1(bezug)} MW begrenzt; die Ladeleistung reicht nicht für die volle Anlagenleistung.` });
  const mva = v.leistungMW / ann.cosPhi;
  const trafos = aufrunden(mva / ann.mvaJeTrafo);
  const block = (sys.laengeM + sys.abstandStirnM) * (sys.breiteM + sys.abstandSeiteM);
  const flaecheBloecke = bloecke * block, flaecheStationen = trafos * ann.flaecheJeTrafoM2;
  const bilanz = flaechenbilanz(g, { flaecheStationenM2: flaecheStationen });
  const bedarf = flaecheBloecke + flaecheStationen;
  // Nebenanlagenfläche umfasst die Trafo-/PCS-Station bereits (oder wird mindestens durch deren berechnete Fläche ersetzt).
  // Die Restfläche für Speicherblöcke darf die Stationsfläche daher nicht ein zweites Mal abziehen.
  const rest = bilanz.fuerBloecke - flaecheBloecke;
  const lay = layout(bilanz, g, sys, ann, bloecke, flaecheStationen);
  if (!bilanz.brutto) meldungen.push({ art: 'warn', text: 'Keine Grundstücksfläche erfasst: Flächenprüfung nicht möglich.' });
  else if (rest < 0) meldungen.push({ art: 'bad', text: `Die Anlage passt rechnerisch nicht auf die verfügbare Fläche: Blockflächenbedarf ${Math.round(flaecheBloecke)} m², für Blöcke verfügbar ${Math.round(bilanz.fuerBloecke)} m² (Fehlbetrag ${Math.round(-rest)} m²). Die Stations-/Nebenanlagenfläche ist separat berücksichtigt.` });
  else if (!lay.passt) meldungen.push({ art: 'bad', text: `Die Flächenbilanz reicht, aber in der schematischen Anordnung finden nur ${lay.plaetze} von ${bloecke} Blöcken Platz (Geometrie, Zufahrt, Stationen).` });
  return {
    bloecke, kapNutzbar, kapNominal, leistungBloecke, pcsMW: v.leistungMW, mva, trafos, schaltanlagen: 1, netzBedarfMW: v.leistungMW, netzGrenze, einspeise, bezug,
    dauerH: einspeise > 0 ? kapNutzbar / einspeise : null, flaecheBloecke, flaecheStationen, bedarf, rest, bilanz, layout: lay, meldungen, wirtschaftlichkeitSperre, fehler: [],
  };
}
const num1 = (x) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(x);

// Schematische Draufsicht: Innenfläche nach Grenzabstand, Zufahrt am unteren Rand, Stationen und Nebenanlagen am rechten Rand,
// Blöcke im Raster mit Wartungs-/Brandschutzabstand. Nur Flächenplausibilität, keine zulässige Aufstellplanung.
export function layout(bilanz, g, sys, ann, bloecke, flaecheStationen) {
  const W = bilanz.innenL, H = bilanz.innenB;
  if (!(W > 0 && H > 0)) return { passt: false, plaetze: 0, W, H, bloecke: [], zonen: [] };
  const zufahrtH = Math.min(H, ann.zufahrtBreiteM);
  // g.nebenanlagenM2 bezeichnet die Gesamtfläche inkl. Trafo-/PCS-Station; deshalb max statt Summe.
  const stationsB = Math.min(W, Math.max(flaecheStationen, g.nebenanlagenM2 || 0) / Math.max(1, H - zufahrtH));
  const zoneW = Math.max(0, W - stationsB), zoneH = Math.max(0, H - zufahrtH);
  const cw = sys.laengeM + sys.abstandStirnM, ch = sys.breiteM + sys.abstandSeiteM;
  const cols = Math.floor(zoneW / cw), rows = Math.floor(zoneH / ch);
  const plaetze = cols * rows;
  const pos = [];
  for (let i = 0; i < Math.min(bloecke, plaetze); i++) pos.push({ x: (i % cols) * cw + sys.abstandStirnM / 2, y: zufahrtH + Math.floor(i / cols) * ch + sys.abstandSeiteM / 2, w: sys.laengeM, h: sys.breiteM });
  return { passt: plaetze >= bloecke, plaetze, W, H, zufahrtH, stationsB, bloecke: pos, ueberzaehlig: Math.max(0, bloecke - plaetze) };
}

// ---------- 3. Investitionskosten ----------
// 19 Positionen. wm = Zielposition in STROMKAI-WM (jede Position genau einer WM-Position, keine Doppelzählung).
// Basis der Menge: kwh (installierte nutzbare kWh), mw (Anlagenleistung), block, pauschal, berechnet (Finanzierung), anteil (Reserve).
export const POSITIONEN = [
  [1, 'batterie', 'Batteriespeicher inkl. Container bzw. Racks', 'batterie', 'kwh'],
  [2, 'pcs', 'Wechselrichter / Power Conversion System', 'pcs', 'mw'],
  [3, 'trafo', 'Transformatoren', 'trafo', 'mw'],
  [4, 'schaltanlagen', 'Mittel- und Hochspannungsschaltanlagen', 'netzanschluss', 'pauschal'],
  [5, 'netzanschluss', 'Trafostation und Netzanschlusskomponenten', 'netzanschluss', 'mw'],
  [6, 'fundamente', 'Fundamente und Gründung', 'bau', 'block'],
  [7, 'erdarbeiten', 'Erdarbeiten und Geländevorbereitung', 'bau', 'pauschal'],
  [8, 'entwaesserung', 'Entwässerung und ggf. Rückhaltung', 'bau', 'pauschal'],
  [9, 'brandschutz', 'Brandschutz, Sicherheitsabstände, Brandschutzinfrastruktur', 'brandschutz', 'kwh'],
  [10, 'verkabelung', 'Verkabelung, Kabeltrassen und Anschlüsse', 'bau', 'pauschal'],
  [11, 'leittechnik', 'Kommunikations-, Mess- und Steuerungstechnik', 'leittechnik', 'pauschal'],
  [12, 'ems', 'EMS und übergeordnete Anlagensteuerung', 'leittechnik', 'pauschal'],
  [13, 'planung', 'Planung, Gutachten und Genehmigungen', 'planung', 'kwh'],
  [14, 'erschliessung', 'Erschließung, Zufahrt und sonstige Außenanlagen', 'erschliessung', 'kwh'],
  [15, 'montage', 'Montage, Inbetriebnahme und Abnahme', 'bau', 'kwh'],
  [16, 'nebenkosten', 'Bauherren- und Projektnebenkosten', 'nebenkosten', 'kwh'],
  [17, 'bauzeitzinsen', 'Finanzierungskosten während der Bauphase', 'bauzeitzinsen', 'berechnet'],
  [18, 'reserve', 'Reserve für Risiken und Unvorhergesehenes', 'reserve', 'anteil'],
  [19, 'sonstige', 'Sonstige projektspezifische Kosten', 'sonstige', 'pauschal'],
].map(([nr, key, name, wm, basis]) => ({ nr, key, name, wm, basis }));
const EINHEIT = { kwh: 'kWh', mw: 'MW', block: 'Block', pauschal: 'pauschal', berechnet: 'EUR', anteil: '%' };

// Vorbelegung ohne Angebote: Werte der synthetischen Demo-Annahmen von STROMKAI-WM (demo.mjs), dort als „Synthetische Demo-Annahmen
// (keine Marktdaten)“ gekennzeichnet. Positionen ohne Demo-Wert bleiben offen („Wert fehlt“), die Demo-Pauschale „Bau und Montage“
// (25 EUR/kWh) deckt Fundamente, Erdarbeiten, Entwässerung und Verkabelung mit ab und steht deshalb einmal unter Position 15.
const DEMO_QUELLE = 'Demo-Annahme STROMKAI-WM (synthetisch, keine Marktdaten)';
export const VORBELEGUNG = {
  1: { einzelpreis: 120, datenstatus: 'platzhalter', quelle: DEMO_QUELLE },
  2: { einzelpreis: 30000, datenstatus: 'platzhalter', quelle: DEMO_QUELLE },
  3: { einzelpreis: 20000, datenstatus: 'platzhalter', quelle: DEMO_QUELLE },
  4: { datenstatus: 'enthalten', enthaltenIn: 5, quelle: 'Demo-Pauschale Netzanschluss enthält Schaltanlagen' },
  5: { einzelpreis: 60000, datenstatus: 'platzhalter', quelle: `${DEMO_QUELLE}, inkl. Baukostenzuschuss` },
  6: { datenstatus: 'enthalten', enthaltenIn: 15, quelle: 'In Demo-Pauschale Bau und Montage enthalten' },
  7: { datenstatus: 'enthalten', enthaltenIn: 15, quelle: 'In Demo-Pauschale Bau und Montage enthalten' },
  8: { datenstatus: 'enthalten', enthaltenIn: 15, quelle: 'In Demo-Pauschale Bau und Montage enthalten' },
  9: { einzelpreis: 6, datenstatus: 'platzhalter', quelle: DEMO_QUELLE },
  10: { datenstatus: 'enthalten', enthaltenIn: 15, quelle: 'In Demo-Pauschale Bau und Montage enthalten' },
  11: { datenstatus: 'fehlt', quelle: 'Kein Referenzwert vorhanden' },
  12: { datenstatus: 'fehlt', quelle: 'Kein Referenzwert vorhanden' },
  13: { einzelpreis: 15, datenstatus: 'platzhalter', quelle: `${DEMO_QUELLE} (Planung 10 + Genehmigung 5 EUR/kWh)` },
  14: { einzelpreis: 8, datenstatus: 'platzhalter', quelle: DEMO_QUELLE },
  15: { einzelpreis: 25, datenstatus: 'platzhalter', quelle: `${DEMO_QUELLE}: Pauschale Bau und Montage inkl. Positionen 6, 7, 8, 10` },
  16: { einzelpreis: 7, datenstatus: 'platzhalter', quelle: DEMO_QUELLE },
  17: { datenstatus: 'berechnet', quelle: 'Finanzierungsrechner (Bauzeitzinsen)' },
  18: { datenstatus: 'berechnet', quelle: 'Planungsannahme Reserve' },
  19: { datenstatus: 'fehlt', quelle: 'Keine projektspezifischen Kosten erfasst' },
};

// Mengen und Beträge der Positionen 1–16 und 19 (ohne Bauzeitzinsen und Reserve, die der Finanzierungsrechner schließt).
// Überschreibungen (v.kosten[nr]) und zugeordnete Angebote ersetzen die Vorbelegung; ihre Herkunft bleibt sichtbar.
export function kostenpositionen(v, dim, sys, angebote = []) {
  return POSITIONEN.filter((p) => p.nr !== 17 && p.nr !== 18).map((p) => {
    const vb = { ...VORBELEGUNG[p.nr] };
    if (p.nr === 1 && sys?.preisEURkWh != null) Object.assign(vb, { einzelpreis: sys.preisEURkWh + (sys.lieferkostenEURBlock || 0) * dim.bloecke / (dim.kapNutzbar * 1000), datenstatus: sys.datenstatus, quelle: `Katalog: ${sys.hersteller} ${sys.produkt} V${sys.version}${sys.lieferkostenEURBlock ? ' inkl. Lieferkosten' : ''}`, preisstand: sys.kostenstand, lieferant: sys.hersteller });
    const ov = v.kosten?.[p.nr] || {};
    const ang = ov.angebotId ? angebote.find((a) => a.id === ov.angebotId && a.positionNr === p.nr) : null;
    const abgeleitet = { kwh: dim.kapNutzbar * 1000, mw: dim.pcsMW, block: dim.bloecke, pauschal: 1 }[p.basis];
    const r = { ...p, einheit: EINHEIT[p.basis], menge: abgeleitet, mengeAbgeleitet: abgeleitet, ...vb, ueberschrieben: false };
    if (ov.menge != null) { r.menge = ov.menge; r.ueberschrieben = true; }
    for (const k of ['einzelpreis', 'datenstatus', 'quelle', 'preisstand', 'lieferant', 'ausschreibung', 'begruendung', 'enthaltenIn']) if (ov[k] != null && ov[k] !== '') { r[k] = ov[k]; if (k === 'einzelpreis' || k === 'datenstatus') r.ueberschrieben = true; }
    if (ov.datenstatus && ov.datenstatus !== 'enthalten') delete r.enthaltenIn;
    if (ang) Object.assign(r, { einzelpreis: ang.einzelpreis, einheit: ang.einheit || r.einheit, datenstatus: 'bestaetigtes_angebot', quelle: `Angebot ${ang.lieferant} vom ${ang.datum}${ang.dokumentRef ? ` (${ang.dokumentRef})` : ''}`, preisstand: ang.datum, lieferant: ang.lieferant, angebotId: ang.id, ueberschrieben: true });
    if (ov.geaendertVon) Object.assign(r, { geaendertVon: ov.geaendertVon, geaendertAm: ov.geaendertAm });
    r.gesamt = r.datenstatus === 'enthalten' || r.datenstatus === 'fehlt' || !(r.einzelpreis >= 0) ? 0 : r.menge * r.einzelpreis;
    return r;
  });
}

// ---------- 4. Finanzierung ----------
export const FINANZIERUNG_START = {
  status: 'annahme', zusageRef: '', fkAnteil: 0.7, bauzeitMonate: 12, dsraMonate: 6,
  abrufplan: [{ monat: 0, anteil: 0.3 }, { monat: 6, anteil: 0.4 }, { monat: 11, anteil: 0.3 }],
  tranchen: [{ name: 'Tranche 1', anteil: 1, zins: 0.055, laufzeitJahre: 15, tilgungsfreiJahre: 1, modell: 'annuitaet', gebuehrAnteil: 0.02 }],
  quelle: 'Annahme (Zins, Laufzeit und Gebühren aus den Demo-Annahmen von STROMKAI-WM); keine Finanzierungszusage',
};
export const TILGUNGSMODELLE = { annuitaet: 'Annuität', linear: 'Ratentilgung (linear)', endfaellig: 'Endfällig' };
export function pruefeFinanzierung(fin, betriebsjahre) {
  const f = [];
  if (!(fin.fkAnteil >= 0 && fin.fkAnteil < 1)) f.push('Fremdkapitalanteil muss zwischen 0 und unter 100 % liegen.');
  if (!fin.tranchen?.length) f.push('Mindestens eine Darlehenstranche ist erforderlich.');
  else if (Math.abs(sum(fin.tranchen.map((t) => t.anteil)) - 1) > 1e-6) f.push('Die Anteile der Tranchen müssen zusammen 100 % ergeben.');
  for (const t of fin.tranchen || []) {
    if (!(t.zins >= 0 && t.zins < 1)) f.push(`${t.name}: Zins muss zwischen 0 und 100 % liegen.`);
    if (!(Number.isInteger(t.laufzeitJahre) && t.laufzeitJahre >= 1)) f.push(`${t.name}: Laufzeit muss eine ganze Zahl ≥ 1 sein.`);
    if (!(Number.isInteger(t.tilgungsfreiJahre) && t.tilgungsfreiJahre >= 0 && t.tilgungsfreiJahre < t.laufzeitJahre)) f.push(`${t.name}: Tilgungsfreie Jahre müssen kleiner als die Laufzeit sein.`);
    if (betriebsjahre && t.laufzeitJahre > betriebsjahre) f.push(`${t.name}: Laufzeit länger als die Betriebsdauer.`);
    if (!TILGUNGSMODELLE[t.modell]) f.push(`${t.name}: unbekanntes Tilgungsmodell.`);
    if (!(t.gebuehrAnteil >= 0 && t.gebuehrAnteil < 1)) f.push(`${t.name}: Gebühren müssen zwischen 0 und 100 % liegen.`);
  }
  if (!(fin.bauzeitMonate >= 0)) f.push('Bauzeit muss ≥ 0 Monate sein.');
  if (Math.abs(sum((fin.abrufplan || []).map((x) => x.anteil)) - 1) > 1e-6) f.push('Der Auszahlungsplan muss zusammen 100 % der Investition ergeben.');
  if ((fin.abrufplan || []).some((x) => !(x.monat >= 0 && x.monat <= fin.bauzeitMonate))) f.push('Auszahlungen müssen innerhalb der Bauzeit liegen.');
  if (fin.status === 'zugesagt' && !String(fin.zusageRef || '').trim()) f.push('Eine Finanzierungszusage braucht eine Dokumentreferenz.');
  return f;
}
// Tilgungsverlauf einer Tranche je Betriebsjahr als Anteil ihres Nennbetrags.
function trancheplan(t) {
  const out = []; let rest = 1;
  const R = t.laufzeitJahre - t.tilgungsfreiJahre;
  const rate = t.modell === 'annuitaet' ? annuitaet(1, t.zins, R) : 0;
  for (let j = 1; j <= t.laufzeitJahre; j++) {
    const zinsen = rest * t.zins;
    let tilgung = 0;
    if (j > t.tilgungsfreiJahre) tilgung = t.modell === 'linear' ? 1 / R : t.modell === 'endfaellig' ? (j === t.laufzeitJahre ? rest : 0) : rate - zinsen;
    if (j === t.laufzeitJahre) tilgung = rest;
    rest -= tilgung;
    out.push({ zinsen, tilgung });
  }
  return out;
}
// Schließt die Investition: Bauzeitzinsen und Reserve hängen von der Gesamtsumme ab (geschlossene Lösung, siehe docs/INVESTITIONSPLANER.md).
//   Basis B = Positionen 1–16, 19; Reserve r auf (B + I) wie in STROMKAI-WM; FK-Anteil f; gewichteter Bauzins z;
//   mittlere Kapitalbindung w = Σ Anteil · (Bauzeit − Abrufmonat) / 12. Ausgaben der Bauphase S = B + r · (B + I), anteilig aus FK.
//   I = f · z · w · S  ⇒  I = c · (1 + r) · B / (1 − c · r) mit c = f · z · w;  Gesamt = (B + I) · (1 + r)
export function finanzierung(basis, fin, reserveAnteil) {
  const zinsBau = sum(fin.tranchen.map((t) => t.anteil * t.zins));
  const w = sum(fin.abrufplan.map((x) => x.anteil * Math.max(0, fin.bauzeitMonate - x.monat) / 12));
  const c = fin.fkAnteil * zinsBau * w;
  const bauzeitzinsen = c > 0 ? c * (1 + reserveAnteil) * basis / (1 - c * reserveAnteil) : 0;
  const reserve = (basis + bauzeitzinsen) * reserveAnteil;
  const gesamt = basis + bauzeitzinsen + reserve;
  const fk = gesamt * fin.fkAnteil, ek = gesamt - fk;
  const gebuehrAnteil = sum(fin.tranchen.map((t) => t.anteil * t.gebuehrAnteil));
  const gebuehren = fk * gebuehrAnteil;
  const plaene = fin.tranchen.map(trancheplan);
  const n = Math.max(...fin.tranchen.map((t) => t.laufzeitJahre));
  const plan = Array.from({ length: n }, (_, i) => fin.tranchen.reduce((a, t, ti) => { const x = plaene[ti][i]; if (x) { a.zinsen += t.anteil * x.zinsen; a.tilgung += t.anteil * x.tilgung; } return a; }, { zinsen: 0, tilgung: 0 }));
  let rest = fk;
  const jahre = plan.map((x, i) => { const zinsen = x.zinsen * fk, tilgung = x.tilgung * fk; rest -= tilgung; return { jahr: i + 1, zinsen, tilgung, schuldendienst: zinsen + tilgung, restschuld: Math.max(0, rest) }; });
  // Liquidität in der Bauphase: Abruf anteilig aus Eigen- und Fremdkapital, Bauzeitzinsen bei Inbetriebnahme kapitalisiert
  let kum = 0;
  const bauphase = [...fin.abrufplan].sort((a, b) => a.monat - b.monat).map((x) => { const betrag = (gesamt - bauzeitzinsen) * x.anteil; kum += betrag; return { monat: x.monat, anteil: x.anteil, betrag, ek: betrag * (1 - fin.fkAnteil), fk: betrag * fin.fkAnteil, kumuliert: kum }; });
  return {
    basis, bauzeitzinsen, reserve, gesamt, fk, ek, gebuehren, gebuehrAnteil, zinsBau, kapitalbindungJahre: w, jahre, plan,
    zinsaufwand: sum(jahre.map((x) => x.zinsen)), schuldendienstMax: Math.max(0, ...jahre.map((x) => x.schuldendienst)), laufzeitJahre: n, bauphase,
    ekBedarfVorDSRA: ek + gebuehren,
  };
}

// ---------- 5. Erlösreferenz aus dem geprüften Trading-Export ----------
// Wählt die Simulationsanlage mit der nächstliegenden Speicherdauer (B2, R24M, Netzvariante) und übernimmt nur Mengen und Preise:
// Verkaufs- und Einkaufspreis je MWh, Vollzyklen, variable Kosten je ausgespeicherter MWh (Hilfsenergie, Börse, Bilanzierung,
// Netzentgelt-Arbeitspreis). Vermarktung, Verschleiß und Betriebskosten rechnet STROMKAI-WM selbst (keine Doppelzählung mit dem
// Netto-Deckungsbeitrag des Exports, der hier nicht als Erlös verwendet wird).
export function erloesReferenz(ergebnisse, dauerH, netzvariante, periode = 'R24M', strategie = 'B2') {
  const kandidaten = [...new Set(ergebnisse.map((x) => x.anlage))].map((a) => { const m = /([\d.,]+) MW \/ ([\d.,]+) MWh/.exec(a); return m ? { anlage: a, mw: Number(m[1]), mwh: Number(m[2]), dauer: Number(m[2]) / Number(m[1]) } : null; }).filter(Boolean);
  const best = kandidaten.sort((a, b) => Math.abs(a.dauer - dauerH) - Math.abs(b.dauer - dauerH) || b.mw - a.mw)[0];
  if (!best) return { fehler: 'Keine Simulationsanlage im Export.' };
  if (Math.abs(best.dauer - dauerH) / dauerH > 0.25) return { fehler: `Keine Simulation mit passender Speicherdauer (Variante ${num1(dauerH)} h, nächste Simulation ${num1(best.dauer)} h). Erlöse müssen aus STROMKAI-WM kommen.` };
  const r = ergebnisse.find((x) => x.anlage === best.anlage && x.periode === periode && x.strategie === strategie && x.netzvariante === netzvariante);
  if (!r) return { fehler: `Export enthält ${strategie}/${periode}/${netzvariante} für ${best.anlage} nicht.` };
  const s = r.summen, j = s.jahre || 1;
  const nutzbarMWh = s.netto_arbitrage_db_eur / j / s.netto_db_eur_je_mwh_nutzbar_jahr;
  return {
    anlage: best.anlage, dauerRef: best.dauer, periode, strategie, netzvariante, jahre: j, nutzbarMWhRef: nutzbarMWh,
    verkaufEURMWh: s.verkaufserloes_eur / s.entladen_mwh, einkaufEURMWh: s.bezugskosten_eur / s.geladen_mwh,
    variableKostenEURMWh: (s.hilfsenergie_eur + s.boersengebuehren_eur + s.bilanzierung_eur + s.netzentgelte_eur + s.steuern_abgaben_eur) / s.entladen_mwh,
    netzentgeltEURMWh: s.netzentgelte_eur / s.entladen_mwh, entladenJeMWhJahr: s.entladen_mwh / j / nutzbarMWh, wirkungsgradRef: s.entladen_mwh / s.geladen_mwh,
    nettoDBJeMWJahr: s.netto_db_eur_je_mw_jahr, abweichungDauer: Math.abs(best.dauer - dauerH) / dauerH,
  };
}

// ---------- Übergabe an STROMKAI-WM ----------
const OPEX_KAP = ['wartung', 'versicherung', 'monitoring', 'ersatzteile', 'rueckbau'];
// basis = Parameter der aktuellen WM-Version des Projekts (führend für Betriebskosten, Erlösannahmen, Bewertung).
export function wmParameter({ g, ann, v, dim, sys, pos, fin, finErg, basis, referenz }) {
  const capex = Object.fromEntries(CAPEX_POSTEN.map(([k]) => [k, 0]));
  for (const p of pos) capex[p.wm] += p.gesamt;
  capex.bauzeitzinsen = finErg.bauzeitzinsen;
  capex.reserveAnteil = ann.reserveAnteil;
  const t0 = basis.technik;
  const faktorMWh = dim.kapNutzbar / (t0.kapazitaetMWh * t0.nutzbarAnteil), faktorMW = dim.einspeise / t0.leistungMW;
  const opex = { ...basis.opex };
  if (ann.opexSkalierung === 'skaliert') { for (const k of OPEX_KAP) opex[k] = (basis.opex[k] || 0) * faktorMWh; opex.netzMess = (basis.opex.netzMess || 0) * faktorMW; }
  const technik = { ...t0, leistungMW: dim.einspeise, kapazitaetMWh: dim.kapNominal, nutzbarAnteil: dim.kapNutzbar / dim.kapNominal, wirkungsgrad: sys.wirkungsgrad, degradationJahr: sys.degradationJahr, betriebsjahre: Math.min(t0.betriebsjahre, sys.lebensdauerJahre || t0.betriebsjahre) };
  let einnahmen = basis.einnahmen;
  if (referenz && !referenz.fehler) {
    technik.zyklenJahr = referenz.entladenJeMWhJahr * dim.kapNutzbar / (dim.kapNominal * technik.nutzbarAnteil * technik.verfuegbarkeit);
    einnahmen = [{ key: `${referenz.strategie}_${referenz.netzvariante}`.toLowerCase(), name: `Day-Ahead-Arbitrage ${referenz.strategie} (Backtest ${referenz.periode}, ${referenz.netzvariante === 'befreit' ? 'Szenario A befreit' : 'Szenario B ohne Befreiung'})`, art: 'energie', anteil: 1, verkaufEURMWh: referenz.verkaufEURMWh, einkaufEURMWh: referenz.einkaufEURMWh, variableKostenEURMWh: referenz.variableKostenEURMWh }];
  }
  const finanzierungWM = { fkAnteil: fin.fkAnteil, zins: finErg.zinsBau, laufzeitJahre: finErg.laufzeitJahre, finanzierungskostenAnteil: finErg.gebuehrAnteil, dsraMonate: fin.dsraMonate, schuldendienstplan: finErg.plan };
  return {
    standort: { ...basis.standort, grundstueck: g.bezeichnung || basis.standort?.grundstueck || '', flaecheHa: dim.bilanz.brutto / 10000, betriebsflaecheHa: dim.bedarf / 10000 },
    technik, capex, opex, finanzierung: finanzierungWM, einnahmen, bewertung: basis.bewertung, ...(basis.szenarien ? { szenarien: basis.szenarien } : {}),
  };
}

// Prüfsumme eines Planungsstands (Parameterübersicht ohne Metadaten)
export const pruefsumme = (x) => createHash('sha256').update(JSON.stringify({ g: x.grundstueck, a: x.annahmen, v: x.varianten, f: x.finanzierung })).digest('hex').slice(0, 16);

// Gesamtrechnung einer Variante ohne Erlöse: Dimension, Kosten, Finanzierung, WM-Parameter.
export function rechneVariante({ stand, v, katalog, angebote, basis, ergebnisse }) {
  const sys = systemVersion(katalog, v.systemRef);
  const dim = dimensioniere(v, sys, stand.grundstueck, stand.annahmen);
  if (dim.fehler?.length) return { v, sys, dim, fehler: dim.fehler };
  const pos = kostenpositionen(v, dim, sys, angebote);
  const basisSumme = sum(pos.map((p) => p.gesamt));
  const finFehler = pruefeFinanzierung(stand.finanzierung, basis?.technik?.betriebsjahre);
  if (finFehler.length) return { v, sys, dim, pos, fehler: finFehler };
  const finErg = finanzierung(basisSumme, stand.finanzierung, stand.annahmen.reserveAnteil);
  const referenz = v.erloesQuelle?.startsWith('b2_') && ergebnisse ? erloesReferenz(ergebnisse, dim.dauerH, v.erloesQuelle === 'b2_A' ? 'befreit' : 'ohne_befreiung') : null;
  const erloesQuelleTatsaechlich = dim.wirtschaftlichkeitSperre ? null : (v.erloesQuelle?.startsWith('b2_') && referenz && !referenz.fehler ? v.erloesQuelle : 'wm');
  const hinweise = [];
  if (referenz?.fehler) hinweise.push(`Erlösreferenz nicht anwendbar: ${referenz.fehler} Es gelten die Erlösannahmen der STROMKAI-WM-Version.`);
  if (!basis) hinweise.push('Für dieses Projekt gibt es keine STROMKAI-WM-Version: Betriebskosten, Erlöse und Bewertung fehlen, Wirtschaftlichkeit nicht berechenbar.');
  const params = basis ? wmParameter({ g: stand.grundstueck, ann: stand.annahmen, v, dim, sys, pos, fin: stand.finanzierung, finErg, basis, referenz }) : null;
  const anteile = Object.fromEntries(Object.keys(DATENSTATUS).map((k) => [k, sum(pos.filter((p) => p.datenstatus === k).map((p) => p.gesamt))]));
  return { v, sys, dim, pos, basisSumme, finErg, referenz, erloesQuelleTatsaechlich, wirtschaftlichkeitSperre: dim.wirtschaftlichkeitSperre || null, params, anteile, hinweise, fehler: [] };
}

export const eurCent = cent;
