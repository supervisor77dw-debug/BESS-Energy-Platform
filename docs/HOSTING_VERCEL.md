# Hosting-Architektur – GitHub und Vercel

TEMPORAERER SNAPSHOT / KEINE SSOT · Auftrag `AW-BESS-PLATFORM-GITHUB-VERCEL-004` · Stand 2026-10-28

## 1. Überblick

```
Browser
  │ HTTPS (*.vercel.app, Zertifikat von Vercel)
  ▼
Vercel Deployment Protection ("Vercel Authentication", alle Ziele)
  │  Zugang nur mit Vercel-Konto im Team oder mit zeitlich begrenztem Freigabelink
  ▼
Vercel Function api/index.mjs  (Node 22, Region fra1 Frankfurt)
  │  vercelHandler(): Produktionssperre → Speicher laden → Plattform-Handler → speichern → Antwort
  │  1. Vorschau-Schranke  2. Portal-Login + MFA  3. Rollen-/Projektprüfung (policy.mjs)
  ▼
Vercel Blob (privat, Region fra1, Store "bess-energy-platform-preview")
  ├─ state/db.json   Zustand: Konten (Hashes), Projekte, Rechte, Nachrichten, Freigaben, Protokolle, Sitzungs-Sperrliste
  └─ files/*         Dokumente und Uploads (privat, nur über die Plattform abrufbar)
```

Es gibt keinen eigenen Server, keine Fremddatenbank und keine öffentlichen Dateien. Alle Pfade, auch Bilder und Skripte, laufen über die Funktion (`vercel.json`: Rewrite `/(.*)` → `/api/index`). `public/` enthält nur einen Hinweistext.

## 2. Bewertung der Komponenten

| Komponente | Lösung auf Vercel | Begründung |
|---|---|---|
| Seiten, Portale, Illustrationen | unverändert, gerendert in der Funktion | keine Neuentwicklung; Schranke schützt alles |
| Sitzungen und Schranke | AES-256-GCM-verschlüsselte Cookies + Sperrliste im Zustand | funktioniert über beliebig viele Funktionsinstanzen; Abmelden wirkt serverseitig |
| Formular-Token (CSRF öffentlich) | HMAC mit Schlüssel aus gemeinsamem privatem Schlüssel | gleich auf allen Instanzen |
| MFA (TOTP) | Geheimnis im privaten Zustand; Ersteinrichtung per QR beim ersten Login | instanzunabhängig |
| Benutzer, Rollen, Projektgesellschaften, Projekte, Rechte | Zustandsdokument `state/db.json` | serverseitige Prüfung in `policy.mjs` unverändert |
| Dokumente, Investoren-Datenraum, Uploads | private Blobs `files/*` | nie direkt erreichbar; Download nur nach Policy-Prüfung |
| Gleichzeitige Änderungen | bedingtes Schreiben mit ETag (`head()` → `ifMatch`), bei Konflikt Drei-Wege-Zusammenführung je Datensatz | keine verlorenen Änderungen (Test `blob.test.mjs`) |
| Sperre nach Fehlversuchen | je Funktionsinstanz im Speicher | **Einschränkung:** bei mehreren Instanzen schwächer. Für die Produktion: zentraler Zähler (z. B. Redis) oder Vercel Firewall-Regeln |
| Protokolle (Audit, Downloads) | im Zustandsdokument | für die Vorschau ausreichend; für die Produktion eigene Tabelle bzw. Log-Drain |

**Grenzen des Zustandsdokuments:** Ein JSON-Dokument trägt die Vorschau (wenige Nutzer, synthetische Daten). Für den Produktivbetrieb mit vielen Nutzern und echten Daten wird eine Datenbank empfohlen (Abschnitt 5).

## 3. Schutzebenen und Umgebungen

| Ebene | Einstellung |
|---|---|
| Vercel Authentication | `ssoProtection.deploymentType = all`: Preview- **und** Produktionsadressen nur für Team-Mitglieder oder per Freigabelink |
| Produktionssperre im Code | `VERCEL_ENV=production` liefert 503, solange `BESS_ALLOW_PRODUCTION` nicht gesetzt ist |
| Produktionsumgebung | **ohne** `BESS_ACCOUNTS`: Die Plattform kann dort nicht starten (fail closed) |
| Vorschau-Schranke | auf Vercel standardmäßig aktiv (`BESS_GATE` nicht `0`) |
| Vorschau-Hilfen (Demo-Zugänge) | auf Vercel technisch ausgeschaltet |
| Cookies | `Secure; HttpOnly`, Sitzung `SameSite=Strict`, Schranke `SameSite=Lax` |
| Header | CSP ohne Inline-Skript, HSTS, `X-Frame-Options: DENY`, `noindex` überall, `no-store` im Portal |

### Umgebungsvariablen (Werte nie im Repository)

| Variable | Ziel | Typ | Inhalt |
|---|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | alle (von Vercel beim Verbinden des Stores gesetzt) | encrypted | Zugriff auf den Blob-Store. **Empfehlung:** im Dashboard auf „sensitive“ umstellen (Vercel meldet „readable-secret“). |
| `BESS_ACCOUNTS` | nur Preview | sensitive | nur scrypt-Hashes der Vorschau-Konten und Schrankenzugänge (`tools/provision-vercel.mjs`) |

## 4. Betrieb

