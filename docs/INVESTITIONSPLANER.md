# Investitions- und Anlagenplaner (STROMKAI-IP 1.0)

Stand 2026-10-29, Auftrag `AW-STROMKAI-20261029-INVESTITIONSPLANER-016`. Portalbereich „Anlagenplanung & Investition“ (`/portal/anlagenplanung`).

**Abgrenzung:** Der Planer rechnet Fläche, technische Dimensionierung, Investitionskosten und den Finanzierungsplan. Erlöse, Betriebskosten, EBITDA, Kapitalwert, IRR, DSCR und Amortisation rechnet ausschließlich STROMKAI-WM (`src/lib/finance/wirtschaftlichkeit.mjs`). Ergebnis ist eine Vorplanung mit transparenten Annahmen, keine genehmigungsfähige Fachplanung, kein Herstellerangebot und keine Finanzierungszusage.

## 1. Dateien

| Datei | Inhalt |
|---|---|
| `src/lib/planer/planer.mjs` | Reine Funktionen: Katalog, Flächenbilanz, Dimensionierung, Layout, Kostenpositionen, Finanzierung, Erlösreferenz, Übergabe an WM |
| `src/portal/anlagenplanung.mjs` | Routen, Rechte, Formulare, sechs Schritte, Angebote, Übergabe, Freigabe, CSV, Bericht |
| `src/lib/store.mjs` | Sammlungen `planerStaende`, `planerKatalog`, `planerAngebote`; Platzhalter-Katalog einmalig |
| `test/anlagenplanung.test.mjs` | Kontrollrechnungen, Einheiten, Finanzierung, Doppelzählung, Regression WM, Rechte, Abläufe |
| `test/fixtures/wm-1.0-referenz.json` | Referenzwerte STROMKAI-WM 1.0 (Commit `fc558fc`) für den Regressionstest |

## 2. Datenmodell

- **Planungsstand** (`planerStaende`, nur anhängend). Felder:
  - `projectId`, `spvId`, `version`, `basisVersion`, `phase` (vorplanung | angebotsphase | investitionsentscheidung), `status` (gespeichert | freigegeben);
  - `grundstueck`, `annahmen`, `varianten[]`, `finanzierung`;
  - `erstelltVon`/`Am`, `notiz`, `pruefsumme` (SHA-256, 16 Zeichen, über Grundstück, Annahmen, Varianten, Finanzierung), `planerVersion`.

  Jede Speicherung legt eine neue Version an. Frühere Stände werden nie verändert. Freigegebene Stände sind unveränderlich.
- **Variante**: `key`, `name`, `systemRef {systemId, version}`, `leistungMW`, `kapazitaetMWh` (nutzbar), `erloesQuelle` (wm | b2_A | b2_B) und `kosten`. In `kosten` stehen nur Überschreibungen je Positionsnummer: Menge, Einzelpreis, Datenstatus, Quelle, Preisstand, Lieferant, Ausschreibungsposition, Begründung, `angebotId`, geändert von/am.
- **Katalog** (`planerKatalog`): je System und Version ein Datensatz.
  - Neue Werte erzeugen eine neue Version. Planungsstände verweisen auf ihre Version und ändern sich dadurch nicht.
  - Vorbelegt sind drei Platzhalter ohne Hersteller und ohne Preis.
- **Angebote** (`planerAngebote`): Projekt, Kostenposition, Lieferant, Einzelpreis, Einheit, Datum, Gültigkeit, Dokumentreferenz. Sie sind immer intern. Die Auswahl je Variante mit Begründung erzeugt eine neue Version des Planungsstands.

## 3. Formeln

**Fläche:**
- Brutto = Fläche oder Länge × Breite.
- Innenfläche = (L − 2a)(B − 2a) mit Grenzabstand a. Ohne Länge und Breite wird ein Quadrat angenommen und gekennzeichnet.
- Für Blöcke verfügbar = Innenfläche − nicht nutzbar − Zufahrt − Feuerwehr/Brandschutz − Nebenanlagen.

