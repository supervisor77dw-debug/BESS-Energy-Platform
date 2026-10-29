# Finanzmodell: Projektwirtschaftlichkeit und Eigentümervergütung

Stand 2026-10-29, Auftrag `AW-STROMKAI-20261029-DESIGN-FINANCE-010`. Modellversionen:
- `STROMKAI-WM 1.1` (Wirtschaftlichkeit; 1.1 seit AW-016 mit optionalen Positionen Leittechnik/Bauzeitzinsen/Sonstige, variablen Handelskosten und Schuldendienstplan, siehe `INVESTITIONSPLANER.md`; ohne diese Angaben identisch zu 1.0)
- `STROMKAI-VG 1.0` (Vergütung)
- `STROMKAI-HD 1.0` (Handelsdaten, siehe `HANDELSDATEN_SCHNITTSTELLE.md`)

Alle Zahlen in der Vorschau sind synthetisch. Das Modell ist ein vereinfachtes Jahresmodell vor Steuern und keine Anlageberatung.

## 1. Aufbau

| Modul | Datei | Aufgabe |
|---|---|---|
| Geld | `src/lib/finance/geld.mjs` | Rundung auf Cent (kaufmännisch, halbe Cent vom Nullpunkt weg), Formatierung de-DE, Zahleneingabe „1.234,56“ / „1234.56“ |
| Wirtschaftlichkeit | `wirtschaftlichkeit.mjs` | CAPEX, OPEX, Erlöse, Finanzierung, Kennzahlen, drei Szenarien |
| Vergütung | `verguetung.mjs` | Optionsentgelt, Bauphasenvergütung, Pacht/Mindestpacht/VPI, Kaufpreisformel, Variantenvergleich, variable Vergütung |
| Verträge | `vertraege.mjs` | Versionierung in 6 Stufen, Eigentümeransprüche und Status |
| Handelsdaten | `handelsdaten.mjs` | Prüfung und Übernahme von Monatsdaten eines Handelssystems |
| Export | `export.mjs` | CSV der Berechnung, PDF der Eigentümerübersicht |
| Demo | `demo.mjs` | Synthetische Daten (siehe Abschnitt 7) |

Die Module sind reine Funktionen ohne Speicherzugriff. Ausnahme: `neuerStand`, `uebernehmen` und `ensureFinanceDemo` hängen Datensätze an. Tests: `test/finanzen.test.mjs` prüft die Formeln, `test/finanzportal.test.mjs` die Rechte und Abläufe.

## 2. Projektwirtschaftlichkeit (eine Akte je SPV)

### Eingaben

| Gruppe | Felder (Auszug) |
|---|---|
| Standort | Grundstück, Fläche/Options-/Betriebsfläche ha, Netzanschlussstandort, Grundstücksmodell (Pacht/Kauf) |
| Batterietechnik | Leistung MW, Kapazität MWh, nutzbarer Anteil, Zyklus-Wirkungsgrad, Verfügbarkeit, Degradation p. a., Zyklen/Jahr, Betriebsdauer, Batterieverschleiß EUR je ausgespeicherter MWh |
| CAPEX | Batterie, PCS, Trafo, Netzanschluss inkl. BKZ, Bau, Erschließung, Brandschutz, Planung, Genehmigung, Nebenkosten, Reserve % |
| OPEX | Wartung, Versicherung, Grundstück (Pacht), Netz/Messung, IT, Monitoring/Betriebsführung, Ersatzteile, Rückbauvorsorge, Vermarktung % der Bruttoerlöse, Kostensteigerung p. a. |
| Finanzierung | Fremdkapitalanteil, Zins, Laufzeit (Annuität), Finanzierungskosten % des Kredits, Schuldendienstreserve (Monate) |
| Einnahmen | Je Vermarktungsweg: Anteil der Leistung; Energie: Verkaufs-/Einkaufspreis €/MWh; Leistung: €/MW/Jahr |
| Bewertung | Diskontsatz Kapitalwert |

### Rechenregeln je Betriebsjahr j (Zahlung am Jahresende)

