# Baustellen-App

Desktop- und Web-Anwendung zur Verwaltung von Baustellenprojekten.

Die Anwendung kombiniert:
- React + Vite als Frontend
- Electron als Desktop-Runtime
- PocketBase als Backend (Auth + Daten)

## Funktionen

- Projektverwaltung mit Status, Filtern und Detailansicht
- Kartenansicht mit OpenStreetMap/Leaflet
- Datei-Upload und projektbezogene Dokumentablage
- Desktop-spezifische Dateisystem-Funktionen (Ordner oeffnen, lokale Projektstruktur)
- Auto-Update fuer die Electron-Anwendung
- Kopierbare Projektvorlage mit Mastaktionen und geplanten Leuchten; LK / SiKa Tausch wird separat gezaehlt.

## Technologie-Stack

| Bereich | Technologie |
| :--- | :--- |
| Frontend | React, Vite |
| Mapping | Leaflet, React-Leaflet |
| Desktop | Electron, electron-builder, electron-updater |
| Backend | PocketBase |

## Voraussetzungen

- Node.js (LTS empfohlen)
- npm
- PocketBase (lokal oder remote)

## Lokale Entwicklung

1. Repository klonen

```bash
git clone https://github.com/CyboraOfficial/baustellen-app.git
cd baustellen-app
```

2. Abhaengigkeiten installieren

```bash
npm install
```

3. PocketBase starten (lokal, Standard-Port)

```bash
pocketbase serve --http=127.0.0.1:8090
```

4. Frontend starten

```bash
npm run dev
```

Hinweis zur Backend-URL:
- In Entwicklung nutzt die App `http://127.0.0.1:8090`
- Im Production-Modus nutzt sie `https://app.elektro-hegener.de`

Die Umschaltung erfolgt in `src/pocketbase.js` anhand von `import.meta.env.MODE`.

## Deployment

Nach erfolgreicher Versionierung eines Pushes auf `master` deployt GitHub
Actions das Web-Frontend aus demselben Versionsstand wie den Electron-Build.
Versionierte Migrationen und Hooks werden zunächst auf dem VPS verglichen.
Nur bei Änderungen werden sie übernommen, Migrationen ausgeführt und
`pocketbase.service` neu gestartet. So gehen auch bei übersprungenen älteren
Deployments keine Dateien verloren. Die alten lokalen Migrationen, die in
`.gitignore` stehen, werden bewusst nicht hochgeladen.

Über **Actions → Deploy to VPS → Run workflow** lässt sich das Deployment
weiterhin manuell starten.

Der SSH-Benutzer aus dem GitHub-Secret `SERVER_USER` muss in dieses Verzeichnis
schreiben dürfen und `sudo -n systemctl restart pocketbase.service` ohne
Passwortabfrage ausführen dürfen. Der Workflow prüft anschließend, ob der
Dienst wieder aktiv ist. Temporäre Deployment-Verzeichnisse und eine
Wiederholungsmarkierung werden unter `/root/pb` angelegt.

## Electron-Releases

Bei einem Push auf `master` erhöht GitHub Actions die Patch-Version in
`package.json` und `package-lock.json`, commitet die Änderung und erstellt den
zugehörigen Tag (z. B. `v1.5.2`). Anschließend baut und veröffentlicht der
bestehende Electron-Workflow das Release. Manuell gepushte `v*`-Tags lösen
den Release-Workflow weiterhin aus.

Nutzerrelevante Änderungen werden als kurze deutsche Stichpunkte unter
`Unveröffentlicht` in [APP_CHANGELOG.md](./APP_CHANGELOG.md) eingetragen.
Der Versionsworkflow übernimmt sie in den Abschnitt der neuen Version; ohne
Einträge wird ebenfalls veröffentlicht. KI-Assistenten werden über die
Repository-Anweisungen zur Pflege angehalten. Es wird kein KI-Dienst automatisch
aufgerufen, daher müssen andere Änderungen bei Bedarf manuell dokumentiert
werden. Die ignorierte lokale `CHANGELOG.md` bleibt davon unberührt.

Nach einem Update zeigt die App die seit dem bestätigten Stand verpassten
Änderungen an. Der Stand wird nach Anmeldung pro Konto in PocketBase gespeichert
und zwischen Web und Desktop synchronisiert. Beim ersten Öffnen wird zunächst
ein Ausgangsstand ohne Popup gespeichert. Dafür müssen die neue Migration und
der neue PocketBase-Hook auf dem Server installiert sein. „Später“ schließt den
Hinweis, ohne die Änderungen als gelesen zu markieren.

Major und Minor werden in `package.json` vorgegeben: Aus `1.5.0` wird beim
nächsten Push beispielsweise `1.5.1`. Die Versionsnummer muss dem Format
`major.minor.patch` entsprechen und der nächste Tag darf noch nicht existieren.
Entwicklungsbranches sollten regelmäßig mit `master` abgeglichen werden, damit
Versionsänderungen nicht verloren gehen oder Merge-Konflikte verursachen.

GitHub Actions benötigt Schreibrechte für Repository-Inhalte und muss auf
`master` pushen dürfen. Branch-Schutzregeln können den Versions-Commit
verhindern; in diesem Fall schlägt der Workflow sichtbar fehl. Der automatisch
erzeugte Commit und Tag verwenden `GITHUB_TOKEN` und starten daher keine
weiteren Push-Workflows. Release und Web-Deployment werden stattdessen direkt
aufgerufen.

## NPM-Skripte

- `npm run dev`: Vite Entwicklungsserver
- `npm run electron`: Electron mit aktuellem Build starten
- `npm run start`: Vite und Electron parallel starten
- `npm run electron:dev`: Alternative parallele Dev-Ausfuehrung
- `npm run build`: Web-Build nach `dist/`
- `npm run preview`: Lokale Vorschau des Web-Builds
- `npm run dist`: Electron-Distribution bauen
- `npm run publish`: Build und GitHub-Release-Publish

## Projektstruktur

Wichtige Verzeichnisse:

- `src/`: React-Anwendung
- `electron/`: Electron Main/Preload Prozesse
- `public/`: Statische Assets
- `pb_migrations/`: PocketBase Migrationen
- `pb_data/`: Lokale PocketBase-Daten (entwicklungsnaher Zustand)

## UI/UX-Richtlinie

Für konsistente Oberflächen und UI-Änderungen gilt der [UI/UX-Leitfaden](./UI_UX_GUIDELINES.md). Er dokumentiert Layout, Farben, Komponenten, Interaktionen, Barrierefreiheit und responsive Regeln und kann als Referenz für Entwickler und KI-Assistenten verwendet werden.

## Sicherheitshinweise

- Die Content-Security-Policy ist in `index.html` definiert.
- Dateizugriffe und API-Zugriffe sind auf bekannte Quellen eingeschraenkt.

## Lizenz

Dieses Repository ist nicht als Open-Source-Projekt lizenziert.

- Projektlizenz: siehe `LICENSE.md`
- Drittanbieter-Lizenzen: siehe `THIRD_PARTY_NOTICES.md`

## Copyright

Copyright (c) 2026 CyboraOfficial. Alle Rechte vorbehalten.