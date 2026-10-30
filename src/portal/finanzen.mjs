// Portalbereiche Projektwirtschaftlichkeit, Vergütung und Handelsdaten.
// Rechte (serverseitig, je Projekt über policy.rolesForProject):
//   Wirtschaftlichkeit (CAPEX, OPEX, Finanzierung, Erlöse, Szenarien): Plattformadministration, Projektleitung
//   Vergütungsrechner und Angebote (Simulation, Verhandlungsvorschlag): zusätzlich Vertriebskoordination der Projekte
//   Verbindliche Vertragsstände: Plattformadministration, Projektleitung · Zahlungen und Handelsdaten: Plattformadministration
//   Investoren: nur freigegebene Kennzahlen ihrer Projekte · Eigentümer: nur eigene, für sie freigegebene Vertragsstände
import { config } from '../config.mjs';
import { getDb, persist, newId, now, audit } from '../lib/store.mjs';
import { parseForm, redirect, send } from '../lib/http.mjs';
import { html, raw, fmtDate } from '../lib/html.mjs';
import * as P from '../lib/policy.mjs';
import { eur, num, pct, parseZahl, cent } from '../lib/finance/geld.mjs';
import * as WM from '../lib/finance/wirtschaftlichkeit.mjs';
import * as REF from '../lib/finance/referenz.mjs';
import * as VG from '../lib/finance/verguetung.mjs';
import * as VT from '../lib/finance/vertraege.mjs';
import * as HD from '../lib/finance/handelsdaten.mjs';
import { berechnungCsv, verguetungPdf } from '../lib/finance/export.mjs';
import { PHASES } from '../public/pages.mjs';

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const nf = () => new HttpError(404, 'Nicht gefunden');
const roles = (u, pid) => P.rolesForProject(u, pid);
export const darfWirtschaftlichkeit = (u, pid) => roles(u, pid).some((r) => r === 'admin' || r === 'projektleitung');
export const darfRechner = (u, pid) => darfWirtschaftlichkeit(u, pid) || roles(u, pid).some((r) => r === 'vertrieb_nord' || r === 'vertrieb_sued');
export const darfInvestorKennzahlen = (u, pid) => roles(u, pid).includes('investor');
const csrf = (s) => raw(`<input type="hidden" name="_csrf" value="${s.csrf}">`);
const synth = () => html`<span class="mark mark-demo" title="Erfundene Werte für die Entwicklungsphase">synthetisch</span>`;
const projekt = (db, pid) => db.projects.find((p) => p.id === pid);
const phase = (p) => (p ? `Phase ${p.phase}: ${PHASES[p.phase - 1]?.[0] || ''}` : '–');
const STATUS_MARK = { vereinbart: 'mark-info', faellig: 'mark-warn', bezahlt: 'mark-ok', demo: 'mark-demo', prognose: 'mark-aud' };
const statusMark = (st) => html`<span class="mark ${STATUS_MARK[st]}">${VT.ANSPRUCH_STATUS[st]}</span>`;
const heute = () => new Date().toISOString().slice(0, 10);

// ---------- Eingabefelder Wirtschaftlichkeit ----------
const F = (g, k, label, einheit, art = 'zahl', hinweis = '') => ({ g, k, label, einheit, art, hinweis });
export const FELDER = [
  F('standort', 'grundstueck', 'Grundstück', '', 'text'), F('standort', 'flaecheHa', 'Flächengröße', 'ha'), F('standort', 'optionsflaecheHa', 'Optionsfläche', 'ha'), F('standort', 'betriebsflaecheHa', 'Betriebsfläche', 'ha'),
  F('standort', 'netzanschluss', 'Netzanschlussstandort', '', 'text'), F('standort', 'grundstuecksmodell', 'Grundstücksmodell', '', 'auswahl'),
  F('technik', 'leistungMW', 'Leistung', 'MW'), F('technik', 'kapazitaetMWh', 'Kapazität', 'MWh'), F('technik', 'nutzbarAnteil', 'Nutzbare Kapazität', '%', 'prozent'),
  F('technik', 'wirkungsgrad', 'Wirkungsgrad (Zyklus)', '%', 'prozent', 'Ein- und Ausspeicherung zusammen; bildet die Speicherverluste ab'), F('technik', 'degradationJahr', 'Degradation', '% p. a.', 'prozent', 'Kapazitätsverlust; bei Augmentierung auf 0 setzen'),
  F('technik', 'verschleissEURMWh', 'Batterieverschleiß', 'EUR je ausgespeicherter MWh', 'zahl', 'Zyklenkosten als Rücklage für Zelltausch und Augmentierung; erscheint unter den Betriebskosten'),
  F('technik', 'zyklenJahr', 'Zyklen', 'je Jahr'), F('technik', 'betriebsjahre', 'Betriebsdauer', 'Jahre'), F('technik', 'verfuegbarkeit', 'Verfügbarkeit', '%', 'prozent'),
  ...WM.CAPEX_POSTEN.map(([k, n]) => F('capex', k, n, 'EUR')), F('capex', 'reserveAnteil', 'Reserve', '% der Investition', 'prozent'),
  ...WM.OPEX_POSTEN.map(([k, n]) => F('opex', k, n, 'EUR/Jahr')), F('opex', 'vermarktungAnteil', 'Vermarktung', '% der Bruttoerlöse', 'prozent'), F('opex', 'steigerung', 'Kostensteigerung', '% p. a.', 'prozent'),
  F('finanzierung', 'fkAnteil', 'Fremdkapitalanteil', '%', 'prozent'), F('finanzierung', 'zins', 'Zins', '% p. a.', 'prozent'), F('finanzierung', 'laufzeitJahre', 'Laufzeit', 'Jahre', 'zahl', 'Annuitätentilgung'),
  F('finanzierung', 'finanzierungskostenAnteil', 'Finanzierungskosten', '% des Kredits', 'prozent'), F('finanzierung', 'dsraMonate', 'Schuldendienstreserve', 'Monate'),
  F('bewertung', 'diskontsatz', 'Diskontsatz Kapitalwert', '%', 'prozent'),
];
const GRUPPEN = { standort: 'Standort', technik: 'Batterietechnik', capex: 'Investition (CAPEX)', opex: 'Betrieb (OPEX)', finanzierung: 'Finanzierung', einnahmen: 'Einnahmen', bewertung: 'Bewertung' };
const ERLOES_FELDER = [['anteil', 'Anteil der Leistung', '%', 'prozent'], ['verkaufEURMWh', 'Verkaufspreis', 'EUR/MWh'], ['einkaufEURMWh', 'Einkaufspreis', 'EUR/MWh'], ['eurJeMWJahr', 'Leistungspreis', 'EUR/MW/Jahr'], ['eurJahr', 'Jahreserlös', 'EUR/Jahr'], ['variableKostenEURMWh', 'Variable Handelskosten', 'EUR je ausgespeicherter MWh']];

function paramsAusFormular(fields, alt) {
  const p = structuredClone(alt);
  const fehler = [];
  for (const f of FELDER) {
    const raw_ = fields[`${f.g}.${f.k}`];
    if (raw_ === undefined) continue;
    if (f.art === 'text' || f.art === 'auswahl') { p[f.g][f.k] = String(raw_).slice(0, 200); continue; }
    const n = parseZahl(raw_);
    if (!Number.isFinite(n)) { fehler.push(`${f.label}: bitte eine Zahl eingeben.`); continue; }
    p[f.g][f.k] = f.art === 'prozent' ? n / 100 : n;
  }
  p.einnahmen = p.einnahmen.map((e) => {
    const out = { ...e };
    for (const [k, label, , art] of ERLOES_FELDER) {
      const v = fields[`einnahmen.${e.key}.${k}`];
      if (v === undefined || !(k in e)) continue;
      const n = parseZahl(v);
      if (!Number.isFinite(n)) { fehler.push(`${e.name} – ${label}: bitte eine Zahl eingeben.`); continue; }
      out[k] = art === 'prozent' ? n / 100 : n;
    }
    return out;
  });
  return { params: p, fehler: [...fehler, ...WM.pruefeParameter(p)] };
}

const versionenVon = (db, pid) => db.finanzmodelle.filter((m) => m.projectId === pid).sort((a, b) => b.version - a.version);

