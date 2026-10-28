# Externe Vorschau – Architektur, Zugangsschutz, Betrieb

TEMPORAERER SNAPSHOT / KEINE SSOT · `AW-20261028-GE-CLAUDE-BESS-EXTERNE-VORSCHAU-002` · Stand 2026-10-28

## 1. Gewählte Architektur und Begründung

```
Browser (Markus, Dirk)
   │ HTTPS (gültiges Zertifikat *.ts.net, von Tailscale verwaltet)
   ▼
Tailscale Funnel auf GRAFIK_ENGINE, Port 443  ── nur dieser eine Dienst
   │ http://127.0.0.1:4711 (lokal, nicht im Netzwerk erreichbar)
   ▼
BESS-Plattform (Node 22, BESS_GATE=1)
   1. Vorschau-Schranke  (Prüferkennung + Passwort, eigene Sitzung)
   2. Portal-Anmeldung   (eigenes Konto, MFA für Admin/Vertrieb/Projektleitung/Investor)
   3. Rollen-/Projektprüfung serverseitig (policy.mjs)
Laufzeitdaten: C:\dev\bess-preview\runtime (außerhalb Dropbox, nur synthetisch)
```

Geprüfte vorhandene Infrastruktur:

| Option | Ergebnis |
|---|---|
| **Tailscale** auf GRAFIK_ENGINE | vorhanden, Admin-Konto Dirk; bestehender Serve-Eintrag `:8792 → 127.0.0.1:8790` (nur Tailnet) bleibt unberührt. **Funnel ist im Tailnet noch nicht freigeschaltet** (siehe §4). Gewählt: kostenfrei, HTTPS mit gültigem Zertifikat, auf einen Port begrenzt, mit einem Befehl abschaltbar. |
| Vercel (Team supervisor77dw-debugs-projects, Leuchtturm-Previews) | ungeeignet ohne Umbau: Die Plattform ist ein zustandsbehafteter Server (Sitzungen, Uploads, Protokolle); Vercel-Funktionen sind zustandslos mit flüchtigem Dateisystem. Vercel-Zugangsschutz verlangt Vercel-Konten bzw. kostenpflichtige Passwortfunktion. |
| Server `leuchtturm` im Tailnet | gehört zum Projekt Leuchtturm – nicht verwendet (keine projektfremde Infrastruktur). |
| Neue Domain / Hosting | nicht bestellt (nicht freigegeben). |

## 2. Zugangsschutz (Schichten)

1. **Netzwerk:** Der Server lauscht nur auf `127.0.0.1`. Von außen erreichbar ist ausschließlich Funnel-Port 443 → `127.0.0.1:4711`.
2. **Vorschau-Schranke** (`src/lib/gate.mjs`):
   - Sie liegt vor jeder Seite, jedem Bild, robots.txt, den Formularen und dem Portal. Ohne Schranke sind nur die Schrankenseite, ihr Stylesheet und das Favicon erreichbar.
   - Zugänge: je Prüfer eine Kennung (`dirk`, `markus`) mit Zufallspasswort; in `gate.json` stehen nur scrypt-Hashes.
   - Sperre nach 10 Fehlversuchen je IP für 15 Minuten. Die IP wird hinter dem lokalen Proxy aus `X-Forwarded-For` gelesen.
   - Cookie `HttpOnly; Secure; SameSite=Lax`, Gültigkeit 12 h. Abmeldung über `/_vorschau/abmelden`.
3. **Portal-Anmeldung:**
   - Eigenes Konto mit Zufallspasswort.
   - **MFA (TOTP) wird beim ersten Login eingerichtet** (QR-Code) und danach erzwungen, für Dirk, Markus, Projektleitung und Investoren.
   - Sitzung 8 h, Leerlauf 30 min, Sitzungserneuerung nach MFA.
4. **Rechte:** unverändert serverseitig je Rolle, Projekt und Bereich; nicht sichtbare Objekte liefern 404.
5. **Indexierung:** `X-Robots-Tag: noindex` auf allen Antworten, `robots.txt: Disallow: /`. Das ist nur eine Zusatzmaßnahme, **kein Zugriffsschutz**.
6. **Keine Demo-Zugangsdaten:** Hinter der Schranke sind die Vorschau-Hilfen technisch abgeschaltet (`config.previewHelpers` ist bei `BESS_GATE=1` immer aus). Der Test prüft das.

## 3. Testzugänge