- **Quellcode:** privates GitHub-Repository `supervisor77dw-debug/bess-energy-platform`, mit dem Vercel-Projekt verknüpft (2026-10-28).
- **Deploy (Preview):** automatisch bei jedem Push auf `develop` oder `feature/*`. Pushes auf `main` erzeugen **kein** Deployment (`vercel.json`: `git.deploymentEnabled.main = false`). Ein Produktionsdeployment erfolgt erst nach Freigabe, bewusst und manuell. Manuell ohne Git: `vercel deploy --target=preview`.
- **Abnahmestände:** Tags `v<version>` (z. B. `v1.1.0-preview`).
- **Freigabelink für Markus:** im Vercel-Dashboard am Deployment „Share“ (gültig 23 h) oder über das Team. Dazu kommen Schrankenzugang und Portalkonto aus der Zugangsdatei.
- **Zugänge neu erzeugen:**
  1. `node tools/provision-vercel.mjs`
  2. Die Datei `BESS_ACCOUNTS_*.json` als `BESS_ACCOUNTS` (Preview, sensitive) setzen.
  3. Im Blob-Store `state/db.json` löschen; der nächste Aufruf befüllt neu.
- **MFA zurücksetzen:** Portal → Verwaltung → „Zurücksetzen“ (nur Administration, protokolliert).
- **Prüfung:** `node tools/preview/verify-preview.mjs --url <preview> --zugaenge <datei>` mit `BESS_SHARE_URL=<freigabelink>`, optional `BESS_RESET_MFA=1`.
- **Rückbau:** Vercel-Projekt `bess-energy-platform` und Blob-Store `bess-energy-platform-preview` im Dashboard löschen (Löschung durch Dirk).

## 5. Externe Dienste für den Produktivbetrieb (Übersicht, nichts bestellt)

| Bedarf | Empfehlung | Alternative | Status |
|---|---|---|---|
| Relationale Datenbank mit Mandantentrennung (Row-Level-Security), Transaktionen, Protokolltabellen | **Neon Postgres** über Vercel Marketplace (Region Frankfurt) | Supabase (EU) | Entscheidung offen; Marketplace-Nutzungsbedingungen müssen von Dirk akzeptiert werden |
| Dokumentenspeicher | **Vercel Blob privat** (bereits im Einsatz) | S3-kompatibler EU-Speicher | vorhanden |
| Zentraler Zähler für Fehlversuche, Sitzungs-Sperrliste | Upstash Redis (Marketplace) oder Postgres-Tabelle | Vercel Firewall (Rate Limiting) | offen |
| E-Mail (Einladungen, Passwort-Reset, Anfragen) | EU-Anbieter mit AVV | – | offen, Versand braucht eigenen Auftrag |
| Virenscan für Uploads | Scan-Dienst bzw. Funktion vor der Freigabe | – | offen |

## 6. Kosteneinschätzung (PRÜFUNGSBEDÜRFTIG, Stand der Preise vor Bestellung prüfen)

- **Vorschau heute:** Das bestehende Vercel-Konto (Hobby) und der Blob-Store laufen im enthaltenen Kontingent. Es wurde nichts Kostenpflichtiges bestellt.
- **Wichtig:** Vercels Hobby-Tarif ist laut Nutzungsbedingungen für nicht-kommerzielle Nutzung gedacht. Für den **öffentlichen, geschäftlichen Betrieb** ist mindestens **Vercel Pro** erforderlich (pro Teammitglied monatlich, zuzüglich nutzungsabhängiger Posten). Der genaue Betrag ist vor der Entscheidung auf vercel.com/pricing zu prüfen.
- **Laufende Posten im Produktivbetrieb:**
  - Vercel Pro (Sitze)
  - Funktionsaufrufe, Datenübertragung, Blob-Speicher und -Operationen (bei der erwarteten Nutzung gering)
  - Datenbank (Neon/Supabase haben Einstiegstarife; mit Backups und Point-in-Time-Recovery kostenpflichtig)
  - Domain (jährlich)
  - E-Mail-Dienst
- Eine belastbare Monatszahl braucht die Tarifwahl. Sie wird nicht geschätzt, um keine falsche Sicherheit zu erzeugen.

## 7. Spätere Domainanbindung

1. Domainentscheidung (Marke) treffen; Domain registrieren oder vorhandene nutzen.
2. Im Vercel-Projekt unter „Domains“ hinzufügen (z. B. `www.<marke>.de` und `portal.<marke>.de`). Den DNS-Eintrag (CNAME auf `cname.vercel-dns.com` bzw. A-Record laut Vercel) beim Registrar setzen; das Zertifikat erstellt Vercel automatisch.
3. `brand.json`: `domain`, Kontaktadressen und Impressumsdaten eintragen; Arbeitsname ersetzen.
4. Produktionsfreigabe:
   - `BESS_ALLOW_PRODUCTION=1` nur in Production setzen.
   - Echte Konten statt Vorschau-Konten.
   - Schranke für den öffentlichen Teil abschalten (`BESS_GATE=0`), das Portal bleibt mit Login und MFA geschützt.
   - Deployment Protection auf „preview“ reduzieren.
   - `robots.txt` und `noindex` greifen dann automatisch nicht mehr (`BESS_MODE=production`).
5. Vorher: Rechtstexte prüfen, Datenbank einführen, Backup-Konzept betreiben.