// ---------- Routen ----------
export async function handleFinanzen({ req, res, url, path, method, u, s, view, page, post }) {
  const db = getDb();
  let m;

  // Übersicht für interne Nutzer
  if (path === '/portal/wirtschaftlichkeit' && method === 'GET') {
    const projekte = db.projects.filter((p) => darfRechner(u, p.id));
    if (!projekte.length) throw nf();
    return view('Wirtschaftlichkeit', uebersichtView(db, u, projekte), 'Projektgesellschaften, Kalkulation und Eigentümervergütung');
  }
  if ((m = /^\/portal\/wirtschaftlichkeit\/([\w-]+)(?:\/(berechnen|export\.csv|freigeben|referenzbasis|versionshinweis))?$/.exec(path))) {
    const p = projekt(db, m[1]);
    if (!p || !darfWirtschaftlichkeit(u, p.id)) throw nf();
    const versionen = versionenVon(db, p.id);
    const gewaehlt = versionen.find((v) => v.id === url.searchParams.get('v')) || versionen[0];
    if (!m[2] && method === 'GET') {
      const sz = WM.SZENARIEN[url.searchParams.get('s')] ? url.searchParams.get('s') : 'basis';
      const msg = { ok: 'Berechnung gespeichert (neue Version).', frei: 'Kennzahlen für Investoren freigegeben.', ref: 'Referenzbasis angelegt (neue Version).', hinweis: 'Versionshinweis gespeichert (die Version selbst bleibt unverändert).' }[url.searchParams.get('m')];
      return view(`Wirtschaftlichkeit ${p.code}`, akteView({ db, u, s, p, versionen, gewaehlt, sz, msg }), db.spvs.find((x) => x.id === p.spvId)?.name);
    }
    if (m[2] === 'export.csv' && method === 'GET') {
      if (!gewaehlt) throw nf();
      const sz = WM.SZENARIEN[url.searchParams.get('s')] ? url.searchParams.get('s') : 'basis';
      const r = WM.berechne(gewaehlt.params, sz, { quelle: gewaehlt.synthetisch ? 'Synthetische Demo-Annahmen' : (gewaehlt.quelle || 'Eingabe Portal'), berechnetAm: gewaehlt.erstelltAm });
      audit('export_wirtschaftlichkeit', u, { projekt: p.id, version: gewaehlt.version, szenario: sz });
      res.setHeader('Content-Disposition', `attachment; filename="Wirtschaftlichkeit_${p.code}_V${gewaehlt.version}_${sz}.csv"`);
      return send(res, 200, berechnungCsv(r, { projektName: `${p.code} ${p.name}` }), 'text/csv; charset=utf-8');
    }
    if (m[2] === 'berechnen' && method === 'POST') {
      const { fields } = await post();
      const basis = gewaehlt?.params;
      if (!basis) throw nf();
      const { params, fehler } = paramsAusFormular(fields, basis);
      if (fehler.length) return send(res, 422, String(page(`Wirtschaftlichkeit ${p.code}`, akteView({ db, u, s, p, versionen, gewaehlt: { ...gewaehlt, params, entwurf: true }, sz: 'basis', fehler }), 'Eingaben prüfen')));
      const quelle = String(fields.quelle || '').trim().slice(0, 200) || 'Eingabe Portal';
      const at = now();
      const ergebnis = Object.fromEntries(Object.entries(WM.berechneSzenarien(params, { quelle, berechnetAm: at })).map(([k, r]) => [k, { meta: r.meta, kennzahlen: r.kennzahlen }]));
      const neu = { id: newId('fm'), projectId: p.id, spvId: p.spvId, version: (versionen[0]?.version || 0) + 1, status: 'simulation', synthetisch: !!gewaehlt.synthetisch || config.mode !== 'production', params, ergebnis, quelle, erstelltVon: u.id, erstelltAm: at, notiz: String(fields.notiz || '').slice(0, 300) };
      db.finanzmodelle.push(neu); persist();
      audit('wirtschaftlichkeit_berechnet', u, { projekt: p.id, version: neu.version });
      return redirect(res, `/portal/wirtschaftlichkeit/${p.id}?v=${neu.id}&m=ok`);
    }
    // Referenzbasis (Plattformadministration): neue WM-Version aus dem aktuellen Demo-Ausgangsmodell; bestehende Versionen bleiben unverändert
    if (m[2] === 'referenzbasis' && method === 'POST') {
      if (!P.isAdmin(u)) throw nf();
      await post();
      const r = REF.neueReferenzbasis(db, p, { von: u, at: now(), codeStand: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null });
      if (r.fehler) return send(res, 422, String(page(`Wirtschaftlichkeit ${p.code}`, akteView({ db, u, s, p, versionen, gewaehlt, sz: 'basis', fehler: r.fehler }), 'Referenzbasis nicht angelegt')));
      db.finanzmodelle.push(r.fm); persist();
      audit('wm_referenzbasis_angelegt', u, { projekt: p.id, version: r.fm.version, kennung: r.fm.referenzbasis.kennung, pruefsumme: r.fm.referenzbasis.pruefsumme });
      return redirect(res, `/portal/wirtschaftlichkeit/${p.id}?v=${r.fm.id}&m=ref`);
    }
    // Dokumentarischer Versionshinweis (Plattformadministration): nur anhängend, verändert die WM-Version nicht
    if (m[2] === 'versionshinweis' && method === 'POST') {
      if (!P.isAdmin(u)) throw nf();
      const { fields } = await post();
      const v = versionen.find((x) => x.id === fields.v);
      const text = String(fields.text || '').trim().slice(0, 300);
      if (!v || !REF.VERSIONSHINWEISE[fields.status] || !text) return send(res, 422, String(page(`Wirtschaftlichkeit ${p.code}`, akteView({ db, u, s, p, versionen, gewaehlt: v || gewaehlt, sz: 'basis', fehler: ['Versionshinweis braucht Version, Status und Text.'] }), 'Eingaben prüfen')));
      db.wmVersionshinweise.push({ id: newId('vh'), projectId: p.id, fmId: v.id, version: v.version, status: fields.status, text, quelle: String(fields.quelle || '').trim().slice(0, 200) || null, von: u.name, vonId: u.id, am: now() });
      persist(); audit('wm_versionshinweis', u, { projekt: p.id, version: v.version, status: fields.status });
      return redirect(res, `/portal/wirtschaftlichkeit/${p.id}?v=${v.id}&m=hinweis`);
    }
    if (m[2] === 'freigeben' && method === 'POST') {
      if (!P.isAdmin(u)) throw nf();
      const { fields } = await post();
      const v = versionen.find((x) => x.id === fields.v);
      const sz = WM.SZENARIEN[fields.s] ? fields.s : 'basis';
      if (!v) throw nf();
      const k = v.ergebnis[sz].kennzahlen;
      db.finanzFreigaben.push({ id: newId('ff'), projectId: p.id, modellId: v.id, modellVersion: v.ergebnis[sz].meta.modellVersion, szenario: sz, synthetisch: !!v.synthetisch,
        kennzahlen: { gesamtinvestition: k.gesamtinvestition, investitionJeKWh: k.investitionJeKWh, projektIRR: k.projektIRR, dscrMin: k.dscrMin, eigenkapitalbedarf: k.eigenkapitalbedarf },
        freigegebenVon: u.id, freigegebenAm: now(), hinweis: 'Vorläufige Projektkennzahlen; keine Anlageberatung.' });
      persist(); audit('finanzkennzahlen_freigegeben', u, { projekt: p.id, version: v.version, szenario: sz });
      return redirect(res, `/portal/wirtschaftlichkeit/${p.id}?v=${v.id}&m=frei`);
    }
    throw nf();
  }

  // Vergütung: interne Ansicht je Projekt
  if ((m = /^\/portal\/verguetung\/([\w-]+)(?:\/(simulation|verbindlich|zahlung))?$/.exec(path)) && m[1] !== 'vertrag') {
    const p = projekt(db, m[1]);
    if (!p || !darfRechner(u, p.id)) throw nf();
    if (!m[2] && method === 'GET') {
      const eingabe = rechnerEingabe(Object.fromEntries(url.searchParams));
      const msg = { sim: 'Gespeichert als unverbindliche Simulation.', vorschlag: 'Gespeichert als interner Verhandlungsvorschlag.', vb: 'Verbindlicher Vertragsstand angelegt (neue Version).', zahlung: 'Zahlung erfasst.' }[url.searchParams.get('m')];
      return view(`Vergütung ${p.code}`, verguetungIntern({ db, u, s, p, eingabe, msg }), 'Vergütungsrechner, Angebote und Vertragsstände');
    }
    const { fields } = await post();
    if (m[2] === 'simulation') {
      const stufe = fields.stufe === 'vorschlag' ? 'vorschlag' : 'simulation';
      const e = rechnerEingabe(fields);
      const kontakt = db.contacts.find((c) => c.id === fields.ownerContactId && (c.projectIds || []).includes(p.id));
      if (!kontakt) throw new HttpError(400, 'Bitte einen Eigentümer-Kontakt dieses Projekts wählen.');
      const vertragId = db.vertragsstaende.concat(db.verguetungsangebote).find((x) => x.projectId === p.id && x.ownerContactId === kontakt.id && x.typ !== 'variabel')?.vertragId || `k-${p.id}-${kontakt.id}`;
      VT.neuerStand(db, { vertragId, projectId: p.id, ownerContactId: kontakt.id, stufe, typ: e.typ, bedingungen: bedingungenAus(e), von: u.id, notiz: String(fields.notiz || '').slice(0, 300) });
      persist(); audit(stufe === 'vorschlag' ? 'verguetung_vorschlag' : 'verguetung_simulation', u, { projekt: p.id, vertrag: vertragId });
      return redirect(res, `/portal/verguetung/${p.id}?m=${stufe === 'vorschlag' ? 'vorschlag' : 'sim'}`);
    }
    if (m[2] === 'verbindlich') {
      if (!darfWirtschaftlichkeit(u, p.id)) throw nf();
      const angebot = db.verguetungsangebote.find((a) => a.id === fields.angebotId && a.projectId === p.id);
      if (!angebot) throw new HttpError(400, 'Bitte das zu übernehmende Angebot wählen.');
      const stufe = ['eckdaten', 'unterzeichnet', 'nachtrag'].includes(fields.stufe) ? fields.stufe : null;
      if (!stufe) throw new HttpError(400, 'Bitte die Vertragsstufe wählen.');
      const dok = String(fields.dokumentRef || '').trim();
      if (dok && !db.documents.some((d) => d.id === dok && d.projectId === p.id) && !/^[A-Z0-9-]{3,60}$/.test(dok)) throw new HttpError(400, 'Dokumentreferenz unbekannt.');
      try {
        VT.neuerStand(db, { vertragId: angebot.vertragId, projectId: p.id, ownerContactId: angebot.ownerContactId, stufe, typ: angebot.typ, bedingungen: angebot.bedingungen, dokumentRef: dok || null, gueltigAb: String(fields.gueltigAb || '') || null, von: u.id, freigabeEigentuemer: fields.freigabe === 'ja', notiz: `Übernommen aus ${VT.STUFEN[angebot.stufe].name} V${angebot.version}` });
      } catch (e) { throw new HttpError(400, e.message); }
      persist(); audit('vertragsstand_angelegt', u, { projekt: p.id, vertrag: angebot.vertragId, stufe, dokument: dok || '–' });
      return redirect(res, `/portal/verguetung/${p.id}?m=vb`);
    }
    if (m[2] === 'zahlung') {
      if (!P.isAdmin(u)) throw nf();
      const stand = VT.gueltigerStand(db, String(fields.vertragId || ''));
      if (!stand || stand.projectId !== p.id) throw nf();
      const anspruch = VT.ansprueche(stand, { zahlungen: db.zahlungen, heute: heute(), handelsdaten: db.handelsdaten.filter((h) => h.projektId === p.id) }).find((a) => a.key === fields.anspruchKey);
      if (!anspruch) throw new HttpError(400, 'Anspruch nicht gefunden.');
      const betrag = parseZahl(fields.betrag);
      if (!(betrag > 0)) throw new HttpError(400, 'Bitte einen positiven Betrag eingeben.');
      // In Entwicklungs- und Abnahmestufen sind alle Zahlungen synthetisch und nie als real geleistet gekennzeichnet.
      const synthetisch = config.mode !== 'production' || !!stand.synthetisch || fields.synthetisch !== 'nein';
      db.zahlungen.push({ id: newId('z'), vertragId: stand.vertragId, anspruchKey: anspruch.key, betrag: cent(betrag), bezahltAm: String(fields.datum || heute()).slice(0, 10), referenz: String(fields.referenz || '').slice(0, 80), synthetisch, erfasstVon: u.id, erfasstAm: now() });
      persist(); audit('zahlung_erfasst', u, { projekt: p.id, vertrag: stand.vertragId, anspruch: anspruch.key, synthetisch: String(synthetisch) });
      return redirect(res, `/portal/verguetung/${p.id}?m=zahlung`);
    }
    throw nf();
  }

  // Eigentümer: Meine Vergütung
  if (path === '/portal/verguetung' && method === 'GET') {
    if (!P.hasRole(u, 'eigentuemer')) { if (db.projects.some((p) => darfRechner(u, p.id))) return redirect(res, '/portal/wirtschaftlichkeit'); throw nf(); }
    const staende = eigeneStaende(db, u);
    return view('Meine Vergütung', meineVerguetungView(db, staende), 'Ihre vereinbarten, fälligen und bezahlten Beträge');
  }
  if ((m = /^\/portal\/verguetung\/vertrag\/([\w-]+)\/pdf$/.exec(path)) && method === 'GET') {
    const stand = VT.gueltigerStand(db, m[1]);
    const erlaubt = stand && ((P.hasRole(u, 'eigentuemer') && eigeneStaende(db, u).some((x) => x.id === stand.id)) || darfRechner(u, stand.projectId));
    if (!erlaubt) throw nf();
    const p = projekt(db, stand.projectId);
    const kontakt = db.contacts.find((c) => c.id === stand.ownerContactId);
    const pdf = verguetungPdf({ eigentuemer: kontakt?.name || '–', projekt: `${p.code} ${p.name}`, stand, ansprueche: anspruecheFuer(db, stand), kauf: VT.kaufpreisregelung(stand), stichtag: heute(), synthetisch: config.mode !== 'production' || !!stand.synthetisch });
    audit('verguetung_pdf', u, { vertrag: stand.vertragId });
    res.setHeader('Content-Disposition', `attachment; filename="Verguetungsuebersicht_${p.code}.pdf"`);
    return send(res, 200, pdf, 'application/pdf');
  }

  // Handelsdaten (nur Plattformadministration): Import über Datei, keine Handelsaufträge
  if (path === '/portal/admin/handelsdaten') {
    if (!P.isAdmin(u)) throw nf();
    if (method === 'GET') return view('Handelsdaten', handelsdatenView({ db, s }), 'Schnittstelle zum Handels- und Dispatchsystem (nur Datenübernahme)');
    const { fields, files } = await parseForm(req);
    if (String(fields._csrf || '') !== s.csrf) throw new HttpError(403, 'Sicherheitstoken ungültig. Bitte Seite neu laden.');
    const f = files.find((x) => x.field === 'datei');
    const text = f ? f.data.toString('utf8') : String(fields.inhalt || '');
    let roh;
    try { roh = text.trim().startsWith('[') ? JSON.parse(text) : HD.parseCsv(text); } catch { roh = null; }
    if (!Array.isArray(roh) || !roh.length) return send(res, 422, String(page('Handelsdaten', handelsdatenView({ db, s, fehler: ['Die Datei enthält keine lesbaren Datensätze (CSV mit Kopfzeile oder JSON-Liste).'] }))));
    const r = HD.pruefe(roh, { projektIds: db.projects.map((p) => p.id) });
    if (r.fehler.length) return send(res, 422, String(page('Handelsdaten', handelsdatenView({ db, s, fehler: r.fehler, hinweise: r.hinweise }))));
    const importId = HD.uebernehmen(db, r.datensaetze, { von: u.id, quelle: f?.filename || 'Formular' });
    persist(); audit('handelsdaten_importiert', u, { import: importId, datensaetze: r.datensaetze.length });
    return send(res, 200, String(page('Handelsdaten', handelsdatenView({ db, s, ok: `${r.datensaetze.length} Datensätze übernommen.`, hinweise: r.hinweise }))));
  }
  return null;
}

