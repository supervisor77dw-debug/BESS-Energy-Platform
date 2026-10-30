# Investitions- und Anlagenplaner (STROMKAI-IP 1.1)

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

**Fläche (ein Modell für Bilanz und Draufsicht, seit Korrektur -017):**
- Brutto = Fläche oder Länge × Breite (bei beiden Angaben gilt Länge × Breite). Ohne Länge und Breite wird ein Quadrat angenommen und gekennzeichnet.
- Innenfläche W × H = (L − 2a)(B − 2a) mit Grenzabstand a.
- Jede Fläche wird genau einmal als Streifen reserviert:
  - Zufahrt oben über die ganze Länge, Tiefe = max(Mindestbreite der Zufahrt, Eingabe / W); die Eingabe ist Untergrenze, die Mehrfläche wird ausgewiesen;
  - Feuerwehr/Brandschutz unten über die ganze Länge, Tiefe = Eingabe / W;
  - nicht nutzbare Fläche links und Stationen rechts über die Resthöhe; Stationen = netzseitige Nebenanlagen (Eingabe) + PCS-/Trafostationen der Anlage (je Variante);
  - Blockzone = Rest.
- Innenfläche = Zufahrt + Feuerwehr + nicht nutzbar + Stationen + Blockzone (Test). Übersteigen die Reservierungen die Innenfläche, passt keine Variante.

**Dimensionierung:**
- Blöcke n = max(⌈MWh / MWh_Block⌉, ⌈MW / MW_Block⌉).
- PCS = Anlagenleistung.
- Trafos = ⌈MW / cos φ / MVA_je_Trafo⌉.
- Leistungsgrößen getrennt: Batterieleistung der Blöcke, PCS-Leistung (= Anlagenleistung der Variante), zulässige Einspeisung = min(PCS, Netzanschluss, max. Einspeisung), zulässiger Bezug = min(PCS, Netzanschluss, max. Bezug). Netzgrenzen überschreiben die Anlagenleistung nicht.
- Netzstatus: ausreichend (beide Grenzen bekannt, ≥ PCS) · ungeprüft (Grenze fehlt) · eingeschränkt (Grenze < PCS) · unzulässig (0, negativ). Widersprüche (Einspeisung/Bezug über Netzanschluss) werden gemeldet, es gilt der kleinere Wert.
- Fläche Blöcke = n × (Länge + Abstand Stirn)(Breite + Abstand Seite). Stationen = Trafos × Fläche je Station.
- Draufsicht: Raster in der Blockzone; n Spalten brauchen n · Länge + (n + 1) · Abstand (voller Abstand untereinander und zum Zonenrand). Es werden höchstens so viele Blöcke gezeichnet wie Plätze. „Passt“ nur bei Rest ≥ 0, ausreichenden Plätzen und Abständen > 0. Schematische Plausibilitätsprüfung, keine genehmigungsfähige Aufstellplanung.

**Kosten:**
- 19 Positionen, jede genau einer WM-Position zugeordnet. Menge aus kWh, MW, Block oder pauschal.
- Batterie (Position 1): Preisbasis ausdrücklich je Preis (nominale, nutzbare oder ungeklärte kWh); Menge = kWh dieser Basis. Die Demo-Vorbelegung 120 EUR/kWh ist nominal (wie `demo.mjs` und WM). Katalogversionen ohne Feld wurden mit der Maske „EUR je nutzbarer kWh“ erfasst. Lieferkosten je Block stehen getrennt und gelten nur zum Katalogpreis; Angebot oder Preisüberschreibung ersetzen beides. Ungeklärte Basis sperrt Übergabe und Freigabe.
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
- Gewählt wird die Simulationsanlage mit der nächsten Speicherdauer an PCS (Abweichung höchstens 25 %), sonst keine Referenz. Strategie B2, Zeitraum R24M, Netzvariante A oder B.
- Das Ergebnis führt angeforderte und tatsächlich verwendete Quelle getrennt (`erloes.angefordert`, `erloes.verwendet`, Referenzanlage, Dauer, Zeitraum, Datenversion, Rückfall und Grund). Oberfläche, Vergleich, CSV, Bericht und WM-Übergabe zeigen dieselbe verwendete Quelle; Varianten mit unterschiedlicher Grundlage werden als „nicht unmittelbar vergleichbar“ gekennzeichnet.
- Übernommen werden:
  - Verkaufspreis = Verkaufserlös / entladene MWh;
  - Einkaufspreis = Bezugskosten / geladene MWh;
  - variable Kosten = (Hilfsenergie + Börse + Bilanzierung + Netzentgelt + Steuern) / entladene MWh;
  - Durchsatz je nutzbarer MWh.
