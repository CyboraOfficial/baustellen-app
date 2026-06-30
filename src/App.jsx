import React, { useEffect, useState, useRef } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, ZoomControl } from "react-leaflet";
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
    // Prüfen, ob wir in der Electron-Exe sind
  const isDesktop = typeof window !== 'undefined' && !!window.electron;
  const [updateStatus, setUpdateStatus] = useState(isDesktop ? 'checking' : 'hidden');
  const [version, setVersion] = useState('');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const osmUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const satUrl = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  const [isSatellite, setIsSatellite] = useState(false);

  const [projects, setProjects] = useState([]);
  const [mode, setMode] = useState("list");
  const [activeTab, setActiveTab] = useState("Allgemein");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const mapRef = useRef(null);
  const [batchAktion, setBatchAktion] = useState('Tausch');

  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedPosition, setSelectedPosition] = useState(null);

  /* 🔍 FILTER */
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("OffenAlle");
  const [filterType, setFilterType] = useState("Alle");

  /* 🔎 ADRESSSUCHE FÜR ERSTELLEN */
  const [searchResults, setSearchResults] = useState([]);
  const [searchTimeout, setSearchTimeout] = useState(null);
  const [searchAddress, setSearchAddress] = useState("");

  const [originalProject, setOriginalProject] = useState(null);
  const [toast, setToast] = useState(null);
  const [alertToast, setAlertToast] = useState({ show: false, message: "" });
  const [tempFiles, setTempFiles] = useState([]);

  const leuchtenOptionen = [
    "Trilux Cuvia",
    "Trilux 9701",
    "Trilux 9821"
  ];
  const OFFENE_STATUS = ["Offen", "Klärung", "In Bearbeitung", "Westnetznummer fehlt", "Fertig für Abrechnung", "Klärung"];

  const emptyForm = {
    name: "",
    address: "",
    westnetz: "",
    type: "Konzept",
    status: "Offen",
    pgk: "",
    notes: "",
    masten: [],
    aufmass: [],
    log: [],
    ab_hsw: "AB",
    ab_mueller: "AB"
  };

  const [form, setForm] = useState(emptyForm);

  const tabs = [
    "Allgemein",
    "Dateien",
    "Protokoll",
    "Masten",
    "Aufmaß",
    "Abrechnung",
    "Vorlage"
  ];

  const notesRef = React.useRef(null);

const [user, setUser] = useState(pb.authStore.model);
const [loginEmail, setLoginEmail] = useState("");
const [loginPass, setLoginPass] = useState("");

const updateMast = (index, field, value) => {
  const newMasten = [...form.masten];
  newMasten[index][field] = value;
  setForm({ ...form, masten: newMasten });
};

const [aufmassRefreshKey, setAufmassRefreshKey] = React.useState(0);

const generiereAufmassDaten = (masten) => {
  if (!masten) return [];

  return masten.map((m, index) => {
    return {
      ...m, // Kopiert alle vorhandenen Felder (wie aktion, leuchten etc.)
      
      // MAPPING DER HÖHEN
      // Wenn lphNeu vorhanden ist, nimm das, sonst lphAlt
      lichtpunkthoehe: m.lphNeu || m.lphAlt || "",
      lichtpunkthoeheNeu: m.lphNeu || "",
      
      // MAPPING DER TYPEN (Falls du die auch im Aufmaß brauchst)
      mastTyp: m.mastTypNeu || m.mastTypAlt || "",
      
      // Restliche Felder
      aktion: m.aktion || "Montage",
      aufmassKabel: m.aufmassKabel || "",
      aufmassMuffen: m.aufmassMuffen || "",
      handarbeitStd: m.handarbeitStd || "",
      aufmassNotiz: m.aufmassNotiz || "",
      montageTyp: m.montageTyp || "Fundament",
      demontageTyp: m.demontageTyp || "Fundament",
      tauschDemoTyp: m.tauschDemoTyp || "Fundament",
      tauschMontageTyp: m.tauschMontageTyp || "Fundament",
      oberflaeche: m.oberflaeche || "Platten",
      oberflaecheX: "",
      oberflaecheY: "",
      mastTypAlt: m.mastTypAlt || "",
      mastTypNeu: m.mastTypNeu || ""
    };
  });
};

const resetAufmassVonMasten = () => {
  if (!window.confirm("Wirklich alles zurücksetzen?")) return;

  setForm(prev => ({
    ...prev,
    aufmass: {
      ...prev.aufmass,
      // Hier nutzen wir EXAKT die gleiche Funktion wie im useEffect
      masten: generiereAufmassDaten(prev.masten) 
    }
  }));

  setAufmassRefreshKey(prev => prev + 1);
  console.log("✅ Aufmaß wurde komplett neu generiert.");
};

const addLeuchte = (mastIndex) => {
  const newMasten = [...form.masten];
  // Falls das Array noch nicht existiert, erstellen
  if (!newMasten[mastIndex].leuchten) {
    newMasten[mastIndex].leuchten = [];
  }
  newMasten[mastIndex].leuchten.push({ typ: "", lumen: 0, grad: 0, anzahl: 1 });
  setForm({ ...form, masten: newMasten });
};

const updateLeuchte = (mastIndex, leuchtenIndex, field, value) => {
  const newMasten = [...form.masten];
  newMasten[mastIndex].leuchten[leuchtenIndex][field] = value;
  
  // Automatisches Lumen-Update (deine Logik)
  if (field === 'typ') {
    if (value === "Trilux Cuvia") newMasten[mastIndex].leuchten[leuchtenIndex].lumen = 2600;
    if (value === "Trilux 9701") newMasten[mastIndex].leuchten[leuchtenIndex].lumen = 4600;
    if (value === "Trilux 9821") newMasten[mastIndex].leuchten[leuchtenIndex].lumen = 2600;
  }
  
  setForm({ ...form, masten: newMasten });
};

const removeLeuchte = (mastIndex, leuchtenIndex) => {
  const newMasten = [...form.masten];
  newMasten[mastIndex].leuchten.splice(leuchtenIndex, 1);
  setForm({ ...form, masten: newMasten });
};

const batchAddMasten = (anzahl, standardLPH, standardTyp, leuchtenTyp) => {
  const neueMasten = [];
  for (let i = 0; i < anzahl; i++) {
    neueMasten.push({
      id: "", 
      lph: standardLPH, 
      typ: standardTyp, 
      form: "gerade", 
      // Direkt mit Standard-Leuchte vorbefüllen
      leuchten: leuchtenTyp ? [{ typ: leuchtenTyp, lumen: 2600, anzahl: 1 }] : [], 
      fotos: [], 
      plaene: [] 
    });
  }
  setForm({ ...form, masten: [...form.masten, ...neueMasten] });
};