// ---------- Datenabfragen ----------
export function eigeneStaende(db, u) {
  if (!P.hasRole(u, 'eigentuemer') || !u.contactId) return [];
  const ids = [...new Set(db.vertragsstaende.filter((x) => x.ownerContactId === u.contactId).map((x) => x.vertragId))];
  return ids.map((id) => VT.gueltigerStand(db, id)).filter((x) => x && x.freigabeEigentuemer && P.rolesForProject(u, x.projectId).includes('eigentuemer'));
}
const anspruecheFuer = (db, stand) => VT.ansprueche(stand, { zahlungen: db.zahlungen, heute: heute(), handelsdaten: db.handelsdaten.filter((h) => h.projektId === stand.projectId) });

function rechnerEingabe(q) {
  const n = (k, d) => { const v = parseZahl(q[k]); return Number.isFinite(v) ? v : d; };
  return {
    typ: VT.VERTRAGSTYPEN[q.typ] && q.typ !== 'variabel' ? q.typ : 'festpacht',
    flaecheHa: n('flaecheHa', 1.5), pachtJeHa: n('pachtJeHa', 20000), mindestpacht: n('mindestpacht', 25000), laufzeitJahre: Math.round(n('laufzeitJahre', 20)),
    vpiRate: n('vpiRate', 2) / 100, vpiAnteil: n('vpiAnteil', 100) / 100, vpiIntervall: Math.max(1, Math.round(n('vpiIntervall', 1))),
    grundMonate: Math.round(n('grundMonate', 24)), opt1: n('opt1', 1500), opt2: n('opt2', 2000), opt3: n('opt3', 3000), opt4: n('opt4', 4000), bau: n('bau', 12000),
    referenzwert: n('referenzwert', 6), faktor: n('faktor', 2), praemie: n('praemie', 3), mindestpreis: n('mindestpreis', 12), hoechstpreis: n('hoechstpreis', 20), indexierung: n('indexierung', 2) / 100,
    kaufJahr: Math.round(n('kaufJahr', 5)), bisBetriebsjahr: Math.round(n('bisBetriebsjahr', 10)), diskont: n('diskont', 6) / 100,
  };
}
const bedingungenAus = (e) => ({
  option: { beginn: heute(), grundMonate: e.grundMonate, verlaengerungen: [12, 12], verlaengerungenGenutzt: 0, entgelte: [e.opt1, e.opt2, e.opt3, e.opt4] },
  ...(e.typ !== 'kaufoption' ? { bau: { jahresbetrag: e.bau }, pacht: { flaecheHa: e.flaecheHa, pachtJeHa: e.pachtJeHa, mindestpacht: e.mindestpacht, laufzeitJahre: e.laufzeitJahre, vpi: { rate: e.vpiRate, anteil: e.vpiAnteil, intervallJahre: e.vpiIntervall } } } : {}),
  ...(e.typ !== 'festpacht' ? { kauf: { flaecheHa: e.flaecheHa, referenzwert: e.referenzwert, faktor: e.faktor, praemie: e.praemie, mindestpreis: e.mindestpreis, hoechstpreis: e.hoechstpreis, indexierung: e.indexierung, bisBetriebsjahr: e.bisBetriebsjahr } } : {}),
});