- Kapazitätsfaktor = (1 − Degradation)^(j−1)
- Energieerlös je Vermarktungsweg:
  - ausgespeichert = Kapazität × nutzbar × Zyklen × Verfügbarkeit × Anteil × Kapazitätsfaktor
  - eingespeichert = ausgespeichert / Wirkungsgrad
  - Erlös = aus × Verkaufspreis − ein × Einkaufspreis
- Leistungserlös = Leistung × Anteil × €/MW/Jahr × Verfügbarkeit
- **Keine Doppelzählung:** Die Summe der Anteile aller Vermarktungswege muss ≤ 100 % sein, sonst wird die Berechnung abgewiesen (HTTP 422). Parallel vermarktete Leistung wird damit nur einmal gezählt.
- Vermarktungskosten = Bruttoerlöse × Vermarktungsanteil
- OPEX = Summe der Posten × (1 + Kostensteigerung)^(j−1)
- **Batterieverschleiß** (ab AW-011): ausgespeicherte MWh des Jahres × Verschleißsatz × (1 + Kostensteigerung)^(j−1). Er erscheint als eigener Betriebskostenposten „Batterieverschleiß (Zyklenkosten)“. Physikalisch wirkt der Verschleiß doppelt, aber ohne Doppelzählung:
  - als Kapazitätsverlust über die Degradation (weniger Durchsatz und Erlös);
  - als Kosten über den Zyklensatz (Rücklage für Zelltausch und Augmentierung).

  Hält eine Augmentierung die Kapazität konstant, ist die Degradation auf 0 zu setzen und der Satz entsprechend zu erhöhen.
- EBITDA = Brutto − Vermarktung − OPEX. Der operative Cashflow ist gleich EBITDA (vor Steuern, ohne Working Capital).
- Kredit:
  - Fremdkapital = Gesamtinvestition × FK-Anteil
  - Annuität über die Laufzeit
  - DSCR = operativer CF / Schuldendienst
- Eigenkapitalbedarf = Investition − FK + Finanzierungskosten + DSRA. Die DSRA wird im letzten Kreditjahr frei.
- Kennzahlen:
  - Gesamtinvestition, €/kWh, OPEX/Brutto/Vermarktung/EBITDA/CF im Jahr 1, Schuldendienst, Eigenkapitalbedarf
  - DSCR min/Ø, Amortisation (linear interpoliert)
  - Kapitalwert, Projekt-IRR, Eigenkapital-IRR (Bisektion; „–“, wenn kein Vorzeichenwechsel)

### Szenarien

| | Erlöse | CAPEX | OPEX | Zins | Degradation |
|---|---|---|---|---|---|
| Konservativ | −20 % | +10 % | +10 % | +1 Pkt. | +0,5 Pkt. |
| Basis | – | – | – | – | – |
| Optimistisch | +15 % | −5 % | −5 % | −0,5 Pkt. | −0,3 Pkt. |

### Nachvollziehbarkeit
- Jede Berechnung wird als neue Version gespeichert und nie überschrieben. Gespeichert werden:
  - Parameter,
  - Ergebnis aller drei Szenarien,
  - Zeitpunkt,
  - Modellversion,
  - Datenquelle,
  - Prüfsumme der Parameter (SHA-256, 16 Zeichen),
  - Bearbeiter und Notiz.
- Ungültige Eingaben ändern nichts. Angezeigt wird die letzte gültige Version.
- Investoren sehen nur ausdrücklich freigegebene Kennzahlen einer Version: Gesamtinvestition, €/kWh, Eigenkapitalbedarf, Projekt-IRR, DSCR. Kostenpositionen, Margen und Vermarktungsstrategie sehen sie nicht.