**Dimensionierung:**
- Blöcke n = max(⌈MWh / MWh_Block⌉, ⌈MW / MW_Block⌉).
- PCS = Anlagenleistung.
- Trafos = ⌈MW / cos φ / MVA_je_Trafo⌉.
- Einspeisung = min(MW, Netzanschluss, max. Einspeisung); Bezug analog. WM rechnet mit der begrenzten Einspeisung.
- Fläche Blöcke = n × (Länge + Abstand Stirn)(Breite + Abstand Seite). Stationen = Trafos × Fläche je Station.
- Draufsicht: Raster in der Innenfläche ohne Zufahrtsstreifen und Stationsstreifen. Sie prüft nur die Flächenplausibilität.

**Kosten:**
- 19 Positionen, jede genau einer WM-Position zugeordnet. Menge aus kWh (nutzbar), MW, Block oder pauschal.
- Ohne Katalogpreis und Angebot gilt die gekennzeichnete Demo-Annahme von STROMKAI-WM. Positionen ohne Demo-Wert sind „Wert fehlt“.
- Die Demo-Pauschale „Bau und Montage“ (25 EUR/kWh) trägt die Positionen 6, 7, 8 und 10. Diese stehen als „enthalten in 15“ mit Betrag 0.

**Finanzierung (Investition schließen):**
- Basis B = Positionen 1–16, 19.
- c = FK-Anteil × gewichteter Zins × w, mit w = Σ Abrufanteil × (Bauzeit − Abrufmonat)/12.
- Bauzeitzinsen I = c(1 + r)B / (1 − c·r).
- Reserve = r(B + I), wie in WM.
- Gesamt = (B + I)(1 + r).
- Gebühren = FK × gewichteter Gebührensatz. Sie gehen in den Eigenkapitalbedarf von WM ein, nicht in den CAPEX.
- Tilgung je Tranche:
  - Annuität: konstante Rate über Laufzeit − tilgungsfreie Jahre;
  - Ratentilgung;
  - endfällig.

  In tilgungsfreien Jahren werden nur Zinsen gezahlt. Der Schuldendienstplan geht als Anteile am FK an WM.

**Erlösreferenz (Trading-Export `stromkai.portal.strommarkt/1`):**
- Gewählt wird die Simulationsanlage mit der nächsten Speicherdauer (Abweichung höchstens 25 %), sonst keine Referenz. Strategie B2, Zeitraum R24M, Netzvariante A oder B.
- Übernommen werden:
  - Verkaufspreis = Verkaufserlös / entladene MWh;
  - Einkaufspreis = Bezugskosten / geladene MWh;
  - variable Kosten = (Hilfsenergie + Börse + Bilanzierung + Netzentgelt + Steuern) / entladene MWh;
  - Durchsatz je nutzbarer MWh.
- Den Netto-Deckungsbeitrag des Exports verwendet der Planer nicht. Vermarktung, Verschleiß und Betriebskosten rechnet WM selbst.

**Übergabe an WM:**
- CAPEX-Summen je WM-Position.
- Technik:
  - Einspeisung;
  - nominale Kapazität und nutzbarer Anteil;
  - Wirkungsgrad und Degradation des Systems;
  - Lebensdauer.
- Betriebskosten aus der aktuellen WM-Version des Projekts (wahlweise skaliert):
  - nach nutzbarer MWh: Wartung, Versicherung, Monitoring, Ersatzteile, Rückbau;
  - nach MW: Netz/Messung;
  - fix: Pacht, IT.
- Bewertung und Szenarien aus WM.

## 4. STROMKAI-WM 1.1

Erweiterungen gegenüber 1.0 (alle optional):
- CAPEX-Positionen `leittechnik`, `bauzeitzinsen`, `sonstige`.
- `variableKostenEURMWh` je Energie-Erlösweg als eigener Betriebskostenposten.
- `finanzierung.schuldendienstplan` (Zinsen und Tilgung als Anteile am FK je Jahr; Szenarien skalieren die Zinsen mit dem Zins).

Ohne diese Angaben rechnet 1.1 identisch zu 1.0. Der Regressionstest vergleicht 3 Projekte × 3 Szenarien mit allen Jahreswerten.

## 5. Rechte

- **Lesen und Bearbeiten:** Administration und Projektleitung, je Projekt über `rolesForProject`.
- **Nur Administration:** Katalogpflege und Freigabe zur Investitionsentscheidung. Die Freigabe ist nur ohne Platzhalter oder fehlende Positionen möglich.
- **Kein Zugriff:** Eigentümer, Investoren, Vertrieb und Kommunen erhalten 404. Investoren sehen Kennzahlen weiterhin nur über die Freigabe in STROMKAI-WM.
