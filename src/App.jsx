import React, { useEffect, useState, useRef } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { useMap } from "react-leaflet"; 
import { pb } from './pocketbase'; // Punkt-Schrägstrich bedeutet: im selben Ordner
import imageCompression from 'browser-image-compression';

L.Map.mergeOptions({ zoomAnimation: true, zoomAnimationThreshold: 10 });

function FlyToPosition({ position }) {
  const map = useMap();

  useEffect(() => {
    if (!position) return;

    map.flyTo([position.lat, position.lng], 17, {
      duration: 1.0,
    });
  }, [position]);

  return null;
}

function MarkerCluster({ projects, openProject }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const markers = L.markerClusterGroup({
      maxClusterRadius: 25,
      disableClusteringAtZoom: 15,
      spiderfyOnMaxZoom: false,
      showCoverageOnHover: false,
      animate: true,
      // WICHTIG: Wir schalten den Standard-Zoom aus, um ihn selbst zu steuern
      zoomToBoundsOnClick: false 
    });

    // Eigener Klick-Handler für den sanften Zoom (1 Sekunde)
    markers.on('clusterclick', (a) => {
      const bounds = a.layer.getBounds();
      map.flyToBounds(bounds, {
        padding: [20, 20],
        duration: 1.0, // Hier stellst du die Sekunde ein
        easeLinearity: 0.25
      });
    });

    projects.forEach((p) => {
      if (!p.position) return;

      const marker = L.marker(
        [p.position.lat, p.position.lng],
        { icon: ICONS[p.status] || ICONS.Offen }
      );

      marker._id = p.id; 
      marker.on("click", () => openProject(p));
      markers.addLayer(marker);
    });

    map.addLayer(markers);

    return () => {
      map.removeLayer(markers);
    };
  }, [projects, map, openProject]);

  return null;
}

function FitBounds({ projects, enabled, mode }) {
  const map = useMap();

  useEffect(() => {

    // 1. Projekte filtern und sicherstellen, dass es Nummern sind
    const validProjects = projects.filter(p => {
  // Zugriff auf das Unter-Objekt 'position'
  const lat = p.position?.lat;
  const lng = p.position?.lng;
  
  return lat !== undefined && lat !== null && !isNaN(lat) &&
         lng !== undefined && lng !== null && !isNaN(lng);
});

    // 2. Die Bedingung prüfen
    if (!enabled) {
      console.log("Abbruch: Komponente ist nicht 'enabled'");
      return;
    }

    if (validProjects.length === 0) {
      console.log("Abbruch: Keine gültigen Projekte zum Zoomen gefunden");
      return;
    }
    
    const coords = validProjects.map(p => [p.position.lat, p.position.lng]);
    const bounds = L.latLngBounds(coords);

    if (bounds.isValid()) {
      setTimeout(() => {
  // map.invalidateSize(); // Nur aktivieren, wenn das Layout (Sidebar) wegspringt
  map.flyToBounds(bounds, { // 'flyToBounds' ist oft schöner als 'fitBounds'
    padding: [50, 50],
    maxZoom: 14,
    duration: 1.0, // Schön gemütliche 2 Sekunden Fahrt
  });
}, 300);
    }
  }, [projects, enabled, map, mode]);

  return null;
}