### Bekannte Vereinfachungen (PRÜFUNGSBEDÜRFTIG vor Einsatz mit echten Daten)
1. Keine Steuern (Gewerbe-/Körperschaftsteuer), keine Abschreibung, kein Working Capital.
2. Keine Preissteigerung auf der Erlösseite; nur die OPEX steigen. Das Modell ist dadurch strukturell vorsichtig. Ein Parameter „Erlöspreisentwicklung“ ist vorzusehen.
3. Keine Augmentierung (Nachrüstung gegen Degradation), kein Restwert, Rückbau nur als laufende Vorsorge.
4. Bauzeit ohne Bauzeitzinsen; Investition vollständig in Jahr 0.
5. Erlösannahmen sind Eingaben, keine Marktprognose.

## 3. Eigentümervergütung

| Baustein | Regel | Vertrag V0.2 |
|---|---|---|
| Optionsentgelt | Je angefangenes Optionsjahr ein Jahresentgelt; Grundlaufzeit plus Verlängerungen; nicht ganzjährige Zeiträume anteilig nach Monaten (Annahme, siehe E-Liste) | § 5 |
| Bauphasenvergütung | Jahresbetrag zeitanteilig über die tatsächliche Bauzeit; **nur bei Nutzung/Pacht**, bei Kauf 0 | § 10 |
| Pacht | max(Fläche × Pacht je ha, Mindestpacht) | § 6 |
| VPI | Anpassung alle n Jahre um die Indexveränderung × Weitergabeanteil. Echte Indexstände haben Vorrang, sonst Prognose mit Rate; die Quelle (Basis/Index/Prognose) wird mitgeführt | § 6 |
| Kaufpreis je m² | Referenz-Bodenwert × Bodenwertfaktor + Standortprämie, begrenzt auf [Mindestpreis, Höchstpreis (Cap)]; Cap < Mindestpreis wird abgewiesen | § 11 |
| Kaufpreis gesamt | m² × Preis je m² × (1 + Indexierung)^Jahre bis Ausübung | § 11/12 |
| Variantenvergleich | Pacht / Kauf / Pacht mit Kauf im Jahr k, nominal und Barwert (nachschüssig) | – |
| Variable Vergütung | Nur Vertragstyp `variabel`: Anteil × (realisierter Ertrag − Handelskosten − Gebühren − Batterieverschleiß, Letzteres nur wenn der Vertrag `verschleissAbziehen` ausdrücklich vorsieht), mindestens 0, mit Mindestbetrag und Deckel. Eine Festpacht ist nie an Handelsergebnisse gekoppelt (Funktion wirft für andere Typen) | gesondert zu vereinbaren |

Beträge, die Ansprüche werden, sind auf Cent gerundet.

## 4. Versionierung (6 Stufen)

| Nr. | Stufe | verbindlich | Ablage | Bedingung |
|---|---|---|---|---|
| 1 | Unverbindliche Simulation | nein | `verguetungsangebote` | – |
| 2 | Interner Verhandlungsvorschlag | nein | `verguetungsangebote` | – |
| 3 | Vereinbarte Eckdaten | ja | `vertragsstaende` | nur Administration/Projektleitung |
| 4 | Unterzeichneter Vertrag | ja | `vertragsstaende` | Dokumentreferenz Pflicht |
| 5 | Nachtrag | ja | `vertragsstaende` | Dokumentreferenz Pflicht, setzt Stufe 4 voraus |
| 6 | Abgerechnete Zahlungen | – | `zahlungen` | nur Administration; in der Vorschau immer `synthetisch` |

- Stände werden nur angefügt und nie geändert. Die Bedingungen sind eingefroren.
- **Demo-Kennzeichen** (`synthetisch`) vererbt sich je Vertrag:
  - Aus einem synthetischen Vertrag entsteht nie ein echter verbindlicher Stand.
  - Zahlungen zu ihm sind immer synthetisch.
  - Eigentümer sehen „Demo-Vertrag“ mit dem Hinweis, dass keine Zahlungsansprüche entstehen.
- Ansprüche entstehen ausschließlich aus dem jüngsten verbindlichen Stand. **Eine Simulation ändert nie einen Vertrag.**
- Anspruchsstatus:
  - Vereinbart
  - Fällig (Fälligkeit ≤ heute)
  - Bezahlt (reale Zahlung)
  - Demo-Buchung (nur synthetische Zahlungen; wird nie als bezahlt gezählt)
  - Prognose (z. B. VPI-Folgejahre, variable Vergütung ohne Handelsdaten)

