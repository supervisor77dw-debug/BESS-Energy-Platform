# Aktive Grundstücksakquise und Standortqualifizierung

Stand: 2026-11-01. Auftrag `AW-20261101-GE-CLAUDE-STROMKAI-AKTIVE-AKQUISE-021`, Folgekarte zu `AW-STROMKAI-20261031-CONSOLIDATION-ACQUISITION-020`. Lokal auf `feature/eigentuemer-akquise-aw-020`, nicht gepusht, nicht deployt. Ergänzt [EIGENTUEMERAKQUISE.md](EIGENTUEMERAKQUISE.md).

## Grundsatz

Es gibt keine neue Datenbank, kein CRM und keine zweite Standortverwaltung. Die Erweiterung nutzt nur vorhandene Sammlungen und ergänzt dort Felder:

| Gegenstand | Sammlung | Neue Felder (alle optional, rückwärtskompatibel) |
|---|---|---|
| Flächenkandidat | `db.projects` | `kandidat`, `source.art = 'aktive_akquise'`, `testdaten`, `vorqualifizierung`, `pipelineAm` |
| Flurstück | `db.parcels` | `bundesland`, `gemeinde`, `karte`, `datenquelle`, `erhobenAm`, `pruefstatus`, `altangabe`, `strukturiert`, `beteiligte[]`, `aenderungen[]` |
| Kontakt | `db.contacts` | `rollen[]`, `region`, `datenschutz{}`, `kontaktversuche[]`, `source`, `testdaten` |
| Wiedervorlage | `db.tasks` | `contactId`, `parcelId` (Bezug) |
| Suchprofil | `db.meta.suchprofil` | Szenarien und Flächenbandbreite. Nur zur Orientierung, keine Mindestanforderung. |

Bestehende Kennungen bleiben unverändert: `ANF-JJJJ-NNNN` und `STK-N/S-NNN` (gemeinsamer Zähler `db.meta.standortSeq`). `ownerContactId` bleibt allein maßgeblich für das Eigentümerportal. Eine Verknüpfung als Beteiligter erzeugt keinen Portalzugang.

## Bedienung (ohne neue Navigation)

- **Grundstücke** (`/portal/grundstuecke`): Die Liste „Flächenkandidaten (aktive Akquise)“ und die Schaltfläche „Fläche erfassen“ (`/portal/grundstuecke/neu`) stehen hier. Die Administration pflegt hier auch das Suchprofil.
- **Kontakte** (`/portal/kontakte`): „Kontakt anlegen“ (`/portal/kontakte/neu`) und die Kontaktakte `/portal/kontakte/:id`. Die Kontaktakte enthält Stammdaten, Rollen, Datenschutz, Verknüpfungen und Kontaktversuche.
- **Standortakte** (`/portal/projekte/:id`): Der Abschnitt „Flächenakquise und Vorqualifizierung“ zeigt:
  - den Arbeitsablauf in 9 Schritten (Orientierung, kein Zwang),
  - die Flurstücke mit Bearbeiten und Hinzufügen,
  - die Altangabe mit „Vorschlag übernehmen“ oder „Prüfaufgabe“,
  - das Verknüpfen von Beteiligten,
  - die Vorqualifizierung,
  - „In die Pipeline übernehmen“,
  - die Wiedervorlage.
- **Pipeline** zeigt Flächenkandidaten erst nach der Übernahme. Bis dahin steht dort ein Hinweis auf die Anzahl.

Ablauf: Fläche identifizieren → Grundstück anlegen → Eigentümer-/Kontaktstatus → Kontaktweg → Zuständigkeit → Kontaktaufnahme dokumentieren → Wiedervorlage → Vorqualifizierung → Pipeline.

## Rechte

Es gibt keine neue Rolle und keine Rechteänderung an Bestandsobjekten.

