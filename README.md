# 🏗️ Baustellen-App

Eine moderne Desktop- und Web-Applikation zur effizienten Verwaltung von Bauprojekten. Diese Anwendung kombiniert die Geschwindigkeit einer Single Page Application (SPA) mit der Systemintegration einer Desktop-Software.

## 🚀 Key Features

*   **Hybrid-Plattform:** Nutzbar als installierbare Windows-Anwendung (.exe) via Electron oder als Progressive Web App (PWA) im Browser.
*   **Projekt-Dashboard:** Komplette Übersicht aller Baustellen mit Filter- und Sortierfunktionen.
*   **Intelligente Ordnerstruktur:** Automatisches Erstellen und Öffnen von lokalen Projektordnern direkt aus der App (Desktop-exklusiv).
*   **Echtzeit-Backend:** Daten-Synchronisation und Authentifizierung über PocketBase.
*   **Kartenintegration:** Visualisierung von Baustellenstandorten via OpenStreetMap.
*   **Smart Updates:** Integriertes Update-System, das neue Versionen direkt von GitHub lädt und installiert.

## 🛠️ Technologie-Stack

| Bereich | Technologie |
| :--- | :--- |
| **Frontend** | React, Vite, Tailwind CSS |
| **Desktop-Runtime** | Electron |
| **Backend** | PocketBase (Self-hosted) |
| **APIs** | OpenStreetMap, Nominatim |
| **CI/CD** | GitHub Actions (Auto-Build & Release) |

## 📦 Installation & Entwicklung

### Voraussetzungen
*   **Node.js** (LTS empfohlen)
*   **PocketBase** Instanz (lokal oder unter `app.elektro-hegener.de`)

### Lokale Einrichtung
1. Repository klonen:
   ```bash
   git clone [https://github.com/CyboraOfficial/baustellen-app.git](https://github.com/CyboraOfficial/baustellen-app.git)
   cd baustellen-app
2. Abhängigkeiten installieren:
    ```bash
    npm install
### Verfügbare Skripte
*   `npm run dev`: Startet den Vite Entwicklungs-Server für den Browser-Test (PWA).
*   `npm run electron:dev`: Startet Vite und öffnet parallel die App im Electron-Entwicklungsmodus.
*   `npm run build`: Erstellt die produktionsreifen Dateien im `dist/` Ordner.
*   `npm run preview`: Startet eine lokale Vorschau des Production-Builds.

## 🚀 2. Deployment & CI/CD

Die App verfügt über eine automatisierte Pipeline für Web und Desktop:

### Web-Version (PWA / VPS)
*   **Automatisches Deployment:** Jeder Push auf den `master` Branch triggert eine GitHub Action.
*   **Vorgang:** Der Code wird gebaut (`npm run build`) und die fertigen Dateien werden automatisch via SSH/SFTP auf den **VPS** übertragen.
*   **Live-URL:** Erreichbar unter `https://app.elektro-hegener.de`.

### Desktop-Version (.exe)
*   **Release-Workflow:** Wird durch das Erstellen eines Git-Tags ausgelöst.
*   **Vorgang:**
    ```bash
    git tag v1.0.x
    git push origin v1.0.x
    ```
*   GitHub Actions baut die Windows-Anwendung und veröffentlicht sie unter **GitHub Releases**.

## 🏗️ 3. Ordnerstruktur & Lokale Daten (Desktop)
In der Desktop-Version interagiert die App mit dem lokalen Dateisystem:
*   Basis-Pfad kann in den Einstellungen festgelegt werden.
*   Projekte legen automatisch eine vordefinierte Unterordner-Struktur an.

## 🔒 4. Content Security Policy (CSP)

Aus Sicherheitsgründen nutzt die App eine strikte CSP. Aktuell erlaubte Quellen:
*   **Connect:** `self`, `app.elektro-hegener.de`, `127.0.0.1:8090`, `nominatim.openstreetmap.org`, `github.com`
*   **Images:** `self`, `data:`, `blob:`, `*.tile.openstreetmap.org`, `unpkg.com`, `raw.githubusercontent.com`

---
© 2026 Elektro Hegener