- Den Netto-Deckungsbeitrag des Exports verwendet der Planer nicht. Vermarktung, Verschleiß und Betriebskosten rechnet WM selbst.

**Übergabe an WM:**
- CAPEX-Summen je WM-Position.
- Technik:
  - PCS-Leistung als Anlagenleistung, Einspeise- und Bezugsgrenze getrennt;
  - nominale Kapazität und nutzbarer Anteil;
  - Wirkungsgrad und Degradation des Systems;
  - Lebensdauer.
- Betriebskosten aus der zugeordneten WM-Referenzbasis (wahlweise skaliert), je Position nach Kostenursache (`KOSTENREGELN` in `src/lib/finance/referenz.mjs`):
  - nach nutzbarer MWh: Wartung (schließt PCS ein), Versicherung, Monitoring, Ersatzteile, Rückbau;
  - nach MW PCS: PCS-Instandhaltung (nur wenn nicht in Wartung enthalten);
  - nach MW zulässigem Bezug: Leistungspreis des Netzentgelts;
  - fix: Netzanschluss (Betrieb Übergabestation), Messstelle, Pacht, IT;
  - die pauschale Altposition „Netz- und Messkosten“ (bis WM 1.1) wird nicht mehr mit der PCS-Leistung skaliert.
- Bewertung und Szenarien aus WM.

## 4. STROMKAI-WM 1.1

Erweiterungen gegenüber 1.0 (alle optional):
- CAPEX-Positionen `leittechnik`, `bauzeitzinsen`, `sonstige`.
- `variableKostenEURMWh` je Energie-Erlösweg als eigener Betriebskostenposten.
- `finanzierung.schuldendienstplan` (Zinsen und Tilgung als Anteile am FK je Jahr). Szenarien verschieben die Zinsen um Zinsdelta × offene Restschuld zu Jahresbeginn (Korrektur -017; vorher proportional zum gewichteten Zins, falsch bei Tranchen mit unterschiedlichen Zinsen). Der Tilgungsverlauf bleibt in den Szenarien fest.
- `technik.einspeiseMW` / `technik.bezugMW` (Korrektur -017): Leistungserlöse höchstens mit min(Leistung, Einspeisung, Bezug); Abweisung, wenn der Jahresdurchsatz physikalisch über Grenze × 8760 h × Verfügbarkeit liegt. Das ist eine Obergrenze, keine Zyklenberechnung.

**Belastbarkeit (Planer):**
- Modellrechnung: Netz ausreichend.
- Ungeprüft: Netzdaten fehlen; Übergabe erlaubt, Freigabe gesperrt.
- **Nicht berechnet (Netzgrenzen)** (Folgekorrektur -017-R1): zulässige Einspeisung oder zulässiger Bezug unter der PCS-Leistung, einschließlich 0 MW. Das Jahresmodell bildet keinen zeitaufgelösten Einsatz ab, deshalb gilt:
  - keine WM-Rechnung, keine Kennzahlen;
  - keine verwendete Erlösquelle („Keine – Nicht berechnet (Netzgrenzen)“);
  - in Oberfläche, Vergleich, CSV und Bericht steht nur dieser Status;
  - Übergabe an WM serverseitig abgewiesen (422), Freigabe gesperrt.

  Technik, Kosten und Finanzierungsplan werden weiter berechnet.
- Nicht berechenbar: negative Netzangabe oder keine WM-Version.

Ein pauschaler Korrekturfaktor für erreichbare Zyklen wird bewusst nicht verwendet. Belastbare Erlöse unter Netzgrenzen erfordern einen Backtest mit passenden Leistungsgrenzen. Der Wert „eingeschränkt“ kommt nur noch in älteren Übergaben vor.

