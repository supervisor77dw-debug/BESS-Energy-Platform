// Go-live-Prüfung der öffentlichen Website (AW-20261114-GE-CLAUDE-STROMKAI-GOLIVE-VORBEREITUNG-022).
// Liest brand.json und prüft die Go-live-Sperre so, als liefe die Produktionsstufe mit gesetztem Freigabeschalter.
// Ändert nichts. Exit 0 = keine Sperre offen, Exit 1 = Sperren offen (Liste wird ausgegeben).
// Aufruf: node tools/golive-pruefen.mjs
const { goLiveSperren, brand } = await import('../src/config.mjs');
const offen = goLiveSperren(brand, { BESS_OEFFENTLICH: '1' }, 'abnahme');
console.log(`Hauptdomain: ${brand.domain}  ·  Nebendomains (308): ${(brand.domainAliases || []).join(', ') || '–'}`);
if (!offen.length) {
  console.log('Keine inhaltliche Sperre offen. Freischaltung erst nach Produktivfreigabe durch Dirk: BESS_OEFFENTLICH=1 im Vercel-Production-Ziel setzen.');
  process.exit(0);
}
console.log(`GO-LIVE GESPERRT – ${offen.length} offene Punkte:`);
for (const s of offen) console.log(`  - ${s}`);
process.exit(1);
