// Portalbereich „Anlagenplanung & Investition“ (AW-STROMKAI-20261029-INVESTITIONSPLANER-016).
// Rechte: Plattformadministration und Projektleitung je Projekt (policy.rolesForProject); alle anderen erhalten 404.
// Katalogpflege und Freigabe zur Investitionsentscheidung nur Administration. Eigentümer und Investoren sehen nichts davon;
// Investoren erhalten Kennzahlen weiterhin nur über die Freigabe in STROMKAI-WM.
// Datenhaltung nur anhängend: jeder gespeicherte Stand ist eine neue Version; freigegebene Stände werden nie verändert.
// Wirtschaftlichkeit ausschließlich über STROMKAI-WM (WM.berechneSzenarien); der Planer liefert Eingangsgrößen.
import { getDb, persist, newId, now, audit } from '../lib/store.mjs';
import { redirect, send } from '../lib/http.mjs';
import { html, raw, fmtDateTime } from '../lib/html.mjs';
import * as P from '../lib/policy.mjs';
import { eur, num, pct, parseZahl } from '../lib/finance/geld.mjs';
import * as WM from '../lib/finance/wirtschaftlichkeit.mjs';
import * as IP from '../lib/planer/planer.mjs';
import * as D from '../lib/strommarkt/daten.mjs';

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const nf = () => new HttpError(404, 'Nicht gefunden');
export const darfPlanung = (u, pid) => P.rolesForProject(u, pid).some((r) => r === 'admin' || r === 'projektleitung');
export const darfPlanungIrgendwo = (u) => P.rolesOf(u).some((r) => r === 'admin' || r === 'projektleitung');
const csrf = (s) => raw(`<input type="hidden" name="_csrf" value="${s.csrf}">`);
const SCHRITTE = [['grundstueck', 'Grundstück und Standort'], ['technik', 'Technische Konfiguration'], ['kosten', 'Investitionskosten'], ['finanzierung', 'Finanzierung'], ['wirtschaftlichkeit', 'Wirtschaftlichkeit'], ['vergleich', 'Variantenvergleich und Entscheidung']];
const VAR_KEYS = ['A', 'B', 'C', 'D'];
const ERLOES_KURZ = { wm: 'WM-Annahmen des Projekts', b2_A: 'Backtest B2 · Netzentgelt A', b2_B: 'Backtest B2 · Netzentgelt B' };
const mark = (st) => html`<span class="mark ${IP.DATENSTATUS[st]?.mark || 'mark-aud'}">${IP.DATENSTATUS[st]?.name || st}</span>`;
const n1 = (x) => num(x, 1), n0 = (x) => num(x, 0);
const zahl = (v) => { if (v == null || String(v).trim() === '') return null; const n = parseZahl(v); return Number.isFinite(n) ? n : NaN; };
const text = (v, max = 300) => String(v ?? '').trim().slice(0, max);

// ---------- Datenzugriff ----------
const staende = (db, pid) => db.planerStaende.filter((x) => x.projectId === pid).sort((a, b) => b.version - a.version);
const basisWM = (db, pid) => db.finanzmodelle.filter((m) => m.projectId === pid).sort((a, b) => b.version - a.version)[0] || null;
function exportDaten() {
  try { const e = D.lade('ergebnisse.json'), m = D.lade('meta.json'); return e && m ? { ergebnisse: e.ergebnisse, datenversion: m.datenversion, lauf: m.lauf } : null; } catch { return null; }
}
// Vorbelegung eines neuen Projekts: Fläche aus der Projektakte (als „angenommen“), Vergleichsvarianten A/B/C laut Auftrag
function vorbelegung(db, p) {
  const sysId = (h) => IP.aktuelleSysteme(db.planerKatalog).find((x) => x.systemId === `sys-ph-${h}h`) || IP.aktuelleSysteme(db.planerKatalog)[0];
  const ref = (s) => (s ? { systemId: s.systemId, version: s.version } : null);
  return {
    id: null, projectId: p.id, spvId: p.spvId, version: 0, phase: 'vorplanung', status: 'entwurf',
    grundstueck: { ...structuredClone(IP.GRUNDSTUECK_START), bezeichnung: `${p.name} (${p.code})`, flaecheM2: p.tech?.areaHa ? p.tech.areaHa * 10000 : null,
      angaben: { ...structuredClone(IP.GRUNDSTUECK_START.angaben), flaeche: { status: p.tech?.areaHa ? 'angenommen' : 'fehlt', quelle: p.tech?.areaHa ? 'Projektakte' : '' } } },
    annahmen: structuredClone(IP.ANNAHMEN_START),
    varianten: [['A', 'Variante A', 10, 20, 2], ['B', 'Variante B', 15, 30, 2], ['C', 'Variante C', 10, 40, 4]].map(([key, name, mw, mwh, h]) => ({ key, name, systemRef: ref(sysId(h)), leistungMW: mw, kapazitaetMWh: mwh, erloesQuelle: 'wm', kosten: {} })),
    finanzierung: structuredClone(IP.FINANZIERUNG_START), notiz: 'Vorbelegung, noch nicht gespeichert',
  };
}
function speichere(db, u, alt, aenderung, notiz) {
  const neu = { ...structuredClone(alt), ...aenderung, id: newId('ip'), version: (staende(db, alt.projectId)[0]?.version || 0) + 1, status: 'gespeichert', basisVersion: alt.version || null,
    erstelltVon: u.id, erstelltVonName: u.name, erstelltAm: now(), notiz: text(notiz) || null, planerVersion: IP.PLANER_VERSION };
  delete neu.freigegebenVon; delete neu.freigegebenAm;
  neu.pruefsumme = IP.pruefsumme(neu);
  db.planerStaende.push(neu); persist();
  audit('anlagenplanung_gespeichert', u, { projekt: neu.projectId, version: neu.version });
  return neu;
}
function rechne(db, stand) {
  const ex = exportDaten();
  const b = basisWM(db, stand.projectId);
  const angebote = db.planerAngebote.filter((a) => a.projectId === stand.projectId);
  return stand.varianten.map((v) => {
    const r = IP.rechneVariante({ stand, v, katalog: db.planerKatalog, angebote, basis: b?.params, ergebnisse: ex?.ergebnisse });
    if (r.params && !r.wirtschaftlichkeitSperre) {
      try { r.wm = WM.berechneSzenarien(r.params, { quelle: `Investitionsplaner V${stand.version} ${v.name}`, berechnetAm: stand.erstelltAm || now() }); } catch (e) { r.wmFehler = e.fehler || [e.message]; }
      // Netzentgelt-Szenarien A und B als getrennte Berechnungen (nur mit passender Marktsimulation)
      r.netz = {};
      for (const [k, nv] of [['A', 'befreit'], ['B', 'ohne_befreiung']]) {
        const ref = ex ? IP.erloesReferenz(ex.ergebnisse, r.dim.dauerH, nv) : { fehler: 'Trading-Export nicht verfügbar.' };
        if (ref.fehler) { r.netz[k] = { fehler: ref.fehler }; continue; }
        const pa = IP.wmParameter({ g: stand.grundstueck, ann: stand.annahmen, v, dim: r.dim, sys: r.sys, pos: r.pos, fin: stand.finanzierung, finErg: r.finErg, basis: b.params, referenz: ref });
        try { r.netz[k] = { ref, wm: WM.berechne(pa, 'basis', { quelle: 'Netzentgelt-Szenario ' + k }) }; } catch (e) { r.netz[k] = { fehler: (e.fehler || [e.message]).join(' ') }; }
      }
    } else if (r.wirtschaftlichkeitSperre) {
      r.wmFehler = [r.wirtschaftlichkeitSperre];
    }
    return r;
  });
}

