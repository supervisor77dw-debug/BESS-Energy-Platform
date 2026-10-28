# Architektur, Datenmodell, Rollen und Sicherheit – BESS Energy Platform 1.0

TEMPORAERER SNAPSHOT / KEINE SSOT · `AW-BESS-PLATFORM-20261028-001` · Stand 2026-10-28

## 1. Informationsarchitektur

**Öffentlich:** Startseite · Unternehmen und Netzwerk · Batteriespeicher und Technologie · Standortentwicklung (10 Phasen) · Für Grundstückseigentümer · Fläche anbieten (Formular) · Für Kommunen · Für Investoren · Projekte (nur freigegebene) · Kontakt (Formular, Anliegen-Auswahl) · Impressum · Datenschutz (beide als Entwurf markiert) · robots.txt · sitemap.xml.

**Portal (`/portal`, gemeinsamer Login):** Übersicht (rollenabhängig) · Pipeline · Projekte/Projektdetail · Grundstücke und Verträge · Dokumente/Datenraum (Upload, Download mit Protokoll) · Nachrichten · Kontakte · Aufgaben und Fristen · Anfragen (aus Formularen) · Freigaben (Vier-Augen) · Protokoll · Verwaltung (Konten, Rollen, Projektzugriffe, Projektgesellschaften) · KI-Assistenz (vorbereitet, deaktiviert).

## 2. Datenmodell

| Sammlung | Zweck | Wesentliche Felder |
|---|---|---|
| `spvs` | Projektgesellschaften | Name, `legalStatus` (`geplant` / `in Gründung` / `gegründet`), Hinweis |
| `projects` | Projekt je Standort | Projekt-ID, Code, Name, Region, Standort, `spvId`, Phase 1–10, Vertrags-/Netz-/Genehmigungsstatus, `tech` (MW, MWh, Fläche, Anbindung, Variante), `econ` (Bandbreiten + `meta`: Status, Quelle, Stand, Annahmen), Risiken, Eigentümer-Meldungen, `publicRelease` |
| `parcels` | Grundstücke | Projekt, Eigentümerkontakt, Gemarkung/Flur/Flurstück, Größe, Entwicklungsfläche, Nutzung, Status |
| `contracts` | Verträge | Projekt, Grundstück, Eigentümer, Typ, Status, Grundlage, Eckdaten |
| `documents` | Dokumente | Projekt, **Bereich** (`eigentuemer`, `investor`, `kommune`, `technik`, `intern`, `intern_finanzen`), optional Eigentümerbindung, Status (`entwurf`/`eingereicht`/`freigegeben`), Version(en), Quelle, Stand |
| `grants` | Projektfreischaltungen | Konto, Projekt, Bereich (= Rolle), erteilt von/am |
| `users` | Konten | Rolle, MFA, TOTP-Geheimnis, Kontaktbezug (Eigentümer), zugewiesene Projekte (Projektleitung) |
| `contacts`, `appointments`, `tasks`, `messages` | CRM-Grundfunktionen | jeweils projektgebunden |
| `approvals` | Freigaben | Art (Dokumentfreigabe, öffentliche Projektdarstellung), Antragsteller, Entscheider, Zeitpunkte |
| `inquiries` | Formulareingänge | Status, Angaben, optionale Anlage |
| `audit`, `downloads` | Nachvollziehbarkeit | Zeit, Person, Ereignis, Dokument, Version |

Mandant = Plattform; Trennung erfolgt auf Ebene **Projektgesellschaft → Projekt → Bereich → Rolle → (bei Eigentümern) Kontakt**.

## 3. Rollen und Sichtbarkeit

| Rolle | Projekte | Dokumentbereiche | Finanzkennzahlen | Grundstücke/Verträge | Verwaltung |
|---|---|---|---|---|---|
| Plattformadministration | alle | alle | ja | alle | ja, entscheidet Freigaben |
| Projektleitung | zugewiesene | alle | ja | in eigenen Projekten | nein, beantragt Freigaben |
| Vertriebskoordination Nord / Süd | Region | Eigentümer, Kommune, Intern | nein | Region | nein |
| Grundstückseigentümer | über eigene Grundstücke | Eigentümer (eigene + allgemeine) | nein | nur eigene | nein |
| Investor | ausdrücklich freigeschaltete | Investoren-Datenraum (nur freigegeben) | ja (mit Status/Quelle/Stand/Annahmen) | nein | nein |
| Kommunaler Partner | freigeschaltete | Kommune (nur freigegeben) | nein | nein | nein |
| Technischer Partner | freigeschaltete | Technik (nur freigegeben) | nein | nein | nein |

Vertriebskoordination Süd ist als Rolle vorhanden, aber **nicht besetzt**.

**Durchsetzung:** ausschließlich serverseitig in `src/lib/policy.mjs`. Jede Route lädt Daten nur über Filterfunktionen (`listProjects`, `getDocument`, `listParcels` …). Nicht sichtbare Objekte liefern **404** (keine ID-Ausspähung). Es gibt keine öffentliche JSON-API.