// Eine Funktion zum Einloggen
const handleLogin = async (e) => {
  e.preventDefault();
  try {
    const authData = await pb.collection('users').authWithPassword(loginEmail, loginPass);
    setUser(pb.authStore.model);

    // Login-Erfolg direkt anzeigen
    setToast("✅ Login erfolgreich!");
    setTimeout(() => setToast(null), 2000);

    // Nach dem Login noch mal kurz die Updates triggern, um den Banner-Status zu aktualisieren
    if (window.electron || window.api) {
      checkForUpdates();
    }

  } catch (err) {
    // Hier kannst du jetzt auch deinen neuen alertToast nutzen, falls du das möchtest!
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
  const mastenStats = {};

  (form.masten || []).forEach((m) => {
    // 1. DEMONTAGE-LOGIK (Was kommt weg?)
    if (m.aktion === "Demontage" || m.aktion === "Tausch") {
      const artAlt = m.mastTypAlt || "Gerade";
      const keyAlt = `${m.lphAlt || "Unbekannt"}m Stahl ${artAlt}`;
      
      if (!mastenStats[keyAlt]) {
        mastenStats[keyAlt] = { rein: 0, raus: 0 };
      }
      mastenStats[keyAlt].raus += 1;
    }

    // 2. MONTAGE-LOGIK (Was wird neu gesetzt?)
    if (m.aktion === "Montage" || m.aktion === "Tausch") {
      const artNeu = m.mastTypNeu || "Gerade";
      const keyNeu = `${m.lphNeu || "Unbekannt"}m Stahl ${artNeu}`;
      
      if (!mastenStats[keyNeu]) {
        mastenStats[keyNeu] = { rein: 0, raus: 0 };
      }
      mastenStats[keyNeu].rein += 1;
    }
  });

  // Statistik-Text generieren
  const mastenText = Object.entries(mastenStats)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([beschreibung, w]) => {
      const info = [];
      if (w.rein > 0) info.push(`Montage: ${w.rein}`);
      if (w.raus > 0) info.push(`Demontage: ${w.raus}`);
      
      return `${beschreibung} → ${info.join(" | ")}`;
    })
    .join("\n");

  // Leuchten-Statistik (bleibt gleich)
  const leuchtenGruppiert = {};
  (form.masten || []).forEach((m) => {
    if (m.aktion === "Montage" || m.aktion === "Tausch") {
      (m.leuchten || []).forEach((l) => {
        if (!l.typ) return;
        const key = `${l.typ}_${l.lumen}`;
        if (!leuchtenGruppiert[key]) {
          leuchtenGruppiert[key] = { typ: l.typ, lumen: l.lumen, anzahl: 0 };
        }
        leuchtenGruppiert[key].anzahl += 1;
      });
    }
  });

  const leuchtenText = Object.values(leuchtenGruppiert)
    .map(l => `${l.typ} → ${l.anzahl} Stk${l.lumen ? ` | ${l.lumen}lm` : ""}`)
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

Masten Übersicht:
${mastenText || "Keine Einträge"}

Leuchten Übersicht:
${leuchtenText || "Keine neuen Leuchten geplant"}

PGK: ${form.pgk || ""}

Weitere Infos: ${form.notes || ""}
`;

  navigator.clipboard.writeText(text);
  if (setToast) {
    setToast("Vorlage kopiert!");
    setTimeout(() => { setToast(null); }, 2000);
  }
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

const updateAufmass = (index, field, value) => {
  setForm(prev => {
    // Sicherstellen, dass die Struktur existiert
    const aktuellesAufmass = prev.aufmass || { allgemein: { transport: "", extraInfos: "" }, masten: [] };
    const neueMasten = [...(aktuellesAufmass.masten || [])];
    
    // Wert des spezifischen Mastens aktualisieren
    neueMasten[index] = { ...neueMasten[index], [field]: value };
    
    return {
      ...prev,
      aufmass: {
        ...aktuellesAufmass,
        masten: neueMasten
      }
    };
  });
};

const updateAufmassAllgemein = (field, value) => {
  setForm(prev => {
    const aktuellesAufmass = prev.aufmass || { allgemein: { transport: "", extraInfos: "" }, masten: [] };
    return {
      ...prev,
      aufmass: {
        ...aktuellesAufmass,
        allgemein: {
          ...(aktuellesAufmass.allgemein || {}),
          [field]: value
        }
      }
    };
  });
};

const handleInitialisiereAufmass = () => {
  if (!form.masten || form.masten.length === 0) {
    alert("Bitte erstelle zuerst Masten im Masten-Tab!");
    return;
  }
  
  const kopieMasten = form.masten.map(m => ({
    ...m, // Kopiert alle bestehenden Daten (inkl. lichtpunkthoehe, typ, etc.)
    aktion: m.aktion || "Montage",
    // Sicherstellen, dass die Felder existieren und befüllt sind
    lichtpunkthoehe: m.lichtpunkthoehe || "",
    lichtpunkthoeheNeu: m.lichtpunkthoehe || "", 
    aufmassKabel: "",
    aufmassMuffen: "",
    sondersacheRasenkante: "",
    sondersacheBordstein: "",
    sondersacheRinnenfluss: ""
  }));

  setForm(prev => ({
    ...prev,
    aufmass: {
      allgemein: { transport: "", extraInfos: "" },
      masten: kopieMasten
    }
  }));
};

const openProject = (p) => {
  const parseSafe = (data, fallback) => {
    if (!data) return fallback;
    if (typeof data === 'object') return data; 
    try { return JSON.parse(data); } catch (e) { return fallback; }
  };

  const parsedPosition = parseSafe(p.position, null);
  const parsedMasten = parseSafe(p.masten, []);
  const parsedLeuchten = parseSafe(p.leuchten, []);
  
  // Das Aufmaß-Objekt sicher parsen
  const rawAufmass = parseSafe(p.aufmass, null); 

  // Sicherheitsnetz für alte vs. neue Struktur:
  let aufmassMasten = [];
  let allgemeinTransport = "";
  let allgemeinExtraInfos = "";

  if (rawAufmass) {
    if (Array.isArray(rawAufmass)) {
      // Altes Format (war nur ein direktes Array)
      aufmassMasten = rawAufmass;
    } else if (typeof rawAufmass === 'object') {
      // Neues Format (Objekt mit allgemein & masten)
      aufmassMasten = rawAufmass.masten || [];
      allgemeinTransport = rawAufmass.allgemein?.transport || "";
      allgemeinExtraInfos = rawAufmass.allgemein?.extraInfos || "";
    }
  }

  const aufbereiteteAufmassMasten = aufmassMasten.map(m => ({
    ...m,
    aktion: m.aktion || "Montage",
    lichtpunkthoehe: m.lichtpunkthoehe || "", // 👈 NEU: Lichtpunkthöhe initialisieren
    aufmassKabel: m.aufmassKabel || "",
    aufmassMuffen: m.aufmassMuffen || "",
    handarbeitStd: m.handarbeitStd || "",
    aufmassNotiz: m.aufmassNotiz || "",
    montageTyp: m.montageTyp || "Fundament",
    demontageTyp: m.demontageTyp || "Fundament",
    tauschDemoTyp: m.tauschDemoTyp || "Fundament",
    tauschMontageTyp: m.tauschMontageTyp || "Fundament",
    oberflaeche: m.oberflaeche || "Gras/Acker", // 👈 NEU: "Gras/Acker" als Standard (Oberfläche 0)
    oberflaecheX: m.oberflaecheX || "",
    oberflaecheY: m.oberflaecheY || ""
  }));

  // 🔥 DAS VOLLSTÄNDIGE FORM-OBJEKT EINMAL VORBEREITEN
  const vollständigVorbereitetesProjekt = {
    name: p.name || "",
    address: p.address || "",
    westnetz: p.westnetz || "",
    type: p.type || "Konzept",
    status: p.status || "Offen",
    pgk: p.pgk || "",
    notes: p.notes || "",
    masten: parsedMasten,
    leuchten: parsedLeuchten, // Zur Sicherheit mit aufnehmen, falls vorhanden
    aufmass: {
      allgemein: {
        transport: allgemeinTransport,
        extraInfos: allgemeinExtraInfos
      },
      masten: aufbereiteteAufmassMasten
    },
    log: parseSafe(p.log, []),
    ab_hsw: p.ab_hsw || "",
    ab_mueller: p.ab_mueller || "",
  };

  // States setzen
  setSelectedProject(p);
  setSelectedPosition(parsedPosition); 
  
  // 🔥 WICHTIG: originalProject und form MÜSSEN exakt dasselbe aufbereitete Objekt bekommen!
  setOriginalProject(vollständigVorbereitetesProjekt);
  setForm(vollständigVorbereitetesProjekt);
  
  setSidebarOpen(true);
  setMode("detail");
  setActiveTab("Allgemein");
  setSearchAddress("");
  searchResults && setSearchResults([]); // Sicherstellen, dass es existiert
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

const [rememberMe, setRememberMe] = useState(false);

// Prüfen, ob beim letzten Mal "Merken" aktiv war
useEffect(() => {
  const savedEmail = localStorage.getItem("baustellen_remembered_email");
  if (savedEmail) {
    setLoginEmail(savedEmail);
    setRememberMe(true);
  }
}, []);

const checkForUpdates = () => {
  // Prüfen, ob wir in der Exe sind
  if (window.electron || window.api) {
    console.log("Triggere Update-Check in der Exe...");
    
    // Wir sagen dem Hauptprozess, er soll prüfen
    if (window.electron) window.electron.checkUpdates();
    else if (window.api) window.api.checkUpdates();
  }
};

// IN DEINER src/App.jsx (Hier ist setUpdateStatus goldrichtig!)
useEffect(() => {
  const isDesktop = typeof window !== 'undefined' && !!window.desktopAPI;

  if (isDesktop) {
    setUpdateStatus('checking');

    window.desktopAPI.onAppVersion((detectedVersion) => {
      setVersion(detectedVersion);
    });

    const unsubscribeAvailable = window.desktopAPI.onUpdateAvailable(() => {
      setUpdateStatus('available'); 
    });

    const unsubscribeProgress = window.desktopAPI.onDownloadProgress?.((percent) => {
      setUpdateStatus('downloading'); 
      setDownloadPercent(percent);
    }) || null;

    const unsubscribeDownloaded = window.desktopAPI.onUpdateDownloaded(() => {
      setUpdateStatus('ready'); 
    });

    // HIER DIE ANPASSUNG: Wenn aktuell, nach 3 Sekunden ausblenden
    const unsubscribeNotAvailable = window.desktopAPI.onUpdateNotAvailable(() => {
      setUpdateStatus('up-to-date');

      // Timer starten, der das Banner nach 3 Sekunden verschwinden lässt
      setTimeout(() => {
        setUpdateStatus('hidden');
      }, 3000); 
    });

    window.desktopAPI.send('check-updates'); 

    return () => {
      if (unsubscribeAvailable) unsubscribeAvailable();
      if (unsubscribeProgress) unsubscribeProgress();
      if (unsubscribeDownloaded) unsubscribeDownloaded();
      if (unsubscribeNotAvailable) unsubscribeNotAvailable();
    };
  } else {
    setUpdateStatus('hidden');
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

// Automatischer Abgleich beim Tab-Wechsel
useEffect(() => {
  if (activeTab === "Aufmaß") {
    setForm(prev => {
      // Nur initialisieren, wenn NOCH KEINE Masten im Aufmaß sind
      if (prev.aufmass?.masten?.length > 0) return prev;
      if (!prev.masten || prev.masten.length === 0) return prev;

      console.log("🔄 Initialisiere Aufmaß beim ersten Tab-Wechsel...");
      
      return {
        ...prev,
        aufmass: {
          allgemein: prev.aufmass?.allgemein || { transport: "", extraInfos: "" },
          masten: generiereAufmassDaten(prev.masten) // Hier unsere Funktion!
        }
      };
    });
  }
}, [activeTab]);

useEffect(() => {
  if (mode !== "detail" || !originalProject) return;

  const parseSafe = (data, fallback) => {
    if (!data) return fallback;
    if (typeof data === 'object') return data;
    try {
      const parsed = JSON.parse(data);
      if (typeof parsed === 'string') return parseSafe(parsed, fallback); // Falls doppelt stringifiziert
      return parsed;
    } catch (e) { return fallback; }
  };

  // 1. Normale Textfelder prüfen
  const fields = ['name', 'address', 'westnetz', 'type', 'status', 'pgk', 'notes', 'ab_hsw', 'ab_mueller'];
  const hasFieldChanges = fields.some(key => String(form[key] || "") !== String(originalProject[key] || ""));

  // 2. Masten und Leuchten der Planung prüfen
  const dbMasten = parseSafe(originalProject.masten, []);
  const dbLeuchten = parseSafe(originalProject.leuchten, []);
  const mastenChanged = JSON.stringify(form.masten) !== JSON.stringify(dbMasten);
  const leuchtenChanged = JSON.stringify(form.leuchten) !== JSON.stringify(dbLeuchten);

  // 3. 🔥 INTELLIGENTER AUFMAẞ-VERGLEICH (Immun gegen PocketBase-Key-Reihenfolge)
  const dbAufmass = parseSafe(originalProject.aufmass, {});
  const stateMasts = form.aufmass?.masten || [];
  const dbMasts = dbAufmass.masten || [];

  let aufmassChanged = false;

  // Wenn die Anzahl der Masten ungleich ist, gab es eine Änderung
  if (stateMasts.length !== dbMasts.length) {
    aufmassChanged = true;
  } else {
    // Wir vergleichen NUR die echten Input-Werte der Masten, völlig egal in welcher Reihenfolge sie im Objekt liegen!
    const keysToCompare = [
      'aufmassKabel', 'aufmassMuffen', 'handarbeitStd', 'aufmassNotiz',
      'montageTyp', 'demontageTyp', 'tauschDemoTyp', 'tauschMontageTyp',
      'oberflaeche', 'oberflaecheX', 'oberflaecheY', 'aktion', 'lichtpunkthoehe'
    ];

    for (let i = 0; i < stateMasts.length; i++) {
      const sm = stateMasts[i];
      const dm = dbMasts[i];
      if (!sm || !dm) { aufmassChanged = true; break; }
      
      const fieldsMatch = keysToCompare.every(k => String(sm[k] || "") === String(dm[k] || ""));
      if (!fieldsMatch) {
        aufmassChanged = true;
        break;
      }
    }

    // Transportfelder prüfen
    if (String(form.aufmass?.allgemein?.transport || "") !== String(dbAufmass.allgemein?.transport || "")) aufmassChanged = true;
    if (String(form.aufmass?.allgemein?.extraInfos || "") !== String(dbAufmass.allgemein?.extraInfos || "")) aufmassChanged = true;
  }

  // Gesamtergebnis ermitteln
  const hasChanges = hasFieldChanges || mastenChanged || leuchtenChanged || aufmassChanged;

  if (hasChanges) {
    const timer = setTimeout(() => {
      saveAction();
    }, 3000); // Wartet 3 Sekunden nach dem letzten Tastendruck

    return () => clearTimeout(timer);
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
    { id: 'ab_hsw', label: 'AB HSW' },
    { id: 'ab_mueller', label: 'AB Müller' }
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

  const parseSafe = (data, fallback) => {
    if (!data) return fallback;
    if (typeof data === 'object') return data;
    try { return JSON.parse(data); } catch (e) { return fallback; }
  };

  const mastenChanged = JSON.stringify(form.masten) !== JSON.stringify(parseSafe(originalProject.masten, []));
  const leuchtenChanged = JSON.stringify(form.leuchten) !== JSON.stringify(parseSafe(originalProject.leuchten, []));
  
  const oldAufmassObj = parseSafe(originalProject.aufmass, {});
  const aufmassChanged = JSON.stringify(form.aufmass) !== JSON.stringify(oldAufmassObj);
  
  if (mastenChanged) newLogEntries.push({ date: now, user: currentUser, action: "Masten-Daten aktualisiert" });
  if (leuchtenChanged) newLogEntries.push({ date: now, user: currentUser, action: "Leuchten-Daten aktualisiert" });
  if (aufmassChanged) newLogEntries.push({ date: now, user: currentUser, action: "Aufmaß-Daten aktualisiert" });

  if (newLogEntries.length === 0 && !mastenChanged && !leuchtenChanged && !aufmassChanged) {
    console.log("Keine Änderungen erkannt.");
    return;
  }

  // IN DEINER saveAction:
  const updatedLog = [...(form.log || []), ...newLogEntries];
  
  const dataToSave = {
    ...form,
    log: updatedLog,
    aufmass: form.aufmass // 🔥 ALS REINES OBJEKT SENDEN! Kein JSON.stringify hier!
  };

  delete dataToSave.files;
  delete dataToSave.id;
  delete dataToSave.created;
  delete dataToSave.updated;
  delete dataToSave.collectionId;
  delete dataToSave.collectionName;
  delete dataToSave.expand;

  try {
    const updatedRecord = await pb.collection('projects').update(selectedProject.id, dataToSave);
    
    setToast("✅ Änderungen gespeichert & geloggt");

    // 1. Wir parsen das Aufmaß, das VOM SERVER kommt, für das originalProject
    const rawAufmass = parseSafe(updatedRecord.aufmass, null);
    let aufmassMasten = [];
    let allgemeinTransport = "";
    let allgemeinExtraInfos = "";

    if (rawAufmass && typeof rawAufmass === 'object' && !Array.isArray(rawAufmass)) {
      allgemeinTransport = rawAufmass.allgemein?.transport || "";
      allgemeinExtraInfos = rawAufmass.allgemein?.extraInfos || "";
      
      if (Array.isArray(rawAufmass.masten)) {
        aufmassMasten = rawAufmass.masten.map(m => ({
          ...m,
          aktion: m.aktion || "Montage",
          aufmassKabel: m.aufmassKabel || "",
          aufmassMuffen: m.aufmassMuffen || "",
          handarbeitStd: m.handarbeitStd || "",
          aufmassNotiz: m.aufmassNotiz || "",
          montageTyp: m.montageTyp || "Fundament",
          demontageTyp: m.demontageTyp || "Fundament",
          tauschDemoTyp: m.tauschDemoTyp || "Fundament",
          tauschMontageTyp: m.tauschMontageTyp || "Fundament",
          oberflaeche: m.oberflaeche || "Platten",
          oberflaecheX: m.oberflaecheX || "",
          oberflaecheY: m.oberflaecheY || ""
        }));
      }
    }

    // Das ist der saubere DB-Stand für den Vergleich
    const finalCleanObject = {
      ...updatedRecord,
      log: parseSafe(updatedRecord.log, []),
      masten: parseSafe(updatedRecord.masten, []),
      leuchten: parseSafe(updatedRecord.leuchten, []),
      aufmass: {
        allgemein: { transport: allgemeinTransport, extraInfos: allgemeinExtraInfos },
        masten: aufmassMasten
      }
    };

    // 🔥 SCHRITT A: Das Original-Projekt kriegt den sauberen Server-Stand für den nächsten Vergleich
    setOriginalProject(finalCleanObject);

    // 🔥 SCHRITT B: Der Form-State (deine Inputs!) wird NICHT blind überschrieben!
    // Wir behalten dein aktuelles Aufmaß bei und updaten nur die Server-IDs und das Logbook!
    setForm(prev => {
      return {
        ...prev,                  // Behalte deine aktuellen Eingaben (Masten bleiben sichtbar!)
        log: parseSafe(updatedRecord.log, []), // Aktualisiere nur das neue Logbook vom Server
        // Falls wir gezwungen sind, Felder zu synchronisieren, tun wir das, 
        // aber wir fassen prev.aufmass hier NICHT an, damit deine Eingaben nicht gelöscht werden!
        aufmass: prev.aufmass 
      };
    });

    // 3. Karten-Array aktualisieren
    if (setProjects) {
      setProjects(prevProjects => {
        return prevProjects.map(p => p.id === updatedRecord.id ? updatedRecord : p);
      });
    }

    setTimeout(() => setToast(null), 2500);
    console.log("Änderungen erfolgreich gespeichert und geloggt");
  } catch (err) {
    console.error("Detaillierter Speicherfehler:", err);
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
    // WICHTIG: Hier muss das Projekt auf null gesetzt werden, 
    // damit deine Layout-Logik weiß, dass wir nicht mehr im Projekt-Detail sind.
    setSelectedProject(null); 
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
    formData.append('ab_hsw', form.ab_hsw || "");
    formData.append('ab_mueller', form.ab_mueller || "");
    formData.append('pgk', form.pgk || "");
    formData.append('notes', form.notes || "");

    // JSON-Felder hinzufügen
    formData.append('position', JSON.stringify(selectedPosition));
    formData.append('masten', JSON.stringify(form.masten || []));
    formData.append('log', JSON.stringify(form.log || []));
    formData.append('aufmass', JSON.stringify(form.aufmass || []));

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

  // Prüfe: Ist der Tab korrekt UND sind wir in der Detailansicht (Projekt offen)?
  const isWideLayout = (activeTab === "Aufmaß" || activeTab === "Abrechnung") && !!selectedProject;

  return (
  <div className="app-layout">
    
    {/* Das Banner ist JETZT IMMER SICHTBAR (außer bei 'hidden') */}
    {updateStatus !== 'hidden' && (
  <div className="update-banner-container">
    {/* Die CSS-Klasse ändert sich dynamisch, z. B. zu "update-banner downloading" */}
    <div className={`update-banner ${updateStatus}`}>
      
      <div className="update-content">
        <span>
          {updateStatus === 'checking' && `🔍 App-Version: v${version || '1.0.2'} (Prüfe auf Updates...)`}
          {updateStatus === 'up-to-date' && `✨ App-Version: v${version} (Aktuell)`}
          {updateStatus === 'downloading' && `⏳ Neues Update wird im Hintergrund geladen... (${Math.round(downloadPercent)}%)`}
          {updateStatus === 'ready' && `🎉 Update erfolgreich geladen! Bereit zum Installieren.`}
        </span>

        {updateStatus === 'ready' && (
          <button 
            className="update-btn"
            onClick={() => {
              if (window.desktopAPI && window.desktopAPI.send) {
                window.desktopAPI.send('install-update');
              }
            }}
          >
            Jetzt installieren & App neu starten
          </button>
        )}
      </div>
      
      {/* Das Schließen-Kreuz */}
      <button 
        className="update-close" 
        onClick={() => setUpdateStatus('hidden')}
      >
        ✕
      </button>

    </div>
  </div>
)}

      {!user ? (
      /* --- LOGIN BEREICH --- */
      <div className="login-overlay" style={{
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  width: '100%', height: '100vh', backgroundColor: '#2c3e50', color: 'white'
}}>
  <form onSubmit={(e) => {
    e.preventDefault();
    // Speichern der E-Mail, wenn Checkbox aktiv ist
    if (rememberMe) {
      localStorage.setItem("baustellen_remembered_email", loginEmail);
    } else {
      localStorage.removeItem("baustellen_remembered_email");
    }
    handleLogin(e); // Deine eigentliche Login-Funktion aufrufen
  }} style={{
    backgroundColor: 'white', padding: '30px', borderRadius: '8px', 
    display: 'flex', flexDirection: 'column', width: '300px', gap: '15px'
  }}>
    <h2 style={{ color: '#2c3e50', margin: '0 0 10px 0', textAlign: 'center' }}>Baustellen Login</h2>
    
    <input 
      type="email" placeholder="E-Mail" value={loginEmail} 
      onChange={(e) => setLoginEmail(e.target.value)}
      style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ddd', color: '#333' }}
      required 
    />
    
    <input 
      type="password" placeholder="Passwort" value={loginPass} 
      onChange={(e) => setLoginPass(e.target.value)}
      style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ddd', color: '#333' }}
      required 
    />

    {/* --- NEU: "Merken" Checkbox --- */}
    <label style={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: '8px', 
      color: '#2c3e50', 
      fontSize: '14px', 
      cursor: 'pointer',
      userSelect: 'none'
    }}>
      <input 
        type="checkbox" 
        checked={rememberMe} 
        onChange={(e) => setRememberMe(e.target.checked)}
        style={{ cursor: 'pointer', width: '16px', height: '16px' }}
      />
      E-Mail Adresse merken
    </label>

    <button type="submit" style={{
      padding: '10px', backgroundColor: '#3498db', color: 'white', 
      border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold',
      marginTop: '5px'
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
        style={{
          left: sidebarOpen && isWideLayout ? "min(85vw, 1225px)" : undefined,
          transition: "left 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          zIndex: isWideLayout ? 51 : undefined
        }}
      >
        {sidebarOpen ? "◀" : "☰"}
      </button>
    
    {/* HIER WIRD DIE BREITE LIVE ERWEITERT, WENN DER TAB "Aufmaß" AKTIV IST */}
    <div 
      className={`sidebar ${sidebarOpen ? "open" : "closed"}`}
      style={{
        width: isWideLayout && sidebarOpen ? "85vw" : undefined,
        maxWidth: isWideLayout && sidebarOpen ? "1200px" : undefined,
        zIndex: isWideLayout ? 50 : undefined,
        transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s ease",
      }}
    >
      <div className="sidebar-content" style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100%', 
        overflow: 'hidden' 
      }}>
        
        {/* --- 1. STATISCHER HEADER (Bleibt immer oben) --- */}
        <div className="sidebar-header-static" style={{ 
          padding: '5px', 
          flexShrink: 0, 
          borderBottom: '1px solid #eee',
          backgroundColor: '#fff',
          zIndex: 10
        }}>
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

      {/* SUCHE UND FILTER: Jetzt HIER im statischen Header */}
      {mode === "list" && (
        <div style={{ marginTop: "5px" }}>
          {/* Suche */}
          <div style={{ position: "relative", width: "100%", marginBottom: "10px" }}>
            <input
              type="text"
              placeholder="Suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 35px 8px 10px",
                borderRadius: "4px",
                border: "1px solid #ffa500",
                boxSizing: "border-box"
              }}
            />
            {search && (
              <span
                onClick={() => setSearch("")}
                style={{
                  position: "absolute",
                  right: "10px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  cursor: "pointer",
                  color: "#999",
                  fontSize: "20px",
                  lineHeight: "1",
                  zIndex: 10
                }}
              >✕</span>
            )}
          </div>

          {/* Filter-Selects */}
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '12px', display: 'block', marginBottom: '2px' }}>Status</label>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ width: '100%' }}>
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
              <label style={{ fontSize: '12px', display: 'block', marginBottom: '2px' }}>Typ</label>
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ width: '100%' }}>
                <option>Alle</option>
                <option>Konzept</option>
                <option>Anfahrschaden</option>
                <option>Störung</option>
                <option>LK-Tausch</option>
                <option>Sonstiges</option>
              </select>
            </div>
          </div>
        </div>
      )}
      <h3>Baustellen</h3>
              {mode === "detail" && (
                <div style={{ background: STATUS_COLORS[form.status] || "#999", color: "white", padding: "8px 12px", borderRadius: "8px", marginBottom: "10px", fontWeight: "bold", textAlign: "center" }}>
                  {form.status}
                </div>
              )}

              {mode === "detail" && (
                <div className="tabs" style={{ 
                  display: "grid", 
                  gridTemplateColumns: "repeat(3, 1fr)", // Erzwingt immer genau 3 Spalten
                  gap: "8px",                            // Abstand zwischen den Feldern
                  marginBottom: "16px" 
                }}>
                  {tabs.map((t) => (
                    <div 
                      key={t} 
                      className={`tab ${activeTab === t ? "active" : ""}`} 
                      onClick={() => {
                        if (t === "Vorlage") copyTemplate();
                        else setActiveTab(t);
                      }}
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        padding: "10px",
                        textAlign: "center",
                        cursor: "pointer",
                        // Hier stellst du sicher, dass sie nicht "aufgebläht" werden
                        whiteSpace: "nowrap" 
                      }}
                    >
                      {t}
                    </div>
                  ))}
                </div>
              )}
              {/* Hier einfügen wenn nicht scrollbar sein soll */}

    </div>
          
    <div className="sidebar-scroll-area" style={{ 
          flexGrow: 1, 
          overflowY: 'auto', // Nur hier wird gescrollt
          padding: '5px'
        }}>
              {mode === "list" && (
                <>
                  <div style={{ position: "relative", width: "100%", marginBottom: "10px" }}>
      </div>
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
          {p.ab_hsw && <div style={{ fontSize: 12 }}>AB HSW: {p.ab_hsw}</div>}
          {p.ab_mueller && <div style={{ fontSize: 12 }}>AB Müller: {p.ab_mueller}</div>}
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
                <label>AB-Nummer HSW</label>
                <input value={form.ab_hsw || ""} onChange={(e) => setForm({ ...form, ab_hsw: e.target.value })} />
                <label>AB-Nummer Müller</label>
                <input value={form.ab_mueller || ""} onChange={(e) => setForm({ ...form, ab_mueller: e.target.value })} />
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
  <div className="masten-container">
    {(() => {
      const totalMasten = form.masten.length;
      const countMontage = form.masten.filter(m => m.aktion === "Montage").length;
      const countDemontage = form.masten.filter(m => m.aktion === "Demontage").length;
      const countTausch = form.masten.filter(m => m.aktion === "Tausch").length;
      const LEUCHTEN_DATA = {
        "Trilux Cuvia 40": 2600,
        "Trilux Cuvia 60": 2600,
        "Trilux 9821": 2600,
        "Trilux 9701": 4600
      };

      return (
        <>
        {/* --- NEU: STATISTIK ÜBERSICHT --- */}
          <div className="stats-container">
            <div className="stat-card">
              <span className="stat-value">{totalMasten}</span>
              <span className="stat-label">Gesamt</span>
            </div>
            <div className="stat-card stat-tausch">
              <span className="stat-value" style={{color: '#3b82f6'}}>{countTausch}</span>
              <span className="stat-label">Tausch</span>
            </div>
            <div className="stat-card stat-montage">
              <span className="stat-value" style={{color: '#22c55e'}}>{countMontage}</span>
              <span className="stat-label">Montage</span>
            </div>
            <div className="stat-card stat-demontage">
              <span className="stat-value" style={{color: '#ef4444'}}>{countDemontage}</span>
              <span className="stat-label">Demontage</span>
            </div>
          </div>

          {/* --- MASSENANLAGE TOOLBAR --- */}
          <div className="batch-bar" style={{ display: 'flex', gap: '15px', alignItems: 'flex-end', flexWrap: 'wrap', background: '#1e293b', padding: '15px', borderRadius: '8px' }}>
  
  <div className="field-group">
    <span className="field-label" style={{color: '#cbd5e1'}}>Anzahl</span>
    <input type="number" id="batch-count" defaultValue="1" className="mast-input-base" style={{width: '45px'}} />
  </div>

  <div className="field-group">
    <span className="field-label" style={{color: '#cbd5e1'}}>Aktion</span>
    <select 
      id="batch-aktion" 
      className="mast-input-base" 
      style={{width: '110px'}} 
      value={batchAktion} 
      onChange={(e) => setBatchAktion(e.target.value)} // Setzt den React-State
    >
      <option value="Tausch">Tausch</option>
      <option value="Montage">Montage</option>
      <option value="Demontage">Demontage</option>
    </select>
  </div>

  {/* ALT-FELDER (Wird nur bei Tausch oder Demontage angezeigt) */}
  {(batchAktion === "Tausch" || batchAktion === "Demontage") && (
    <div id="batch-alt-fields" style={{display: 'flex', gap: '10px'}}>
      <div className="field-group">
        <span className="field-label" style={{color: '#fc8181'}}>Mast Art Alt</span>
        <select id="batch-masttyp-alt" className="mast-input-base" style={{width: '100px'}}>
          <option value="Gerade">Gerade</option>
          <option value="Gebogen">Gebogen</option>
        </select>
      </div>
      <div className="field-group">
        <span className="field-label" style={{color: '#fc8181'}}>LPH Alt</span>
        <input id="batch-lph-alt" defaultValue="4,5" className="mast-input-base" style={{width: '50px'}} />
      </div>
    </div>
  )}

  {/* NEU-FELDER (Wird nur bei Tausch oder Montage angezeigt) */}
  {(batchAktion === "Tausch" || batchAktion === "Montage") && (
    <div id="batch-neu-fields" style={{display: 'flex', gap: '10px', flex: 1, minWidth: '200px', flexWrap: 'wrap'}}>
      <div className="field-group">
        <span className="field-label" style={{color: '#3b82f6'}}>Mast Art Neu</span>
        <select id="batch-masttyp-neu" className="mast-input-base" style={{width: '100px'}}>
          <option value="Gerade">Gerade</option>
          <option value="Gebogen">Gebogen</option>
        </select>
      </div>

      <div className="field-group" style={{flex: 1, minWidth: '180px'}}>
        <span className="field-label" style={{color: '#3b82f6'}}>Leuchte *</span>
        <select id="batch-neu" className="mast-input-base" style={{width: '100%'}} onChange={(e) => {
          const val = e.target.value;
          const lm = LEUCHTEN_DATA[val];
          if (val === "CUSTOM") {
            document.getElementById('batch-neu-custom').style.display = 'block';
            document.getElementById('batch-lumen-neu').value = ""; 
          } else {
            document.getElementById('batch-neu-custom').style.display = 'none';
            if(lm) document.getElementById('batch-lumen-neu').value = lm;
          }
        }}>
          <option value="">Wählen...</option>
          {Object.keys(LEUCHTEN_DATA).map(t => <option key={t} value={t}>{t}</option>)}
          <option value="CUSTOM" style={{fontWeight: 'bold', color: '#3b82f6'}}>— Sonstiges (Freitext) —</option>
        </select>

        <input 
          type="text" 
          id="batch-neu-custom" 
          placeholder="Eigene Leuchte eingeben..." 
          className="mast-input-base" 
          style={{width: '100%', marginTop: '5px', display: 'none'}} 
        />
      </div>

      <div className="field-group">
        <span className="field-label" style={{color: '#3b82f6'}}>LPH Neu</span>
        <input id="batch-lph-neu" defaultValue="4,5" className="mast-input-base" style={{width: '50px'}} />
      </div>
      <div className="field-group">
        <span className="field-label" style={{color: '#3b82f6'}}>Lumen</span>
        <input type="number" id="batch-lumen-neu" defaultValue="2600" className="mast-input-base" style={{width: '70px'}} />
      </div>
    </div>
  )}

  {/* DER BUTTON STEHT NUN BOMBENFEST RECHTS NEBEN DEN AKTIVEN FELDERN */}
  <button 
    style={{
      background: '#22c55e', 
      color: 'white', 
      border: 'none', 
      borderRadius: '6px', 
      height: '32px', 
      padding: '0 15px', 
      fontWeight: 'bold', 
      cursor: 'pointer', 
      alignSelf: 'flex-end',
      marginLeft: 'auto' // Schiebt den Button immer ganz nach rechts außen!
    }}
    onClick={() => {
      const count = parseInt(document.getElementById('batch-count')?.value || "1");
      
      let selectedLeuchte = "";
      let lumenValue = "";
      let mastTypNeuValue = "";
      let lphNeuValue = "";

      if (batchAktion !== "Demontage") {
        const dropDownValue = document.getElementById('batch-neu').value;
        selectedLeuchte = dropDownValue;
        if (dropDownValue === "CUSTOM") {
          selectedLeuchte = document.getElementById('batch-neu-custom').value.trim();
        }

        if (!selectedLeuchte) {
          setAlertToast({ show: true, message: "Bitte wählen Sie eine Leuchte aus oder tragen Sie eine eigene Bezeichnung ein!" });
          setTimeout(() => setAlertToast({ show: false, message: "" }), 3000);
          return; 
        }

        lumenValue = document.getElementById('batch-lumen-neu').value;
        mastTypNeuValue = document.getElementById('batch-masttyp-neu').value;
        lphNeuValue = document.getElementById('batch-lph-neu').value;
      }

      const mastTypAltValue = (batchAktion === "Tausch" || batchAktion === "Demontage") ? document.getElementById('batch-masttyp-alt').value : "";
      const lphAltValue = (batchAktion === "Tausch" || batchAktion === "Demontage") ? document.getElementById('batch-lph-alt').value : "";

      const neue = Array.from({ length: count }, () => ({
        aktion: batchAktion,
        mastTypAlt: mastTypAltValue,
        lphAlt: lphAltValue,
        mastTypNeu: mastTypNeuValue, 
        lphNeu: lphNeuValue,
        leuchten: batchAktion !== "Demontage" ? [{ typ: selectedLeuchte, lumen: lumenValue }] : []
      }));
      
      setForm({ ...form, masten: [...form.masten, ...neue] });

      if (batchAktion !== "Demontage") {
        document.getElementById('batch-neu').value = "";
        document.getElementById('batch-neu-custom').value = "";
        document.getElementById('batch-neu-custom').style.display = 'none';
      }
    }}
  >
    + Hinzufügen
  </button>
</div>

          {/* --- MASTEN LISTE --- */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {form.masten.map((m, i) => {
              const currentTyp = m.leuchten && m.leuchten[0] ? m.leuchten[0].typ : "";
              const isCustomLeuchte = currentTyp && !LEUCHTEN_DATA[currentTyp] && currentTyp !== "";
              return (
              <div key={i} className="mast-card">
                
                {/* HEADER */}
                <div className="mast-header">
                  <div className="field-group">
                    <span className="field-label">Mast</span>
                    <div className="mast-num-badge">{i + 1}</div>
                  </div>
                  <div className="field-group">
                    <span className="field-label">Aktion</span>
                    <select className="mast-input-base" style={{ width: '110px' }} value={m.aktion} onChange={(e) => updateMast(i, 'aktion', e.target.value)}>
                      <option value="Tausch">Tausch</option>
                      <option value="Montage">Montage</option>
                      <option value="Demontage">Demontage</option>
                    </select>
                  </div>
                  <div className="header-actions" style={{ display: 'flex', gap: '10px', marginLeft: 'auto' }}>
                    <button>
                      📷
                    </button>
  
                    <button style={{ 
                      background: '#ef4444',
                    }} 
                    onClick={() => {
                      const n = [...form.masten]; 
                      n.splice(i, 1); 
                      setForm({ ...form, masten: n });
                    }}>
                      🗑️
                    </button>
                  </div>
                </div>

                {/* BESTAND (ALT) */}
                {(m.aktion === "Tausch" || m.aktion === "Demontage") && (
                  <div className="alt-section">
                    <span style={{fontSize: '10px', fontWeight: '800', color: '#c53030', display: 'block', marginBottom: '8px'}}>BESTAND AM MAST (ALT)</span>
                    <div style={{display: 'flex', gap: '15px'}}>
                      <div className="field-group" style={{flex: 1}}>
                        <span className="field-label">Alter Masttyp</span>
                        <select className="mast-input-base" style={{width: '100%'}} value={m.mastTypAlt} onChange={(e) => updateMast(i, 'mastTypAlt', e.target.value)}>
                          <option value="Gerade">Gerade</option>
                          <option value="Gebogen">Gebogen</option>
                        </select>
                      </div>
                      <div className="field-group">
                        <span className="field-label">LPH Alt</span>
                        <input className="mast-input-base" style={{width: '70px'}} value={m.lphAlt} onChange={(e) => updateMast(i, 'lphAlt', e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}

                {/* PLANUNG (NEU) */}
                {(m.aktion === "Tausch" || m.aktion === "Montage") && (
                  <div className="neu-section">
                    <span style={{fontSize: '10px', fontWeight: '800', color: '#2b6cb0', display: 'block', marginBottom: '8px'}}>NEUE INSTALLATION (NEU)</span>
                    <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
                       <div className="field-group" style={{width: '120px'}}>
                <span className="field-label">Neuer Masttyp</span>
                <select 
                  className="mast-input-base" 
                  value={m.mastTypNeu} 
                  onChange={(e) => updateMast(i, 'mastTypNeu', e.target.value)}
                >
                  <option value="Gerade">Gerade</option>
                  <option value="Gebogen">Gebogen</option>
                </select>
              </div>
                      <div className="field-group" style={{flex: 1, minWidth: '150px'}}>
                <span className="field-label">Leuchte</span>
                <select 
                  className="mast-input-base" 
                  style={{width: '100%'}} 
                  value={isCustomLeuchte ? "CUSTOM" : currentTyp} 
                  onChange={(e) => {
                    const val = e.target.value;
                    const nl = m.leuchten ? [...m.leuchten] : [{ typ: "", lumen: "" }];
                    if (val === "CUSTOM") {
                      nl[0].typ = ""; 
                    } else {
                      nl[0].typ = val;
                      if (LEUCHTEN_DATA[val]) nl[0].lumen = LEUCHTEN_DATA[val];
                    }
                    updateMast(i, 'leuchten', nl);
                  }}
                >
                  <option value="">Wählen...</option>
                  {Object.keys(LEUCHTEN_DATA).map(t => <option key={t} value={t}>{t}</option>)}
                  <option value="CUSTOM">— Sonstiges (Freitext) —</option>
                </select>

                {(isCustomLeuchte || currentTyp === "") && (
                  <input 
                    type="text"
                    className="mast-input-base"
                    style={{width: '100%', marginTop: '5px'}}
                    placeholder="Eigene Leuchte bearbeiten..."
                    value={currentTyp}
                    onChange={(e) => {
                      const nl = m.leuchten ? [...m.leuchten] : [{ typ: "", lumen: "" }];
                      nl[0].typ = e.target.value;
                      updateMast(i, 'leuchten', nl);
                    }}
                  />
                )}
              </div>
                      <div className="field-group">
                <span className="field-label">LPH Neu</span>
                <input 
                  className="mast-input-base" 
                  style={{width: '60px'}} 
                  value={m.lphNeu} 
                  onChange={(e) => updateMast(i, 'lphNeu', e.target.value)} 
                />
              </div>
                      <div className="field-group">
                <span className="field-label">Lumen</span>
                <input 
                  className="mast-input-base" 
                  style={{ width: '80px' }} 
                  value={m.leuchten && m.leuchten[0] ? m.leuchten[0].lumen : ""} 
                  onChange={(e) => {
                    const nl = m.leuchten ? [...m.leuchten] : [{ typ: "", lumen: "" }]; 
                    nl[0].lumen = e.target.value; 
                    updateMast(i, 'leuchten', nl);
                  }} 
                />
              </div>
                    </div>
                  </div>
                )}
              </div>
            )})}
          </div>
        </>
      );
    })()}
  </div>
)}

{activeTab === "Aufmaß" && (
  <div className="masten-container" style={{ color: '#f1f5f9', padding: '4px', fontSize: '12px' }}>
    
    {/* 1. ALLGEMEIN SEKTION */}
    <div className="aufmass-allgemein-row">
      <div className="aufmass-flex-center" style={{ gap: '8px' }}>
        <span className="aufmass-section-title">🚛 Transport:</span>
        <input 
          type="text" 
          inputMode="decimal"
          className="mast-input-base" 
          style={{ width: '50px', padding: '2px 6px', height: '26px', borderRadius: '4px' }}
          value={form.aufmass?.allgemein?.transport || ""} 
          onChange={(e) => updateAufmassAllgemein('transport', e.target.value)} 
        />
        <span className="aufmass-text-muted">Std</span>
      </div>

      <div className="aufmass-flex-center" style={{ gap: '8px', flex: 1, maxWidth: '500px' }}>
        <span className="aufmass-section-title">📝 Infos:</span>
        <input 
          type="text"
          className="mast-input-base" 
          style={{ padding: '2px 6px', height: '26px', borderRadius: '4px', width: '100%' }}
          placeholder="Anmerkungen zur Baustelle..."
          value={form.aufmass?.allgemein?.extraInfos || ""} 
          onChange={(e) => updateAufmassAllgemein('extraInfos', e.target.value)} 
        />
      </div>

      <button 
        onClick={resetAufmassVonMasten}
        style={{
          marginBottom: '20px',
          padding: '10px 20px',
          background: '#ef4444', // Ein Rot, um zu signalisieren: Achtung, das setzt zurück!
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}
      >
        <span>🗑️ Aufmaß komplett neu laden</span>
      </button>

      <details className="aufmass-summen-details">
        <summary className="aufmass-summen-summary">📦 Summen</summary>
        <div className="aufmass-summen-content">
          <div>Kabel: <strong className="aufmass-summen-val">{Array.isArray(form.aufmass?.masten) ? form.aufmass.masten.reduce((sum, m) => sum + (Number(String(m.aufmassKabel || '').replace(',', '.')) || 0), 0) : 0} m</strong></div>
          <div>Muffen: <strong className="aufmass-summen-val">{Array.isArray(form.aufmass?.masten) ? form.aufmass.masten.reduce((sum, m) => sum + (Number(m.muffenMontierenBis1m) || 0) + (Number(m.muffenMontierenUeber1m) || 0) + (Number(m.muffenMontierenDemo) || 0) + (Number(m.muffenMontierenTausch) || 0), 0) : 0} Stk</strong></div>
        </div>
      </details>
    </div>

    {/* 2. DYNAMISCHE MASTEN-KARTEN */}
    {Array.isArray(form.aufmass?.masten) && form.aufmass.masten.length > 0 ? (
      form.aufmass.masten.map((m, i) => (
        <div key={i} className="aufmass-mast-card">
          
          <div className="aufmass-card-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '4px' }}>
            
            <div className="aufmass-badge-container" style={{ flexShrink: 0 }}>
              <span className="aufmass-badge-label">MAST</span>
              <div className="aufmass-badge-num">{i + 1}</div>
            </div>
 
            <div style={{ width: '110px', minWidth: '110px', flexShrink: 0 }}>
              <select 
                className="mast-input-base" 
                style={{ padding: '0 6px', height: '26px', width: '100%', borderRadius: '4px' }} 
                value={m.aktion || "Montage"} 
                onChange={(e) => updateAufmass(i, 'aktion', e.target.value)}
              >
                <option value="Montage">Montage</option>
                <option value="Demontage">Demontage</option>
                <option value="Tausch">Tausch</option>
              </select>
            </div>

            {/* --- REGULÄR: MONTAGE / DEMONTAGE --- */}
            {m.aktion !== "Tausch" && (
              <div className="aufmass-flex-center" style={{ gap: '6px' }}>
                {/* LPH (Logik bleibt wie bisher) */}
                <input 
                  type="text" 
                  className="mast-input-base" 
                  style={{ width: '45px', height: '26px', borderRadius: '4px', textAlign: 'center' }} 
                  value={m.lichtpunkthoehe || form.masten?.[i]?.lichtpunkthoehe || ""} 
                  onChange={(e) => updateAufmass(i, 'lichtpunkthoehe', e.target.value)} 
                />
                
                {/* TYP (Dynamisch je nach Aktion: Demontage -> Alt, Montage -> Neu) */}
                <select 
                    className="mast-input-base" 
                    style={{ height: '26px', width: '90px', borderRadius: '4px' }} 
                    // WENN Demontage: nimm mastTypAlt, SONST mastTypNeu
                    value={
                      m.aktion === "Demontage" 
                        ? (m.mastTypAlt || form.masten?.[i]?.mastTypAlt || "Gerade") 
                        : (m.mastTypNeu || form.masten?.[i]?.mastTypNeu || "Gerade")
                    }
                    // WENN Demontage: update mastTypAlt, SONST update mastTypNeu
                    onChange={(e) => updateAufmass(i, m.aktion === "Demontage" ? 'mastTypAlt' : 'mastTypNeu', e.target.value)}
                >
                    <option value="Gerade">Gerade</option>
                    <option value="Gebogen">Gebogen</option>
                </select>

                {/* Sub-Typ (Fundament/Rohr...) */}
                <select 
                    className="mast-input-base" 
                    style={{ height: '26px', width: '110px', borderRadius: '4px' }} 
                    value={m.aktion === "Demontage" ? (m.demontageTyp || "Fundament") : (m.montageTyp || "Fundament")} 
                    onChange={(e) => updateAufmass(i, m.aktion === "Demontage" ? 'demontageTyp' : 'montageTyp', e.target.value)}
                >
                  <option value="Fundament">Fundament</option>
                  <option value="PVC-Rohr">PVC-Rohr</option>
                  <option value="Flanschplatte">Flanschplatte</option>
                </select>
              </div>
            )}

            {/* --- SPEZIALFALL: TAUSCH --- */}
            {m.aktion === "Tausch" && (
              <div className="aufmass-flex-center" style={{ gap: '8px', borderLeft: '1px solid #334155', paddingLeft: '12px', flexShrink: 0 }}>
                
                {/* Alt */}
                <div className="aufmass-flex-center" style={{ gap: '2px' }}>
                  <span style={{ fontSize: '10px', color: '#94a3b8' }}>Alt:</span>
                  <input 
                    type="text" 
                    className="mast-input-base" 
                    style={{ width: '35px', height: '26px', textAlign: 'center' }} 
                    value={m.lphAlt || form.masten?.[i]?.lphAlt || ""} 
                    onChange={(e) => updateAufmass(i, 'lphAlt', e.target.value)} 
                  />
                  <select 
                    className="mast-input-base" 
                    style={{ height: '26px', width: '75px' }} 
                    value={m.mastTypAlt || form.masten?.[i]?.mastTypAlt || "Gerade"} 
                    onChange={(e) => updateAufmass(i, 'mastTypAlt', e.target.value)}
                  >
                    <option value="Gerade">Gerade</option>
                    <option value="Gebogen">Gebogen</option>
                  </select>
                </div>
                
                {/* Neu */}
                <div className="aufmass-flex-center" style={{ gap: '2px' }}>
                  <span style={{ fontSize: '10px', color: '#94a3b8' }}>Neu:</span>
                  <input 
                    type="text" 
                    className="mast-input-base" 
                    style={{ width: '35px', height: '26px', textAlign: 'center' }} 
                    value={m.lphNeu || form.masten?.[i]?.lphNeu || ""} 
                    onChange={(e) => updateAufmass(i, 'lphNeu', e.target.value)} 
                  />
                  <select 
                    className="mast-input-base" 
                    style={{ height: '26px', width: '75px' }} 
                    value={m.mastTypNeu || form.masten?.[i]?.mastTypNeu || "Gerade"} 
                    onChange={(e) => updateAufmass(i, 'mastTypNeu', e.target.value)}
                  >
                    <option value="Gerade">Gerade</option>
                    <option value="Gebogen">Gebogen</option>
                  </select>
                </div>

                {/* Dropdowns für Tausch-Typen */}
                <div className="aufmass-flex-center" style={{ gap: '4px', borderLeft: '1px solid #334155', paddingLeft: '8px' }}>
                  <select className="mast-input-base" style={{ height: '26px', width: '90px', borderRadius: '4px' }} value={m.tauschDemoTyp || "Fundament"} onChange={(e) => updateAufmass(i, 'tauschDemoTyp', e.target.value)}>
                    <option value="Fundament">Fund. (Alt)</option>
                    <option value="PVC-Rohr">PVC (Alt)</option>
                    <option value="Flanschplatte">Flansch (Alt)</option>
                  </select>
                  
                  <select className="mast-input-base" style={{ height: '26px', width: '90px', borderRadius: '4px' }} value={m.tauschMontageTyp || "Fundament"} onChange={(e) => updateAufmass(i, 'tauschMontageTyp', e.target.value)}>
                    <option value="Fundament">Fund. (Neu)</option>
                    <option value="PVC-Rohr">PVC (Neu)</option>
                    <option value="Flanschplatte">Flansch (Neu)</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* ZEILE 2: CORE WORKFLOWS */}
          <div className="aufmass-grid-2col">
            <div className="aufmass-inner-block">
              <div className="aufmass-row-justify">
                <div className="aufmass-flex-center">
                  <span style={{ color: '#38bdf8', fontWeight: '500' }}>🪵 Oberfläche:</span>
                  <select className="mast-input-base" style={{ padding: '2px 4px', height: '24px', width: '120px', borderRadius: '4px' }} value={m.oberflaeche || "Grass"} onChange={(e) => updateAufmass(i, 'oberflaeche', e.target.value)}>
                    <option value="Grass">Grass / Acker</option>
                    <option value="Platten">Platten / Pflaster</option>
                    <option value="Asphalt">Asphalt / Bitum</option>
                  </select>
                </div>

                {m.oberflaeche !== "Grass" && (
                  <div className="aufmass-oberflaeche-dim">
                    <input type="text" inputMode="decimal" placeholder="X" className="mast-input-base" style={{ padding: '1px 3px', width: '40px', height: '22px', textAlign: 'center', borderRadius: '4px' }} value={m.oberflaecheX || ""} onChange={(e) => updateAufmass(i, 'oberflaecheX', e.target.value)} />
                    <span className="aufmass-text-subtle">×</span>
                    <input type="text" inputMode="decimal" placeholder="Y" className="mast-input-base" style={{ padding: '1px 3px', width: '40px', height: '22px', textAlign: 'center', borderRadius: '4px' }} value={m.oberflaecheY || ""} onChange={(e) => updateAufmass(i, 'oberflaecheY', e.target.value)} />
                    <span style={{ borderLeft: '1px solid #334155', paddingLeft: '4px', marginLeft: '2px', color: '#22c55e', fontWeight: 'bold' }}>
                      {((parseFloat(String(m.oberflaecheX || '').replace(',', '.')) || 0) * (parseFloat(String(m.oberflaecheY || '').replace(',', '.')) || 0)).toFixed(2)} m²
                    </span>
                  </div>
                )}
              </div>

              <div className="aufmass-kabel-zone">
                <div className="aufmass-row-justify">
                  <div className="aufmass-flex-center" style={{ gap: '4px' }}>
                    <span>🔗 Kabel:</span>
                    <input type="text" inputMode="decimal" className="mast-input-base" style={{ padding: '2px 4px', height: '24px', width: '55px', borderRadius: '4px', textAlign: 'center' }} placeholder="0" value={m.aufmassKabel || ""} onChange={(e) => updateAufmass(i, 'aufmassKabel', e.target.value)} />
                    <span className="aufmass-text-subtle">m</span>
                  </div>

                  <details className="aufmass-sondersachen-dropdown">
                    <summary className="aufmass-sondersachen-summary">🛠️ Sondersachen</summary>
                    <div className="aufmass-sondersachen-content">
                      <div className="aufmass-row-justify">
                        <span style={{ fontSize: '11px', color: '#cbd5e1' }}>Rasenkanten:</span>
                        <div className="aufmass-flex-center" style={{ gap: '3px' }}>
                          <input type="text" inputMode="decimal" placeholder="0" className="mast-input-base" style={{ width: '40px', padding: '1px 3px', height: '20px', textAlign: 'center', borderRadius: '4px' }} value={m.sondersacheRasenkante || ""} onChange={(e) => updateAufmass(i, 'sondersacheRasenkante', e.target.value)} />
                          <span className="aufmass-text-subtle" style={{ fontSize: '10px' }}>Stk</span>
                        </div>
                      </div>
                      <div className="aufmass-row-justify">
                        <span style={{ fontSize: '11px', color: '#cbd5e1' }}>Bordsteine:</span>
                        <div className="aufmass-flex-center" style={{ gap: '3px' }}>
                          <input type="text" inputMode="decimal" placeholder="0" className="mast-input-base" style={{ width: '40px', padding: '1px 3px', height: '20px', textAlign: 'center', borderRadius: '4px' }} value={m.sondersacheBordstein || ""} onChange={(e) => updateAufmass(i, 'sondersacheBordstein', e.target.value)} />
                          <span className="aufmass-text-subtle" style={{ fontSize: '10px' }}>Stk</span>
                        </div>
                      </div>
                      <div className="aufmass-row-justify">
                        <span style={{ fontSize: '11px', color: '#cbd5e1' }}>Rinnenfluss:</span>
                        <div className="aufmass-flex-center" style={{ gap: '3px' }}>
                          <input type="text" inputMode="decimal" placeholder="0" className="mast-input-base" style={{ width: '40px', padding: '1px 3px', height: '20px', textAlign: 'center', borderRadius: '4px' }} value={m.sondersacheRinnenfluss || ""} onChange={(e) => updateAufmass(i, 'sondersacheRinnenfluss', e.target.value)} />
                          <span className="aufmass-text-subtle" style={{ fontSize: '10px' }}>m²</span>
                        </div>
                      </div>
                    </div>
                  </details>
                </div>
              </div>
            </div>

            {/* RECHTER BLOCK: ANSCHLÜSSE */}
            <div className="aufmass-inner-block" style={{ padding: '6px 10px' }}>
              {m.aktion === "Montage" && (
                <div className="aufmass-grid-2col" style={{ gap: '15px' }}>
                  <div className="aufmass-anschluss-col">
                    <div className="aufmass-row-justify">
                      <span style={{ fontSize: '11px' }}>Anschluss bis 1m (Stk):</span>
                      <input type="number" className="mast-input-base" style={{ width: '40px', padding: '2px', height: '22px', borderRadius: '4px' }} placeholder="0" value={m.netzanschlussBis1m || ""} onChange={(e) => updateAufmass(i, 'netzanschlussBis1m', e.target.value)} />
                    </div>
                    {Number(m.netzanschlussBis1m) > 0 && (
                      <div className="aufmass-sub-muffen-montage">
                        <span style={{ color: '#cbd5e1' }}>↳ Muffen mont.:</span>
                        <input type="number" className="mast-input-base" style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} placeholder="0" value={m.muffenMontierenBis1m || ""} onChange={(e) => updateAufmass(i, 'muffenMontierenBis1m', e.target.value)} />
                      </div>
                    )}
                  </div>

                  <div className="aufmass-anschluss-col-right">
                    <div className="aufmass-row-justify">
                      <span style={{ fontSize: '11px' }}>Anschluss über 1m (Stk):</span>
                      <input type="number" className="mast-input-base" style={{ width: '40px', padding: '2px', height: '22px', borderRadius: '4px' }} placeholder="0" value={m.netzanschlussUeber1m || ""} onChange={(e) => updateAufmass(i, 'netzanschlussUeber1m', e.target.value)} />
                    </div>
                    {Number(m.netzanschlussUeber1m) > 0 && (
                      <div className="aufmass-sub-graben-details">
                        <span>↳ Muffen mont. (Stk):</span>
                        <input type="number" className="mast-input-base" style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenMontierenUeber1m || ""} onChange={(e) => updateAufmass(i, 'muffenMontierenUeber1m', e.target.value)} />
                        <span>↳ Graben 30/60 (m):</span>
                        <input type="text" inputMode="decimal" className="mast-input-base" style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.grabenTiefeBreite || ""} onChange={(e) => updateAufmass(i, 'grabenTiefeBreite', e.target.value)} />
                        <span>↳ Graben-Oberfläche:</span>
                        <select className="mast-input-base" style={{ width: '70px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.oberflaecheGraben || "Platten"} onChange={(e) => updateAufmass(i, 'oberflaecheGraben', e.target.value)}>
                          <option value="Grass">Grass</option>
                          <option value="Platten">Platten</option>
                          <option value="Asphalt">Asphalt</option>
                        </select>
                        <span>↳ Kabelverlegen (m):</span>
                        <input type="text" inputMode="decimal" className="mast-input-base" style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.grabenKabelverlegen || ""} onChange={(e) => updateAufmass(i, 'grabenKabelverlegen', e.target.value)} />
                        <span>↳ Montagegrube (Stk):</span>
                        <input 
                          type="number" 
                          className="mast-input-base" 
                          style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} 
                          value={m.montagegrube || ""} 
                          onChange={(e) => updateAufmass(i, 'montagegrube', e.target.value)} 
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {m.aktion === "Demontage" && (
                <>
                  <div className="aufmass-row-justify">
                    <span style={{ color: '#f43f5e' }}>Netzanschluss demontieren (Stk):</span>
                    <input type="number" className="mast-input-base" style={{ width: '45px', padding: '2px', height: '22px', borderRadius: '4px' }} placeholder="0" value={m.netzanschlussDemoAnzahl || ""} onChange={(e) => updateAufmass(i, 'netzanschlussDemoAnzahl', e.target.value)} />
                  </div>
                  {Number(m.netzanschlussDemoAnzahl) > 0 && (
                    <div className="aufmass-demo-block">
                      <span>↳ Muffen montieren (Neu-Stk):</span>
                      <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenMontierenDemo || ""} onChange={(e) => updateAufmass(i, 'muffenMontierenDemo', e.target.value)} />
                      <span>↳ Muffen demontieren (Alt-Stk):</span>
                      <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenDemo || ""} onChange={(e) => updateAufmass(i, 'muffenDemo', e.target.value)} />
                    </div>
                  )}
                </>
              )}

              {m.aktion === "Tausch" && (
                <>
                  <div className="aufmass-row-justify">
                    <span style={{ color: '#a855f7' }}>Kabel an-/abklemmen (Stk):</span>
                    <input type="number" className="mast-input-base" style={{ width: '45px', padding: '2px', height: '22px', borderRadius: '4px' }} placeholder="0" value={m.kabelAnAbklemmenAnzahl || ""} onChange={(e) => updateAufmass(i, 'kabelAnAbklemmenAnzahl', e.target.value)} />
                  </div>
                  {Number(m.kabelAnAbklemmenAnzahl) > 0 && (
                    <div className="aufmass-tausch-block">
                      <span>↳ Muffen montieren (Neu-Stk):</span>
                      <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenMontierenTausch || ""} onChange={(e) => updateAufmass(i, 'muffenMontierenTausch', e.target.value)} />
                      <span>↳ Muffen demontieren (Alt-Stk):</span>
                      <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenDemoTausch || ""} onChange={(e) => updateAufmass(i, 'muffenDemoTausch', e.target.value)} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ZEILE 3: COMPACT FOOTER */}
          <div className="aufmass-card-footer">
            <div className="aufmass-handarbeit-badge">
              <div className="aufmass-flex-center" style={{ gap: '4px' }}>
                <span>🖐️ Handarbeit:</span>
                <input type="text" inputMode="decimal" className="mast-input-base" placeholder="0" value={m.handarbeitStd || ""} onChange={(e) => updateAufmass(i, 'handarbeitStd', e.target.value)} style={{ width: '45px', padding: '1px 3px', height: '22px', borderRadius: '4px' }} />
                <span className="aufmass-text-muted" style={{ fontSize: '11px' }}>Std</span>
              </div>
              
              <label className="aufmass-btn-upload">
                📸 Bilder {m.handarbeitBilder?.length > 0 && `(${m.handarbeitBilder.length})`}
                <input type="file" multiple accept="image/*" style={{ display: 'none' }} 
                  onChange={(e) => {
                    const files = Array.from(e.target.files).map(f => f.name);
                    updateAufmass(i, 'handarbeitBilder', [...(m.handarbeitBilder || []), ...files]);
                  }} 
                />
              </label>
            </div>

            <div className="aufmass-flex-center" style={{ flex: 1 }}>
              <span style={{ color: '#cbd5e1', whiteSpace: 'nowrap' }}>Notiz:</span>
              <input 
                type="text"
                className="mast-input-base" 
                style={{ padding: '2px 6px', height: '24px', borderRadius: '4px', width: '100%' }}
                placeholder="Besonderheiten eintragen..."
                value={m.aufmassNotiz || ""} 
                onChange={(e) => updateAufmass(i, 'aufmassNotiz', e.target.value)}
              />
            </div>
          </div>

        </div>
      ))
    ) : (
      <div style={{ textAlign: 'center', padding: '20px', background: '#334155', borderRadius: '6px' }}>
        <p style={{ color: '#cbd5e1' }}>Warte auf Masten...</p>
      </div>
    )}
  </div>
)}

{activeTab === 'Abrechnung' && (
  <div style={{ color: '#e2e8f0', padding: '15px', fontSize: '14px' }}>
    <h2 style={{ marginBottom: '15px', color: '#38bdf8' }}>Abrechnungs-Details</h2>

    {/* 1. MASTEN ÜBERSICHT (Bereinigt: Keine Kabel-Anzeige mehr hier) */}
    <div style={{ marginBottom: '20px', background: '#1e293b', padding: '12px', borderRadius: '6px' }}>
      <h3 style={{ fontSize: '15px', marginBottom: '10px', color: '#38bdf8', borderBottom: '1px solid #334155', paddingBottom: '5px' }}>
        Masten Übersicht (Detailliert)
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {(() => {
          const summary = {};
          form.aufmass?.masten?.forEach(m => {
            // Hilfsfunktion: Gruppierung nur noch nach LPH, Typ und Fundament
            const addToSummary = (action, foundation, mastType, lphValue) => {
              const type = mastType || "Gerade";
              const key = `${lphValue}m ${type} | ${foundation} (${action})`;
              if (!summary[key]) summary[key] = { count: 0 };
              summary[key].count += 1;
            };

            // --- LOGIK ---
            if (m.aktion === 'Montage') {
              addToSummary("Montage", m.montageTyp || "Fundament", m.mastTypNeu, m.lichtpunkthoehe);
            } 
            else if (m.aktion === 'Demontage') {
              addToSummary("Demontage", m.demontageTyp || "Fundament", m.mastTypAlt, m.lichtpunkthoehe);
            } 
            else if (m.aktion === 'Tausch') {
              addToSummary("Demontage", m.tauschDemoTyp || "Fundament", m.mastTypAlt, m.lphAlt);
              addToSummary("Montage", m.tauschMontageTyp || "Fundament", m.mastTypNeu, m.lphNeu);
            }
          });

          return Object.entries(summary).map(([key, val]) => (
            <div key={key} style={{ fontSize: '13px', borderBottom: '1px solid #334155', padding: '4px 0', lineHeight: '1.4' }}>
              <strong>{key}</strong> 
              <br />
              <span style={{ color: '#cbd5e1' }}>→ Anzahl: {val.count}</span>
            </div>
          ));
        })()}
      </div>
    </div>

    {/* 2. ABRECHNUNGSPOSITIONEN (Hier sind jetzt die Kabel als eigene Pos) */}
    {(() => {
      const num = (val) => Number(String(val || '').replace(',', '.')) || 0;

      // Struktur für die Daten
      const buildData = () => ({
        surfaces: {},
        linear: {},
        kabel: { title: "Kabel An-/Abklemmen (Stk)", total: 0, items: [] },
        muffen: { title: "Muffen montieren (Stk)", total: 0, items: [] },
        muffenDemo: { title: "Muffen demontieren (Stk)", total: 0, items: [] },
        netz1: { title: "Netzanschluss bis 1m", total: 0, items: [] },
        netz2: { title: "Netzanschluss über 1m", total: 0, items: [] },
        netzDemo: { title: "Netzanschluss demontieren (Stk)", total: 0, items: [] },
        graben: { title: "Graben (m)", total: 0, items: [] },
        kabelverlegen: { title: "Kabelverlegen (m)", total: 0, items: [] },
        montagegrube: { title: "Montagegrube (Stk)", total: 0, items: [] },
        handarbeitStd: { title: "Handarbeit (Std)", total: 0, items: [] } // Neu
      });

      const dataHsw = buildData();
      const dataMueller = buildData();

      if (form.aufmass?.masten) {
        form.aufmass.masten.forEach((m, i) => {
          const mastId = i + 1;

          // --- 1. HSW POSITIONEN ---
          
          // Masten Oberfläche
          const flaecheMast = num(m.oberflaecheX) * num(m.oberflaecheY);
          if (flaecheMast > 0) {
            const name = m.oberflaeche || "Sonstige";
            if (!dataHsw.surfaces[name]) dataHsw.surfaces[name] = { title: `${name} (m²)`, total: 0, items: [] };
            dataHsw.surfaces[name].total += flaecheMast;
            dataHsw.surfaces[name].items.push({ id: mastId, val: flaecheMast });
          }

          // Rasenkante, Bordstein, Rinnenfluss
          const sondersachen = [
            { key: 'sondersacheRasenkante', title: 'Rasenkantenstein (Stk)' },
            { key: 'sondersacheBordstein', title: 'Bordstein (Stk)' },
            { key: 'sondersacheRinnenfluss', title: 'Rinnenflussbahn (m²)' }
          ];
          sondersachen.forEach(s => {
            const val = num(m[s.key]);
            if (val > 0) {
              if (!dataHsw.linear[s.key]) dataHsw.linear[s.key] = { title: s.title, total: 0, items: [] };
              dataHsw.linear[s.key].total += val;
              dataHsw.linear[s.key].items.push({ id: mastId, val: val });
            }
          });

          // Handarbeit (Std)
          if (num(m.handarbeitStd) > 0) {
            dataHsw.handarbeitStd.total += num(m.handarbeitStd);
            dataHsw.handarbeitStd.items.push({ id: mastId, val: num(m.handarbeitStd) });
          }

          // --- 2. MÜLLER POSITIONEN ---

          // Graben-Flächen (Platten / Asphalt)
          const laengeGraben = num(m.grabenTiefeBreite);
          const nameGraben = m.oberflaecheGraben || "Platten";
          const catGrabenName = `Graben ${nameGraben}`;
          const erlaubteOberflaechen = ["Platten", "Asphalt"];

          // Prüfung: Graben vorhanden UND Oberfläche ist erlaubt
          if (laengeGraben > 0 && erlaubteOberflaechen.includes(nameGraben)) {
            
            const catGrabenName = `Graben ${nameGraben}`;
            const flaecheGraben = laengeGraben * 0.3;

            if (!dataMueller.surfaces[catGrabenName]) {
              dataMueller.surfaces[catGrabenName] = { 
                title: `${catGrabenName} (m²)`, 
                total: 0, 
                items: [] 
              };
            }
            dataMueller.surfaces[catGrabenName].total += flaecheGraben;
            dataMueller.surfaces[catGrabenName].items.push({ id: mastId, val: flaecheGraben });
          }

          // Montagegrube Fläche
          const countGruben = num(m.montagegrube);
            if (countGruben > 0) {
                // Falls du die Gruben unbedingt unter 'surfaces' als Stück zählen willst:
                // (Ich empfehle aber, es wie unten bei 'Bau-Positionen' zu machen)
                if (!dataMueller.surfaces["Montagegruben (Stk)"]) {
                    dataMueller.surfaces["Montagegruben (Stk)"] = { title: "Montagegruben (Stk)", total: 0, items: [] };
                }
                dataMueller.surfaces["Montagegruben (Stk)"].total += countGruben;
                dataMueller.surfaces["Montagegruben (Stk)"].items.push({ id: mastId, val: countGruben });
            }

          // Bau-Positionen Müller
          if (laengeGraben > 0) { dataMueller.graben.total += laengeGraben; dataMueller.graben.items.push({ id: mastId, val: laengeGraben }); }
          if (countGruben > 0) { dataMueller.montagegrube.total += countGruben; dataMueller.montagegrube.items.push({ id: mastId, val: countGruben }); }
          if (num(m.grabenKabelverlegen) > 0) { dataMueller.kabelverlegen.total += num(m.grabenKabelverlegen); dataMueller.kabelverlegen.items.push({ id: mastId, val: num(m.grabenKabelverlegen) }); }
          if (num(m.netzanschlussBis1m) > 0) { dataMueller.netz1.total += num(m.netzanschlussBis1m); dataMueller.netz1.items.push({ id: mastId, val: num(m.netzanschlussBis1m) }); }
          if (num(m.kabelAnAbklemmenAnzahl) > 0) { dataMueller.kabel.total += num(m.kabelAnAbklemmenAnzahl); dataMueller.kabel.items.push({ id: mastId, val: num(m.kabelAnAbklemmenAnzahl) }); }
          if (num(m.netzanschlussDemoAnzahl) > 0) { dataMueller.netzDemo.total += num(m.netzanschlussDemoAnzahl); dataMueller.netzDemo.items.push({ id: mastId, val: num(m.netzanschlussDemoAnzahl) }); }
          const muffenSum = num(m.muffenMontierenUeber1m) + num(m.muffenMontierenTausch) + num(m.muffenDemoTausch) + num(m.muffenMontierenDemo) + num(m.muffenDemoDemo);
          if (muffenSum > 0) { dataMueller.muffen.total += muffenSum; dataMueller.muffen.items.push({ id: mastId, val: muffenSum }); }
          if (num(m.muffenDemo) > 0) { dataMueller.muffenDemo.total += num(m.muffenDemo); dataMueller.muffenDemo.items.push({ id: mastId, val: num(m.muffenDemo) }); }
        });
      }

      // Hilfsfunktion zum Rendern
      const renderCol = (title, dataObj) => {
        const list = [
          ...Object.values(dataObj.surfaces),
          ...Object.values(dataObj.linear),
          ...(dataObj.graben.total > 0 ? [dataObj.graben] : []),
          ...(dataObj.montagegrube.total > 0 ? [dataObj.montagegrube] : []),
          ...(dataObj.kabelverlegen.total > 0 ? [dataObj.kabelverlegen] : []),
          ...(dataObj.netz1.total > 0 ? [dataObj.netz1] : []),
          ...(dataObj.netz2.total > 0 ? [dataObj.netz2] : []),
          ...(dataObj.kabel.total > 0 ? [dataObj.kabel] : []),
          ...(dataObj.muffen.total > 0 ? [dataObj.muffen] : []),
          ...(dataObj.muffenDemo.total > 0 ? [dataObj.muffenDemo] : []),
          ...(dataObj.handarbeitStd.total > 0 ? [dataObj.handarbeitStd] : []),
          ...(dataObj.netzDemo.total > 0 ? [dataObj.netzDemo] : [])
        ];

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <h3 style={{ color: '#fff', borderBottom: '2px solid #38bdf8', paddingBottom: '5px' }}>{title}</h3>
            {list.map((cat, idx) => (
              <details key={`${title}-${idx}`} style={{ background: '#1e293b', padding: '10px', borderRadius: '6px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', color: '#f8fafc' }}>
                  <span>{cat.title}</span>
                  <span style={{ color: '#38bdf8' }}>{cat.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </summary>
                <div style={{ marginTop: '10px', paddingLeft: '10px', borderLeft: '2px solid #38bdf8' }}>
                  {cat.items?.map((item, i) => (
                    <div key={`${title}-${cat.title}-${item.id}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span style={{ color: '#94a3b8' }}>Mast {item.id}</span>
                      <span>{item.val.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        );
      };

      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', width: '100%', padding: '10px' }}>
          {renderCol("HSW", dataHsw)}
          {renderCol("Müller", dataMueller)}
        </div>
      );
    })()}
  </div>
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
    </div>
      <main className="map-view">
        <MapContainer 
  center={[51.15, 8.2]} 
  zoom={10} 
  ref={mapRef}
  style={{ height: "100%", width: "100%" }}
  >
  <TileLayer 
    url={isSatellite ? satUrl : osmUrl} 
    attribution={isSatellite ? 'Esri Satellite' : 'OpenStreetMap'}
  />

  {/* Der schicke Button oben rechts */}
  <div className="leaflet-top leaflet-right" style={{ marginTop: '10px', marginRight: '10px', pointerEvents: 'none' }}>
    
    {/* TEIL 1: DER UMSCHALTER */}
    <div style={{ pointerEvents: 'auto', marginBottom: '8px' }}>
      <button 
        onClick={() => setIsSatellite(!isSatellite)}
        className="group relative transition-all active:scale-95"
        style={{ 
          width: '60px', height: '60px', padding: 0, cursor: 'pointer',
          border: '2px solid white', borderRadius: '10px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.3)', backgroundColor: 'white',
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          alignItems: 'center', overflow: 'hidden', position: 'relative'
        }}
      >
        <img 
          src={isSatellite 
            ? "https://a.tile.openstreetmap.org/15/17350/11030.png" 
            : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/15/11030/17350"
          } 
          alt="Layer Toggle"
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div style={{
            width: '100%', background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 100%)',
            color: 'white', fontSize: '9px', fontWeight: 'bold', padding: '12px 0 4px 0',
            textAlign: 'center', textTransform: 'uppercase', zIndex: 2, position: 'relative'
        }}>
          {isSatellite ? 'Karte' : 'Satellit'}
        </div>
      </button>
    </div>
  </div>
  
  {/* Ab hier bleibt alles wie es war */}
  <FitBounds 
    projects={filteredProjects} 
    enabled={mode === "list"} 
    mode={mode} 
  />
  
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
          backgroundColor: toast.startsWith('✅') ? '#2ecc71' : '#3498db', // Blau für Info/Update
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
      {/* DER ROT-TOAST POPUP */}
      {alertToast.show && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          background: '#ef4444',
          color: 'white',
          padding: '12px 20px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)',
          fontWeight: '600',
          fontSize: '14px',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          animation: 'slideIn 0.3s ease-out'
        }}>
          <span>⚠️</span>
          <span>{alertToast.message}</span>
        </div>
      )}
      </main>
      </>
    )}
    </div>
  );
}