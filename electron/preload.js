const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  listProjects: () => ipcRenderer.invoke("projects:list"),
  createProject: (project) => ipcRenderer.invoke("projects:create", project),
  updateProject: (project) => ipcRenderer.invoke("projects:update", project),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),
  chooseBaseFolder: () => ipcRenderer.invoke("settings:chooseBaseFolder"),
  openPath: (filePath) => ipcRenderer.invoke("shell:openPath", filePath),
  showItemInFolder: (filePath) => ipcRenderer.invoke("shell:showItemInFolder", filePath),
  uploadFile: (data) => ipcRenderer.invoke("upload-file", data),
  openFile: (filePath) => ipcRenderer.invoke("open-file", filePath),
  deleteFile: (data) => ipcRenderer.invoke('delete-file', data),
  openProjectFolder: (name) => ipcRenderer.invoke('open-project-folder', name),
  
  // --- UPDATER EVENTS ---
  onUpdateAvailable: (callback) => {
    const subscription = (_event, version) => callback(version);
    ipcRenderer.on('update-available', subscription);
    return () => ipcRenderer.removeListener('update-available', subscription);
  },
  onUpdateDownloaded: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('update-downloaded', subscription);
    return () => ipcRenderer.removeListener('update-downloaded', subscription);
  },
  onUpdateNotAvailable: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('update-not-available', subscription);
    return () => ipcRenderer.removeListener('update-not-available', subscription);
  },
  
  startDownload: () => ipcRenderer.send('start-download'),
  installUpdate: () => ipcRenderer.send('install-update'),
  
  onProjectsChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("projects-changed", listener);
    return () => ipcRenderer.removeListener("projects-changed", listener);
  },

  onAppVersion: (callback) => {
    ipcRenderer.on('app-version', (_event, version) => callback(version));
  },

  onDownloadProgress: (callback) => {
    const subscription = (_event, progressObj) => callback(progressObj.percent);
    ipcRenderer.on('download-progress', subscription);
    return () => ipcRenderer.removeListener('download-progress', subscription);
  },
  
  // --- GENERISCHER SEND-KANAL ---
  // IN DEINER electron/preload.js ganz unten:

  send: (channel, data) => {
    // WICHTIG: Prüfe, ob 'install-update' hier wirklich EXAKT so drin steht!
    let validChannels = ['open-external-file', 'check-updates', 'start-download', 'install-update']; 
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    } else {
      // Das hilft uns beim Suchen: Wenn ein Kanal blockiert wird, sehen wir es in der Browser-Konsole!
      console.error(`Preload-Brücke blockiert den Kanal: ${channel}`);
    }
  }
});