// ---------- Ansichten ----------
function uebersichtView(db, u, projekte) {
  return html`<section class="panel"><p class="lead-sm">Je Projektgesellschaft eine wirtschaftliche Projektakte. Alle Werte dieser Entwicklungsphase sind ${synth()}; sie sind keine Marktdaten und keine Anlageberatung.</p>
<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Projekt</th><th>Projektgesellschaft</th><th>Kalkulation</th><th>Projekt-IRR (Basis)</th><th>Eigentümerverträge</th><th><span class="sr">Aktionen</span></th></tr></thead><tbody>
${projekte.map((p) => { const v = versionenVon(db, p.id)[0]; const k = v?.ergebnis?.basis?.kennzahlen; const econ = darfWirtschaftlichkeit(u, p.id); const vertraege = new Set(db.vertragsstaende.filter((x) => x.projectId === p.id).map((x) => x.vertragId)).size;
  return html`<tr><td data-l="Projekt"><strong>${p.name}</strong><br><span class="muted small">${p.code} · ${phase(p)}</span></td><td data-l="Gesellschaft">${db.spvs.find((x) => x.id === p.spvId)?.name}</td>
  <td data-l="Kalkulation">${econ ? (v ? html`Version ${v.version} · ${fmtDate(v.erstelltAm)}` : 'keine') : html`<span class="muted">nur für Projektleitung</span>`}</td>
  <td data-l="Projekt-IRR" class="num">${econ && k ? pct(k.projektIRR) : '–'}</td><td data-l="Verträge">${vertraege}</td>
  <td class="row-actions">${econ ? html`<a class="btn btn-small" href="/portal/wirtschaftlichkeit/${p.id}">Projektakte</a>` : ''}<a class="btn btn-small" href="/portal/verguetung/${p.id}">Vergütung</a></td></tr>`; })}
</tbody></table></div></section>`;
}

function kennzahlTabelle(versionErgebnis) {
  const z = [['Gesamtinvestition', (k) => eur(k.gesamtinvestition, true)], ['Investition je nominaler kWh', (k) => eur(k.investitionJeKWh)], ['Bruttoerlöse (Jahr 1)', (k) => eur(k.bruttoerloeseJahr1, true)],
    ['Vermarktungskosten (Jahr 1)', (k) => eur(k.vermarktungskostenJahr1, true)], ['Betriebskosten (Jahr 1)', (k) => eur(k.betriebskostenJahr1, true)], ['EBITDA (Jahr 1)', (k) => eur(k.ebitdaJahr1, true)],
    ['Operativer Cashflow (Jahr 1)', (k) => eur(k.operativerCFJahr1, true)], ['Schuldendienst p. a.', (k) => eur(k.schuldendienstJahr, true)], ['Eigenkapitalbedarf', (k) => eur(k.eigenkapitalbedarf, true)],
    ['Modell-DSCR minimal (vor Steuern)', (k) => (k.dscrMin == null ? '–' : `${num(k.dscrMin, 2)}×`)], ['Amortisation', (k) => (k.amortisationJahre == null ? 'nicht erreicht' : `${num(k.amortisationJahre, 1)} Jahre`)],
    ['Kapitalwert', (k) => eur(k.kapitalwert, true)], ['Projekt-IRR', (k) => pct(k.projektIRR)], ['Eigenkapital-IRR', (k) => pct(k.eigenkapitalIRR)]];
  const sz = Object.keys(WM.SZENARIEN);
  return html`<div class="tbl-wrap"><table class="tbl tbl-num"><caption class="sr">Kennzahlen je Szenario</caption><thead><tr><th>Kennzahl</th>${sz.map((k) => html`<th class="num">${WM.SZENARIEN[k].name}</th>`)}</tr></thead><tbody>
${z.map(([n, f]) => html`<tr><th scope="row">${n}</th>${sz.map((k) => html`<td class="num${k === 'basis' ? ' col-basis' : ''}">${f(versionErgebnis[k].kennzahlen)}</td>`)}</tr>`)}</tbody></table></div>`;
}

// Balkendiagramm EBITDA und Schuldendienst je Betriebsjahr (SVG, mit Datentabelle für Screenreader)
function cashflowChart(r) {
  const J = r.jahre, W = 720, H = 220, pad = 36;
  const max = Math.max(...J.map((j) => Math.max(j.ebitda, j.schuldendienst)), 1);
  const bw = (W - pad * 2) / J.length;
  const y = (v) => H - pad - (Math.max(0, v) / max) * (H - pad * 2);
  const bars = J.map((j, i) => {
    const x = pad + i * bw;
    return `<rect class="c-ebitda" x="${(x + bw * 0.12).toFixed(1)}" y="${y(j.ebitda).toFixed(1)}" width="${(bw * 0.38).toFixed(1)}" height="${(H - pad - y(j.ebitda)).toFixed(1)}"><title>Jahr ${j.jahr}: EBITDA ${eur(j.ebitda, true)}</title></rect>`
      + (j.schuldendienst ? `<rect class="c-ds" x="${(x + bw * 0.52).toFixed(1)}" y="${y(j.schuldendienst).toFixed(1)}" width="${(bw * 0.38).toFixed(1)}" height="${(H - pad - y(j.schuldendienst)).toFixed(1)}"><title>Jahr ${j.jahr}: Schuldendienst ${eur(j.schuldendienst, true)}</title></rect>` : '')
      + (j.jahr % 5 === 0 || j.jahr === 1 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - pad + 16}" text-anchor="middle">${j.jahr}</text>` : '');
  }).join('');
  const ticks = [0, 0.5, 1].map((t) => `<line x1="${pad}" x2="${W - pad}" y1="${y(max * t)}" y2="${y(max * t)}" class="c-grid"/><text x="${pad - 6}" y="${y(max * t) + 4}" text-anchor="end">${num(max * t / 1e6, 1)}</text>`).join('');
  return html`<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="cf-t"><title id="cf-t">EBITDA und Schuldendienst je Betriebsjahr in Mio. EUR</title>${raw(ticks + bars)}</svg>
  <figcaption><span class="lg lg-ebitda">EBITDA</span> <span class="lg lg-ds">Schuldendienst</span> <span class="muted small">Mio. EUR je Betriebsjahr · Szenario ${r.meta.szenarioName}</span></figcaption>
  <details class="small"><summary>Werte als Tabelle</summary><div class="tbl-wrap"><table class="tbl tbl-compact tbl-num"><thead><tr><th>Jahr</th><th class="num">Bruttoerlöse</th><th class="num">EBITDA</th><th class="num">Schuldendienst</th><th class="num">Modell-DSCR (vor Steuern)</th><th class="num">EK-Cashflow</th></tr></thead><tbody>
  ${J.map((j) => html`<tr><td>${j.jahr}</td><td class="num">${eur(j.brutto, true)}</td><td class="num">${eur(j.ebitda, true)}</td><td class="num">${eur(j.schuldendienst, true)}</td><td class="num">${j.dscr == null ? '–' : num(j.dscr, 2)}</td><td class="num">${eur(j.ekCF, true)}</td></tr>`)}</tbody></table></div></details></figure>`;
}