| Prüfer | Schranke | Portal-Konto | Rolle | MFA |
|---|---|---|---|---|
| Dirk | `dirk` | `dirk@bess-vorschau.invalid` | Plattformadministration | Pflicht, Ersteinrichtung |
| Markus | `markus` | `markus@bess-vorschau.invalid` | Vertriebskoordination Nord | Pflicht, Ersteinrichtung |
| (Dirk, fachliche Prüfung) | `dirk` | synthetische Rollenkonten `*@demo.invalid` | Projektleitung, Eigentümer A/B, Investor A/B, Kommune, Technik | je Rolle |

- Die Passwörter erzeugt `tools/provision-preview.mjs` zufällig. Sie stehen **nur** in `C:\Users\dirk\BESS-Preview-Zugaenge\ZUGAENGE_BESS-Vorschau_<Zeitstempel>.txt`. Der Ordner liegt außerhalb von Dropbox; das Zugriffsrecht hat nur das Windows-Konto `dirk`.
- Weitergabe an Markus: persönlich durch Dirk (telefonisch oder verschlüsselter Messenger), Schranke und Portal getrennt. Nicht per unverschlüsselter E-Mail.
- Ein erneutes Provisionieren setzt alle Zugänge und Daten zurück; die alten Zugänge werden damit ungültig.

## 4. Freischaltung (einmalig, durch Dirk als Tailnet-Admin)

Funnel ist im Tailnet noch nicht aktiviert. Tailscale hat für GRAFIK_ENGINE folgenden Freischaltlink ausgegeben:

`https://login.tailscale.com/f/funnel?node=nVoaFxKKsZ11CNTRL`

Mit dem Link werden im Tailnet die HTTPS-Zertifikate aktiviert und dem Knoten das Funnel-Recht gegeben (Richtlinienänderung im Tailscale-Adminbereich). Danach:

```
powershell -File tools\preview\start-preview.ps1 -Funnel
```

Erwartete Adresse: **https://grafik-engine.tail01a4a3.ts.net/** (Name laut `tailscale status`).

Hinweis: Mit Funnel wird der Rechnername `grafik-engine.tail01a4a3.ts.net` öffentlich auflösbar und erscheint in Zertifikats-Transparenzprotokollen. Erreichbar ist trotzdem nur die Schrankenseite.

## 5. Betrieb, Abschaltung, Rückbau

- **Start:** `tools\preview\start-preview.ps1 [-Funnel]`. Der Server läuft im Hintergrund; PID und Logs liegen in `C:\dev\bess-preview\`.
- **Abschalten:** `tools\preview\stop-preview.ps1`. Das Skript entfernt den Funnel auf 443, beendet den Server und lässt andere Serve-Einträge unberührt.
- **Verfügbarkeit:** Die Vorschau ist nur erreichbar, solange GRAFIK_ENGINE eingeschaltet und angemeldet ist.
- **Sicherung:** `node tools\backup-runtime.mjs --runtime C:\dev\bess-preview\runtime --backups C:\dev\bess-preview\backups`
- **Wiederherstellung** (Server vorher stoppen): wie Sicherung, zusätzlich `--restore <name>`. Die Funktion ist im Test nachgewiesen.
- **Vollständiger Rückbau:**
  1. `stop-preview.ps1` ausführen.
  2. `C:\dev\bess-preview` und `C:\Users\dirk\BESS-Preview-Zugaenge` löschen (Löschung durch Dirk).
  3. Falls gewünscht, die Funnel-Freischaltung im Tailscale-Adminbereich zurücknehmen.
- **Isolation:** eigener Port, eigenes Datenverzeichnis, keine Verbindung zu Hub, CRM, Mail oder produktiven Datenbanken. Formulare versenden keine E-Mails.

## 6. SSO-Vorbereitung (Nutzerentscheidung 2026-10-28)

- **Extern** (Eigentümer, Investoren, Kommunen, Partner): bleiben dauerhaft in der Plattformauthentifizierung.
- **Intern** (Admin, Projektleitung, Vertrieb): perspektivisch Anmeldung über Hub `aiw.hub.sso/2` (Ed25519, 60 s, einmalig, zielgruppengebunden), sobald M-2 des IAM-Berichts produktiv ist. Vorgesehene Anbindung:
  1. Neuer Anmeldeweg `/portal/sso` prüft den Nachweis gegen den öffentlichen Hub-Schlüssel und die Zielgruppe `bess-platform`.
  2. Zuordnung über die Hub-Identität (`u_…`) zu einem internen Plattformkonto (Feld `hubId`); keine automatische Kontoanlage.
  3. Rollen werden weiter in der Plattform vergeben, damit die Projekt- und Bereichstrennung erhalten bleibt. Hub-Rechte steuern nur „darf sich anmelden“.
  4. Passwort-Login für interne Konten danach abschaltbar; MFA erfolgt im Hub.
- In diesem Auftrag gibt es **keine** Anbindung und **keine** Änderung an Hub-Berechtigungen.