// ---------- Routen ----------
export async function handleAnlagenplanung({ res, url, path, method, u, s, view, page, post }) {
  if (!path.startsWith('/portal/anlagenplanung')) return null;
  const db = getDb();
  let m;
  if (path === '/portal/anlagenplanung' && method === 'GET') {
    const projekte = db.projects.filter((p) => darfPlanung(u, p.id));
    if (!projekte.length) throw nf();
    return view('Anlagenplanung & Investition', uebersicht(db, u, projekte), 'Vorplanung von Grundstück, Technik, Investition und Finanzierung als Eingangsgrößen für STROMKAI-WM');
  }
  if (path === '/portal/anlagenplanung/katalog') {
    if (!darfPlanungIrgendwo(u)) throw nf();
    if (method === 'GET') return view('Speichersystem-Katalog', katalogView(db, u, s, url.searchParams.get('m')), 'Konfigurierbare Speichersysteme mit Version, Quelle und Datenstatus');
    if (method === 'POST') {
      if (!P.isAdmin(u)) throw nf();
      const { fields } = await post();
      const alt = IP.aktuelleSysteme(db.planerKatalog).find((x) => x.systemId === fields.systemId);
      const neu = { datenstatus: IP.DATENSTATUS[fields.datenstatus] ? fields.datenstatus : 'platzhalter' };
      const fehler = [];
      for (const [k, n, , art] of IP.KATALOG_FELDER) {
        if (art === 'text') { neu[k] = text(fields[k], 200) || null; continue; }
        const z = zahl(fields[k]);
        if (Number.isNaN(z)) { fehler.push(`${n}: bitte eine Zahl eingeben.`); continue; }
        neu[k] = z == null ? null : art === 'prozent' ? z / 100 : z;
      }
      fehler.push(...IP.pruefeSystem(neu));
      if (fehler.length) return send(res, 422, String(page('Speichersystem-Katalog', katalogView(db, u, s, null, fehler, { ...alt, ...neu }), 'Eingaben prüfen')));
      const systemId = alt?.systemId || `sys-${newId('k').slice(2)}`;
      const version = (alt?.version || 0) + 1;
      db.planerKatalog.push({ ...neu, id: `${systemId}-v${version}`, systemId, version, erfasstVon: u.id, erfasstAm: now() });
      persist(); audit('katalog_version', u, { system: systemId, version });
      return redirect(res, '/portal/anlagenplanung/katalog?m=ok');
    }
    throw nf();
  }
  if ((m = /^\/portal\/anlagenplanung\/([\w-]+)(?:\/(speichern|angebot|angebot-waehlen|wm|freigeben|export\.csv|bericht))?$/.exec(path))) {
    const p = db.projects.find((x) => x.id === m[1]);
    if (!p || !darfPlanung(u, p.id)) throw nf();
    const alle = staende(db, p.id);
    const stand = alle.find((x) => x.id === url.searchParams.get('v')) || alle[0] || vorbelegung(db, p);
    const aktion = m[2];
    if (!aktion && method === 'GET') {
      const schritt = SCHRITTE.some(([k]) => k === url.searchParams.get('schritt')) ? url.searchParams.get('schritt') : 'grundstueck';
      const varKey = stand.varianten.some((v) => v.key === url.searchParams.get('var')) ? url.searchParams.get('var') : stand.varianten[0]?.key;
      const msg = { ok: 'Neue Version gespeichert.', wm: 'An STROMKAI-WM übergeben: neue Berechnungsversion angelegt.', frei: 'Stand zur Investitionsentscheidung freigegeben.', angebot: 'Angebot erfasst.' }[url.searchParams.get('m')];
      return view(`Anlagenplanung ${p.code}`, akte({ db, u, s, p, alle, stand, schritt, varKey, msg }), db.spvs.find((x) => x.id === p.spvId)?.name);
    }
    if (aktion === 'export.csv' && method === 'GET') {
      audit('anlagenplanung_export', u, { projekt: p.id, version: stand.version });
      res.setHeader('Content-Disposition', `attachment; filename="Anlagenplanung_${p.code}_V${stand.version}.csv"`);
      return send(res, 200, csv(p, stand, rechne(db, stand)), 'text/csv; charset=utf-8');
    }
    if (aktion === 'bericht' && method === 'GET') return view(`Kalkulationsbericht ${p.code} V${stand.version}`, bericht(db, p, stand, rechne(db, stand)), 'Druckansicht – Vorplanung, keine Investitionsgrundlage');
    if (method !== 'POST') throw nf();
    const { fields } = await post();
    const basis = alle.find((x) => x.id === fields.v) || alle[0] || vorbelegung(db, p);
    const zurueck = (schritt, extra = '') => `/portal/anlagenplanung/${p.id}?schritt=${schritt}${extra}`;
    if (aktion === 'speichern') {
      const schritt = fields.schritt;
      const { aenderung, fehler } = formular(db, basis, schritt, fields, u);
      if (fehler.length) return send(res, 422, String(page(`Anlagenplanung ${p.code}`, akte({ db, u, s, p, alle, stand: { ...basis, ...aenderung, entwurf: true }, schritt, varKey: fields.var, fehler }), 'Eingaben prüfen')));
      const neu = speichere(db, u, basis, aenderung, fields.notiz);
      return redirect(res, zurueck(schritt, `&v=${neu.id}&var=${encodeURIComponent(fields.var || '')}&m=ok`));
    }
    if (aktion === 'angebot') {
      const pos = IP.POSITIONEN.find((x) => x.nr === Number(fields.positionNr));
      const preis = zahl(fields.einzelpreis);
      const fehler = [];
      if (!pos || pos.nr === 17 || pos.nr === 18) fehler.push('Bitte eine bepreisbare Kostenposition wählen.');
      if (!(preis >= 0)) fehler.push('Einzelpreis fehlt.');
      if (!text(fields.lieferant)) fehler.push('Lieferant fehlt.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.datum || '')) fehler.push('Angebotsdatum fehlt.');
      if (fehler.length) return send(res, 422, String(page(`Anlagenplanung ${p.code}`, akte({ db, u, s, p, alle, stand: basis, schritt: 'kosten', varKey: fields.var, fehler }), 'Eingaben prüfen')));
      db.planerAngebote.push({ id: newId('ang'), projectId: p.id, positionNr: pos.nr, lieferant: text(fields.lieferant, 120), einzelpreis: preis, einheit: text(fields.einheit, 20) || null, datum: fields.datum,
        gueltigBis: /^\d{4}-\d{2}-\d{2}$/.test(fields.gueltigBis || '') ? fields.gueltigBis : null, dokumentRef: text(fields.dokumentRef, 120) || null, notiz: text(fields.notiz) || null, intern: true, erfasstVon: u.id, erfasstAm: now() });
      persist(); audit('angebot_erfasst', u, { projekt: p.id, position: pos.nr });
      return redirect(res, zurueck('kosten', `&v=${basis.id || ''}&var=${encodeURIComponent(fields.var || '')}&m=angebot`));
    }
    if (aktion === 'angebot-waehlen') {
      const ang = db.planerAngebote.find((a) => a.id === fields.angebotId && a.projectId === p.id);
      const vi = basis.varianten.findIndex((v) => v.key === fields.var);
      if (!ang || vi < 0) throw nf();
      if (!text(fields.begruendung)) return send(res, 422, String(page(`Anlagenplanung ${p.code}`, akte({ db, u, s, p, alle, stand: basis, schritt: 'kosten', varKey: fields.var, fehler: ['Bitte die Auswahl begründen (Vergleich der Angebote).'] }), 'Eingaben prüfen')));
      const varianten = structuredClone(basis.varianten);
      varianten[vi].kosten = { ...varianten[vi].kosten, [ang.positionNr]: { angebotId: ang.id, begruendung: text(fields.begruendung), geaendertVon: u.name, geaendertAm: now() } };
      const neu = speichere(db, u, basis, { varianten, phase: basis.phase === 'vorplanung' ? 'angebotsphase' : basis.phase }, `Angebot ${ang.lieferant} für Position ${ang.positionNr} (${varianten[vi].name}) gewählt`);
      return redirect(res, zurueck('kosten', `&v=${neu.id}&var=${encodeURIComponent(fields.var)}&m=ok`));
    }
    if (aktion === 'wm') {
      if (!basis.id) throw nf();
      const r = rechne(db, basis).find((x) => x.v.key === fields.var);
      if (!r?.params || r.wmFehler || r.wirtschaftlichkeitSperre) throw new HttpError(422, 'Die Variante lässt sich nicht an STROMKAI-WM übergeben: Netzgrenzen oder Berechnungsgrundlage sind nicht ausreichend belastbar.');
      const b = basisWM(db, p.id);
      const at = now();
      const quelle = `Investitionsplaner ${p.code} V${basis.version}, ${r.v.name} (${IP.PHASEN[basis.phase].name})`;
      const ergebnis = Object.fromEntries(Object.entries(WM.berechneSzenarien(r.params, { quelle, berechnetAm: at })).map(([k, x]) => [k, { meta: x.meta, kennzahlen: x.kennzahlen }]));
      const fm = { id: newId('fm'), projectId: p.id, spvId: p.spvId, version: (b?.version || 0) + 1, status: 'simulation', synthetisch: !!b?.synthetisch || basis.phase !== 'investitionsentscheidung', params: r.params, ergebnis, quelle,
        planerRef: { standId: basis.id, version: basis.version, variante: r.v.key, pruefsumme: basis.pruefsumme }, erstelltVon: u.id, erstelltAm: at, notiz: `Übergabe aus Anlagenplanung V${basis.version}, ${r.v.name}` };
      db.finanzmodelle.push(fm); persist();
      audit('anlagenplanung_wm_uebergabe', u, { projekt: p.id, planerVersion: basis.version, variante: r.v.key, wmVersion: fm.version });
      return redirect(res, zurueck('wirtschaftlichkeit', `&v=${basis.id}&var=${encodeURIComponent(r.v.key)}&m=wm&fm=${fm.id}`));
    }
    if (aktion === 'freigeben') {
      if (!P.isAdmin(u) || !basis.id || basis.status === 'freigegeben') throw nf();
      const rs = rechne(db, basis);
      const netzGesperrt = rs.filter((r) => r.wirtschaftlichkeitSperre).map((r) => `${r.v.name}: ${r.wirtschaftlichkeitSperre}`);
      if (netzGesperrt.length) return send(res, 422, String(page(`Anlagenplanung ${p.code}`, akte({ db, u, s, p, alle, stand: basis, schritt: 'vergleich', varKey: fields.var, fehler: [`Freigabe nicht möglich: ${netzGesperrt.join(' ')}`] }), 'Freigabe abgewiesen')));
      const offen = rs.flatMap((r) => (r.pos || []).filter((x) => ['fehlt', 'platzhalter'].includes(x.datenstatus)).map((x) => `${r.v.name}: ${x.nr} ${x.name}`));
      if (offen.length) return send(res, 422, String(page(`Anlagenplanung ${p.code}`, akte({ db, u, s, p, alle, stand: basis, schritt: 'vergleich', varKey: fields.var, fehler: [`Freigabe nicht möglich: ${offen.length} Positionen sind Platzhalter oder fehlen. Eine Investitionsentscheidung braucht abgeglichene Kosten.`] }), 'Freigabe abgewiesen')));
      const neu = speichere(db, u, basis, { phase: 'investitionsentscheidung' }, 'Freigabe zur Investitionsentscheidung');
      neu.status = 'freigegeben'; neu.freigegebenVon = u.name; neu.freigegebenAm = now(); persist();
      audit('anlagenplanung_freigegeben', u, { projekt: p.id, version: neu.version });
      return redirect(res, zurueck('vergleich', `&v=${neu.id}&m=frei`));
    }
    throw nf();
  }
  throw nf();
}

// ---------- Formularauswertung je Schritt ----------
function formular(db, basis, schritt, f, u) {
  const fehler = [];
  const nimm = (k, label, { pflicht = false, min = 0, prozent = false } = {}) => {
    const z = zahl(f[k]);
    if (Number.isNaN(z)) { fehler.push(`${label}: bitte eine Zahl eingeben.`); return null; }
    if (z == null) { if (pflicht) fehler.push(`${label} fehlt.`); return null; }
    if (z < min) fehler.push(`${label} muss ≥ ${min} sein.`);
    return prozent ? z / 100 : z;
  };
  if (schritt === 'grundstueck') {
    const g = { ...structuredClone(basis.grundstueck), bezeichnung: text(f['g.bezeichnung'], 160) };
    for (const [k, l] of [['flaecheM2', 'Grundstücksfläche'], ['laengeM', 'Länge'], ['breiteM', 'Breite'], ['grenzabstandM', 'Grenzabstand'], ['nichtNutzbarM2', 'Nicht nutzbare Fläche'], ['zufahrtM2', 'Zufahrt, Rangieren, Wartung'], ['feuerwehrM2', 'Feuerwehrzufahrt und Brandschutz'], ['nebenanlagenM2', 'Trafostation, Schaltanlage, Netzanschluss'], ['netzMW', 'Netzanschlussleistung'], ['einspeiseMW', 'Max. Einspeiseleistung'], ['bezugMW', 'Max. Bezugsleistung']])
      g[k] = nimm(`g.${k}`, l);
    for (const k of ['gelaende', 'entwaesserung', 'erschliessung']) g[k] = text(f[`g.${k}`], 400);
    for (const k of Object.keys(IP.GRUNDSTUECK_START.angaben)) g.angaben[k] = { status: IP.ANGABE_STATUS[f[`a.${k}.status`]] ? f[`a.${k}.status`] : 'fehlt', quelle: text(f[`a.${k}.quelle`], 200) };
    if (!g.flaecheM2 && !(g.laengeM && g.breiteM)) fehler.push('Bitte die Grundstücksfläche oder Länge und Breite angeben.');
    return { aenderung: { grundstueck: g }, fehler };
  }
  if (schritt === 'technik') {
    const katalog = IP.aktuelleSysteme(db.planerKatalog);
    const varianten = [];
    for (const key of VAR_KEYS) {
      const name = text(f[`v.${key}.name`], 60);
      if (!name) continue;
      const alt = basis.varianten.find((v) => v.key === key);
      const sysId = f[`v.${key}.system`];
      const sys = alt?.systemRef?.systemId === sysId && f[`v.${key}.systemNeu`] !== 'ja' ? alt.systemRef : (katalog.find((x) => x.systemId === sysId) ? { systemId: sysId, version: katalog.find((x) => x.systemId === sysId).version } : null);
      if (!sys) fehler.push(`${name}: Speichersystem fehlt.`);
      const v = { key, name, systemRef: sys, leistungMW: nimm(`v.${key}.mw`, `${name} Leistung`, { pflicht: true }), kapazitaetMWh: nimm(`v.${key}.mwh`, `${name} Kapazität`, { pflicht: true }), erloesQuelle: IP.ERLOES_QUELLEN[f[`v.${key}.erloes`]] ? f[`v.${key}.erloes`] : 'wm', kosten: alt?.kosten || {} };
      if (!(v.leistungMW > 0) || !(v.kapazitaetMWh > 0)) fehler.push(`${name}: Leistung und Kapazität müssen größer als 0 sein.`);
      varianten.push(v);
    }
    if (varianten.length < 1) fehler.push('Mindestens eine Variante ist erforderlich.');
    const annahmen = { ...basis.annahmen, opexSkalierung: f['a.opexSkalierung'] === 'unveraendert' ? 'unveraendert' : 'skaliert' };
    for (const [k, l, , art] of IP.ANNAHMEN_FELDER) { const z = nimm(`a.${k}`, l, { pflicht: true, prozent: art === 'prozent' }); if (z != null) annahmen[k] = z; }
    if (!(annahmen.cosPhi > 0 && annahmen.cosPhi <= 1)) fehler.push('cos φ muss zwischen 0 und 1 liegen.');
    if (!(annahmen.mvaJeTrafo > 0)) fehler.push('Bemessungsleistung je Trafostation muss größer als 0 sein.');
    return { aenderung: { varianten, annahmen }, fehler };
  }
  if (schritt === 'kosten') {
    const vi = basis.varianten.findIndex((v) => v.key === f.var);
    if (vi < 0) return { aenderung: {}, fehler: ['Variante fehlt.'] };
    const varianten = structuredClone(basis.varianten);
    const kosten = { ...varianten[vi].kosten };
    for (const pos of IP.POSITIONEN.filter((x) => x.nr !== 17 && x.nr !== 18)) {
      const k = (x) => f[`k.${pos.nr}.${x}`];
      const ov = {};
      const menge = zahl(k('menge')), preis = zahl(k('preis'));
      if (Number.isNaN(menge) || Number.isNaN(preis)) { fehler.push(`Position ${pos.nr}: bitte Zahlen eingeben.`); continue; }
      if (menge != null && menge !== zahl(k('mengeAlt'))) ov.menge = menge;
      if (preis != null && preis !== zahl(k('preisAlt'))) ov.einzelpreis = preis;
      const st = k('status');
      if (st && st !== k('statusAlt') && IP.DATENSTATUS[st] && !['berechnet', 'freigegeben'].includes(st)) ov.datenstatus = st;
      for (const x of ['quelle', 'preisstand', 'lieferant', 'ausschreibung']) if (text(k(x)) !== text(k(`${x}Alt`))) ov[x] = text(k(x));
      if (ov.datenstatus === 'enthalten') { const z = Number(k('enthaltenIn')); if (!IP.POSITIONEN.some((x) => x.nr === z && x.nr !== pos.nr)) fehler.push(`Position ${pos.nr}: Bei „enthalten“ bitte die Position angeben, die den Betrag trägt.`); else ov.enthaltenIn = z; }
      if (Object.keys(ov).length) {
        if (!text(k('begruendung'))) fehler.push(`Position ${pos.nr} „${pos.name}“: Änderung bitte begründen.`);
        kosten[pos.nr] = { ...(kosten[pos.nr] || {}), ...ov, begruendung: text(k('begruendung')), geaendertVon: u.name, geaendertAm: now() };
        if (ov.einzelpreis != null || ov.datenstatus) delete kosten[pos.nr].angebotId;
      }
    }
    varianten[vi].kosten = kosten;
    return { aenderung: { varianten }, fehler };
  }
  if (schritt === 'finanzierung') {
    const fin = { ...structuredClone(basis.finanzierung), status: IP.FIN_STATUS[f['f.status']] ? f['f.status'] : 'annahme', zusageRef: text(f['f.zusageRef'], 120), quelle: text(f['f.quelle'], 300) };
    fin.fkAnteil = nimm('f.fkAnteil', 'Fremdkapitalanteil', { pflicht: true, prozent: true });
    fin.bauzeitMonate = nimm('f.bauzeitMonate', 'Bauzeit', { pflicht: true });
    fin.dsraMonate = nimm('f.dsraMonate', 'Schuldendienstreserve', { pflicht: true });
    fin.abrufplan = [0, 1, 2, 3].map((i) => ({ monat: zahl(f[`f.abruf.${i}.monat`]), anteil: zahl(f[`f.abruf.${i}.anteil`]) })).filter((x) => x.monat != null && x.anteil != null && !Number.isNaN(x.monat) && !Number.isNaN(x.anteil)).map((x) => ({ monat: x.monat, anteil: x.anteil / 100 }));
    fin.tranchen = [0, 1, 2].map((i) => {
      const nm = text(f[`f.t.${i}.name`], 60); if (!nm) return null;
      return { name: nm, anteil: nimm(`f.t.${i}.anteil`, `${nm} Anteil`, { pflicht: true, prozent: true }), zins: nimm(`f.t.${i}.zins`, `${nm} Zins`, { pflicht: true, prozent: true }), laufzeitJahre: nimm(`f.t.${i}.laufzeit`, `${nm} Laufzeit`, { pflicht: true }),
        tilgungsfreiJahre: nimm(`f.t.${i}.frei`, `${nm} tilgungsfreie Jahre`, { pflicht: true }), modell: IP.TILGUNGSMODELLE[f[`f.t.${i}.modell`]] ? f[`f.t.${i}.modell`] : 'annuitaet', gebuehrAnteil: nimm(`f.t.${i}.gebuehr`, `${nm} Gebühren`, { pflicht: true, prozent: true }) };
    }).filter(Boolean);
    if (!fehler.length) fehler.push(...IP.pruefeFinanzierung(fin, basisWM(db, basis.projectId)?.params?.technik?.betriebsjahre));
    return { aenderung: { finanzierung: fin }, fehler };
  }
  return { aenderung: {}, fehler: ['Unbekannter Schritt.'] };
}

// ---------- Ansichten ----------
function uebersicht(db, u, projekte) {
  return html`<section class="panel"><div class="panel-head"><h2>Projekte</h2><a class="btn" href="/portal/anlagenplanung/katalog">Speichersystem-Katalog</a></div>
<p class="small muted">Vorplanung mit transparenten Annahmen: keine genehmigungsfähige Fachplanung, kein Herstellerangebot, keine Finanzierungszusage. Erlöse, Kapitalwert, Renditen, DSCR und Amortisation rechnet STROMKAI-WM.</p>
<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Projekt</th><th>Gesellschaft</th><th>Planungsstand</th><th>Phase</th><th></th></tr></thead><tbody>
${projekte.map((p) => { const st = staende(db, p.id)[0]; return html`<tr><td data-l="Projekt"><strong>${p.name}</strong><br><span class="small muted">${p.code}</span></td><td data-l="Gesellschaft">${db.spvs.find((x) => x.id === p.spvId)?.name}</td>
<td data-l="Planungsstand">${st ? html`V${st.version} · ${fmtDateTime(st.erstelltAm)}${st.status === 'freigegeben' ? html` <span class="mark mark-ok">freigegeben</span>` : ''}` : html`<span class="muted">noch keiner</span>`}</td>
<td data-l="Phase">${st ? IP.PHASEN[st.phase].name : '–'}</td><td><a class="btn btn-small" href="/portal/anlagenplanung/${p.id}">${st ? 'Planung öffnen' : 'Planung beginnen'}</a></td></tr>`; })}
</tbody></table></div></section>`;
}

function katalogView(db, u, s, msg, fehler, entwurf) {
  const sys = IP.aktuelleSysteme(db.planerKatalog);
  const w = (x, k, art) => { const v = x?.[k]; return v == null ? '' : art === 'prozent' ? num(v * 100, 2) : art === 'text' ? v : num(v, 2); };
  return html`${msg === 'ok' ? html`<div class="notice" role="status">Neue Katalogversion gespeichert. Bestehende Planungsstände behalten ihre bisherige Version.</div>` : ''}
${fehler?.length ? html`<div class="alert" role="alert"><ul class="assume">${fehler.map((x) => html`<li>${x}</li>`)}</ul></div>` : ''}
<section class="panel"><div class="panel-head"><h2>Speichersysteme</h2><a class="btn" href="/portal/anlagenplanung">Zur Anlagenplanung</a></div>
<p class="small muted">Platzhalter haben keinen Herstellerbezug und keinen Preis. Ohne Katalogpreis gilt in der Kostenstruktur die gekennzeichnete Demo-Annahme. Änderungen erzeugen eine neue Version; Planungsstände verweisen auf ihre Version und ändern sich dadurch nicht.</p>
<div class="tbl-wrap"><table class="tbl tbl-num tbl-compact"><thead><tr><th>System</th><th>Datenstatus</th><th class="num">Block nutzbar</th><th class="num">Leistung</th><th class="num">Dauer</th><th class="num">Maße</th><th class="num">Wirkungsgrad</th><th class="num">Preis</th><th>Quelle</th><th class="num">Version</th></tr></thead><tbody>
${sys.map((x) => html`<tr><th scope="row">${x.hersteller}<br><span class="small muted">${x.produkt}</span></th><td>${mark(x.datenstatus)}</td><td class="num">${n1(x.kapNutzbarMWh)} MWh</td><td class="num">${n1(x.leistungMW)} MW</td><td class="num">${n1(x.kapNutzbarMWh / x.leistungMW)} h</td>
<td class="num">${num(x.laengeM, 2)} × ${num(x.breiteM, 2)} m</td><td class="num">${pct(x.wirkungsgrad)}</td><td class="num">${x.preisEURkWh == null ? html`<span class="mark mark-warn">kein Preis</span>` : `${num(x.preisEURkWh, 0)} €/kWh`}</td><td class="small">${x.quelle || '–'}${x.kostenstand ? html`<br>Kostenstand ${x.kostenstand}` : ''}</td><td class="num">V${x.version}</td></tr>`)}
</tbody></table></div></section>
${P.isAdmin(u) ? html`<section class="panel"><h2>System erfassen oder neue Version anlegen</h2>
<form method="post" action="/portal/anlagenplanung/katalog" class="calc-form">${csrf(s)}
<div class="fgrid"><label class="fld"><span>System</span><select name="systemId"><option value="">Neues System</option>${sys.map((x) => html`<option value="${x.systemId}"${entwurf?.systemId === x.systemId ? raw(' selected') : ''}>Neue Version: ${x.hersteller} ${x.produkt} (V${x.version})</option>`)}</select></label>
<label class="fld"><span>Datenstatus</span><select name="datenstatus">${Object.entries(IP.DATENSTATUS).filter(([k]) => !['berechnet', 'enthalten', 'freigegeben', 'fehlt'].includes(k)).map(([k, v]) => html`<option value="${k}"${(entwurf?.datenstatus || 'platzhalter') === k ? raw(' selected') : ''}>${v.name}</option>`)}</select></label>
${IP.KATALOG_FELDER.map(([k, n, e, art]) => html`<label class="fld"><span>${n}${e ? html` <em>${e}</em>` : ''}</span><input name="${k}" value="${w(entwurf, k, art)}"${art === 'text' ? '' : raw(' class="num" inputmode="decimal"')}></label>`)}</div>
<p class="small muted">Keine geschätzten Preise als Angebot erfassen. Ein bestätigtes Angebot braucht Angebotsdatum und Quelle.</p>
<button class="btn btn-primary" type="submit">Als neue Version speichern</button></form></section>` : ''}`;
}

function kopf({ p, alle, stand, schritt, varKey }) {
  const link = (k) => `/portal/anlagenplanung/${p.id}?schritt=${k}${stand.id ? `&v=${stand.id}` : ''}${varKey ? `&var=${encodeURIComponent(varKey)}` : ''}`;
  const frei = stand.status === 'freigegeben';
  return html`<section class="panel ip-kopf"><div class="panel-head"><h2>${stand.id ? `Planungsstand V${stand.version}` : 'Neuer Planungsstand (Vorbelegung)'}</h2>
<div class="ip-marken"><span class="mark mark-info">${IP.PHASEN[stand.phase].name}</span> ${frei ? html`<span class="mark mark-ok">Freigegeben ${stand.freigegebenVon} · ${fmtDateTime(stand.freigegebenAm)}</span>` : html`<span class="mark mark-demo">Vorplanung – keine Investitionsgrundlage</span>`}</div></div>
<p class="small muted">${stand.id ? html`Gespeichert ${fmtDateTime(stand.erstelltAm)} von ${stand.erstelltVonName} · Prüfsumme <code>${stand.pruefsumme}</code> · ${stand.planerVersion}${stand.notiz ? html` · ${stand.notiz}` : ''}` : 'Noch nicht gespeichert. Jede Speicherung legt eine neue Version an; frühere Versionen bleiben unverändert abrufbar.'}</p>
${alle.length ? html`<details class="small"><summary>Versionen (${alle.length})</summary><ul class="assume">${alle.map((x) => html`<li><a href="/portal/anlagenplanung/${p.id}?schritt=${schritt}&v=${x.id}"${x.id === stand.id ? raw(' aria-current="true"') : ''}>V${x.version}</a> · ${fmtDateTime(x.erstelltAm)} · ${x.erstelltVonName} · ${IP.PHASEN[x.phase].name}${x.status === 'freigegeben' ? ' · freigegeben' : ''}${x.notiz ? ` · ${x.notiz}` : ''}</li>`)}</ul></details>` : ''}
<nav aria-label="Planungsschritte"><ol class="ip-schritte">${SCHRITTE.map(([k, n], i) => html`<li><a href="${link(k)}"${k === schritt ? raw(' aria-current="step"') : ''}><span class="ip-nr">${i + 1}</span>${n}</a></li>`)}</ol></nav></section>`;
}

function akte({ db, u, s, p, alle, stand, schritt, varKey, msg, fehler }) {
  const rs = rechne(db, stand);
  const r = rs.find((x) => x.v.key === varKey) || rs[0];
  const inhalt = { grundstueck: () => schrittGrundstueck(s, p, stand, rs), technik: () => schrittTechnik(db, s, p, stand, rs), kosten: () => schrittKosten(db, s, p, stand, rs, r), finanzierung: () => schrittFinanzierung(s, p, stand, rs, r), wirtschaftlichkeit: () => schrittWirtschaft(db, u, s, p, stand, rs, r), vergleich: () => schrittVergleich(db, u, s, p, stand, rs) }[schritt]();
  return html`${msg ? html`<div class="notice" role="status">${msg}</div>` : ''}${fehler?.length ? html`<div class="alert" role="alert"><strong>Nicht gespeichert.</strong><ul class="assume">${fehler.map((x) => html`<li>${x}</li>`)}</ul></div>` : ''}
${kopf({ p, alle, stand, schritt, varKey: r?.v.key })}${inhalt}`;
}

const speicherLeiste = (stand, schritt, varKey, label = 'Als neue Version speichern') => html`<input type="hidden" name="schritt" value="${schritt}"><input type="hidden" name="v" value="${stand.id || ''}">${varKey ? html`<input type="hidden" name="var" value="${varKey}">` : ''}
<div class="ip-speichern"><label class="fld"><span>Notiz zur Version</span><input name="notiz" maxlength="300" placeholder="z. B. Flächenangaben aus Lageplan übernommen"></label><button class="btn btn-primary" type="submit">${label}</button></div>`;
const varTabs = (p, stand, schritt, aktiv) => html`<div class="seg" role="group" aria-label="Variante">${stand.varianten.map((v) => html`<a href="/portal/anlagenplanung/${p.id}?schritt=${schritt}${stand.id ? `&v=${stand.id}` : ''}&var=${encodeURIComponent(v.key)}"${v.key === aktiv ? raw(' aria-current="true"') : ''}>${v.name}</a>`)}</div>`;
const meldungen = (ms) => ms?.length ? html`<ul class="ip-meldungen">${ms.map((x) => html`<li class="ip-${x.art}">${x.text}</li>`)}</ul>` : '';

// Schematische Draufsicht (SVG, Maßstab 1 Einheit = 1 m)
function draufsicht(r, titel) {
  const d = r.dim, b = d.bilanz, lay = d.layout;
  if (!(b.L > 0 && b.B > 0)) return html`<p class="small muted">Keine Draufsicht ohne Grundstücksfläche.</p>`;
  const a = (b.L - b.innenL) / 2;
  const blk = lay.bloecke.map((x) => `<rect class="ip-block" x="${(a + x.x).toFixed(2)}" y="${(a + x.y).toFixed(2)}" width="${x.w}" height="${x.h}"/>`).join('');
  const zw = Math.max(0.5, b.L / 300);
  return html`<figure class="ip-plan"><svg viewBox="${-zw} ${-zw} ${(b.L + 2 * zw).toFixed(2)} ${(b.B + 2 * zw).toFixed(2)}" role="img" aria-labelledby="pl-${r.v.key}"><title id="pl-${r.v.key}">${titel}: Grundstück ${n0(b.L)} × ${n0(b.B)} m, ${lay.bloecke.length} von ${d.bloecke} Blöcken platziert</title>
${raw(`<rect class="ip-grund" x="0" y="0" width="${b.L}" height="${b.B}" stroke-width="${zw}"/>
<rect class="ip-innen" x="${a}" y="${a}" width="${b.innenL}" height="${b.innenB}" stroke-width="${zw}"/>
<rect class="ip-zufahrt" x="${a}" y="${a}" width="${b.innenL}" height="${lay.zufahrtH || 0}"/>
<rect class="ip-station" x="${(a + b.innenL - (lay.stationsB || 0)).toFixed(2)}" y="${(a + (lay.zufahrtH || 0)).toFixed(2)}" width="${(lay.stationsB || 0).toFixed(2)}" height="${Math.max(0, b.innenB - (lay.zufahrtH || 0)).toFixed(2)}"/>${blk}`)}</svg>
<figcaption><span class="lg ip-lg-block">Speicherblock</span> <span class="lg ip-lg-zufahrt">Zufahrt</span> <span class="lg ip-lg-station">Stationen und Nebenanlagen</span> <span class="lg ip-lg-abstand">Grenzabstand</span><br>
<strong>Schematische Vorplanung</strong> – keine Aussage über bau-, brandschutz- oder netztechnische Zulässigkeit.${b.rechteck ? '' : ' Geometrie als Quadrat angenommen.'}${lay.ueberzaehlig ? html` <span class="bad">${lay.ueberzaehlig} Blöcke ohne Platz.</span>` : ''}</figcaption></figure>`;
}

function schrittGrundstueck(s, p, stand, rs) {
  const g = stand.grundstueck, b = IP.flaechenbilanz(g);
  const fz = (k, l, e) => html`<label class="fld"><span>${l} <em>${e}</em></span><input class="num" inputmode="decimal" name="g.${k}" value="${g[k] == null ? '' : num(g[k], 2)}"></label>`;
  const angabe = (k, l) => html`<div class="fld ip-angabe"><span>${l}</span><select name="a.${k}.status" aria-label="Status ${l}">${Object.entries(IP.ANGABE_STATUS).map(([x, n]) => html`<option value="${x}"${g.angaben?.[k]?.status === x ? raw(' selected') : ''}>${n}</option>`)}</select><input name="a.${k}.quelle" value="${g.angaben?.[k]?.quelle || ''}" placeholder="Quelle" aria-label="Quelle ${l}"></div>`;
  const zeile = (l, v, cls = '') => html`<tr class="${cls}"><th scope="row">${l}</th><td class="num">${n0(v)} m²</td></tr>`;
  return html`<section class="panel"><h2>Grundstücksprofil</h2>
<form method="post" action="/portal/anlagenplanung/${p.id}/speichern" class="calc-form">${csrf(s)}
<fieldset class="fgroup"><legend>Grundstück</legend><div class="fgrid"><label class="fld ip-breit"><span>Bezeichnung</span><input name="g.bezeichnung" value="${g.bezeichnung}"></label>
<div class="fld"><span>Projektgesellschaft</span><strong>${p.code}</strong></div>${fz('flaecheM2', 'Grundstücksfläche', 'm²')}${fz('laengeM', 'Länge', 'm')}${fz('breiteM', 'Breite', 'm')}</div></fieldset>
<fieldset class="fgroup"><legend>Abstände und nicht nutzbare Flächen</legend><div class="fgrid">${fz('grenzabstandM', 'Grenzabstand umlaufend', 'm')}${fz('nichtNutzbarM2', 'Nicht nutzbare Flächen', 'm²')}${fz('zufahrtM2', 'Zufahrt, Rangieren, Wartung (Gesamtfläche)', 'm²')}${fz('feuerwehrM2', 'Feuerwehrzufahrt und Brandschutz', 'm²')}${fz('nebenanlagenM2', 'Nebenanlagen gesamt inkl. Trafostation, Schaltanlage und Netzanschluss', 'm²')}</div></fieldset>
<fieldset class="fgroup"><legend>Netzanschluss</legend><div class="fgrid">${fz('netzMW', 'Verfügbare Netzanschlussleistung', 'MW')}${fz('einspeiseMW', 'Max. Einspeiseleistung', 'MW')}${fz('bezugMW', 'Max. Bezugsleistung', 'MW')}</div></fieldset>
<fieldset class="fgroup"><legend>Einschränkungen</legend><div class="fgrid">${[['gelaende', 'Gelände'], ['entwaesserung', 'Entwässerung'], ['erschliessung', 'Erschließung']].map(([k, l]) => html`<label class="fld"><span>${l}</span><input name="g.${k}" value="${g[k] || ''}" maxlength="400"></label>`)}</div></fieldset>
<fieldset class="fgroup"><legend>Status und Quelle der Angaben</legend><div class="fgrid">${angabe('flaeche', 'Fläche')}${angabe('geometrie', 'Geometrie')}${angabe('abstaende', 'Abstände')}${angabe('netz', 'Netzanschluss')}</div></fieldset>
${speicherLeiste(stand, 'grundstueck')}</form></section>
<div class="grid-2"><section class="panel"><h2>Flächenbilanz</h2>
<table class="tbl tbl-num tbl-compact"><tbody>${zeile('Grundstück', b.brutto)}${zeile('− Grenzabstand', b.abzug.grenzabstand)}${zeile('− Nicht nutzbar', b.abzug.nichtNutzbar)}${zeile('− Zufahrt, Rangieren, Wartung', b.abzug.zufahrt)}${zeile('− Feuerwehr und Brandschutz', b.abzug.feuerwehr)}${zeile('− Trafostation, Schaltanlage, Netzanschluss', b.abzug.nebenanlagen)}${zeile('Verbleibend für Speicherblöcke und Stationen', b.fuerBloecke, 'ip-summe')}</tbody></table>
${b.hinweise.map((x) => html`<p class="small muted">${x}</p>`)}
<h3>Grundsätzlich in Betracht kommende Konfigurationen</h3><ul class="assume">${rs.filter((r) => r.dim && !r.fehler?.length).map((r) => html`<li>${r.v.name} (${n1(r.v.leistungMW)} MW / ${n1(r.v.kapazitaetMWh)} MWh): ${r.dim.rest >= 0 && r.dim.layout.passt ? html`<span class="mark mark-ok">passt rechnerisch</span> Reserve ${n0(r.dim.rest)} m²` : html`<span class="mark mark-warn">passt nicht</span> ${r.dim.rest < 0 ? `Fehlbetrag ${n0(-r.dim.rest)} m²` : `nur ${r.dim.layout.plaetze} von ${r.dim.bloecke} Blöcken in der Anordnung`}`}</li>`)}</ul></section>
<section class="panel"><h2>Für eine belastbarere Vorplanung fehlt</h2>${b.fehlend.length ? html`<ul class="assume">${b.fehlend.map((x) => html`<li>${x}</li>`)}</ul>` : html`<p>Alle Angaben erfasst und bestätigt.</p>`}
${rs[0]?.dim?.bilanz ? draufsicht(rs[0], rs[0].v.name) : ''}</section></div>`;
}

function schrittTechnik(db, s, p, stand, rs) {
  const katalog = IP.aktuelleSysteme(db.planerKatalog);
  const vs = [...stand.varianten]; while (vs.length < 4) vs.push({ key: VAR_KEYS[vs.length], name: '', leistungMW: null, kapazitaetMWh: null, erloesQuelle: 'wm' });
  return html`<section class="panel"><h2>Varianten</h2><p class="small muted">Vergleichsszenarien, keine Vorgabe für eine konkrete Anlage. Leere Zeilen werden nicht gespeichert. Erlösannahmen: ${Object.values(IP.ERLOES_QUELLEN).join(' · ')}.</p>
<form method="post" action="/portal/anlagenplanung/${p.id}/speichern" class="calc-form">${csrf(s)}
<div class="tbl-wrap"><table class="tbl tbl-compact ip-eingabe"><thead><tr><th>Name</th><th>Speichersystem</th><th class="num">Leistung MW</th><th class="num">Kapazität MWh nutzbar</th><th>Erlösannahme</th></tr></thead><tbody>
${vs.map((v) => html`<tr><td data-l="Name"><input name="v.${v.key}.name" value="${v.name}" aria-label="Name Variante ${v.key}"></td>
<td data-l="Speichersystem"><select name="v.${v.key}.system" aria-label="System Variante ${v.key}">${katalog.map((x) => html`<option value="${x.systemId}"${v.systemRef?.systemId === x.systemId ? raw(' selected') : ''}>${x.produkt}${/^Platzhalter/.test(x.hersteller) ? '' : ` · ${x.hersteller}`} (V${x.version}${v.systemRef?.systemId === x.systemId && v.systemRef.version !== x.version ? `, Stand nutzt V${v.systemRef.version}` : ''})</option>`)}</select>
${v.systemRef && katalog.find((x) => x.systemId === v.systemRef.systemId)?.version !== v.systemRef.version ? html`<label class="small"><input type="checkbox" name="v.${v.key}.systemNeu" value="ja"> neue Katalogversion übernehmen</label>` : ''}</td>
<td data-l="Leistung MW"><input class="num" inputmode="decimal" name="v.${v.key}.mw" value="${v.leistungMW == null ? '' : num(v.leistungMW, 2)}" aria-label="Leistung Variante ${v.key}"></td>
<td data-l="Kapazität MWh"><input class="num" inputmode="decimal" name="v.${v.key}.mwh" value="${v.kapazitaetMWh == null ? '' : num(v.kapazitaetMWh, 2)}" aria-label="Kapazität Variante ${v.key}"></td>
<td data-l="Erlösannahme"><select name="v.${v.key}.erloes" aria-label="Erlösannahme Variante ${v.key}">${Object.entries(ERLOES_KURZ).map(([k, n]) => html`<option value="${k}" title="${IP.ERLOES_QUELLEN[k]}"${v.erloesQuelle === k ? raw(' selected') : ''}>${n}</option>`)}</select></td></tr>`)}
</tbody></table></div>
<fieldset class="fgroup"><legend>Planungsannahmen</legend><div class="fgrid">${IP.ANNAHMEN_FELDER.map(([k, l, e, art]) => html`<label class="fld"><span>${l}${e ? html` <em>${e}</em>` : ''}</span><input class="num" inputmode="decimal" name="a.${k}" value="${art === 'prozent' ? num(stand.annahmen[k] * 100, 2) : num(stand.annahmen[k], 2)}"></label>`)}
<label class="fld"><span>Betriebskosten aus STROMKAI-WM</span><select name="a.opexSkalierung"><option value="skaliert"${stand.annahmen.opexSkalierung !== 'unveraendert' ? raw(' selected') : ''}>Kapazitätsabhängige Posten skalieren</option><option value="unveraendert"${stand.annahmen.opexSkalierung === 'unveraendert' ? raw(' selected') : ''}>Unverändert übernehmen</option></select><small>Wartung, Versicherung, Monitoring, Ersatzteile, Rückbau nach nutzbarer MWh; Netz/Messung nach MW; Pacht und IT fix</small></label></div>
<p class="small muted">${stand.annahmen.quelle}</p></fieldset>
${speicherLeiste(stand, 'technik')}</form></section>
${rs.map((r) => r.fehler?.length && !r.dim?.bloecke ? html`<section class="panel"><h2>${r.v.name}</h2><div class="alert">${r.fehler.join(' ')}</div></section>` : html`<section class="panel"><div class="panel-head"><h2>${r.v.name}: ${n1(r.v.leistungMW)} MW / ${n1(r.v.kapazitaetMWh)} MWh</h2><span class="small muted">${r.sys.produkt} · ${r.sys.hersteller} V${r.sys.version} ${mark(r.sys.datenstatus)}</span></div>
<div class="grid-2"><div><table class="tbl tbl-num tbl-compact"><tbody>
<tr><th scope="row">Speicherblöcke</th><td class="num">${r.dim.bloecke}</td></tr>
<tr><th scope="row">Kapazität nutzbar / nominal</th><td class="num">${n1(r.dim.kapNutzbar)} / ${n1(r.dim.kapNominal)} MWh</td></tr>
<tr><th scope="row">Lade-/Entladeleistung der Blöcke</th><td class="num">${n1(r.dim.leistungBloecke)} MW</td></tr>
<tr><th scope="row">Wechselrichter (PCS)</th><td class="num">${n1(r.dim.pcsMW)} MW</td></tr>
<tr><th scope="row">Transformatoren (Vorplanung)</th><td class="num">${r.dim.trafos} × ${n1(stand.annahmen.mvaJeTrafo)} MVA (${n1(r.dim.mva)} MVA)</td></tr>
<tr><th scope="row">Schaltanlage / Übergabestation</th><td class="num">${r.dim.schaltanlagen}</td></tr>
<tr><th scope="row">Netzanschlussbedarf</th><td class="num">${n1(r.dim.netzBedarfMW)} MW${r.dim.netzGrenze != null ? ` (verfügbar ${n1(r.dim.netzGrenze)} MW)` : ' (verfügbar unbekannt)'}</td></tr>
<tr><th scope="row">Vermarktbare Einspeisung</th><td class="num">${n1(r.dim.einspeise)} MW · ${n1(r.dim.dauerH)} h</td></tr>
<tr><th scope="row">Stellfläche Blöcke inkl. Abstände</th><td class="num">${n0(r.dim.flaecheBloecke)} m²</td></tr>
<tr><th scope="row">Stellfläche Stationen</th><td class="num">${n0(r.dim.flaecheStationen)} m²</td></tr>
<tr class="ip-summe"><th scope="row">Verbleibende Fläche</th><td class="num">${n0(r.dim.rest)} m²</td></tr></tbody></table>
${meldungen(r.dim.meldungen)}</div>${draufsicht(r, r.v.name)}</div></section>`)}`;
}

function schrittKosten(db, s, p, stand, rs, r) {
  if (!r?.pos) return html`<section class="panel">${varTabs(p, stand, 'kosten', r?.v.key)}<div class="alert">${(r?.fehler || ['Keine Variante']).join(' ')}</div></section>`;
  const angebote = db.planerAngebote.filter((a) => a.projectId === p.id);
  const f = r.finErg;
  const summen = [['Positionen 1–16, 19', r.basisSumme], ['17 Finanzierungskosten der Bauphase (berechnet)', f?.bauzeitzinsen], [`18 Reserve (${pct(stand.annahmen.reserveAnteil)} von Positionen 1–17)`, f?.reserve], ['Gesamtinvestition', f?.gesamt]];
  return html`<section class="panel"><div class="panel-head"><h2>Kostenstruktur ${r.v.name}</h2>${varTabs(p, stand, 'kosten', r.v.key)}</div>
<p class="small muted">Mengen aus der Konfiguration (${r.dim.bloecke} Blöcke, ${n0(r.dim.kapNutzbar * 1000)} kWh nutzbar, ${n1(r.dim.pcsMW)} MW). Überschriebene Werte brauchen eine Begründung und bleiben mit Herkunft sichtbar. Betriebskosten, Netz-/Messkosten, Degradation und Batterieverschleiß gehören nicht hierher; sie stehen in STROMKAI-WM.</p>
<form method="post" action="/portal/anlagenplanung/${p.id}/speichern" class="calc-form">${csrf(s)}
<div class="tbl-wrap"><table class="tbl tbl-compact ip-kosten"><thead><tr><th>Position</th><th class="num">Menge</th><th class="num">Einzelpreis EUR</th><th class="num">Gesamt</th><th>Datenstatus</th><th>Quelle, Preisstand, Lieferant</th><th>WM-Position</th></tr></thead><tbody>
${r.pos.map((x) => html`<tr${x.ueberschrieben ? raw(' class="ip-geaendert"') : ''}><th scope="row">${x.nr} ${x.name}${x.angebotId ? html`<br><span class="mark mark-ok">Angebot</span>` : ''}${x.geaendertVon ? html`<br><span class="small muted">geändert ${x.geaendertVon}, ${fmtDateTime(x.geaendertAm)}</span>` : ''}</th>
<td data-l="Menge"><input class="num" inputmode="decimal" name="k.${x.nr}.menge" value="${num(x.menge, x.einheit === 'kWh' ? 0 : 2)}" aria-label="Menge Position ${x.nr}"><input type="hidden" name="k.${x.nr}.mengeAlt" value="${num(x.menge, x.einheit === 'kWh' ? 0 : 2)}"><span class="small muted">${x.einheit}${x.menge !== x.mengeAbgeleitet ? ` (abgeleitet ${num(x.mengeAbgeleitet, 2)})` : ''}</span></td>
<td data-l="Einzelpreis"><input class="num" inputmode="decimal" name="k.${x.nr}.preis" value="${x.einzelpreis == null ? '' : num(x.einzelpreis, 2)}" aria-label="Einzelpreis Position ${x.nr}"><input type="hidden" name="k.${x.nr}.preisAlt" value="${x.einzelpreis == null ? '' : num(x.einzelpreis, 2)}"></td>
<td class="num" data-l="Gesamt">${x.datenstatus === 'enthalten' ? html`<span class="small">in Pos. ${x.enthaltenIn}</span>` : eur(x.gesamt, true)}</td>
<td data-l="Datenstatus"><select name="k.${x.nr}.status" aria-label="Datenstatus Position ${x.nr}">${Object.entries(IP.DATENSTATUS).filter(([k]) => !['berechnet', 'freigegeben'].includes(k)).map(([k, v]) => html`<option value="${k}"${x.datenstatus === k ? raw(' selected') : ''}>${v.name}</option>`)}</select><input type="hidden" name="k.${x.nr}.statusAlt" value="${x.datenstatus}">
<input class="num ip-klein" name="k.${x.nr}.enthaltenIn" value="${x.enthaltenIn || ''}" placeholder="enthalten in Pos." aria-label="Enthalten in Position"></td>
<td data-l="Quelle">${['quelle', 'preisstand', 'lieferant', 'ausschreibung'].map((k) => html`<input name="k.${x.nr}.${k}" value="${x[k] || ''}" placeholder="${{ quelle: 'Quelle', preisstand: 'Preisstand', lieferant: 'Hersteller/Lieferant', ausschreibung: 'Ausschreibungsposition' }[k]}" aria-label="${k} Position ${x.nr}"><input type="hidden" name="k.${x.nr}.${k}Alt" value="${x[k] || ''}">`)}
<input name="k.${x.nr}.begruendung" placeholder="Begründung der Änderung" aria-label="Begründung Position ${x.nr}"></td>
<td data-l="WM-Position" class="small">${WM.CAPEX_POSTEN.find(([k]) => k === x.wm)?.[1]}</td></tr>`)}
</tbody></table></div>
<p class="small muted">Geänderte Felder werden beim Speichern erkannt: Menge und Preis gelten als Überschreibung, sobald sie vom angezeigten Wert abweichen.</p>
${speicherLeiste(stand, 'kosten', r.v.key)}</form></section>
<div class="grid-2"><section class="panel"><h2>Summen ${r.v.name}</h2><table class="tbl tbl-num tbl-compact"><tbody>${summen.map(([l, v], i) => html`<tr${i === 3 ? raw(' class="ip-summe"') : ''}><th scope="row">${l}</th><td class="num">${eur(v, true)}</td></tr>`)}
<tr><th scope="row">Investition je kWh nutzbar</th><td class="num">${eur(f?.gesamt / (r.dim.kapNutzbar * 1000))}</td></tr><tr><th scope="row">Investition je MW</th><td class="num">${eur(f?.gesamt / r.dim.pcsMW, true)}</td></tr></tbody></table>
<h3>Belastbarkeit der Positionen 1–16, 19</h3><table class="tbl tbl-num tbl-compact"><tbody>${Object.entries(r.anteile).filter(([, v]) => v > 0).map(([k, v]) => html`<tr><th scope="row">${mark(k)}</th><td class="num">${eur(v, true)}</td><td class="num">${pct(v / r.basisSumme)}</td></tr>`)}</tbody></table>
${r.pos.some((x) => x.datenstatus === 'fehlt') ? html`<p class="small bad">Nicht bepreist: ${r.pos.filter((x) => x.datenstatus === 'fehlt').map((x) => `${x.nr} ${x.name}`).join(', ')}. Die Summe ist dadurch zu niedrig.</p>` : ''}
<div class="notice-info small"><strong>Bekannter Konflikt (KLÄRUNGSBEDARF):</strong> Kostenplan und Kostenmodell weisen unterschiedliche fixe Betriebskosten aus. Der Planer übernimmt keinen der Werte; die Betriebskosten stammen unverändert aus der STROMKAI-WM-Version des Projekts.</div></section>
<section class="panel"><h2>Angebote</h2><p class="small muted">Interne Angebote (nie für Eigentümer oder Investoren sichtbar). Ein Angebot ersetzt den Standardwert der Position erst nach dokumentierter Auswahl; der vorherige Stand bleibt als Version erhalten.</p>
${[...new Set(angebote.map((a) => a.positionNr))].sort((a, b) => a - b).map((nr) => { const as = angebote.filter((a) => a.positionNr === nr).sort((a, b) => a.einzelpreis - b.einzelpreis); const gew = r.pos.find((x) => x.nr === nr)?.angebotId;
  return html`<h3>${nr} ${IP.POSITIONEN.find((x) => x.nr === nr).name}</h3><table class="tbl tbl-num tbl-compact"><thead><tr><th>Lieferant</th><th class="num">Einzelpreis</th><th>Datum</th><th>Dokument</th><th></th></tr></thead><tbody>
${as.map((a, i) => html`<tr><th scope="row">${a.lieferant}${i === 0 && as.length > 1 ? html` <span class="mark mark-info">günstigstes</span>` : ''}</th><td class="num">${num(a.einzelpreis, 2)} ${a.einheit || ''}</td><td>${a.datum}${a.gueltigBis ? ` bis ${a.gueltigBis}` : ''}</td><td class="small">${a.dokumentRef || '–'}</td>
<td>${gew === a.id ? html`<span class="mark mark-ok">gewählt für ${r.v.name}</span>` : stand.status === 'freigegeben' ? '' : html`<form method="post" action="/portal/anlagenplanung/${p.id}/angebot-waehlen" class="stack-inline">${csrf(s)}<input type="hidden" name="v" value="${stand.id || ''}"><input type="hidden" name="var" value="${r.v.key}"><input type="hidden" name="angebotId" value="${a.id}"><input name="begruendung" placeholder="Begründung der Auswahl" required aria-label="Begründung"><button class="btn btn-small" type="submit">Für ${r.v.name} wählen</button></form>`}</td></tr>`)}</tbody></table>`; })}
<details${angebote.length ? '' : raw(' open')}><summary>Angebot erfassen</summary><form method="post" action="/portal/anlagenplanung/${p.id}/angebot" class="stack">${csrf(s)}<input type="hidden" name="v" value="${stand.id || ''}"><input type="hidden" name="var" value="${r.v.key}">
<label>Kostenposition<select name="positionNr">${IP.POSITIONEN.filter((x) => x.nr !== 17 && x.nr !== 18).map((x) => html`<option value="${x.nr}">${x.nr} ${x.name}</option>`)}</select></label>
<label>Lieferant<input name="lieferant" required></label><label>Einzelpreis EUR<input name="einzelpreis" class="num" inputmode="decimal" required></label><label>Einheit<input name="einheit" placeholder="z. B. kWh, MW, pauschal"></label>
<label>Angebotsdatum<input type="date" name="datum" required></label><label>Gültig bis<input type="date" name="gueltigBis"></label><label>Dokumentreferenz<input name="dokumentRef"></label><label>Notiz<input name="notiz"></label>
<button class="btn" type="submit">Angebot erfassen</button></form></details></section></div>`;
}

function schrittFinanzierung(s, p, stand, rs, r) {
  const fin = stand.finanzierung, f = r?.finErg;
  const tr = [...fin.tranchen]; while (tr.length < 3) tr.push({ name: '', anteil: null, zins: null, laufzeitJahre: null, tilgungsfreiJahre: 0, modell: 'annuitaet', gebuehrAnteil: 0 });
  const ab = [...fin.abrufplan]; while (ab.length < 4) ab.push({ monat: null, anteil: null });
  const pz = (v) => (v == null ? '' : num(v * 100, 2));
  return html`<section class="panel"><div class="panel-head"><h2>Finanzierungsparameter ${p.code}</h2><span class="mark ${fin.status === 'zugesagt' ? 'mark-ok' : 'mark-warn'}">${IP.FIN_STATUS[fin.status]}</span></div>
<p class="small muted">Gelten für alle Varianten dieses Projekts. Konditionen sind ${fin.status === 'zugesagt' ? `laut Zusage ${fin.zusageRef}` : 'Annahmen, keine zugesagten Bankkonditionen'}.</p>
<form method="post" action="/portal/anlagenplanung/${p.id}/speichern" class="calc-form">${csrf(s)}
<fieldset class="fgroup"><legend>Kapitalstruktur und Bauphase</legend><div class="fgrid">
<label class="fld"><span>Fremdkapitalanteil <em>%</em></span><input class="num" name="f.fkAnteil" value="${pz(fin.fkAnteil)}"></label>
<label class="fld"><span>Bauzeit <em>Monate</em></span><input class="num" name="f.bauzeitMonate" value="${fin.bauzeitMonate}"></label>
<label class="fld"><span>Schuldendienstreserve <em>Monate</em></span><input class="num" name="f.dsraMonate" value="${fin.dsraMonate}"></label>
<label class="fld"><span>Status der Konditionen</span><select name="f.status">${Object.entries(IP.FIN_STATUS).map(([k, n]) => html`<option value="${k}"${fin.status === k ? raw(' selected') : ''}>${n}</option>`)}</select></label>
<label class="fld"><span>Zusage-/Angebotsreferenz</span><input name="f.zusageRef" value="${fin.zusageRef || ''}"></label>
<label class="fld ip-breit"><span>Quelle</span><input name="f.quelle" value="${fin.quelle || ''}"></label></div></fieldset>
<fieldset class="fgroup"><legend>Auszahlungsplan (Anteil der Investition je Abrufmonat ab Baubeginn)</legend><div class="fgrid">${ab.map((x, i) => html`<label class="fld"><span>Abruf ${i + 1}: Monat</span><input class="num" name="f.abruf.${i}.monat" value="${x.monat ?? ''}"></label><label class="fld"><span>Anteil <em>%</em></span><input class="num" name="f.abruf.${i}.anteil" value="${pz(x.anteil)}"></label>`)}</div></fieldset>
<fieldset class="fgroup"><legend>Darlehenstranchen</legend><div class="tbl-wrap"><table class="tbl tbl-compact ip-eingabe"><thead><tr><th>Name</th><th class="num">Anteil am FK %</th><th class="num">Zins %</th><th class="num">Laufzeit J.</th><th class="num">Tilgungsfrei J.</th><th>Tilgung</th><th class="num">Gebühren % des Kredits</th></tr></thead><tbody>
${tr.map((t, i) => html`<tr><td data-l="Name"><input name="f.t.${i}.name" value="${t.name}" aria-label="Name Tranche ${i + 1}"></td><td data-l="Anteil"><input class="num" name="f.t.${i}.anteil" value="${pz(t.anteil)}" aria-label="Anteil Tranche ${i + 1}"></td><td data-l="Zins"><input class="num" name="f.t.${i}.zins" value="${pz(t.zins)}" aria-label="Zins Tranche ${i + 1}"></td>
<td data-l="Laufzeit"><input class="num" name="f.t.${i}.laufzeit" value="${t.laufzeitJahre ?? ''}" aria-label="Laufzeit Tranche ${i + 1}"></td><td data-l="Tilgungsfrei"><input class="num" name="f.t.${i}.frei" value="${t.tilgungsfreiJahre ?? 0}" aria-label="Tilgungsfreie Jahre Tranche ${i + 1}"></td>
<td data-l="Tilgung"><select name="f.t.${i}.modell" aria-label="Tilgungsmodell Tranche ${i + 1}">${Object.entries(IP.TILGUNGSMODELLE).map(([k, n]) => html`<option value="${k}"${t.modell === k ? raw(' selected') : ''}>${n}</option>`)}</select></td><td data-l="Gebühren"><input class="num" name="f.t.${i}.gebuehr" value="${pz(t.gebuehrAnteil)}" aria-label="Gebühren Tranche ${i + 1}"></td></tr>`)}</tbody></table></div></fieldset>
${speicherLeiste(stand, 'finanzierung', r?.v.key)}</form></section>
${f ? html`<section class="panel"><div class="panel-head"><h2>Finanzierungsbedarf ${r.v.name}</h2>${varTabs(p, stand, 'finanzierung', r.v.key)}</div>
<dl class="kv kv-4"><div><dt>Gesamt-CAPEX</dt><dd>${eur(f.gesamt, true)}</dd></div><div><dt>Fremdkapital</dt><dd>${eur(f.fk, true)}</dd></div><div><dt>Eigenkapital (vor DSRA)</dt><dd>${eur(f.ekBedarfVorDSRA, true)}</dd></div><div><dt>Bauzeitzinsen</dt><dd>${eur(f.bauzeitzinsen, true)}</dd></div>
<div><dt>Gebühren</dt><dd>${eur(f.gebuehren, true)}</dd></div><div><dt>Zinsaufwand Betrieb</dt><dd>${eur(f.zinsaufwand, true)}</dd></div><div><dt>Max. Schuldendienst p. a.</dt><dd>${eur(f.schuldendienstMax, true)}</dd></div><div><dt>Gewichteter Zins</dt><dd>${pct(f.zinsBau, 2)}</dd></div></dl>
<p class="small muted">Eigenkapitalbedarf einschließlich Schuldendienstreserve und DSCR rechnet STROMKAI-WM (Schritt 5).</p>
<div class="grid-2"><div><h3>Liquiditätsverlauf Bauphase</h3><table class="tbl tbl-num tbl-compact"><thead><tr><th>Monat</th><th class="num">Abruf</th><th class="num">davon EK</th><th class="num">davon FK</th><th class="num">kumuliert</th></tr></thead><tbody>${f.bauphase.map((x) => html`<tr><td>${x.monat}</td><td class="num">${eur(x.betrag, true)}</td><td class="num">${eur(x.ek, true)}</td><td class="num">${eur(x.fk, true)}</td><td class="num">${eur(x.kumuliert, true)}</td></tr>`)}
<tr><td>Inbetriebnahme</td><td class="num">${eur(f.bauzeitzinsen, true)}</td><td class="num">–</td><td class="num">${eur(f.bauzeitzinsen * stand.finanzierung.fkAnteil, true)}</td><td class="num">${eur(f.gesamt, true)}</td></tr></tbody></table></div>
<div><h3>Tilgungsplan</h3><div class="tbl-wrap"><table class="tbl tbl-num tbl-compact"><thead><tr><th>Jahr</th><th class="num">Zinsen</th><th class="num">Tilgung</th><th class="num">Schuldendienst</th><th class="num">Restschuld</th></tr></thead><tbody>${f.jahre.map((x) => html`<tr><td>${x.jahr}</td><td class="num">${eur(x.zinsen, true)}</td><td class="num">${eur(x.tilgung, true)}</td><td class="num">${eur(x.schuldendienst, true)}</td><td class="num">${eur(x.restschuld, true)}</td></tr>`)}</tbody></table></div></div></div></section>` : html`<section class="panel"><div class="alert">${(r?.fehler || []).join(' ')}</div></section>`}`;
}

const kz = (k) => [['Gesamtinvestition', eur(k.gesamtinvestition, true)], ['Eigenkapitalbedarf', eur(k.eigenkapitalbedarf, true)], ['Fremdkapital', eur(k.fremdkapital, true)], ['Betriebskosten Jahr 1', eur(k.betriebskostenJahr1, true)], ['Bruttoerlöse Jahr 1', eur(k.bruttoerloeseJahr1, true)], ['EBITDA Jahr 1', eur(k.ebitdaJahr1, true)], ['Schuldendienst p. a. (max.)', eur(k.schuldendienstJahr, true)], ['DSCR minimal', k.dscrMin == null ? '–' : num(k.dscrMin, 2)], ['Kapitalwert', eur(k.kapitalwert, true)], ['Projekt-IRR', pct(k.projektIRR)], ['Eigenkapital-IRR', pct(k.eigenkapitalIRR)], ['Amortisation', k.amortisationJahre == null ? 'nicht erreicht' : `${num(k.amortisationJahre, 1)} Jahre`]];
function datenstand(r, ex) {
  const ref = r.referenz && !r.referenz.fehler ? r.referenz : null;
  const gewaehlteQuelle = IP.ERLOES_QUELLEN[r.v.erloesQuelle] || IP.ERLOES_QUELLEN.wm;
  const tatsaechlicheQuelle = IP.ERLOES_QUELLEN[r.erloesQuelleTatsaechlich || 'wm'];
  const fallback = r.v.erloesQuelle?.startsWith('b2_') && r.erloesQuelleTatsaechlich === 'wm';
  return html`<p class="small muted">Erlösquelle gewählt: ${gewaehlteQuelle} · Tatsächlich verwendet: ${tatsaechlicheQuelle}${fallback ? ' (Fallback, da keine passende B2-Referenz vorliegt)' : ''}${ref ? html` · Strategie ${ref.strategie} (Referenz; KI-Vorteil nicht belegt) · Simulationsanlage ${ref.anlage} · Zeitraum ${ref.periode} (29.10.2024–28.10.2026) · Datenversion ${ex?.datenversion || '–'}` : ''} · Anlage ${n1(r.dim.einspeise)} MW / ${n1(r.dim.kapNutzbar)} MWh nutzbar · Modell ${WM.MODELL_VERSION}. Historische Simulationen sind keine garantierten Zukunftserlöse.</p>`;
}
function schrittWirtschaft(db, u, s, p, stand, rs, r) {
  const ex = exportDaten();
  const b = basisWM(db, p.id);
  const uebergaben = db.finanzmodelle.filter((x) => x.projectId === p.id && x.planerRef).sort((a, c) => c.version - a.version);
  if (!r?.wm) return html`<section class="panel">${varTabs(p, stand, 'wirtschaftlichkeit', r?.v.key)}<div class="alert">${[...(r?.fehler || []), ...(r?.hinweise || []), ...(r?.wmFehler || [])].join(' ') || 'Keine Berechnung möglich.'}</div></section>`;
  return html`<section class="panel"><div class="panel-head"><h2>Wirtschaftliche Modellrechnung ${r.v.name}</h2>${varTabs(p, stand, 'wirtschaftlichkeit', r.v.key)}</div>
<div class="ip-ebenen"><span class="mark mark-info">Technische Vorplanung</span> <span class="mark mark-warn">Wirtschaftliche Modellrechnung</span> ${stand.status === 'freigegeben' ? html`<span class="mark mark-ok">Freigegebene Investitionsgrundlage</span>` : html`<span class="mark mark-aud">Keine belegte Investitionsgrundlage</span>`}</div>
<p class="small">Berechnet mit STROMKAI-WM (${WM.MODELL_VERSION}). Betriebskosten, Bewertung und – je nach Erlösannahme – Erlöse aus WM-Version V${b?.version} des Projekts${b?.synthetisch ? ' (synthetisch)' : ''}; Technik, Investition und Finanzierungsplan aus diesem Planungsstand.</p>
${datenstand(r, ex)}${r.hinweise.map((x) => html`<p class="small bad">${x}</p>`)}
<div class="tbl-wrap"><table class="tbl tbl-num"><thead><tr><th>Kennzahl</th>${Object.values(r.wm).map((x) => html`<th class="num">${x.meta.szenarioName}</th>`)}</tr></thead><tbody>
${kz(r.wm.basis.kennzahlen).map(([l], i) => html`<tr><th scope="row">${l}</th>${Object.values(r.wm).map((x) => html`<td class="num">${kz(x.kennzahlen)[i][1]}</td>`)}</tr>`)}</tbody></table></div>
<h3>Netzentgelt-Szenarien (Basis, Erlöse aus Backtest B2)</h3>
<table class="tbl tbl-num tbl-compact"><thead><tr><th>Szenario</th><th class="num">Bruttoerlöse J1</th><th class="num">Variable Handelskosten J1</th><th class="num">EBITDA J1</th><th class="num">DSCR min</th><th class="num">Kapitalwert</th><th class="num">Projekt-IRR</th></tr></thead><tbody>
${[['A', 'A „befreit“ – vorläufig, Befreiung nicht gesichert'], ['B', 'B „ohne Befreiung“ – nur Arbeitspreis; Leistungspreis fehlt']].map(([k, l]) => { const x = r.netz?.[k]; if (!x || x.fehler) return html`<tr><th scope="row">${l}</th><td colspan="6" class="small">${x?.fehler || '–'}</td></tr>`; const kk = x.wm.kennzahlen; const var1 = x.wm.jahre[0].opexPosten.find((o) => o.key === 'variabel')?.betrag;
  return html`<tr><th scope="row">${l}</th><td class="num">${eur(kk.bruttoerloeseJahr1, true)}</td><td class="num">${eur(var1, true)}</td><td class="num">${eur(kk.ebitdaJahr1, true)}</td><td class="num">${kk.dscrMin == null ? '–' : num(kk.dscrMin, 2)}</td><td class="num">${eur(kk.kapitalwert, true)}</td><td class="num">${pct(kk.projektIRR)}</td></tr>`; })}</tbody></table>
<p class="small muted">Netzentgelt B enthält nur den Arbeitspreisanteil aus dem Trading-Export. Der Leistungspreis ist nicht quantifiziert und nicht mit null angesetzt, sondern fehlt (Ergebnis B zu günstig). Rechtsannahme zur Befreiung (A) ist nicht bestätigt.</p>
${stand.id && stand.status !== 'entwurf' ? html`<form method="post" action="/portal/anlagenplanung/${p.id}/wm" class="stack-inline">${csrf(s)}<input type="hidden" name="v" value="${stand.id}"><input type="hidden" name="var" value="${r.v.key}"><button class="btn btn-primary" type="submit">${r.v.name} an STROMKAI-WM übergeben</button><span class="small muted">legt in der Projektakte Wirtschaftlichkeit eine neue Berechnungsversion an</span></form>` : html`<p class="small muted">Zum Übergeben zuerst den Stand speichern.</p>`}</section>
${uebergaben.length ? html`<section class="panel"><h2>Übergaben an STROMKAI-WM</h2><table class="tbl tbl-compact"><thead><tr><th>WM-Version</th><th>Planungsstand</th><th>Variante</th><th class="num">Kapitalwert Basis</th><th>Zeitpunkt</th></tr></thead><tbody>${uebergaben.map((x) => html`<tr><td><a href="/portal/wirtschaftlichkeit/${p.id}?v=${x.id}">V${x.version}</a></td><td>V${x.planerRef.version}</td><td>${x.planerRef.variante}</td><td class="num">${eur(x.ergebnis.basis.kennzahlen.kapitalwert, true)}</td><td>${fmtDateTime(x.erstelltAm)}</td></tr>`)}</tbody></table></section>` : ''}`;
}

function risiken(r, stand) {
  const out = [];
  if (r.dim.netzGrenze == null) out.push('Netzanschlussleistung unbekannt');
  else if (r.dim.einspeise < r.v.leistungMW) out.push(`Netz begrenzt Einspeisung auf ${n1(r.dim.einspeise)} MW`);
  if (r.dim.bezug < r.v.leistungMW) out.push(`Netz begrenzt Bezug auf ${n1(r.dim.bezug)} MW`);
  if (r.wirtschaftlichkeitSperre) out.push(r.wirtschaftlichkeitSperre);
  if (r.v.erloesQuelle?.startsWith('b2_') && r.erloesQuelleTatsaechlich === 'wm') out.push('B2-Referenz nicht anwendbar; tatsächlich WM-Erlösannahmen');
  if (r.dim.rest < 0 || !r.dim.layout.passt) out.push('Passt nicht auf die Fläche');
  const ph = r.anteile.platzhalter + r.anteile.fehlt;
  if (ph > 0) out.push(`${pct(ph / r.basisSumme, 0)} der Kosten Platzhalter oder fehlend`);
  if (stand.finanzierung.status !== 'zugesagt') out.push('Finanzierung nicht zugesagt');
  if (r.erloesQuelleTatsaechlich?.startsWith('b2_')) out.push('Erlöse aus historischer Simulation');
  if (r.wm && r.wm.konservativ.kennzahlen.kapitalwert < 0) out.push('Kapitalwert im konservativen Szenario negativ');
  if (r.wm && r.wm.basis.kennzahlen.dscrMin != null && r.wm.basis.kennzahlen.dscrMin < 1.2) out.push('DSCR im Basisszenario unter 1,2');
  return out;
}
function schrittVergleich(db, u, s, p, stand, rs) {
  const ok = rs.filter((r) => r.wm);
  const zeile = (l, f) => html`<tr><th scope="row">${l}</th>${rs.map((r) => html`<td class="num">${r.dim?.bloecke ? f(r) : '–'}</td>`)}</tr>`;
  const kzw = (sz, k, fmt) => (r) => (r.wm ? fmt(r.wm[sz].kennzahlen[k]) : '–');
  const offen = IP.flaechenbilanz(stand.grundstueck).fehlend;
  return html`<section class="panel"><div class="panel-head"><h2>Variantenvergleich</h2><div><a class="btn" href="/portal/anlagenplanung/${p.id}/export.csv${stand.id ? `?v=${stand.id}` : ''}">Tabelle (CSV)</a> <a class="btn" href="/portal/anlagenplanung/${p.id}/bericht${stand.id ? `?v=${stand.id}` : ''}">Kalkulationsbericht</a></div></div>
<p class="small">Keine Variante wird als „beste“ ausgewiesen. Ausschlaggebend sind Flächenreserve, Investition, Robustheit im konservativen Szenario und unter Netzentgelt B sowie die offenen Daten.</p>
<div class="tbl-wrap"><table class="tbl tbl-num tbl-compact ip-vergleich"><thead><tr><th>Kriterium</th>${rs.map((r) => html`<th class="num">${r.v.name}</th>`)}</tr></thead><tbody>
<tr class="ip-gruppe"><th colspan="${rs.length + 1}">Technische Vorplanung</th></tr>
${zeile('Anlage', (r) => `${n1(r.v.leistungMW)} MW / ${n1(r.v.kapazitaetMWh)} MWh`)}${zeile('Speichersystem', (r) => `${r.sys.produkt} V${r.sys.version}`)}${zeile('Blöcke', (r) => r.dim.bloecke)}${zeile('Vermarktbare Einspeisung', (r) => `${n1(r.dim.einspeise)} MW`)}
${zeile('Flächenreserve', (r) => (r.dim.rest >= 0 && r.dim.layout.passt ? `${n0(r.dim.rest)} m²` : 'passt nicht'))}
<tr class="ip-gruppe"><th colspan="${rs.length + 1}">Investition und Finanzierung</th></tr>
${zeile('Gesamtinvestition', (r) => eur(r.finErg?.gesamt, true))}${zeile('je kWh nutzbar', (r) => eur(r.finErg?.gesamt / (r.dim.kapNutzbar * 1000)))}${zeile('Eigenkapitalbedarf (WM)', kzw('basis', 'eigenkapitalbedarf', (x) => eur(x, true)))}${zeile('Fremdkapital', (r) => eur(r.finErg?.fk, true))}
${zeile('Anteil Platzhalter/fehlend', (r) => pct((r.anteile.platzhalter + r.anteile.fehlt) / r.basisSumme, 0))}${zeile('Schuldendienst p. a. (max.)', (r) => eur(r.finErg?.schuldendienstMax, true))}
<tr class="ip-gruppe"><th colspan="${rs.length + 1}">Wirtschaftliche Modellrechnung (STROMKAI-WM)</th></tr>
${zeile('Erlösquelle (tatsächlich)', (r) => (r.v.erloesQuelle?.startsWith('b2_') && r.erloesQuelleTatsaechlich === 'wm' ? 'WM-Annahmen (B2-Fallback)' : ({ wm: 'WM-Annahmen', b2_A: 'B2, Szen. A', b2_B: 'B2, Szen. B' }[r.erloesQuelleTatsaechlich || 'wm'])))}${zeile('Betriebskosten Jahr 1', kzw('basis', 'betriebskostenJahr1', (x) => eur(x, true)))}
${zeile('DSCR min (Basis)', kzw('basis', 'dscrMin', (x) => (x == null ? '–' : num(x, 2))))}${zeile('Kapitalwert konservativ', kzw('konservativ', 'kapitalwert', (x) => eur(x, true)))}${zeile('Kapitalwert Basis', kzw('basis', 'kapitalwert', (x) => eur(x, true)))}${zeile('Kapitalwert optimistisch', kzw('optimistisch', 'kapitalwert', (x) => eur(x, true)))}
${zeile('Projekt-IRR (Basis)', kzw('basis', 'projektIRR', (x) => pct(x)))}${zeile('Eigenkapital-IRR (Basis)', kzw('basis', 'eigenkapitalIRR', (x) => pct(x)))}${zeile('Amortisation (Basis)', kzw('basis', 'amortisationJahre', (x) => (x == null ? 'nicht erreicht' : `${num(x, 1)} J.`)))}
${zeile('Kapitalwert Netzentgelt A', (r) => (r.netz?.A?.wm ? eur(r.netz.A.wm.kennzahlen.kapitalwert, true) : 'keine Simulation'))}${zeile('Kapitalwert Netzentgelt B', (r) => (r.netz?.B?.wm ? eur(r.netz.B.wm.kennzahlen.kapitalwert, true) : 'keine Simulation'))}
<tr class="ip-gruppe"><th colspan="${rs.length + 1}">Risiken</th></tr><tr><th scope="row">Wesentliche Risiken</th>${rs.map((r) => html`<td class="small">${r.dim?.bloecke ? html`<ul class="assume">${risiken(r, stand).map((x) => html`<li>${x}</li>`)}</ul>` : '–'}</td>`)}</tr>
</tbody></table></div></section>
<div class="grid-2"><section class="panel"><h2>Vor einer verbindlichen Investitionsentscheidung fehlt</h2><ul class="assume">${offen.map((x) => html`<li>${x}</li>`)}
${[...new Set(ok.flatMap((r) => r.pos.filter((x) => ['fehlt', 'platzhalter'].includes(x.datenstatus)).map((x) => `${x.nr} ${x.name}`)))].map((x) => html`<li>Belastbarer Preis: ${x}</li>`)}
${stand.finanzierung.status !== 'zugesagt' ? html`<li>Finanzierungszusage</li>` : ''}<li>Netzentgelt: Befreiung (A) rechtlich bestätigen, Leistungspreis (B) quantifizieren</li><li>Fixe Betriebskosten: Konflikt Kostenplan / Kostenmodell klären</li><li>Herstellerdatenblätter statt Platzhalter im Katalog</li></ul></section>
<section class="panel"><h2>Freigabe</h2>${stand.status === 'freigegeben' ? html`<p><span class="mark mark-ok">Freigegeben</span> von ${stand.freigegebenVon} am ${fmtDateTime(stand.freigegebenAm)}. Dieser Stand ist unveränderlich; spätere Änderungen erzeugen neue Versionen.</p>`
  : P.isAdmin(u) && stand.id ? html`<p class="small">Die Freigabe zur Investitionsentscheidung friert diesen Stand als neue Version ein. Sie ist nur möglich, wenn keine Position mehr Platzhalter ist oder fehlt.</p><form method="post" action="/portal/anlagenplanung/${p.id}/freigeben">${csrf(s)}<input type="hidden" name="v" value="${stand.id}"><button class="btn" type="submit">Zur Investitionsentscheidung freigeben</button></form>`
  : html`<p class="small muted">Freigabe nur durch die Plattformadministration nach gespeichertem Stand.</p>`}</section></div>`;
}

// ---------- Export ----------
function csv(p, stand, rs) {
  const z = (x) => (x == null || !Number.isFinite(x) ? '' : String(Math.round(x * 100) / 100).replace('.', ','));
  const q = (x) => { const t = String(x ?? ''); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const L = [];
  L.push(['STROMKAI Anlagenplanung', `${p.code} ${p.name}`], ['Planungsstand', `V${stand.version || 0}`], ['Phase', IP.PHASEN[stand.phase].name], ['Status', stand.status], ['Prüfsumme', stand.pruefsumme || ''], ['Planer', IP.PLANER_VERSION], ['Wirtschaftlichkeit', WM.MODELL_VERSION], ['Hinweis', 'Vorplanung; keine Investitionsgrundlage, keine Finanzierungszusage'], []);
  L.push(['Kennzahl', ...rs.map((r) => r.v.name)]);
  const k = (sz, key) => rs.map((r) => z(r.wm?.[sz]?.kennzahlen?.[key]));
  L.push(['Leistung MW', ...rs.map((r) => z(r.v.leistungMW))], ['Kapazität nutzbar MWh', ...rs.map((r) => z(r.dim?.kapNutzbar))], ['Blöcke', ...rs.map((r) => r.dim?.bloecke ?? '')], ['Flächenreserve m²', ...rs.map((r) => z(r.dim?.rest))],
    ['Gesamtinvestition EUR', ...rs.map((r) => z(r.finErg?.gesamt))], ['Bauzeitzinsen EUR', ...rs.map((r) => z(r.finErg?.bauzeitzinsen))], ['Fremdkapital EUR', ...rs.map((r) => z(r.finErg?.fk))],
    ['Eigenkapitalbedarf EUR (WM)', ...k('basis', 'eigenkapitalbedarf')], ['DSCR min (Basis)', ...k('basis', 'dscrMin')], ['Kapitalwert konservativ EUR', ...k('konservativ', 'kapitalwert')], ['Kapitalwert Basis EUR', ...k('basis', 'kapitalwert')], ['Kapitalwert optimistisch EUR', ...k('optimistisch', 'kapitalwert')],
    ['Projekt-IRR Basis', ...k('basis', 'projektIRR')], ['Eigenkapital-IRR Basis', ...k('basis', 'eigenkapitalIRR')], ['Amortisation Basis Jahre', ...k('basis', 'amortisationJahre')], []);
  for (const r of rs) {
    if (!r.pos) continue;
    L.push([`Kosten ${r.v.name}`], ['Nr', 'Position', 'Menge', 'Einheit', 'Einzelpreis EUR', 'Gesamt EUR', 'Datenstatus', 'Quelle', 'Preisstand', 'Lieferant', 'Ausschreibungsposition', 'WM-Position']);
    for (const x of r.pos) L.push([x.nr, x.name, z(x.menge), x.einheit, z(x.einzelpreis), z(x.gesamt), IP.DATENSTATUS[x.datenstatus].name, x.quelle, x.preisstand, x.lieferant, x.ausschreibung, x.wm]);
    L.push([17, 'Finanzierungskosten der Bauphase', '', 'EUR', '', z(r.finErg?.bauzeitzinsen), 'Berechnet'], [18, 'Reserve', '', '%', z(stand.annahmen.reserveAnteil * 100), z(r.finErg?.reserve), 'Berechnet'], []);
  }
  return '﻿' + L.map((row) => row.map(q).join(';')).join('\r\n') + '\r\n';
}
function bericht(db, p, stand, rs) {
  const b = IP.flaechenbilanz(stand.grundstueck);
  return html`<section class="panel ip-bericht"><h2>Kalkulationsbericht ${p.code} – Planungsstand V${stand.version || 0}</h2>
<p class="small">${IP.PHASEN[stand.phase].name} · ${stand.status} · Prüfsumme ${stand.pruefsumme || '–'} · ${stand.erstelltAm ? fmtDateTime(stand.erstelltAm) : 'nicht gespeichert'} · ${IP.PLANER_VERSION} · ${WM.MODELL_VERSION}</p>
<p class="small"><strong>Vorplanung mit transparenten Annahmen.</strong> Keine genehmigungsfähige Fachplanung, kein Herstellerangebot, keine Finanzierungszusage, keine Anlageberatung. Historische Simulationen sind keine garantierten Erlöse.</p>
<h3>Grundstück</h3><p>${stand.grundstueck.bezeichnung}: ${n0(b.brutto)} m², verbleibend für Speicher und Stationen ${n0(b.fuerBloecke)} m²${b.rechteck ? '' : ' (Geometrie angenommen)'}; Netzanschluss ${stand.grundstueck.netzMW == null ? 'unbekannt' : `${n1(stand.grundstueck.netzMW)} MW`}.</p>
${rs.map((r) => r.pos ? html`<h3>${r.v.name}: ${n1(r.v.leistungMW)} MW / ${n1(r.v.kapazitaetMWh)} MWh</h3><p class="small">${r.sys.hersteller} ${r.sys.produkt} V${r.sys.version} (${IP.DATENSTATUS[r.sys.datenstatus].name}) · ${r.dim.bloecke} Blöcke · Reserve ${n0(r.dim.rest)} m² · Investition ${eur(r.finErg?.gesamt, true)} · Kapitalwert Basis ${r.wm ? eur(r.wm.basis.kennzahlen.kapitalwert, true) : '–'}</p>
<table class="tbl tbl-num tbl-compact"><thead><tr><th>Position</th><th class="num">Menge</th><th class="num">Einzelpreis</th><th class="num">Gesamt</th><th>Status und Quelle</th></tr></thead><tbody>${r.pos.map((x) => html`<tr><th scope="row">${x.nr} ${x.name}</th><td class="num">${num(x.menge, 2)} ${x.einheit}</td><td class="num">${x.einzelpreis == null ? '–' : num(x.einzelpreis, 2)}</td><td class="num">${eur(x.gesamt, true)}</td><td class="small">${IP.DATENSTATUS[x.datenstatus].name} · ${x.quelle || ''}${x.begruendung ? ` · Begründung: ${x.begruendung}` : ''}</td></tr>`)}</tbody></table>` : '')}
<h3>Finanzierung</h3><p class="small">${IP.FIN_STATUS[stand.finanzierung.status]} · FK ${pct(stand.finanzierung.fkAnteil)} · ${stand.finanzierung.tranchen.map((t) => `${t.name}: ${pct(t.anteil)}, ${pct(t.zins, 2)}, ${t.laufzeitJahre} J., ${t.tilgungsfreiJahre} J. tilgungsfrei, ${IP.TILGUNGSMODELLE[t.modell]}`).join(' · ')} · Quelle: ${stand.finanzierung.quelle}</p>
<h3>Planungsannahmen</h3><p class="small">${IP.ANNAHMEN_FELDER.map(([k, l, e, art]) => `${l}: ${art === 'prozent' ? pct(stand.annahmen[k]) : `${num(stand.annahmen[k], 2)} ${e}`}`).join(' · ')} · ${stand.annahmen.quelle}</p>
<p><a class="btn" href="/portal/anlagenplanung/${p.id}?schritt=vergleich${stand.id ? `&v=${stand.id}` : ''}">Zurück zum Vergleich</a></p></section>`;
}
