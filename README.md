# BESS Energy Platform 1.0 – Abnahmevorschau

TEMPORAERER SNAPSHOT / KEINE SSOT · Aufträge `AW-BESS-PLATFORM-20261028-001`, `AW-20261028-GE-CLAUDE-BESS-EXTERNE-VORSCHAU-002` · GRAFIK_ENGINE / Claude Code · Stand 2026-10-28 · Projekt „BESS Energy Platform“

Öffentlicher Unternehmensauftritt plus geschützte Portale (Eigentümer, Investoren, Kommunen, Technik, intern, Verwaltung) mit serverseitiger Rollen- und Projekttrennung. **Nur synthetische Daten. Nicht produktiv, nicht veröffentlicht.**

## Start (Node ≥ 22, keine Abhängigkeiten)

```
node data/seed.mjs        # synthetischen Datenbestand in data/runtime erzeugen (setzt ihn zurück)
node server.mjs           # http://127.0.0.1:4710
node --test test/platform.test.mjs   # 25 End-to-End-Tests (eigener temporärer Datenbestand)
node --test test/external.test.mjs   # 11 Tests der externen Vorschau (Schranke, MFA-Einrichtung, Sitzungen, Last, Wiederherstellung)
node tools/illustrations.mjs   # SVG-Illustrationen neu erzeugen
```

Umgebungsvariablen: `BESS_PORT`, `BESS_HOST` (Standard 127.0.0.1), `BESS_DATA_DIR`, `BESS_MODE` (`preview` | `production`), `BESS_PREVIEW_HELPERS` (`1`/`0`), `BESS_SECURE_COOKIES` (`1` hinter HTTPS).

## Vorschau-Zugänge

Synthetische Testkonten (`*@demo.invalid`) und das gemeinsame Vorschau-Passwort stehen in `data/seed.mjs` (`DEMO_PASSWORD`) und werden im Vorschaumodus auf der Login-Seite angezeigt; der aktuelle MFA-Code erscheint auf der MFA-Seite. In Produktion (`BESS_MODE=production`) ist beides abgeschaltet – Seed-Konten dürfen dort nicht verwendet werden.

## Externe Vorschau

Einrichtung, Zugangsschutz, Start/Stopp und Rückbau: `docs/EXTERNE_VORSCHAU.md`. Kurz: `node tools/provision-preview.mjs` (Daten und Zugänge außerhalb Dropbox), dann `toolspreviewstart-preview.ps1 [-Funnel]`, Abschalten mit `stop-preview.ps1`. Browser-QA: `tools/qa/run-qa.mjs`.

## Marke austauschen

`brand.json`: Name, Wortmarke, Bildmarke (`logo`, SVG), Favicon, Claim, Domain, rechtlicher Betreiber und Impressumsdaten (`legal`), Kontakt, regionale Ansprechpartner, bestätigte Partner. Farben: Token-Block `:root` in `static/css/site.css` und `portal.css` (Schicht „Marke“).

## Aufbau

| Pfad | Inhalt |
|---|---|
| `server.mjs` | HTTP-Server, öffentliche Routen, Formulare, statische Dateien |
| `src/lib/policy.mjs` | **zentrale Zugriffskontrolle** (Rollen, Projekt-/Mandantentrennung, Datenfilter) |
| `src/lib/auth.mjs` | scrypt-Passwörter, Sitzungen, TOTP-MFA |
| `src/lib/http.mjs` | Header (CSP, noindex), CSRF-Formulartoken, Multipart, Dateitypprüfung, Ratenbegrenzung |
| `src/lib/store.mjs` | JSON-Datenspeicher mit atomarem Schreiben, Audit |
| `src/public/` | öffentliche Seiten und Layout |
| `src/portal/` | Portalrouten und -ansichten (AIW Design 2.0) |
| `tools/illustrations.mjs` | Erzeugung der beispielhaften Illustrationen |
| `test/` | Sicherheits- und Rollentests |
| `docs/` | Architektur, Datenmodell, Sicherheit, visuelles Konzept |