/* ================= ICONS ================= */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const createIcon = (color) =>
  new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${color}.png`,
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
  });

const ICONS = {
  Offen: createIcon("green"),
  Klärung: createIcon("red"),
  "Westnetznummer fehlt": createIcon("orange"),
  "In Bearbeitung": createIcon("blue"),
  "Fertig für Abrechnung": createIcon("violet"),
  "Proformarechnung weggeschickt": createIcon("grey"),
  Abgerechnet: createIcon("black"),
};

const STATUS_COLORS = {
  Offen: "#06c200",
  Klärung: "#ff0000",
  "Westnetznummer fehlt": "#e68a00",
  "In Bearbeitung": "#3498db",
  "Fertig für Abrechnung": "#9b59b6",
  "Proformarechnung weggeschickt": "#757575",
  Abgerechnet: "#000000",
};

/* ================= MAP CLICK ================= */
function MapClickHandler({ mode, onPick, setAddress }) {
  useMapEvents({
    async click(e) {
      if (mode !== "create") return;

      const lat = e.latlng.lat;
      const lng = e.latlng.lng;

      onPick({ lat, lng });

      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
        );
        const data = await res.json();

        if (data?.display_name) {
          setAddress(data.display_name);
        }
      } catch (err) {
        console.error("Reverse Geocoding Fehler", err);
      }
    },
  });

  return null;
}

export default function App() {
  const [updateStatus, setUpdateStatus] = useState('none'); 
  const [version, setVersion] = useState('');

  const [projects, setProjects] = useState([]);
  const [mode, setMode] = useState("list");
  const [activeTab, setActiveTab] = useState("Allgemein");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const mapRef = useRef(null);

  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedPosition, setSelectedPosition] = useState(null);

  /* 🔍 FILTER */
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("Alle");
  const [filterType, setFilterType] = useState("Alle");

  /* 🔎 ADRESSSUCHE FÜR ERSTELLEN */
  const [searchResults, setSearchResults] = useState([]);
  const [searchTimeout, setSearchTimeout] = useState(null);
  const [searchAddress, setSearchAddress] = useState("");

  const [originalProject, setOriginalProject] = useState(null);
  const [toast, setToast] = useState(null);
  const [tempFiles, setTempFiles] = useState([]);

  const AUTOSAVE_DELAY = 3000; 
  const leuchtenOptionen = [
    "Trilux Cuvia",
    "Trilux 9701",
    "Trilux 9821"
  ];
  const OFFENE_STATUS = ["Offen", "Klärung", "In Bearbeitung"];

  const emptyForm = {
    name: "",
    address: "",
    westnetz: "",
    type: "Konzept",
    status: "Offen",
    pgk: "",
    notes: "",
    masten: [],
    leuchten: [],
    log: [],
    ab: "AB",
  };

  const [form, setForm] = useState(emptyForm);

  const tabs = [
    "Allgemein",
    "Dateien",
    "Masten",
    "Leuchten",
    "Protokoll",
    "Vorlage"
  ];

  const notesRef = React.useRef(null);

  // Oben bei den anderen States
const [user, setUser] = useState(pb.authStore.model);
const [loginEmail, setLoginEmail] = useState("");
const [loginPass, setLoginPass] = useState("");

// Eine Funktion zum Einloggen
const handleLogin = async (e) => {
  e.preventDefault();
  try {
    const authData = await pb.collection('users').authWithPassword(loginEmail, loginPass);
    setUser(pb.authStore.model); // Setzt den eingeloggten User
    setToast("Willkommen zurück!");
  } catch (err) {
    alert("Login fehlgeschlagen: " + err.message);
  }
};

// Eine Funktion zum Ausloggen
const handleLogout = () => {
  pb.authStore.clear();
  setUser(null);
  setMode("list");
};

const createLogEntry = (message) => {
  return {
    date: new Date().toLocaleString('de-DE', { 
      day: '2-digit', month: '2-digit', year: 'numeric', 
      hour: '2-digit', minute: '2-digit' 
    }),
    // Holt den User aus dem AuthStore (E-Mail oder 'Unbekannt')
    user: pb.authStore.model?.email || "Unbekannter User",
    action: message
  };
};

  useEffect(() => {
    if (notesRef.current) {
      notesRef.current.style.height = "auto";
      notesRef.current.style.height =
        notesRef.current.scrollHeight + "px";
    }
  }, [form.notes]);

  const copyTemplate = () => {
    const mastenNachLPH = {};

    (form.masten || []).forEach((m) => {
      const lph = m.lph || "Unbekannt";

      if (!mastenNachLPH[lph]) {
        mastenNachLPH[lph] = {
          stellen: 0,
          demontieren: 0,
          tausch: 0,
        };
      }

      const typ = m.typ || "stellen";

      if (mastenNachLPH[lph][typ] !== undefined) {
        mastenNachLPH[lph][typ] += Number(m.anzahl) || 0;
      }
    });

    const mastenText = Object.entries(mastenNachLPH)
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([lph, w]) => {
        return `${lph}m → ${
          [
            w.stellen > 0 && `S:${w.stellen}`,
            w.demontieren > 0 && `D:${w.demontieren}`,
            w.tausch > 0 && `T:${w.tausch}`,
          ]
          .filter(Boolean)
          .join(" | ")
        }`;
      })
      .join("\n");

    const leuchtenGruppiert = {};

    (form.leuchten || []).forEach((l) => {
      const key = `${l.typ}_${l.lumen}_${l.grad}_${l.info || ""}`;

      if (!leuchtenGruppiert[key]) {
        leuchtenGruppiert[key] = {
          typ: l.typ || "Unbekannt",
          lumen: l.lumen || 0,
          grad: l.grad ?? 0,
          info: l.info || "",
          anzahl: 0,
        };
      }

      leuchtenGruppiert[key].anzahl += Number(l.anzahl) || 0;
    });

    const leuchtenText = Object.values(leuchtenGruppiert)
      .map((l) => {
        let line = `${l.typ} → ${l.anzahl} Stk`;

        if (l.lumen) line += ` | ${l.lumen}lm`;
        if (l.grad) line += ` | ${l.grad}°`;
        if (l.info) line += ` | ${l.info}`;

        return line;
      })
      .join("\n");

    const text = `Ort: ${form.address || ""}

Westnetz Nr.: 
${form.westnetz || ""}

Maßnahme: ${form.type || ""}
Einmesser: Elektro Hegener
Bauplan: Liegen Bei
Pläne Strom: Liegen Bei
Pläne Gas: Liegen Bei
Pläne Telekom: Liegen bei

Masten:
${mastenText}

Oberfläche: 

Leuchten:
${leuchtenText}

PGK: ${form.pgk || ""}

Weitere Infos: ${form.notes || ""}
`;

    navigator.clipboard.writeText(text);
    setToast("Vorlage kopiert!");
    setTimeout(() => { setToast(null); }, 2000);
  };

  const loadProjects = async () => {
  try {
    const records = await pb.collection('projects').getFullList({
      sort: '-created',
      requestKey: null,
    });
    setProjects(records);
  } catch (error) {
    console.error("Fehler beim Laden:", error);
    setToast("Serververbindung fehlgeschlagen");
  }
};

  useEffect(() => {
    loadProjects();
  }, []);

  const filteredProjects = projects.filter((p) => {
    const text = search.toLowerCase();
    return (
      (p.name?.toLowerCase().includes(text) ||
        p.address?.toLowerCase().includes(text) ||
        p.westnetz?.toLowerCase().includes(text) ||
        p.notes?.toLowerCase().includes(text)) &&
      (filterStatus === "Alle" || (filterStatus === "OffenAlle" && OFFENE_STATUS.includes(p.status)) || p.status === filterStatus) &&
      (filterType === "Alle" || p.type === filterType)
    );
  });

  const searchLocation = async (query) => {
    if (!query || query.length < 3) {
      setSearchResults([]);
      return;
    }

    try {
      const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`
      );
      if (!res.ok) {
        setSearchResults([]);
        return;
      }
      const data = await res.json();
      setSearchResults(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setSearchResults([]);
    }
  };

