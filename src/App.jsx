import React, { useEffect, useState, useRef } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, ZoomControl } from "react-leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { useMap } from "react-leaflet"; 
import { pb } from './pocketbase'; // Punkt-Schrägstrich bedeutet: im selben Ordner
import imageCompression from 'browser-image-compression';
import * as XLSX from 'xlsx';

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

const DEFAULT_NACHKALKULATION = {
  stunden: "",
  gesamtHsw: "",
  gesamtMueller: ""
};

const DEFAULT_AUFMASS_ALLGEMEIN = {
  transport: "",
  extraInfos: "",
  einmessungWeggeschicktAm: "",
  materialbuchungErfolgtAm: "",
  proformaRechnungWeggeschicktAm: "",
  nachkalkulation: { ...DEFAULT_NACHKALKULATION }
};

const DEFAULT_AUFMASS = {
  allgemein: { ...DEFAULT_AUFMASS_ALLGEMEIN },
  masten: []
};

const MIN_HOURLY_RATE = 56;
const NORMAL_HOURLY_RATE = 59;
const VERY_GOOD_HOURLY_RATE = 68.9;

const parseNumberInput = (value) => {
  const num = Number(String(value || "").replace(',', '.').trim());
  return Number.isFinite(num) ? num : 0;
};

const formatEuro = (value) => `${(Number(value) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;

const SURFACE_OPTIONS = [
  { value: "Grass", label: "Gras / Acker" },
  { value: "Platten", label: "Platten / Pflaster" },
  { value: "Asphalt", label: "Asphalt / Bitum" }
];

const normalizeSurfaceType = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "Grass";
  if (["grass", "gras", "gras/acker", "gras / acker", "gruen", "grün", "gras/ acker", "gras acker"].includes(raw)) return "Grass";
  if (["platten", "pflaster", "platten/pflaster", "platten / pflaster"].includes(raw)) return "Platten";
  if (["asphalt", "bitum", "asphalt/bitum", "asphalt / bitum"].includes(raw)) return "Asphalt";
  return "Grass";
};

const getSurfaceLabel = (surface) => SURFACE_OPTIONS.find((opt) => opt.value === normalizeSurfaceType(surface))?.label || "Gras / Acker";

const createExtraSurface = () => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  typ: "Platten",
  x: "",
  y: ""
});

const normalizeExtraSurfaces = (surfaces) => {
  if (!Array.isArray(surfaces)) return [];
  return surfaces
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, idx) => ({
      id: entry.id || `surface-${idx}`,
      typ: normalizeSurfaceType(entry.typ),
      x: entry.x || "",
      y: entry.y || ""
    }));
};

const getMastAssignedSurfaces = (mast = {}) => {
  const base = normalizeSurfaceType(mast.oberflaeche || "Grass");
  const extra = normalizeExtraSurfaces(mast.oberflaechenExtra).map((entry) => normalizeSurfaceType(entry.typ));
  return Array.from(new Set([base, ...extra]));
};

const getMastSurfaceAreasByType = (mast = {}) => {
  const result = {};

  const addArea = (surfaceType, xVal, yVal) => {
    const type = normalizeSurfaceType(surfaceType);
    if (type === "Grass") return;
    const area = (parseFloat(String(xVal || "").replace(',', '.')) || 0) * (parseFloat(String(yVal || "").replace(',', '.')) || 0);
    if (area <= 0) return;
    result[type] = (result[type] || 0) + area;
  };

  addArea(mast.oberflaeche || "Grass", mast.oberflaecheX, mast.oberflaecheY);
  normalizeExtraSurfaces(mast.oberflaechenExtra).forEach((entry) => {
    addArea(entry.typ, entry.x, entry.y);
  });

  return result;
};

const formatDateToDDMMYYYY = (date) => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}.${month}.${year}`;
};

const normalizeDateValue = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  // Bereits im Ziel-Format dd.mm.yyyy.
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) return raw;

  // dd/mm/yyyy in dd.mm.yyyy umwandeln.
  const slashMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${day}.${month}.${year}`;
  }

  // yyyy-mm-dd oder yyyy-mm-ddThh:mm:ss.
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}.${month}.${year}`;
  }

  // dd.mm.yyyy beibehalten.
  const dotMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotMatch) {
    return raw;
  }

  // Freitext/Teileingabe unveraendert lassen.
  return raw;
};

const getTodayDateString = () => formatDateToDDMMYYYY(new Date());
const getCurrentYearStartDateString = () => formatDateToDDMMYYYY(new Date(new Date().getFullYear(), 0, 1));

const getProfitabilityColor = (hourlyRate, minRate = 35, maxRate = 95) => {
  const rate = Number(hourlyRate) || 0;
  const safeMin = Number(minRate) || 0;
  const safeMax = Number(maxRate) || 1;
  const goodStart = NORMAL_HOURLY_RATE;

  if (rate <= safeMin) return 'rgb(239, 68, 68)';

  // Unterhalb "gut": rot -> gelbgruen
  if (rate < goodStart) {
    const t = Math.max(0, Math.min(1, (rate - safeMin) / Math.max(0.0001, (goodStart - safeMin))));
    const red = Math.round(239 * (1 - t) + 163 * t);
    const green = Math.round(68 * (1 - t) + 230 * t);
    const blue = Math.round(68 * (1 - t) + 53 * t);
    return `rgb(${red}, ${green}, ${blue})`;
  }

  // Ab "gut" (ca. 59/60): klar gruen, Richtung sehr gut wird satter.
  const t = Math.max(0, Math.min(1, (rate - goodStart) / Math.max(0.0001, (safeMax - goodStart))));
  const red = Math.round(34 * (1 - t) + 21 * t);
  const green = Math.round(197 * (1 - t) + 128 * t);
  const blue = Math.round(94 * (1 - t) + 61 * t);
  return `rgb(${red}, ${green}, ${blue})`;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTypeFilter, setSettingsTypeFilter] = useState("Alle");
  const [settingsSortBy, setSettingsSortBy] = useState("date-desc");
  const [settingsDateFrom, setSettingsDateFrom] = useState(() => getCurrentYearStartDateString());
  const [settingsDateTo, setSettingsDateTo] = useState(() => getTodayDateString());
  const [proformaDateFrom, setProformaDateFrom] = useState(() => getCurrentYearStartDateString());
  const [proformaDateTo, setProformaDateTo] = useState(() => getTodayDateString());
  const [proformaExportPopupOpen, setProformaExportPopupOpen] = useState(false);
  const [proformaReminderDays, setProformaReminderDays] = useState(() => {
    const saved = Number(localStorage.getItem('proforma_reminder_days'));
    return Number.isFinite(saved) && saved > 0 ? saved : 14;
  });
  const [settingsChartView, setSettingsChartView] = useState("timeline");

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
    aufmass: {
      allgemein: { ...DEFAULT_AUFMASS_ALLGEMEIN },
      masten: []
    },
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
  setForm(prev => {
    const newMasten = [...(prev.masten || [])];
    if (!newMasten[index]) return prev;
    newMasten[index] = { ...newMasten[index], [field]: value };
    return { ...prev, masten: newMasten };
  });
};

const parseMastNumber = (label) => {
  const num = Number(String(label || "").replace(/\D/g, ""));
  return Number.isFinite(num) && num > 0 ? num : null;
};

const normalizeMastLabels = (masten = []) => {
  const usedNumbers = new Set();

  return masten.map((m, index) => {
    const existingNumber = parseMastNumber(m?.mastLabel);
    let finalNumber = existingNumber;

    // Bei fehlender/duplizierter Nummer fortlaufend neu vergeben.
    if (!finalNumber || usedNumbers.has(finalNumber)) {
      finalNumber = index + 1;
      while (usedNumbers.has(finalNumber)) finalNumber += 1;
    }

    usedNumbers.add(finalNumber);

    return {
      ...m,
      mastLabel: `Mast ${finalNumber}`
    };
  });
};

const findOriginalIndexByMast = (list = [], mast) => {
  if (!Array.isArray(list)) return -1;
  if (mast?.id) {
    const byId = list.findIndex(item => item?.id === mast.id);
    if (byId !== -1) return byId;
  }

  // Fallback fuer alte Datensaetze ohne id.
  return list.findIndex(item => item === mast);
};

const [aufmassRefreshKey, setAufmassRefreshKey] = React.useState(0);

