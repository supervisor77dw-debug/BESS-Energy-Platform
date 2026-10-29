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
// Kapazitätsbasis eines Batteriepreises (Korrektur -017): ausdrücklich je Preis, nie aus dem Feldnamen abgeleitet.
// Katalogversionen vor -017 ohne Feld wurden mit der Maske „EUR je nutzbarer kWh“ erfasst (preisBasisVon).
export const PREISBASIS = { nominal: 'je nominaler kWh', nutzbar: 'je nutzbarer kWh', unbekannt: 'Preisbasis ungeklärt' };
export const preisBasisVon = (x) => x?.preisBasis || (x?.preisEURkWh != null ? 'nutzbar' : null);
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
  ['preisEURkWh', 'Anschaffungspreis', 'EUR je kWh (Basis siehe Preisbasis)'], ['preisBasis', 'Preisbasis', 'nominale oder nutzbare kWh', 'auswahl'], ['lieferkostenEURBlock', 'Lieferkosten', 'EUR je Block, zusätzlich zum Preis'],
  ['kostenstand', 'Kostenstand', 'Datum', 'text'], ['quelle', 'Quelle', '', 'text'], ['angebotsdatum', 'Angebotsdatum', '', 'text'], ['lieferstatus', 'Lieferstatus', '', 'text'],
];
const platzhalter = (systemId, produkt, kapMWh, mw) => ({
  id: `${systemId}-v1`, systemId, version: 1, datenstatus: 'platzhalter', hersteller: 'Platzhalter (kein Hersteller)', produkt, bauform: 'Container 20 ft',
  laengeM: 6.06, breiteM: 2.44, hoeheM: 2.9, abstandStirnM: 3, abstandSeiteM: 1.5, kapNominalMWh: kapMWh, kapNutzbarMWh: Math.round(kapMWh * 0.95 * 100) / 100, leistungMW: mw,
  wirkungsgrad: 0.86, lebensdauerJahre: 20, zyklenGarantie: null, degradationJahr: 0.015, kuehlung: 'Flüssigkeitskühlung (angenommen)', hilfsenergieKW: null,
  brandschutz: 'offen – Brandschutzkonzept fehlt', schnittstellen: 'offen', preisEURkWh: null, preisBasis: null, lieferkostenEURBlock: null, kostenstand: null,
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
  if (x.preisEURkWh != null && !PREISBASIS[x.preisBasis]) f.push('Zum Preis gehört eine Preisbasis (nominale, nutzbare oder ungeklärte kWh).');
  if (x.lieferkostenEURBlock != null && !(x.lieferkostenEURBlock >= 0)) f.push('Lieferkosten müssen ≥ 0 sein.');
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
// Ein Flächenmodell für Bilanz und Draufsicht (Korrektur AW-20261029-DK-STROMKAI-INVESTITIONSPLANER-KORREKTUR-017):
// Innenfläche (nach Grenzabstand) = Zufahrt + Feuerwehr/Brandschutz + nicht nutzbar + Stationsstreifen + Blockzone.
// Jede Kategorie wird genau einmal und als geometrischer Streifen reserviert:
//   Zufahrt oben über die ganze Länge, Höhe = max(Mindestbreite der Zufahrt, Eingabe / Länge) – die Eingabe ist Untergrenze;
//   Feuerwehr unten über die ganze Länge; nicht nutzbare Fläche links und Stationen (netzseitige Nebenanlagen + PCS-/Trafostationen
//   der Anlage) rechts, jeweils über die verbleibende Höhe. Blöcke im Raster der Blockzone mit vollem Abstand untereinander und zum
//   Zonenrand. Schematische Plausibilitätsprüfung, keine genehmigungsfähige Aufstellplanung.
export function flaechenmodell(g, ann = ANNAHMEN_START, stationenM2 = 0) {
  const hinweise = [], fehler = [];
  for (const [k, n] of [['flaecheM2', 'Grundstücksfläche'], ['laengeM', 'Länge'], ['breiteM', 'Breite'], ['grenzabstandM', 'Grenzabstand'], ['nichtNutzbarM2', 'Nicht nutzbare Fläche'], ['zufahrtM2', 'Zufahrt'], ['feuerwehrM2', 'Feuerwehrfläche'], ['nebenanlagenM2', 'Nebenanlagen']])
    if (g[k] != null && !(g[k] >= 0)) fehler.push(`${n} darf nicht negativ sein.`);
  const LB = g.laengeM > 0 && g.breiteM > 0 ? g.laengeM * g.breiteM : null;
  const brutto = g.flaecheM2 > 0 ? g.flaecheM2 : LB || 0;
  if (g.flaecheM2 > 0 && LB && Math.abs(LB - g.flaecheM2) / g.flaecheM2 > 0.05) hinweise.push(`Länge × Breite (${Math.round(LB)} m²) weicht mehr als 5 % von der angegebenen Fläche ab. Bilanz und Draufsicht verwenden Länge × Breite.`);
  const rechteck = !!LB;
  const L = rechteck ? g.laengeM : Math.sqrt(brutto), B = rechteck ? g.breiteM : Math.sqrt(brutto);
  if (!rechteck && brutto) hinweise.push('Keine Länge und Breite: vereinfachte Annahme eines quadratischen Grundstücks.');
  const basis = rechteck ? LB : brutto;
  const a = Math.max(0, g.grenzabstandM || 0);
  const W = Math.max(0, L - 2 * a), H = Math.max(0, B - 2 * a);
  const innen = W * H;
  const eingabe = { zufahrt: g.zufahrtM2 || 0, feuerwehr: g.feuerwehrM2 || 0, nichtNutzbar: g.nichtNutzbarM2 || 0, nebenanlagen: g.nebenanlagenM2 || 0, stationen: stationenM2 || 0 };
  const geo = { W, H, hz: 0, hf: 0, wn: 0, ws: 0, zoneW: 0, zoneH: 0 };
  let ok = innen > 0 && !fehler.length;
  if (ok) {
    geo.hz = Math.max(ann.zufahrtBreiteM || 0, eingabe.zufahrt / W);
    geo.hf = eingabe.feuerwehr / W;
    const rh = H - geo.hz - geo.hf;
    if (rh <= 0) { ok = false; fehler.push(`Zufahrt (${Math.round(Math.min(H, geo.hz) * W)} m²) und Feuerwehrfläche (${Math.round(eingabe.feuerwehr)} m²) belegen die gesamte Innenfläche.`); }
    else {
      geo.wn = eingabe.nichtNutzbar / rh; geo.ws = (eingabe.nebenanlagen + eingabe.stationen) / rh;
      geo.zoneW = W - geo.wn - geo.ws; geo.zoneH = rh;
      if (geo.zoneW <= 0) { ok = false; fehler.push('Nicht nutzbare Flächen und Stationen belegen die gesamte verbleibende Breite.'); }
    }
  }
  if (ok && geo.hz * W > eingabe.zufahrt + 0.5) hinweise.push(`Zufahrt geometrisch mit ${num1(geo.hz)} m Breite über die ganze Länge reserviert (${Math.round(geo.hz * W)} m²; Eingabe ${Math.round(eingabe.zufahrt)} m²).`);
  const zonen = ok
    ? { zufahrt: geo.hz * W, feuerwehr: geo.hf * W, nichtNutzbar: geo.wn * geo.zoneH, stationen: geo.ws * geo.zoneH, blockzone: geo.zoneW * geo.zoneH }
    : { zufahrt: Math.min(innen, Math.max((ann.zufahrtBreiteM || 0) * W, eingabe.zufahrt)), feuerwehr: eingabe.feuerwehr, nichtNutzbar: eingabe.nichtNutzbar, stationen: eingabe.nebenanlagen + eingabe.stationen, blockzone: 0 };
  return { brutto, basis, rechteck, L, B, grenzabstandM: a, innenL: W, innenB: H, innen, grenzabstandFlaeche: Math.max(0, basis - innen), eingabe, zonen, geo, passtGeometrie: ok, hinweise, fehler };
}
export function flaechenbilanz(g, ann = ANNAHMEN_START) {
  const m = flaechenmodell(g, ann, 0);
  // Für Speicherblöcke und anlageninterne Stationen verfügbar = Blockzone vor Abzug der PCS-/Trafostationen der Anlage
  const fuerBloecke = m.passtGeometrie ? m.zonen.blockzone : 0;
  const abzug = { grenzabstand: m.grenzabstandFlaeche, zufahrt: m.zonen.zufahrt, feuerwehr: m.zonen.feuerwehr, nichtNutzbar: m.zonen.nichtNutzbar, nebenanlagen: m.zonen.stationen };
  const fehlend = [];
  if (!m.brutto) fehlend.push('Grundstücksfläche');
  if (!m.rechteck) fehlend.push('Länge und Breite bzw. Geometrie');
  if (g.netzMW == null) fehlend.push('Verfügbare Netzanschlussleistung');
  if (g.einspeiseMW == null) fehlend.push('Maximale Einspeiseleistung');
  if (g.bezugMW == null) fehlend.push('Maximale Bezugsleistung');
  if (!g.feuerwehrM2) fehlend.push('Flächen für Feuerwehrzufahrt und Brandschutz');
  if (!g.nebenanlagenM2) fehlend.push('Flächen für Übergabestation, Schaltanlage und Netzanschluss');
  for (const [k, n] of [['gelaende', 'Gelände'], ['entwaesserung', 'Entwässerung'], ['erschliessung', 'Erschließung']]) if (!String(g[k] || '').trim()) fehlend.push(`Einschränkungen ${n}`);
  for (const [k, n] of [['flaeche', 'Fläche'], ['geometrie', 'Geometrie'], ['abstaende', 'Abstände'], ['netz', 'Netzanschluss']]) if (g.angaben?.[k]?.status !== 'bestaetigt') fehlend.push(`Bestätigung ${n} (Status: ${ANGABE_STATUS[g.angaben?.[k]?.status] || 'fehlt'})`);
  return { ...m, abzug, fuerBloecke, fehlend };
}

// ---------- 2. Dimensionierung je Variante ----------
// Leistungsgrößen getrennt (Korrektur -017): Batterieleistung der Blöcke, PCS-Leistung (= Anlagenleistung der Variante),
// zulässige Einspeisung und zulässiger Bezug am Netzanschluss. Netzgrenzen überschreiben die Anlagenleistung nicht.
export const NETZSTATUS = {
  ausreichend: 'Netzanschluss in beiden Richtungen ausreichend',
  ungeprueft: 'Netzseitig ungeprüft (Angaben fehlen)',
  eingeschraenkt: 'Netzanschluss begrenzt Laden oder Entladen – Jahresmodell nicht belastbar',
  unzulaessig: 'Unzulässige Netzkonfiguration – keine Wirtschaftlichkeitsrechnung',
};
const aufrunden = (x) => Math.ceil(x - 1e-9);
export function netzgrenzen(g, pcsMW) {
  const meldungen = [];
  const def = (x) => x != null && Number.isFinite(x);
  for (const [k, n] of [['netzMW', 'Netzanschlussleistung'], ['einspeiseMW', 'Einspeiseleistung'], ['bezugMW', 'Bezugsleistung']])
    if (def(g[k]) && g[k] < 0) return { status: 'unzulaessig', einspeise: null, bezug: null, grenzeEinspeise: null, grenzeBezug: null, meldungen: [{ art: 'bad', text: `${n} ist negativ. Keine Wirtschaftlichkeitsrechnung.` }] };
  if (def(g.netzMW) && def(g.einspeiseMW) && g.einspeiseMW > g.netzMW) meldungen.push({ art: 'warn', text: `Widersprüchlich: Einspeiseleistung ${num1(g.einspeiseMW)} MW über der Netzanschlussleistung ${num1(g.netzMW)} MW. Es gilt der kleinere Wert.` });
  if (def(g.netzMW) && def(g.bezugMW) && g.bezugMW > g.netzMW) meldungen.push({ art: 'warn', text: `Widersprüchlich: Bezugsleistung ${num1(g.bezugMW)} MW über der Netzanschlussleistung ${num1(g.netzMW)} MW. Es gilt der kleinere Wert.` });
  const grenzeE = [g.netzMW, g.einspeiseMW].filter(def), grenzeB = [g.netzMW, g.bezugMW].filter(def);
  const einspeise = Math.min(pcsMW, ...grenzeE), bezug = Math.min(pcsMW, ...grenzeB);
  let status;
  if (einspeise <= 0 || bezug <= 0) {
    status = 'unzulaessig';
    meldungen.push({ art: 'bad', text: `${einspeise <= 0 ? 'Einspeisung' : 'Bezug'} ist am Netzanschluss mit 0 MW begrenzt: Der Speicher kann nicht ${einspeise <= 0 ? 'entladen' : 'laden'}. Keine Wirtschaftlichkeitsrechnung.` });
  } else if (einspeise < pcsMW - 1e-9 || bezug < pcsMW - 1e-9) {
    status = 'eingeschraenkt';
    if (einspeise < pcsMW - 1e-9) meldungen.push({ art: 'warn', text: `Der Netzanschluss begrenzt die Einspeisung auf ${num1(einspeise)} MW (PCS ${num1(pcsMW)} MW).` });
    if (bezug < pcsMW - 1e-9) meldungen.push({ art: 'warn', text: `Der Netzanschluss begrenzt den Bezug auf ${num1(bezug)} MW (PCS ${num1(pcsMW)} MW).` });
    meldungen.push({ art: 'warn', text: 'STROMKAI-WM ist ein Jahresmodell ohne zeitaufgelösten Einsatz; unter Netzgrenzen ist die Wirtschaftlichkeit eingeschränkt und nicht belastbar. Übergabe an WM und Freigabe sind gesperrt.' });
  } else if (!grenzeE.length || !grenzeB.length) {
    status = 'ungeprueft';
    meldungen.push({ art: 'warn', text: `Netzseitig ungeprüft: ${[!grenzeE.length && 'Einspeisegrenze', !grenzeB.length && 'Bezugsgrenze'].filter(Boolean).join(' und ')} unbekannt.` });
  } else status = 'ausreichend';
  return { status, einspeise, bezug, grenzeEinspeise: grenzeE.length ? Math.min(...grenzeE) : null, grenzeBezug: grenzeB.length ? Math.min(...grenzeB) : null, meldungen };
}
export function dimensioniere(v, sys, g, ann) {
  const meldungen = [];
  if (!sys) return { fehler: ['Kein Speichersystem gewählt.'] };
  if (!(v.leistungMW > 0) || !(v.kapazitaetMWh > 0)) return { fehler: ['Leistung und Kapazität müssen größer als 0 sein.'] };
  if (!(sys.kapNutzbarMWh > 0 && sys.leistungMW > 0 && sys.kapNominalMWh > 0)) return { fehler: ['Speichersystem ohne gültige Kapazität oder Leistung.'] };
  const bloecke = Math.max(aufrunden(v.kapazitaetMWh / sys.kapNutzbarMWh), aufrunden(v.leistungMW / sys.leistungMW));
  const kapNutzbar = bloecke * sys.kapNutzbarMWh, kapNominal = bloecke * sys.kapNominalMWh, leistungBloecke = bloecke * sys.leistungMW;
  if (kapNutzbar > v.kapazitaetMWh * 1.1) meldungen.push({ art: 'info', text: `Die Blockgröße führt zu ${num1(kapNutzbar)} MWh nutzbar statt ${num1(v.kapazitaetMWh)} MWh (Überdeckung ${Math.round((kapNutzbar / v.kapazitaetMWh - 1) * 100)} %).` });
  if (leistungBloecke > v.leistungMW * 1.25) meldungen.push({ art: 'info', text: `Die Blöcke könnten ${num1(leistungBloecke)} MW liefern; Wechselrichter sind auf ${num1(v.leistungMW)} MW ausgelegt. Das gewählte System passt schlecht zur Speicherdauer.` });
  const pcsMW = v.leistungMW;
  const netz = netzgrenzen(g, pcsMW);
  meldungen.push(...netz.meldungen);
  const mva = pcsMW / ann.cosPhi;
  const trafos = aufrunden(mva / ann.mvaJeTrafo);
  const flaecheStationen = trafos * ann.flaecheJeTrafoM2;
  const bilanz = flaechenbilanz(g, ann);
  const modell = flaechenmodell(g, ann, flaecheStationen);
  const lay = layout(modell, sys, bloecke);
  const zelle = (sys.laengeM + sys.abstandStirnM) * (sys.breiteM + sys.abstandSeiteM);
  const flaecheBloecke = bloecke * zelle;
  const bedarf = flaecheBloecke + flaecheStationen;
  const rest = modell.zonen.blockzone - flaecheBloecke;
  const abstandFehlt = !(sys.abstandStirnM > 0 && sys.abstandSeiteM > 0);
  if (abstandFehlt) meldungen.push({ art: 'bad', text: 'Wartungs-/Sicherheitsabstand des Systems ist 0 m: Anordnung nicht belastbar und als nicht passend gewertet.' });
  else if (sys.datenstatus === 'platzhalter') meldungen.push({ art: 'info', text: `Abstände ${num1(sys.abstandStirnM)} m / ${num1(sys.abstandSeiteM)} m sind Platzhalter; maßgeblich ist das Brandschutzkonzept.` });
  if (bilanz.brutto) modell.fehler.forEach((t) => meldungen.push({ art: 'bad', text: t }));
  if (!bilanz.brutto) meldungen.push({ art: 'warn', text: 'Keine Grundstücksfläche erfasst: Flächenprüfung nicht möglich.' });
  else if (modell.passtGeometrie && rest < 0) meldungen.push({ art: 'bad', text: `Die Anlage passt rechnerisch nicht auf die Fläche: Blöcke inkl. Abstände ${Math.round(flaecheBloecke)} m², Blockzone ${Math.round(modell.zonen.blockzone)} m² (Fehlbetrag ${Math.round(-rest)} m²).` });
  else if (modell.passtGeometrie && !lay.passt) meldungen.push({ art: 'bad', text: `Die Fläche reicht rechnerisch, aber in der schematischen Anordnung finden nur ${lay.plaetze} von ${bloecke} Blöcken Platz (Blockzone ${num1(modell.geo.zoneW)} × ${num1(modell.geo.zoneH)} m).` });
  const passt = !!bilanz.brutto && modell.passtGeometrie && rest >= 0 && lay.passt && !abstandFehlt;
  return {
    bloecke, kapNutzbar, kapNominal, leistungBloecke, batterieMW: leistungBloecke, pcsMW, mva, trafos, schaltanlagen: 1, netzBedarfMW: pcsMW,
    netz, netzStatus: netz.status, netzGrenze: netz.grenzeEinspeise, einspeise: netz.einspeise, bezug: netz.bezug,
    dauerH: netz.einspeise > 0 ? kapNutzbar / netz.einspeise : null, dauerAnlageH: kapNutzbar / pcsMW,
    flaecheBloecke, flaecheStationen, bedarf, rest, passt, bilanz, modell, layout: lay, meldungen, fehler: [],
  };
}
const num1 = (x) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(x);

// Blöcke im Raster der Blockzone: n Spalten brauchen n · Länge + (n + 1) · Abstand (voller Abstand auch zum Zonenrand).
// Es werden höchstens so viele Blöcke platziert, wie Plätze vorhanden sind.
export function layout(modell, sys, bloecke) {
  const g = modell.geo;
  if (!modell.passtGeometrie || !(g.zoneW > 0 && g.zoneH > 0)) return { passt: false, plaetze: 0, cols: 0, rows: 0, bloecke: [], ueberzaehlig: bloecke };
  const aS = sys.abstandStirnM, aL = sys.abstandSeiteM;
  const cols = Math.max(0, Math.floor((g.zoneW - aS) / (sys.laengeM + aS) + 1e-9)), rows = Math.max(0, Math.floor((g.zoneH - aL) / (sys.breiteM + aL) + 1e-9));
  const plaetze = cols * rows;
  const pos = [];
  for (let i = 0; i < Math.min(bloecke, plaetze); i++) pos.push({ x: g.wn + aS + (i % cols) * (sys.laengeM + aS), y: g.hz + aL + Math.floor(i / cols) * (sys.breiteM + aL), w: sys.laengeM, h: sys.breiteM });
  return { passt: plaetze >= bloecke, plaetze, cols, rows, bloecke: pos, ueberzaehlig: Math.max(0, bloecke - plaetze) };
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
  // demo.mjs: batterie = 120 × kWh mit kWh = Kapazität × 1000; STROMKAI-WM rechnet diese Kapazität als nominal (nutzbarer Anteil 90 %)
  1: { einzelpreis: 120, preisBasis: 'nominal', datenstatus: 'platzhalter', quelle: `${DEMO_QUELLE}, je nominaler kWh` },
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
    // Position 1: Katalogpreis mit ausdrücklicher Preisbasis; Lieferkosten je Block getrennt und nur zum Katalogpreis
    if (p.nr === 1 && sys?.preisEURkWh != null) Object.assign(vb, { einzelpreis: sys.preisEURkWh, preisBasis: preisBasisVon(sys), lieferkostenEURBlock: sys.lieferkostenEURBlock || 0, datenstatus: sys.datenstatus, quelle: `Katalog: ${sys.hersteller} ${sys.produkt} V${sys.version}`, preisstand: sys.kostenstand, lieferant: sys.hersteller });
    const ov = v.kosten?.[p.nr] || {};
    const ang = ov.angebotId ? angebote.find((a) => a.id === ov.angebotId && a.positionNr === p.nr) : null;
    // Preisbasis von Position 1: Überschreibung bzw. Angebot vor Katalog vor Vorbelegung
    const basisKwh = p.nr === 1 ? (ang?.preisBasis || ov.preisBasis || vb.preisBasis || 'unbekannt') : null;
    const abgeleitet = { kwh: (basisKwh === 'nominal' ? dim.kapNominal : dim.kapNutzbar) * 1000, mw: dim.pcsMW, block: dim.bloecke, pauschal: 1 }[p.basis];
    const r = { ...p, einheit: p.nr === 1 ? (basisKwh === 'nominal' ? 'kWh nominal' : 'kWh nutzbar') : EINHEIT[p.basis], menge: abgeleitet, mengeAbgeleitet: abgeleitet, ...vb, ueberschrieben: false };
    if (p.nr === 1) { r.preisBasis = basisKwh; r.preisBasisUnklar = basisKwh === 'unbekannt'; }
    if (ov.menge != null) { r.menge = ov.menge; r.ueberschrieben = true; }
    for (const k of ['einzelpreis', 'datenstatus', 'quelle', 'preisstand', 'lieferant', 'ausschreibung', 'begruendung', 'enthaltenIn']) if (ov[k] != null && ov[k] !== '') { r[k] = ov[k]; if (k === 'einzelpreis' || k === 'datenstatus') r.ueberschrieben = true; }
    if (ov.datenstatus && ov.datenstatus !== 'enthalten') delete r.enthaltenIn;
    // Angebot oder Preisüberschreibung ersetzen den Katalogpreis samt Lieferkosten (keine zusätzliche Lieferkostenzeile)
    if (ang || ov.einzelpreis != null) r.lieferkostenEURBlock = 0;
    if (ov.preisBasis && p.nr === 1) r.ueberschrieben = true;
    if (ang) Object.assign(r, { einzelpreis: ang.einzelpreis, einheit: p.nr === 1 ? r.einheit : ang.einheit || r.einheit, datenstatus: 'bestaetigtes_angebot', quelle: `Angebot ${ang.lieferant} vom ${ang.datum}${ang.dokumentRef ? ` (${ang.dokumentRef})` : ''}`, preisstand: ang.datum, lieferant: ang.lieferant, angebotId: ang.id, ueberschrieben: true });
    if (ov.geaendertVon) Object.assign(r, { geaendertVon: ov.geaendertVon, geaendertAm: ov.geaendertAm });
    r.lieferkosten = p.nr === 1 ? (r.lieferkostenEURBlock || 0) * dim.bloecke : 0;
    r.gesamt = r.datenstatus === 'enthalten' || r.datenstatus === 'fehlt' || !(r.einzelpreis >= 0) ? 0 : r.menge * r.einzelpreis + r.lieferkosten;
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
  if (!(dauerH > 0 && Number.isFinite(dauerH))) return { fehler: 'Keine gültige Speicherdauer (Leistung 0 oder unbekannt).' };
  if (!ergebnisse?.length) return { fehler: 'Trading-Export nicht verfügbar.' };
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
  const faktorMWh = dim.kapNutzbar / (t0.kapazitaetMWh * t0.nutzbarAnteil), faktorMW = dim.pcsMW / t0.leistungMW;
  const opex = { ...basis.opex };
  if (ann.opexSkalierung === 'skaliert') { for (const k of OPEX_KAP) opex[k] = (basis.opex[k] || 0) * faktorMWh; opex.netzMess = (basis.opex.netzMess || 0) * faktorMW; }
  // leistungMW = installierte PCS-Leistung; einspeiseMW/bezugMW = Netzgrenzen (WM 1.1 prüft daran den Jahresdurchsatz)
  const technik = { ...t0, leistungMW: dim.pcsMW, einspeiseMW: dim.einspeise, bezugMW: dim.bezug, kapazitaetMWh: dim.kapNominal, nutzbarAnteil: dim.kapNutzbar / dim.kapNominal, wirkungsgrad: sys.wirkungsgrad, degradationJahr: sys.degradationJahr, betriebsjahre: Math.min(t0.betriebsjahre, sys.lebensdauerJahre || t0.betriebsjahre) };
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
export const BELASTBARKEIT = {
  modellrechnung: 'Wirtschaftliche Modellrechnung (vereinfachtes Jahresmodell vor Steuern)',
  ungeprueft: 'Modellrechnung, netzseitig ungeprüft',
  eingeschraenkt: 'Eingeschränkt – Netzgrenzen im Jahresmodell nicht abbildbar, nicht belastbar',
  nicht_berechenbar: 'Nicht berechenbar',
};
export function rechneVariante({ stand, v, katalog, angebote, basis, ergebnisse, datenversion = null }) {
  const sys = systemVersion(katalog, v.systemRef);
  const dim = dimensioniere(v, sys, stand.grundstueck, stand.annahmen);
  if (dim.fehler?.length) return { v, sys, dim, fehler: dim.fehler };
  const pos = kostenpositionen(v, dim, sys, angebote);
  const basisSumme = sum(pos.map((p) => p.gesamt));
  const finFehler = pruefeFinanzierung(stand.finanzierung, basis?.technik?.betriebsjahre);
  if (finFehler.length) return { v, sys, dim, pos, fehler: finFehler };
  const finErg = finanzierung(basisSumme, stand.finanzierung, stand.annahmen.reserveAnteil);
  // Referenz nach der Speicherdauer der Anlage (PCS); unter Netzgrenzen ist sie ohnehin nicht belastbar (siehe Belastbarkeit)
  const angefordert = ERLOES_QUELLEN[v.erloesQuelle] ? v.erloesQuelle : 'wm';
  const referenz = angefordert.startsWith('b2_') ? erloesReferenz(ergebnisse, dim.dauerAnlageH, angefordert === 'b2_A' ? 'befreit' : 'ohne_befreiung') : null;
  const hinweise = [];
  const nutzeRef = referenz && !referenz.fehler;
  const erloes = {
    angefordert, verwendet: nutzeRef ? angefordert : 'wm', rueckfall: !!referenz?.fehler, grund: referenz?.fehler || null,
    referenz: nutzeRef ? { anlage: referenz.anlage, dauerRefH: referenz.dauerRef, periode: referenz.periode, strategie: referenz.strategie, netzvariante: referenz.netzvariante, datenversion } : null,
  };
  if (erloes.rueckfall) hinweise.push(`Angeforderte Erlösquelle „${ERLOES_QUELLEN[angefordert]}“ nicht anwendbar: ${referenz.fehler} Verwendet werden die Erlösannahmen der STROMKAI-WM-Version.`);
  if (!basis) hinweise.push('Für dieses Projekt gibt es keine STROMKAI-WM-Version: Betriebskosten, Erlöse und Bewertung fehlen, Wirtschaftlichkeit nicht berechenbar.');
  // Belastbarkeit der Wirtschaftlichkeit
  let belastbarkeit = { ausreichend: 'modellrechnung', ungeprueft: 'ungeprueft', eingeschraenkt: 'eingeschraenkt', unzulaessig: 'nicht_berechenbar' }[dim.netzStatus];
  if (!basis) belastbarkeit = 'nicht_berechenbar';
  const params = basis && belastbarkeit !== 'nicht_berechenbar' ? wmParameter({ g: stand.grundstueck, ann: stand.annahmen, v, dim, sys, pos, fin: stand.finanzierung, finErg, basis, referenz: nutzeRef ? referenz : null }) : null;
  const anteile = Object.fromEntries(Object.keys(DATENSTATUS).map((k) => [k, sum(pos.filter((p) => p.datenstatus === k).map((p) => p.gesamt))]));
  const sperren = [];
  if (belastbarkeit !== 'modellrechnung') sperren.push(BELASTBARKEIT[belastbarkeit]);
  if (pos.some((p) => p.preisBasisUnklar && p.gesamt > 0)) sperren.push('Preisbasis der Batterieposition ungeklärt');
  if (!dim.passt) sperren.push('Anlage passt nicht auf das Grundstück');
  return { v, sys, dim, pos, basisSumme, finErg, referenz, erloes, belastbarkeit, sperren, params, anteile, hinweise, fehler: [] };
}

export const eurCent = cent;
