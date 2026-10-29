// Export des Shadow-Trading-Stands für das Portal (Format stromkai.portal.shadow/1, AW-STROMKAI-20261029-ADMIN-DASHBOARD-INTEGRATION-015).
// Quelle: unveränderliche Ablage des täglichen Shadow-Laufs aus dem STROMKAI-Trading-System (C:\dev\stromkai-trading,
// scripts/shadow_daily.py) im Workspace. Nur Simulation: Pläne, Auktions- und Bewertungsergebnisse, Risikoprüfung.
// Es werden keine Gebote übermittelt; das Portal zeigt den Stand nur an. Ausgabe mit SHA-256-Prüfsumme.
// Aufruf: node tools/export-shadow.mjs --ablage "<…/Shadow_Trading>" [--ziel src/strommarkt-daten]
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const ablage = arg('--ablage');
const ziel = arg('--ziel') || 'src/strommarkt-daten';
if (!ablage || !existsSync(ablage)) { console.error('Ablage nicht gefunden (--ablage).'); process.exit(2); }

const jsonl = (f) => existsSync(join(ablage, f)) ? readFileSync(join(ablage, f), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : [];
const ordner = (n) => existsSync(join(ablage, n)) ? readdirSync(join(ablage, n)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : [];
const lies = (n, f) => JSON.parse(readFileSync(join(ablage, n, f), 'utf8'));
const r2 = (x) => Math.round(x * 100) / 100;

// Plan zusammenfassen: Viertelstunden (96 Werte, 0,25 h); geplante virtuelle Käufe/Verkäufe und Prognose-Handelssaldo
function planZusammenfassung(p) {
  const dt = 24 / (p.zeit_utc?.length || 96);
  const strategien = Object.fromEntries(Object.entries(p.strategien || {}).map(([k, s]) => {
    let kaufMWh = 0, verkaufMWh = 0, saldo = 0, kaufVS = 0, verkaufVS = 0;
    s.laden_mw.forEach((c, i) => {
      const d = s.entladen_mw[i], pr = s.prognose_eur_mwh[i];
      kaufMWh += c * dt; verkaufMWh += d * dt; saldo += (d - c) * pr * dt;
      if (c > 1e-6) kaufVS++; if (d > 1e-6) verkaufVS++;
    });
    return [k, { kauf_mwh: r2(kaufMWh), verkauf_mwh: r2(verkaufMWh), kauf_viertelstunden: kaufVS, verkauf_viertelstunden: verkaufVS,
      prognose_handelssaldo_eur: r2(saldo), soc_start_mwh: r2(s.soc_mwh[0]), soc_ende_mwh: r2(s.soc_mwh.at(-1)) }];
  }));
  return { liefertag: p.liefertag, status: p.status, erstellt_utc: p.erstellt_utc, gebotsschluss_lokal: p.gebotsschluss_lokal,
    datenversion: p.informationsstand?.datenversion, preise_bis: p.informationsstand?.preise_bis_liefertag,
    // neutrale Bezeichnung wie im Portal-Export (keine Projekt- oder Kostenplanbezüge in der Vorschau)
    anlage: { name: `Simulationsanlage ${p.anlage?.p_mw} MW / ${p.anlage?.e_nom_mwh} MWh`, p_mw: p.anlage?.p_mw, e_mwh: p.anlage?.e_nom_mwh },
    modell: p.modell_c ? { version: p.modell_c.modellversion, trainingsdaten_bis: p.modell_c.trainingsdaten_bis_liefertag, echtzeitgetreu: p.modell_c.echtzeitgetreu } : null,
    betriebsart: p.betriebsart, reale_ausfuehrung: p.reale_ausfuehrung === true,
    risiko: { gebote: p.risiko?.gebote || {}, verstoesse: p.risiko?.verstoesse || [], auditkette_ok: p.risiko?.auditkette_ok === true, hinweis: p.risiko?.hinweis },
    hash: p.hash, strategien };
}

const plaene = ordner('plaene').map((f) => planZusammenfassung(lies('plaene', f)));
if (plaene.some((p) => p.reale_ausfuehrung || p.betriebsart !== 'SHADOW')) { console.error('Abbruch: Plan ohne Shadow-Kennzeichnung oder mit realer Ausführung.'); process.exit(4); }
const bewertungen = ordner('bewertung').map((f) => { const b = lies('bewertung', f); return { liefertag: b.liefertag, bewertet_utc: b.bewertet_utc, gewertet: b.gewertet, plan_status: b.plan_status, hinweis: b.hinweis, ergebnisse: b.ergebnisse }; });
const laeufe = jsonl('laeufe.jsonl').slice(-14).map((l) => ({ lauf_utc: l.lauf_utc, ziel_liefertag: l.ziel_liefertag, datenversion: l.datenversion, plan_status: l.plan?.status || null, auktionen: (l.auktion || []).length, bewertet: (l.bewertet || []).length, fehler: l.fehler || null }));
const out = { format: 'stromkai.portal.shadow/1', erzeugt_utc: new Date().toISOString(), quelle: 'STROMKAI-Trading-System, täglicher Shadow-Lauf (nur Simulation)',
  register_eintraege: jsonl('shadow_register.jsonl').length, laeufe, plaene, bewertungen,
  hinweis: 'Simulation ohne Börsenzugang. Gebote werden nur protokolliert, nie übermittelt.' };
const buf = Buffer.from(JSON.stringify(out));
writeFileSync(join(ziel, 'shadow.json'), buf);
writeFileSync(join(ziel, 'shadow.sha256'), createHash('sha256').update(buf).digest('hex'));
console.log(JSON.stringify({ plaene: plaene.length, bewertungen: bewertungen.length, laeufe: laeufe.length, bytes: buf.length }));