## 5. Abgleich mit der Excel-Arbeitsmappe

Quelle: `03_WARTEN/PV Projekt/03_DATA/BESS_Schoenberg/Flaechensicherung_und_Verguetung/BESS_Flaechensicherung_Verguetungsmodell_v0_2.xlsx` (Blätter Vor_Ort, Variantenvergleich, Vertragsdaten, Hinweise; Status der Quelle UNGEKLAERT). Die Arbeitsmappe wurde nur gelesen, nicht verändert.

### Übernommene Logik
Optionsentgelte je Jahr, Pacht mit Mindestpacht, VPI-Weitergabe, Kaufpreisformel mit Bodenwertfaktor, Standortprämie und Cap, Kauf mit Indexierung, Pacht mit späterem Kauf, Variantenvergleich nominal/Barwert. Die Testfälle in `test/finanzen.test.mjs` bilden die Werte der Arbeitsmappe nach:
- Variante A nominal 911.151,37 € / Barwert 503.132,42 €
- Kauf 443.569,69 € / Barwert 349.663,70 €

### Fehler in der Arbeitsmappe (nicht übernommen, im Code korrigiert)

| Nr. | Fundstelle | Fehler | Korrektur im Modell |
|---|---|---|---|
| E1 | Variantenvergleich Spalte E (Hybrid kumuliert) | Der Kaufpreis wird nie addiert, weil der IF-Zweig nicht erreichbar ist. E26 = 195.151,51 statt Pacht bis Kaufjahr + Kaufpreis (B17 = 443.569,69 allein für den Kauf) | Kaufpreis im Kaufjahr enthalten |
| E2 | Vor_Ort!B27 „100 % VPI“ / Variantenvergleich!B8 | Der Weitergabeanteil wird nicht verwendet; stattdessen sind 2 % Steigerung fest eingetragen | Steigerung = VPI-Rate × Weitergabeanteil |
| E3 | B42 | Laufzeit fest 20 Jahre statt Pachtlaufzeit B24 | Laufzeit aus dem Vertrag |

### Lücken und Widersprüche (KLÄRUNGSBEDARF, nicht still entschieden)

| Nr. | Punkt | Annahme im Modell |
|---|---|---|
| K1 | Keine Bauzeit in der Arbeitsmappe | Bauphasenvergütung über die eingegebene Bauzeit in Monaten |
| K2 | Keine Prüfung Mindestpreis ≤ Cap | Wird abgewiesen |
| K3 | Optionsmonate, die kein volles Jahr ergeben | Anteilig nach Monaten |
| K4 | B38 effektive Fläche berücksichtigt die Vor-Ort-Vereinbarung nicht | Fläche wird je Vertrag eingegeben |
| K5 | 25.000 €/ha in der Arbeitsmappe gegenüber dokumentiertem SSOT-KONFLIKT 4.000 vs. 25.000 €/ha | Kein Wert fest im Code; Demo nutzt synthetische Werte |
| K6 | Bauphasenvergütung nur in der Nutzungsvariante (§ 10) | Bei Kauf 0 mit Hinweis |
| K7 | Zahlungszeitpunkt (nachschüssig/vorschüssig) nicht festgelegt | Nachschüssig (Jahresende) |
| K8 | Gilt die VPI-Anpassung auch für die Mindestpacht? | Ja, die VPI-Anpassung wirkt auf die resultierende Jahrespacht (also auch, wenn die Mindestpacht greift) |

## 6. Rechte

| Rolle | Projektkalkulation | Vergütungsrechner | Verbindliche Stände | Zahlungen | Handelsdaten |
|---|---|---|---|---|---|
| Administration | alle Projekte | ja | ja | erfassen | importieren |
| Projektleitung | zugeordnete Projekte | ja | ja | nein | nein |
| Vertrieb (z. B. Markus) | nein (nur Liste der eigenen Projekte) | ja, Simulation/Vorschlag | nein | nein | nein |
| Eigentümer | nein | nein | nur eigene, freigegebene Stände lesen | nur eigene Ansprüche | nein |
| Investor | nur freigegebene Kennzahlen eigener SPVs | nein | nein | nein | nein |

