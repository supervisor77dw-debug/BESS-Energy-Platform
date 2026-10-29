// Projektwirtschaftlichkeit einer BESS-Projektgesellschaft (vereinfachtes Jahresmodell, vor Steuern).
// Annahmen (dokumentiert in docs/FINANZMODELL.md): Zahlungen am Jahresende; Investition und Finanzierung in Jahr 0;
// Energieerlöse = ausgespeicherte Energie × Verkaufspreis − eingespeicherte Energie (inkl. Wirkungsgradverluste) × Einkaufspreis;
// Leistungserlöse (Regelreserve) je MW und Jahr. Jede Vermarktung belegt einen Anteil der Speicherleistung; die Summe der
// Anteile darf 100 % nicht überschreiten (keine Doppelzählung parallel vermarkteter Leistung). Keine Steuern, kein Restwert.
// 1.1 (AW-STROMKAI-20261029-INVESTITIONSPLANER-016): optionale Positionen Leittechnik/EMS, Bauzeitzinsen und Sonstige;
// optionale variable Handelskosten je ausgespeicherter MWh; optionaler Schuldendienstplan (Tranchen, tilgungsfreie Jahre)
// aus dem Finanzierungsrechner des Investitionsplaners. Ohne diese Angaben rechnet 1.1 identisch zu 1.0 (Regressionstest).
import { createHash } from 'node:crypto';
import { cent, sum } from './geld.mjs';

export const MODELL_VERSION = 'STROMKAI-WM 1.1';

export const SZENARIEN = {
  konservativ: { name: 'Konservativ', erloes: 0.8, capex: 1.1, opex: 1.1, zinsDelta: 0.01, degradationDelta: 0.005 },
  basis: { name: 'Basis', erloes: 1, capex: 1, opex: 1, zinsDelta: 0, degradationDelta: 0 },
  optimistisch: { name: 'Optimistisch', erloes: 1.15, capex: 0.95, opex: 0.95, zinsDelta: -0.005, degradationDelta: -0.003 },
};

export const CAPEX_POSTEN = [['batterie', 'Batteriesysteme'], ['pcs', 'Wechselrichter (PCS)'], ['trafo', 'Transformatoren'], ['netzanschluss', 'Netzanschluss inkl. Baukostenzuschuss'], ['bau', 'Bau und Montage'], ['erschliessung', 'Erschließung'], ['brandschutz', 'Brandschutz'], ['planung', 'Planung'], ['genehmigung', 'Genehmigungen und Gutachten'], ['nebenkosten', 'Nebenkosten'], ['leittechnik', 'Mess-, Steuer- und Leittechnik, EMS'], ['bauzeitzinsen', 'Finanzierungskosten der Bauphase'], ['sonstige', 'Sonstige Projektkosten']];
export const OPEX_POSTEN = [['wartung', 'Wartung'], ['versicherung', 'Versicherung'], ['grundstueck', 'Grundstückskosten (Pacht)'], ['netzMess', 'Netz- und Messkosten'], ['it', 'IT und Kommunikation'], ['monitoring', 'Monitoring und Betriebsführung'], ['ersatzteile', 'Ersatzteile'], ['rueckbau', 'Rückbauvorsorge']];

