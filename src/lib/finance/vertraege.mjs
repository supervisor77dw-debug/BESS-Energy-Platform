// Vertrags- und Angebotsversionierung sowie Eigentümeransprüche.
// Stufen: 1 Simulation, 2 interner Verhandlungsvorschlag (beide unverbindlich, eigene Sammlung),
// 3 vereinbarte Eckdaten, 4 unterzeichneter Vertrag, 5 Nachtrag (verbindlich, nur anfügen, nie ändern), 6 abgerechnete Zahlungen.
// Ansprüche werden ausschließlich aus dem jeweils gültigen verbindlichen Vertragsstand abgeleitet – nie aus Simulationen.
import { cent } from './geld.mjs';
import { optionsentgelte, jahrespacht, vpiFaktor, kaufpreis, variableVerguetung } from './verguetung.mjs';

export const STUFEN = {
  simulation: { nr: 1, name: 'Unverbindliche Simulation', verbindlich: false },
  vorschlag: { nr: 2, name: 'Interner Verhandlungsvorschlag', verbindlich: false },
  eckdaten: { nr: 3, name: 'Vereinbarte Eckdaten', verbindlich: true },
  unterzeichnet: { nr: 4, name: 'Unterzeichneter Vertrag', verbindlich: true },
  nachtrag: { nr: 5, name: 'Vertragsnachtrag', verbindlich: true },
};
export const VERTRAGSTYPEN = {
  festpacht: 'Festpacht (Nutzung)',
  kaufoption: 'Kaufoption (Erwerb der Betriebsfläche)',
  pacht_spaeterer_kauf: 'Pacht mit späterem Kauf',
  variabel: 'Variable Vergütung (ausdrücklich vereinbart)',
};
export const ANSPRUCH_STATUS = { vereinbart: 'Vereinbart', faellig: 'Fällig', bezahlt: 'Bezahlt', demo: 'Demo-Buchung (keine reale Zahlung)', prognose: 'Prognose' };

const addMonths = (iso, m) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10); };
const addYears = (iso, y) => addMonths(iso, 12 * y);

// Neuen Stand anlegen (Angebot oder verbindlicher Vertragsstand). Bestehende Stände werden nie verändert.
export function neuerStand(db, { vertragId, projectId, ownerContactId, stufe, typ, bedingungen, dokumentRef, gueltigAb, notiz, von, freigabeEigentuemer = false, synthetisch = false }) {
  if (!STUFEN[stufe]) throw new RangeError('Unbekannte Vertragsstufe.');
  if (!VERTRAGSTYPEN[typ]) throw new RangeError('Unbekannter Vertragstyp.');
  const verbindlich = STUFEN[stufe].verbindlich;
  if ((stufe === 'unterzeichnet' || stufe === 'nachtrag') && !dokumentRef) throw new RangeError('Unterzeichnete Verträge und Nachträge brauchen eine Dokumentreferenz.');
  if (stufe === 'nachtrag' && !db.vertragsstaende.some((x) => x.vertragId === vertragId && x.stufe === 'unterzeichnet')) throw new RangeError('Ein Nachtrag setzt einen unterzeichneten Vertrag voraus.');
  const sammlung = verbindlich ? db.vertragsstaende : db.verguetungsangebote;
  const version = 1 + Math.max(0, ...sammlung.filter((x) => x.vertragId === vertragId).map((x) => x.version));
  const stand = { id: `${verbindlich ? 'vs' : 'va'}-${vertragId}-${version}`, vertragId, projectId, ownerContactId, stufe, typ, version,
    bedingungen: structuredClone(bedingungen), dokumentRef: dokumentRef || null, gueltigAb: gueltigAb || null, notiz: notiz || '', erstelltVon: von, erstelltAm: new Date().toISOString(),
    freigabeEigentuemer: verbindlich ? !!freigabeEigentuemer : false,
    // Demo-Kennzeichen vererbt sich: Aus einem synthetischen Vertrag entsteht nie ein echter verbindlicher Stand
    synthetisch: !!synthetisch || [...db.vertragsstaende, ...db.verguetungsangebote].some((x) => x.vertragId === vertragId && x.synthetisch) };
  Object.freeze(stand.bedingungen);
  sammlung.push(stand);
  return stand;
}

// Gültiger verbindlicher Stand eines Vertrags: höchste Version (Nachträge ersetzen frühere Stände ab ihrem Gültigkeitsdatum)
export const gueltigerStand = (db, vertragId) => db.vertragsstaende.filter((x) => x.vertragId === vertragId).sort((a, b) => b.version - a.version)[0] || null;

function statusFuer(key, faellig, zahlungen, heute, sicher = true) {
  const z = zahlungen.filter((x) => x.anspruchKey === key);
  if (z.length) return { status: z.every((x) => x.synthetisch) ? 'demo' : 'bezahlt', bezahlt: cent(z.reduce((a, x) => a + x.betrag, 0)), bezahltAm: z.at(-1).bezahltAm };
  if (!sicher) return { status: 'prognose' };
  return { status: faellig <= heute ? 'faellig' : 'vereinbart' };
}

