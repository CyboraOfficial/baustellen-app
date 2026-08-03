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

## Sicherheitshinweise

- Die Content-Security-Policy ist in `index.html` definiert.
- Dateizugriffe und API-Zugriffe sind auf bekannte Quellen eingeschraenkt.

## Lizenz

Dieses Repository ist nicht als Open-Source-Projekt lizenziert.

- Projektlizenz: siehe `LICENSE.md`
- Drittanbieter-Lizenzen: siehe `THIRD_PARTY_NOTICES.md`

## Copyright

Copyright (c) 2026 CyboraOfficial. Alle Rechte vorbehalten.