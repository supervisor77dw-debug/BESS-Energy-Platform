# Handelsdaten-Schnittstelle `STROMKAI-HD 1.0`

Stand 2026-10-29, Auftrag `AW-STROMKAI-20261029-DESIGN-FINANCE-010`.

Die Schnittstelle **übernimmt nur Ergebnisse** eines externen Stromhandels- oder Dispatchsystems. Sie löst keine Handelsaufträge aus, sendet keine Gebote und hat keine Verbindung zu Börsen oder Vermarktern. Aus dem Wirtschaftlichkeitsrechner führt kein Weg zu einer Handelsaktion.

Verwendung der Daten:
- Bemessungsgrundlage einer **ausdrücklich vereinbarten variablen Vergütung** (Vertragstyp `variabel`);
- Soll-Ist-Vergleich gegen die Prognose.

Festpacht, Optionsentgelt und Kaufpreis werden nie aus Handelsdaten berechnet.

## Datensatz (ein Datensatz je Projekt und Kalendermonat)

| Feld | Bezeichnung | Typ / Einheit | Regel |
|---|---|---|---|
| `projektId` | Projekt-ID im Portal (z. B. `p-n01`) | Text | Pflicht, muss existieren |
| `periode` | Kalendermonat | `JJJJ-MM` | Pflicht |
| `bezugMWh` | Strombezug (eingespeichert) | MWh | ≥ 0 |
| `einspeisungMWh` | Stromeinspeisung (ausgespeichert) | MWh | ≥ 0 |
| `handelsumsatz` | Handelsumsätze | EUR | Zahl |
| `handelskosten` | Handelskosten (Strombezug, Netzentgelte soweit zuordenbar) | EUR | ≥ 0 |
| `gebuehren` | Börsen-, Vermarktungs- und Clearinggebühren | EUR | ≥ 0 |
| `speicherverlusteMWh` | Speicherverluste | MWh | ≥ 0 |
| `verschleissKosten` | Rechnerischer Batterieverschleiß | EUR | ≥ 0 |
| `realisierterErtrag` | Realisierte Erlöse | EUR | Zahl |
| `prognoseErtrag` | Prognostizierte Erlöse für die Periode | EUR | Zahl |

Vom Portal berechnet (nicht liefern):
- `abweichung` = realisiert − Prognose
- Importkennung, Quelle, Zeitpunkt, Bearbeiter, Schnittstellenversion

Beträge werden auf Cent gerundet. Zahlen dürfen im deutschen Format („1.234,56“) oder mit Dezimalpunkt („1234.56“) geliefert werden.

## Formate

**CSV:** UTF-8 (BOM erlaubt), Trennzeichen Semikolon, Kopfzeile mit den Feldschlüsseln:

```
projektId;periode;bezugMWh;einspeisungMWh;handelsumsatz;handelskosten;gebuehren;speicherverlusteMWh;verschleissKosten;realisierterErtrag;prognoseErtrag
p-n01;2028-01;2526,2;2172,5;278080;143993;1800;353,7;6500;278080;264176
```

Hinweis: Felder mit Semikolon oder Anführungszeichen werden nicht unterstützt. Das reicht für die reinen Zahlenfelder.

**JSON:** Eine Liste von Objekten mit denselben Schlüsseln:

```json
[{ "projektId": "p-n01", "periode": "2028-01", "bezugMWh": 2526.2, "einspeisungMWh": 2172.5, "handelsumsatz": 278080,
   "handelskosten": 143993, "gebuehren": 1800, "speicherverlusteMWh": 353.7, "verschleissKosten": 6500,
   "realisierterErtrag": 278080, "prognoseErtrag": 264176 }]
```

## Übernahme

- Ort: Portal → Handelsdaten (`/portal/admin/handelsdaten`). Nur Administration, mit CSRF-Schutz und Audit-Eintrag `handelsdaten_importiert`.
- **Alles oder nichts:** Bei einem Fehler in irgendeiner Zeile wird nichts übernommen (HTTP 422 mit zeilengenauen Meldungen).
- Als Fehler gelten:
  - fehlende Pflichtfelder,
  - falsches Periodenformat,
  - keine Zahl,
  - negative Mengen oder Kosten,
  - unbekanntes Projekt,
  - Projekt und Periode doppelt in einer Lieferung.
- **Hinweis (keine Ablehnung):** Die Energiebilanz Bezug − Einspeisung − Verluste weicht um mehr als max(1 MWh, 2 % des Bezugs) ab.
- **Korrekturlieferung:** Ein erneuter Import derselben Projekt-Periode ersetzt den vorhandenen Datensatz. Die neue Importkennung ist sichtbar.

## Verwendung in der variablen Vergütung

Bemessungsgrundlage je Abrechnungsjahr = Σ (realisierter Ertrag − Handelskosten − Gebühren) der Monate des Jahres.

Vergütung = max(0, Grundlage) × vereinbarter Anteil, mindestens Mindestbetrag, höchstens Deckel.

Die Fälligkeit liegt am 31.03. des Folgejahres (Demo-Annahme, vertraglich festzulegen). Liegen weniger als zwölf Monatsdatensätze vor, erscheint der Anspruch als „Prognose“ mit dem Hinweis „vorläufiger Wert“, nie als „Fällig“. Ob Verschleißkosten abgezogen werden, ist Vertragssache (KLÄRUNGSBEDARF); das Modell zieht sie derzeit nicht ab.

## Rechte

| Rolle | Sicht |
|---|---|
| Administration | Import und alle Datensätze |
| Projektleitung, Vertrieb, Investor | keine Handelsdaten |
| Eigentümer | nur die eigene variable Vergütung (Betrag und Status), keine Handelsumsätze |

## Spätere Anbindung (nicht umgesetzt)

Ein automatischer Abruf (z. B. täglich per API des Dispatchsystems) braucht:
- einen eigenen Dienstzugang mit Leserechten,
- eine Signaturprüfung,
- die Freigabe des Datenschutz- und Vertragsrahmens mit dem Vermarkter.

Bis dahin werden Dateien manuell importiert.
