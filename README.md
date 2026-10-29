# Research-Skript-Helper – Inside Verbrechen Redaktionsstudio

Lokales Angular-21-MVP für Podcast-Analytics, Transkriptimport, Stilprofil, Themenverwaltung, Recherche-Dossiers und Skriptentwürfe.

## Start

Voraussetzungen: Node.js 20.19+ oder 22.12+ und npm.

```powershell
npm install
npm start
```

Die App läuft unter `http://localhost:4200`. Der vorhandene Datensatz wird beim Start aus `public/assets/analytics.csv` geladen. Die Quelldatei liegt unter `data/analytics/2015-05-01_to_2026-10-28.csv`.

## Datenimport

Unter **Podcast-Daten** kann eine eigene CSV mit Titelspalte (`name`, `title`, `episodentitel` oder `titel`) importiert werden. Titel, Plays/Downloads, Streams, Audience Size und Datum werden soweit vorhanden erkannt. Komma, Semikolon und Tabulator werden unterstützt. Beim Import ersetzt der neue Datensatz die aktuell geladene Tabelle.

TXT- und Markdown-Transkripte können mehrfach und auch nachträglich importiert werden. Das Stilprofil wird nach jedem Import automatisch aus den vorhandenen, mindestens 80 Zeichen langen Texten neu erstellt. Ein manuelles Neu-Analysieren ist ebenfalls möglich. Ohne Referenztranskripte wird der konfigurierbare sachliche Standardstil verwendet.

## Datenhaltung und Privatsphäre

Imports, Stilprofil, Themen, Dossiers, Skripte und Einstellungen liegen in `localStorage` dieses Browsers. Die redaktionellen Inhalte bleiben zunächst in localStorage; Backend-Nutzung und Jobs werden lokal in SQLite gespeichert. Das Löschen der Browserdaten entfernt damit auch die lokalen Arbeitsstände. Transkripte und Podcast-Statistiken verlassen den Browser nicht.

## Recherche und KI

Das lokale OpenAI-Backend ist optional; ohne API-Key bleiben manuelle Workflows verfügbar. KI-Vorschläge, Webrecherche, Skriptgenerierung und Fakten-Audit laufen über das Backend, sobald Key und Tokenpreise konfiguriert sind. Eingetragene Fakten und Quellen müssen redaktionell geprüft werden. Eine Dossier-Freigabe ist ein manueller Status und keine automatische Verifikation.

Themen erhalten zunächst einen neutralen Orientierungswert von 50/100. Die vorhandene CSV enthält sieben Episoden mit Titel, Plays, Streams, Audience Size und Veröffentlichungsdatum. Sie enthält keine Themenlabels, Episodenlängen oder vergleichbaren Beobachtungszeiträume. Eingetragene Quell-URLs werden gezählt, aber ihre Qualität wird nicht automatisch beurteilt.

Die Skripterstellung verwendet das freigegebene Dossier und das Stilprofil. KI-Audits liefern Prüfhilfen, keine journalistische Gewissheit.

## Entwicklung und Qualität

```powershell
npm run build
npm test -- --watch=false
```

## Architektur

- `src/app/app.ts` und `app.html`: Angular-Standalone-Oberfläche und redaktioneller Ablauf.
- `src/app/workspace.store.ts`: lokale Persistenz, CSV-Parser, Stilprofil-Analyse und transparentes neutrales Scoring.
- `public/assets/analytics.csv`: beim Start verwendete Kopie der bereitgestellten Statistikdatei.

Für öffentliche Bereitstellung sind zusätzliche Authentifizierung und Zugriffsschutz nötig.

## Lokales OpenAI-Backend (optional)

Das Backend läuft nur auf `127.0.0.1:3000`; Angular leitet `/api` über `proxy.conf.json` weiter. Benötigt Node.js 24+ (für die eingebaute SQLite-Unterstützung).

1. `Copy-Item .env.example .env`
2. In `.env` `OPENAI_API_KEY` und ein langes zufälliges `LOCAL_API_TOKEN` setzen.
3. Die aktuellen Input-/Outputpreise je Modellgruppe aus der OpenAI-Preisseite in `OPENAI_*_USD_PER_MILLION` eintragen. Websuche kostet zusätzlich je 1.000 Suchaufrufe; `WEB_SEARCH_USD_PER_1000_CALLS` ist mit 10 USD vorbelegt und `MAX_WEB_SEARCH_CALLS_PER_JOB` begrenzt die Suchaufrufe. Tokenraten fehlen: KI-Aufträge bleiben dann blockiert.
4. In zwei Terminals `npm run start:backend` und `npm start` starten. Unter Einstellungen das `LOCAL_API_TOKEN` eintragen und Backend verbinden.

Themenvorschläge, Webrecherche, Skripterstellung (nur bei freigegebenem Dossier) und Fakten-Audit laufen über die Responses API. Nutzungsdaten und Jobresultate werden in `backend/data/inside-verbrechen.sqlite` gespeichert. Der Key wird nie an Angular ausgeliefert. `.env` ist ignoriert; nur `.env.example` darf versioniert werden. Kein echter API-Key ist für Build oder Tests nötig.
