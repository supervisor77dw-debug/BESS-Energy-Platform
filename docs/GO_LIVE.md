# Go-live der öffentlichen Website (STROMKAI)

Auftrag: AW-20261114-GE-CLAUDE-STROMKAI-GOLIVE-VORBEREITUNG-022 · Stand 2026-11-14 · Status: vorbereitet, **gesperrt**

## Prinzip

Website und Portal werden getrennt freigeschaltet.

| Schalter | Wirkung | Wirkt **nicht** auf |
|---|---|---|
| `isPublicLive()` (`src/config.mjs`) | Öffentliche Seiten: `noindex`, Vorschauleiste, kanonische URL, `robots.txt`, `sitemap.xml`, Entwurfshinweise | Portal, Datenmodus, Echtdaten |
| `BESS_MODE` / `isPreview()` | Portal: Demo-Hinweise, Kennzeichnung synthetischer Finanzstände | öffentliche Indexierung |
| `BESS_AKQUISE_ECHTDATEN` | Echtdaten in der aktiven Akquise (nur Stufe `abnahme`) | Website |

`BESS_MODE=production` ist für den Website-Start **nicht** nötig und darf dafür nicht gesetzt werden. Der Schalter würde Finanzstände im Portal als nicht synthetisch behandeln.

## Bedingungen der Freischaltung (`goLiveSperren()`)

1. `BESS_OEFFENTLICH=1` im Production-Ziel (nur nach Produktivfreigabe durch Dirk).
2. Stufe `abnahme` (Vercel Production).
3. `brand.domain` ist eine echte Domain.
4. `brand.legal`: Rechtsträger/Rechtsform, Anschrift, Vertretung, Register (oder „entfällt“ mit Begründung), V.i.S.d. § 18 MStV – ohne Platzhalter.
5. `brand.contact.email` ist eine echte Adresse.
6. `brand.freigaben.impressum`, `.datenschutz`, `.marke` sind `true`. Dirk setzt sie nach Kanzleiprüfung bzw. Markenrecherche.

Prüfung ohne Nebenwirkung: `node tools/golive-pruefen.mjs` (Exit 1 = gesperrt, Liste der offenen Punkte).

## Domains

- Hauptdomain `https://stromkai.de` (Entscheidung C-1 vorbehalten).
- `brand.domainAliases` (`www.stromkai.de`, `stromkai.com`, `www.stromkai.com`) werden von der Anwendung per 308 auf die Hauptdomain umgeleitet; Pfad und Query bleiben erhalten. Vorrangig sollte die Weiterleitung zusätzlich in Vercel je Domain eingerichtet werden („Redirect to“).
- `*.vercel.app` und `localhost` werden nie umgeleitet (QA bleibt erreichbar).

## Ablauf nach Freigabe (nicht Teil von -022)

1. Domains im Vercel-Projekt hinzufügen. Die angezeigten DNS-Werte in die AutoDNS-Änderungsliste übernehmen.
2. DNS bei AutoDNS setzen und warten, bis Vercel „Valid Configuration“ und das Zertifikat meldet.
3. Integration `main` ← `golive/kandidat-aw-022` (Fast-Forward, siehe Bericht -022) und Production-Deployment.
4. `node tools/golive-pruefen.mjs` → Exit 0, dann `BESS_OEFFENTLICH=1` setzen und neu deployen.
5. Nachprüfung: Header, robots, Sitemap, Weiterleitungen, Formulare, mobile Darstellung.
6. Rückfall: `BESS_OEFFENTLICH` entfernen und neu deployen. Die Website ist dann sofort wieder `noindex` mit Vorschauleiste.