// Ansprüche des Eigentümers aus dem verbindlichen Stand. `heute` als ISO-Datum für reproduzierbare Ergebnisse.
export function ansprueche(stand, { zahlungen = [], heute = new Date().toISOString().slice(0, 10), handelsdaten = [], pachtVorschau = 5 } = {}) {
  if (!stand) return [];
  const b = stand.bedingungen, out = [];
  const zahl = zahlungen.filter((z) => z.vertragId === stand.vertragId);
  if (b.option) {
    const o = optionsentgelte({ grundMonate: b.option.grundMonate, verlaengerungen: b.option.verlaengerungen || [], entgelte: b.option.entgelte });
    const genutzt = b.option.verlaengerungenGenutzt || 0;
    for (const j of o.jahre) {
      const faellig = addMonths(b.option.beginn, 12 * (j.optionsjahr - 1));
      if (b.bau?.beginn && faellig >= b.bau.beginn) continue; // Optionszeit endet mit Baubeginn
      const verlJahr = j.verlaengerung ? Math.ceil((12 * (j.optionsjahr - 1) - b.option.grundMonate + 1) / 12) : 0;
      const sicher = !j.verlaengerung || verlJahr <= genutzt;
      const key = `option-${j.optionsjahr}`;
      out.push({ key, art: 'Optionsvergütung', bezeichnung: `Optionsjahr ${j.optionsjahr}${j.verlaengerung ? ' (Verlängerung)' : ''}`, faellig, betrag: j.betrag, ...statusFuer(key, faellig, zahl, heute, sicher),
        hinweis: sicher ? null : 'nur bei Ausübung der Verlängerung' });
    }
  }
  const nutzung = stand.typ === 'festpacht' || stand.typ === 'pacht_spaeterer_kauf';
  if (nutzung && b.bau) {
    if (b.bau.beginn && b.bau.ende) {
      const monate = Math.max(0, Math.round((Date.parse(b.bau.ende) - Date.parse(b.bau.beginn)) / (30.4375 * 864e5)));
      out.push({ key: 'bau', art: 'Bauphasenvergütung', bezeichnung: `Bauphase (${monate} Monate)`, faellig: b.bau.beginn, betrag: cent(b.bau.jahresbetrag * monate / 12), ...statusFuer('bau', b.bau.beginn, zahl, heute) });
    } else out.push({ key: 'bau', art: 'Bauphasenvergütung', bezeichnung: 'Bauphase (Beginn noch offen)', faellig: null, betrag: cent(b.bau.jahresbetrag), status: 'prognose', hinweis: 'Jahresbetrag; zeitanteilig ab tatsächlichem Baubeginn' });
  }
  if (nutzung && b.pacht) {
    const start = jahrespacht(b.pacht);
    const cod = b.pacht.inbetriebnahme || null;
    const n = Math.min(b.pacht.laufzeitJahre, pachtVorschau);
    for (let j = 1; j <= n; j++) {
      const { faktor, quelle } = vpiFaktor(j, b.pacht.vpi || {});
      const faellig = cod ? addYears(cod, j - 1) : null;
      const key = `pacht-${j}`;
      const sicher = !!cod && quelle !== 'Prognose';
      out.push({ key, art: 'Pacht', bezeichnung: `Pacht Betriebsjahr ${j}${quelle === 'Index' ? ' (VPI angepasst)' : ''}`, faellig, betrag: cent(start * faktor), vpiFaktor: faktor, vpiQuelle: quelle,
        ...(cod ? statusFuer(key, faellig, zahl, heute, sicher) : { status: 'prognose' }), hinweis: cod ? (quelle === 'Prognose' ? 'Indexanpassung geschätzt' : null) : 'ab kommerzieller Inbetriebnahme' });
    }
  }
  if (stand.typ === 'variabel' && b.variabel) {
    const jahre = [...new Set(handelsdaten.map((h) => h.periode.slice(0, 4)))].sort();
    for (const jahr of jahre) {
      const per = handelsdaten.filter((h) => h.periode.startsWith(jahr));
      const v = variableVerguetung({ typ: 'variabel', variabel: b.variabel }, per);
      const key = `variabel-${jahr}`;
      out.push({ key, art: 'Variable Vergütung', bezeichnung: `Erfolgsbeteiligung ${jahr} (${per.length} Monate Handelsdaten)`, faellig: `${Number(jahr) + 1}-03-31`, betrag: v.betrag, bemessung: v.basis,
        ...statusFuer(key, `${Number(jahr) + 1}-03-31`, zahl, heute, per.length === 12), hinweis: per.length === 12 ? null : 'Jahr noch nicht vollständig – vorläufiger Wert' });
    }
  }
  return out;
}

// Kaufpreisregelung (keine Zahlung, solange die Option nicht ausgeübt ist)
export function kaufpreisregelung(stand, { betriebsjahr = 0 } = {}) {
  const k = stand?.bedingungen?.kauf;
  if (!k || !(stand.typ === 'kaufoption' || stand.typ === 'pacht_spaeterer_kauf')) return null;
  const heute = kaufpreis({ flaecheHa: k.flaecheHa, referenzwert: k.referenzwert, faktor: k.faktor, praemie: k.praemie, mindestpreis: k.mindestpreis, hoechstpreis: k.hoechstpreis });
  const spaet = kaufpreis({ flaecheHa: k.flaecheHa, referenzwert: k.referenzwert, faktor: k.faktor, praemie: k.praemie, mindestpreis: k.mindestpreis, hoechstpreis: k.hoechstpreis }, { jahre: betriebsjahr || k.bisBetriebsjahr || 0, indexierung: k.indexierung || 0 });
  return { heute, spaetestens: spaet, bisBetriebsjahr: k.bisBetriebsjahr, ausgeuebt: k.ausgeuebtAm || null };
}

export function summenNachStatus(liste) {
  const s = { vereinbart: 0, faellig: 0, bezahlt: 0, demo: 0, prognose: 0 };
  for (const a of liste) s[a.status] = cent(s[a.status] + (a.status === 'bezahlt' || a.status === 'demo' ? a.bezahlt : a.betrag));
  return s;
}