const fehlerListe = (p) => {
  const f = [];
  const t = p.technik || {};
  const pos = (v, n) => { if (!(Number.isFinite(v) && v > 0)) f.push(`${n} muss größer als 0 sein.`); };
  const quote = (v, n) => { if (!(Number.isFinite(v) && v >= 0 && v <= 1)) f.push(`${n} muss zwischen 0 und 100 % liegen.`); };
  pos(t.leistungMW, 'Leistung'); pos(t.kapazitaetMWh, 'Kapazität'); quote(t.nutzbarAnteil, 'Nutzbarer Anteil'); quote(t.wirkungsgrad, 'Wirkungsgrad');
  quote(t.verfuegbarkeit, 'Verfügbarkeit'); quote(t.degradationJahr, 'Degradation'); pos(t.betriebsjahre, 'Betriebsdauer');
  if (!(t.zyklenJahr >= 0)) f.push('Zyklen je Jahr müssen ≥ 0 sein.');
  if (t.verschleissEURMWh != null && !(t.verschleissEURMWh >= 0)) f.push('Batterieverschleiß muss ≥ 0 EUR/MWh sein.');
  if (t.wirkungsgrad === 0) f.push('Wirkungsgrad darf nicht 0 sein.');
  const anteile = sum((p.einnahmen || []).filter((e) => e.art !== 'fix').map((e) => e.anteil || 0));
  if (anteile > 1 + 1e-9) f.push(`Die Vermarktungsanteile ergeben ${Math.round(anteile * 100)} % der Speicherleistung. Mehr als 100 % würde parallel vermarktete Leistung doppelt zählen.`);
  for (const e of p.einnahmen || []) if (e.art !== 'fix') quote(e.anteil, `Anteil „${e.name}“`);
  const fin = p.finanzierung || {};
  quote(fin.fkAnteil, 'Fremdkapitalanteil');
  if (fin.fkAnteil > 0) { if (!(fin.laufzeitJahre >= 1)) f.push('Kreditlaufzeit muss ≥ 1 Jahr sein.'); if (!(fin.zins >= 0)) f.push('Zins muss ≥ 0 sein.'); }
  if (fin.laufzeitJahre > t.betriebsjahre) f.push('Die Kreditlaufzeit ist länger als die Betriebsdauer.');
  for (const e of p.einnahmen || []) if (e.variableKostenEURMWh != null && !(e.variableKostenEURMWh >= 0)) f.push(`Variable Kosten „${e.name}“ müssen ≥ 0 EUR/MWh sein.`);
  // Netzgrenzen (1.1, optional): Jahresdurchsatz Jahr 1 darf physikalisch nicht über Einspeise- bzw. Bezugsgrenze × 8760 h liegen.
  // Obergrenze, keine Aussage über erreichbare Zyklen (die ein zeitaufgelöster Einsatz bestimmt).
  for (const [k, n] of [['einspeiseMW', 'Einspeiseleistung'], ['bezugMW', 'Bezugsleistung']]) if (t[k] != null && !(t[k] >= 0)) f.push(`${n} muss ≥ 0 sein.`);
  if (!f.length && (t.einspeiseMW != null || t.bezugMW != null)) {
    const anteilE = sum((p.einnahmen || []).filter((e) => e.art === 'energie').map((e) => e.anteil || 0));
    const aus = t.kapazitaetMWh * t.nutzbarAnteil * t.zyklenJahr * t.verfuegbarkeit * anteilE;
    if (aus > 0 && t.einspeiseMW != null && aus > t.einspeiseMW * 8760 * t.verfuegbarkeit + 1e-6) f.push(`Der Jahresdurchsatz (${Math.round(aus)} MWh) übersteigt, was die Einspeiseleistung von ${t.einspeiseMW} MW in einem Jahr zulässt.`);
    if (aus > 0 && t.bezugMW != null && aus / t.wirkungsgrad > t.bezugMW * 8760 * t.verfuegbarkeit + 1e-6) f.push(`Die Ladeenergie (${Math.round(aus / t.wirkungsgrad)} MWh) übersteigt, was die Bezugsleistung von ${t.bezugMW} MW in einem Jahr zulässt.`);
  }
  if (fin.schuldendienstplan != null) {
    const plan = fin.schuldendienstplan;
    if (!Array.isArray(plan) || plan.some((x) => !(x.zinsen >= 0) || !(x.tilgung >= 0))) f.push('Schuldendienstplan: Zinsen und Tilgung je Jahr müssen ≥ 0 sein.');
    else if (plan.length > t.betriebsjahre) f.push('Der Schuldendienstplan ist länger als die Betriebsdauer.');
    else if (Math.abs(sum(plan.map((x) => x.tilgung)) - 1) > 1e-6) f.push('Schuldendienstplan: Die Tilgungsanteile müssen zusammen 100 % des Fremdkapitals ergeben.');
  }
  return f;
};
export const pruefeParameter = fehlerListe;

export const npv = (rate, cfs) => cfs.reduce((a, cf, t) => a + cf / Math.pow(1 + rate, t), 0);
// Interner Zinsfuß per Intervallhalbierung; null, wenn kein Vorzeichenwechsel im Suchbereich existiert.
export function irr(cfs, lo = -0.99, hi = 1.5) {
  if (!cfs.some((c) => c < 0) || !cfs.some((c) => c > 0)) return null;
  let flo = npv(lo, cfs), fhi = npv(hi, cfs);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid, cfs);
    if (Math.abs(fm) < 1e-7 || hi - lo < 1e-10) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}
export function annuitaet(betrag, zins, jahre) {
  if (betrag === 0) return 0;
  return zins === 0 ? betrag / jahre : betrag * zins / (1 - Math.pow(1 + zins, -jahre));
}
// Amortisation: Jahre bis zur Deckung der Anfangsinvestition (linear interpoliert); null, wenn nicht erreicht.
export function amortisation(cfs) {
  let kum = cfs[0];
  for (let t = 1; t < cfs.length; t++) {
    const vor = kum; kum += cfs[t];
    if (vor < 0 && kum >= 0) return t - 1 + (-vor / cfs[t]);
  }
  return kum >= 0 && cfs[0] >= 0 ? 0 : null;
}