function eingabeFormular(s, p, params, fehler) {
  const wert = (f) => { const v = params[f.g]?.[f.k]; return f.art === 'prozent' ? num((v ?? 0) * 100, 2) : f.art === 'zahl' ? num(v ?? 0, Number.isInteger(v) ? 0 : 2) : (v ?? ''); };
  const feld = (f) => html`<label class="fld"><span>${f.label}${f.einheit ? html` <em>${f.einheit}</em>` : ''}</span>${f.art === 'auswahl'
    ? html`<select name="${f.g}.${f.k}">${[['pacht', 'Pacht'], ['kauf', 'Kauf'], ['pacht_kauf', 'Pacht mit späterem Kauf']].map(([k, l]) => html`<option value="${k}"${params[f.g]?.[f.k] === k ? raw(' selected') : ''}>${l}</option>`)}</select>`
    : html`<input name="${f.g}.${f.k}" value="${wert(f)}" inputmode="${f.art === 'text' ? 'text' : 'decimal'}"${f.art === 'text' ? '' : raw(' class="num"')}>`}${f.hinweis ? html`<small>${f.hinweis}</small>` : ''}</label>`;
  const gruppe = (g) => html`<fieldset class="fgroup"><legend>${GRUPPEN[g]}</legend><div class="fgrid">${FELDER.filter((f) => f.g === g).map(feld)}</div></fieldset>`;
  return html`<form method="post" action="/portal/wirtschaftlichkeit/${p.id}/berechnen" class="calc-form">${csrf(s)}
${fehler?.length ? html`<div class="alert" role="alert"><strong>Bitte prüfen:</strong><ul>${fehler.map((f) => html`<li>${f}</li>`)}</ul></div>` : ''}
${['standort', 'technik', 'capex', 'opex', 'finanzierung'].map(gruppe)}
<fieldset class="fgroup"><legend>Einnahmen</legend><p class="small muted">Jede Vermarktung belegt einen Anteil der Speicherleistung. Die Summe darf 100 % nicht überschreiten – parallel vermarktete Leistung wird nicht doppelt gezählt. Energieerlöse: Verkaufserlös minus Einkauf einschließlich der Wirkungsgradverluste.</p>
${params.einnahmen.map((e) => html`<div class="fgrid erl"><strong class="erl-name">${e.name}</strong>${ERLOES_FELDER.filter(([k]) => k in e).map(([k, label, einheit, art]) => html`<label class="fld"><span>${label} <em>${einheit}</em></span><input class="num" inputmode="decimal" name="einnahmen.${e.key}.${k}" value="${art === 'prozent' ? num(e[k] * 100, 1) : num(e[k], 0)}"></label>`)}</div>`)}</fieldset>
${gruppe('bewertung')}
<div class="fgrid"><label class="fld"><span>Datenquelle</span><input name="quelle" value="${params.quelle || ''}" placeholder="z. B. Angebot Hersteller 10/2026, Marktstudie …"></label><label class="fld"><span>Notiz zur Version</span><input name="notiz" maxlength="300"></label></div>
<div class="form-actions"><button class="btn btn-primary" type="submit">Neu berechnen und als neue Version speichern</button><span class="small muted">Frühere Versionen bleiben unverändert erhalten. Eine Berechnung verändert keine Verträge.</span></div></form>`;
}

function statusLeiste(db, fm) {
  const st = REF.versionStatus(db, fm);
  return st.length ? html`<div class="ed-status">${st.map((x) => html`<span class="mark ${x.mark}">${x.name}</span>`)}</div><ul class="assume small">${st.filter((x) => x.text).map((x) => html`<li><strong>${x.name}:</strong> ${x.text}</li>`)}</ul>` : '';
}
function referenzPanel(fm) {
  const rb = fm.referenzbasis;
  return html`<div class="notice-info small"><strong>Referenzbasis ${rb.kennung}</strong> · ${rb.status === 'freigegeben' ? 'freigegeben' : rb.status} von ${rb.freigegebenVon} am ${fmtDate(rb.freigegebenAm)} · Modell ${rb.modellVersion} · Prüfsumme <code>${rb.pruefsumme}</code> · Datensatz ${fm.id}${rb.codeStand ? ` · Code ${rb.codeStand}` : ''}<br>${rb.grundlage}. Erlöse: ${rb.erloes.quelle} – ${rb.erloes.strategie}. ${rb.hinweis}</div>
<details class="small"><summary>Kostenbasis und Herkunft der Eingangsparameter (${rb.herkunft.length})</summary>
<ul class="assume">${rb.kostenbasis.map((x) => html`<li class="${x.art === 'ok' ? '' : x.art}">${x.text}</li>`)}</ul>
<table class="tbl tbl-compact"><thead><tr><th>Betriebskosten</th><th>Skalierung im Planer</th><th>Kostenursache</th></tr></thead><tbody>${Object.entries(rb.kostenregeln).map(([k, x]) => html`<tr><td>${WM.OPEX_POSTEN.find(([kk]) => kk === k)?.[1] || k}</td><td>${REF.SKALIERUNG[x.skalierung]}</td><td>${x.ursache}</td></tr>`)}</tbody></table>
<table class="tbl tbl-compact"><thead><tr><th>Parameter</th><th class="num">Wert</th><th>Herkunft</th><th>Status</th></tr></thead><tbody>${rb.herkunft.map((x) => html`<tr><td><code>${x.feld}</code></td><td class="num">${typeof x.wert === 'number' ? num(x.wert, 4) : x.wert}</td><td>${x.herkunft}</td><td>${x.status}</td></tr>`)}</tbody></table></details>`;
}

function akteView({ db, u, s, p, versionen, gewaehlt, sz, msg, fehler }) {
  if (!gewaehlt) return html`<section class="panel"><p>Für dieses Projekt gibt es noch keine Kalkulation.</p></section>`;
  // Bei fehlerhaftem Entwurf zeigen Kennzahlen und Verlauf die zuletzt gültige Version; das Formular behält die Eingaben.
  const gueltig = gewaehlt.entwurf ? versionen.find((v) => v.id === gewaehlt.id) || versionen[0] : gewaehlt;
  const r = WM.berechne(gueltig.params, sz, { quelle: gueltig.quelle || (gueltig.synthetisch ? 'Synthetische Demo-Annahmen' : 'Eingabe Portal'), berechnetAm: gueltig.erstelltAm });
  const ergebnis = gueltig.ergebnis;
  // Versionskennung des gespeicherten Rechenstands (die Kennzahltabelle zeigt die gespeicherten Werte)
  const gespeichertMit = ergebnis?.basis?.meta?.modellVersion || r.meta.modellVersion;
  const freigaben = db.finanzFreigaben.filter((f) => f.projectId === p.id);
  return html`${msg ? html`<div class="notice" role="status">${msg}</div>` : ''}
<nav class="tabs" aria-label="Projektbereiche"><a href="/portal/wirtschaftlichkeit/${p.id}" aria-current="page">Wirtschaftlichkeit</a><a href="/portal/verguetung/${p.id}">Eigentümervergütung</a><a href="/portal/projekte/${p.id}">Projekt</a></nav>
<section class="panel"><div class="panel-head"><h2>Kennzahlen</h2><div class="row-actions"><a class="btn btn-small" href="/portal/wirtschaftlichkeit/${p.id}/export.csv?v=${gewaehlt.id}&amp;s=${sz}">CSV exportieren</a></div></div>
<p class="meta-line">Version ${gewaehlt.version} · berechnet ${fmtDate(gewaehlt.erstelltAm)} · Modell ${gespeichertMit}${gespeichertMit !== r.meta.modellVersion ? ` (Jahresverlauf mit ${r.meta.modellVersion} neu berechnet)` : ''} · Quelle: ${r.meta.quelle} · Prüfsumme <code>${r.meta.parameterPruefsumme}</code> ${gewaehlt.synthetisch ? synth() : ''}</p>
${fehler?.length && !gewaehlt.entwurf ? html`<div class="alert" role="alert">${fehler.join(' ')}</div>` : ''}
${statusLeiste(db, gueltig)}
${ergebnis ? kennzahlTabelle(ergebnis) : ''}
${gueltig.referenzbasis ? referenzPanel(gueltig) : ''}
<p class="small muted">${r.meta.hinweis} Szenarien: Konservativ (Erlöse −20 %, CAPEX und OPEX +10 %, Zins +1 Pkt., Degradation +0,5 Pkt.), Optimistisch (Erlöse +15 %, Kosten −5 %, Zins −0,5 Pkt.).</p></section>
<section class="panel"><div class="panel-head"><h2>Verlauf</h2><nav class="seg" aria-label="Szenario">${Object.entries(WM.SZENARIEN).map(([k, v]) => html`<a href="/portal/wirtschaftlichkeit/${p.id}?v=${gewaehlt.id}&amp;s=${k}"${k === sz ? raw(' aria-current="true"') : ''}>${v.name}</a>`)}</nav></div>${cashflowChart(r)}</section>
<section class="panel"><h2>Eingaben</h2>${eingabeFormular(s, p, gewaehlt.params, fehler)}</section>
<section class="grid-2"><div class="panel"><h2>Versionen</h2><ol class="versions">${versionen.map((v) => html`<li${v.id === gewaehlt.id ? raw(' aria-current="true"') : ''}><a href="/portal/wirtschaftlichkeit/${p.id}?v=${v.id}">Version ${v.version}</a>${REF.versionStatus(db, v).map((x) => html` <span class="mark ${x.mark}" title="${x.text}">${x.name}</span>`)} <span class="muted small">${fmtDate(v.erstelltAm)} · ${db.users.find((x) => x.id === v.erstelltVon)?.name || 'Demo'}${v.notiz ? ` · ${v.notiz}` : ''}</span></li>`)}</ol>
${P.isAdmin(u) && !gewaehlt.entwurf ? html`<details class="small"><summary>Versionshinweis zu Version ${gewaehlt.version} erfassen</summary><form method="post" action="/portal/wirtschaftlichkeit/${p.id}/versionshinweis" class="stack">${csrf(s)}<input type="hidden" name="v" value="${gewaehlt.id}"><label for="vh-s">Status</label><select id="vh-s" name="status">${Object.entries(REF.VERSIONSHINWEISE).map(([k, x]) => html`<option value="${k}">${x.name} – nicht entscheidungsrelevant</option>`)}</select><label for="vh-t">Text</label><input id="vh-t" name="text" maxlength="300" required><label for="vh-q">Quelle (Bericht, Entscheidung)</label><input id="vh-q" name="quelle" maxlength="200"><button class="btn" type="submit">Hinweis speichern</button><p class="muted">Nur anhängend: Die Version und ihre Berechnungsdaten bleiben unverändert.</p></form></details>` : ''}
${P.isAdmin(u) && REF.referenzParameter(p.id) ? html`<form method="post" action="/portal/wirtschaftlichkeit/${p.id}/referenzbasis" class="stack">${csrf(s)}<button class="btn" type="submit">Referenzbasis aus aktuellem Demo-Ausgangsmodell anlegen</button><p class="small muted">Legt eine neue Version mit Herkunft je Parameter, Prüfsumme und Modellversion ${WM.MODELL_VERSION} an. Nur diese Referenzbasen kann der Investitionsplaner als Rechenbasis wählen. Keine Investorenfreigabe.</p></form>` : ''}</div>
<div class="panel"><h2>Für Investoren freigegeben</h2>${freigaben.length ? html`<ul class="assume">${freigaben.map((f) => html`<li>Version ${versionen.find((v) => v.id === f.modellId)?.version ?? '?'} · ${WM.SZENARIEN[f.szenario].name} · ${fmtDate(f.freigegebenAm)}</li>`)}</ul>` : html`<p class="muted">Noch keine Kennzahlen freigegeben.</p>`}
${P.isAdmin(u) && !gewaehlt.entwurf ? html`<form method="post" action="/portal/wirtschaftlichkeit/${p.id}/freigeben" class="stack">${csrf(s)}<input type="hidden" name="v" value="${gewaehlt.id}"><label for="fs">Szenario</label><select id="fs" name="s">${Object.entries(WM.SZENARIEN).map(([k, v]) => html`<option value="${k}"${k === 'basis' ? raw(' selected') : ''}>${v.name}</option>`)}</select><button class="btn" type="submit">Kennzahlen dieser Version freigeben</button><p class="small muted">Investoren mit Zugriff auf dieses Projekt sehen nur Gesamtinvestition, Investition je nominaler kWh, Eigenkapitalbedarf, Projekt-IRR und Modell-DSCR vor Steuern – keine Kostenpositionen, Margen oder Handelsstrategien.</p></form>` : ''}</div></section>`;
}