## 4. Sicherheit

| Anforderung | Umsetzung in der Vorschau | Für Produktion offen |
|---|---|---|
| Authentifizierung | scrypt-Hashes, serverseitige Sitzungen (8 h, 30 min Leerlauf), Cookie `HttpOnly; SameSite=Strict` (+`Secure` hinter HTTPS), Sitzungserneuerung nach MFA | persistente Sitzungen, Passwort-Reset-Prozess, Einladungsablauf |
| MFA | TOTP Pflicht für Admin, Projektleitung, Vertrieb, Investoren; für Eigentümer/Kommune/Technik konfigurierbar | Passkeys, Wiederherstellungscodes |
| Vorschau-Schranke | Zusätzliche Anmeldung vor der gesamten Website bei externer Vorschau (`BESS_GATE=1`), siehe `docs/EXTERNE_VORSCHAU.md` | entfällt im Produktivbetrieb bzw. wird durch Produktiv-Zugangskonzept ersetzt |
| MFA-Ersteinrichtung | TOTP-Einrichtung mit QR-Code beim ersten Login, danach erzwungen | Wiederherstellungscodes |
| Brute-Force | Fehlversuchssperre je Konto (6/15 min) und IP (30/15 min), MFA 5 Versuche | – |
| CSRF | Sitzungstoken in allen Portal-POSTs, signierte Formulartoken öffentlich, SameSite=Strict | – |
| XSS | konsequentes Escaping (`html```), strikte CSP ohne Inline-Skript | – |
| Uploads | Typprüfung über Dateisignatur (PDF/JPG/PNG), 10 MB, zufällige Dateinamen außerhalb des Web-Roots | Virenscan, Speicherverschlüsselung |
| Dokumente | Download nur nach Policy-Prüfung, `attachment`, `no-store`, Downloadprotokoll mit Version | Wasserzeichen je Empfänger |
| Indexierung | Portal: `X-Robots-Tag: noindex`, `Cache-Control: no-store`; Vorschau komplett `noindex` + `robots.txt Disallow: /` | – |
| Freigaben | Dokumentfreigaben und öffentliche Projektdarstellung nur per Antrag + Entscheidung durch andere Person (Admin) | Mehrstufige Freigaben je Gesellschaft |
| Transport | HSTS + Secure-Cookies per `BESS_SECURE_COOKIES=1` | TLS-Terminierung (Reverse Proxy) |

### Backup und Wiederherstellung (Konzept)
- Datenbestand = `data/runtime/db.json` + `files/`. Atomare Schreibvorgänge (tmp + rename).
- Produktion: tägliche verschlüsselte Sicherung (Datenbank-Dump + Dateiablage), 30 Tage täglich / 12 Monate monatlich, Ablage getrennt vom Server; quartalsweiser Wiederherstellungstest mit Protokoll.

### Test und Produktion
- `BESS_MODE=preview` (Standard): synthetische Daten, Vorschau-Hilfen, alles `noindex`.
- `BESS_MODE=production`: Vorschau-Hilfen aus, eigener Datenpfad, keine Seed-Konten. **Produktivstart ist nicht Teil dieses Auftrags.**

### Produktreife-Pfad (Empfehlung)
JSON-Speicher → PostgreSQL mit Row-Level-Security je Projektgesellschaft; Dateien → verschlüsselter Objektspeicher; Policy-Modul bleibt als zweite Schicht erhalten.

## 5. SSO / AIW-Hub – Bewertung

Der AIW-Hub (3.6.x) ist die Identitätsquelle für **Mitarbeitende**. Laut IAM-Bericht `AW-20261027-DK-CLAUDE-AIW-GLOBAL-IAM-KONSOLIDIERUNG-001` signiert `aiw.hub.sso/1` alle Module mit einem gemeinsamen Schlüssel (R-03); `sso/2` (Ed25519, zielgruppengebunden) ist geplant (M-2). Externe Portale mit eigener Benutzerverwaltung sind dort als Abweichung R-06 geführt.

**Entschieden (Dirk, Folgeauftrag -002 vom 2026-10-28):** Externe Stakeholder bleiben in der Plattformauthentifizierung; interne Rollen werden perspektivisch über Hub `sso/2` angebunden. Anbindungsentwurf: `docs/EXTERNE_VORSCHAU.md` §6. Noch keine Anbindung, keine Änderung an Hub-Berechtigungen.

## 6. Integration Excel-Vergütungsmodell

`BESS_Flaechensicherung_Verguetungsmodell_v0_2.xlsx` bleibt interne fachliche Grundlage (Status laut `KNOWLEDGE_SOURCES.md`: `UNGEKLAERT + SSOT_KANDIDAT`). Keine Web-Integration, keine automatische Preis-/Pachtberechnung aus Formularen. Voraussetzung für eine spätere Integration: geprüfte, versionierte Berechnungslogik und Vertragsparameter.