- **Fläche oder Kontakt anlegen:** Administration (alle Regionen) und Vertrieb der eigenen Region, nach demselben Muster wie die Übernahme einer Anfrage. Der neue Standort muss über die bestehende Rolle sichtbar sein, sonst wird die Anlage mit 403 abgelehnt.
- **Bearbeiten:** jede interne Rolle mit Zugriff auf den Standort.
- **Externe Rollen:** 404 auf allen neuen Routen.
- **Kontakte ohne Standort** sehen die verantwortliche Person, der Vertrieb der Kontaktregion und die Administration (`policy.listContacts`, `getContact`).
- **Dublettentreffer** außerhalb des eigenen Zugriffs werden ohne Namen und Link angezeigt („ohne Ihren Zugriff“).
- **Wiedervorlagen als Aufgabe** gehen nur an Personen, die den Standort sehen.

## Datenschutz-Freigabetor (P0)

Das Konzept und die offenen Freigabefragen stehen im Workspace:
`02_AKTIV/BESS Energy Platform/07_OUTPUT/aktive-akquise-021/2026-11-01_Datenschutzkonzept_Claude-Code_Aktive-Akquise_AW-021.md` (ENTWURF, rechtlich zu prüfen).

Technische Umsetzung:

- `config.akquiseEchtdaten` ist nur bei `BESS_AKQUISE_ECHTDATEN=1` **und** Stufe `abnahme` wahr. In jeder Vorschau bleibt es falsch (PROJECT_RULES §4 Nr. 1).
- Solange es falsch ist, verlangen Fläche, Flurstück und Kontakt aus aktiver Akquise die Kennzeichnung „Synthetischer Testdatensatz“. Ohne Kennzeichnung antwortet das Board mit 422.
- Je Kontakt werden erfasst:
  - Herkunft und Quelle,
  - Erhebungsdatum,
  - Rechtsgrundlage (Auswahl, Standard „noch nicht festgelegt“),
  - Art.-13/14-Status mit Datum und Art,
  - Prüftermin Löschung (Vorschlag 180 Tage, Frist nicht freigegeben).
- Ist die Art.-14-Information mehr als einen Monat nach der Erhebung noch offen, zeigt die Kontaktakte einen Warnhinweis.
- **Verarbeitungssperre:** Sie wird bei Widerspruch oder beim Kontaktversuch „Kontakt nicht erwünscht“ gesetzt. Danach sind keine Kontaktversuche und keine Verknüpfungen mehr möglich (409). Die Daten bleiben erhalten; es wird nichts physisch gelöscht.
- **Protokoll:** Es enthält nur Kennungen, Kontaktweg und Status. Namen, E-Mail-Adressen und Ergebnistexte stehen nicht darin.
- **Grundbuchauskunft:** Sie ist nur als Kontaktweg mit dem Hinweis auf § 12 GBO dokumentierbar. Die Plattform stellt kein berechtigtes Interesse fest und ruft keine Dienste ab.

## Flurstücksdaten und Altbestand

- Felder: Bundesland, Gemeinde, Gemarkung, Flur, Flurstückskennzeichen, Fläche, Kartenreferenz/Koordinaten, Datenquelle, Erhebungsdatum, Prüfstatus. Alle sind freiwillig.
- **Öffentliches Formular:** Gemarkung, Flur und Flurstück sind jetzt drei freiwillige Felder. Weiterhin gibt es nur zwei HTML-Pflichtfelder.
- **Übernahme aus Anfrage:**
  - Einzelfelder werden strukturiert übernommen.
  - Freitext wird nur bei eindeutigem Muster „Gemarkung X, Flur N, Flurstück M“ zerlegt.
  - Sonst bleibt er als `altangabe` erhalten und erhält den Prüfstatus „Prüfung erforderlich“.
- **Altdaten** (Freitext in `gemarkung`, Flur/Flurstück „–“):
  - Sie werden nicht automatisch umgeschrieben.
  - Die Standortakte bietet bei eindeutigem Muster „Vorschlag übernehmen“ (mit Bestätigung, Altangabe bleibt) und sonst „Prüfaufgabe anlegen“.