const generiereAufmassDaten = (masten) => {
  if (!masten) return [];

  return normalizeMastLabels(masten).map((m) => {
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
      oberflaeche: normalizeSurfaceType(m.oberflaeche || "Grass"),
      oberflaecheX: m.oberflaecheX || "",
      oberflaecheY: m.oberflaecheY || "",
      oberflaechenExtra: normalizeExtraSurfaces(m.oberflaechenExtra),
      mastTypAlt: m.mastTypAlt || "",
      mastTypNeu: m.mastTypNeu || "",
      grabenTiefeBreite: m.grabenTiefeBreite || "",
      grabenKabelverlegen: m.grabenKabelverlegen || "",
      oberflaecheGraben: normalizeSurfaceType(m.oberflaecheGraben || "Platten"),
      montagegrube: m.montagegrube || "",
      montagegrubeDemo: m.montagegrubeDemo || "",
      montagegrubeTausch: m.montagegrubeTausch || "",
      muffenDemoMontage: m.muffenDemoMontage || "",
      grabenTiefeBreiteDemo: m.grabenTiefeBreiteDemo || "",
      grabenKabelverlegenDemo: m.grabenKabelverlegenDemo || "",
      oberflaecheGrabenDemo: normalizeSurfaceType(m.oberflaecheGrabenDemo || "Platten"),
      grabenTiefeBreiteTausch: m.grabenTiefeBreiteTausch || "",
      grabenKabelverlegenTausch: m.grabenKabelverlegenTausch || "",
      oberflaecheGrabenTausch: normalizeSurfaceType(m.oberflaecheGrabenTausch || "Platten")
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
  setForm(prev => {
    const newMasten = [...(prev.masten || [])];
    if (!newMasten[mastIndex]) return prev;
    if (!newMasten[mastIndex].leuchten) {
      newMasten[mastIndex].leuchten = [];
    }
    newMasten[mastIndex].leuchten = [...newMasten[mastIndex].leuchten, { typ: "", lumen: 0, grad: 0, anzahl: 1 }];
    return { ...prev, masten: newMasten };
  });
};

const updateLeuchte = (mastIndex, leuchtenIndex, field, value) => {
  setForm(prev => {
    const newMasten = [...(prev.masten || [])];
    if (!newMasten[mastIndex]?.leuchten?.[leuchtenIndex]) return prev;

    const newLeuchten = [...newMasten[mastIndex].leuchten];
    newLeuchten[leuchtenIndex] = { ...newLeuchten[leuchtenIndex], [field]: value };

    // Automatisches Lumen-Update (deine Logik)
    if (field === 'typ') {
      if (value === "Trilux Cuvia") newLeuchten[leuchtenIndex].lumen = 2600;
      if (value === "Trilux 9701") newLeuchten[leuchtenIndex].lumen = 4600;
      if (value === "Trilux 9821") newLeuchten[leuchtenIndex].lumen = 2600;
    }

    newMasten[mastIndex] = { ...newMasten[mastIndex], leuchten: newLeuchten };
    return { ...prev, masten: newMasten };
  });
};

const removeLeuchte = (mastIndex, leuchtenIndex) => {
  setForm(prev => {
    const newMasten = [...(prev.masten || [])];
    if (!newMasten[mastIndex]?.leuchten) return prev;
    const newLeuchten = [...newMasten[mastIndex].leuchten];
    newLeuchten.splice(leuchtenIndex, 1);
    newMasten[mastIndex] = { ...newMasten[mastIndex], leuchten: newLeuchten };
    return { ...prev, masten: newMasten };
  });
};

const batchAddMasten = (anzahl, standardLPH, standardTyp, leuchtenTyp) => {
  setForm(prev => {
    const neueMasten = [];
    for (let i = 0; i < anzahl; i++) {
      neueMasten.push({
        id: "",
        lph: standardLPH,
        typ: standardTyp,
        form: "gerade",
        leuchten: leuchtenTyp ? [{ typ: leuchtenTyp, lumen: 2600, anzahl: 1 }] : [],
        fotos: [],
        plaene: []
      });
    }
    return { ...prev, masten: [...(prev.masten || []), ...neueMasten] };
  });
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
        p.notes?.toLowerCase().includes(text) ||
        p.ab_hsw?.toLowerCase().includes(text) ||
        p.ab_mueller?.toLowerCase().includes(text) ||
        p.type?.toLowerCase().includes(text) ||
        p.pgk?.toLowerCase().includes(text)) &&
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
    const aktuellesAufmass = prev.aufmass || DEFAULT_AUFMASS;
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

const addExtraOberflaeche = (index) => {
  setForm(prev => {
    const aktuellesAufmass = prev.aufmass || DEFAULT_AUFMASS;
    const neueMasten = [...(aktuellesAufmass.masten || [])];
    if (!neueMasten[index]) return prev;

    const currentExtras = normalizeExtraSurfaces(neueMasten[index].oberflaechenExtra);
    neueMasten[index] = {
      ...neueMasten[index],
      oberflaechenExtra: [...currentExtras, createExtraSurface()]
    };

    return {
      ...prev,
      aufmass: {
        ...aktuellesAufmass,
        masten: neueMasten
      }
    };
  });
};

const updateExtraOberflaeche = (index, extraIndex, field, value) => {
  setForm(prev => {
    const aktuellesAufmass = prev.aufmass || DEFAULT_AUFMASS;
    const neueMasten = [...(aktuellesAufmass.masten || [])];
    if (!neueMasten[index]) return prev;

    const currentExtras = normalizeExtraSurfaces(neueMasten[index].oberflaechenExtra);
    if (!currentExtras[extraIndex]) return prev;

    currentExtras[extraIndex] = {
      ...currentExtras[extraIndex],
      [field]: field === 'typ' ? normalizeSurfaceType(value) : value
    };

    neueMasten[index] = {
      ...neueMasten[index],
      oberflaechenExtra: currentExtras
    };

    return {
      ...prev,
      aufmass: {
        ...aktuellesAufmass,
        masten: neueMasten
      }
    };
  });
};

const removeExtraOberflaeche = (index, extraIndex) => {
  setForm(prev => {
    const aktuellesAufmass = prev.aufmass || DEFAULT_AUFMASS;
    const neueMasten = [...(aktuellesAufmass.masten || [])];
    if (!neueMasten[index]) return prev;

    const currentExtras = normalizeExtraSurfaces(neueMasten[index].oberflaechenExtra);
    neueMasten[index] = {
      ...neueMasten[index],
      oberflaechenExtra: currentExtras.filter((_, idx) => idx !== extraIndex)
    };

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
    const aktuellesAufmass = prev.aufmass || DEFAULT_AUFMASS;
    return {
      ...prev,
      aufmass: {
        ...aktuellesAufmass,
        allgemein: {
          ...DEFAULT_AUFMASS_ALLGEMEIN,
          ...(aktuellesAufmass.allgemein || {}),
          [field]: value
        }
      }
    };
  });
};

const handleStatusChange = (newStatus) => {
  setForm(prev => {
    const aktuellesAufmass = prev.aufmass || DEFAULT_AUFMASS;
    const aktuellesAllgemein = {
      ...DEFAULT_AUFMASS_ALLGEMEIN,
      ...(aktuellesAufmass.allgemein || {})
    };

    const shouldAutoSetProformaDate =
      !isProformaStatus(prev.status) &&
      isProformaStatus(newStatus) &&
      !String(aktuellesAllgemein.proformaRechnungWeggeschicktAm || "").trim();

    return {
      ...prev,
      status: newStatus,
      aufmass: {
        ...aktuellesAufmass,
        allgemein: {
          ...aktuellesAllgemein,
          proformaRechnungWeggeschicktAm: shouldAutoSetProformaDate
            ? getTodayDateString()
            : aktuellesAllgemein.proformaRechnungWeggeschicktAm
        }
      }
    };
  });
};

const updateNachkalkulation = (field, value) => {
  setForm(prev => {
    const aktuellesAufmass = prev.aufmass || DEFAULT_AUFMASS;
    const aktuelleNachkalkulation = {
      ...DEFAULT_NACHKALKULATION,
      ...(aktuellesAufmass.allgemein?.nachkalkulation || {})
    };

    return {
      ...prev,
      aufmass: {
        ...aktuellesAufmass,
        allgemein: {
          ...DEFAULT_AUFMASS_ALLGEMEIN,
          ...(aktuellesAufmass.allgemein || {}),
          nachkalkulation: {
            ...aktuelleNachkalkulation,
            [field]: value
          }
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
    sondersacheRinnenfluss: "",
    oberflaeche: normalizeSurfaceType(m.oberflaeche || "Grass"),
    oberflaechenExtra: normalizeExtraSurfaces(m.oberflaechenExtra),
    oberflaecheGraben: "Platten",
    oberflaecheGrabenDemo: "Platten",
    oberflaecheGrabenTausch: "Platten",
    grabenTiefeBreite: "",
    grabenKabelverlegen: "",
    montagegrube: "",
    montagegrubeDemo: "",
    montagegrubeTausch: "",
    muffenDemoMontage: "",
    grabenTiefeBreiteDemo: "",
    grabenKabelverlegenDemo: "",
    grabenTiefeBreiteTausch: "",
    grabenKabelverlegenTausch: ""
  }));

  setForm(prev => ({
    ...prev,
    aufmass: {
      allgemein: {
        ...DEFAULT_AUFMASS_ALLGEMEIN,
        nachkalkulation: {
          ...DEFAULT_NACHKALKULATION,
          ...(prev.aufmass?.allgemein?.nachkalkulation || {})
        }
      },
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
  const parsedMasten = normalizeMastLabels(parseSafe(p.masten, []));
  const parsedLeuchten = parseSafe(p.leuchten, []);
  
  // Das Aufmaß-Objekt sicher parsen
  const rawAufmass = parseSafe(p.aufmass, null); 

  // Sicherheitsnetz für alte vs. neue Struktur:
  let aufmassMasten = [];
  let allgemeinTransport = "";
  let allgemeinExtraInfos = "";
  let allgemeinEinmessungWeggeschicktAm = "";
  let allgemeinMaterialbuchungErfolgtAm = "";
  let allgemeinProformaRechnungWeggeschicktAm = "";
  let allgemeinNachkalkulation = { ...DEFAULT_NACHKALKULATION };

  if (rawAufmass) {
    if (Array.isArray(rawAufmass)) {
      // Altes Format (war nur ein direktes Array)
      aufmassMasten = rawAufmass;
    } else if (typeof rawAufmass === 'object') {
      // Neues Format (Objekt mit allgemein & masten)
      aufmassMasten = rawAufmass.masten || [];
      allgemeinTransport = rawAufmass.allgemein?.transport || "";
      allgemeinExtraInfos = rawAufmass.allgemein?.extraInfos || "";
      allgemeinEinmessungWeggeschicktAm = rawAufmass.allgemein?.einmessungWeggeschicktAm || "";
      allgemeinMaterialbuchungErfolgtAm = rawAufmass.allgemein?.materialbuchungErfolgtAm || "";
      allgemeinProformaRechnungWeggeschicktAm = rawAufmass.allgemein?.proformaRechnungWeggeschicktAm || "";
      allgemeinNachkalkulation = {
        ...DEFAULT_NACHKALKULATION,
        ...(rawAufmass.allgemein?.nachkalkulation || {}),
        gesamtHsw: rawAufmass.allgemein?.nachkalkulation?.gesamtHsw || rawAufmass.allgemein?.nachkalkulation?.summeHsw || rawAufmass.allgemein?.summeHsw || "",
        gesamtMueller: rawAufmass.allgemein?.nachkalkulation?.gesamtMueller || rawAufmass.allgemein?.nachkalkulation?.summeMueller || rawAufmass.allgemein?.summeMueller || ""
      };
    }
  }

  const aufbereiteteAufmassMasten = normalizeMastLabels(aufmassMasten).map(m => ({
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
    oberflaeche: normalizeSurfaceType(m.oberflaeche || "Grass"),
    oberflaecheX: m.oberflaecheX || "",
    oberflaecheY: m.oberflaecheY || "",
    oberflaechenExtra: normalizeExtraSurfaces(m.oberflaechenExtra),
    grabenTiefeBreite: m.grabenTiefeBreite || "",
    grabenKabelverlegen: m.grabenKabelverlegen || "",
    oberflaecheGraben: normalizeSurfaceType(m.oberflaecheGraben || "Platten"),
    montagegrube: m.montagegrube || "",
    montagegrubeDemo: m.montagegrubeDemo || "",
    montagegrubeTausch: m.montagegrubeTausch || "",
    muffenDemoMontage: m.muffenDemoMontage || "",
    grabenTiefeBreiteDemo: m.grabenTiefeBreiteDemo || "",
    grabenKabelverlegenDemo: m.grabenKabelverlegenDemo || "",
    oberflaecheGrabenDemo: normalizeSurfaceType(m.oberflaecheGrabenDemo || "Platten"),
    grabenTiefeBreiteTausch: m.grabenTiefeBreiteTausch || "",
    grabenKabelverlegenTausch: m.grabenKabelverlegenTausch || "",
    oberflaecheGrabenTausch: normalizeSurfaceType(m.oberflaecheGrabenTausch || "Platten")
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
        extraInfos: allgemeinExtraInfos,
        einmessungWeggeschicktAm: allgemeinEinmessungWeggeschicktAm,
        materialbuchungErfolgtAm: allgemeinMaterialbuchungErfolgtAm,
        proformaRechnungWeggeschicktAm: allgemeinProformaRechnungWeggeschicktAm,
        nachkalkulation: allgemeinNachkalkulation
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
  if (!alertToast.show) return;
  const timer = setTimeout(() => {
    setAlertToast({ show: false, message: "" });
  }, 6000);
  return () => clearTimeout(timer);
}, [alertToast.show]);

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
          allgemein: {
            ...DEFAULT_AUFMASS_ALLGEMEIN,
            ...(prev.aufmass?.allgemein || {}),
            nachkalkulation: {
              ...DEFAULT_NACHKALKULATION,
              ...(prev.aufmass?.allgemein?.nachkalkulation || {})
            }
          },
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
  const normalizeAufmass = (data) => {
    if (Array.isArray(data)) {
      return { allgemein: { ...DEFAULT_AUFMASS_ALLGEMEIN }, masten: data };
    }

    if (!data || typeof data !== 'object') {
      return { allgemein: { ...DEFAULT_AUFMASS_ALLGEMEIN }, masten: [] };
    }

    return {
      allgemein: {
        transport: data.allgemein?.transport || "",
        extraInfos: data.allgemein?.extraInfos || "",
        einmessungWeggeschicktAm: data.allgemein?.einmessungWeggeschicktAm || "",
        materialbuchungErfolgtAm: data.allgemein?.materialbuchungErfolgtAm || "",
        proformaRechnungWeggeschicktAm: data.allgemein?.proformaRechnungWeggeschicktAm || "",
        nachkalkulation: {
          ...DEFAULT_NACHKALKULATION,
          ...(data.allgemein?.nachkalkulation || {}),
          gesamtHsw: data.allgemein?.nachkalkulation?.gesamtHsw || data.allgemein?.nachkalkulation?.summeHsw || data.allgemein?.summeHsw || "",
          gesamtMueller: data.allgemein?.nachkalkulation?.gesamtMueller || data.allgemein?.nachkalkulation?.summeMueller || data.allgemein?.summeMueller || ""
        }
      },
      masten: Array.isArray(data.masten) ? data.masten : []
    };
  };

  const dbAufmass = normalizeAufmass(originalProject.aufmass);
  const stateAufmass = normalizeAufmass(form.aufmass);
  const aufmassChanged = JSON.stringify(stateAufmass) !== JSON.stringify(dbAufmass);

  // Gesamtergebnis ermitteln
  const hasChanges = hasFieldChanges || mastenChanged || leuchtenChanged || aufmassChanged;
  const currentSnapshot = getFormSnapshot(form);

  if (hasChanges && currentSnapshot !== lastSavedSnapshotRef.current && !isSavingRef.current) {
    const timer = setTimeout(() => {
      saveAction();
    }, 3000); // Wartet 3 Sekunden nach dem letzten Tastendruck

    return () => clearTimeout(timer);
  }
}, [form, originalProject, mode]);

const [isSaving, setIsSaving] = useState(false);
const isSavingRef = useRef(false);
const lastSavedSnapshotRef = useRef("");

const getFormSnapshot = (currentForm = form) => JSON.stringify({
  ...currentForm,
  masten: currentForm.masten || [],
  leuchten: currentForm.leuchten || [],
  aufmass: currentForm.aufmass || { allgemein: { ...DEFAULT_AUFMASS_ALLGEMEIN }, masten: [] },
  log: currentForm.log || []
});

const normalizeAufmass = (data) => {
  if (Array.isArray(data)) {
    return { allgemein: { ...DEFAULT_AUFMASS_ALLGEMEIN }, masten: data };
  }

  if (!data || typeof data !== 'object') {
    return { allgemein: { ...DEFAULT_AUFMASS_ALLGEMEIN }, masten: [] };
  }

  return {
    allgemein: {
      transport: data.allgemein?.transport || "",
      extraInfos: data.allgemein?.extraInfos || "",
      einmessungWeggeschicktAm: data.allgemein?.einmessungWeggeschicktAm || "",
      materialbuchungErfolgtAm: data.allgemein?.materialbuchungErfolgtAm || "",
      proformaRechnungWeggeschicktAm: data.allgemein?.proformaRechnungWeggeschicktAm || "",
      nachkalkulation: {
        ...DEFAULT_NACHKALKULATION,
        ...(data.allgemein?.nachkalkulation || {}),
        gesamtHsw: data.allgemein?.nachkalkulation?.gesamtHsw || data.allgemein?.nachkalkulation?.summeHsw || data.allgemein?.summeHsw || "",
        gesamtMueller: data.allgemein?.nachkalkulation?.gesamtMueller || data.allgemein?.nachkalkulation?.summeMueller || data.allgemein?.summeMueller || ""
      }
    },
    masten: Array.isArray(data.masten) ? data.masten : []
  };
};

  // --- AUTOSAVE EFFEKT ---
const saveAction = async () => {
  // 1. Guard: Verhindere mehrfache Ausführung & Abbruchbedingungen
  if (isSavingRef.current || !selectedProject?.id || mode !== "detail") return;
  isSavingRef.current = true;
  setIsSaving(true);

  try {
    const currentUser = pb.authStore.model?.email || "Unbekannter User";
    const now = new Date().toLocaleString('de-DE');
    const newLogEntries = [];

    // Vergleich der Basis-Felder
    const fields = [
      { id: 'name', label: 'Name' }, { id: 'address', label: 'Adresse' },
      { id: 'westnetz', label: 'Westnetz' }, { id: 'type', label: 'Typ' },
      { id: 'status', label: 'Status' }, { id: 'pgk', label: 'PGK' },
      { id: 'notes', label: 'Notizen' }, { id: 'ab_hsw', label: 'AB HSW' },
      { id: 'ab_mueller', label: 'AB Müller' }
    ];

    fields.forEach(f => {
      if (String(originalProject[f.id] || "") !== String(form[f.id] || "")) {
        newLogEntries.push({
          date: now,
          user: currentUser,
          action: `${f.label} geändert`,
          changes: [{
            field: f.label,
            old: String(originalProject[f.id] || ""),
            new: String(form[f.id] || "")
          }]
        });
      }
    });

    // Helper für Deep-Comparison (verhindert Loop durch falsche Reihenfolge)
    const isDifferent = (a, b) => JSON.stringify(a || {}) !== JSON.stringify(b || {});

    const mastenChanged = isDifferent(form.masten, originalProject.masten);
    const leuchtenChanged = isDifferent(form.leuchten, originalProject.leuchten);
    const aufmassChanged = JSON.stringify(normalizeAufmass(form.aufmass)) !== JSON.stringify(normalizeAufmass(originalProject.aufmass));

    if (mastenChanged) newLogEntries.push({ date: now, user: currentUser, action: "Masten aktualisiert" });
    if (leuchtenChanged) newLogEntries.push({ date: now, user: currentUser, action: "Leuchten aktualisiert" });
    if (aufmassChanged) newLogEntries.push({ date: now, user: currentUser, action: "Aufmaß aktualisiert" });

    // Wenn wirklich gar nichts geändert wurde: Abbruch
    if (newLogEntries.length === 0) {
      setIsSaving(false);
      return;
    }

    // Payload strikt auf bekannte Collection-Felder begrenzen.
    // Wichtig: Kein leuchten-Feld senden (wurde in der Migration durch aufmass ersetzt).
    const payload = {
      name: form.name || "",
      address: form.address || "",
      westnetz: form.westnetz || "",
      type: form.type || "Konzept",
      status: form.status || "Offen",
      pgk: form.pgk || "",
      notes: form.notes || "",
      ab_hsw: form.ab_hsw || "",
      ab_mueller: form.ab_mueller || "",
      masten: Array.isArray(form.masten) ? form.masten : [],
      aufmass: normalizeAufmass(form.aufmass),
      log: [...(form.log || []), ...newLogEntries],
      position: selectedPosition || originalProject?.position || null
    };

    // API Call
    const updatedRecord = await pb.collection('projects').update(selectedProject.id, payload);

    // ✅ JETZT DER WICHTIGE TEIL:
    // Wir nehmen den updatedRecord DIREKT aus der DB für unser originalProject.
    // KEIN Mapping, KEINE Berechnungen, KEINE Defaults hier einfügen!
    setOriginalProject(updatedRecord);
    lastSavedSnapshotRef.current = getFormSnapshot({
      ...form,
      log: updatedRecord.log,
      masten: form.masten || [],
      leuchten: form.leuchten || [],
      aufmass: normalizeAufmass(form.aufmass)
    });

    // Form Update (Logbuch aktualisieren, UI-Zustand beibehalten)
    setForm(prev => ({
      ...prev,
      log: updatedRecord.log
    }));

    if (setProjects) {
      setProjects(prev => prev.map(p => p.id === updatedRecord.id ? updatedRecord : p));
    }

    setToast("✅ Gespeichert");
    setTimeout(() => setToast(null), 1500);

  } catch (err) {
    const details = err?.response?.data || err?.data || err;
    console.error("Speicherfehler:", err);
    console.error("Speicherfehler Details:", details);
    setToast("❌ Fehler beim Speichern");
  } finally {
    isSavingRef.current = false;
    setIsSaving(false);
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
    formData.append('aufmass', JSON.stringify(normalizeAufmass(form.aufmass)));

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

  const nachkalkulation = form.aufmass?.allgemein?.nachkalkulation || DEFAULT_NACHKALKULATION;
  const nachkalkStunden = parseNumberInput(nachkalkulation.stunden);
  const nachkalkGesamtHsw = parseNumberInput(nachkalkulation.gesamtHsw);
  const nachkalkGesamtMueller = parseNumberInput(nachkalkulation.gesamtMueller);
  const nachkalkGesamt = nachkalkGesamtHsw + nachkalkGesamtMueller;
  const stundenlohnKombiniert = nachkalkStunden > 0 ? nachkalkGesamt / nachkalkStunden : 0;
  const stundenlohnDiffMin = stundenlohnKombiniert - MIN_HOURLY_RATE;
  const stundenlohnDiffNormal = stundenlohnKombiniert - NORMAL_HOURLY_RATE;
  const stundenlohnDiffVeryGood = stundenlohnKombiniert - VERY_GOOD_HOURLY_RATE;
  const minTargetGesamt = nachkalkStunden * MIN_HOURLY_RATE;
  const maxTargetGesamt = nachkalkStunden * VERY_GOOD_HOURLY_RATE;
  const gesamtDiffToMin = nachkalkGesamt - minTargetGesamt;
  const gesamtDiffToMax = nachkalkGesamt - maxTargetGesamt;
  const stundenlohnStatus = nachkalkStunden <= 0
    ? "Keine Stunden erfasst"
    : stundenlohnKombiniert < MIN_HOURLY_RATE
      ? `Schlecht (unter Minimum ${MIN_HOURLY_RATE.toFixed(2)} EUR/h)`
      : stundenlohnKombiniert < NORMAL_HOURLY_RATE
        ? `Schlecht (bis Normal ${NORMAL_HOURLY_RATE.toFixed(2)} EUR/h)`
        : stundenlohnKombiniert < VERY_GOOD_HOURLY_RATE
          ? `Gut (ab ${NORMAL_HOURLY_RATE.toFixed(2)} EUR/h)`
          : `Sehr gut (ab ${VERY_GOOD_HOURLY_RATE.toFixed(2)} EUR/h)`;

  const detectCityFromAddress = (address = "") => {
    const text = String(address || "").toLowerCase();
    if (text.includes("meschede")) return "Meschede";
    if (text.includes("olsberg")) return "Olsberg";
    if (text.includes("bestwig")) return "Bestwig";
    return "Sonstige";
  };

  const countMastActions = (masten = []) => {
    let montageCount = 0;
    let demontageCount = 0;

    (Array.isArray(masten) ? masten : []).forEach((m) => {
      const action = String(m?.aktion || m?.typ || "").toLowerCase();
      if (action.includes("tausch")) {
        montageCount += 1;
        demontageCount += 1;
      } else if (action.includes("montage")) {
        montageCount += 1;
      } else if (action.includes("demontage")) {
        demontageCount += 1;
      }
    });

    return { montageCount, demontageCount };
  };

  const parseProjectAufmassStats = (project) => {
    let parsed = project?.aufmass;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch (e) {
        parsed = null;
      }
    }

    if (Array.isArray(parsed)) {
      const actionCounts = countMastActions(parsed);
      return { stunden: 0, gesamtHsw: 0, gesamtMueller: 0, gesamt: 0, hourlyRate: 0, ...actionCounts };
    }

    const nachkalk = parsed?.allgemein?.nachkalkulation || {};
    const stunden = parseNumberInput(nachkalk.stunden);
    const sumHsw = parseNumberInput(nachkalk.gesamtHsw || nachkalk.summeHsw || parsed?.allgemein?.summeHsw);
    const sumMueller = parseNumberInput(nachkalk.gesamtMueller || nachkalk.summeMueller || parsed?.allgemein?.summeMueller);
    const gesamt = sumHsw + sumMueller;
    const hourlyRate = stunden > 0 ? gesamt / stunden : 0;
    const actionCounts = countMastActions(parsed?.masten || []);
    return { stunden, gesamtHsw: sumHsw, gesamtMueller: sumMueller, gesamt, hourlyRate, ...actionCounts };
  };

  const analyticsRowsBase = projects.map((p) => {
    const stats = parseProjectAufmassStats(p);
    const createdAt = p.created ? new Date(p.created) : null;
    return {
      id: p.id,
      name: p.name || "Unbenannt",
      type: p.type || "Unbekannt",
      city: detectCityFromAddress(p.address),
      createdAt,
      createdDate: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString().slice(0, 10) : "",
      ...stats
    };
  }).filter((row) => row.stunden > 0);

  const normalizeDateFilterInputToISO = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";

    const dot = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (dot) return `${dot[3]}-${dot[2]}-${dot[1]}`;

    const slash = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (slash) return `${slash[3]}-${slash[2]}-${slash[1]}`;

    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return raw;

    return "";
  };

  const settingsDateFromISO = normalizeDateFilterInputToISO(settingsDateFrom);
  const settingsDateToISO = normalizeDateFilterInputToISO(settingsDateTo);

  const analyticsRows = analyticsRowsBase
    .filter((row) => settingsTypeFilter === "Alle" || row.type === settingsTypeFilter)
    .filter((row) => !settingsDateFromISO || (row.createdDate && row.createdDate >= settingsDateFromISO))
    .filter((row) => !settingsDateToISO || (row.createdDate && row.createdDate <= settingsDateToISO))
    .sort((a, b) => {
      if (settingsSortBy === "hourly-desc") return b.hourlyRate - a.hourlyRate;
      if (settingsSortBy === "hourly-asc") return a.hourlyRate - b.hourlyRate;
      if (settingsSortBy === "date-asc") {
        const aMs = a.createdAt ? a.createdAt.getTime() : 0;
        const bMs = b.createdAt ? b.createdAt.getTime() : 0;
        return aMs - bMs;
      }
      const aMs = a.createdAt ? a.createdAt.getTime() : 0;
      const bMs = b.createdAt ? b.createdAt.getTime() : 0;
      return bMs - aMs;
    });

  const overviewAverageRate = analyticsRows.length > 0
    ? analyticsRows.reduce((sum, item) => sum + item.hourlyRate, 0) / analyticsRows.length
    : 0;
  const overviewProfitabelCount = analyticsRows.filter((item) => item.hourlyRate >= NORMAL_HOURLY_RATE).length;
  const overviewVeryGoodCount = analyticsRows.filter((item) => item.hourlyRate >= VERY_GOOD_HOURLY_RATE).length;
  const totalMontageCount = analyticsRows.reduce((sum, item) => sum + (item.montageCount || 0), 0);
  const totalDemontageCount = analyticsRows.reduce((sum, item) => sum + (item.demontageCount || 0), 0);
  const overviewMaxRate = Math.max(1, ...analyticsRows.map((item) => item.hourlyRate));
  const defaultTypeOptions = ["Konzept", "Anfahrschaden", "Störung", "LK-Tausch", "Sonstiges"];
  const analyticsTypeOptions = [
    "Alle",
    ...Array.from(new Set([...defaultTypeOptions, ...projects.map((p) => p.type).filter(Boolean)]))
  ];

  const parseLogDateTime = (value) => {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

    const raw = String(value).trim();
    if (!raw) return null;

    const direct = new Date(raw);
    if (!Number.isNaN(direct.getTime())) return direct;

    const m = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/);
    if (!m) return null;

    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    const hour = Number(m[4] || 0);
    const minute = Number(m[5] || 0);
    const parsed = new Date(year, month - 1, day, hour, minute);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const parseProjectLog = (project) => {
    const rawLog = project?.log;
    if (Array.isArray(rawLog)) return rawLog;
    if (typeof rawLog === 'string') {
      try {
        const parsed = JSON.parse(rawLog);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }
    return [];
  };

  const PROFORMA_STATUS = "Proformarechnung weggeschickt";
  const isProformaStatus = (value) => {
    const text = String(value || "").toLowerCase();
    return text.includes("proforma");
  };

  const normalizeDateForFilter = (value) => {
    const normalized = normalizeDateValue(value);
    const parsed = parseLogDateTime(normalized);
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
  };

  const getProformaSetTimestamp = (project) => {
    const logEntries = parseProjectLog(project);
    let matched = null;

    logEntries.forEach((entry) => {
      const entryDate = parseLogDateTime(entry?.date);
      if (!entryDate) return;

      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      const hasExplicitStatusSet = changes.some((c) => {
        const fieldText = String(c?.field || "").toLowerCase();
        const newText = String(c?.new || "");
        return fieldText.includes("status") && isProformaStatus(newText);
      });

      if (hasExplicitStatusSet) {
        if (!matched || entryDate > matched) matched = entryDate;
      }
    });

    // Fallback fuer aeltere Logs ohne changes-Details.
    if (!matched && isProformaStatus(project?.status)) {
      logEntries.forEach((entry) => {
        const entryDate = parseLogDateTime(entry?.date);
        if (!entryDate) return;
        if (String(entry?.action || "").toLowerCase().includes("status geändert")) {
          if (!matched || entryDate > matched) matched = entryDate;
        }
      });
    }

    return matched;
  };

  const getProformaSentTimestampFromAufmass = (project) => {
    let parsedAufmass = project?.aufmass;
    if (typeof parsedAufmass === 'string') {
      try {
        parsedAufmass = JSON.parse(parsedAufmass);
      } catch (e) {
        parsedAufmass = null;
      }
    }

    const value = parsedAufmass?.allgemein?.proformaRechnungWeggeschicktAm;
    return parseLogDateTime(value);
  };

  const proformaFilterFrom = normalizeDateForFilter(proformaDateFrom);
  const proformaFilterTo = normalizeDateForFilter(proformaDateTo);

  const proformaExportRows = projects
    .map((p) => {
      const proformaSetAt = getProformaSentTimestampFromAufmass(p) || getProformaSetTimestamp(p);
      const proformaDate = proformaSetAt && !Number.isNaN(proformaSetAt.getTime())
        ? proformaSetAt.toISOString().slice(0, 10)
        : "";
      return {
        id: p.id,
        beschreibung: p.name || p.notes || "",
        abMueller: p.ab_mueller || "",
        typ: p.type || "",
        westnetznummer: p.westnetz || "",
        proformaSetAt,
        proformaDate,
        status: p.status || ""
      };
    })
    .filter((row) => isProformaStatus(row.status) && !!row.proformaDate)
    .filter((row) => !proformaFilterFrom || row.proformaDate >= proformaFilterFrom)
    .filter((row) => !proformaFilterTo || row.proformaDate <= proformaFilterTo)
    .sort((a, b) => (b.proformaSetAt?.getTime() || 0) - (a.proformaSetAt?.getTime() || 0));

  const exportProformaToExcel = () => {
    if (proformaExportRows.length === 0) {
      setToast("Keine Proforma-Projekte im gewählten Zeitraum gefunden");
      setTimeout(() => setToast(null), 2500);
      return;
    }

    const rows = proformaExportRows.map((item) => ({
      Beschreibung: item.beschreibung,
      "AB Müller": item.abMueller,
      Typ: item.typ,
      Westnetznummer: item.westnetznummer,
      "Status auf Proforma gesetzt am": item.proformaSetAt
        ? formatDateToDDMMYYYY(item.proformaSetAt)
        : ""
    }));

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = [
      { wch: 36 },
      { wch: 16 },
      { wch: 18 },
      { wch: 38 },
      { wch: 24 }
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, 'Proforma');

    const fromPart = normalizeDateValue(proformaDateFrom) || 'alle';
    const toPart = normalizeDateValue(proformaDateTo) || 'heute';
    XLSX.writeFile(workbook, `Proforma_Export_${fromPart}_bis_${toPart}.xlsx`);

    setToast(`✅ Proforma-Export erstellt (${rows.length} Projekte)`);
    setTimeout(() => setToast(null), 2200);
  };

  useEffect(() => {
    localStorage.setItem('proforma_reminder_days', String(proformaReminderDays));
  }, [proformaReminderDays]);

  const proformaReminderSignatureRef = React.useRef("");

  useEffect(() => {
    if (!Array.isArray(projects) || projects.length === 0) return;
    if (!(Number(proformaReminderDays) > 0)) return;

    const nowMs = Date.now();
    const msThreshold = Number(proformaReminderDays) * 24 * 60 * 60 * 1000;

    const overdueItems = projects
      .filter((p) => isProformaStatus(p?.status))
      .map((p) => ({
        id: p.id,
        name: p.name || "Unbenannt",
        sentAt: getProformaSentTimestampFromAufmass(p)
      }))
      .filter((item) => item.sentAt && (nowMs - item.sentAt.getTime()) >= msThreshold);

    if (overdueItems.length === 0) return;

    const signature = overdueItems.map((i) => `${i.id}:${i.sentAt?.getTime() || 0}`).sort().join('|');
    if (signature === proformaReminderSignatureRef.current) return;
    proformaReminderSignatureRef.current = signature;

    const firstName = overdueItems[0]?.name || "Projekt";
    const baseMsg = overdueItems.length === 1
      ? `⏰ Erinnerung: Proforma bei "${firstName}" seit ${proformaReminderDays} Tagen offen.`
      : `⏰ Erinnerung: ${overdueItems.length} Proforma-Rechnungen sind seit mindestens ${proformaReminderDays} Tagen offen.`;

    setAlertToast({ show: true, message: baseMsg });
  }, [projects, proformaReminderDays]);

  const exportAnalyticsToExcel = () => {
    if (analyticsRows.length === 0) {
      setToast("Keine Daten fuer Excel-Export vorhanden");
      setTimeout(() => setToast(null), 2200);
      return;
    }

    const workbook = XLSX.utils.book_new();

    const exportRows = analyticsRows.map((item) => ({
      Projekt: item.name,
      Typ: item.type,
      Stadt: item.city,
      Datum: item.createdAt ? item.createdAt.toLocaleDateString('de-DE') : '-',
      Stunden: Number(item.stunden.toFixed(2)),
      HSW_EUR: Number(item.gesamtHsw.toFixed(2)),
      Mueller_EUR: Number(item.gesamtMueller.toFixed(2)),
      Gesamt_EUR: Number(item.gesamt.toFixed(2)),
      Stundenlohn_EUR_h: Number(item.hourlyRate.toFixed(2)),
      Masten_Montage: item.montageCount || 0,
      Masten_Demontage: item.demontageCount || 0
    }));

    const dataSheet = XLSX.utils.json_to_sheet(exportRows);
    dataSheet['!cols'] = [
      { wch: 34 }, { wch: 16 }, { wch: 14 }, { wch: 12 },
      { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 14 }, { wch: 16 }, { wch: 18 }
    ];
    XLSX.utils.book_append_sheet(workbook, dataSheet, 'Baustellen');

    const summaryRows = [
      { Kennzahl: 'Filter Typ', Wert: settingsTypeFilter },
      { Kennzahl: 'Von Datum', Wert: settingsDateFrom || '-' },
      { Kennzahl: 'Bis Datum', Wert: settingsDateTo || '-' },
      { Kennzahl: 'Anzahl Datensaetze', Wert: analyticsRows.length },
      { Kennzahl: 'Durchschnitt Stundenlohn', Wert: Number(overviewAverageRate.toFixed(2)) },
      { Kennzahl: `Anzahl >= ${NORMAL_HOURLY_RATE.toFixed(1)} EUR/h (Gut+)`, Wert: overviewProfitabelCount },
      { Kennzahl: `Anzahl >= ${VERY_GOOD_HOURLY_RATE.toFixed(1)} EUR/h (Sehr gut)`, Wert: overviewVeryGoodCount },
      { Kennzahl: 'Montierte Masten (gesamt)', Wert: totalMontageCount },
      { Kennzahl: 'Demontierte Masten (gesamt)', Wert: totalDemontageCount }
    ];
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    summarySheet['!cols'] = [{ wch: 34 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Uebersicht');

    const dateTag = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `Nachkalkulation_${dateTag}.xlsx`);
  };

  const timelineData = Object.values(
    analyticsRows.reduce((acc, row) => {
      if (!row.createdDate) return acc;
      const monthKey = row.createdDate.slice(0, 7);
      if (!acc[monthKey]) acc[monthKey] = { key: monthKey, sumRate: 0, count: 0 };
      acc[monthKey].sumRate += row.hourlyRate;
      acc[monthKey].count += 1;
      return acc;
    }, {})
  )
    .map((item) => ({
      ...item,
      avgRate: item.count > 0 ? item.sumRate / item.count : 0
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const cityOrder = ["Meschede", "Olsberg", "Bestwig", "Sonstige"];
  const cityData = cityOrder.map((city) => {
    const rows = analyticsRows.filter((row) => row.city === city);
    const avgRate = rows.length > 0 ? rows.reduce((sum, row) => sum + row.hourlyRate, 0) / rows.length : 0;
    return { city, avgRate, count: rows.length };
  });

  const typeData = Object.values(
    analyticsRows.reduce((acc, row) => {
      if (!acc[row.type]) acc[row.type] = { type: row.type, sumRate: 0, count: 0 };
      acc[row.type].sumRate += row.hourlyRate;
      acc[row.type].count += 1;
      return acc;
    }, {})
  )
    .map((item) => ({
      ...item,
      avgRate: item.count > 0 ? item.sumRate / item.count : 0
    }))
    .sort((a, b) => b.avgRate - a.avgRate);

  const distributionData = [
    {
      label: `< ${MIN_HOURLY_RATE.toFixed(0)} EUR/h`,
      count: analyticsRows.filter((row) => row.hourlyRate < MIN_HOURLY_RATE).length,
      color: '#ef4444'
    },
    {
      label: `${MIN_HOURLY_RATE.toFixed(0)} - ${NORMAL_HOURLY_RATE.toFixed(1)} EUR/h`,
      count: analyticsRows.filter((row) => row.hourlyRate >= MIN_HOURLY_RATE && row.hourlyRate < NORMAL_HOURLY_RATE).length,
      color: '#fb7185'
    },
    {
      label: `${NORMAL_HOURLY_RATE.toFixed(1)} - ${VERY_GOOD_HOURLY_RATE.toFixed(1)} EUR/h`,
      count: analyticsRows.filter((row) => row.hourlyRate >= NORMAL_HOURLY_RATE && row.hourlyRate < VERY_GOOD_HOURLY_RATE).length,
      color: '#22c55e'
    },
    {
      label: `>= ${VERY_GOOD_HOURLY_RATE.toFixed(1)} EUR/h`,
      count: analyticsRows.filter((row) => row.hourlyRate >= VERY_GOOD_HOURLY_RATE).length,
      color: '#16a34a'
    }
  ];

  const monthlyVolumeData = Object.values(
    analyticsRows.reduce((acc, row) => {
      if (!row.createdDate) return acc;
      const monthKey = row.createdDate.slice(0, 7);
      if (!acc[monthKey]) acc[monthKey] = { key: monthKey, totalHours: 0, count: 0 };
      acc[monthKey].totalHours += row.stunden;
      acc[monthKey].count += 1;
      return acc;
    }, {})
  ).sort((a, b) => a.key.localeCompare(b.key));

  const timelineMax = Math.max(1, ...timelineData.map((item) => item.avgRate));
  const cityMax = Math.max(1, ...cityData.map((item) => item.avgRate));
  const typeMax = Math.max(1, ...typeData.map((item) => item.avgRate));
  const distributionMax = Math.max(1, ...distributionData.map((item) => item.count));
  const monthlyHoursMax = Math.max(1, ...monthlyVolumeData.map((item) => item.totalHours));

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
        <button onClick={() => setSettingsOpen(true)} style={{ backgroundColor: '#2c3e50' }}>
          Einstellungen
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
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: STATUS_COLORS[p.status] || "#999", flexShrink: 0, marginTop: 2 }} />
            <strong style={{ wordBreak: "break-word", wordWrap: "break-word", overflow: "hidden" }}>{p.name}</strong>
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
                  <div style={{ width: 14, height: 14, borderRadius: "50%", background: STATUS_COLORS[form.status] || "#999", flexShrink: 0 }} />
                  <select value={form.status} onChange={(e) => handleStatusChange(e.target.value)}>
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
    <span className="field-label" style={{color: '#cbd5e1'}}>Mast Nr. (z.B. 1, 2, 5-8)</span>
    <input type="text" id="batch-ids" defaultValue="1" placeholder="1, 2, 5-8" className="mast-input-base" style={{width: '120px'}} />
  </div>

  <div className="field-group">
    <span className="field-label" style={{color: '#cbd5e1'}}>Aktion</span>
    <select id="batch-aktion" className="mast-input-base" style={{width: '110px'}} value={batchAktion} onChange={(e) => setBatchAktion(e.target.value)}>
      <option value="Tausch">Tausch</option>
      <option value="Montage">Montage</option>
      <option value="Demontage">Demontage</option>
    </select>
  </div>

  {/* ALT-FELDER */}
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

  {/* NEU-FELDER */}
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
          const customInput = document.getElementById('batch-neu-custom');
          const lumenInput = document.getElementById('batch-lumen-neu');
          if (val === "CUSTOM") {
            customInput.style.display = 'block';
            lumenInput.value = ""; 
          } else {
            customInput.style.display = 'none';
            if(lm) lumenInput.value = lm;
          }
        }}>
          <option value="">Wählen...</option>
          {Object.keys(LEUCHTEN_DATA).map(t => <option key={t} value={t}>{t}</option>)}
          <option value="CUSTOM" style={{fontWeight: 'bold', color: '#3b82f6'}}>— Sonstiges (Freitext) —</option>
        </select>
        <input type="text" id="batch-neu-custom" placeholder="Eigene Leuchte..." className="mast-input-base" style={{width: '100%', marginTop: '5px', display: 'none'}} />
      </div>
      <div className="field-group">
        <span className="field-label" style={{color: '#3b82f6'}}>LPH Neu</span>
        <input id="batch-lph-neu" defaultValue="6" className="mast-input-base" style={{width: '50px'}} />
      </div>
      <div className="field-group">
        <span className="field-label" style={{color: '#3b82f6'}}>Lumen</span>
        <input type="number" id="batch-lumen-neu" defaultValue="2600" className="mast-input-base" style={{width: '70px'}} />
      </div>
    </div>
  )}

  <button 
    style={{ background: '#22c55e', color: 'white', border: 'none', borderRadius: '6px', height: '32px', padding: '0 15px', fontWeight: 'bold', cursor: 'pointer', alignSelf: 'flex-end', marginLeft: 'auto' }}
    onClick={() => {
      const rawInput = document.getElementById('batch-ids')?.value || "1";
      
      // Parser-Funktion für Nummern und Bereiche
      const parseMastInput = (str) => {
        const nums = [];
        str.split(',').forEach(part => {
          if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            for (let i = start; i <= end; i++) nums.push(i);
          } else if (part.trim()) {
            nums.push(Number(part.trim()));
          }
        });
        return nums;
      };

      const mastNumbers = parseMastInput(rawInput);
      
      let selectedLeuchte = "";
      if (batchAktion !== "Demontage") {
        const dropDownValue = document.getElementById('batch-neu').value;
        selectedLeuchte = dropDownValue === "CUSTOM" ? document.getElementById('batch-neu-custom').value.trim() : dropDownValue;
        if (!selectedLeuchte) {
          setAlertToast({ show: true, message: "Bitte Leuchte auswählen!" });
          return;
        }
      }

      // Erstelle das Array der neuen Objekte
      const neueMasten = mastNumbers.map(num => ({
        id: crypto.randomUUID(), // Eindeutige ID für React-Stabilität
        mastLabel: `Mast ${num}`, // Fester Name
        aktion: batchAktion,
        mastTypAlt: (batchAktion === "Tausch" || batchAktion === "Demontage") ? document.getElementById('batch-masttyp-alt').value : "",
        lphAlt: (batchAktion === "Tausch" || batchAktion === "Demontage") ? document.getElementById('batch-lph-alt').value : "",
        mastTypNeu: (batchAktion === "Tausch" || batchAktion === "Montage") ? document.getElementById('batch-masttyp-neu').value : "",
        lphNeu: (batchAktion === "Tausch" || batchAktion === "Montage") ? document.getElementById('batch-lph-neu').value : "",
        leuchten: batchAktion !== "Demontage" ? [{ typ: selectedLeuchte, lumen: document.getElementById('batch-lumen-neu').value }] : []
      }));
      
      setForm(prev => ({ ...prev, masten: [...(prev.masten || []), ...neueMasten] }));
    }}
  >
    + Hinzufügen
  </button>
</div> 

          {/* --- MASTEN LISTE --- */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {/* Wir sortieren hier das Array für die Anzeige */}
            {[...form.masten]
              .sort((a, b) => {
                const numA = parseInt((a.mastLabel || "").replace(/\D/g, '')) || 0;
                const numB = parseInt((b.mastLabel || "").replace(/\D/g, '')) || 0;
                return numA - numB;
              })
              .map((m, index) => {
                // WICHTIG: Wir suchen den echten Index im Original-Array, 
                // damit updateMast den richtigen Datensatz ändert!
                const originalIndex = findOriginalIndexByMast(form.masten, m);
                
                const displayNum = (m.mastLabel || "").replace(/\D/g, '');
                const currentTyp = m.leuchten && m.leuchten[0] ? m.leuchten[0].typ : "";
                const isCustomLeuchte = currentTyp && !LEUCHTEN_DATA[currentTyp] && currentTyp !== "";

                return (
                  <div key={m.id || `mast-${displayNum || index + 1}-${index}`} className="mast-card">
                    {/* HEADER */}
                    <div className="mast-header">
                      <div className="field-group">
                        <span className="field-label">MAST</span>
                        <div className="mast-num-badge">{displayNum || String(index + 1)}</div>
                      </div>

                      <div className="field-group">
                        <span className="field-label">Aktion</span>
                        <select 
                          className="mast-input-base" 
                          style={{ width: '110px' }} 
                          value={m.aktion} 
                          onChange={(e) => updateMast(originalIndex, 'aktion', e.target.value)}
                        >
                          <option value="Tausch">Tausch</option>
                          <option value="Montage">Montage</option>
                          <option value="Demontage">Demontage</option>
                        </select>
                      </div>

                      <div className="header-actions" style={{ display: 'flex', gap: '10px', marginLeft: 'auto' }}>
                        <button style={{ background: '#ef4444' }} onClick={() => {
                          const n = [...form.masten];
                          n.splice(originalIndex, 1);
                          setForm(prev => ({ ...prev, masten: n }));
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
                        <select className="mast-input-base" style={{width: '100%'}} value={m.mastTypAlt} onChange={(e) => updateMast(originalIndex, 'mastTypAlt', e.target.value)}>
                          <option value="Gerade">Gerade</option>
                          <option value="Gebogen">Gebogen</option>
                        </select>
                      </div>
                      <div className="field-group">
                        <span className="field-label">LPH Alt</span>
                        <input className="mast-input-base" style={{width: '70px'}} value={m.lphAlt} onChange={(e) => updateMast(originalIndex, 'lphAlt', e.target.value)} />
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
                  onChange={(e) => updateMast(originalIndex, 'mastTypNeu', e.target.value)}
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
                    updateMast(originalIndex, 'leuchten', nl);
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
                      updateMast(originalIndex, 'leuchten', nl);
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
                  onChange={(e) => updateMast(originalIndex, 'lphNeu', e.target.value)} 
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
                    updateMast(originalIndex, 'leuchten', nl);
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
    <div className="aufmass-allgemein-row" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 10px', overflowX: 'hidden', whiteSpace: 'normal' }}>
      <div className="aufmass-flex-center" style={{ gap: '8px' }}>
        <span className="aufmass-section-title">🚛 Transport:</span>
        <input 
          type="text" 
          inputMode="decimal"
          className="mast-input-base" 
          style={{ width: '46px', padding: '2px 6px', height: '24px', borderRadius: '4px' }}
          value={form.aufmass?.allgemein?.transport || ""} 
          onChange={(e) => updateAufmassAllgemein('transport', e.target.value)} 
        />
        <span className="aufmass-text-muted">Std</span>
      </div>

      <div className="aufmass-flex-center" style={{ gap: '8px', flex: 1, minWidth: '240px', maxWidth: '360px' }}>
        <span className="aufmass-section-title">📝 Infos:</span>
        <input 
          type="text"
          className="mast-input-base" 
          style={{ padding: '2px 6px', height: '24px', borderRadius: '4px', width: '100%' }}
          placeholder="Anmerkungen zur Baustelle..."
          value={form.aufmass?.allgemein?.extraInfos || ""} 
          onChange={(e) => updateAufmassAllgemein('extraInfos', e.target.value)} 
        />
      </div>

      <div className="aufmass-flex-center" style={{ gap: '6px' }}>
        <span className="aufmass-section-title">📏 Einmessung weggeschickt:</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="text"
            inputMode="numeric"
            maxLength={10}
            className="mast-input-base"
            placeholder="dd.mm.yyyy"
            style={{ padding: '2px 6px', height: '24px', borderRadius: '4px', width: '104px', fontSize: '12px' }}
            value={normalizeDateValue(form.aufmass?.allgemein?.einmessungWeggeschicktAm || "")}
            onChange={(e) => updateAufmassAllgemein('einmessungWeggeschicktAm', e.target.value)}
            onBlur={(e) => updateAufmassAllgemein('einmessungWeggeschicktAm', normalizeDateValue(e.target.value))}
          />
          <button
            type="button"
            onClick={() => updateAufmassAllgemein('einmessungWeggeschicktAm', getTodayDateString())}
            style={{ height: '24px', padding: '0 8px', borderRadius: '4px', border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: '11px', cursor: 'pointer' }}
          >
            Heute
          </button>
        </div>
      </div>

      <div className="aufmass-flex-center" style={{ gap: '6px' }}>
        <span className="aufmass-section-title">📦 Materialbuchung erfolgt:</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="text"
            inputMode="numeric"
            maxLength={10}
            className="mast-input-base"
            placeholder="dd.mm.yyyy"
            style={{ padding: '2px 6px', height: '24px', borderRadius: '4px', width: '104px', fontSize: '12px' }}
            value={normalizeDateValue(form.aufmass?.allgemein?.materialbuchungErfolgtAm || "")}
            onChange={(e) => updateAufmassAllgemein('materialbuchungErfolgtAm', e.target.value)}
            onBlur={(e) => updateAufmassAllgemein('materialbuchungErfolgtAm', normalizeDateValue(e.target.value))}
          />
          <button
            type="button"
            onClick={() => updateAufmassAllgemein('materialbuchungErfolgtAm', getTodayDateString())}
            style={{ height: '24px', padding: '0 8px', borderRadius: '4px', border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: '11px', cursor: 'pointer' }}
          >
            Heute
          </button>
        </div>
      </div>

      <div className="aufmass-flex-center" style={{ gap: '6px' }}>
        <span className="aufmass-section-title">🧾 Proforma Rechnung weggeschickt:</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="text"
            inputMode="numeric"
            maxLength={10}
            className="mast-input-base"
            placeholder="dd.mm.yyyy"
            style={{ padding: '2px 6px', height: '24px', borderRadius: '4px', width: '104px', fontSize: '12px' }}
            value={normalizeDateValue(form.aufmass?.allgemein?.proformaRechnungWeggeschicktAm || "")}
            onChange={(e) => updateAufmassAllgemein('proformaRechnungWeggeschicktAm', e.target.value)}
            onBlur={(e) => updateAufmassAllgemein('proformaRechnungWeggeschicktAm', normalizeDateValue(e.target.value))}
          />
          <button
            type="button"
            onClick={() => updateAufmassAllgemein('proformaRechnungWeggeschicktAm', getTodayDateString())}
            style={{ height: '24px', padding: '0 8px', borderRadius: '4px', border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: '11px', cursor: 'pointer' }}
          >
            Heute
          </button>
        </div>
      </div>

      <button 
        onClick={resetAufmassVonMasten}
        style={{
          marginBottom: '0',
          padding: '6px 10px',
          background: '#ef4444',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: 'bold',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
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
      [...form.aufmass.masten]
        .sort((a, b) => {
          const numA = parseInt((a.mastLabel || "").replace(/\D/g, '')) || 0;
          const numB = parseInt((b.mastLabel || "").replace(/\D/g, '')) || 0;
          return numA - numB;
        })
        .map((m, index) => {
          const originalIndex = findOriginalIndexByMast(form.aufmass.masten, m);

          return (
            <div key={m.id || `aufmass-mast-${index + 1}`} className="aufmass-mast-card">
              <div className="aufmass-card-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '4px' }}>
                
                <div className="aufmass-badge-container" style={{ flexShrink: 0 }}>
                  <span className="aufmass-badge-label">MAST</span>
                  <div className="aufmass-badge-num">{(m.mastLabel || "").replace(/\D/g, '') || String(index + 1)}</div>
                </div>

                <div style={{ width: '110px', minWidth: '110px', flexShrink: 0 }}>
                  <select 
                    className="mast-input-base" 
                    style={{ padding: '0 6px', height: '26px', width: '100%', borderRadius: '4px' }} 
                    value={m.aktion || "Montage"} 
                    onChange={(e) => updateAufmass(originalIndex, 'aktion', e.target.value)}
                  >
                    <option value="Montage">Montage</option>
                    <option value="Demontage">Demontage</option>
                    <option value="Tausch">Tausch</option>
                  </select>
                </div>

                {/* --- REGULÄR: MONTAGE / DEMONTAGE --- */}
                {m.aktion !== "Tausch" && (
                  <div className="aufmass-flex-center" style={{ gap: '6px' }}>
                    <input 
                      type="text" 
                      className="mast-input-base" 
                      style={{ width: '45px', height: '26px', borderRadius: '4px', textAlign: 'center' }} 
                      value={m.lichtpunkthoehe || ""} 
                      onChange={(e) => updateAufmass(originalIndex, 'lichtpunkthoehe', e.target.value)} 
                    />
                    
                    <select 
                        className="mast-input-base" 
                        style={{ height: '26px', width: '90px', borderRadius: '4px' }} 
                        value={m.aktion === "Demontage" ? (m.mastTypAlt || "Gerade") : (m.mastTypNeu || "Gerade")}
                        onChange={(e) => updateAufmass(originalIndex, m.aktion === "Demontage" ? 'mastTypAlt' : 'mastTypNeu', e.target.value)}
                    >
                        <option value="Gerade">Gerade</option>
                        <option value="Gebogen">Gebogen</option>
                    </select>

                    <select 
                        className="mast-input-base" 
                        style={{ height: '26px', width: '110px', borderRadius: '4px' }} 
                        value={m.aktion === "Demontage" ? (m.demontageTyp || "Fundament") : (m.montageTyp || "Fundament")} 
                        onChange={(e) => updateAufmass(originalIndex, m.aktion === "Demontage" ? 'demontageTyp' : 'montageTyp', e.target.value)}
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
                    
                    <div className="aufmass-flex-center" style={{ gap: '2px' }}>
                      <span style={{ fontSize: '10px', color: '#94a3b8' }}>Alt:</span>
                      <input type="text" className="mast-input-base" style={{ width: '35px', height: '26px', textAlign: 'center' }} value={m.lphAlt || ""} onChange={(e) => updateAufmass(originalIndex, 'lphAlt', e.target.value)} />
                      <select className="mast-input-base" style={{ height: '26px', width: '75px' }} value={m.mastTypAlt || "Gerade"} onChange={(e) => updateAufmass(originalIndex, 'mastTypAlt', e.target.value)}>
                        <option value="Gerade">Gerade</option>
                        <option value="Gebogen">Gebogen</option>
                      </select>
                    </div>
                    
                    <div className="aufmass-flex-center" style={{ gap: '2px' }}>
                      <span style={{ fontSize: '10px', color: '#94a3b8' }}>Neu:</span>
                      <input type="text" className="mast-input-base" style={{ width: '35px', height: '26px', textAlign: 'center' }} value={m.lphNeu || ""} onChange={(e) => updateAufmass(originalIndex, 'lphNeu', e.target.value)} />
                      <select className="mast-input-base" style={{ height: '26px', width: '75px' }} value={m.mastTypNeu || "Gerade"} onChange={(e) => updateAufmass(originalIndex, 'mastTypNeu', e.target.value)}>
                        <option value="Gerade">Gerade</option>
                        <option value="Gebogen">Gebogen</option>
                      </select>
                    </div>

                    <div className="aufmass-flex-center" style={{ gap: '4px', borderLeft: '1px solid #334155', paddingLeft: '8px' }}>
                      <select className="mast-input-base" style={{ height: '26px', width: '90px', borderRadius: '4px' }} value={m.tauschDemoTyp || "Fundament"} onChange={(e) => updateAufmass(originalIndex, 'tauschDemoTyp', e.target.value)}>
                        <option value="Fundament">Fund. (Alt)</option>
                        <option value="PVC-Rohr">PVC (Alt)</option>
                        <option value="Flanschplatte">Flansch (Alt)</option>
                      </select>
                      
                      <select className="mast-input-base" style={{ height: '26px', width: '90px', borderRadius: '4px' }} value={m.tauschMontageTyp || "Fundament"} onChange={(e) => updateAufmass(originalIndex, 'tauschMontageTyp', e.target.value)}>
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
                    <div className="aufmass-flex-center" style={{ alignItems: 'flex-start', gap: '6px' }}>
                      <span style={{ color: '#38bdf8', fontWeight: '500' }}>🪵 Oberfläche:</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div className="aufmass-flex-center" style={{ gap: '4px' }}>
                          <select className="mast-input-base" style={{ padding: '2px 4px', height: '24px', width: '130px', borderRadius: '4px' }} value={normalizeSurfaceType(m.oberflaeche || "Grass")} onChange={(e) => updateAufmass(originalIndex, 'oberflaeche', normalizeSurfaceType(e.target.value))}>
                            {SURFACE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>

                          {normalizeSurfaceType(m.oberflaeche || "Grass") !== "Grass" && (
                            <>
                              <input type="text" inputMode="decimal" placeholder="X" className="mast-input-base" style={{ padding: '1px 3px', width: '40px', height: '22px', textAlign: 'center', borderRadius: '4px' }} value={m.oberflaecheX || ""} onChange={(e) => updateAufmass(originalIndex, 'oberflaecheX', e.target.value)} />
                              <span className="aufmass-text-subtle">×</span>
                              <input type="text" inputMode="decimal" placeholder="Y" className="mast-input-base" style={{ padding: '1px 3px', width: '40px', height: '22px', textAlign: 'center', borderRadius: '4px' }} value={m.oberflaecheY || ""} onChange={(e) => updateAufmass(originalIndex, 'oberflaecheY', e.target.value)} />
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => addExtraOberflaeche(originalIndex)}
                            title="Weitere Oberfläche hinzufügen"
                            style={{ width: '22px', height: '22px', borderRadius: '4px', border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', cursor: 'pointer', fontWeight: 'bold', lineHeight: '1' }}
                          >
                            +
                          </button>
                        </div>

                        {normalizeExtraSurfaces(m.oberflaechenExtra).map((extra, extraIndex) => (
                          <div key={extra.id || `${originalIndex}-${extraIndex}`} className="aufmass-flex-center" style={{ gap: '4px' }}>
                            <select className="mast-input-base" style={{ padding: '2px 4px', height: '22px', width: '130px', borderRadius: '4px' }} value={normalizeSurfaceType(extra.typ || "Platten")} onChange={(e) => updateExtraOberflaeche(originalIndex, extraIndex, 'typ', e.target.value)}>
                              {SURFACE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                            {normalizeSurfaceType(extra.typ || "Platten") !== "Grass" && (
                              <>
                                <input type="text" inputMode="decimal" placeholder="X" className="mast-input-base" style={{ padding: '1px 3px', width: '40px', height: '22px', textAlign: 'center', borderRadius: '4px' }} value={extra.x || ""} onChange={(e) => updateExtraOberflaeche(originalIndex, extraIndex, 'x', e.target.value)} />
                                <span className="aufmass-text-subtle">×</span>
                                <input type="text" inputMode="decimal" placeholder="Y" className="mast-input-base" style={{ padding: '1px 3px', width: '40px', height: '22px', textAlign: 'center', borderRadius: '4px' }} value={extra.y || ""} onChange={(e) => updateExtraOberflaeche(originalIndex, extraIndex, 'y', e.target.value)} />
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => removeExtraOberflaeche(originalIndex, extraIndex)}
                              title="Oberfläche entfernen"
                              style={{ width: '22px', height: '22px', borderRadius: '4px', border: '1px solid #7f1d1d', background: '#7f1d1d', color: '#fff', cursor: 'pointer', lineHeight: '1' }}
                            >
                              -
                            </button>
                          </div>
                        ))}

                        <span style={{ color: '#22c55e', fontWeight: 'bold', fontSize: '11px' }}>
                          Gesamtfläche: {(() => {
                            const base = normalizeSurfaceType(m.oberflaeche || "Grass") !== "Grass"
                              ? (parseFloat(String(m.oberflaecheX || '').replace(',', '.')) || 0) * (parseFloat(String(m.oberflaecheY || '').replace(',', '.')) || 0)
                              : 0;
                            const extraTotal = normalizeExtraSurfaces(m.oberflaechenExtra).reduce((sum, entry) => {
                              if (normalizeSurfaceType(entry.typ) === "Grass") return sum;
                              return sum + ((parseFloat(String(entry.x || '').replace(',', '.')) || 0) * (parseFloat(String(entry.y || '').replace(',', '.')) || 0));
                            }, 0);
                            return (base + extraTotal).toFixed(2);
                          })()} m²
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="aufmass-kabel-zone">
                    <div className="aufmass-row-justify">
                      <div className="aufmass-flex-center" style={{ gap: '4px' }}>
                        <span>🔗 Kabel:</span>
                        <input type="text" inputMode="decimal" className="mast-input-base" style={{ padding: '2px 4px', height: '24px', width: '55px', borderRadius: '4px', textAlign: 'center' }} placeholder="0" value={m.aufmassKabel || ""} onChange={(e) => updateAufmass(originalIndex, 'aufmassKabel', e.target.value)} />
                        <span className="aufmass-text-subtle">m</span>
                      </div>

                      <details className="aufmass-sondersachen-dropdown">
                        <summary className="aufmass-sondersachen-summary">🛠️ Sondersachen</summary>
                        <div className="aufmass-sondersachen-content">
                          <div className="aufmass-row-justify">
                            <span style={{ fontSize: '11px', color: '#cbd5e1' }}>Rasenkanten:</span>
                            <div className="aufmass-flex-center" style={{ gap: '3px' }}>
                              <input type="text" inputMode="decimal" placeholder="0" className="mast-input-base" style={{ width: '40px', padding: '1px 3px', height: '20px', textAlign: 'center', borderRadius: '4px' }} value={m.sondersacheRasenkante || ""} onChange={(e) => updateAufmass(originalIndex, 'sondersacheRasenkante', e.target.value)} />
                              <span className="aufmass-text-subtle" style={{ fontSize: '10px' }}>Stk</span>
                            </div>
                          </div>
                          <div className="aufmass-row-justify">
                            <span style={{ fontSize: '11px', color: '#cbd5e1' }}>Bordsteine:</span>
                            <div className="aufmass-flex-center" style={{ gap: '3px' }}>
                              <input type="text" inputMode="decimal" placeholder="0" className="mast-input-base" style={{ width: '40px', padding: '1px 3px', height: '20px', textAlign: 'center', borderRadius: '4px' }} value={m.sondersacheBordstein || ""} onChange={(e) => updateAufmass(originalIndex, 'sondersacheBordstein', e.target.value)} />
                              <span className="aufmass-text-subtle" style={{ fontSize: '10px' }}>Stk</span>
                            </div>
                          </div>
                          <div className="aufmass-row-justify">
                            <span style={{ fontSize: '11px', color: '#cbd5e1' }}>Rinnenfluss:</span>
                            <div className="aufmass-flex-center" style={{ gap: '3px' }}>
                              <input type="text" inputMode="decimal" placeholder="0" className="mast-input-base" style={{ width: '40px', padding: '1px 3px', height: '20px', textAlign: 'center', borderRadius: '4px' }} value={m.sondersacheRinnenfluss || ""} onChange={(e) => updateAufmass(originalIndex, 'sondersacheRinnenfluss', e.target.value)} />
                              <span className="aufmass-text-subtle" style={{ fontSize: '10px' }}>m²</span>
                            </div>
                          </div>
                        </div>
                      </details>
                    </div>
                  </div>
                </div>

                <div className="aufmass-inner-block" style={{ padding: '6px 10px' }}>
                  {m.aktion === "Montage" && (
                    <div className="aufmass-grid-2col" style={{ gap: '15px' }}>
                      <div className="aufmass-anschluss-col">
                        <div className="aufmass-row-justify">
                          <span style={{ fontSize: '11px' }}>Anschluss bis 1m (Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '40px', padding: '2px', height: '22px', borderRadius: '4px' }} placeholder="0" value={m.netzanschlussBis1m || ""} onChange={(e) => updateAufmass(originalIndex, 'netzanschlussBis1m', e.target.value)} />
                        </div>
                        {Number(m.netzanschlussBis1m) > 0 && (
                          <div className="aufmass-sub-muffen-montage">
                            <span style={{ color: '#cbd5e1' }}>↳ Muffen mont.:</span>
                            <input type="number" className="mast-input-base" style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} placeholder="0" value={m.muffenMontierenBis1m || ""} onChange={(e) => updateAufmass(originalIndex, 'muffenMontierenBis1m', e.target.value)} />
                          </div>
                        )}
                      </div>

                      <div className="aufmass-anschluss-col-right">
                        <div className="aufmass-row-justify">
                          <span style={{ fontSize: '11px' }}>Anschluss über 1m (Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '40px', padding: '2px', height: '22px', borderRadius: '4px' }} placeholder="0" value={m.netzanschlussUeber1m || ""} onChange={(e) => updateAufmass(originalIndex, 'netzanschlussUeber1m', e.target.value)} />
                        </div>
                        {Number(m.netzanschlussUeber1m) > 0 && (
                          <div className="aufmass-sub-graben-details">
                            <span>↳ Muffen mont. (Stk):</span>
                            <input type="number" className="mast-input-base" style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenMontierenUeber1m || ""} onChange={(e) => updateAufmass(originalIndex, 'muffenMontierenUeber1m', e.target.value)} />
                            <span>↳ Graben ANS (m):</span>
                            <input type="text" inputMode="decimal" className="mast-input-base" style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.grabenTiefeBreite || ""} onChange={(e) => updateAufmass(originalIndex, 'grabenTiefeBreite', e.target.value)} />
                            <span>↳ Graben-Oberfläche ANS:</span>
                            <select className="mast-input-base" style={{ width: '96px', padding: '1px', height: '20px', borderRadius: '4px' }} value={normalizeSurfaceType(m.oberflaecheGraben || "Platten")} onChange={(e) => updateAufmass(originalIndex, 'oberflaecheGraben', normalizeSurfaceType(e.target.value))}>
                              {SURFACE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                            <span>↳ Kabelverlegen ANS (m):</span>
                            <input type="text" inputMode="decimal" className="mast-input-base" style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.grabenKabelverlegen || ""} onChange={(e) => updateAufmass(originalIndex, 'grabenKabelverlegen', e.target.value)} />
                            <span>↳ Montagegrube ANS (Stk):</span>
                            <input type="number" className="mast-input-base" style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.montagegrube || ""} onChange={(e) => updateAufmass(originalIndex, 'montagegrube', e.target.value)} />
                            <span>↳ Muffen demont. ANS (Stk):</span>
                            <input type="number" className="mast-input-base" style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenDemoMontage || ""} onChange={(e) => updateAufmass(originalIndex, 'muffenDemoMontage', e.target.value)} />
                          </div>
                        )}
                        <div style={{ marginTop: '4px', fontSize: '10px', color: '#94a3b8' }}>
                          Für ANS zählt externe Graben-Oberfläche plus zusätzlich die Lampen-Oberflächen.
                        </div>
                      </div>
                    </div>
                  )}

                  {m.aktion === "Demontage" && (
                    <>
                      <div className="aufmass-row-justify">
                        <span style={{ color: '#f43f5e' }}>Netzanschluss demontieren (Stk):</span>
                        <input type="number" className="mast-input-base" style={{ width: '45px', padding: '2px', height: '22px', borderRadius: '4px' }} placeholder="0" value={m.netzanschlussDemoAnzahl || ""} onChange={(e) => updateAufmass(originalIndex, 'netzanschlussDemoAnzahl', e.target.value)} />
                      </div>
                      {Number(m.netzanschlussDemoAnzahl) > 0 && (
                        <div className="aufmass-demo-block">
                          <span>↳ Muffen montieren (Neu-Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenMontierenDemo || ""} onChange={(e) => updateAufmass(originalIndex, 'muffenMontierenDemo', e.target.value)} />
                          <span>↳ Muffen demontieren (Alt-Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenDemo || ""} onChange={(e) => updateAufmass(originalIndex, 'muffenDemo', e.target.value)} />
                        </div>
                      )}

                      {Number(m.netzanschlussDemoAnzahl) > 0 && (
                      <details className="aufmass-demo-block" style={{ marginTop: '6px' }} open>
                        <summary style={{ cursor: 'pointer', fontSize: '11px', color: '#fda4af' }}>📦 Positionen ABR</summary>
                        <div className="aufmass-demo-block" style={{ marginTop: '4px' }}>
                          <span>↳ Graben ABR (m):</span>
                          <input type="text" inputMode="decimal" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.grabenTiefeBreiteDemo || ""} onChange={(e) => updateAufmass(originalIndex, 'grabenTiefeBreiteDemo', e.target.value)} />
                          <span>↳ Kabelverlegen ABR (m):</span>
                          <input type="text" inputMode="decimal" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.grabenKabelverlegenDemo || ""} onChange={(e) => updateAufmass(originalIndex, 'grabenKabelverlegenDemo', e.target.value)} />
                          <span>↳ Montagegrube ABR (Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.montagegrubeDemo || ""} onChange={(e) => updateAufmass(originalIndex, 'montagegrubeDemo', e.target.value)} />
                          <span>↳ Graben-Oberfläche:</span>
                          <select className="mast-input-base" style={{ width: '88px', padding: '1px', height: '20px', borderRadius: '4px' }} value={normalizeSurfaceType(m.oberflaecheGrabenDemo || "Platten")} onChange={(e) => updateAufmass(originalIndex, 'oberflaecheGrabenDemo', normalizeSurfaceType(e.target.value))}>
                            {SURFACE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                      </details>
                      )}
                    </>
                  )}

                  {m.aktion === "Tausch" && (
                    <>
                      <div className="aufmass-row-justify">
                        <span style={{ color: '#a855f7' }}>Kabel an-/abklemmen (Stk):</span>
                        <input type="number" className="mast-input-base" style={{ width: '45px', padding: '2px', height: '22px', borderRadius: '4px' }} placeholder="0" value={m.kabelAnAbklemmenAnzahl || ""} onChange={(e) => updateAufmass(originalIndex, 'kabelAnAbklemmenAnzahl', e.target.value)} />
                      </div>
                      {Number(m.kabelAnAbklemmenAnzahl) > 0 && (
                        <div className="aufmass-tausch-block">
                          <span>↳ Muffen montieren (Neu-Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenMontierenTausch || ""} onChange={(e) => updateAufmass(originalIndex, 'muffenMontierenTausch', e.target.value)} />
                          <span>↳ Muffen demontieren (Alt-Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenDemoTausch || ""} onChange={(e) => updateAufmass(originalIndex, 'muffenDemoTausch', e.target.value)} />
                        </div>
                      )}

                      {Number(m.kabelAnAbklemmenAnzahl) > 0 && (
                      <details className="aufmass-tausch-block" style={{ marginTop: '6px' }} open>
                        <summary style={{ cursor: 'pointer', fontSize: '11px', color: '#d8b4fe' }}>📦 Positionen ÄND</summary>
                        <div className="aufmass-tausch-block" style={{ marginTop: '4px' }}>
                          <span>↳ Graben ÄND (m):</span>
                          <input type="text" inputMode="decimal" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.grabenTiefeBreiteTausch || ""} onChange={(e) => updateAufmass(originalIndex, 'grabenTiefeBreiteTausch', e.target.value)} />
                          <span>↳ Kabelverlegen ÄND (m):</span>
                          <input type="text" inputMode="decimal" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.grabenKabelverlegenTausch || ""} onChange={(e) => updateAufmass(originalIndex, 'grabenKabelverlegenTausch', e.target.value)} />
                          <span>↳ Montagegrube ÄND (Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.montagegrubeTausch || ""} onChange={(e) => updateAufmass(originalIndex, 'montagegrubeTausch', e.target.value)} />
                          <span>↳ Graben-Oberfläche:</span>
                          <select className="mast-input-base" style={{ width: '88px', padding: '1px', height: '20px', borderRadius: '4px' }} value={normalizeSurfaceType(m.oberflaecheGrabenTausch || "Platten")} onChange={(e) => updateAufmass(originalIndex, 'oberflaecheGrabenTausch', normalizeSurfaceType(e.target.value))}>
                            {SURFACE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                      </details>
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
                    <input type="text" inputMode="decimal" className="mast-input-base" placeholder="0" value={m.handarbeitStd || ""} onChange={(e) => updateAufmass(originalIndex, 'handarbeitStd', e.target.value)} style={{ width: '45px', padding: '1px 3px', height: '22px', borderRadius: '4px' }} />
                    <span className="aufmass-text-muted" style={{ fontSize: '11px' }}>Std</span>
                  </div>
                  
                  <label className="aufmass-btn-upload">
                    📸 Bilder {m.handarbeitBilder?.length > 0 && `(${m.handarbeitBilder.length})`}
                    <input type="file" multiple accept="image/*" style={{ display: 'none' }} 
                      onChange={(e) => {
                        const files = Array.from(e.target.files).map(f => f.name);
                        updateAufmass(originalIndex, 'handarbeitBilder', [...(m.handarbeitBilder || []), ...files]);
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
                    onChange={(e) => updateAufmass(originalIndex, 'aufmassNotiz', e.target.value)}
                  />
                </div>
              </div>

            </div>
          )
        })
    ) : (
      <div style={{ textAlign: 'center', padding: '20px', background: '#334155', borderRadius: '6px' }}>
        <p style={{ color: '#cbd5e1' }}>Warte auf Masten...</p>
      </div>
    )}

    <div style={{ marginTop: '14px', background: '#0f172a', borderRadius: '8px', padding: '12px', border: '1px solid #334155' }}>
      <h4 style={{ margin: 0, color: '#67e8f9' }}>Nachkalkulation</h4>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px', marginTop: '10px' }}>
        <div>
          <span style={{ color: '#cbd5e1', fontSize: '11px', display: 'block', marginBottom: '4px' }}>Stunden</span>
          <input
            type="text"
            inputMode="decimal"
            className="mast-input-base"
            value={nachkalkulation.stunden || ''}
            onChange={(e) => updateNachkalkulation('stunden', e.target.value)}
            placeholder="z. B. 42"
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <span style={{ color: '#cbd5e1', fontSize: '11px', display: 'block', marginBottom: '4px' }}>Gesamtsumme HSW</span>
          <input
            type="text"
            inputMode="decimal"
            className="mast-input-base"
            value={nachkalkulation.gesamtHsw || ''}
            onChange={(e) => updateNachkalkulation('gesamtHsw', e.target.value)}
            placeholder="z. B. 4200"
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <span style={{ color: '#cbd5e1', fontSize: '11px', display: 'block', marginBottom: '4px' }}>Gesamtsumme Müller</span>
          <input
            type="text"
            inputMode="decimal"
            className="mast-input-base"
            value={nachkalkulation.gesamtMueller || ''}
            onChange={(e) => updateNachkalkulation('gesamtMueller', e.target.value)}
            placeholder="z. B. 3100"
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
        <div style={{ background: '#111827', border: '1px solid #334155', borderRadius: '6px', padding: '8px' }}>
          <div style={{ color: '#94a3b8', fontSize: '11px' }}>Kombinierte Gesamtsumme</div>
          <strong style={{ color: '#e2e8f0', fontSize: '14px' }}>{formatEuro(nachkalkGesamt)}</strong>
        </div>
        <div style={{ background: '#111827', border: '1px solid #334155', borderRadius: '6px', padding: '8px' }}>
          <div style={{ color: '#94a3b8', fontSize: '11px' }}>Dein Stundenlohn (gesamt / Stunden)</div>
          <strong style={{ color: getProfitabilityColor(stundenlohnKombiniert, MIN_HOURLY_RATE, VERY_GOOD_HOURLY_RATE + 10), fontSize: '14px' }}>{stundenlohnKombiniert.toFixed(2)} EUR/h</strong>
        </div>
        <div style={{ background: '#111827', border: '1px solid #334155', borderRadius: '6px', padding: '8px' }}>
          <div style={{ color: '#94a3b8', fontSize: '11px' }}>Bewertung</div>
          <strong style={{ color: getProfitabilityColor(stundenlohnKombiniert, MIN_HOURLY_RATE, VERY_GOOD_HOURLY_RATE + 10), fontSize: '14px' }}>{stundenlohnStatus}</strong>
        </div>
      </div>

      <div style={{ marginTop: '6px', display: 'flex', gap: '16px', flexWrap: 'wrap', color: '#cbd5e1', fontSize: '11px' }}>
        <span>Differenz zu 56,00 EUR/h: <strong style={{ color: stundenlohnDiffMin >= 0 ? '#4ade80' : '#f87171' }}>{stundenlohnDiffMin >= 0 ? '+' : ''}{stundenlohnDiffMin.toFixed(2)} EUR/h</strong></span>
        <span>Differenz zu 59,00 EUR/h: <strong style={{ color: stundenlohnDiffNormal >= 0 ? '#4ade80' : '#f87171' }}>{stundenlohnDiffNormal >= 0 ? '+' : ''}{stundenlohnDiffNormal.toFixed(2)} EUR/h</strong></span>
        <span>Differenz zu 68,90 EUR/h: <strong style={{ color: stundenlohnDiffVeryGood >= 0 ? '#4ade80' : '#f87171' }}>{stundenlohnDiffVeryGood >= 0 ? '+' : ''}{stundenlohnDiffVeryGood.toFixed(2)} EUR/h</strong></span>
      </div>

      <div style={{ marginTop: '4px', display: 'flex', gap: '16px', flexWrap: 'wrap', color: '#cbd5e1', fontSize: '11px' }}>
        <span>Differenz Gesamtsumme zu Minimum: <strong style={{ color: gesamtDiffToMin >= 0 ? '#4ade80' : '#f87171' }}>{gesamtDiffToMin >= 0 ? '+' : ''}{formatEuro(gesamtDiffToMin)}</strong></span>
        <span>Differenz Gesamtsumme zu Maximum: <strong style={{ color: gesamtDiffToMax >= 0 ? '#4ade80' : '#f87171' }}>{gesamtDiffToMax >= 0 ? '+' : ''}{formatEuro(gesamtDiffToMax)}</strong></span>
      </div>

    </div>
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

    {/* 2. ABRECHNUNGSPOSITIONEN */}
    {(() => {
      const num = (val) => Number(String(val || '').replace(',', '.')) || 0;

      const buildData = () => ({
        surfaces: {},
        linear: {},
        kabel: { title: "Kabel An-/Abklemmen (Stk)", total: 0, items: [] },
        muffenMontierenUeber1m: { title: "Muffen montieren ANS(Stk)", total: 0, items: [] },
        muffenMontierenTausch: { title: "Muffen montieren ÄND(Stk)", total: 0, items: [] },
        muffenMontierenDemo: { title: "Muffen montieren ABR(Stk)", total: 0, items: [] },
        muffenDemoMontage: { title: "Muffen demontieren ANS(Stk)", total: 0, items: [] },
        muffenDemo: { title: "Muffen demontieren ABR(Stk)", total: 0, items: [] },
        muffenDemoTausch: { title: "Muffen demontieren ÄND(Stk)", total: 0, items: [] },
        netz1: { title: "Netzanschluss bis 1m", total: 0, items: [] },
        netz2: { title: "Netzanschluss über 1m", total: 0, items: [] },
        netzDemo: { title: "Netzanschluss demontieren (Stk)", total: 0, items: [] },
        grabenAns: { title: "Graben ANS (m)", total: 0, items: [] },
        grabenAend: { title: "Graben ÄND (m)", total: 0, items: [] },
        grabenAbr: { title: "Graben ABR (m)", total: 0, items: [] },
        kabelverlegenAns: { title: "Kabelverlegen ANS (m)", total: 0, items: [] },
        kabelverlegenAend: { title: "Kabelverlegen ÄND (m)", total: 0, items: [] },
        kabelverlegenAbr: { title: "Kabelverlegen ABR (m)", total: 0, items: [] },
        montagegrubeAns: { title: "Montagegrube ANS (Stk)", total: 0, items: [] },
        montagegrubeAend: { title: "Montagegrube ÄND (Stk)", total: 0, items: [] },
        montagegrubeAbr: { title: "Montagegrube ABR (Stk)", total: 0, items: [] },
        handarbeitStd: { title: "Handarbeit (Std)", total: 0, items: [] },
        transport: { title: "Transport (Std)", total: 0, items: [] }
      });

      const dataHsw = buildData();
      const dataMueller = buildData();

      if (form.aufmass?.masten) {
        form.aufmass.masten.forEach((m, mastIdx) => {
          // WICHTIG: Hier nutzen wir das Label aus dem Formular statt des Index
          const mastLabel = m.mastLabel || "Mast ?";

          // --- 1. HSW POSITIONEN ---
          const mastSurfaces = [
            { typ: normalizeSurfaceType(m.oberflaeche || "Grass"), x: m.oberflaecheX, y: m.oberflaecheY },
            ...normalizeExtraSurfaces(m.oberflaechenExtra)
          ];

          mastSurfaces.forEach((entry, idx) => {
            if (normalizeSurfaceType(entry.typ) === "Grass") return;
            const flaeche = num(entry.x) * num(entry.y);
            if (flaeche <= 0) return;

            const name = getSurfaceLabel(entry.typ);
            if (!dataHsw.surfaces[name]) dataHsw.surfaces[name] = { title: `${name} (m²)`, total: 0, items: [] };
            dataHsw.surfaces[name].total += flaeche;
            dataHsw.surfaces[name].items.push({ label: idx === 0 ? mastLabel : `${mastLabel} (extra)`, val: flaeche });
          });

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
              dataHsw.linear[s.key].items.push({ label: mastLabel, val: val });
            }
          });

          if (num(m.handarbeitStd) > 0) {
            dataHsw.handarbeitStd.total += num(m.handarbeitStd);
            dataHsw.handarbeitStd.items.push({ label: mastLabel, val: num(m.handarbeitStd) });
          }

          // --- 2. MÜLLER POSITIONEN ---
          const addMuellerSurface = (surfaceType, area, labelSuffix) => {
            const normalized = normalizeSurfaceType(surfaceType);
            if (area <= 0 || normalized === "Grass") return;
            const catGrabenName = `Graben ${getSurfaceLabel(normalized)}${labelSuffix ? ` ${labelSuffix}` : ""}`;
            if (!dataMueller.surfaces[catGrabenName]) {
              dataMueller.surfaces[catGrabenName] = { title: `${catGrabenName} (m²)`, total: 0, items: [] };
            }
            dataMueller.surfaces[catGrabenName].total += area;
            dataMueller.surfaces[catGrabenName].items.push({ label: mastLabel, val: area });
          };

          const laengeGrabenAns = num(m.grabenTiefeBreite);
          const laengeGrabenAend = num(m.grabenTiefeBreiteTausch);
          const laengeGrabenAbr = num(m.grabenTiefeBreiteDemo);

          if (laengeGrabenAns > 0) {
            const basisMast = (form.masten || []).find((mast) => {
              if (mast?.id && m?.id) return mast.id === m.id;
              if (mast?.mastLabel && m?.mastLabel) return mast.mastLabel === m.mastLabel;
              return false;
            }) || (form.masten || [])[mastIdx] || {};

            const aufmassAreasByType = getMastSurfaceAreasByType(m);
            const basisAreasByType = getMastSurfaceAreasByType(basisMast);
            const mergedLampAreasByType = {};
            const areaTypes = Array.from(new Set([
              ...Object.keys(aufmassAreasByType),
              ...Object.keys(basisAreasByType)
            ]));
            areaTypes.forEach((type) => {
              mergedLampAreasByType[type] = aufmassAreasByType[type] > 0 ? aufmassAreasByType[type] : (basisAreasByType[type] || 0);
            });

            const flaecheGrabenAns = laengeGrabenAns * 0.3;

            // Externe Graben-Oberfläche bleibt erhalten.
            addMuellerSurface(m.oberflaecheGraben || "Platten", flaecheGrabenAns, "(ANS)");

            // Lampen-Oberflächen kommen zusaetzlich mit ihrer realen Fläche (X*Y) dazu.
            Object.entries(mergedLampAreasByType).forEach(([surfaceType, area]) => {
              if ((Number(area) || 0) > 0) {
                addMuellerSurface(surfaceType, area, "(ANS)");
              }
            });
          }

          if (laengeGrabenAend > 0) {
            addMuellerSurface(m.oberflaecheGrabenTausch || "Platten", laengeGrabenAend * 0.3, "(ÄND)");
          }

          if (laengeGrabenAbr > 0) {
            addMuellerSurface(m.oberflaecheGrabenDemo || "Platten", laengeGrabenAbr * 0.3, "(ABR)");
          }

          const countGrubenAns = num(m.montagegrube);
          const countGrubenAend = num(m.montagegrubeTausch);
          const countGrubenAbr = num(m.montagegrubeDemo);

          if (countGrubenAns > 0) {
            if (!dataMueller.surfaces["Montagegruben ANS (Stk)"]) {
              dataMueller.surfaces["Montagegruben ANS (Stk)"] = { title: "Montagegruben ANS (Stk)", total: 0, items: [] };
            }
            dataMueller.surfaces["Montagegruben ANS (Stk)"].total += countGrubenAns;
            dataMueller.surfaces["Montagegruben ANS (Stk)"].items.push({ label: mastLabel, val: countGrubenAns });
          }
          if (countGrubenAend > 0) {
            if (!dataMueller.surfaces["Montagegruben ÄND (Stk)"]) {
              dataMueller.surfaces["Montagegruben ÄND (Stk)"] = { title: "Montagegruben ÄND (Stk)", total: 0, items: [] };
            }
            dataMueller.surfaces["Montagegruben ÄND (Stk)"].total += countGrubenAend;
            dataMueller.surfaces["Montagegruben ÄND (Stk)"].items.push({ label: mastLabel, val: countGrubenAend });
          }
          if (countGrubenAbr > 0) {
            if (!dataMueller.surfaces["Montagegruben ABR (Stk)"]) {
              dataMueller.surfaces["Montagegruben ABR (Stk)"] = { title: "Montagegruben ABR (Stk)", total: 0, items: [] };
            }
            dataMueller.surfaces["Montagegruben ABR (Stk)"].total += countGrubenAbr;
            dataMueller.surfaces["Montagegruben ABR (Stk)"].items.push({ label: mastLabel, val: countGrubenAbr });
          }

          // Bau-Positionen Müller
          if (laengeGrabenAns > 0) { dataMueller.grabenAns.total += laengeGrabenAns; dataMueller.grabenAns.items.push({ label: mastLabel, val: laengeGrabenAns }); }
          if (laengeGrabenAend > 0) { dataMueller.grabenAend.total += laengeGrabenAend; dataMueller.grabenAend.items.push({ label: mastLabel, val: laengeGrabenAend }); }
          if (laengeGrabenAbr > 0) { dataMueller.grabenAbr.total += laengeGrabenAbr; dataMueller.grabenAbr.items.push({ label: mastLabel, val: laengeGrabenAbr }); }
          if (countGrubenAns > 0) { dataMueller.montagegrubeAns.total += countGrubenAns; dataMueller.montagegrubeAns.items.push({ label: mastLabel, val: countGrubenAns }); }
          if (countGrubenAend > 0) { dataMueller.montagegrubeAend.total += countGrubenAend; dataMueller.montagegrubeAend.items.push({ label: mastLabel, val: countGrubenAend }); }
          if (countGrubenAbr > 0) { dataMueller.montagegrubeAbr.total += countGrubenAbr; dataMueller.montagegrubeAbr.items.push({ label: mastLabel, val: countGrubenAbr }); }
          if (num(m.grabenKabelverlegen) > 0) { dataMueller.kabelverlegenAns.total += num(m.grabenKabelverlegen); dataMueller.kabelverlegenAns.items.push({ label: mastLabel, val: num(m.grabenKabelverlegen) }); }
          if (num(m.grabenKabelverlegenTausch) > 0) { dataMueller.kabelverlegenAend.total += num(m.grabenKabelverlegenTausch); dataMueller.kabelverlegenAend.items.push({ label: mastLabel, val: num(m.grabenKabelverlegenTausch) }); }
          if (num(m.grabenKabelverlegenDemo) > 0) { dataMueller.kabelverlegenAbr.total += num(m.grabenKabelverlegenDemo); dataMueller.kabelverlegenAbr.items.push({ label: mastLabel, val: num(m.grabenKabelverlegenDemo) }); }
          if (num(m.netzanschlussBis1m) > 0) { dataMueller.netz1.total += num(m.netzanschlussBis1m); dataMueller.netz1.items.push({ label: mastLabel, val: num(m.netzanschlussBis1m) }); }
          if (num(m.kabelAnAbklemmenAnzahl) > 0) { dataMueller.kabel.total += num(m.kabelAnAbklemmenAnzahl); dataMueller.kabel.items.push({ label: mastLabel, val: num(m.kabelAnAbklemmenAnzahl) }); }
          if (num(m.netzanschlussDemoAnzahl) > 0) { dataMueller.netzDemo.total += num(m.netzanschlussDemoAnzahl); dataMueller.netzDemo.items.push({ label: mastLabel, val: num(m.netzanschlussDemoAnzahl) }); }
          if (num(m.muffenMontierenUeber1m) > 0) { dataMueller.muffenMontierenUeber1m.total += num(m.muffenMontierenUeber1m); dataMueller.muffenMontierenUeber1m.items.push({ label: mastLabel, val: num(m.muffenMontierenUeber1m) }); }
          if (num(m.muffenMontierenTausch) > 0) { dataMueller.muffenMontierenTausch.total += num(m.muffenMontierenTausch); dataMueller.muffenMontierenTausch.items.push({ label: mastLabel, val: num(m.muffenMontierenTausch) }); }
          if (num(m.muffenMontierenDemo) > 0) { dataMueller.muffenMontierenDemo.total += num(m.muffenMontierenDemo); dataMueller.muffenMontierenDemo.items.push({ label: mastLabel, val: num(m.muffenMontierenDemo) }); }
          if (num(m.muffenDemoMontage) > 0) { dataMueller.muffenDemoMontage.total += num(m.muffenDemoMontage); dataMueller.muffenDemoMontage.items.push({ label: mastLabel, val: num(m.muffenDemoMontage) }); }
          if (num(m.muffenDemo) > 0) { dataMueller.muffenDemo.total += num(m.muffenDemo); dataMueller.muffenDemo.items.push({ label: mastLabel, val: num(m.muffenDemo) }); }
          if (num(m.muffenDemoTausch) > 0) { dataMueller.muffenDemoTausch.total += num(m.muffenDemoTausch); dataMueller.muffenDemoTausch.items.push({ label: mastLabel, val: num(m.muffenDemoTausch) }); }
        });
      }

      if (form.aufmass?.allgemein?.transport) {
        const transportAllgemein = num(form.aufmass.allgemein.transport);
        if (transportAllgemein > 0) {
          dataHsw.transport.total += transportAllgemein;
          dataHsw.transport.items.push({ label: "Transport", val: transportAllgemein });
        }
      }

      // RENDER-FUNKTION angepasst auf item.label
      const renderCol = (title, dataObj) => {
        const list = [
          ...Object.values(dataObj.surfaces),
          ...Object.values(dataObj.linear),
          ...(dataObj.grabenAns.total > 0 ? [dataObj.grabenAns] : []),
          ...(dataObj.grabenAend.total > 0 ? [dataObj.grabenAend] : []),
          ...(dataObj.grabenAbr.total > 0 ? [dataObj.grabenAbr] : []),
          ...(dataObj.montagegrubeAns.total > 0 ? [dataObj.montagegrubeAns] : []),
          ...(dataObj.montagegrubeAend.total > 0 ? [dataObj.montagegrubeAend] : []),
          ...(dataObj.montagegrubeAbr.total > 0 ? [dataObj.montagegrubeAbr] : []),
          ...(dataObj.kabelverlegenAns.total > 0 ? [dataObj.kabelverlegenAns] : []),
          ...(dataObj.kabelverlegenAend.total > 0 ? [dataObj.kabelverlegenAend] : []),
          ...(dataObj.kabelverlegenAbr.total > 0 ? [dataObj.kabelverlegenAbr] : []),
          ...(dataObj.netz1.total > 0 ? [dataObj.netz1] : []),
          ...(dataObj.netz2.total > 0 ? [dataObj.netz2] : []),
          ...(dataObj.kabel.total > 0 ? [dataObj.kabel] : []),
          ...(dataObj.muffenMontierenUeber1m.total > 0 ? [dataObj.muffenMontierenUeber1m] : []),
          ...(dataObj.muffenMontierenTausch.total > 0 ? [dataObj.muffenMontierenTausch] : []),
          ...(dataObj.muffenMontierenDemo.total > 0 ? [dataObj.muffenMontierenDemo] : []),
          ...(dataObj.muffenDemoMontage.total > 0 ? [dataObj.muffenDemoMontage] : []),
          ...(dataObj.muffenDemo.total > 0 ? [dataObj.muffenDemo] : []),
          ...(dataObj.muffenDemoTausch.total > 0 ? [dataObj.muffenDemoTausch] : []),
          ...(dataObj.handarbeitStd.total > 0 ? [dataObj.handarbeitStd] : []),
          ...(dataObj.netzDemo.total > 0 ? [dataObj.netzDemo] : []),
          ...(dataObj.transport.total > 0 ? [dataObj.transport] : [])
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
                    <div key={`${title}-${cat.title}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span style={{ color: '#94a3b8' }}>{item.label}</span>
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
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
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
          marginLeft: "10px",
          flexShrink: 0
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

      {settingsOpen && (
        <div
          onClick={() => setSettingsOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2,6,23,0.7)',
            zIndex: 12000,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '16px'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(1100px, 95vw)',
              maxHeight: '90vh',
              overflow: 'auto',
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '12px',
              padding: '16px',
              color: '#e2e8f0'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Einstellungen & Nachkalkulation</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={exportAnalyticsToExcel} style={{ backgroundColor: '#0284c7', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', fontWeight: 600 }}>
                  Excel Export
                </button>
                <button onClick={() => setProformaExportPopupOpen(true)} style={{ backgroundColor: '#0ea5e9', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', fontWeight: 600 }}>
                  Proforma Excel Export
                </button>
                <button onClick={handleLogout} style={{ backgroundColor: '#e74c3c', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', fontWeight: 600 }}>
                  Logout
                </button>
                <button onClick={() => setSettingsOpen(false)} style={{ backgroundColor: '#1e293b', color: 'white', border: '1px solid #334155', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer' }}>
                  Schließen
                </button>
              </div>
            </div>

            <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8' }}>Typ-Filter</label>
                <select value={settingsTypeFilter} onChange={(e) => setSettingsTypeFilter(e.target.value)} className="mast-input-base" style={{ width: '100%', marginTop: '4px' }}>
                  {analyticsTypeOptions.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8' }}>Sortierung</label>
                <select value={settingsSortBy} onChange={(e) => setSettingsSortBy(e.target.value)} className="mast-input-base" style={{ width: '100%', marginTop: '4px' }}>
                  <option value="date-desc">Datum (neu zuerst)</option>
                  <option value="date-asc">Datum (alt zuerst)</option>
                  <option value="hourly-desc">Stundenlohn (hoch zuerst)</option>
                  <option value="hourly-asc">Stundenlohn (niedrig zuerst)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8' }}>Von Datum</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="dd.mm.yyyy"
                  value={normalizeDateValue(settingsDateFrom)}
                  onChange={(e) => setSettingsDateFrom(e.target.value)}
                  onBlur={(e) => setSettingsDateFrom(normalizeDateValue(e.target.value))}
                  className="mast-input-base"
                  style={{ width: '100%', marginTop: '4px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8' }}>Bis Datum</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="dd.mm.yyyy"
                  value={normalizeDateValue(settingsDateTo)}
                  onChange={(e) => setSettingsDateTo(e.target.value)}
                  onBlur={(e) => setSettingsDateTo(normalizeDateValue(e.target.value))}
                  className="mast-input-base"
                  style={{ width: '100%', marginTop: '4px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8' }}>Proforma-Erinnerung (Tage)</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={proformaReminderDays}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setProformaReminderDays(Number.isFinite(val) && val > 0 ? Math.round(val) : 1);
                  }}
                  className="mast-input-base"
                  style={{ width: '100%', marginTop: '4px' }}
                />
              </div>
            </div>

            <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '8px' }}>
              <div style={{ background: '#111827', padding: '8px', borderRadius: '6px', border: '1px solid #334155' }}>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>Ø Stundenlohn (Filter)</div>
                <strong style={{ color: getProfitabilityColor(overviewAverageRate, MIN_HOURLY_RATE, VERY_GOOD_HOURLY_RATE + 10), fontSize: '14px' }}>{overviewAverageRate.toFixed(2)} EUR/h</strong>
              </div>
              <div style={{ background: '#111827', padding: '8px', borderRadius: '6px', border: '1px solid #334155' }}>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>&ge; {NORMAL_HOURLY_RATE.toFixed(1)} EUR/h (Gut+)</div>
                <strong style={{ color: '#4ade80', fontSize: '14px' }}>{overviewProfitabelCount} / {analyticsRows.length}</strong>
              </div>
              <div style={{ background: '#111827', padding: '8px', borderRadius: '6px', border: '1px solid #334155' }}>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>&ge; {VERY_GOOD_HOURLY_RATE.toFixed(1)} EUR/h (Sehr gut)</div>
                <strong style={{ color: '#22c55e', fontSize: '14px' }}>{overviewVeryGoodCount}</strong>
              </div>
              <div style={{ background: '#111827', padding: '8px', borderRadius: '6px', border: '1px solid #334155' }}>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>{'<'} {MIN_HOURLY_RATE.toFixed(0)} EUR/h</div>
                <strong style={{ color: '#f87171', fontSize: '14px' }}>{analyticsRows.filter((item) => item.hourlyRate < MIN_HOURLY_RATE).length}</strong>
              </div>
              <div style={{ background: '#111827', padding: '8px', borderRadius: '6px', border: '1px solid #334155' }}>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>Masten Montage (Zeitraum)</div>
                <strong style={{ color: '#22c55e', fontSize: '14px' }}>{totalMontageCount}</strong>
              </div>
              <div style={{ background: '#111827', padding: '8px', borderRadius: '6px', border: '1px solid #334155' }}>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>Masten Demontage (Zeitraum)</div>
                <strong style={{ color: '#f87171', fontSize: '14px' }}>{totalDemontageCount}</strong>
              </div>
            </div>

            <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {[
                { id: 'timeline', label: 'Verlauf' },
                { id: 'city', label: 'Städte' },
                { id: 'type', label: 'Auftragstypen' },
                { id: 'distribution', label: 'Rentabilität' },
                { id: 'monthly', label: 'Monatliche Stunden' }
              ].map((chart) => (
                <button
                  key={chart.id}
                  onClick={() => setSettingsChartView(chart.id)}
                  style={{
                    background: settingsChartView === chart.id ? '#0284c7' : '#1e293b',
                    color: 'white',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  {chart.label}
                </button>
              ))}
            </div>

            <div style={{ marginTop: '12px', background: '#111827', border: '1px solid #334155', borderRadius: '8px', padding: '12px' }}>
              {settingsChartView === 'timeline' && (
                <>
                  <h4 style={{ margin: '0 0 10px 0', color: '#93c5fd' }}>Stundenlohn-Verlauf nach Monat</h4>
                  {timelineData.length > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', minHeight: '220px', overflowX: 'auto', paddingBottom: '8px' }}>
                      {timelineData.map((item) => (
                        <div key={item.key} style={{ minWidth: '48px', textAlign: 'center' }}>
                          <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>{item.avgRate.toFixed(1)}</div>
                          <div style={{
                            height: `${Math.max(8, (item.avgRate / timelineMax) * 170)}px`,
                            background: getProfitabilityColor(item.avgRate, MIN_HOURLY_RATE, VERY_GOOD_HOURLY_RATE + 10),
                            borderRadius: '6px 6px 0 0'
                          }} />
                          <div style={{ fontSize: '10px', color: '#cbd5e1', marginTop: '4px' }}>{item.key.slice(2)}</div>
                        </div>
                      ))}
                    </div>
                  ) : <div style={{ color: '#94a3b8' }}>Keine Verlaufsdaten im aktuellen Filter.</div>}
                </>
              )}

              {settingsChartView === 'city' && (
                <>
                  <h4 style={{ margin: '0 0 10px 0', color: '#93c5fd' }}>Stundenlohn nach Stadt</h4>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {cityData.map((item) => (
                      <div key={item.city} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 150px', gap: '8px', alignItems: 'center' }}>
                        <span>{item.city}</span>
                        <div style={{ height: '12px', background: '#1f2937', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, (item.avgRate / cityMax) * 100)}%`, height: '100%', background: getProfitabilityColor(item.avgRate, MIN_HOURLY_RATE, VERY_GOOD_HOURLY_RATE + 10) }} />
                        </div>
                        <span style={{ textAlign: 'right', color: getProfitabilityColor(item.avgRate, MIN_HOURLY_RATE, VERY_GOOD_HOURLY_RATE + 10), fontWeight: 700 }}>{item.avgRate.toFixed(2)} EUR/h ({item.count})</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {settingsChartView === 'type' && (
                <>
                  <h4 style={{ margin: '0 0 10px 0', color: '#93c5fd' }}>Stundenlohn nach Auftragstyp</h4>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {typeData.map((item) => (
                      <div key={item.type} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 150px', gap: '8px', alignItems: 'center' }}>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.type}</span>
                        <div style={{ height: '12px', background: '#1f2937', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, (item.avgRate / typeMax) * 100)}%`, height: '100%', background: getProfitabilityColor(item.avgRate, MIN_HOURLY_RATE, VERY_GOOD_HOURLY_RATE + 10) }} />
                        </div>
                        <span style={{ textAlign: 'right', color: getProfitabilityColor(item.avgRate, MIN_HOURLY_RATE, VERY_GOOD_HOURLY_RATE + 10), fontWeight: 700 }}>{item.avgRate.toFixed(2)} EUR/h ({item.count})</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {settingsChartView === 'distribution' && (
                <>
                  <h4 style={{ margin: '0 0 10px 0', color: '#93c5fd' }}>Rentabilitäts-Verteilung</h4>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {distributionData.map((item) => (
                      <div key={item.label} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 80px', gap: '8px', alignItems: 'center' }}>
                        <span>{item.label}</span>
                        <div style={{ height: '12px', background: '#1f2937', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, (item.count / distributionMax) * 100)}%`, height: '100%', background: item.color }} />
                        </div>
                        <span style={{ textAlign: 'right', fontWeight: 700 }}>{item.count}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {settingsChartView === 'monthly' && (
                <>
                  <h4 style={{ margin: '0 0 10px 0', color: '#93c5fd' }}>Monatliche Stunden (Auslastung)</h4>
                  {monthlyVolumeData.length > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', minHeight: '220px', overflowX: 'auto', paddingBottom: '8px' }}>
                      {monthlyVolumeData.map((item) => (
                        <div key={item.key} style={{ minWidth: '48px', textAlign: 'center' }}>
                          <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>{item.totalHours.toFixed(0)}h</div>
                          <div style={{
                            height: `${Math.max(8, (item.totalHours / monthlyHoursMax) * 170)}px`,
                            background: '#38bdf8',
                            borderRadius: '6px 6px 0 0'
                          }} />
                          <div style={{ fontSize: '10px', color: '#cbd5e1', marginTop: '4px' }}>{item.key.slice(2)}</div>
                        </div>
                      ))}
                    </div>
                  ) : <div style={{ color: '#94a3b8' }}>Keine Stundendaten im aktuellen Filter.</div>}
                </>
              )}

              {analyticsRows.length === 0 && (
                <div style={{ color: '#94a3b8', marginTop: '8px' }}>Keine Datensätze für die aktuelle Filter-/Sortierauswahl.</div>
              )}
            </div>

            {proformaExportPopupOpen && (
              <div
                onClick={() => setProformaExportPopupOpen(false)}
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(2,6,23,0.75)',
                  zIndex: 13000,
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  padding: '16px'
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: 'min(560px, 96vw)',
                    background: '#0b1220',
                    border: '1px solid #1f2a44',
                    borderRadius: '10px',
                    padding: '14px',
                    color: '#e2e8f0'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <h4 style={{ margin: 0, color: '#7dd3fc' }}>Proforma Export</h4>
                    <button onClick={() => setProformaExportPopupOpen(false)} style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer' }}>
                      Schließen
                    </button>
                  </div>

                  <div style={{ marginTop: '10px', fontSize: '12px', color: '#93c5fd' }}>
                    Zeitraum bezieht sich auf den Zeitpunkt, wann der Status auf Proforma gesetzt wurde.
                  </div>

                  <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: '#94a3b8' }}>Von Datum</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="dd.mm.yyyy"
                        value={normalizeDateValue(proformaDateFrom)}
                        onChange={(e) => setProformaDateFrom(e.target.value)}
                        onBlur={(e) => setProformaDateFrom(normalizeDateValue(e.target.value))}
                        className="mast-input-base"
                        style={{ width: '100%', marginTop: '4px' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: '#94a3b8' }}>Bis Datum</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="dd.mm.yyyy"
                        value={normalizeDateValue(proformaDateTo)}
                        onChange={(e) => setProformaDateTo(e.target.value)}
                        onBlur={(e) => setProformaDateTo(normalizeDateValue(e.target.value))}
                        className="mast-input-base"
                        style={{ width: '100%', marginTop: '4px' }}
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', color: '#93c5fd' }}>Treffer: {proformaExportRows.length}</span>
                    <button onClick={exportProformaToExcel} style={{ backgroundColor: '#0ea5e9', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', fontWeight: 600 }}>
                      Jetzt Proforma exportieren
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      </>
    )}
    </div>
  );
}