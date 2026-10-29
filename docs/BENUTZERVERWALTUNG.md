# Administrationsanleitung – Benutzer & Berechtigungen

Stand: AW-BESS-STROMKAI-BENUTZERVERWALTUNG-009 (2026-10-29). Gilt für die Abnahmeplattform STROMKAI (Arbeitsname).

## Anmeldung
- **Ablauf:** „Login / Partnerportal“ öffnen, E-Mail-Adresse und Passwort eingeben. Danach geht es direkt in den eigenen Bereich, ohne Bestätigungscode und ohne QR-Code.
- **Einmaliger Wechsel:** Wer ein Startpasswort oder ein Einmalpasswort erhalten hat, legt bei der ersten Anmeldung einmalig ein eigenes Passwort fest.
- **Anforderungen an Passwörter:** mindestens 12 Zeichen, Buchstaben und mindestens eine Ziffer oder ein Sonderzeichen, nicht der Benutzername.
- **Sperre nach Fehlversuchen:** Nach 5 falschen Passwörtern innerhalb von 15 Minuten ist das Konto für 15 Minuten gesperrt. Die Administration kann die Sperre vorher aufheben (Benutzer → „Benutzer entsperren“).
- **Zwei-Faktor-Anmeldung (MFA):** technisch vorhanden, derzeit ausgeschaltet. Einschalten über die Umgebungsvariable `BESS_MFA`, wirksam mit der nächsten Bereitstellung:
  - `privilegiert`: MFA nur für Plattformadministration und Projektleitung;
  - `konto`: MFA für alle Konten mit MFA-Merker (interne Rollen, Investoren).
- Vor einem Echtbetrieb mit sensiblen Investorenunterlagen ist eine erneute Sicherheitsfreigabe vorgesehen, mindestens mit `BESS_MFA=privilegiert`.

## Menüpunkt „Benutzer & Berechtigungen“ (nur Plattformadministration)

| Reiter | Zweck |
|---|---|
| Benutzerübersicht | alle Konten mit Rollen, Projekten, Status und letzter Anmeldung; Suche nach Name/E-Mail, Filter nach Rolle, Status und Projekt |
| Neuen Benutzer einladen | Konto vorbereiten und Aktivierungslink erzeugen |
| Gesperrte Benutzer | Übersicht aller gesperrten Konten |
| Einladungen | Status aller Einladungs- und Rücksetzlinks (offen, verwendet, abgelaufen, widerrufen); offene Links widerrufen |
| Änderungsprotokoll | jede Änderung an Konten, Rollen, Rechten, Sperren, Einladungen und Passwörtern mit Zeit und ausführender Person |

## Neuen Benutzer einladen
1. „Neuen Benutzer einladen“ öffnen.
2. Name und E-Mail-Adresse eingeben. Die E-Mail-Adresse ist der spätere Benutzername.
3. Rolle(n) ankreuzen.
4. Projekte ankreuzen. Sie gelten für alle gewählten projektbezogenen Rollen. Bei Grundstückseigentümern zusätzlich den Eigentümer-Kontakt wählen; er bestimmt, welche Grundstücke und Dokumente sichtbar sind.
5. „Einladung erzeugen“ wählen. Es erscheint ein **einmaliger Aktivierungslink**, gültig 72 Stunden.
6. Den Link sicher übergeben. Solange noch kein E-Mail-Dienst eingerichtet ist:
   - persönlich oder über einen verschlüsselten Messenger (Signal, Threema);
   - nicht zusammen mit anderen Zugangsdaten;
   - nicht in Gruppen.
7. Die Person öffnet den Link, legt ihr Passwort fest und meldet sich danach regulär an.

Gespeichert wird nur eine Prüfsumme des Links; er kann nicht noch einmal angezeigt werden. Geht er verloren: Benutzer öffnen → „Neuen Einladungslink erzeugen“. Der alte Link wird dabei ungültig.

## Benutzer bearbeiten
Benutzerübersicht → „Bearbeiten“.
- **Stammdaten:** Name und E-Mail-Adresse ändern.
- **Rollen:**
  - Mehrere Rollen sind möglich, jede Rolle gilt nur für die Projekte, für die sie freigeschaltet ist.
  - Entfällt eine Rolle, entfallen auch ihre Projektberechtigungen.
  - Die Rolle Plattformadministration erfordert eine ausdrückliche Bestätigung.
  - Die eigene Administrationsrolle kann man sich nicht selbst entziehen.
- **Projektberechtigungen:** „Rolle“ und „Projekt“ wählen, dann „Berechtigung erteilen“. „Entziehen“ entfernt eine einzelne Berechtigung. **Änderungen wirken sofort**, auch in laufenden Sitzungen.
- **Ergebnis: sichtbare Projekte:** zeigt, was die Person aktuell sehen darf. Die Liste wird serverseitig berechnet.

| Rolle | sieht |
|---|---|
| Plattformadministration | alles, einschließlich Benutzerverwaltung und Protokoll |
| Projektleitung | zugeordnete Projekte vollständig, einschließlich interner Finanzunterlagen |
| Vertriebskoordination Nord/Süd | Projekte der Region (ohne Einzelzuordnung) bzw. nur die zugeordneten Projekte; Eigentümer-, Kommunal- und interne Unterlagen; **keine** Finanzmodelle |
| Grundstückseigentümer | nur eigene Grundstücke, eigene Verträge und für Eigentümer freigegebene Unterlagen |
| Investor | je freigeschaltetem Projekt nur den freigegebenen Datenraum |
| Kommune / Technischer Partner | je freigeschaltetem Projekt nur die kommunalen bzw. technischen Unterlagen |

## Sperren, Passwort, Sitzungen
- **Benutzer sofort sperren:** Anmeldung ab sofort unmöglich; alle laufenden Sitzungen enden sofort; offene Einladungslinks werden widerrufen. Ein Grund kann angegeben werden und erscheint im Protokoll.
- **Benutzer entsperren:** Anmeldung wieder möglich. Frühere Sitzungen bleiben ungültig.
- **Passwort zurücksetzen:** „Link zum Zurücksetzen des Passworts erzeugen“. Der Link ist einmalig und 24 Stunden gültig und wird wie eine Einladung übergeben. Nach Verwendung enden alle bestehenden Sitzungen der Person.
- **Alle Sitzungen beenden:** meldet die Person überall ab, ohne zu sperren.
- **MFA-Einrichtung zurücksetzen:** nur relevant, wenn MFA eingeschaltet ist.

## Sicherheit (Kurzfassung)
- Passwörter werden mit scrypt gehasht und nie im Klartext gespeichert oder versendet. Einladungs- und Rücksetzlinks sind zufällig (256 bit), einmalig, ablaufend und nur als SHA-256 gespeichert.
- Jede Seite und jeder Download prüft die Berechtigung serverseitig. Ausgeblendete Schaltflächen sind kein Schutz und werden auch nicht als solcher verwendet.
- Verwaltungsaktionen nur für die Plattformadministration, jeweils mit Sicherheitstoken (CSRF). Nicht berechtigte Aufrufe enden mit „nicht gefunden“.
- In der Verwaltung angelegte Konten bleiben vom Kontenabgleich der Bereitstellung (`BESS_ACCOUNTS`) unberührt.
- **Grenzen der Abnahmephase:** Es gibt noch keinen E-Mail-Dienst (manuelle Linkübergabe). Speicherung im privaten Vercel-Blob-Speicher ohne Datenbank; eine Datenbank ist für den Echtbetrieb vorgesehen.
