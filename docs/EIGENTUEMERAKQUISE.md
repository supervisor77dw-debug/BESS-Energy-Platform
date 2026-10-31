# Eigentümerakquise, Anfragen und Standortakte

Stand 2026-10-31, Auftrag `AW-STROMKAI-20261031-CONSOLIDATION-ACQUISITION-020`. Isolierter Feature-Branch, nicht produktiv.

## Grundsatz

Keine zweite Datenhaltung. Anfragen bleiben in `db.inquiries`. Eine Übernahme legt Kontakt (`db.contacts`), Standort (`db.projects`, Phase 1), Grundstück (`db.parcels`) und eine erste Aufgabe (`db.tasks`) im bestehenden Projektprozess an. Die Standortakte ist eine Ansicht dieser Sammlungen und speichert nichts selbst.

## Öffentliches Formular `/standort-anbieten`

| Feld | Pflicht |
|---|---|
| Name | ja |
| E-Mail oder Telefon | eines von beiden (Projektentscheidung vor AW-020 beibehalten) |
| Gemeinde oder Ort | ja |
| Einwilligung | ja |
| Rolle, PLZ (5 Ziffern), Größe, Nutzung, Umspannwerk-Entfernung, Gemarkung/Flurstück, Hinweise, Lageplan | freiwillig |

Schutz wie bisher: Formular-Token mit Mindestausfüllzeit, Honeypot, Rate-Limit 8 je Stunde und IP, Dateiprüfung über die Dateisignatur (PDF/JPG/PNG, 10 MB). Neue Anfragen erhalten eine fortlaufende Kennung `ANF-JJJJ-NNNN` (`db.meta.anfrageSeq`).

## Bearbeitung `/portal/anfragen`

- Sichtbar für interne Rollen, externe Rollen erhalten 404.
- Filter: offen, Wiedervorlage fällig, alle. Die Übersicht zeigt fällige Wiedervorlagen als Kennzahl.
- Status: neu, in Prüfung, Rückfrage offen, Gespräch vereinbart, als Standort übernommen (nur über die Übernahme), nicht geeignet, abgeschlossen. Der Altstatus „in Bearbeitung“ wird als „in Prüfung“ angezeigt.
- Felder: Zuständig (nur interne aktive Konten), nächste Aktion, Wiedervorlage, Notiz. Jede Änderung wird mit Zeit und Person in `i.log` festgehalten und protokolliert (`anfrage_bearbeitet`).
- Dublettenprüfung: gleiche E-Mail, Telefonnummer (mindestens 6 Ziffern), Flurstücksangabe oder PLZ + Ort in Anfragen, Kontakten und Grundstücken. Treffer werden angezeigt und nicht automatisch zusammengeführt. Eine Übernahme mit Treffern verlangt die Bestätigung „Dubletten geprüft“.
- Unterlage: Download nur intern, als Anhang, protokolliert.

## Übernahme als Standort

Berechtigt sind die Administration (alle Regionen) und der Vertrieb der eigenen Region. Vor dem Speichern wird geprüft, ob der neue Standort für die übernehmende Person über ihre **bestehende** Rolle sichtbar ist. Ist er es nicht, wird nichts angelegt. Beispiel: Projektleitung mit fester Projektliste. Es gibt keine Rechtevergabe, keine Projektgesellschaft und keinen Vertrag. Kennung des Standorts: `STK-N-001` bzw. `STK-S-001`.

## Standortakte (Projektseite, nur interne Rollen)

Akquisestatus und Herkunftsanfrage, Eigentümer, technische Vorprüfung, Netzanschluss, Genehmigung, Vertrag/Option, Links zu STROMKAI-WM und Anlagenplanung (nach Rolle), Verantwortliche, nächste Maßnahmen (offene Aufgaben) sowie Entscheidungen und Freigaben (Freigabeanträge und ausgewählte Protokollereignisse des Projekts).

## Löschkonzept (Vorschlag, rechtlich zu prüfen)

Nur die Administration darf löschen, und nur Anfragen mit dem Status „nicht geeignet“ oder „abgeschlossen“. Gelöscht werden Name, Kontaktdaten, Rolle, Flurstück, Hinweise, Notizen in der Historie und die Unterlage (Datei). Kennung, Datum, Status und Historie bleiben als Nachweis. Übernommene Standorte bleiben unberührt. Protokolleinträge zur Anfrage verweisen nur auf die Anfrage-ID; Ort, Name und E-Mail werden dort beim Löschen ebenfalls entfernt. Die Datei wird zuerst gelöscht, erst danach der Datensatz geändert; eine bereits fehlende Datei gilt als gelöscht, ein verwaister Verweis liefert 404. Die Löschfrist (Vorschlag 12 Monate ohne Folgekontakt) ist in der Datenschutzerklärung noch offen; eine automatische Löschung ist nicht eingerichtet.

