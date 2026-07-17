console.log("MAIN.JS WIRD GELADEN");

const { app, BrowserWindow, session, ipcMain, dialog, shell } = require('electron');
const path = require('path'); // Pfad separat importieren, damit .join() sicher definiert ist
const fs = require("fs");
const os = require('os');
const userDataPath = path.join(os.homedir(), 'Desktop', 'Baustellen');
const { autoUpdater } = require("electron-updater");

let mainWindow;
let basePath;
let configPath;
let currentWatcher;
let isAppQuitting = false;

// In deiner electron/main.js

// IN DEINER electron/main.js

// 1. Sofort automatisch im Hintergrund herunterladen
autoUpdater.autoDownload = true;
autoUpdater.forceDevUpdateConfig = true; 

autoUpdater.on('checking-for-update', () => {
  console.log("Updater: Suche läuft...");
});

autoUpdater.on('update-available', (info) => {
  console.log(`Updater: Version ${info.version} gefunden. Download startet sofort im Hintergrund...`);
  // React kriegt Bescheid und kann z.B. "Update wird geladen..." im Banner zeigen
  if (mainWindow) mainWindow.webContents.send('download-progress', { percent: 0 });
});

autoUpdater.on('download-progress', (progressObj) => {
  console.log(`Hintergrund-Download: ${progressObj.percent.toFixed(2)}%`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-progress', progressObj);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log("Updater: Download fertig. Warte auf Klick des Nutzers...");
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Schaltet das Banner auf GRÜN
    mainWindow.webContents.send('update-downloaded');
  }
});

ipcMain.on('install-update', () => {
  console.log("Hauptprozess: Signal 'install-update' empfangen.");

  // Prüfen, ob wir im Entwicklungsmodus sind
  const isDev = !app.isPackaged; 

  if (isDev) {
    console.log("Entwicklungsmodus erkannt: Führe Standard-Neustart aus...");
    // Im Dev-Modus ohne Argumente, damit die App auf jeden Fall schließt und das Setup startet
    autoUpdater.quitAndInstall(); 
  } else {
    console.log("Produktionsmodus (EXE): Führe Silent-Installation aus...");
    // In der fertigen Exe läuft es komplett unsichtbar im Hintergrund
    autoUpdater.quitAndInstall(true, true); 

    setTimeout(() => {
      app.exit(0); // Beendet die App sauber, lässt dem Installer aber Zeit zu zünden
    }, 500);
  }
});

autoUpdater.on('update-not-available', () => {
  if (mainWindow) mainWindow.webContents.send('update-not-available');
});

autoUpdater.on('error', (err) => {
  if (mainWindow) mainWindow.webContents.send('update-not-available');
});

// IPC-Empfänger für den Start-Check von React
ipcMain.on('check-updates', () => {
  console.log("Hauptprozess: Starte checkForUpdatesAndNotify()...");
  autoUpdater.checkForUpdatesAndNotify().catch(err => {
    console.error("Fehler im Promise von checkForUpdates:", err);
  });
});

// In deiner electron/main.js

// IN DEINER electron/main.js

ipcMain.on('start-download', () => {
  console.log("Hauptprozess: Klick empfangen. Initialisiere Update-Download...");

  // Sicherheitshalber die Suche noch einmal intern triggern, 
  // damit der Updater die dev-app-update.yml frisch im Speicher hat
  autoUpdater.checkForUpdates().then(() => {
    console.log("Hauptprozess: Repository-Verbindung steht. Starte Download...");
    autoUpdater.downloadUpdate();
  }).catch(err => {
    console.error("Fehler beim Vorbereiten des Downloads:", err);
    // Falls es knallt, React zurücksetzen, damit es nicht ewig lädt
    if (mainWindow) mainWindow.webContents.send('update-not-available');
  });
});

// In deiner electron/main.js beim download-progress Event:
autoUpdater.on('download-progress', (progressObj) => {
  console.log(`Download-Fortschritt: ${progressObj.percent.toFixed(2)}%`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Schickt das gesamte Objekt an React weiter
    mainWindow.webContents.send('download-progress', progressObj);
  }
});