- **Eigentümerzuordnung im Bestand:**
  - Sie gilt nur mit einem Vertrag zum Flurstück als belegt.
  - Zuordnungen aus Anfragen sind Selbstauskunft.
  - Hatte die Anfrage eine andere Rolle als Eigentümer, zeigt die Akte „Rolle laut Anfrage: …“.
- **Lesende Prüfung:** `node tools/akquise-altdaten.mjs <db.json>` schreibt nichts und gibt keine Personendaten aus.

## Kontaktrollen und Kontaktversuche

- **Rollen:** Eigentümer, Pächter, Bewirtschafter, Gemeinde/Verwaltung, Kontaktvermittler, sonstiger Projektkontakt. Mehrere Rollen je Kontakt sind möglich.
- Neue Kontakte erhalten die Art `Projektkontakt`, also keine Eigentümereinstufung ohne Grundlage.
- **Beteiligte je Flurstück:** `{contactId, rolle, eigentum, grundlage}`. „Bestätigt“ gilt nur für die Rolle Eigentümer und nur mit Grundlage. Bewirtschafter und Pächter können nicht bestätigt werden. Verknüpfungen werden beendet, nicht gelöscht.
- **Kontaktwege:** persönliche Ansprache vor Ort, Gemeinde/Amtsverwaltung, Grundbuchauskunft (berechtigtes Interesse dokumentiert), Bauernverband/Landgesellschaft, Weiterleitung über Dritte, Eigentümeranfrage über Website, sonstiger Weg.
- **Je Versuch:** Datum, Kontaktweg, Status, Ergebnis, nächste Aktion, Wiedervorlage, Verantwortlich, erfasst von. Eine Wiedervorlage mit Standortbezug wird als Aufgabe angelegt und über die bestehende Benachrichtigung gemeldet.

## Vorqualifizierung

- **Felder:** Fläche (Vorschlag aus den Flurstücken), Leistungsszenarien MW/MWh (frei, mehrere), Abstand zum Netzverknüpfungspunkt, Netzanschlussstatus in Stufen (keine Prüfung bis Netzanschlussvertrag), Zuschnitt/Erschließung, Zufahrt/Nebenflächen, Planungsrecht, Kontakt-/Flächensicherung, Risiken und Ausschlusskriterium.
- **„vorqualifiziert (intern)“** wird nur gespeichert, wenn alle Angaben vorliegen, ein Eigentümer belegt ist und kein Ausschlusskriterium gesetzt ist. Andernfalls gilt „Vorprüfung – nicht bestätigt“, und die fehlenden Angaben werden angezeigt.
- Das Bestandsfeld `gridStatus` wird nicht überschrieben.
- Wirtschaftlichkeit und Auslegung laufen über die vorhandenen Module STROMKAI-WM und Anlagenplanung. Es gibt keinen zweiten Rechner.

## Schalter

| Variable | Wirkung |
|---|---|
| `BESS_AKTIVE_AKQUISE` | `1` an, `0` aus. Ohne Wert: an in QA und lokal, aus in der Stufe `abnahme`. |
| `BESS_AKQUISE_ECHTDATEN` | Wirkt nur in der Stufe `abnahme`. Ist erst nach Datenschutzfreigabe zu setzen. |

## Tests

`test/aktive-akquise.test.mjs` (10 Tests) prüft:

- Anlage ohne Anfrage und das Freigabetor,
- Rechte je Rolle und Region,
- Kontakte mit Mehrfachrollen,
- mehrere Flurstücke und Beteiligte,
- Eigentum nur mit Grundlage,
- Dubletten,
- Kontaktversuche mit Wiedervorlage, Benachrichtigung, Art.-14-Nachweis, Sperre und Protokoll ohne Personendaten,
- Vorqualifizierung und Pipeline,
- Altbestand (unverändert, Vorschlag nur nach Bestätigung, lesende Prüfung),
- öffentliches Formular,
- Schalter.

Die gesamte Suite (`npm test`) läuft mit 225/225.