function verguetungIntern({ db, u, s, p, eingabe, msg }) {
  const econ = darfWirtschaftlichkeit(u, p.id);
  const kontakte = db.contacts.filter((c) => (c.projectIds || []).includes(p.id) && /eigentümer/i.test(c.kind || ''));
  const vertragIds = [...new Set(db.vertragsstaende.concat(db.verguetungsangebote).filter((x) => x.projectId === p.id).map((x) => x.vertragId))];
  const e = eingabe;
  let rechnung = null, rfehler = null;
  try {
    const jp = VG.jahrespacht({ flaecheHa: e.flaecheHa, pachtJeHa: e.pachtJeHa, mindestpacht: e.mindestpacht });
    const kp = VG.kaufpreis({ flaecheHa: e.flaecheHa, referenzwert: e.referenzwert, faktor: e.faktor, praemie: e.praemie, mindestpreis: e.mindestpreis, hoechstpreis: e.hoechstpreis });
    const opt = VG.optionsentgelte({ grundMonate: e.grundMonate, verlaengerungen: [12, 12], entgelte: [e.opt1, e.opt2, e.opt3, e.opt4] });
    const vgl = VG.variantenvergleich({ startpacht: jp, kaufpreisHeute: kp.betrag, laufzeitJahre: e.laufzeitJahre, pachtSteigerung: e.vpiRate * e.vpiAnteil, kaufJahr: Math.min(e.kaufJahr, e.laufzeitJahre), kaufIndexierung: e.indexierung, diskont: e.diskont });
    rechnung = { jp, kp, opt, vgl };
  } catch (err) { rfehler = err.message; }
  const inp = (k, label, einheit, v) => html`<label class="fld"><span>${label} <em>${einheit}</em></span><input class="num" inputmode="decimal" name="${k}" value="${v}"></label>`;
  return html`${msg ? html`<div class="notice" role="status">${msg}</div>` : ''}
${econ ? html`<nav class="tabs" aria-label="Projektbereiche"><a href="/portal/wirtschaftlichkeit/${p.id}">Wirtschaftlichkeit</a><a href="/portal/verguetung/${p.id}" aria-current="page">Eigentümervergütung</a><a href="/portal/projekte/${p.id}">Projekt</a></nav>` : ''}
<section class="panel"><h2>Vergütungsrechner</h2><p class="small muted">Unverbindliche Berechnung für Standortgespräche. Speichern legt eine Simulation oder einen internen Verhandlungsvorschlag an – nie einen Vertrag. Grundlage: Vergütungsmodell V0.2 (korrigiert, siehe Dokumentation).</p>
<form method="get" action="/portal/verguetung/${p.id}" class="calc-form" id="rechner">
<fieldset class="fgroup"><legend>Modell und Fläche</legend><div class="fgrid"><label class="fld"><span>Vertragstyp</span><select name="typ">${Object.entries(VT.VERTRAGSTYPEN).filter(([k]) => k !== 'variabel').map(([k, l]) => html`<option value="${k}"${e.typ === k ? raw(' selected') : ''}>${l}</option>`)}</select></label>
${inp('flaecheHa', 'Betriebsfläche', 'ha', num(e.flaecheHa, 2))}</div></fieldset>
<fieldset class="fgroup"><legend>Optionsphase</legend><div class="fgrid">${inp('grundMonate', 'Grundlaufzeit', 'Monate', e.grundMonate)}${inp('opt1', 'Optionsentgelt Jahr 1', 'EUR', num(e.opt1))}${inp('opt2', 'Jahr 2', 'EUR', num(e.opt2))}${inp('opt3', 'Verlängerungsjahr 1', 'EUR', num(e.opt3))}${inp('opt4', 'Verlängerungsjahr 2', 'EUR', num(e.opt4))}${inp('bau', 'Bauphasenvergütung', 'EUR/Jahr', num(e.bau))}</div></fieldset>
<fieldset class="fgroup"><legend>Pacht</legend><div class="fgrid">${inp('pachtJeHa', 'Pacht', 'EUR/ha/Jahr', num(e.pachtJeHa))}${inp('mindestpacht', 'Mindestpacht', 'EUR/Jahr', num(e.mindestpacht))}${inp('laufzeitJahre', 'Festlaufzeit', 'Jahre', e.laufzeitJahre)}${inp('vpiRate', 'VPI-Annahme', '% p. a.', num(e.vpiRate * 100, 1))}${inp('vpiAnteil', 'Weitergabe VPI', '%', num(e.vpiAnteil * 100, 0))}${inp('vpiIntervall', 'Anpassung alle', 'Jahre', e.vpiIntervall)}</div></fieldset>
<fieldset class="fgroup"><legend>Kauf</legend><div class="fgrid">${inp('referenzwert', 'Landw. Referenzwert', 'EUR/m²', num(e.referenzwert, 2))}${inp('faktor', 'Bodenwert-Faktor', '×', num(e.faktor, 2))}${inp('praemie', 'Standort-/Erfolgsprämie', 'EUR/m²', num(e.praemie, 2))}${inp('mindestpreis', 'Mindestkaufpreis', 'EUR/m²', num(e.mindestpreis, 2))}${inp('hoechstpreis', 'Höchstpreis (Cap)', 'EUR/m²', num(e.hoechstpreis, 2))}${inp('indexierung', 'Kaufpreis-Indexierung', '% p. a.', num(e.indexierung * 100, 1))}${inp('kaufJahr', 'Späterer Kauf im Jahr', '', e.kaufJahr)}${inp('bisBetriebsjahr', 'Kaufoption bis Betriebsjahr', '', e.bisBetriebsjahr)}${inp('diskont', 'Diskontsatz Vergleich', '%', num(e.diskont * 100, 1))}</div></fieldset>
<div class="form-actions"><button class="btn btn-primary" type="submit">Berechnen</button></div></form>
${rfehler ? html`<div class="alert" role="alert">${rfehler}</div>` : html`<div class="result-grid">
<dl class="kv"><div><dt>Jahrespacht (Start)</dt><dd class="num">${eur(rechnung.jp)}</dd></div><div><dt>Optionsentgelte max. ${rechnung.opt.monate} Monate</dt><dd class="num">${eur(rechnung.opt.summe)}</dd></div>
<div><dt>Kaufpreis heute</dt><dd class="num">${eur(rechnung.kp.betrag)} <span class="muted small">(${num(rechnung.kp.wert, 2)} EUR/m²${rechnung.kp.begrenzt ? ` – ${rechnung.kp.begrenzt}` : ''})</span></dd></div>
<div><dt>Kaufpreis / Anfangspacht</dt><dd class="num">${num(rechnung.kp.betrag / rechnung.jp, 1)}×</dd></div></dl>
<div class="tbl-wrap"><table class="tbl tbl-num"><caption class="sr">Variantenvergleich</caption><thead><tr><th>Variante</th><th class="num">Zahlungen nominal</th><th class="num">Barwert</th><th>Eigentum am Ende</th></tr></thead><tbody>${rechnung.vgl.varianten.map((v) => html`<tr><th scope="row">${v.name}</th><td class="num">${eur(v.nominal, true)}</td><td class="num">${eur(v.barwert, true)}</td><td>${v.eigentumAmEnde ? 'Projekt' : 'Eigentümer'}</td></tr>`)}</tbody></table></div></div>
${kontakte.length ? html`<form method="post" action="/portal/verguetung/${p.id}/simulation" class="stack stack-inline save-form">${csrf(s)}${Object.entries(e).map(([k, v]) => html`<input type="hidden" name="${k}" value="${typeof v === 'number' ? num(['vpiRate', 'vpiAnteil', 'indexierung', 'diskont'].includes(k) ? v * 100 : v, 6) : v}">`)}
<label for="okc">Eigentümer</label><select id="okc" name="ownerContactId">${kontakte.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select>
<label for="notiz">Notiz</label><input id="notiz" name="notiz" maxlength="300"><button class="btn" name="stufe" value="simulation" type="submit">Als Simulation speichern</button><button class="btn" name="stufe" value="vorschlag" type="submit">Als Verhandlungsvorschlag speichern</button></form>` : ''}`}</section>
<section class="panel"><h2>Angebote und Vertragsstände</h2><p class="small muted">Stufen: 1 Simulation · 2 Verhandlungsvorschlag (unverbindlich) · 3 vereinbarte Eckdaten · 4 unterzeichneter Vertrag · 5 Nachtrag (verbindlich, versioniert, unveränderlich) · 6 abgerechnete Zahlungen.</p>
${vertragIds.length ? vertragIds.map((vid) => vertragBlock(db, u, s, p, vid)) : html`<p class="muted">Noch keine Angebote oder Verträge.</p>`}</section>`;
}

