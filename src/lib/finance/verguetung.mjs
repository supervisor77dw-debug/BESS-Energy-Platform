// Eigentümervergütung: Optionsentgelt, Bauphasenvergütung, Pacht mit Mindestpacht und VPI-Anpassung, Kaufpreisformel,
// Vergleich Pacht/Kauf/Pacht mit späterem Kauf. Fachliche Grundlage: „BESS_Flaechensicherung_Verguetungsmodell_v0_2.xlsx“
// (PV Projekt, Status UNGEKLAERT) und Mustervertrag V0.2 §§ 5, 6, 10, 11, 12. Abweichungen und korrigierte Fehler der
// Arbeitsmappe sind in docs/FINANZMODELL.md dokumentiert (Abschnitt „Abgleich Excel“).
import { cent, sum } from './geld.mjs';

export const VERGUETUNG_VERSION = 'STROMKAI-VG 1.0';

const req = (cond, msg) => { if (!cond) throw new RangeError(msg); };
const nonneg = (x, n) => req(Number.isFinite(x) && x >= 0, `${n} muss eine Zahl ≥ 0 sein.`);

// Jahrespacht in der Betriebsphase: höherer Wert aus Flächenpacht und Mindestpacht (Excel Vor_Ort!B39)
export function jahrespacht({ flaecheHa, pachtJeHa, mindestpacht = 0 }) {
  nonneg(flaecheHa, 'Fläche'); nonneg(pachtJeHa, 'Pacht je ha'); nonneg(mindestpacht, 'Mindestpacht');
  return cent(Math.max(flaecheHa * pachtJeHa, mindestpacht));
}

// VPI-Anpassung: Faktor für Betriebsjahr n (1-basiert). Angepasst wird alle `intervallJahre` mit der Veränderung des Index,
// gewichtet mit dem vereinbarten Weitergabeanteil (100 % = volle Weitergabe). Werte aus echten Indexständen haben Vorrang
// (indexStaende: { basis, [jahr]: stand }); ohne Indexstände wird mit der angenommenen Rate gerechnet (Prognose).
export function vpiFaktor(jahr, { rate = 0, anteil = 1, intervallJahre = 1, indexStaende } = {}) {
  req(Number.isInteger(jahr) && jahr >= 1, 'Betriebsjahr muss ≥ 1 sein.');
  req(Number.isInteger(intervallJahre) && intervallJahre >= 1, 'Anpassungsintervall muss ≥ 1 Jahr sein.');
  const anpassungsjahr = Math.floor((jahr - 1) / intervallJahre) * intervallJahre; // Jahre seit Basis, die bereits angepasst sind
  if (anpassungsjahr === 0) return { faktor: 1, quelle: 'Basis' };
  if (indexStaende?.basis && indexStaende[anpassungsjahr] != null) {
    const veraenderung = indexStaende[anpassungsjahr] / indexStaende.basis - 1;
    return { faktor: 1 + veraenderung * anteil, quelle: 'Index' };
  }
  return { faktor: Math.pow(1 + rate * anteil, anpassungsjahr), quelle: 'Prognose' };
}

// Kaufpreis je m²: Referenzwert × Faktor + Prämie, begrenzt auf [Mindestpreis, Höchstpreis] (Excel Vor_Ort!B40)
export function kaufpreisJeM2({ referenzwert, faktor, praemie = 0, mindestpreis = 0, hoechstpreis = Infinity }) {
  nonneg(referenzwert, 'Referenzwert'); nonneg(faktor, 'Bodenwert-Faktor'); nonneg(praemie, 'Prämie'); nonneg(mindestpreis, 'Mindestpreis');
  req(hoechstpreis >= mindestpreis, 'Höchstpreis (Cap) darf nicht unter dem Mindestpreis liegen.'); // in der Arbeitsmappe nicht geprüft
  const formel = referenzwert * faktor + praemie;
  const wert = Math.min(Math.max(formel, mindestpreis), hoechstpreis);
  return { formel, wert, begrenzt: wert === formel ? null : wert === mindestpreis ? 'Mindestpreis' : 'Höchstpreis' };
}
// Kaufpreis gesamt bei Ausübung nach `jahre` Jahren mit jährlicher Indexierung (Excel Variantenvergleich!D-Spalte)
export function kaufpreis({ flaecheHa, ...p }, { jahre = 0, indexierung = 0 } = {}) {
  nonneg(flaecheHa, 'Fläche');
  const jeM2 = kaufpreisJeM2(p);
  return { ...jeM2, flaecheM2: flaecheHa * 10000, betrag: cent(flaecheHa * 10000 * jeM2.wert * Math.pow(1 + indexierung, jahre)) };
}

// Optionsentgelte: Grundlaufzeit (Monate) und Verlängerungen; je angefangenes Optionsjahr ein Jahresentgelt.
// Regel für nicht ganzjährige Laufzeiten: anteilig nach Monaten (in der Arbeitsmappe nicht geregelt → Annahme, siehe Doku).
export function optionsentgelte({ grundMonate = 24, verlaengerungen = [], entgelte = [] }) {
  req(entgelte.length > 0, 'Mindestens ein Optionsentgelt angeben.');
  const monate = grundMonate + sum(verlaengerungen);
  const jahre = [];
  for (let m = 0, j = 0; m < monate; m += 12, j++) {
    const anteil = Math.min(12, monate - m) / 12;
    const satz = entgelte[Math.min(j, entgelte.length - 1)];
    nonneg(satz, 'Optionsentgelt');
    jahre.push({ optionsjahr: j + 1, verlaengerung: m >= grundMonate, anteil, betrag: cent(satz * anteil) });
  }
  return { monate, jahre, summe: cent(sum(jahre.map((x) => x.betrag))) };
}