**Kennzahl „Investition je nominaler kWh“** (STROMKAI-WM `investitionJeKWh`): Gesamtinvestition / nominale Kapazität. So beschriftet in WM-Akte, Investorenansicht und Berechnungsexport (-017-R1). Der Planer weist zusätzlich „je kWh nutzbar“ aus. Das sind unterschiedliche Kennzahlen derselben Investitionssumme.

Ohne diese Angaben rechnet 1.1 identisch zu 1.0. Der Regressionstest vergleicht 3 Projekte × 3 Szenarien mit allen Jahreswerten.

## 5. Rechte

- **Lesen und Bearbeiten:** Administration und Projektleitung, je Projekt über `rolesForProject`.
- **Nur Administration:** Katalogpflege und Freigabe zur Investitionsentscheidung. Die Freigabe ist nur ohne Platzhalter oder fehlende Positionen möglich.
- **Kein Zugriff:** Eigentümer, Investoren, Vertrieb und Kommunen erhalten 404. Investoren sehen Kennzahlen weiterhin nur über die Freigabe in STROMKAI-WM.


## Referenzbasis und Versionen (IP 1.1 / WM 1.2)

Folgeauftrag zu -017-R1 nach der Rechenabstimmung vom 30.10.2026 (Befunde F und G).

**Referenzbasis.**
- Eine Referenzbasis ist eine eigene, nur anhängend angelegte WM-Version mit `referenzbasis`: Kennung (`REF-<Projekt>-<n>`), Status `freigegeben`, Modellversion, Prüfsumme der Parameter, Erlösquelle und -strategie, Herkunft je Parameter, Kostenregeln, Kostenbasisprüfung, angelegt von und am, Code-Stand.
- Anlage nur durch die Plattformadministration in der Projektakte Wirtschaftlichkeit, derzeit nur aus dem aktuellen Demo-Ausgangsmodell (synthetisch). Batterieverschleiß 8 EUR/MWh ist ausdrücklich gesetzt und als synthetische Demo-Annahme gekennzeichnet.
- Die Kostenbasisprüfung weist ab: fehlenden Verschleiß, pauschale Netz- und Messkosten, pauschale plus getrennte Netzkosten (Doppelzählung).
- Keine Investorenfreigabe, keine Investitionsentscheidung. Bestehende WM-Versionen bleiben unverändert.

**Feste Referenz statt neuester WM-Version.**
- Der Planungsstand trägt `wmBasis`: WM-Datensatz-ID, WM-Version, Kennung, Prüfsumme, Modellversion, Erlösquelle/-strategie, Zeitpunkt, Person und Herkunft der Übernahme. Zuordnung nur durch ausdrückliche Auswahl im Schritt „Technische Konfiguration“.
- Gerechnet wird nur, wenn die Referenz vorhanden, freigegeben, unverändert (Prüfsumme) und von derselben Modellversion ist und der Stand mit der aktuellen Planerversion gespeichert wurde. Sonst Status „Nicht berechnet (Referenzbasis fehlt oder ungültig)“ mit Grund; Übergabe an WM und Freigabe gesperrt.
- Übergaben an WM und Neuberechnungen in der Akte sind keine Referenzbasis und nicht auswählbar. Eine neuere WM-Version ändert die Rechnung eines Stands nicht.
- Die Prüfsumme des Planungsstands schließt ab IP 1.1 den Verweis (Datensatz, Prüfsumme, Modellversion) ein; ältere Stände behalten ihre Prüfsumme.
- Die Übergabe an WM speichert im `planerRef` zusätzlich `wmBasis`, `planerVersion` und `modellVersion`.

**Versionen.**
- STROMKAI-IP 1.0: -016; die Korrekturen -017/-017-R1 liefen ohne Anhebung unter 1.0. IP 1.1: Referenzbasis, Kostenregeln.
- STROMKAI-WM 1.1: -016; -017 änderte Netzgrenzen-Prüfung, Leistungsvermarktung und Szenariozins ohne Anhebung. WM 1.2: Netz- und Messkosten nach Ursache (neue Positionen); ohne sie identisch zu 1.1 (-017) und 1.0 (Regressionstest).
- Die WM-Akte zeigt bei älteren Versionen die gespeicherte Modellversion und kennzeichnet, wenn der Jahresverlauf mit der aktuellen Version neu gerechnet wird.