function vertragBlock(db, u, s, p, vid) {
  const angebote = db.verguetungsangebote.filter((x) => x.vertragId === vid).sort((a, b) => b.version - a.version);
  const staende = db.vertragsstaende.filter((x) => x.vertragId === vid).sort((a, b) => b.version - a.version);
  const gueltig = staende[0];
  const kontakt = db.contacts.find((c) => c.id === (gueltig || angebote[0])?.ownerContactId);
  const anspr = gueltig ? anspruecheFuer(db, gueltig) : [];
  const econ = darfWirtschaftlichkeit(u, p.id);
  const zahl = db.zahlungen.filter((z) => z.vertragId === vid);
  return html`<article class="contract"><header><h3>${kontakt?.name || '–'} · ${VT.VERTRAGSTYPEN[(gueltig || angebote[0]).typ]}</h3>${gueltig ? html`<span class="mark mark-ok">${VT.STUFEN[gueltig.stufe].name} · V${gueltig.version}</span>` : html`<span class="mark mark-aud">noch nicht verbindlich</span>`} ${(gueltig || angebote[0]).synthetisch ? synth() : ''}</header>
${staende.length ? html`<div class="tbl-wrap"><table class="tbl tbl-compact"><thead><tr><th>Version</th><th>Stufe</th><th>Dokument</th><th>Gültig ab</th><th>Für Eigentümer sichtbar</th><th>Angelegt</th></tr></thead><tbody>${staende.map((x) => html`<tr${x.id === gueltig.id ? raw(' class="row-current"') : ''}><td>V${x.version}${x.id === gueltig.id ? ' (gültig)' : ''}</td><td>${VT.STUFEN[x.stufe].name}</td><td>${x.dokumentRef ? html`<code>${x.dokumentRef}</code>` : '–'}</td><td>${x.gueltigAb ? fmtDate(x.gueltigAb) : '–'}</td><td>${x.freigabeEigentuemer ? 'ja' : 'nein'}</td><td class="small">${fmtDate(x.erstelltAm)}${x.notiz ? ` · ${x.notiz}` : ''}</td></tr>`)}</tbody></table></div>` : ''}
${anspr.length ? html`<details open><summary>Ansprüche aus dem gültigen Stand</summary>${anspruchTabelle(anspr)}</details>` : ''}
${angebote.length ? html`<details><summary>Simulationen und Vorschläge (${angebote.length})</summary><ul class="assume">${angebote.map((a) => html`<li>${VT.STUFEN[a.stufe].name} V${a.version} · ${fmtDate(a.erstelltAm)} · ${db.users.find((x) => x.id === a.erstelltVon)?.name || '–'}${a.bedingungen.pacht ? ` · Pacht ${eur(VG.jahrespacht(a.bedingungen.pacht), true)}/Jahr` : ''}${a.notiz ? ` · ${a.notiz}` : ''}</li>`)}</ul>
${econ ? html`<form method="post" action="/portal/verguetung/${p.id}/verbindlich" class="stack stack-inline">${csrf(s)}<label>Angebot<select name="angebotId">${angebote.map((a) => html`<option value="${a.id}">${VT.STUFEN[a.stufe].name} V${a.version}</option>`)}</select></label>
<label>Übernehmen als<select name="stufe"><option value="eckdaten">Vereinbarte Eckdaten</option><option value="unterzeichnet">Unterzeichneter Vertrag</option><option value="nachtrag">Nachtrag</option></select></label>
<label>Dokumentreferenz<select name="dokumentRef"><option value="">– keine –</option>${db.documents.filter((d) => d.projectId === p.id && /vertrag/i.test(d.category + d.title)).map((d) => html`<option value="${d.id}">${d.title}</option>`)}</select></label>
<label>Gültig ab<input type="date" name="gueltigAb"></label><label class="chk"><input type="checkbox" name="freigabe" value="ja"> für Eigentümer sichtbar</label><button class="btn" type="submit">Verbindlichen Stand anlegen</button></form>` : ''}</details>` : ''}
${P.isAdmin(u) && gueltig && anspr.length ? html`<details><summary>Zahlung erfassen</summary><form method="post" action="/portal/verguetung/${p.id}/zahlung" class="stack stack-inline">${csrf(s)}<input type="hidden" name="vertragId" value="${vid}">
<label>Anspruch<select name="anspruchKey">${anspr.filter((a) => a.status !== 'prognose').map((a) => html`<option value="${a.key}">${a.bezeichnung} (${eur(a.betrag)})</option>`)}</select></label><label>Betrag EUR<input name="betrag" class="num" inputmode="decimal" required></label><label>Datum<input type="date" name="datum"></label>
<button class="btn" type="submit">Erfassen</button><p class="small muted">In der Entwicklungs- und Abnahmephase werden alle Zahlungen als Demo-Buchung gespeichert und nie als tatsächlich geleistet angezeigt.</p></form></details>` : ''}
${zahl.length ? html`<p class="small muted">${zahl.length} Buchung(en), davon ${zahl.filter((z) => z.synthetisch).length} Demo-Buchung(en).</p>` : ''}</article>`;
}

function anspruchTabelle(anspr) {
  return html`<div class="tbl-wrap"><table class="tbl tbl-compact tbl-num"><thead><tr><th>Anspruch</th><th>Fällig</th><th class="num">Betrag</th><th>Status</th></tr></thead><tbody>
${anspr.map((a) => html`<tr><td>${a.bezeichnung}${a.hinweis ? html`<br><span class="muted small">${a.hinweis}</span>` : ''}</td><td>${a.faellig ? fmtDate(a.faellig) : '–'}</td><td class="num">${eur(a.status === 'bezahlt' || a.status === 'demo' ? a.bezahlt : a.betrag)}</td><td>${statusMark(a.status)}${a.bezahltAm ? html`<br><span class="small muted">${fmtDate(a.bezahltAm)}</span>` : ''}</td></tr>`)}</tbody></table></div>`;
}