export function berechne(params, szenarioKey = 'basis', { quelle = 'Eingabe Portal', berechnetAm = new Date().toISOString() } = {}) {
  const fehler = fehlerListe(params);
  if (fehler.length) { const e = new RangeError(fehler.join(' ')); e.fehler = fehler; throw e; }
  const sz = { ...SZENARIEN[szenarioKey], ...(params.szenarien?.[szenarioKey] || {}) };
  const t = params.technik, fin = params.finanzierung, bw = params.bewertung || {};
  const deg = Math.max(0, t.degradationJahr + (sz.degradationDelta || 0));
  const zins = Math.max(0, (fin.zins || 0) + (sz.zinsDelta || 0));

  // Investition
  const capexPosten = CAPEX_POSTEN.map(([k, n]) => ({ key: k, name: n, betrag: (params.capex?.[k] || 0) * sz.capex }));
  const capexOhneReserve = sum(capexPosten.map((x) => x.betrag));
  const reserve = capexOhneReserve * (params.capex?.reserveAnteil || 0);
  const gesamtinvestition = capexOhneReserve + reserve;
  const fk = gesamtinvestition * (fin.fkAnteil || 0);
  const finanzierungskosten = fk * (fin.finanzierungskostenAnteil || 0);
  // Schuldendienstplan (1.1): Anteile am Fremdkapital je Betriebsjahr; Zinsen als Satz auf das Fremdkapital (aus dem Finanzierungsrechner)
  // Szenarien verschieben den Zins um zinsDelta: bei festem Tilgungsverlauf ändern sich die Zinsen um Delta × Restschuld am
  // Jahresanfang (Korrektur -017; vorher proportional zum gewichteten Satz, falsch bei Tranchen mit unterschiedlichen Zinsen).
  const zinsDeltaEff = zins - (fin.zins || 0);
  let offen = 1;
  const plan = fin.schuldendienstplan ? fin.schuldendienstplan.map((x) => { const z = Math.max(0, x.zinsen + zinsDeltaEff * offen); offen -= x.tilgung; return { zinsen: z * fk, tilgung: x.tilgung * fk }; }) : null;
  const rate = plan ? Math.max(0, ...plan.map((x) => x.zinsen + x.tilgung)) : annuitaet(fk, zins, fin.laufzeitJahre || 1);
  const dsra = rate * (fin.dsraMonate || 0) / 12; // Schuldendienstreserve, aus Eigenkapital, Freigabe nach Kreditende
  const ekBedarf = gesamtinvestition - fk + finanzierungskosten + dsra;

  // Leistungsvermarktung (1.1): höchstens die am Netzanschluss in beide Richtungen zulässige Leistung
  const leistungMarkt = Math.min(t.leistungMW, t.einspeiseMW ?? Infinity, t.bezugMW ?? Infinity);
  // Betriebsjahre
  const jahre = [];
  let restschuld = fk;
  const n = t.betriebsjahre;
  for (let j = 1; j <= n; j++) {
    const kapFaktor = Math.pow(1 - deg, j - 1);
    const erloese = (params.einnahmen || []).map((e) => {
      let betrag = 0, ausMWh = 0, einMWh = 0;
      if (e.art === 'energie') {
        ausMWh = t.kapazitaetMWh * t.nutzbarAnteil * t.zyklenJahr * t.verfuegbarkeit * e.anteil * kapFaktor;
        einMWh = ausMWh / t.wirkungsgrad;
        betrag = (ausMWh * e.verkaufEURMWh - einMWh * e.einkaufEURMWh) * sz.erloes;
      } else if (e.art === 'leistung') betrag = leistungMarkt * e.anteil * e.eurJeMWJahr * t.verfuegbarkeit * sz.erloes;
      else betrag = (e.eurJahr || 0) * sz.erloes;
      return { key: e.key, name: e.name, betrag, ausMWh, einMWh, variableKostenEURMWh: e.variableKostenEURMWh || 0 };
    });
    const brutto = sum(erloese.map((x) => x.betrag));
    const vermarktung = brutto * (params.opex?.vermarktungAnteil || 0);
    const esk = Math.pow(1 + (params.opex?.steigerung || 0), j - 1);
    const opexPosten = OPEX_POSTEN.map(([k, nm]) => ({ key: k, name: nm, betrag: (params.opex?.[k] || 0) * sz.opex * esk }));
    // Batterieverschleiß als Zyklenkosten je ausgespeicherter MWh (Rücklage für Zelltausch/Augmentierung); Kapazitätsverlust bildet die Degradation ab
    const verschleissMWh = sum(erloese.map((x) => x.ausMWh));
    opexPosten.push({ key: 'verschleiss', name: 'Batterieverschleiß (Zyklenkosten)', betrag: verschleissMWh * (t.verschleissEURMWh || 0) * sz.opex * esk });
    const variabel = sum(erloese.map((x) => x.ausMWh * (x.variableKostenEURMWh || 0)));
    if (variabel > 0) opexPosten.push({ key: 'variabel', name: 'Variable Handelskosten (Netzentgelt-Arbeitspreis, Hilfsenergie, Börse, Bilanzierung)', betrag: variabel * sz.opex * esk });
    const opex = sum(opexPosten.map((x) => x.betrag));
    const ebitda = brutto - vermarktung - opex;
    let zinsen = 0, tilgung = 0;
    if (plan) { const x = plan[j - 1]; if (x) { zinsen = x.zinsen; tilgung = Math.min(x.tilgung, restschuld); restschuld -= tilgung; } }
    else if (j <= (fin.laufzeitJahre || 0) && restschuld > 1e-9) { zinsen = restschuld * zins; tilgung = rate - zinsen; restschuld -= tilgung; }
    const schuldendienst = zinsen + tilgung;
    const dsraFreigabe = j === (plan ? plan.length : fin.laufzeitJahre) ? dsra : 0;
    const operativerCF = ebitda; // vor Steuern, ohne Veränderung des Umlaufvermögens
    jahre.push({ jahr: j, kapazitaetsfaktor: kapFaktor, erloese, brutto, vermarktung, opexPosten, opex, ebitda, operativerCF, zinsen, tilgung, schuldendienst, restschuld: Math.max(0, restschuld),
      dscr: schuldendienst > 0 ? operativerCF / schuldendienst : null, ekCF: operativerCF - schuldendienst + dsraFreigabe,
      ausgespeichertMWh: sum(erloese.map((x) => x.ausMWh)), eingespeichertMWh: sum(erloese.map((x) => x.einMWh)) });
  }
  const projektCF = [-gesamtinvestition, ...jahre.map((x) => x.operativerCF)];
  const ekCF = [-ekBedarf, ...jahre.map((x) => x.ekCF)];
  const dscrs = jahre.filter((x) => x.dscr != null).map((x) => x.dscr);
  const kennzahlen = {
    gesamtinvestition: cent(gesamtinvestition), investitionJeKWh: gesamtinvestition / (t.kapazitaetMWh * 1000),
    betriebskostenJahr1: cent(jahre[0].opex), bruttoerloeseJahr1: cent(jahre[0].brutto), vermarktungskostenJahr1: cent(jahre[0].vermarktung),
    ebitdaJahr1: cent(jahre[0].ebitda), operativerCFJahr1: cent(jahre[0].operativerCF), schuldendienstJahr: cent(rate), fremdkapital: cent(fk),
    eigenkapitalbedarf: cent(ekBedarf), dscrMin: dscrs.length ? Math.min(...dscrs) : null, dscrDurchschnitt: dscrs.length ? sum(dscrs) / dscrs.length : null,
    amortisationJahre: amortisation(projektCF), kapitalwert: cent(npv(bw.diskontsatz ?? 0.07, projektCF)), projektIRR: irr(projektCF), eigenkapitalIRR: irr(ekCF),
  };
  return {
    meta: { modellVersion: MODELL_VERSION, berechnetAm, quelle, szenario: szenarioKey, szenarioName: sz.name, diskontsatz: bw.diskontsatz ?? 0.07,
      parameterPruefsumme: createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 16), hinweis: 'Vereinfachtes Jahresmodell vor Steuern; keine Anlageberatung.' },
    capex: { posten: capexPosten.map((x) => ({ ...x, betrag: cent(x.betrag) })), reserve: cent(reserve), gesamt: cent(gesamtinvestition), fremdkapital: cent(fk), finanzierungskosten: cent(finanzierungskosten), dsra: cent(dsra) },
    jahre, cashflows: { projekt: projektCF, eigenkapital: ekCF }, kennzahlen,
  };
}

export const berechneSzenarien = (params, opts) => Object.fromEntries(Object.keys(SZENARIEN).map((k) => [k, berechne(params, k, opts)]));