const openProject = (p) => {
  // Helfer-Funktion um JSON sicher zu parsen, falls PocketBase es als String schickt
  const parseSafe = (data, fallback) => {
    if (!data) return fallback;
    if (typeof data === 'object') return data; // Schon ein Objekt/Array -> super
    try {
      return JSON.parse(data); // Versuchen den String umzuwandeln
    } catch (e) {
      return fallback;
    }
  };

  const parsedPosition = parseSafe(p.position, null);
  const parsedMasten = parseSafe(p.masten, []);
  const parsedLeuchten = parseSafe(p.leuchten, []);

  setSelectedProject(p);
  setSelectedPosition(parsedPosition); // Hier wird der Marker für die Karte gesetzt!
  setOriginalProject(p);
  setSidebarOpen(true);

  setForm({
    name: p.name || "",
    address: p.address || "",
    westnetz: p.westnetz || "",
    type: p.type || "Konzept",
    status: p.status || "Offen",
    pgk: p.pgk || "",
    notes: p.notes || "",
    masten: parsedMasten,
    leuchten: parsedLeuchten,
    log: parseSafe(p.log, []),
    ab: p.ab || "",
  });

  setMode("detail");
  setActiveTab("Allgemein");
  setSearchAddress("");
  setSearchResults([]);
};

  const exportLog = () => {
  if (!form.log || form.log.length === 0) {
    alert("Kein Protokoll vorhanden");
    return;
  }

  // Header für die Textdatei
  let text = `====================================================\n`;
  text += `ÄNDERUNGSPROTOKOLL - ${form.name.toUpperCase()}\n`;
  text += `Exportiert am: ${new Date().toLocaleString('de-DE')}\n`;
  text += `====================================================\n\n`;

  // Einträge durchlaufen (Neueste zuerst)
  const sortedLog = [...form.log].reverse();

  sortedLog.forEach((entry) => {
    text += `Datum:  ${entry.date}\n`;
    text += `Nutzer: ${entry.user || "Unbekannt"}\n`;
    text += `Aktion: ${entry.action}\n`;
    
    // Falls du doch noch das alte "changes" Array in manchen Einträgen hast:
    if (entry.changes && Array.isArray(entry.changes)) {
      entry.changes.forEach((c) => {
        text += `        - ${c.field}: ${c.old} → ${c.new}\n`;
      });
    }
    
    text += `----------------------------------------------------\n`;
  });

  // Download-Logik (bleibt im Kern gleich)
  const blob = new Blob([text], { type: "text/plain;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Protokoll_${form.name.replace(/[/\\?%*:|"<>]/g, '-')}.txt`; // Dateiname sicher machen
  a.click();
  URL.revokeObjectURL(url);
};

useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onUpdateAvailable((v) => {
        setVersion(v);
        setUpdateStatus('available');
      });

      window.electronAPI.onUpdateDownloaded(() => {
        setUpdateStatus('ready');
      });
    }
  }, []);

useEffect(() => {
  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      // 1. Priorität: Wenn im Suchfeld etwas steht, leere es zuerst
      if (search !== "") {
        setSearch("");
      } 
      // 2. Priorität: Wenn die Suche leer ist, aber ein Projekt offen, schließe das Projekt
      else if (selectedProject) {
        setSelectedProject(null);
        // Falls du eine 'mode' Variable nutzt, um zwischen Liste und Details zu switchen:
        if (typeof setMode === "function") setMode("list");
      }
      
      // Optional: Filter zurücksetzen, falls gewünscht
      // setFilterStatus("Alle");
      // setFilterType("Alle");
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  
  // Aufräumen, wenn die Komponente geschlossen wird
  return () => {
    window.removeEventListener("keydown", handleKeyDown);
  };
}, [search, selectedProject]); // Diese Variablen muss der Hook "beobachten"

useEffect(() => {
  const map = mapRef.current;
  if (!map) return;

  // Logik: Wann soll die Karte ALLE Marker zeigen?
  // Wenn KEIN Projekt ausgewählt ist UND wir nicht im Erstellen-Modus sind
  if (!selectedProject && mode !== "create") {
    
    const validPoints = filteredProjects
      .filter(p => p.position?.lat && p.position?.lng)
      .map(p => [p.position.lat, p.position.lng]);

    if (validPoints.length > 0) {
      const bounds = L.latLngBounds(validPoints);
      
      // Wir erzwingen den Zoom
      map.invalidateSize();
      map.flyToBounds(bounds, { 
        padding: [50, 50], 
        maxZoom: 15, 
        duration: 0.5 
      });
    }
  }
}, [filteredProjects, selectedProject, mode]); // Triggert bei Suche ODER Schließen einer Baustelle

useEffect(() => {
  // 1. Nur im Detail-Modus und wenn ein Projekt geladen ist
  if (mode !== "detail" || !originalProject) return;

  // 2. Tiefer Vergleich: Hat sich überhaupt etwas geändert?
  const hasChanges = JSON.stringify(form) !== JSON.stringify(originalProject);

  if (hasChanges) {
    const timer = setTimeout(() => {
      setToast("Speichere Änderungen...");
      saveAction();
    }, 3000); // 3 Sekunden warten nach der letzten Eingabe

    return () => clearTimeout(timer); // Timer zurücksetzen, wenn der User weiter tippt
  }
}, [form, originalProject, mode]);

  // --- AUTOSAVE EFFEKT ---
const saveAction = async () => {
  if (!selectedProject?.id || mode !== "detail") return;

  const currentUser = pb.authStore.model?.email || "Unbekannter User";
  const now = new Date().toLocaleString('de-DE');
  const newLogEntries = [];

  const fields = [
    { id: 'name', label: 'Name' },
    { id: 'address', label: 'Adresse' },
    { id: 'westnetz', label: 'Westnetz' },
    { id: 'type', label: 'Typ' },
    { id: 'status', label: 'Status' },
    { id: 'pgk', label: 'PGK' },
    { id: 'notes', label: 'Notizen' },
    { id: 'ab', label: 'AB' }
  ];

  fields.forEach(f => {
    const oldVal = originalProject[f.id] || "";
    const newVal = form[f.id] || "";
    if (String(oldVal) !== String(newVal)) {
      newLogEntries.push({
        date: now,
        user: currentUser,
        action: `${f.label} geändert: "${oldVal}" ➔ "${newVal}"`
      });
    }
  });

  const mastenChanged = JSON.stringify(form.masten) !== JSON.stringify(originalProject.masten);
  const leuchtenChanged = JSON.stringify(form.leuchten) !== JSON.stringify(originalProject.leuchten);
  
  if (mastenChanged) newLogEntries.push({ date: now, user: currentUser, action: "Masten-Daten aktualisiert" });
  if (leuchtenChanged) newLogEntries.push({ date: now, user: currentUser, action: "Leuchten-Daten aktualisiert" });

  if (newLogEntries.length === 0 && !mastenChanged && !leuchtenChanged) {
    console.log("Keine Änderungen erkannt.");
    return;
  }

  // Daten-Objekt zusammenbauen
  const updatedLog = [...(form.log || []), ...newLogEntries];
  const dataToSave = {
    ...form,
    log: updatedLog
  };

  // Bereinigung (WICHTIG!)
  delete dataToSave.files;
  delete dataToSave.id;
  delete dataToSave.created;
  delete dataToSave.updated;
  delete dataToSave.collectionId;
  delete dataToSave.collectionName;
  delete dataToSave.expand;

  try {
    // Ab zum Server
    const updatedRecord = await pb.collection('projects').update(selectedProject.id, dataToSave);
    
    // --- AB HIER ERFOLGREICH ---
    
    // 1. Sofort Feedback geben
    setToast("✅ Änderungen gespeichert & geloggt");

    // 2. States aktualisieren
    setOriginalProject(updatedRecord);
    setForm(updatedRecord);

    // 3. Karten-Array sicher aktualisieren
    if (setProjects) {
      setProjects(prevProjects => {
        return prevProjects.map(p => p.id === updatedRecord.id ? updatedRecord : p);
      });
    }

    // Toast nach Zeit X entfernen
    setTimeout(() => setToast(null), 2500);

  } catch (err) {
    console.error("Detaillierter Speicherfehler:", err);
    // Fehlermeldung im Toast anzeigen, damit du in der .exe siehst was los ist
    setToast("❌ Fehler: " + (err.message || "Serverfehler"));
    setTimeout(() => setToast(null), 4000);
  }
};

  // --- ZURÜCK KNOPF LOGIK ---
  const handleBack = async () => {
    if (mode === "detail") {
      await saveAction();
      setToast("Gespeichert!");
      setTimeout(() => setToast(null), 1500);
    }
    setMode("list");
  };

const deleteProject = async (id) => {
  // 1. Sicherheits-Check: Haben wir überhaupt eine ID?
  if (!id) {
    console.error("Löschen abgebrochen: Keine ID übergeben.");
    return;
  }

  // 2. Bestätigung vom User
  if (!window.confirm("Möchtest du dieses Projekt wirklich unwiderruflich löschen?")) {
    return;
  }

  try {
    // 3. Lösch-Vorgang
    await pb.collection('projects').delete(id);

    // 4. UI-Update: Aus dem lokalen Array entfernen
    setProjects(prev => prev.filter(p => p.id !== id));
    
    // 5. Ansicht zurücksetzen
    setMode("list");
    setSelectedProject(null);

    setToast("🗑️ Projekt erfolgreich gelöscht");
    setTimeout(() => setToast(null), 2500);

  } catch (err) {
    // Falls das Projekt schon weg ist (404), behandeln wir es als Erfolg
    if (err.status === 404) {
      console.warn("Projekt existierte nicht mehr auf dem Server, entferne es lokal.");
      setProjects(prev => prev.filter(p => p.id !== id));
      setMode("list");
      setSelectedProject(null);
    } else {
      console.error("Fehler beim Löschen:", err);
      setToast("❌ Fehler beim Löschen");
      setTimeout(() => setToast(null), 3000);
    }
  }
};

const createProject = async () => {
  console.log("Speichern gestartet...");
  console.log("Aktuelle Position:", selectedPosition);
  console.log("Formular-Daten:", form);

  if (!selectedPosition) {
    setToast("Fehler: Keine Position ausgewählt!");
    return;
  }

  try {
    const formData = new FormData();

    // Texte hinzufügen
    formData.append('name', form.name || "Unbenanntes Projekt");
    formData.append('address', form.address || "");
    formData.append('status', form.status || "Offen");
    formData.append('type', form.type || "Konzept");
    formData.append('westnetz', form.westnetz || "");
    formData.append('ab', form.ab || "");
    formData.append('notes', form.notes || "");

    // JSON-Felder hinzufügen
    formData.append('position', JSON.stringify(selectedPosition));
    formData.append('masten', JSON.stringify(form.masten || []));
    formData.append('leuchten', JSON.stringify(form.leuchten || []));
    formData.append('log', JSON.stringify(form.log || []));

    // Dateien hinzufügen
    if (tempFiles.length > 0) {
      tempFiles.forEach((file) => {
        formData.append('files', file);
      });
    }

    console.log("Sende Daten an PocketBase...");
    const record = await pb.collection('projects').create(formData);
    console.log("Erfolgreich gespeichert! Neuer Record:", record);

    // Alles zurücksetzen
    setTempFiles([]);
    setForm(emptyForm);
    setSelectedPosition(null);
    setMode("list");
    
    // Liste neu laden
    await loadProjects();
    
    setToast("Baustelle gespeichert!");
  } catch (err) {
    console.error("PocketBase Speicherfehler:", err);
    setToast("Fehler: " + err.message);
  }
};

  const mastenSumme = (form.masten || []).reduce((a, m) => a + (Number(m.anzahl) || 0), 0);
  const mastenTypen = { stellen: 0, demontieren: 0, tausch: 0 };
  (form.masten || []).forEach((m) => {
    const typ = m.typ || "stellen";
    if (mastenTypen[typ] !== undefined) mastenTypen[typ] += Number(m.anzahl) || 0;
  });

  const leuchtenSumme = (form.leuchten || []).reduce((a, l) => a + (Number(l.anzahl) || 0), 0);
  const lumenSumme = (form.leuchten || []).reduce((a, l) => a + (Number(l.lumen) || 0) * (Number(l.anzahl) || 1), 0);

  return (
    <div className="app-layout">
      {updateStatus !== 'none' && (
  <div className={`update-banner ${updateStatus === 'downloading' ? 'downloading' : ''}`}>
    <div className="update-content">
      <span className="update-text">
        {updateStatus === 'available' && `🚀 Version ${version} verfügbar!`}
        {updateStatus === 'downloading' && `⏳ Update wird geladen...`}
        {updateStatus === 'ready' && `✅ Update bereit zum Installieren!`}
      </span>

      {updateStatus === 'available' && (
        <button className="update-button" onClick={() => {
          setUpdateStatus('downloading');
          window.electronAPI.startDownload();
        }}>
          Herunterladen
        </button>
      )}

      {updateStatus === 'ready' && (
        <button className="update-button" onClick={() => window.electronAPI.installUpdate()}>
          Jetzt Neustarten
        </button>
      )}
    </div>
    
    <button className="update-close" onClick={() => setUpdateStatus('none')}>
      ✕
    </button>
  </div>
)}

      {!user ? (
      /* --- LOGIN BEREICH --- */
      <div className="login-overlay" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        width: '100%', height: '100vh', backgroundColor: '#2c3e50', color: 'white'
      }}>
        <form onSubmit={handleLogin} style={{
          backgroundColor: 'white', padding: '30px', borderRadius: '8px', 
          display: 'flex', flexDirection: 'column', width: '300px', gap: '15px'
        }}>
          <h2 style={{ color: '#2c3e50', margin: '0 0 10px 0', textAlign: 'center' }}>Baustellen Login</h2>
          <input 
            type="email" placeholder="E-Mail" value={loginEmail} 
            onChange={(e) => setLoginEmail(e.target.value)}
            style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ddd' }}
            required 
          />
          <input 
            type="password" placeholder="Passwort" value={loginPass} 
            onChange={(e) => setLoginPass(e.target.value)}
            style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ddd' }}
            required 
          />
          <button type="submit" style={{
            padding: '10px', backgroundColor: '#3498db', color: 'white', 
            border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
          }}>
            Anmelden
          </button>
        </form>
      </div>
    ) : (
      /* --- DEINE EIGENTLICHE APP --- */
      <>
      <button 
      className={`sidebar-toggle ${sidebarOpen ? "shifted" : ""}`} 
      onClick={() => setSidebarOpen(!sidebarOpen)}
    >
      {sidebarOpen ? "◀" : "☰"}
    </button>
      <div className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="sidebar-content">
          <div className="header-bar">
            <button onClick={() => {
                setMode("create");
                setForm(emptyForm);
                setSelectedPosition(null);
                setSelectedProject(null);
                setActiveTab("Allgemein");
                setSearchAddress("");
                setSearchResults([]);
              }}>
              + Neue Baustelle
            </button>
            <button onClick={handleBack}>← Zurück </button>
            <button onClick={handleLogout} style={{ backgroundColor: '#e74c3c' }}>
                Logout
              </button>
          </div>

          {mode === "list" && (
            <>
              <div style={{ position: "relative", width: "100%", marginBottom: "10px" }}>
  <input
    type="text"
    placeholder="Suchen..."
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    style={{
      width: "100%",
      padding: "8px 35px 8px 10px", // Rechts Platz für das X
      borderRadius: "4px",
      border: "1px solid #ffa500", // Passend zu deinem gelben Fokus-Rand
      boxSizing: "border-box"      // Wichtig, damit das Feld nicht übersteht
    }}
  />
  
  {search && (
    <span
      onClick={() => setSearch("")}
      style={{
        position: "absolute",
        right: "10px",      // 10 Pixel vom rechten Rand des Inputs
        top: "50%",
        transform: "translateY(-50%)",
        cursor: "pointer",
        color: "#999",
        fontSize: "20px",
        lineHeight: "1",
        zIndex: 10          // Sicherstellen, dass es oben liegt
      }}
    >
      ✕
    </span>
  )}
</div>
              <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
                <div style={{ flex: 1 }}>
                  <label>Status</label>
                  <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                    <option>Alle</option>
                    <option>Offen</option>
                    <option value="OffenAlle">Offen (alle)</option>
                    <option>Klärung</option>
                    <option>Westnetznummer fehlt</option>
                    <option>In Bearbeitung</option>
                    <option>Fertig für Abrechnung</option>
                    <option>Proformarechnung weggeschickt</option>
                    <option>Abgerechnet</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label>Typ</label>
                  <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                    <option>Alle</option>
                    <option>Konzept</option>
                    <option>Anfahrschaden</option>
                    <option>Störung</option>
                    <option>LK-Tausch</option>
                    <option>Sonstiges</option>
                  </select>
                </div>
              </div>

              <h3>Baustellen</h3>
{filteredProjects.map((p) => (
  <div 
    key={p.id} 
    className="project-card" 
    onClick={() => openProject(p)}
    // --- DRAG & DROP LOGIK START ---
    onDragOver={(e) => {
      e.preventDefault();
      e.currentTarget.style.border = "2px solid #3498db"; // Highlight beim Drüberziehen
      e.currentTarget.style.backgroundColor = "rgba(52, 152, 219, 0.1)";
    }}
    onDragLeave={(e) => {
      e.currentTarget.style.border = "none"; // Reset wenn man wegzieht
      e.currentTarget.style.backgroundColor = "transparent";
    }}
    onDrop={async (e) => {
  e.preventDefault();
  // Styles zurücksetzen
  e.currentTarget.style.border = "none";
  e.currentTarget.style.backgroundColor = "transparent";
  
  const rawFiles = Array.from(e.dataTransfer.files);
  if (rawFiles.length === 0) return;

  // Diese Variable hält unsere (komprimierten) Dateien bereit
  let processedFilesForQueue = []; 

  try {
    setToast(`⏳ Verarbeitung & Upload läuft...`);

    const formData = new FormData();
    
    // 1. Alle Dateien verarbeiten (Bilder komprimieren, Rest lassen)
    await Promise.all(rawFiles.map(async (file) => {
      if (file.type.startsWith('image/')) {
        const options = { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true };
        try {
          const compressedFile = await imageCompression(file, options);
          formData.append('files+', compressedFile, file.name);
          processedFilesForQueue.push(compressedFile); // Komprimiert für Offline-Speicher
        } catch (compErr) {
          formData.append('files+', file);
          processedFilesForQueue.push(file);
        }
      } else {
        formData.append('files+', file);
        processedFilesForQueue.push(file); // Dokumente unverändert
      }
    }));

    // 2. Upload Versuch zu PocketBase
    const updatedRecord = await pb.collection('projects').update(p.id, formData);

    // 3. State synchronisieren
    setProjects(prev => prev.map(proj => proj.id === updatedRecord.id ? updatedRecord : proj));

    if (selectedProject?.id === p.id) {
      setOriginalProject(updatedRecord);
      setForm(updatedRecord);
    }

    setToast(`✅ Alle Dateien zu "${p.name}" hinzugefügt!`);
    setTimeout(() => setToast(null), 2500);

  } catch (err) {
    console.error("Upload Fehler:", err);
    
    // PRÜFEN: Liegt es am Internet?
    if (!window.navigator.onLine || err.isAbort || err.message.includes('Network')) {
      setToast("📡 Kein Netz! Datei wird lokal gesichert...");
      
      // WICHTIG: Hier nutzen wir jetzt die 'processedFilesForQueue' 
      // (damit wir nicht die riesigen Originale in den LocalStorage quetschen)
      await saveToOfflineQueue(p.id, processedFilesForQueue);
      
      setToast("💾 Lokal gesichert. Upload erfolgt bei Verbindung.");
    } else {
      setToast("❌ Fehler beim Hochladen");
    }
  }
}}
    // --- DRAG & DROP LOGIK ENDE ---
  >
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 12, height: 12, borderRadius: "50%", background: STATUS_COLORS[p.status] || "#999" }} />
      <strong>{p.name}</strong>
    </div>
    <div>{p.status}</div>
    <div style={{ fontSize: 12 }}>{p.type}</div>
    {p.ab && <div style={{ fontSize: 12 }}>AB: {p.ab}</div>}
    {p.westnetz && (
      <div style={{ fontSize: 12 }}>
        <strong>WN:</strong>
        {p.westnetz.split("\n").map((w, i) => (
          <div key={i} style={{ marginLeft: 6 }}>• {w}</div>
        ))}
      </div>
    )}
  </div>
))}
            </>
          )}

          {(mode === "detail" || mode === "create") && (
            <>
              {mode === "detail" && (
                <div style={{ background: STATUS_COLORS[form.status] || "#999", color: "white", padding: "8px 12px", borderRadius: "8px", marginBottom: "10px", fontWeight: "bold", textAlign: "center" }}>
                  {form.status}
                </div>
              )}

              <div className="tabs">
                {tabs.map((t) => (
                  <div key={t} className={`tab ${activeTab === t ? "active" : ""}`} onClick={() => {
                      if (t === "Vorlage") copyTemplate();
                      else setActiveTab(t);
                    }}>
                    {t}
                  </div>
                ))}
              </div>

              {activeTab === "Allgemein" && (
                <>
                  {mode === "create" && (
                    <>
                      <label>Adresse suchen</label>
                      <div style={{ position: "relative", zIndex: 1000 }}>
                        <input value={searchAddress} onChange={(e) => {
                            const value = e.target.value;
                            setSearchAddress(value);
                            if (searchTimeout) clearTimeout(searchTimeout);
                            setSearchTimeout(setTimeout(() => searchLocation(value), 500));
                          }} placeholder="Straße + Ort" />
                        {searchResults.length > 0 && (
                          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #ccc", borderRadius: "6px", marginTop: "4px", maxHeight: "200px", overflowY: "auto", zIndex: 99999 }}>
                            {searchResults.map((r, i) => (
                              <div key={i} onClick={() => {
                                  setSelectedPosition({ lat: Number(r.lat), lng: Number(r.lon) });
                                  setForm(prev => ({ ...prev, address: r.display_name }));
                                  setSearchAddress(r.display_name);
                                  setSearchResults([]);
                                }} style={{ padding: "8px", cursor: "pointer", borderBottom: "1px solid #eee" }}>
                                {r.display_name}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  <label>Name</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  <label>Adresse</label>
                  <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                  <label>Westnetznummer</label>
                  <textarea value={form.westnetz || ""} onChange={(e) => setForm({ ...form, westnetz: e.target.value })} rows={2} style={{ resize: "vertical", minHeight: "60px" }} />
                  <label>AB-Nummer</label>
                  <input value={form.ab || ""} onChange={(e) => setForm({ ...form, ab: e.target.value })} />
                  <label>Typ</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    <option>Konzept</option><option>Anfahrschaden</option><option>Störung</option><option>LK-Tausch</option><option>Sonstiges</option>
                  </select>
                  <label>Status</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 14, height: 14, borderRadius: "50%", background: STATUS_COLORS[form.status] || "#999" }} />
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                      <option>Offen</option><option>Klärung</option><option>Westnetznummer fehlt</option><option>In Bearbeitung</option><option>Fertig für Abrechnung</option><option>Proformarechnung weggeschickt</option><option>Abgerechnet</option>
                    </select>
                  </div>
                  <label>PGK</label>
                  <input value={form.pgk} onChange={(e) => setForm({ ...form, pgk: e.target.value })} />
                  <label>Notizen</label>
                  <textarea ref={notesRef} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={4} style={{ resize: "vertical", overflow: "hidden", minHeight: "60px" }} />
                  {mode === "create" ? (
      <button 
        onClick={createProject} 
        style={{ 
          background: "#27ae60", 
          color: "white", 
          padding: "12px", 
          borderRadius: "4px", 
          cursor: "pointer", 
          fontWeight: "bold",
          marginTop: "10px",
          border: "none" 
        }}
      >
        ✔ Baustelle speichern
      </button>
    ) : (
      <button 
        className="delete-btn" 
        onClick={() => deleteProject(selectedProject.id)}
        style={{ background: "#e74c3c", color: "white", padding: "8px", borderRadius: "4px", cursor: "pointer", marginTop: "10px" }}
      >
        Baustelle löschen
      </button>
    )}
                </>
              )}

{activeTab === "Masten" && (
                <>
                  <div style={{ marginBottom: 10, fontWeight: "bold" }}>Gesamt: {mastenSumme} | S: {mastenTypen.stellen} | D: {mastenTypen.demontieren} | T: {mastenTypen.tausch}</div>
                  {form.masten.map((m, i) => (
                    <div key={i} style={{ borderBottom: "1px solid #eee", paddingBottom: "8px", marginBottom: "8px" }}>
                      <label>LPH</label><input value={m.lph} onChange={(e) => { const u = [...form.masten]; u[i].lph = e.target.value; setForm({ ...form, masten: u }); }} />
                      <label>Anzahl</label><input type="number" value={m.anzahl} onChange={(e) => { const u = [...form.masten]; u[i].anzahl = Number(e.target.value); setForm({ ...form, masten: u }); }} />
                      <label>Typ</label>
                      <select value={m.typ} onChange={(e) => { const u = [...form.masten]; u[i].typ = e.target.value; setForm({ ...form, masten: u }); }}>
                        <option>stellen</option><option>demontieren</option><option>tausch</option>
                      </select>
                    </div>
                  ))}
                  <button onClick={() => setForm({ ...form, masten: [...form.masten, { lph: "", anzahl: 1, typ: "stellen" }] })}>+ Mast hinzufügen</button>
                </>
              )}

{activeTab === "Leuchten" && (
                <>
                  <div style={{ marginBottom: 10, fontWeight: "bold" }}>Gesamt: {leuchtenSumme} | Lumen: {lumenSumme}</div>
                  {form.leuchten.map((l, i) => (
                    <div key={i} style={{ borderBottom: "1px solid #eee", paddingBottom: "8px", marginBottom: "8px" }}>
                      <label>Typ</label>
                      <input list="leuchten-liste" value={l.typ} onChange={(e) => {
                          const u = [...form.leuchten]; u[i].typ = e.target.value;
                          if (e.target.value === "Trilux Cuvia") u[i].lumen = 2600;
                          if (e.target.value === "Trilux 9701") u[i].lumen = 4600;
                          if (e.target.value === "Trilux 9821") u[i].lumen = 2600;
                          setForm({ ...form, leuchten: u });
                        }} />
                      <datalist id="leuchten-liste">{leuchtenOptionen.map((opt, idx) => <option key={idx} value={opt} />)}</datalist>
                      <label>Lumen</label><input type="number" value={l.lumen} onChange={(e) => { const u = [...form.leuchten]; u[i].lumen = Number(e.target.value); setForm({ ...form, leuchten: u }); }} />
                      <label>Grad</label><input type="number" value={l.grad} onChange={(e) => { const u = [...form.leuchten]; u[i].grad = Number(e.target.value); setForm({ ...form, leuchten: u }); }} />
                      <label>Anzahl</label><input type="number" value={l.anzahl} onChange={(e) => { const u = [...form.leuchten]; u[i].anzahl = Number(e.target.value); setForm({ ...form, leuchten: u }); }} />
                      <label>Info</label><input value={l.info || ""} onChange={(e) => { const u = [...form.leuchten]; u[i].info = e.target.value; setForm({ ...form, leuchten: u }); }} />
                    </div>
                  ))}
                  <button onClick={() => setForm({ ...form, leuchten: [...form.leuchten, { typ: "", lumen: 0, grad: 0, anzahl: 1, info: "" }] })}>+ Leuchte hinzufügen</button>
                </>
              )}

{activeTab === "Protokoll" && (
  <div style={{ maxHeight: "400px", overflowY: "auto", padding: "10px" }}>
    <button 
      onClick={exportLog} 
      style={{ 
        marginBottom: 15, 
        width: "100%", 
        padding: "8px", 
        backgroundColor: "#2c3e50", 
        color: "white", 
        border: "none", 
        borderRadius: "4px",
        cursor: "pointer"
      }}
    >
      📄 Protokoll als .txt exportieren
    </button>

    {(form.log || []).length === 0 && (
      <div style={{ textAlign: "center", color: "#999", marginTop: "20px" }}>
        Keine Änderungen vorhanden
      </div>
    )}

    {/* Wir drehen das Array mit .slice().reverse() um, damit das Neueste oben steht */}
    {(form.log || []).slice().reverse().map((entry, i) => (
      <div key={i} style={{ 
        borderBottom: "1px solid #eee", 
        padding: "10px 0", 
        marginBottom: "5px" 
      }}>
        {/* Kopfzeile: Datum und Benutzer */}
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between", 
          fontSize: "11px", 
          color: "#888",
          marginBottom: "4px"
        }}>
          <span>{entry.date}</span>
          <span style={{ fontWeight: "bold", color: "#3498db" }}>{entry.user || "System"}</span>
        </div>

        {/* NEU: Einfache Text-Aktion (unser neues Format) */}
        {entry.action && (
          <div style={{ fontSize: "13px", color: "#333", lineHeight: "1.4" }}>
            {entry.action}
          </div>
        )}

        {/* ALT: Kompatibilität für das alte 'changes' Format */}
        {entry.changes && entry.changes.map((c, j) => (
          <div key={j} style={{ fontSize: "13px", marginTop: "2px" }}>
            <strong style={{ color: "#555" }}>{c.field}</strong>: 
            <span style={{ color: "#e74c3c", textDecoration: "line-through", margin: "0 5px" }}>{String(c.old)}</span> 
            ➔ 
            <span style={{ color: "#27ae60", marginLeft: "5px" }}>{String(c.new)}</span>
          </div>
        ))}
      </div>
    ))}
  </div>
)}

              {activeTab === "Dateien" && (
  <>
    {/* Kopfzeile mit Ordner-Button */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
      <h4 style={{ margin: 0 }}>Projektdateien</h4>
      {mode !== "create" && selectedProject && (
        <button 
          onClick={() => window.desktopAPI.openProjectFolder(selectedProject.name)}
          style={{ 
            padding: "4px 10px", 
            cursor: "pointer", 
            backgroundColor: "#2c3e50", 
            color: "white", 
            border: "none", 
            borderRadius: "4px",
            fontSize: "12px"
          }}
        >
          📂 Ordner öffnen
        </button>
      )}
    </div>

    {/* Drag & Drop Zone */}
    <div 
  onDragOver={(e) => e.preventDefault()} 
  onDrop={async (e) => {
  e.preventDefault();
  const rawFiles = Array.from(e.dataTransfer.files);
  if (rawFiles.length === 0) return;

  // 1. Verarbeitung & Kompression (für Bilder)
  const processedFiles = await Promise.all(rawFiles.map(async (file) => {
    if (file.type.startsWith('image/')) {
      try {
        const options = { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true };
        return await imageCompression(file, options);
      } catch (err) {
        console.error("Kompression fehlgeschlagen, nehme Original:", err);
        return file;
      }
    }
    return file;
  }));

  // FALL A: Neues Projekt wird gerade erst erstellt (Lokal speichern)
  if (mode === "create") {
    // Hier brauchen wir noch kein Offline-Sync, da das Projekt noch gar nicht in PB existiert
    setTempFiles(prev => [...prev, ...processedFiles]);
  } 
  
  // FALL B: Bestehendes Projekt aktualisieren (Online-Versuch + Offline-Rettung)
  else {
    if (!selectedProject?.id) return;

    try {
      setToast("⏳ Upload läuft...");

      const formData = new FormData();
      processedFiles.forEach(file => {
        formData.append('files+', file); 
      });

      const updatedRecord = await pb.collection('projects').update(selectedProject.id, formData);

      // States aktualisieren
      setProjects(prev => prev.map(p => p.id === updatedRecord.id ? updatedRecord : p));
      setOriginalProject(updatedRecord);
      setForm(updatedRecord);
      setSelectedProject(updatedRecord);

      setToast("✅ Datei hinzugefügt");
      setTimeout(() => setToast(null), 2500);

    } catch (err) {
      console.error("Upload Fehler:", err);
      
      // OFFLINE LOGIK: Wenn Internet weg ist
      if (!window.navigator.onLine || err.isAbort) {
        setToast("📡 Kein Netz! Datei wird lokal für später gesichert...");
        // Wir nutzen die bereits komprimierten processedFiles für die Warteschlange
        await saveToOfflineQueue(selectedProject.id, processedFiles);
        setToast("💾 Offline gesichert. Upload erfolgt bei Verbindung.");
      } else {
        setToast("❌ Fehler beim Hochladen");
      }
    }
  }
}}
  style={{ border: "2px dashed #aaa", padding: 10, borderRadius: "8px", textAlign: "center", marginBottom: "10px", backgroundColor: "#f9f9f9" }}
>
  Dateien
</div>

    {/* Anzeige der Dateien */}
    {(mode === "create" ? tempFiles : selectedProject?.files || []).map((f, i) => {
  const displayName = mode === "create" ? f.name : f;

  return (
    <div key={i} style={{ 
      display: "flex", 
      justifyContent: "space-between", 
      alignItems: "center", 
      padding: "6px 10px", 
      backgroundColor: "white", 
      border: "1px solid #eee", 
      borderRadius: "4px",
      marginBottom: "5px" 
    }}>
      <span 
  onClick={() => {
    if (mode !== "create") {
      const url = pb.files.getUrl(selectedProject, f);

      // WICHTIG: Hier "window.desktopAPI" nutzen, statt "window.electron"
      if (window.desktopAPI && window.desktopAPI.send) {
        console.log("Sende an Hauptprozess via desktopAPI...");
        window.desktopAPI.send('open-external-file', url);
      } else {
        console.log("desktopAPI nicht gefunden, nutze Fallback");
        window.open(url, '_blank');
      }
    }
  }}
  style={{ 
    cursor: mode !== "create" ? "pointer" : "default", 
    color: "#3498db",
    textDecoration: mode !== "create" ? "underline" : "none",
    flexGrow: 1
  }}
>
  📄 {displayName}
</span>
      
      {/* LÖSCH-KNOPF */}
      <button 
        onClick={async (e) => {
          e.stopPropagation(); 

          if (mode === "create") {
            setTempFiles(tempFiles.filter((_, idx) => idx !== i));
          } else {
            if (window.confirm(`Datei "${f}" wirklich löschen?`)) {
              try {
                // Das Suffix "-" entfernt den Wert f aus dem Array in PocketBase
                const updatedRecord = await pb.collection('projects').update(selectedProject.id, {
                  "files-": [f] 
                });

                setSelectedProject(updatedRecord);
                loadProjects();

                setToast("Datei gelöscht!");
                setTimeout(() => setToast(null), 1500);
              } catch (err) {
                console.error("Fehler beim Löschen:", err);
                alert("Konnte Datei nicht löschen: " + err.message);
              }
            }
          }
        }}
        style={{ 
          background: "none", 
          border: "none", 
          color: "#e74c3c", 
          cursor: "pointer", 
          fontSize: "16px",
          marginLeft: "10px"
        }}
      >
        ✕
      </button>
    </div>
  );
})}
  </>
)}
            </>
          )}
        </div>
      </div>
      <main className="map-view">
        <MapContainer 
  center={[51.15, 8.2]} 
  zoom={10} 
  ref={mapRef} // Das hier ist der Schlüssel!
  style={{ height: "100%", width: "100%" }}
>
  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
  
  {/* NEU: Aktiviert den Auto-Zoom auf die gefilterte Liste */}
  <FitBounds 
  projects={filteredProjects} 
  // Wir nehmen das !selectedProject testweise mal raus, 
  // um zu sehen ob es dann zündet:
  enabled={mode === "list"} 
  mode={mode} 
/>
  
  {/* Zeigt alle vorhandenen Baustellen */}
  <MarkerCluster projects={filteredProjects} openProject={openProject} />
  
  <MapClickHandler 
    mode={mode} 
    onPick={setSelectedPosition} 
    setAddress={(addr) => setForm(f => ({ ...f, address: addr }))} 
  />
  
  <FlyToPosition position={selectedPosition} />
  
  {selectedPosition && mode === "create" && (
    <Marker 
      position={[selectedPosition.lat, selectedPosition.lng]} 
    />
  )}
</MapContainer>
        {toast && (
  <div style={{
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    backgroundColor: toast.startsWith('✅') ? '#2ecc71' : '#e74c3c',
    color: 'white',
    padding: '12px 24px',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    zIndex: 10000,
    fontSize: '16px',
    fontWeight: 'bold',
    animation: 'slideIn 0.3s ease-out'
  }}>
    {toast}
  </div>
)}
      </main>
      </>
    )}
    </div>
  );
}