// 3. WICHTIGSTES EVENT: Wenn der Download fertig ist!
autoUpdater.on('update-downloaded', (info) => {
  console.log("Updater: Download beendet! Version:", info.version);
  
  // Wir sagen React, dass die Datei bereitliegt -> Banner wird GRÜN
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-downloaded');
  }
});

// Befehle vom Frontend empfangen
ipcMain.on('start-download', () => {
  autoUpdater.downloadUpdate();
});

// In deiner electron/main.js
// In deiner electron/main.js (ca. Zeile 35)
// In deiner electron/main.js
ipcMain.on('install-update', () => {
  console.log("Update-Installation wird ausgeführt...");
  
  // 1. Alle Standard-Schließ-Listener von Electron entfernen, damit nichts blockiert
  app.removeAllListeners("window-all-closed");
  
  // 2. Den Updater anweisen, die App zu schließen und das Setup zu starten
  autoUpdater.quitAndInstall(false, true); 
  
  // 3. Nach einer minimalen Verzögerung die App hart beenden, 
  // falls Electron beim "sauberen" Schließen hängen bleibt
  setTimeout(() => {
    app.exit(0);
  }, 500);
});

autoUpdater.on('update-not-available', () => {
  mainWindow.webContents.send('update-not-available');
});

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonSafe(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function sanitizeFolderName(name) {
  return String(name)
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, " ");
}

function getConfig() {
  ensureDir(path.dirname(configPath));
  return readJsonSafe(configPath, {});
}

function saveConfig(config) {
  ensureDir(path.dirname(configPath));
  writeJsonSafe(configPath, config);
}

async function chooseBaseFolder(force = false) {
  const config = getConfig();

  if (!force && config.basePath && fs.existsSync(config.basePath)) {
    basePath = config.basePath;
    return basePath;
  }

  const result = await dialog.showOpenDialog({
    title: "Baustellen-Ordner wählen",
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || !result.filePaths?.[0]) return null;

  basePath = result.filePaths[0];
  saveConfig({ ...config, basePath });
  ensureDir(basePath);
  return basePath;
}

function projectFolderFromName(name) {
  return path.join(basePath, sanitizeFolderName(name));
}

function getFileType(ext) {
  const e = ext.toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(e)) return "image";
  if ([".pdf"].includes(e)) return "pdf";
  if ([".doc", ".docx", ".xls", ".xlsx", ".dwg", ".dxf", ".txt"].includes(e)) return "document";
  return "other";
}

function readProjects() {
  if (!basePath || !fs.existsSync(basePath)) return [];

  const dirs = fs.readdirSync(basePath, { withFileTypes: true }).filter((d) => d.isDirectory());

  return dirs.map((dir) => {
    const folderPath = path.join(basePath, dir.name);
    const dataPath = path.join(folderPath, "data.json");
    const data = readJsonSafe(dataPath, {});

    const files = fs.readdirSync(folderPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== "data.json")
      .map((entry) => {
        const absolutePath = path.join(folderPath, entry.name);
        const ext = path.extname(entry.name);
        const stat = fs.statSync(absolutePath);

        return {
          name: entry.name,
          path: absolutePath,
          ext,
          type: getFileType(ext),
          size: stat.size,
          modifiedAt: stat.mtimeMs
        };
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt);

    return {
  id: dir.name,
  name: data.name || dir.name,
  address: data.address || "",
  position: data.position || null,
  status: data.status || "offen",
  type: data.type || "Konzept",
  westnetz: data.westnetz || "",
  pgk: data.pgk || "",
  masten: data.masten || [],
  aufmass: data.aufmass || [],
  notes: data.notes || "",
  log: data.log || [],
  ab_hsw: data.ab_hsw || "",
  ab_mueller: data.ab_mueller || "",
  files
    };
  });
}

function saveProject(project) {
  const safeName = sanitizeFolderName(project.name);
  const folderPath = projectFolderFromName(safeName);
  ensureDir(folderPath);

  const payload = {
    name: project.name,
    address: project.address || "",
    position: project.position || null,
    status: project.status || "offen",
    westnetz: project.westnetz || "",
    type: project.type || "Konzept",
    pgk: project.pgk || "",
    masten: project.masten || [],
    aufmass: project.aufmass || [],
    notes: project.notes || "",
    log: project.log || [],
    ab_hsw: project.ab_hsw || "",
    ab_mueller: project.ab_mueller || "",
  };

  writeJsonSafe(path.join(folderPath, "data.json"), payload);

  return { ok: true, folderPath };
}

function setupWatcher() {
  if (currentWatcher) {
    currentWatcher.close();
    currentWatcher = null;
  }

  if (!basePath || !fs.existsSync(basePath)) return;

  currentWatcher = fs.watch(basePath, { recursive: true }, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("projects-changed");
    }
  });
}