## 7. Demo-Daten

`ensureFinanceDemo` legt einmalig an (Kennzeichen `db.meta.finanzDemo`):
- drei Finanzmodelle: Nord A 20 MW/40 MWh, Nord B 10/20, Süd A 50/100;
- eine Investorenfreigabe (Nord A, Basis);
- Verträge:
  - k-1 Festpacht (Simulation → Vorschlag → unterzeichnet)
  - k-2 Kaufoption (Eckdaten)
  - k-3 Pacht mit späterem Kauf (unterzeichnet + Nachtrag)
  - k-1v gesondertes Beispiel variable Vergütung
- drei Demo-Zahlungen (`synthetisch: true`, Anzeige „keine reale Zahlung“);
- zwölf Monate synthetische Handelsdaten.

Demo-Annahmen Basis Nord A: Batterie 120 €/kWh, 365 Zyklen, 1,5 % Degradation, Batterieverschleiß 8 €/MWh, Spreads 165/50 und 180/55 €/MWh, Regelreserve 135.000 €/MW/Jahr.

Ergebnis ab AW-011 (mit Verschleiß): DSCR min. 1,15, Projekt-IRR 7,2 %. Unter AW-010 (ohne Verschleiß) waren es 1,26 und 8,3 %.

**Diese Werte sind synthetische Rechenbeispiele, keine Marktdaten und keine Marktprognose.**

Bestehende Demo-Bestände (Kennzeichen 1) werden beim Laden nur nachgekennzeichnet: Demo-Verträge erhalten `synthetisch`. Werte und Versionen bleiben unverändert.

**Vor Echtbetrieb:**
1. Den Aufruf `ensureFinanceDemo` in `src/lib/store.mjs` entfernen.
2. Die Demo-Datensätze (`synthetisch: true`) löschen.
3. Die Erfassung von Zahlungen ohne `synthetisch` erst dann freischalten.

## 8. Persistenz – Plan für den Produktivbetrieb

Der heutige Speicher (eine JSON-Datei im Vercel Blob Store, Präfix je Umgebung) ist für die Vorschau geeignet, **aber nicht produktionsreif** für Finanz- und Vertragsdaten:
- keine Transaktionen;
- „letzter Schreiber gewinnt“ bei gleichzeitigen Zugriffen;
- keine Abfragen;
- keine revisionssichere Historie außerhalb der Anwendung.

Vorgesehen:
1. **Datenbank:** PostgreSQL (verwaltet, EU-Region). Tabellen u. a.:
   - `finanzmodell_version`, `finanzfreigabe`
   - `vertragsstand` (append-only; UPDATE/DELETE per Rechte entzogen), `verguetungsangebot`
   - `zahlung`, `handelsdaten`
   - `audit`
2. **Integrität:**
   - Beträge als `numeric(14,2)`.
   - Fremdschlüssel auf Projekt/SPV/Eigentümer.
   - Eindeutigkeit (projekt, periode) für Handelsdaten.
   - Zeilenrechte (Row Level Security) je Mandant/SPV als zweite Sicherung neben der Anwendungslogik.
3. **Backup und Wiederherstellung:**
   - Point-in-Time-Recovery (mindestens 7 Tage).
   - Zusätzlich ein tägliches logisches Backup (`pg_dump`, verschlüsselt) außerhalb des Anbieters, 30 Tage aufbewahrt.
   - Wiederherstellungstest vor Go-live und danach quartalsweise, protokolliert.
4. **Migration:** Einmaliges Skript JSON → Tabellen mit Abgleich der Summen je Vertrag. Danach wird der JSON-Speicher nur noch lesend vorgehalten.
5. **Kosten:** Anbieter und Tarif werden vor Bestellung zur Freigabe vorgelegt. Es ist nichts bestellt.