## Benachrichtigung

Neue Anfragen erscheinen in der Liste und als Kennzahl. E-Mail-Benachrichtigungen sind nicht eingerichtet, weil es keinen freigegebenen Versandweg gibt.

## Tests

`test/akquise.test.mjs` und `test/qa-isolation.test.mjs` (Speicherbereiche, Identitätsspiegel, Löschung auf dem Blob-Pfad): Formular, Rechte, Bearbeitung, Dubletten, Übernahme, Standortakte, Löschung, öffentliche Inhalte.

## Arbeitsleitstand, Benachrichtigungen und Aufgaben (Folgeauftrag UX/Workflow)

- **Eingang einer Anfrage** (`arbeit.mjs` `anfrageEingang`, idempotent über `eingangVerarbeitet`): Kennung, Region und Zuständigkeit (`regionZuordnen`), nächste Aktion „Anfrage prüfen und Erstkontakt aufnehmen“, Status `neu`, Historieneintrag. Benachrichtigung an die zuständige Person; ohne Zuständigkeit an die Administration und in die Zuordnungswarteschlange (Filter „Nicht zugewiesen“).
- **Erstkontakt-SLA:** nur konfigurierbar über `BESS_SLA_ERSTKONTAKT_TAGE` (1–30 Kalendertage, setzt die erste Wiedervorlage). Standard: aus, weil die Geschäftsregel noch nicht entschieden ist.
- **Benachrichtigungen** (`db.benachrichtigungen`): dauerhaft, je Ereignis und Empfänger höchstens eine (fachlicher Schlüssel `art:ref:empfänger`). Ereignisse: Anfrage zugewiesen oder unzugewiesen, Aufgabe zugewiesen oder unzugewiesen, neue Nachricht, Freigabe beantragt. Hinweis im Kopf, Seite `/portal/benachrichtigungen`.
- **Outbox und E-Mail** (`src/lib/mail.mjs`): je Benachrichtigung ein Eintrag mit Status `nicht_eingerichtet | wartend | versandt | fehler`, Versuchen, Fehlertext und nächstem Versuch (höchstens 3). Konfiguration nur über `BESS_MAIL_AKTIV`, `BESS_SMTP_HOST`, `BESS_SMTP_PORT`, `BESS_SMTP_USER`, `BESS_SMTP_PASS`, `BESS_MAIL_FROM`; zusätzlich ein Transport (`registriereTransport`, z. B. SMTP über Synology MailPlus). Ohne Transport ist der Versand **nie** aktiv. Einträge mit `nicht_eingerichtet` werden nie nachträglich versandt. Die Oberfläche zeigt „Keine E-Mail versandt“.
- **Nachrichten:** Gelesen-Status je Person und Unterhaltung (`db.gelesen`); ungelesene Nachrichten sind gekennzeichnet.
- **Aufgaben** (`/portal/aufgaben`): Filter Meine, Überfällig, Nicht zugewiesen, Alle offenen, Alle. Beim Anlegen ist die Zuständigkeit Pflicht; eine Ausnahme ist nur bewusst über die Zuordnungswarteschlange möglich, mit Hinweis an die Administration. Zuweisen und Erledigen werden historisiert (`t.log`). Aufgaben aus einer Anfrage-Übernahme tragen `inquiryId`.
- **Arbeitsübersicht** (`/portal`, Zentrale): Vertrieb sieht neue Anfragen und Erstkontakte, eigene offene Anfragen, Nicht zugewiesene der Region, eigene Projekte und den nächsten Termin. Die Projektleitung sieht den Projektleitstand (Netzanschluss, Genehmigung, Risiken, offene und überfällige Maßnahmen, nicht freigegebene Unterlagen). Die Administration sieht den Gesamtüberblick (Anfragen nach Region und Status, Aufgaben je Verantwortlichem, Freigaben, Risiken).
- **Navigation:** intern gruppiert nach Arbeitsbereich, Vertrieb & Akquise, Projektentwicklung, Wirtschaftlichkeit, Energiehandel & Analyse und Administration. Jede Sichtbarkeitsbedingung ist unverändert; externe Rollen sind unverändert.
- **Kennzahl Zentrale:** „Simulierter Handels-Deckungsbeitrag je MW Leistung und Jahr“. Definition aus dem Strommarkt-Modul: Netto-Arbitrage-Deckungsbeitrag = Brutto-Handelssaldo minus variable Kosten; B2, 15 MW / 30 MWh, Variante „befreit“, rollierend 24 Monate. Die Berechnung ist unverändert.
- **Tests:** `test/arbeit.test.mjs` (Abläufe 1–8, Entdoppelung, Outbox, Rollen).