function createWindow() {
  // In der main.js innerhalb von createWindow
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = 'MeineBaustellenApp/1.0';
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    }
  });

    // In deiner electron/main.js innerhalb oder direkt nach der Fenster-Erstellung:
  mainWindow.once('ready-to-show', () => {
    // Holt sich die Version direkt aus der package.json
    const appVersion = app.getVersion(); 
    mainWindow.webContents.send('app-version', appVersion);
  });

  const isDev = !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // --- AB HIER: UPDATER-LOGIK FÜR DAS FENSTER ---
  mainWindow.on('close', (e) => {
    // Wenn die App NICHT aktiv beendet wird (isAppQuitting ist false),
    // kannst du hier das Schließen verhindern. Wenn du das gar nicht tust,
    // kannst du diesen Block auch leer lassen.
    if (!isAppQuitting) {
      // Falls du das Fenster z.B. nur verstecken willst:
      // e.preventDefault();
      // mainWindow.hide();
    }
  });
}

app.on('before-quit', () => {
  isAppQuitting = true;
});

app.whenReady().then(async () => {
  configPath = path.join(app.getPath("userData"), "settings.json");
  const selected = await chooseBaseFolder(false);

  if (!selected) {
    app.quit();
    return;
  }

  setupWatcher();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("projects:create", async (_, project) => {
  const result = saveProject(project);
  setupWatcher();
  return result;
});

if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

ipcMain.handle('projects:list', async () => {
  try {
    if (!fs.existsSync(userDataPath)) return [];

    const folders = fs.readdirSync(userDataPath);
    const projects = folders.map(folderName => {
      try {
        const folderPath = path.join(userDataPath, folderName);
        if (!fs.lstatSync(folderPath).isDirectory()) return null;
        
        // 1. Dateien im Ordner scannen
        const filesInFolder = fs.readdirSync(folderPath).filter(file => 
          file !== 'data.json' && !file.startsWith('.')
        );

        const jsonPath = path.join(folderPath, 'data.json');
        
        if (fs.existsSync(jsonPath)) {
          const content = fs.readFileSync(jsonPath, 'utf-8');
          const data = JSON.parse(content);
          
          return {
            ...data,
            id: folderName,
            name: data.name || folderName,
            files: filesInFolder // 🔥 DIESE ZEILE HAT GEFEHLT!
          };
        }
        return null;
      } catch (e) {
        return null;
      }
    }).filter(p => p !== null);

    return projects;
  } catch (err) {
    console.error("Fehler beim Laden:", err);
    return [];
  }
});

// 2. Speichern: Erstellt Ordner und darin die data.json
ipcMain.handle('projects:update', async (event, project) => {
  try {
    // Falls der Name geändert wurde: Alten Ordner umbenennen oder löschen
    if (project.id && project.id !== project.name) {
      const oldFolderPath = path.join(userDataPath, project.id);
      const newFolderPath = path.join(userDataPath, project.name);
      
      if (fs.existsSync(oldFolderPath)) {
        // Wir benennen den Ordner einfach um, falls er existiert
        fs.renameSync(oldFolderPath, newFolderPath);
      }
    }

    const projectFolderPath = path.join(userDataPath, project.name);
    
    // Projektordner erstellen, falls er nicht existiert
    if (!fs.existsSync(projectFolderPath)) {
      fs.mkdirSync(projectFolderPath, { recursive: true });
    }

    const jsonPath = path.join(projectFolderPath, 'data.json');
    const dataToSave = { ...project, id: project.name };
    
    fs.writeFileSync(jsonPath, JSON.stringify(dataToSave, null, 2));
    return dataToSave;
  } catch (err) {
    console.error("Speicherfehler:", err);
    return null;
  }
});

// 3. Löschen: Entfernt den kompletten Ordner
ipcMain.handle('projects:delete', async (event, id) => {
  const folderPath = path.join(userDataPath, id);
  if (fs.existsSync(folderPath)) {
    // fs.rmSync löscht den Ordner samt Inhalt (data.json)
    fs.rmSync(folderPath, { recursive: true, force: true });
    return true;
  }
  return false;
});

ipcMain.handle("settings:chooseBaseFolder", async () => {
  const selected = await chooseBaseFolder(true);
  if (!selected) return { ok: false };

  setupWatcher();
  return { ok: true, basePath: selected };
});

ipcMain.handle("shell:openPath", async (_, filePath) => {
  return shell.openPath(filePath);
});

ipcMain.handle("shell:showItemInFolder", async (_, filePath) => {
  shell.showItemInFolder(filePath);
  return { ok: true };
});

ipcMain.handle("upload-file", async (_, { projectName, filePath }) => {
  try {
    // Wir nutzen den userDataPath (Desktop/Baustellen), den wir oben definiert haben
    const projectFolder = path.join(userDataPath, projectName);

    if (!fs.existsSync(projectFolder)) {
      // Falls der Ordner fehlt, erstellen wir ihn sicherheitshalber einfach
      fs.mkdirSync(projectFolder, { recursive: true });
    }

    const fileName = path.basename(filePath);
    const destPath = path.join(projectFolder, fileName);

    // Datei kopieren
    fs.copyFileSync(filePath, destPath);

    console.log(`Datei hochgeladen: ${fileName} -> ${projectFolder}`);
    return { success: true, path: destPath, fileName };
  } catch (err) {
    console.error("Fehler beim Dateiupload:", err);
    return { error: err.message };
  }
});

ipcMain.handle('open-file', async (event, relativePath) => {
  // relativePath ist z.B. "Projektname/bild.jpg"
  const fullPath = path.join(userDataPath, relativePath);
  if (fs.existsSync(fullPath)) {
    require('electron').shell.openPath(fullPath);
    return true;
  }
  return false;
});

// 1. Eine einzelne Datei aus einem Projektordner löschen
ipcMain.handle('delete-file', async (event, { projectName, fileName }) => {
  try {
    const filePath = path.join(userDataPath, projectName, fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true };
    }
    return { success: false, error: "Datei nicht gefunden" };
  } catch (err) {
    console.error("Fehler beim Löschen der Datei:", err);
    return { success: false, error: err.message };
  }
});

// 2. Den Ordner der Baustelle im Explorer öffnen
ipcMain.handle('open-project-folder', async (event, projectName) => {
  try {
    const folderPath = path.join(userDataPath, projectName);
    if (fs.existsSync(folderPath)) {
      require('electron').shell.openPath(folderPath);
      return { success: true };
    }
    return { success: false, error: "Ordner nicht gefunden" };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

const searchLocation = async () => {
  if (!searchAddress) return;

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchAddress)}`
  );

  const data = await res.json();

  if (data && data.length > 0) {
    const result = data[0];

    setSelectedPosition({
      lat: Number(result.lat),
      lng: Number(result.lon),
    });

    setForm({
      ...form,
      address: result.display_name
    });
  } else {
    alert("Adresse nicht gefunden");
  }
};