function meineVerguetungView(db, staende) {
  if (!staende.length) return html`<section class="panel empty-state"><h2>Noch keine Vergütungsdaten freigegeben</h2><p>Sobald Eckdaten mit Ihnen vereinbart oder ein Vertrag unterzeichnet ist, sehen Sie hier Ihre Beträge. Fragen beantwortet Ihr Ansprechpartner.</p><p><a class="btn" href="/portal/nachrichten">Nachricht schreiben</a></p></section>`;
  return html`<p class="lead-sm">Alle Angaben dieser Vorschau sind ${synth()}. Maßgeblich ist allein der unterzeichnete Vertrag; Prognosen sind unverbindlich.</p>
${staende.map((st) => {
    const p = projekt(db, st.projectId), b = st.bedingungen;
    const parcel = db.parcels.find((x) => x.projectId === p.id && x.ownerContactId === st.ownerContactId);
    const anspr = anspruecheFuer(db, st);
    const summen = VT.summenNachStatus(anspr);
    const naechste = anspr.filter((a) => (a.status === 'faellig' || a.status === 'vereinbart') && a.faellig).sort((x, y) => x.faellig.localeCompare(y.faellig))[0];
    const kauf = VT.kaufpreisregelung(st);
    const optMonate = b.option ? b.option.grundMonate + (b.option.verlaengerungen || []).slice(0, b.option.verlaengerungenGenutzt || 0).reduce((a, x) => a + x, 0) : null;
    return html`<section class="panel owner-contract" aria-labelledby="oc-${st.id}">
<div class="panel-head"><h2 id="oc-${st.id}">${p.name}</h2><span class="stack-inline"><span class="mark mark-ok">${VT.STUFEN[st.stufe].name}</span>${st.synthetisch ? html` <span class="mark mark-demo">Demo-Vertrag</span>` : ''}</span></div>
${st.synthetisch ? html`<p class="demo-note">Synthetischer Demo-Vertrag: Die Beträge zeigen die Rechenlogik und begründen keine Zahlungsansprüche.</p>` : ''}
<p class="meta-line">${VT.VERTRAGSTYPEN[st.typ]} · Version ${st.version}${st.dokumentRef ? ` · Dokument ${st.dokumentRef}` : ''}${st.gueltigAb ? ` · gültig ab ${fmtDate(st.gueltigAb)}` : ''}</p>
<div class="status-strip" role="list">${[['vereinbart', 'Vereinbart'], ['faellig', 'Fällig'], ['bezahlt', 'Bezahlt'], ['prognose', 'Prognose']].map(([k, l]) => html`<div role="listitem" class="st st-${k}"><span>${l}</span><strong class="num">${eur(summen[k])}</strong></div>`)}</div>
${summen.demo ? html`<p class="small demo-note">Zusätzlich ${eur(summen.demo)} als Demo-Buchung abgerechnet – <strong>keine reale Zahlung</strong>.</p>` : ''}
<dl class="kv">
<div><dt>Standort</dt><dd>${parcel ? `${parcel.gemarkung}, Flur ${parcel.flur}, Flurstück ${parcel.flurstueck}` : p.location}</dd></div>
<div><dt>Projektstatus</dt><dd>${phase(p)}</dd></div>
${b.option ? html`<div><dt>Optionsdauer</dt><dd>${optMonate} Monate${(b.option.verlaengerungen || []).length > (b.option.verlaengerungenGenutzt || 0) ? html` <span class="muted small">(verlängerbar um ${(b.option.verlaengerungen || []).slice(b.option.verlaengerungenGenutzt || 0).join(' + ')} Monate)</span>` : ''}</dd></div>
<div><dt>Vereinbarte Optionsvergütung</dt><dd>${b.option.entgelte.map((x, i) => `${i < 2 ? `Jahr ${i + 1}` : `Verl. ${i - 1}`}: ${eur(x, true)}`).join(' · ')}</dd></div>` : ''}
<div><dt>Nächste Fälligkeit</dt><dd>${naechste ? html`${fmtDate(naechste.faellig)} · ${naechste.bezeichnung} · ${eur(naechste.betrag)}` : '–'}</dd></div>
${b.bau && (st.typ === 'festpacht' || st.typ === 'pacht_spaeterer_kauf') ? html`<div><dt>Bauphasenvergütung</dt><dd>${eur(b.bau.jahresbetrag, true)} je Jahr, zeitanteilig ab Baubeginn</dd></div>` : ''}
${b.pacht && st.typ !== 'kaufoption' ? html`<div><dt>Laufende Pacht</dt><dd>${eur(VG.jahrespacht(b.pacht), true)} je Jahr ab Inbetriebnahme <span class="muted small">(${num(b.pacht.flaecheHa, 2)} ha × ${eur(b.pacht.pachtJeHa, true)}, mindestens ${eur(b.pacht.mindestpacht, true)})</span></dd></div>
<div><dt>Indexanpassung</dt><dd>${num((b.pacht.vpi?.anteil ?? 1) * 100, 0)} % der VPI-Veränderung, alle ${b.pacht.vpi?.intervallJahre ?? 1} Jahr(e)${b.pacht.vpi?.indexStaende ? '' : html` <span class="muted small">– noch keine Anpassung erfolgt</span>`}</dd></div>` : ''}
${kauf ? html`<div><dt>Kaufpreisregelung</dt><dd>${eur(kauf.heute.betrag, true)} heute <span class="muted small">(${num(kauf.heute.wert, 2)} EUR/m²${kauf.heute.begrenzt ? `, ${kauf.heute.begrenzt}` : ''}; Indexierung ${pct(st.bedingungen.kauf.indexierung)} p. a.${kauf.bisBetriebsjahr ? `; ausübbar bis Betriebsjahr ${kauf.bisBetriebsjahr}` : ''})</span></dd></div>` : ''}
${st.typ === 'variabel' ? html`<div><dt>Variable Vergütung</dt><dd>${pct(b.variabel.anteil)} von: ${b.variabel.bemessung}${Number.isFinite(b.variabel.deckel) ? `, höchstens ${eur(b.variabel.deckel, true)} je Jahr` : ''}. <span class="muted small">Eigener Vertragstyp; eine Festpacht ist nicht am Handelsergebnis beteiligt.</span></dd></div>` : ''}
</dl>
<details${anspr.length <= 8 ? raw(' open') : ''}><summary>Einzelne Beträge und abgeschlossene Abrechnungen</summary>${anspruchTabelle(anspr)}</details>
<p><a class="btn btn-small" href="/portal/verguetung/vertrag/${st.vertragId}/pdf">Übersicht als PDF</a></p></section>`;
  })}`;
}

function handelsdatenView({ db, s, fehler, hinweise, ok }) {
  const proj = db.projects;
  return html`${ok ? html`<div class="notice" role="status">${ok}</div>` : ''}${fehler?.length ? html`<div class="alert" role="alert"><strong>Nichts übernommen.</strong><ul>${fehler.slice(0, 20).map((f) => html`<li>${f}</li>`)}</ul></div>` : ''}${hinweise?.length ? html`<div class="notice-info"><ul>${hinweise.slice(0, 20).map((f) => html`<li>${f}</li>`)}</ul></div>` : ''}
<section class="panel"><h2>Daten übernehmen</h2><p class="small muted">Schnittstelle ${HD.SCHNITTSTELLEN_VERSION}: monatliche Ergebnisse je Projekt (CSV mit Semikolon oder JSON). Aus diesem Modul werden <strong>keine</strong> Handelsaufträge ausgelöst. Korrekturlieferungen ersetzen die Periode.</p>
<form method="post" action="/portal/admin/handelsdaten" enctype="multipart/form-data" class="stack">${csrf(s)}<label for="hd">Datei (CSV oder JSON)</label><input id="hd" type="file" name="datei" accept=".csv,.json,text/csv,application/json"><button class="btn btn-primary" type="submit">Prüfen und übernehmen</button></form>
<details class="small"><summary>Felder der Schnittstelle</summary><ul class="assume">${HD.FELDER.map(([k, n]) => html`<li><code>${k}</code> – ${n}</li>`)}</ul></details></section>
<section class="panel"><h2>Vorhandene Daten</h2><div class="tbl-wrap"><table class="tbl tbl-compact tbl-num"><thead><tr><th>Projekt</th><th>Periode</th><th class="num">Bezug MWh</th><th class="num">Einspeisung MWh</th><th class="num">Verluste MWh</th><th class="num">Realisiert</th><th class="num">Prognose</th><th class="num">Abweichung</th><th>Quelle</th></tr></thead><tbody>
${[...db.handelsdaten].sort((a, b) => (a.projektId + a.periode).localeCompare(b.projektId + b.periode)).map((h) => html`<tr><td>${proj.find((p) => p.id === h.projektId)?.code}</td><td>${h.periode}</td><td class="num">${num(h.bezugMWh, 1)}</td><td class="num">${num(h.einspeisungMWh, 1)}</td><td class="num">${num(h.speicherverlusteMWh, 1)}</td><td class="num">${eur(h.realisierterErtrag, true)}</td><td class="num">${eur(h.prognoseErtrag, true)}</td><td class="num">${eur(h.abweichung, true)}</td><td class="small">${h.quelle}${h.synthetisch ? html` ${synth()}` : ''}</td></tr>`)}</tbody></table></div></section>`;
}

// Investoren: freigegebene Kennzahlen im Projekt (nur bei Rolle Investor für dieses Projekt)
export function investorKennzahlen(db, u, p) {
  if (!darfInvestorKennzahlen(u, p.id)) return '';
  const f = db.finanzFreigaben.filter((x) => x.projectId === p.id).sort((a, b) => b.freigegebenAm.localeCompare(a.freigegebenAm))[0];
  if (!f) return '';
  const k = f.kennzahlen;
  return html`<section class="panel"><h2>Freigegebene Finanzkennzahlen</h2><p class="meta-line">Szenario ${WM.SZENARIEN[f.szenario].name} · freigegeben ${fmtDate(f.freigegebenAm)} · Modell ${f.modellVersion} ${f.synthetisch ? synth() : ''}</p>
<dl class="kv"><div><dt>Gesamtinvestition</dt><dd class="num">${eur(k.gesamtinvestition, true)}</dd></div><div><dt>Investition je nominaler kWh</dt><dd class="num">${eur(k.investitionJeKWh)}</dd></div><div><dt>Eigenkapitalbedarf</dt><dd class="num">${eur(k.eigenkapitalbedarf, true)}</dd></div><div><dt>Projekt-IRR</dt><dd class="num">${pct(k.projektIRR)}</dd></div><div><dt>Modell-DSCR minimal (vor Steuern)</dt><dd class="num">${k.dscrMin == null ? '–' : `${num(k.dscrMin, 2)}×`}</dd></div></dl>
<p class="small muted">${f.hinweis}</p></section>`;
}