// Bauphasenvergütung: Jahresbetrag zeitanteilig über die tatsächliche Bauzeit (Monate). Nur bei Nutzung/Pacht (Vertrag § 10).
export function bauphasenverguetung({ jahresbetrag, bauMonate, variante }) {
  if (variante === 'kauf') return { betrag: 0, hinweis: 'Bei Kauf der Betriebsfläche keine Bauphasenvergütung (Vertrag § 10 gilt nur für die Nutzungsvariante).' };
  nonneg(jahresbetrag, 'Bauphasenvergütung'); nonneg(bauMonate, 'Bauzeit');
  return { betrag: cent(jahresbetrag * bauMonate / 12), hinweis: null };
}

// Pachtverlauf über n Betriebsjahre mit VPI-Faktor
export function pachtverlauf({ startpacht, jahre, vpi }) {
  return Array.from({ length: jahre }, (_, i) => {
    const { faktor, quelle } = vpiFaktor(i + 1, vpi);
    return { jahr: i + 1, betrag: cent(startpacht * faktor), quelle };
  });
}

const bw = (betrag, jahr, zins) => betrag / Math.pow(1 + zins, jahr); // nachschüssig, Zahlung am Jahresende

// Variantenvergleich (Excel-Blatt „Variantenvergleich“), korrigiert:
// – Hybrid kumuliert enthält den Kaufpreis im Kaufjahr (Excel-Spalte E unterschlägt ihn, Fehler E1);
// – Pachtsteigerung = VPI-Rate × Weitergabeanteil statt eines separat gesetzten Werts (Fehler E2);
// – Laufzeit aus dem Vertrag statt fest 20 Jahre (Fehler E3).
export function variantenvergleich({ startpacht, kaufpreisHeute, laufzeitJahre, pachtSteigerung, kaufJahr, kaufIndexierung, diskont }) {
  req(Number.isInteger(laufzeitJahre) && laufzeitJahre >= 1, 'Laufzeit muss ≥ 1 Jahr sein.');
  req(Number.isInteger(kaufJahr) && kaufJahr >= 0 && kaufJahr <= laufzeitJahre, 'Kaufjahr muss innerhalb der Laufzeit liegen.');
  const rows = [];
  let kumPacht = 0, kumHybrid = 0, bwPacht = 0, bwHybrid = 0;
  for (let j = 1; j <= laufzeitJahre; j++) {
    const pacht = startpacht * Math.pow(1 + pachtSteigerung, j - 1);
    const kaufIdx = kaufpreisHeute * Math.pow(1 + kaufIndexierung, j);
    kumPacht += pacht; bwPacht += bw(pacht, j, diskont);
    if (j <= kaufJahr) { kumHybrid += pacht; bwHybrid += bw(pacht, j, diskont); }
    if (j === kaufJahr) { kumHybrid += kaufIdx; bwHybrid += bw(kaufIdx, j, diskont); }
    rows.push({ jahr: j, pacht: cent(pacht), kumPacht: cent(kumPacht), kaufpreisIndexiert: cent(kaufIdx), kumHybrid: cent(kumHybrid), bwPacht: cent(bw(pacht, j, diskont)), bwKauf: cent(bw(kaufIdx, j, diskont)) });
  }
  const kaufImKaufjahr = kaufJahr === 0 ? kaufpreisHeute : kaufpreisHeute * Math.pow(1 + kaufIndexierung, kaufJahr);
  if (kaufJahr === 0) { kumHybrid = kaufpreisHeute; bwHybrid = kaufpreisHeute; }
  return {
    varianten: [
      { key: 'pacht', name: 'Langfristige Pacht', nominal: cent(kumPacht), barwert: cent(bwPacht), eigentumAmEnde: false },
      { key: 'kauf', name: 'Kauf nach Genehmigung', nominal: cent(kaufpreisHeute), barwert: cent(kaufpreisHeute), eigentumAmEnde: true },
      { key: 'hybrid', name: `Pacht, Kauf im Jahr ${kaufJahr}`, nominal: cent(kumHybrid), barwert: cent(bwHybrid), eigentumAmEnde: true, kaufpreisImKaufjahr: cent(kaufImKaufjahr) },
    ],
    verlauf: rows,
  };
}

// Variable (erfolgsabhängige) Vergütung – nur bei ausdrücklich vereinbartem Vertragstyp „variabel“.
// Bemessungsgrundlage: realisierter Handelsertrag nach Kosten und Gebühren aus der Handelsdaten-Schnittstelle.
export function variableVerguetung(vertrag, perioden) {
  if (vertrag?.typ !== 'variabel') throw new RangeError('Variable Vergütung nur für Verträge vom Typ „variabel“ – eine Festpacht ist nicht am Handelsergebnis beteiligt.');
  const { anteil, mindestbetrag = 0, deckel = Infinity } = vertrag.variabel;
  const basis = sum(perioden.map((p) => p.realisierterErtrag - p.handelskosten - p.gebuehren));
  const roh = Math.max(0, basis) * anteil;
  return { basis: cent(basis), betrag: cent(Math.min(Math.max(roh, mindestbetrag), deckel)) };
}
