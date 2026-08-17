import React, { useEffect, useLayoutEffect, useState, useRef } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, Rectangle, useMapEvents, ZoomControl } from "react-leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.heat/dist/leaflet-heat.js";
import { useMap } from "react-leaflet"; 
import { pb } from './pocketbase'; // Punkt-Schrägstrich bedeutet: im selben Ordner
import imageCompression from 'browser-image-compression';
import * as XLSX from 'xlsx';

const enableLeafletHeatWillReadFrequently = () => {
  const HeatLayer = L?.HeatLayer;
  if (!HeatLayer || HeatLayer.__willReadFrequentlyPatched) return;

  const originalInitCanvas = HeatLayer.prototype?._initCanvas;
  if (typeof originalInitCanvas !== 'function') return;

  HeatLayer.prototype._initCanvas = function patchedInitCanvas() {
    originalInitCanvas.call(this);

    try {
      // Ensure the first context creation uses the readback-optimized hint.
      this._canvas?.getContext?.('2d', { willReadFrequently: true });
    } catch (e) {
      // Ignore: fallback behavior remains unchanged.
    }
  };

  HeatLayer.__willReadFrequentlyPatched = true;
};

enableLeafletHeatWillReadFrequently();

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

function SettingsHeatmapLayer({ points, radius = 34, blur = 26 }) {
  const map = useMap();
  const layerRef = useRef([]);
  const retryTimerRef = useRef(null);
  const [currentZoom, setCurrentZoom] = useState(null);

  useEffect(() => {
    if (!map) return;

    const updateZoom = () => setCurrentZoom(map.getZoom());
    updateZoom();
    map.on('zoomend', updateZoom);

    return () => {
      map.off('zoomend', updateZoom);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;

    if (Array.isArray(layerRef.current) && layerRef.current.length > 0) {
      layerRef.current.forEach((layer) => map.removeLayer(layer));
      layerRef.current = [];
    }

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (!Array.isArray(points) || points.length === 0) return;

    const size = map.getSize();
    if (!size || size.x <= 0 || size.y <= 0) {
      // In modals, Leaflet can momentarily report zero size; retry once after layout settles.
      retryTimerRef.current = setTimeout(() => {
        try {
          map.invalidateSize(false);
        } catch (e) {
          // No-op: if map is gone, next effect run handles cleanup.
        }
      }, 60);
      return () => {
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
      };
    }

    try {
      const heatPoints = points
        .filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng))
        .map((point) => [point.lat, point.lng, point.intensity]);

      if (heatPoints.length === 0) return;

      const zoomValue = Number.isFinite(currentZoom) ? currentZoom : map.getZoom();
      const zoomFactor = zoomValue > 0 ? Math.min(3.2, Math.max(1, 14 / zoomValue)) : 1;
      const dynamicRadius = Math.round(radius * zoomFactor);
      const dynamicBlur = Math.round(blur * Math.min(2.2, Math.max(1, Math.sqrt(zoomFactor))));

      const layer = L.heatLayer(heatPoints, {
        radius: dynamicRadius,
        blur: dynamicBlur,
        maxZoom: 16,
        minOpacity: 0.2,
        // Colors represent hourly-rate intensity (low=red, high=green).
        gradient: {
          0.1: '#ef4444',
          0.35: '#f97316',
          0.55: '#eab308',
          0.75: '#84cc16',
          1: '#22c55e'
        }
      });

      layer.addTo(map);
      layerRef.current = [layer];
    } catch (err) {
      console.warn('Heatmap-Layer konnte noch nicht gezeichnet werden, neuer Versuch beim nächsten Render.', err);
    }

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (Array.isArray(layerRef.current) && layerRef.current.length > 0) {
        layerRef.current.forEach((layer) => map.removeLayer(layer));
        layerRef.current = [];
      }
    };
  }, [map, points, radius, blur, currentZoom]);

  return null;
}

function SettingsMapStabilizer({ watchKey, points = [], companyLat = null, companyLng = null }) {
  const map = useMap();

  useEffect(() => {
    let cancelled = false;
    const timers = [];

    const safeInvalidate = () => {
      if (cancelled) return;
      try {
        map.invalidateSize(false);
      } catch (e) {
        // No-op when map was already unmounted.
      }
    };

    // Modal/layout transitions can report stale dimensions; re-check several times.
    [0, 80, 180, 320, 520].forEach((delay) => {
      const t = setTimeout(safeInvalidate, delay);
      timers.push(t);
    });

    const fitTimer = setTimeout(() => {
      if (cancelled) return;

      const fitPoints = [];
      points.forEach((point) => {
        if (Number.isFinite(point?.lat) && Number.isFinite(point?.lng)) {
          fitPoints.push([point.lat, point.lng]);
        }
      });

      if (Number.isFinite(companyLat) && Number.isFinite(companyLng)) {
        fitPoints.push([companyLat, companyLng]);
      }

      if (fitPoints.length === 0) return;

      try {
        map.flyToBounds(L.latLngBounds(fitPoints), {
          padding: [36, 36],
          maxZoom: 13,
          duration: 0.45
        });
      } catch (e) {
        // Ignore if map is not ready yet.
      }
    }, 220);

    timers.push(fitTimer);

    return () => {
      cancelled = true;
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [map, watchKey, points, companyLat, companyLng]);

  return null;
}

/* ================= ICONS ================= */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "/leaflet/marker-icon-2x.png",
  iconUrl: "/leaflet/marker-icon.png",
  shadowUrl: "/leaflet/marker-shadow.png",
});

const createIcon = (color) =>
  new L.Icon({
    iconUrl: "/leaflet/marker-icon.png",
    shadowUrl: "/leaflet/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    className: `leaflet-marker-icon leaflet-marker-icon-${color}`,
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
  gesamtMueller: "",
  subKosten: ""
};

const DEFAULT_AUFMASS_ALLGEMEIN = {
  transport: "",
  extraInfos: "",
  tatsaechlicheWerktage: "",
  ansMindestansatzBeiUnter1m: false,
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
const EXCLUDED_NACHKALK_TYPES = new Set(["störung"]);
const WORK_DAYS_PER_WEEK = 5;
const MAST_OUTPUT_PER_DAY = {
  montage: 1.8,
  tausch: 1.2,
  demontage: 3.7
};
const LK_SIKA_TAUSCH_ACTION = "LK / SiKa Tausch";
const LK_SIKA_HSW_FIELDS = [
  { key: 'lkMontieren', title: 'LK montieren (Stk)' },
  { key: 'lkDemontieren', title: 'LK demontieren (Stk)' },
  { key: 'lkTauschen', title: 'LK tauschen (Stk)' },
  { key: 'sikaMontieren', title: 'SiKa montieren (Stk)' },
  { key: 'sikaDemontieren', title: 'SiKa demontieren (Stk)' },
  { key: 'sikaTauschen', title: 'SiKa tauschen (Stk)' },
  { key: 'auslegerMontieren', title: 'Ausleger montieren (Stk)' },
  { key: 'auslegerDemontieren', title: 'Ausleger demontieren (Stk)' },
  { key: 'auslegerTauschen', title: 'Ausleger tauschen (Stk)' },
  { key: 'steckdosenanschlussMontieren', title: 'Steckdosenanschluss montieren (Stk)' },
  { key: 'steckdosenanschlussDemontieren', title: 'Steckdosenanschluss demontieren (Stk)' }
];

const MAST_LV_POSITION_DEFS = [
  { key: 'lv_2_1_10', action: 'montage', group: 'gerade', height: 'bis5', title: 'LV-2.1.10 Lichtmast bis 5,00 m Lichtpunkthöhe errichten (Stk)' },
  { key: 'lv_2_1_30', action: 'montage', group: 'gerade', height: '5bis8', title: 'LV-2.1.30 Lichtmast errichten 5,01 m bis 8,00 m Lichtpunkthöhe (Stk)' },
  { key: 'lv_2_1_20', action: 'demontage', group: 'gerade', height: 'bis5', title: 'LV-2.1.20 Lichtmast bis 5,00 m Lichtpunkthöhe demontieren (Stk)' },
  { key: 'lv_2_1_40', action: 'demontage', group: 'gerade', height: '5bis8', title: 'LV-2.1.40 Lichtmast demontieren 5,01 m bis 8,00 m (Stk)' },
  { key: 'lv_2_1_50', action: 'montage', group: 'gebogen', height: 'bis5', title: 'LV-2.1.50 Lichtmast gebogen errichten bis 5,00 m Lichtpunkthöhe (Stk)' },
  { key: 'lv_2_1_70', action: 'montage', group: 'gebogen', height: '5bis8', title: 'LV-2.1.70 Lichtmast gebogen errichten 5,01 m bis 8,00 m Lichtpunkthöhe (Stk)' },
  { key: 'lv_2_1_60', action: 'demontage', group: 'gebogen', height: 'bis5', title: 'LV-2.1.60 Lichtmast gebogen demontieren bis 5,00 m Lichtpunkthöhe (Stk)' },
  { key: 'lv_2_1_80', action: 'demontage', group: 'gebogen', height: '5bis8', title: 'LV-2.1.80 Lichtmast gebogen demontieren 5,01 m bis 8,00 m Lichtpunkthöhe (Stk)' },
  { key: 'lv_2_1_90', action: 'montage', group: 'pvc', height: 'bis5', title: 'LV-2.1.90 Lichtmast in PVC-Rohr bis 5,00 m Lichtpunkthöhe errichten (Stk)' },
  { key: 'lv_2_1_100', action: 'montage', group: 'pvc', height: '5bis8', title: 'LV-2.1.100 Lichtmast in PVC-Rohr errichten 5,01 m bis 8,00 m Lichtpunkthöhe (Stk)' },
  { key: 'lv_2_1_110', action: 'demontage', group: 'pvc', height: 'bis5', title: 'LV-2.1.110 Lichtmast in PVC-Rohr demontieren bis 5,00 m Lichtpunkthöhe (Stk)' },
  { key: 'lv_2_1_120', action: 'demontage', group: 'pvc', height: '5bis8', title: 'LV-2.1.120 Lichtmast in PVC-Rohr demontieren 5,01 m bis 8,00 m Lichtpunkthöhe (Stk)' },
  { key: 'lv_2_1_130', action: 'montage', group: 'flansch', height: 'bis5', title: 'LV-2.1.130 Lichtmast mit Flansch bis 5,00 m Lichtpunkthöhe errichten (Stk)' },
  { key: 'lv_2_1_140', action: 'montage', group: 'flansch', height: '5bis8', title: 'LV-2.1.140 Lichtmast mit Flansch errichten 5,01 m bis 8,00 m Lichtpunkthöhe (Stk)' },
  { key: 'lv_2_1_150', action: 'demontage', group: 'flansch', height: 'bis5', title: 'LV-2.1.150 Lichtmast mit Flansch demontieren bis 5,00 m Lichtpunkthöhe (Stk)' },
  { key: 'lv_2_1_160', action: 'demontage', group: 'flansch', height: '5bis8', title: 'LV-2.1.160 Lichtmast mit Flansch demontieren 5,01 m bis 8,00 m Lichtpunkthöhe (Stk)' }
];

const MAST_LV_POSITION_LOOKUP = MAST_LV_POSITION_DEFS.reduce((acc, def) => {
  acc[`${def.action}|${def.group}|${def.height}`] = def.key;
  return acc;
}, {});

const ORDER_EXPORT_FIELD_OPTIONS = [
  { key: "name", label: "Projektname", width: 34 },
  { key: "type", label: "Typ", width: 18 },
  { key: "status", label: "Status", width: 26 },
  { key: "createdDate", label: "Erstellt am", width: 16 },
  { key: "updatedDate", label: "Zuletzt geändert", width: 18 },
  { key: "address", label: "Adresse", width: 44 },
  { key: "westnetz", label: "Westnetznummer", width: 30 },
  { key: "pgk", label: "PGK", width: 18 },
  { key: "ab_hsw", label: "AB HSW", width: 14 },
  { key: "ab_mueller", label: "AB Müller", width: 14 },
  { key: "zeitbedarf", label: "Zeitbedarf", width: 14 },
  { key: "tatsaechlicheWerktage", label: "Tatsächlich gebraucht (WT)", width: 22 },
  { key: "mastenTotal", label: "Masten gesamt", width: 14 },
  { key: "mastenMontage", label: "Masten Montage", width: 16 },
  { key: "mastenTausch", label: "Masten Tausch", width: 14 },
  { key: "mastenDemontage", label: "Masten Demontage", width: 18 },
  { key: "einmessungWeggeschicktAm", label: "Einmessung weggeschickt am", width: 24 },
  { key: "materialbuchungErfolgtAm", label: "Materialbuchung erfolgt am", width: 24 },
  { key: "proformaRechnungWeggeschicktAm", label: "Proforma Rechnung weggeschickt am", width: 30 },
  { key: "stunden", label: "Nachkalk Stunden", width: 16 },
  { key: "hourlyRate", label: "Nachkalk EUR/h", width: 16 },
  { key: "gesamtHsw", label: "Nachkalk HSW EUR", width: 18 },
  { key: "gesamtMueller", label: "Nachkalk Müller EUR", width: 20 },
  { key: "subKosten", label: "Sub-/Fremdkosten EUR", width: 20 },
  { key: "gesamt", label: "Gesamt netto EUR", width: 18 },
  { key: "notes", label: "Notizen", width: 40 }
];

const DEFAULT_ORDER_EXPORT_FIELDS = ORDER_EXPORT_FIELD_OPTIONS.map((field) => field.key);

const normalizeProjectType = (value) => String(value || "").trim().toLowerCase();
const isKonzeptProjectType = (value) => normalizeProjectType(value) === "konzept";
const isExcludedFromNachkalk = (type) => EXCLUDED_NACHKALK_TYPES.has(normalizeProjectType(type));
const isMontageRelatedAction = (action) => normalizeProjectType(action) === "montage";

const getMastHeightBucket = (heightValue) => {
  const height = parseNumberInput(heightValue);
  if (height <= 0) return null;
  if (height <= 5) return "bis5";
  if (height <= 8) return "5bis8";
  return null;
};

const normalizeFoundationGroup = (foundationType) => {
  const normalized = normalizeProjectType(foundationType);
  if (normalized.includes('pvc')) return 'pvc';
  if (normalized.includes('flansch')) return 'flansch';
  return 'fundament';
};

const normalizeMastShape = (mastType) => {
  const normalized = normalizeProjectType(mastType);
  return normalized === 'gebogen' ? 'gebogen' : 'gerade';
};

const resolveMastLvGroup = (foundationType, mastType) => {
  const foundationGroup = normalizeFoundationGroup(foundationType);
  if (foundationGroup === 'pvc' || foundationGroup === 'flansch') return foundationGroup;
  return normalizeMastShape(mastType);
};

const getMastLvPositionKey = ({ action, foundationType, mastType, heightValue }) => {
  const normalizedAction = normalizeProjectType(action);
  if (normalizedAction !== 'montage' && normalizedAction !== 'demontage') return null;

  const heightBucket = getMastHeightBucket(heightValue);
  if (!heightBucket) return null;

  const group = resolveMastLvGroup(foundationType, mastType);
  return MAST_LV_POSITION_LOOKUP[`${normalizedAction}|${group}|${heightBucket}`] || null;
};

const parseNumberInput = (value) => {
  const num = Number(String(value || "").replace(',', '.').trim());
  return Number.isFinite(num) ? num : 0;
};

const parseCoordinateInput = (value) => {
  const num = Number(String(value || "").replace(',', '.').trim());
  return Number.isFinite(num) ? num : null;
};

const toRadians = (value) => (Number(value) || 0) * (Math.PI / 180);

const calculateDistanceKm = (lat1, lng1, lat2, lng2) => {
  if (![lat1, lng1, lat2, lng2].every((value) => Number.isFinite(value))) return null;
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
};

const formatWorkDaysLabel = (fullDays = 0) => {
  const safeDays = Math.max(0, Number(fullDays) || 0);
  const weeks = Math.floor(safeDays / WORK_DAYS_PER_WEEK);
  const remainingDays = safeDays % WORK_DAYS_PER_WEEK;
  return `${weeks}W ${remainingDays}T`;
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

const calculateArea = (xVal, yVal) => {
  const width = parseFloat(String(xVal || "").replace(',', '.')) || 0;
  const height = parseFloat(String(yVal || "").replace(',', '.')) || 0;
  return width * height;
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
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [mode, setMode] = useState("list");
  const [activeTab, setActiveTab] = useState("Allgemein");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const mapRef = useRef(null);
  const [batchAktion, setBatchAktion] = useState('Tausch');

  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedPosition, setSelectedPosition] = useState(null);

  /* 🔍 FILTER */
  const [search, setSearch] = useState("");
  const [selectedStatusFilters, setSelectedStatusFilters] = useState([
    "Offen",
    "Klärung",
    "Westnetznummer fehlt",
    "In Bearbeitung",
    "Fertig für Abrechnung"
  ]);
  const [selectedTypeFilters, setSelectedTypeFilters] = useState(["Alle"]);
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  const [typeFilterOpen, setTypeFilterOpen] = useState(false);
  const statusFilterRef = useRef(null);
  const typeFilterRef = useRef(null);
  const ordersExportTypeFilterRef = useRef(null);
  const ordersExportStatusFilterRef = useRef(null);

  /* 🔎 ADRESSSUCHE FÜR ERSTELLEN */
  const [searchResults, setSearchResults] = useState([]);
  const [searchTimeout, setSearchTimeout] = useState(null);
  const [searchAddress, setSearchAddress] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTypeFilter, setSettingsTypeFilter] = useState("Alle");
  const [settingsSortBy, setSettingsSortBy] = useState("date-desc");
  const [settingsDateFrom, setSettingsDateFrom] = useState(() => getCurrentYearStartDateString());
  const [settingsDateTo, setSettingsDateTo] = useState(() => getTodayDateString());
  const [chartDetailOpen, setChartDetailOpen] = useState(false);
  const [chartDetailTitle, setChartDetailTitle] = useState("");
  const [chartDetailRows, setChartDetailRows] = useState([]);
  const [chartDetailSearch, setChartDetailSearch] = useState("");
  const [chartDetailStatusFilter, setChartDetailStatusFilter] = useState("Alle");
  const [chartDetailTypeFilter, setChartDetailTypeFilter] = useState("Alle");
  const [chartDetailDateFrom, setChartDetailDateFrom] = useState("");
  const [chartDetailDateTo, setChartDetailDateTo] = useState("");
  const [chartDetailSortKey, setChartDetailSortKey] = useState("createdDate");
  const [chartDetailSortDir, setChartDetailSortDir] = useState("desc");
  const [ordersExportPopupOpen, setOrdersExportPopupOpen] = useState(false);
  const [ordersExportTypeFilter, setOrdersExportTypeFilter] = useState(["Alle"]);
  const [ordersExportStatusFilter, setOrdersExportStatusFilter] = useState(["Alle"]);
  const [ordersExportTypeFilterOpen, setOrdersExportTypeFilterOpen] = useState(false);
  const [ordersExportStatusFilterOpen, setOrdersExportStatusFilterOpen] = useState(false);
  const [ordersExportDateFrom, setOrdersExportDateFrom] = useState(() => getCurrentYearStartDateString());
  const [ordersExportDateTo, setOrdersExportDateTo] = useState(() => getTodayDateString());
  const [ordersExportSelectedFields, setOrdersExportSelectedFields] = useState(() => [...DEFAULT_ORDER_EXPORT_FIELDS]);
  const [proformaReminderDays, setProformaReminderDays] = useState(() => {
    const saved = Number(localStorage.getItem('proforma_reminder_days'));
    return Number.isFinite(saved) && saved > 0 ? saved : 14;
  });
  const [settingsChartView, setSettingsChartView] = useState("timeline");
  const [settingsCompanyLat, setSettingsCompanyLat] = useState(() => {
    const saved = String(localStorage.getItem('settings_company_lat') || '').trim();
    // Migrate previous default to Bundesstrasse 168 in 59909 Bestwig.
    if (!saved || saved === '51.3515') return '51.3622994';
    return saved;
  });
  const [settingsCompanyLng, setSettingsCompanyLng] = useState(() => {
    const saved = String(localStorage.getItem('settings_company_lng') || '').trim();
    // Migrate previous default to Bundesstrasse 168 in 59909 Bestwig.
    if (!saved || saved === '8.2839') return '8.4046718';
    return saved;
  });
  const [settingsHeatRadius, setSettingsHeatRadius] = useState(() => {
    const saved = Number(localStorage.getItem('settings_heat_radius'));
    return Number.isFinite(saved) ? Math.min(180, Math.max(18, Math.round(saved))) : 46;
  });
  const [settingsHeatBlur, setSettingsHeatBlur] = useState(() => {
    const saved = Number(localStorage.getItem('settings_heat_blur'));
    return Number.isFinite(saved) ? Math.min(60, Math.max(10, Math.round(saved))) : 26;
  });
  const [settingsGeoOverlayMode, setSettingsGeoOverlayMode] = useState(() => localStorage.getItem('settings_geo_overlay_mode') || 'heat');
  const [settingsGeoCellSizeKm, setSettingsGeoCellSizeKm] = useState(() => {
    const saved = Number(localStorage.getItem('settings_geo_cell_size_km'));
    return Number.isFinite(saved) ? Math.min(25, Math.max(0.1, Number(saved.toFixed(1)))) : 4;
  });

  const [originalProject, setOriginalProject] = useState(null);
  const [toast, setToast] = useState(null);
  const [alertToast, setAlertToast] = useState({ show: false, message: "" });
  const [tempFiles, setTempFiles] = useState([]);

  const leuchtenOptionen = [
    "Trilux Cuvia",
    "Trilux 9701",
    "Trilux 9821"
  ];
  const STATUS_FILTER_OPTIONS = [
    { value: "Alle", label: "Alle" },
    { value: "Offen", label: "Offen" },
    { value: "Klärung", label: "Klärung" },
    { value: "Westnetznummer fehlt", label: "Westnetznummer fehlt" },
    { value: "In Bearbeitung", label: "In Bearbeitung" },
    { value: "Fertig für Abrechnung", label: "Fertig für Abrechnung" },
    { value: "Proformarechnung weggeschickt", label: "Proformarechnung weggeschickt" },
    { value: "Abgerechnet", label: "Abgerechnet" }
  ];
  const TYPE_FILTER_OPTIONS = [
    { value: "Alle", label: "Alle" },
    { value: "Konzept", label: "Konzept" },
    { value: "Anfahrschaden", label: "Anfahrschaden" },
    { value: "Störung", label: "Störung" },
    { value: "LK-Tausch", label: "LK-Tausch" },
    { value: "Sonstiges", label: "Sonstiges" }
  ];

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

const parseMastLabel = (label) => {
  const normalizedLabel = String(label || "").trim();
  const match = normalizedLabel.match(/^(?:Mast\s*)?(\d+)([a-z]*)$/i);

  if (!match) {
    return { number: null, suffix: "" };
  }

  return {
    number: Number(match[1]),
    suffix: (match[2] || "").toLowerCase()
  };
};

const mastSuffixToIndex = (suffix) => {
  if (!suffix) return 0;

  return suffix.split("").reduce((acc, char) => {
    const charIndex = char.toLowerCase().charCodeAt(0) - 96;
    if (charIndex < 1 || charIndex > 26) return acc;
    return acc * 26 + charIndex;
  }, 0);
};

const mastIndexToSuffix = (index) => {
  if (index <= 0) return "";

  let remaining = index;
  let suffix = "";

  while (remaining > 0) {
    remaining -= 1;
    suffix = String.fromCharCode(97 + (remaining % 26)) + suffix;
    remaining = Math.floor(remaining / 26);
  }

  return suffix;
};

const getMastSortKey = (label, fallbackIndex = 0) => {
  const parsed = parseMastLabel(label);

  return {
    number: parsed.number ?? fallbackIndex,
    suffixIndex: mastSuffixToIndex(parsed.suffix)
  };
};

const normalizeMastLabels = (masten = []) => {
  const entries = masten.map((m, index) => {
    const parsed = parseMastLabel(m?.mastLabel);

    return {
      mast: m,
      originalIndex: index,
      number: parsed.number,
      suffix: parsed.suffix
    };
  });

  const usedNumbers = new Set(entries.map((entry) => entry.number).filter((number) => Number.isFinite(number) && number > 0));
  let nextNumber = 1;

  const allocateNumber = () => {
    while (usedNumbers.has(nextNumber)) {
      nextNumber += 1;
    }

    const allocated = nextNumber;
    usedNumbers.add(allocated);
    nextNumber += 1;
    return allocated;
  };

  const groupedEntries = new Map();

  entries.forEach((entry) => {
    const baseNumber = entry.number && entry.number > 0 ? entry.number : allocateNumber();

    if (!groupedEntries.has(baseNumber)) {
      groupedEntries.set(baseNumber, []);
    }

    groupedEntries.get(baseNumber).push({ ...entry, baseNumber });
  });

  return Array.from(groupedEntries.entries())
    .sort(([numberA], [numberB]) => numberA - numberB)
    .flatMap(([baseNumber, group]) => {
      const sortedGroup = [...group].sort((a, b) => a.originalIndex - b.originalIndex);

      return sortedGroup.map((entry, index) => {
        const suffix = sortedGroup.length === 1 ? entry.suffix : mastIndexToSuffix(index);

        return {
          ...entry.mast,
          mastLabel: suffix ? `Mast ${baseNumber}${suffix}` : `Mast ${baseNumber}`
        };
      });
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
      sondersacheRinnenflussX: m.sondersacheRinnenflussX || "",
      sondersacheRinnenflussY: m.sondersacheRinnenflussY || "",
      sondersacheRinnenfluss: m.sondersacheRinnenfluss || (calculateArea(m.sondersacheRinnenflussX, m.sondersacheRinnenflussY) > 0 ? String(calculateArea(m.sondersacheRinnenflussX, m.sondersacheRinnenflussY)) : ""),
      mastTypAlt: m.mastTypAlt || "",
      mastTypNeu: m.mastTypNeu || "",
      grabenTiefeBreite: m.grabenTiefeBreite || "",
      grabenKabelverlegen: m.grabenKabelverlegen || "",
      oberflaecheGraben: normalizeSurfaceType(m.oberflaecheGraben || "Grass"),
      montagegrube: m.montagegrube || "",
      endmuffenAns: m.endmuffenAns || "",
      montagegrubeDemo: m.montagegrubeDemo || "",
      endmuffenDemo: m.endmuffenDemo || "",
      montagegrubeTausch: m.montagegrubeTausch || "",
      endmuffenTausch: m.endmuffenTausch || "",
      muffenDemoMontage: m.muffenDemoMontage || "",
      grabenTiefeBreiteDemo: m.grabenTiefeBreiteDemo || "",
      grabenKabelverlegenDemo: m.grabenKabelverlegenDemo || "",
      oberflaecheGrabenDemo: normalizeSurfaceType(m.oberflaecheGrabenDemo || "Grass"),
      grabenTiefeBreiteTausch: m.grabenTiefeBreiteTausch || "",
      grabenKabelverlegenTausch: m.grabenKabelverlegenTausch || "",
      oberflaecheGrabenTausch: normalizeSurfaceType(m.oberflaecheGrabenTausch || "Grass"),
      lkMontieren: m.lkMontieren || "",
      lkDemontieren: m.lkDemontieren || "",
      lkTauschen: m.lkTauschen || "",
      sikaMontieren: m.sikaMontieren || "",
      sikaDemontieren: m.sikaDemontieren || "",
      sikaTauschen: m.sikaTauschen || "",
      auslegerMontieren: m.auslegerMontieren || "",
      auslegerDemontieren: m.auslegerDemontieren || "",
      auslegerTauschen: m.auslegerTauschen || "",
      steckdosenanschlussMontieren: m.steckdosenanschlussMontieren || "",
      steckdosenanschlussDemontieren: m.steckdosenanschlussDemontieren || ""
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

const getProjectFileUrl = async (project, fileName) => {
  const fallbackUrl = pb.files.getURL(project, fileName);

  try {
    const token = await pb.files.getToken();
    if (!token) return fallbackUrl;
    return pb.files.getURL(project, fileName, { token });
  } catch (err) {
    console.warn("Datei-Token konnte nicht geladen werden, nutze Fallback-URL.", err);
    return fallbackUrl;
  }
};

const compressFilesForUpload = async (rawFiles = []) => {
  const files = Array.isArray(rawFiles) ? rawFiles : [];
  return Promise.all(
    files.map(async (file) => {
      if (!file?.type?.startsWith('image/')) return file;

      try {
        const options = {
          maxSizeMB: 1,
          maxWidthOrHeight: 1920,
          useWebWorker: false
        };
        return await imageCompression(file, options);
      } catch (err) {
        console.warn('Bild-Kompression fehlgeschlagen, nutze Originaldatei.', err);
        return file;
      }
    })
  );
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

    // Nach erfolgreichem Login die auth-geschuetzten Projekte neu laden.
    await loadProjects();

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
  } finally {
    setProjectsLoaded(true);
  }
};

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (statusFilterRef.current && !statusFilterRef.current.contains(event.target)) {
        setStatusFilterOpen(false);
      }
      if (typeFilterRef.current && !typeFilterRef.current.contains(event.target)) {
        setTypeFilterOpen(false);
      }
      if (ordersExportTypeFilterRef.current && !ordersExportTypeFilterRef.current.contains(event.target)) {
        setOrdersExportTypeFilterOpen(false);
      }
      if (ordersExportStatusFilterRef.current && !ordersExportStatusFilterRef.current.contains(event.target)) {
        setOrdersExportStatusFilterOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const toggleMultiFilterValue = (value, selectedValues, setSelectedValues) => {
    if (value === "Alle") {
      setSelectedValues(["Alle"]);
      return;
    }

    const withoutAlle = selectedValues.filter((v) => v !== "Alle");
    if (withoutAlle.includes(value)) {
      const next = withoutAlle.filter((v) => v !== value);
      setSelectedValues(next.length === 0 ? ["Alle"] : next);
      return;
    }

    setSelectedValues([...withoutAlle, value]);
  };

  const getMultiFilterSummary = (selectedValues, options) => {
    if (selectedValues.includes("Alle") || selectedValues.length === 0) return "Alle";
    if (selectedValues.length === 1) {
      return options.find((opt) => opt.value === selectedValues[0])?.label || selectedValues[0];
    }
    return `${selectedValues.length} ausgewählt`;
  };

  const matchesStatusFilter = (projectStatus) => {
    if (selectedStatusFilters.includes("Alle") || selectedStatusFilters.length === 0) return true;
    return selectedStatusFilters.includes(projectStatus);
  };

  const keepOnlyOneStatusFilter = (value) => {
    if (value === "Alle") {
      setSelectedStatusFilters(["Alle"]);
      return;
    }
    setSelectedStatusFilters([value]);
  };

  const keepOnlyOneTypeFilter = (value) => {
    if (value === "Alle") {
      setSelectedTypeFilters(["Alle"]);
      return;
    }
    setSelectedTypeFilters([value]);
  };

  const matchesTypeFilter = (projectType) => {
    if (selectedTypeFilters.includes("Alle") || selectedTypeFilters.length === 0) return true;
    return selectedTypeFilters.includes(projectType);
  };

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
      matchesStatusFilter(p.status) &&
      matchesTypeFilter(p.type)
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
    const aktuellerMast = neueMasten[index];
    if (!aktuellerMast) return prev;

    if (field === 'sondersacheRinnenflussX' || field === 'sondersacheRinnenflussY') {
      const naechsterMast = { ...aktuellerMast, [field]: value };
      const flaeche = calculateArea(naechsterMast.sondersacheRinnenflussX, naechsterMast.sondersacheRinnenflussY);
      naechsterMast.sondersacheRinnenfluss = flaeche > 0 ? String(flaeche) : "";
      neueMasten[index] = naechsterMast;
    } else {
      neueMasten[index] = { ...aktuellerMast, [field]: value };
    }
    
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

const autoResizeTextarea = (event) => {
  const el = event?.target || event?.currentTarget;
  if (!el) return;
  el.style.overflowY = 'hidden';
  el.style.height = '0px';
  el.style.height = `${el.scrollHeight}px`;
};

useLayoutEffect(() => {
  if (activeTab !== "Aufmaß") return;

  const elements = document.querySelectorAll('textarea.aufmass-autogrow');
  elements.forEach((el) => {
    el.style.overflowY = 'hidden';
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  });
}, [activeTab, form]);

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
    sondersacheRinnenflussX: "",
    sondersacheRinnenflussY: "",
    oberflaeche: normalizeSurfaceType(m.oberflaeche || "Grass"),
    oberflaechenExtra: normalizeExtraSurfaces(m.oberflaechenExtra),
    oberflaecheGraben: "Grass",
    oberflaecheGrabenDemo: "Grass",
    oberflaecheGrabenTausch: "Grass",
    grabenTiefeBreite: "",
    grabenKabelverlegen: "",
    montagegrube: "",
    endmuffenAns: "",
    montagegrubeDemo: "",
    endmuffenDemo: "",
    montagegrubeTausch: "",
    endmuffenTausch: "",
    muffenDemoMontage: "",
    grabenTiefeBreiteDemo: "",
    grabenKabelverlegenDemo: "",
    grabenTiefeBreiteTausch: "",
    grabenKabelverlegenTausch: "",
    lkMontieren: "",
    lkDemontieren: "",
    lkTauschen: "",
    sikaMontieren: "",
    sikaDemontieren: "",
    sikaTauschen: "",
    auslegerMontieren: "",
    auslegerDemontieren: "",
    auslegerTauschen: "",
    steckdosenanschlussMontieren: "",
    steckdosenanschlussDemontieren: ""
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
  let allgemeinTatsaechlicheWerktage = "";
  let allgemeinAnsMindestansatzBeiUnter1m = false;
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
      allgemeinTatsaechlicheWerktage = rawAufmass.allgemein?.tatsaechlicheWerktage || rawAufmass.allgemein?.echteWerktage || "";
      allgemeinAnsMindestansatzBeiUnter1m = !!rawAufmass.allgemein?.ansMindestansatzBeiUnter1m;
      allgemeinEinmessungWeggeschicktAm = rawAufmass.allgemein?.einmessungWeggeschicktAm || "";
      allgemeinMaterialbuchungErfolgtAm = rawAufmass.allgemein?.materialbuchungErfolgtAm || "";
      allgemeinProformaRechnungWeggeschicktAm = rawAufmass.allgemein?.proformaRechnungWeggeschicktAm || "";
      allgemeinNachkalkulation = {
        ...DEFAULT_NACHKALKULATION,
        ...(rawAufmass.allgemein?.nachkalkulation || {}),
        gesamtHsw: rawAufmass.allgemein?.nachkalkulation?.gesamtHsw || rawAufmass.allgemein?.nachkalkulation?.summeHsw || rawAufmass.allgemein?.summeHsw || "",
        gesamtMueller: rawAufmass.allgemein?.nachkalkulation?.gesamtMueller || rawAufmass.allgemein?.nachkalkulation?.summeMueller || rawAufmass.allgemein?.summeMueller || "",
        subKosten: rawAufmass.allgemein?.nachkalkulation?.subKosten || rawAufmass.allgemein?.nachkalkulation?.fremdkosten || rawAufmass.allgemein?.subKosten || rawAufmass.allgemein?.fremdkosten || ""
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
    oberflaecheGraben: normalizeSurfaceType(m.oberflaecheGraben || "Grass"),
    montagegrube: m.montagegrube || "",
    endmuffenAns: m.endmuffenAns || "",
    montagegrubeDemo: m.montagegrubeDemo || "",
    endmuffenDemo: m.endmuffenDemo || "",
    montagegrubeTausch: m.montagegrubeTausch || "",
    endmuffenTausch: m.endmuffenTausch || "",
    muffenDemoMontage: m.muffenDemoMontage || "",
    grabenTiefeBreiteDemo: m.grabenTiefeBreiteDemo || "",
    grabenKabelverlegenDemo: m.grabenKabelverlegenDemo || "",
    oberflaecheGrabenDemo: normalizeSurfaceType(m.oberflaecheGrabenDemo || "Grass"),
    grabenTiefeBreiteTausch: m.grabenTiefeBreiteTausch || "",
    grabenKabelverlegenTausch: m.grabenKabelverlegenTausch || "",
    oberflaecheGrabenTausch: normalizeSurfaceType(m.oberflaecheGrabenTausch || "Grass"),
    lkMontieren: m.lkMontieren || "",
    lkDemontieren: m.lkDemontieren || "",
    lkTauschen: m.lkTauschen || "",
    sikaMontieren: m.sikaMontieren || "",
    sikaDemontieren: m.sikaDemontieren || "",
    sikaTauschen: m.sikaTauschen || "",
    auslegerMontieren: m.auslegerMontieren || "",
    auslegerDemontieren: m.auslegerDemontieren || "",
    auslegerTauschen: m.auslegerTauschen || "",
    steckdosenanschlussMontieren: m.steckdosenanschlussMontieren || "",
    steckdosenanschlussDemontieren: m.steckdosenanschlussDemontieren || ""
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
        tatsaechlicheWerktage: allgemeinTatsaechlicheWerktage,
        ansMindestansatzBeiUnter1m: allgemeinAnsMindestansatzBeiUnter1m,
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
      // setSelectedStatusFilters(["Alle"]);
      // setSelectedTypeFilters(["Alle"]);
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
        tatsaechlicheWerktage: data.allgemein?.tatsaechlicheWerktage || data.allgemein?.echteWerktage || "",
        ansMindestansatzBeiUnter1m: !!data.allgemein?.ansMindestansatzBeiUnter1m,
        einmessungWeggeschicktAm: data.allgemein?.einmessungWeggeschicktAm || "",
        materialbuchungErfolgtAm: data.allgemein?.materialbuchungErfolgtAm || "",
        proformaRechnungWeggeschicktAm: data.allgemein?.proformaRechnungWeggeschicktAm || "",
        nachkalkulation: {
          ...DEFAULT_NACHKALKULATION,
          ...(data.allgemein?.nachkalkulation || {}),
          gesamtHsw: data.allgemein?.nachkalkulation?.gesamtHsw || data.allgemein?.nachkalkulation?.summeHsw || data.allgemein?.summeHsw || "",
          gesamtMueller: data.allgemein?.nachkalkulation?.gesamtMueller || data.allgemein?.nachkalkulation?.summeMueller || data.allgemein?.summeMueller || "",
          subKosten: data.allgemein?.nachkalkulation?.subKosten || data.allgemein?.nachkalkulation?.fremdkosten || data.allgemein?.subKosten || data.allgemein?.fremdkosten || ""
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
      tatsaechlicheWerktage: data.allgemein?.tatsaechlicheWerktage || data.allgemein?.echteWerktage || "",
      ansMindestansatzBeiUnter1m: !!data.allgemein?.ansMindestansatzBeiUnter1m,
      einmessungWeggeschicktAm: data.allgemein?.einmessungWeggeschicktAm || "",
      materialbuchungErfolgtAm: data.allgemein?.materialbuchungErfolgtAm || "",
      proformaRechnungWeggeschicktAm: data.allgemein?.proformaRechnungWeggeschicktAm || "",
      nachkalkulation: {
        ...DEFAULT_NACHKALKULATION,
        ...(data.allgemein?.nachkalkulation || {}),
        gesamtHsw: data.allgemein?.nachkalkulation?.gesamtHsw || data.allgemein?.nachkalkulation?.summeHsw || data.allgemein?.summeHsw || "",
        gesamtMueller: data.allgemein?.nachkalkulation?.gesamtMueller || data.allgemein?.nachkalkulation?.summeMueller || data.allgemein?.summeMueller || "",
        subKosten: data.allgemein?.nachkalkulation?.subKosten || data.allgemein?.nachkalkulation?.fremdkosten || data.allgemein?.subKosten || data.allgemein?.fremdkosten || ""
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
  const nachkalkSubKosten = parseNumberInput(nachkalkulation.subKosten);
  const nachkalkGesamtBrutto = nachkalkGesamtHsw + nachkalkGesamtMueller;
  const nachkalkGesamt = nachkalkGesamtBrutto - nachkalkSubKosten;
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
      return { stunden: 0, gesamtHsw: 0, gesamtMueller: 0, subKosten: 0, gesamtBrutto: 0, gesamt: 0, hourlyRate: 0, ...actionCounts };
    }

    const nachkalk = parsed?.allgemein?.nachkalkulation || {};
    const stunden = parseNumberInput(nachkalk.stunden);
    const sumHsw = parseNumberInput(nachkalk.gesamtHsw || nachkalk.summeHsw || parsed?.allgemein?.summeHsw);
    const sumMueller = parseNumberInput(nachkalk.gesamtMueller || nachkalk.summeMueller || parsed?.allgemein?.summeMueller);
    const subKosten = parseNumberInput(nachkalk.subKosten || nachkalk.fremdkosten || parsed?.allgemein?.subKosten || parsed?.allgemein?.fremdkosten);
    const gesamtBrutto = sumHsw + sumMueller;
    const gesamt = gesamtBrutto - subKosten;
    const hourlyRate = stunden > 0 ? gesamt / stunden : 0;
    const actionCounts = countMastActions(parsed?.masten || []);
    return { stunden, gesamtHsw: sumHsw, gesamtMueller: sumMueller, subKosten, gesamtBrutto, gesamt, hourlyRate, ...actionCounts };
  };

  const parseProjectPosition = (project) => {
    const rawPosition = project?.position;
    let parsedPosition = rawPosition;

    if (typeof rawPosition === 'string') {
      try {
        parsedPosition = JSON.parse(rawPosition);
      } catch (e) {
        parsedPosition = null;
      }
    }

    const lat = Number(parsedPosition?.lat);
    const lng = Number(parsedPosition?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { lat: null, lng: null };
    return { lat, lng };
  };

  const analyticsRowsAllTypesBase = projects.map((p) => {
    const stats = parseProjectAufmassStats(p);
    const position = parseProjectPosition(p);
    const createdAt = p.created ? new Date(p.created) : null;
    return {
      id: p.id,
      name: p.name || "Unbenannt",
      type: p.type || "Unbekannt",
      status: p.status || "",
      city: detectCityFromAddress(p.address),
      abHsw: String(p.ab_hsw || "").trim() || "-",
      abMueller: String(p.ab_mueller || "").trim() || "-",
      createdAt,
      createdDate: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString().slice(0, 10) : "",
      lat: position.lat,
      lng: position.lng,
      ...stats
    };
  }).filter((row) => row.stunden > 0);

  const analyticsRowsBase = analyticsRowsAllTypesBase
    .filter((row) => !isExcludedFromNachkalk(row.type));

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

  const analyticsRowsByTypeChart = analyticsRowsAllTypesBase
    .filter((row) => settingsTypeFilter === "Alle" || row.type === settingsTypeFilter)
    .filter((row) => !settingsDateFromISO || (row.createdDate && row.createdDate >= settingsDateFromISO))
    .filter((row) => !settingsDateToISO || (row.createdDate && row.createdDate <= settingsDateToISO));

  const getWeightedHourlyRate = (rows = []) => {
    const totals = rows.reduce((acc, row) => {
      const stunden = Number(row?.stunden) || 0;
      if (stunden <= 0) return acc;
      acc.totalHours += stunden;
      acc.totalNet += Number(row?.gesamt) || 0;
      return acc;
    }, { totalHours: 0, totalNet: 0 });

    return totals.totalHours > 0 ? totals.totalNet / totals.totalHours : 0;
  };

  const overviewAverageRate = getWeightedHourlyRate(analyticsRows);
  const overviewProfitabelCount = analyticsRows.filter((item) => item.hourlyRate >= NORMAL_HOURLY_RATE).length;
  const overviewVeryGoodCount = analyticsRows.filter((item) => item.hourlyRate >= VERY_GOOD_HOURLY_RATE).length;
  const totalMontageCount = analyticsRows.reduce((sum, item) => sum + (item.montageCount || 0), 0);
  const totalDemontageCount = analyticsRows.reduce((sum, item) => sum + (item.demontageCount || 0), 0);
  const overviewMaxRate = Math.max(1, ...analyticsRows.map((item) => item.hourlyRate));
  const defaultTypeOptions = ["Konzept", "Anfahrschaden", "LK-Tausch", "Sonstiges"];
  const analyticsTypeOptions = [
    "Alle",
    ...Array.from(
      new Set([
        ...defaultTypeOptions,
        ...projects.map((p) => p.type).filter((type) => type && !isExcludedFromNachkalk(type))
      ])
    )
  ];

  useEffect(() => {
    if (isExcludedFromNachkalk(settingsTypeFilter)) {
      setSettingsTypeFilter("Alle");
    }
  }, [settingsTypeFilter]);

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

  const ordersExportDateFromISO = normalizeDateForFilter(ordersExportDateFrom);
  const ordersExportDateToISO = normalizeDateForFilter(ordersExportDateTo);

  const orderExportTypeOptions = [
    "Alle",
    ...Array.from(new Set([
      "Konzept",
      "Anfahrschaden",
      "Störung",
      "LK-Tausch",
      "Sonstiges",
      ...projects.map((p) => p.type).filter(Boolean)
    ]))
  ].map((value) => ({ value, label: value }));

  const orderExportStatusOptions = [
    "Alle",
    ...Array.from(new Set([
      "Offen",
      "Klärung",
      "Westnetznummer fehlt",
      "In Bearbeitung",
      "Fertig für Abrechnung",
      "Proformarechnung weggeschickt",
      "Abgerechnet",
      ...projects.map((p) => p.status).filter(Boolean)
    ]))
  ].map((value) => ({ value, label: value }));

  const openOrdersExportPopup = () => {
    setOrdersExportTypeFilter(["Alle"]);
    setOrdersExportStatusFilter(["Alle"]);
    setOrdersExportTypeFilterOpen(false);
    setOrdersExportStatusFilterOpen(false);
    setOrdersExportDateFrom("");
    setOrdersExportDateTo("");
    setOrdersExportSelectedFields([...DEFAULT_ORDER_EXPORT_FIELDS]);
    setOrdersExportPopupOpen(true);
  };

  const parseProjectMasten = (project) => {
    const raw = project?.masten;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }
    return [];
  };

  const parseProjectAufmassAllgemein = (project) => {
    let rawAufmass = project?.aufmass;

    if (typeof rawAufmass === 'string') {
      try {
        rawAufmass = JSON.parse(rawAufmass);
      } catch (e) {
        rawAufmass = null;
      }
    }

    if (!rawAufmass || Array.isArray(rawAufmass) || typeof rawAufmass !== 'object') {
      return {};
    }

    return rawAufmass?.allgemein || {};
  };

  const getProjectActualWorkDays = (project) => {
    const aufmassAllgemein = parseProjectAufmassAllgemein(project);
    return parseNumberInput(aufmassAllgemein?.tatsaechlicheWerktage || aufmassAllgemein?.echteWerktage);
  };

  const estimateFullDaysFromActionCounts = ({ mastenMontage = 0, mastenTausch = 0, mastenDemontage = 0 } = {}) => {
    const estimatedDaysRaw =
      (mastenMontage / MAST_OUTPUT_PER_DAY.montage) +
      (mastenTausch / MAST_OUTPUT_PER_DAY.tausch) +
      (mastenDemontage / MAST_OUTPUT_PER_DAY.demontage);
    return Math.ceil(estimatedDaysRaw);
  };

  function countProjectMastActionsDetailed(masten = []) {
    let mastenMontage = 0;
    let mastenTausch = 0;
    let mastenDemontage = 0;

    masten.forEach((mast) => {
      const action = String(mast?.aktion || mast?.typ || "").toLowerCase();

      if (action.includes("tausch")) {
        mastenTausch += 1;
      } else if (action.includes("demont")) {
        mastenDemontage += 1;
      } else if (action.includes("montage")) {
        mastenMontage += 1;
      }
    });

    return { mastenMontage, mastenTausch, mastenDemontage };
  }

  const historicalTimeCalibration = projects.reduce((acc, project) => {
    if (!isKonzeptProjectType(project?.type)) return acc;
    if (!project?.id || project.id === selectedProject?.id) return acc;

    const masten = parseProjectMasten(project);
    const actionCounts = countProjectMastActionsDetailed(masten);
    const estimatedDays = estimateFullDaysFromActionCounts(actionCounts);
    const actualDays = getProjectActualWorkDays(project);

    if (estimatedDays <= 0 || actualDays <= 0) return acc;

    acc.ratioSum += actualDays / estimatedDays;
    acc.sampleCount += 1;
    return acc;
  }, { ratioSum: 0, sampleCount: 0 });

  const dynamicTimeFactorRaw = historicalTimeCalibration.sampleCount > 0
    ? historicalTimeCalibration.ratioSum / historicalTimeCalibration.sampleCount
    : 1;
  const dynamicTimeFactor = Math.min(2.5, Math.max(0.5, dynamicTimeFactorRaw));

  const ordersExportRows = projects
    .map((project) => {
      const masten = parseProjectMasten(project);
      const { mastenMontage, mastenTausch, mastenDemontage } = countProjectMastActionsDetailed(masten);
      const aufmassStats = parseProjectAufmassStats(project);
      const aufmassAllgemein = parseProjectAufmassAllgemein(project);
      const createdAt = project?.created ? new Date(project.created) : null;
      const updatedAt = project?.updated ? new Date(project.updated) : null;
      const createdDateISO = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString().slice(0, 10) : "";
      const isKonzeptProject = isKonzeptProjectType(project?.type);
      const estimatedFullDays = estimateFullDaysFromActionCounts({ mastenMontage, mastenTausch, mastenDemontage });
      const adjustedFullDays = isKonzeptProject ? Math.ceil(estimatedFullDays * dynamicTimeFactor) : 0;
      const relevantMastenCount = mastenMontage + mastenTausch + mastenDemontage;
      const estimatedWeeks = Number((adjustedFullDays / WORK_DAYS_PER_WEEK).toFixed(2));
      const actualWorkDays = getProjectActualWorkDays(project);

      return {
        id: project?.id,
        name: project?.name || "",
        type: project?.type || "",
        status: project?.status || "",
        createdDateISO,
        createdDate: createdAt && !Number.isNaN(createdAt.getTime()) ? formatDateToDDMMYYYY(createdAt) : "",
        updatedDate: updatedAt && !Number.isNaN(updatedAt.getTime()) ? formatDateToDDMMYYYY(updatedAt) : "",
        address: project?.address || "",
        westnetz: project?.westnetz || "",
        pgk: project?.pgk || "",
        ab_hsw: project?.ab_hsw || "",
        ab_mueller: project?.ab_mueller || "",
        zeitbedarf: isKonzeptProject && relevantMastenCount > 0 ? estimatedWeeks : "",
        tatsaechlicheWerktage: actualWorkDays > 0 ? Number(actualWorkDays.toFixed(2)) : "",
        mastenTotal: masten.length,
        mastenMontage,
        mastenTausch,
        mastenDemontage,
        einmessungWeggeschicktAm: normalizeDateValue(aufmassAllgemein?.einmessungWeggeschicktAm || ""),
        materialbuchungErfolgtAm: normalizeDateValue(aufmassAllgemein?.materialbuchungErfolgtAm || ""),
        proformaRechnungWeggeschicktAm: normalizeDateValue(aufmassAllgemein?.proformaRechnungWeggeschicktAm || ""),
        stunden: Number((aufmassStats?.stunden || 0).toFixed(2)),
        hourlyRate: Number((aufmassStats?.hourlyRate || 0).toFixed(2)),
        gesamtHsw: Number((aufmassStats?.gesamtHsw || 0).toFixed(2)),
        gesamtMueller: Number((aufmassStats?.gesamtMueller || 0).toFixed(2)),
        subKosten: Number((aufmassStats?.subKosten || 0).toFixed(2)),
        gesamt: Number((aufmassStats?.gesamt || 0).toFixed(2)),
        notes: project?.notes || ""
      };
    })
    .filter((row) => ordersExportTypeFilter.includes("Alle") || ordersExportTypeFilter.length === 0 || ordersExportTypeFilter.includes(row.type))
    .filter((row) => ordersExportStatusFilter.includes("Alle") || ordersExportStatusFilter.length === 0 || ordersExportStatusFilter.includes(row.status))
    .filter((row) => !ordersExportDateFromISO || (row.createdDateISO && row.createdDateISO >= ordersExportDateFromISO))
    .filter((row) => !ordersExportDateToISO || (row.createdDateISO && row.createdDateISO <= ordersExportDateToISO));

  const toggleOrdersExportField = (key) => {
    setOrdersExportSelectedFields((prev) => {
      if (prev.includes(key)) {
        return prev.filter((item) => item !== key);
      }
      return [...prev, key];
    });
  };

  const selectAllOrdersExportFields = () => {
    setOrdersExportSelectedFields([...DEFAULT_ORDER_EXPORT_FIELDS]);
  };

  const clearOrdersExportFields = () => {
    setOrdersExportSelectedFields([]);
  };

  const exportOrdersToExcel = () => {
    if (ordersExportRows.length === 0) {
      setToast("Keine Aufträge im gewählten Filter gefunden");
      setTimeout(() => setToast(null), 2500);
      return;
    }

    const selectedFields = ORDER_EXPORT_FIELD_OPTIONS.filter((field) => ordersExportSelectedFields.includes(field.key));
    if (selectedFields.length === 0) {
      setToast("Bitte mindestens ein Feld für den Export auswählen");
      setTimeout(() => setToast(null), 2500);
      return;
    }

    const rows = ordersExportRows.map((row) => {
      const exportRow = {};
      selectedFields.forEach((field) => {
        exportRow[field.label] = row[field.key] ?? "";
      });
      return exportRow;
    });

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = selectedFields.map((field) => ({ wch: field.width || 16 }));
    XLSX.utils.book_append_sheet(workbook, sheet, 'Aufträge');

    const filterSheetRows = [
      { Filter: 'Typ', Wert: ordersExportTypeFilter },
      { Filter: 'Status', Wert: ordersExportStatusFilter },
      { Filter: 'Von Datum', Wert: normalizeDateValue(ordersExportDateFrom) || '-' },
      { Filter: 'Bis Datum', Wert: normalizeDateValue(ordersExportDateTo) || '-' },
      { Filter: 'Ausgewählte Felder', Wert: selectedFields.map((field) => field.label).join(', ') },
      { Filter: 'Anzahl Aufträge', Wert: ordersExportRows.length }
    ];
    const filterSheet = XLSX.utils.json_to_sheet(filterSheetRows);
    filterSheet['!cols'] = [{ wch: 24 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(workbook, filterSheet, 'Filter');

    const fromPart = normalizeDateValue(ordersExportDateFrom) || 'alle';
    const toPart = normalizeDateValue(ordersExportDateTo) || 'heute';
    XLSX.writeFile(workbook, `Auftraege_Export_${fromPart}_bis_${toPart}.xlsx`);

    setToast(`✅ Auftrags-Export erstellt (${ordersExportRows.length} Aufträge)`);
    setTimeout(() => setToast(null), 2200);
    setOrdersExportPopupOpen(false);
  };

  useEffect(() => {
    localStorage.setItem('proforma_reminder_days', String(proformaReminderDays));
  }, [proformaReminderDays]);

  useEffect(() => {
    localStorage.setItem('settings_company_lat', String(settingsCompanyLat || ''));
  }, [settingsCompanyLat]);

  useEffect(() => {
    localStorage.setItem('settings_company_lng', String(settingsCompanyLng || ''));
  }, [settingsCompanyLng]);

  useEffect(() => {
    localStorage.setItem('settings_heat_radius', String(settingsHeatRadius));
  }, [settingsHeatRadius]);

  useEffect(() => {
    localStorage.setItem('settings_heat_blur', String(settingsHeatBlur));
  }, [settingsHeatBlur]);

  useEffect(() => {
    localStorage.setItem('settings_geo_overlay_mode', String(settingsGeoOverlayMode || 'heat'));
  }, [settingsGeoOverlayMode]);

  useEffect(() => {
    localStorage.setItem('settings_geo_cell_size_km', String(settingsGeoCellSizeKm));
  }, [settingsGeoCellSizeKm]);

  const proformaReminderCheckedRef = React.useRef(false);

  useEffect(() => {
    if (!projectsLoaded) return;
    if (proformaReminderCheckedRef.current) return;
    if (!(Number(proformaReminderDays) > 0)) return;

    proformaReminderCheckedRef.current = true;

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

    const firstName = overdueItems[0]?.name || "Projekt";
    const baseMsg = overdueItems.length === 1
      ? `⏰ Erinnerung: Proforma bei "${firstName}" seit ${proformaReminderDays} Tagen offen.`
      : `⏰ Erinnerung: ${overdueItems.length} Proforma-Rechnungen sind seit mindestens ${proformaReminderDays} Tagen offen.`;

    setAlertToast({ show: true, message: baseMsg });
  }, [projectsLoaded, projects, proformaReminderDays]);

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
      Subkosten_EUR: Number((item.subKosten || 0).toFixed(2)),
      Gesamt_Brutto_EUR: Number(((item.gesamtBrutto ?? (item.gesamtHsw + item.gesamtMueller)) || 0).toFixed(2)),
      Gesamt_Netto_EUR: Number(item.gesamt.toFixed(2)),
      Stundenlohn_EUR_h: Number(item.hourlyRate.toFixed(2)),
      Masten_Montage: item.montageCount || 0,
      Masten_Demontage: item.demontageCount || 0
    }));

    const dataSheet = XLSX.utils.json_to_sheet(exportRows);
    dataSheet['!cols'] = [
      { wch: 34 }, { wch: 16 }, { wch: 14 }, { wch: 12 },
      { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
      { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 18 }
    ];
    XLSX.utils.book_append_sheet(workbook, dataSheet, 'Baustellen');

    const summaryRows = [
      { Kennzahl: 'Filter Typ', Wert: settingsTypeFilter },
      { Kennzahl: 'Von Datum', Wert: settingsDateFrom || '-' },
      { Kennzahl: 'Bis Datum', Wert: settingsDateTo || '-' },
      { Kennzahl: 'Anzahl Datensaetze', Wert: analyticsRows.length },
      { Kennzahl: 'Gewichteter Stundenlohn', Wert: Number(overviewAverageRate.toFixed(2)) },
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
      if (!acc[monthKey]) acc[monthKey] = { key: monthKey, totalNet: 0, totalHours: 0, count: 0 };
      acc[monthKey].totalNet += Number(row.gesamt) || 0;
      acc[monthKey].totalHours += Number(row.stunden) || 0;
      acc[monthKey].count += 1;
      return acc;
    }, {})
  )
    .map((item) => ({
      ...item,
      avgRate: item.totalHours > 0 ? item.totalNet / item.totalHours : 0
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const cityOrder = ["Meschede", "Olsberg", "Bestwig", "Sonstige"];
  const cityData = cityOrder.map((city) => {
    const rows = analyticsRows.filter((row) => row.city === city);
    const avgRate = getWeightedHourlyRate(rows);
    return { city, avgRate, count: rows.length };
  });

  const typeData = Object.values(
    analyticsRowsByTypeChart.reduce((acc, row) => {
      if (!acc[row.type]) acc[row.type] = { type: row.type, totalNet: 0, totalHours: 0, count: 0 };
      acc[row.type].totalNet += Number(row.gesamt) || 0;
      acc[row.type].totalHours += Number(row.stunden) || 0;
      acc[row.type].count += 1;
      return acc;
    }, {})
  )
    .map((item) => ({
      ...item,
      avgRate: item.totalHours > 0 ? item.totalNet / item.totalHours : 0
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
    analyticsRowsByTypeChart.reduce((acc, row) => {
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

  const settingsCompanyLatNum = parseCoordinateInput(settingsCompanyLat);
  const settingsCompanyLngNum = parseCoordinateInput(settingsCompanyLng);
  const hasCompanyCoordinates = Number.isFinite(settingsCompanyLatNum) && Number.isFinite(settingsCompanyLngNum);

  const analyticsGeoRows = analyticsRows
    .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng))
    .map((row) => {
      const distanceKm = hasCompanyCoordinates
        ? calculateDistanceKm(row.lat, row.lng, settingsCompanyLatNum, settingsCompanyLngNum)
        : null;
      return {
        ...row,
        distanceKm: Number.isFinite(distanceKm) ? distanceKm : null
      };
    });

  const heatmapGeoPoints = analyticsGeoRows.map((row) => {
    const normalizedRate = Math.max(
      0,
      Math.min(1, (row.hourlyRate - MIN_HOURLY_RATE) / Math.max(0.0001, (VERY_GOOD_HOURLY_RATE + 10 - MIN_HOURLY_RATE)))
    );
    // Reduce low-value dominance and keep high hourly rates visibly green when zooming out.
    const intensity = 0.05 + (Math.pow(normalizedRate, 1.25) * 0.95);

    return {
      id: row.id,
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      hourlyRate: row.hourlyRate,
      status: row.status,
      type: row.type,
      city: row.city,
      distanceKm: row.distanceKm,
      intensity,
      baseRow: row
    };
  });

  const geoRasterCells = (() => {
    if (heatmapGeoPoints.length === 0) return [];

    const refLat = hasCompanyCoordinates ? settingsCompanyLatNum : heatmapGeoPoints[0].lat;
    const latDenominator = 111.32;
    const lngDenominator = Math.max(1, 111.32 * Math.cos(toRadians(refLat || 0)));
    const latStep = Math.max(0.0005, settingsGeoCellSizeKm / latDenominator);
    const lngStep = Math.max(0.0005, settingsGeoCellSizeKm / lngDenominator);

    const minLat = Math.min(...heatmapGeoPoints.map((point) => point.lat));
    const minLng = Math.min(...heatmapGeoPoints.map((point) => point.lng));
    const originLat = Math.floor(minLat / latStep) * latStep;
    const originLng = Math.floor(minLng / lngStep) * lngStep;

    const buckets = new Map();

    heatmapGeoPoints.forEach((point) => {
      const row = Math.floor((point.lat - originLat) / latStep);
      const col = Math.floor((point.lng - originLng) / lngStep);
      const key = `${row}|${col}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          row,
          col,
          count: 0,
          totalNet: 0,
          totalHours: 0,
          minRate: Infinity,
          maxRate: -Infinity,
          rows: []
        });
      }

      const bucket = buckets.get(key);
      bucket.count += 1;
      bucket.totalNet += Number(point.baseRow?.gesamt) || 0;
      bucket.totalHours += Number(point.baseRow?.stunden) || 0;
      bucket.minRate = Math.min(bucket.minRate, point.hourlyRate);
      bucket.maxRate = Math.max(bucket.maxRate, point.hourlyRate);
      bucket.rows.push(point.baseRow);
    });

    return Array.from(buckets.values()).map((bucket) => {
      const south = originLat + bucket.row * latStep;
      const north = south + latStep;
      const west = originLng + bucket.col * lngStep;
      const east = west + lngStep;
      const avgRate = bucket.totalHours > 0 ? bucket.totalNet / bucket.totalHours : 0;

      return {
        ...bucket,
        avgRate,
        bounds: [[south, west], [north, east]]
      };
    });
  })();

  const geoRasterCellMaxCount = Math.max(1, ...geoRasterCells.map((cell) => cell.count));

  const geoRowsWithDistance = analyticsGeoRows.filter((row) => Number.isFinite(row.distanceKm));

  const distanceCorrelation = (() => {
    if (geoRowsWithDistance.length < 3) return null;

    const distances = geoRowsWithDistance.map((row) => row.distanceKm);
    const rates = geoRowsWithDistance.map((row) => row.hourlyRate);
    const meanX = distances.reduce((sum, value) => sum + value, 0) / distances.length;
    const meanY = rates.reduce((sum, value) => sum + value, 0) / rates.length;

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < distances.length; i += 1) {
      const dx = distances[i] - meanX;
      const dy = rates[i] - meanY;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }

    const denominator = Math.sqrt(denomX * denomY);
    if (denominator <= 0) return null;
    return numerator / denominator;
  })();

  const distanceCorrelationInterpretation = (() => {
    if (distanceCorrelation === null) {
      return {
        label: 'Nicht auswertbar',
        detail: 'Zu wenig Datenpunkte für eine robuste Aussage (mind. 3 nötig).',
        toneColor: '#94a3b8'
      };
    }

    const absR = Math.abs(distanceCorrelation);
    const direction = distanceCorrelation > 0 ? 'positiv' : distanceCorrelation < 0 ? 'negativ' : 'neutral';

    let strength = 'sehr schwach';
    if (absR >= 0.7) strength = 'stark';
    else if (absR >= 0.5) strength = 'moderat';
    else if (absR >= 0.3) strength = 'schwach bis moderat';
    else if (absR >= 0.1) strength = 'schwach';

    let detail = 'Mit zunehmender Entfernung bleibt der Stundenlohn tendenziell ähnlich.';
    let toneColor = '#cbd5e1';

    if (direction === 'positiv') {
      detail = 'Mit zunehmender Entfernung steigt der Stundenlohn tendenziell.';
      toneColor = '#f87171';
    } else if (direction === 'negativ') {
      detail = 'Mit zunehmender Entfernung sinkt der Stundenlohn tendenziell.';
      toneColor = '#22c55e';
    }

    return {
      label: `${strength} ${direction}`,
      detail,
      toneColor
    };
  })();

  const distanceBands = [
    { key: '0-5', label: '0 bis 5 km', min: 0, max: 5 },
    { key: '5-15', label: '5 bis 15 km', min: 5, max: 15 },
    { key: '15-30', label: '15 bis 30 km', min: 15, max: 30 },
    { key: '30+', label: '30+ km', min: 30, max: Infinity }
  ].map((band) => {
    const rows = geoRowsWithDistance.filter((row) => row.distanceKm >= band.min && row.distanceKm < band.max);
    const avgRate = getWeightedHourlyRate(rows);
    return {
      ...band,
      count: rows.length,
      avgRate
    };
  });

  const geoMapCenter = hasCompanyCoordinates
    ? [settingsCompanyLatNum, settingsCompanyLngNum]
    : [51.15, 8.2];

  const geoMapBoundsKey = `${settingsTypeFilter}|${settingsDateFromISO}|${settingsDateToISO}|${settingsCompanyLat}|${settingsCompanyLng}|${heatmapGeoPoints.length}`;

  const openChartDetail = (title, rows) => {
    setChartDetailTitle(title);
    setChartDetailRows(Array.isArray(rows) ? rows : []);
    setChartDetailSearch("");
    setChartDetailStatusFilter("Alle");
    setChartDetailTypeFilter("Alle");
    setChartDetailDateFrom("");
    setChartDetailDateTo("");
    setChartDetailSortKey("createdDate");
    setChartDetailSortDir("desc");
    setChartDetailOpen(true);
  };

  const toggleChartDetailSort = (key) => {
    if (chartDetailSortKey === key) {
      setChartDetailSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setChartDetailSortKey(key);
    setChartDetailSortDir(key === "hourlyRate" || key === "stunden" || key === "createdDate" ? "desc" : "asc");
  };

  const chartDetailDateFromISO = normalizeDateFilterInputToISO(chartDetailDateFrom);
  const chartDetailDateToISO = normalizeDateFilterInputToISO(chartDetailDateTo);
  const chartDetailSearchNeedle = chartDetailSearch.trim().toLowerCase();

  const chartDetailStatusOptions = ["Alle", ...Array.from(new Set(chartDetailRows.map((row) => row.status).filter(Boolean)))];
  const chartDetailTypeOptions = ["Alle", ...Array.from(new Set(chartDetailRows.map((row) => row.type).filter(Boolean)))];

  const chartDetailFilteredRows = chartDetailRows
    .filter((row) => chartDetailStatusFilter === "Alle" || row.status === chartDetailStatusFilter)
    .filter((row) => chartDetailTypeFilter === "Alle" || row.type === chartDetailTypeFilter)
    .filter((row) => !chartDetailDateFromISO || (row.createdDate && row.createdDate >= chartDetailDateFromISO))
    .filter((row) => !chartDetailDateToISO || (row.createdDate && row.createdDate <= chartDetailDateToISO))
    .filter((row) => {
      if (!chartDetailSearchNeedle) return true;
      const haystack = [
        row.name,
        row.status,
        row.type,
        row.city,
        row.abHsw,
        row.abMueller,
        row.createdDate
      ].map((value) => String(value || "").toLowerCase()).join(" ");
      return haystack.includes(chartDetailSearchNeedle);
    })
    .sort((a, b) => {
      const direction = chartDetailSortDir === "asc" ? 1 : -1;

      if (chartDetailSortKey === "createdDate") {
        const aMs = a.createdAt ? a.createdAt.getTime() : 0;
        const bMs = b.createdAt ? b.createdAt.getTime() : 0;
        return (aMs - bMs) * direction;
      }

      if (chartDetailSortKey === "hourlyRate" || chartDetailSortKey === "stunden") {
        const aNum = Number(a[chartDetailSortKey] || 0);
        const bNum = Number(b[chartDetailSortKey] || 0);
        return (aNum - bNum) * direction;
      }

      const aText = String(a[chartDetailSortKey] || "").toLowerCase();
      const bText = String(b[chartDetailSortKey] || "").toLowerCase();
      return aText.localeCompare(bText, 'de') * direction;
    });

  const openProjectFromChartRow = (row) => {
    if (!row?.id) return;
    const project = projects.find((item) => item.id === row.id);
    if (!project) return;
    setChartDetailOpen(false);
    setSettingsOpen(false);
    openProject(project);
  };

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
        minHeight: 0,
        overflow: 'visible',
        position: 'relative'
      }}>
        
        {/* --- 1. STATISCHER HEADER (Bleibt immer oben) --- */}
        <div className="sidebar-header-static" style={{ 
          padding: '5px', 
          flexShrink: 0, 
          borderBottom: '1px solid #eee',
          backgroundColor: '#fff',
          zIndex: 100,
          position: 'relative',
          overflow: 'visible'
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

          {/* Filter mit Mehrfachauswahl und Checkmarks */}
          <div className="filter-multi-row">
            <div className="filter-multi" ref={statusFilterRef}>
              <label className="filter-multi-label">Status</label>
              <button
                type="button"
                onClick={() => setStatusFilterOpen((prev) => !prev)}
                className="filter-multi-toggle"
              >
                <span className="filter-multi-toggle-text">{getMultiFilterSummary(selectedStatusFilters, STATUS_FILTER_OPTIONS)}</span>
                <span className="filter-multi-arrow">▾</span>
              </button>
              {statusFilterOpen && (
                <div className="filter-multi-menu">
                  {STATUS_FILTER_OPTIONS.map((option) => {
                    const checked = selectedStatusFilters.includes(option.value);
                    return (
                      <label
                        key={option.value}
                        className="filter-multi-option"
                        onDoubleClick={() => keepOnlyOneStatusFilter(option.value)}
                      >
                        <input
                          type="checkbox"
                          className="filter-multi-checkbox"
                          checked={checked}
                          onChange={() => toggleMultiFilterValue(option.value, selectedStatusFilters, setSelectedStatusFilters)}
                        />
                        <span className="filter-multi-option-text">{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="filter-multi" ref={typeFilterRef}>
              <label className="filter-multi-label">Typ</label>
              <button
                type="button"
                onClick={() => setTypeFilterOpen((prev) => !prev)}
                className="filter-multi-toggle"
              >
                <span className="filter-multi-toggle-text">{getMultiFilterSummary(selectedTypeFilters, TYPE_FILTER_OPTIONS)}</span>
                <span className="filter-multi-arrow">▾</span>
              </button>
              {typeFilterOpen && (
                <div className="filter-multi-menu">
                  {TYPE_FILTER_OPTIONS.map((option) => {
                    const checked = selectedTypeFilters.includes(option.value);
                    return (
                      <label
                        key={option.value}
                        className="filter-multi-option"
                        onDoubleClick={() => keepOnlyOneTypeFilter(option.value)}
                      >
                        <input
                          type="checkbox"
                          className="filter-multi-checkbox"
                          checked={checked}
                          onChange={() => toggleMultiFilterValue(option.value, selectedTypeFilters, setSelectedTypeFilters)}
                        />
                        <span className="filter-multi-option-text">{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
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
          padding: '5px',
          minHeight: 0,
          position: 'relative',
          zIndex: 1
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

        const compressedFiles = await compressFilesForUpload(rawFiles);
        const filesForQueue = [...compressedFiles];

        try {
          setToast(`⏳ Upload läuft...`);

          const formData = new FormData();
          compressedFiles.forEach((file) => {
            formData.append('files+', file);
          });

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
            
            await saveToOfflineQueue(p.id, filesForQueue);
            
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
      const countMontage = form.masten.filter((m) => String(m?.aktion || "") === "Montage").length;
      const countDemontage = form.masten.filter((m) => String(m?.aktion || "") === "Demontage").length;
      const countTausch = form.masten.filter((m) => String(m?.aktion || "") === "Tausch").length;
      const isCurrentProjectKonzept = isKonzeptProjectType(form.type);
      const estimatedFullDays = estimateFullDaysFromActionCounts({
        mastenMontage: countMontage,
        mastenTausch: countTausch,
        mastenDemontage: countDemontage
      });
      const adjustedEstimatedFullDays = isCurrentProjectKonzept ? Math.ceil(estimatedFullDays * dynamicTimeFactor) : 0;
      const estimatedDurationLabel = isCurrentProjectKonzept ? formatWorkDaysLabel(adjustedEstimatedFullDays) : "-";
      const baseEstimatedDurationLabel = formatWorkDaysLabel(estimatedFullDays);
      const actualWorkDaysValue = form.aufmass?.allgemein?.tatsaechlicheWerktage || "";
      const calibrationSampleCount = historicalTimeCalibration.sampleCount;
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
            {isCurrentProjectKonzept && (
              <div className="stat-card stat-time" title="Berechnet aus Montage 1,8/Tag, Tausch 1,2/Tag, Demontage 3,7/Tag und mit Ist-Werktagen vergangener Konzept-Baustellen dynamisch korrigiert">
                <span className="stat-value" style={{color: '#fbbf24'}}>{estimatedDurationLabel}</span>
                <span className="stat-label">Zeitbedarf</span>
              </div>
            )}
          </div>

          {isCurrentProjectKonzept && (
            <div style={{ marginTop: '10px', marginBottom: '14px', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '10px', color: '#cbd5e1' }}>
              <div style={{ display: 'grid', gap: '8px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#f8fafc' }}>Tatsächlich gebraucht (Werktage)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="mast-input-base"
                  style={{ width: '180px' }}
                  placeholder="z.B. 8"
                  value={actualWorkDaysValue}
                  onChange={(e) => updateAufmassAllgemein('tatsaechlicheWerktage', e.target.value)}
                />
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  {`Basis: ${baseEstimatedDurationLabel} | Korrekturfaktor: ${dynamicTimeFactor.toFixed(2)} (${calibrationSampleCount} Konzept-Baustellen mit Ist-Wert)`}
                </div>
              </div>
            </div>
          )}

          {/* --- MASSENANLAGE TOOLBAR --- */}
          <div className="batch-bar" style={{ display: 'flex', gap: '15px', alignItems: 'flex-end', flexWrap: 'wrap', background: '#1e293b', padding: '15px', borderRadius: '8px' }}>
  
  <div className="field-group">
    <span className="field-label" style={{color: '#cbd5e1'}}>Mast Nr. (z.B. 1, 2, 5-8)</span>
    <input type="text" id="batch-ids" defaultValue="" placeholder="1, 2, 5-8" className="mast-input-base" style={{width: '120px'}} />
  </div>

  <div className="field-group">
    <span className="field-label" style={{color: '#cbd5e1'}}>Aktion</span>
    <select id="batch-aktion" className="mast-input-base" style={{width: '110px'}} value={batchAktion} onChange={(e) => setBatchAktion(e.target.value)}>
      <option value="Tausch">Tausch</option>
      <option value="Montage">Montage</option>
      <option value="Demontage">Demontage</option>
      <option value={LK_SIKA_TAUSCH_ACTION}>{LK_SIKA_TAUSCH_ACTION}</option>
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
  {(batchAktion === "Tausch" || batchAktion === "Montage" || batchAktion === LK_SIKA_TAUSCH_ACTION) && (
    <div id="batch-neu-fields" style={{display: 'flex', gap: '10px', flex: 1, minWidth: '200px', flexWrap: 'wrap'}}>
      {batchAktion !== LK_SIKA_TAUSCH_ACTION && (
        <div className="field-group">
          <span className="field-label" style={{color: '#3b82f6'}}>Mast Art Neu</span>
          <select id="batch-masttyp-neu" className="mast-input-base" style={{width: '100px'}}>
            <option value="Gerade">Gerade</option>
            <option value="Gebogen">Gebogen</option>
          </select>
        </div>
      )}
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
      {batchAktion !== LK_SIKA_TAUSCH_ACTION && (
        <div className="field-group">
          <span className="field-label" style={{color: '#3b82f6'}}>LPH Neu</span>
          <input id="batch-lph-neu" defaultValue="6" className="mast-input-base" style={{width: '50px'}} />
        </div>
      )}
      <div className="field-group">
        <span className="field-label" style={{color: '#3b82f6'}}>Lumen</span>
        <input type="number" id="batch-lumen-neu" defaultValue="2600" className="mast-input-base" style={{width: '70px'}} />
      </div>
    </div>
  )}

  <button 
    style={{ background: '#22c55e', color: 'white', border: 'none', borderRadius: '6px', height: '32px', padding: '0 15px', fontWeight: 'bold', cursor: 'pointer', alignSelf: 'flex-end', marginLeft: 'auto' }}
    onClick={() => {
      const batchIdsInput = document.getElementById('batch-ids');
      const rawInput = batchIdsInput?.value || "";

      if (!rawInput.trim()) {
        setAlertToast({ show: true, message: "Bitte Mastnummern eingeben!" });
        return;
      }
      
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

      const existingMastNumbers = new Set(
        (form.masten || [])
          .map((mast) => parseMastLabel(mast?.mastLabel).number)
          .filter((number) => Number.isFinite(number) && number > 0)
      );

      const duplicateMastNumbers = Array.from(new Set(
        mastNumbers.filter((number) => existingMastNumbers.has(number))
      )).sort((a, b) => a - b);

      if (duplicateMastNumbers.length > 0) {
        const duplicateList = duplicateMastNumbers.join(", ");
        const confirmMessage = duplicateMastNumbers.length === 1
          ? `Für Mast ${duplicateList} existiert bereits ein Eintrag. Möchtest du ihn trotzdem hinzufügen? Er wird dann als ${duplicateList}a, ${duplicateList}b usw. angelegt.`
          : `Für die Masten ${duplicateList} existieren bereits Einträge. Möchtest du sie trotzdem hinzufügen? Sie werden dann mit a/b-Suffixen angelegt.`;

        if (!window.confirm(confirmMessage)) {
          return;
        }
      }
      
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
      
      setForm(prev => ({ ...prev, masten: normalizeMastLabels([...(prev.masten || []), ...neueMasten]) }));

      if (batchIdsInput) {
        batchIdsInput.value = "";
      }
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
                const sortA = getMastSortKey(a.mastLabel);
                const sortB = getMastSortKey(b.mastLabel);

                if (sortA.number !== sortB.number) return sortA.number - sortB.number;
                return sortA.suffixIndex - sortB.suffixIndex;
              })
              .map((m, index) => {
                // WICHTIG: Wir suchen den echten Index im Original-Array, 
                // damit updateMast den richtigen Datensatz ändert!
                const originalIndex = findOriginalIndexByMast(form.masten, m);
                
                const displayNum = (() => {
                  const parsed = parseMastLabel(m.mastLabel);
                  if (parsed.number) return `${parsed.number}${parsed.suffix || ""}`;
                  return String(m.mastLabel || "").replace(/^Mast\s*/i, "").trim();
                })();
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
                          <option value={LK_SIKA_TAUSCH_ACTION}>{LK_SIKA_TAUSCH_ACTION}</option>
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
                {(m.aktion === "Tausch" || m.aktion === "Montage" || m.aktion === LK_SIKA_TAUSCH_ACTION) && (
                  <div className="neu-section">
                    <span style={{fontSize: '10px', fontWeight: '800', color: '#2b6cb0', display: 'block', marginBottom: '8px'}}>NEUE INSTALLATION (NEU)</span>
                    <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
                      {m.aktion !== LK_SIKA_TAUSCH_ACTION && (
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
                      )}
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
                      {m.aktion !== LK_SIKA_TAUSCH_ACTION && <div className="field-group">
                <span className="field-label">LPH Neu</span>
                <input 
                  className="mast-input-base" 
                  style={{width: '60px'}} 
                  value={m.lphNeu} 
                  onChange={(e) => updateMast(originalIndex, 'lphNeu', e.target.value)} 
                />
              </div>}
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
  <div className="masten-container aufmass-pane">
    
    {/* 1. ALLGEMEIN SEKTION */}
    <div className="aufmass-allgemein-row">
      <div className="aufmass-inline-field aufmass-inline-field-transport">
        <span className="aufmass-section-title">🚛 Transport:</span>
        <input 
          type="text" 
          inputMode="decimal"
          className="mast-input-base aufmass-input aufmass-input-transport"
          value={form.aufmass?.allgemein?.transport || ""} 
          onChange={(e) => updateAufmassAllgemein('transport', e.target.value)} 
        />
        <span className="aufmass-unit">Std</span>
      </div>

      <div className="aufmass-inline-field aufmass-inline-field-info">
        <span className="aufmass-section-title">📝 Infos:</span>
        <textarea
          rows={1}
          className="mast-input-base aufmass-input aufmass-autogrow"
          placeholder="Anmerkungen zur Baustelle..."
          value={form.aufmass?.allgemein?.extraInfos || ""} 
          onInput={autoResizeTextarea}
          onChange={(e) => {
            autoResizeTextarea(e);
            updateAufmassAllgemein('extraInfos', e.target.value);
          }} 
        />
      </div>

      <label className="ans-toggle" title="Bei Anschluss unter 1m automatisch 1m Graben ANS + 1 St Montagegrube ANS ansetzen">
        <input
          type="checkbox"
          className="ans-toggle-input"
          checked={!!form.aufmass?.allgemein?.ansMindestansatzBeiUnter1m}
          onChange={(e) => updateAufmassAllgemein('ansMindestansatzBeiUnter1m', e.target.checked)}
        />
        <span className="ans-toggle-track" aria-hidden="true">
          <span className="ans-toggle-thumb" />
        </span>
        <span className="ans-toggle-label">ANS Montagegrube unter 1m</span>
      </label>

      <div className="aufmass-date-field">
        <span className="aufmass-section-title">📏 Einmessung weggeschickt:</span>
        <div className="aufmass-date-controls">
          <input
            type="text"
            inputMode="numeric"
            maxLength={10}
            className="mast-input-base aufmass-input aufmass-input-date"
            placeholder="dd.mm.yyyy"
            value={normalizeDateValue(form.aufmass?.allgemein?.einmessungWeggeschicktAm || "")}
            onChange={(e) => updateAufmassAllgemein('einmessungWeggeschicktAm', e.target.value)}
            onBlur={(e) => updateAufmassAllgemein('einmessungWeggeschicktAm', normalizeDateValue(e.target.value))}
          />
          <button
            type="button"
            className="aufmass-mini-btn"
            onClick={() => updateAufmassAllgemein('einmessungWeggeschicktAm', getTodayDateString())}
          >
            Heute
          </button>
        </div>
      </div>

      <div className="aufmass-date-field">
        <span className="aufmass-section-title">📦 Materialbuchung erfolgt:</span>
        <div className="aufmass-date-controls">
          <input
            type="text"
            inputMode="numeric"
            maxLength={10}
            className="mast-input-base aufmass-input aufmass-input-date"
            placeholder="dd.mm.yyyy"
            value={normalizeDateValue(form.aufmass?.allgemein?.materialbuchungErfolgtAm || "")}
            onChange={(e) => updateAufmassAllgemein('materialbuchungErfolgtAm', e.target.value)}
            onBlur={(e) => updateAufmassAllgemein('materialbuchungErfolgtAm', normalizeDateValue(e.target.value))}
          />
          <button
            type="button"
            className="aufmass-mini-btn"
            onClick={() => updateAufmassAllgemein('materialbuchungErfolgtAm', getTodayDateString())}
          >
            Heute
          </button>
        </div>
      </div>

      <div className="aufmass-date-field">
        <span className="aufmass-section-title">🧾 Proforma Rechnung weggeschickt:</span>
        <div className="aufmass-date-controls">
          <input
            type="text"
            inputMode="numeric"
            maxLength={10}
            className="mast-input-base aufmass-input aufmass-input-date"
            placeholder="dd.mm.yyyy"
            value={normalizeDateValue(form.aufmass?.allgemein?.proformaRechnungWeggeschicktAm || "")}
            onChange={(e) => updateAufmassAllgemein('proformaRechnungWeggeschicktAm', e.target.value)}
            onBlur={(e) => updateAufmassAllgemein('proformaRechnungWeggeschicktAm', normalizeDateValue(e.target.value))}
          />
          <button
            type="button"
            className="aufmass-mini-btn"
            onClick={() => updateAufmassAllgemein('proformaRechnungWeggeschicktAm', getTodayDateString())}
          >
            Heute
          </button>
        </div>
      </div>

      <div className="aufmass-head-actions">
      <button 
        className="aufmass-danger-btn"
        onClick={resetAufmassVonMasten}
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
    </div>

    {/* 2. DYNAMISCHE MASTEN-KARTEN */}
    {Array.isArray(form.aufmass?.masten) && form.aufmass.masten.length > 0 ? (
      [...form.aufmass.masten]
        .sort((a, b) => {
          const sortA = getMastSortKey(a.mastLabel);
          const sortB = getMastSortKey(b.mastLabel);

          if (sortA.number !== sortB.number) return sortA.number - sortB.number;
          return sortA.suffixIndex - sortB.suffixIndex;
        })
        .map((m, index) => {
          const originalIndex = findOriginalIndexByMast(form.aufmass.masten, m);
          const displayNum = (() => {
            const parsed = parseMastLabel(m.mastLabel);
            if (parsed.number) return `${parsed.number}${parsed.suffix || ""}`;
            return String(m.mastLabel || "").replace(/^Mast\s*/i, "").trim();
          })();

          return (
            <div key={m.id || `aufmass-mast-${index + 1}`} className="aufmass-mast-card">
              <div className="aufmass-card-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '4px' }}>
                
                <div className="aufmass-badge-container" style={{ flexShrink: 0 }}>
                  <span className="aufmass-badge-label">MAST</span>
                  <div className="aufmass-badge-num">{displayNum || String(index + 1)}</div>
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
                    <option value={LK_SIKA_TAUSCH_ACTION}>{LK_SIKA_TAUSCH_ACTION}</option>
                  </select>
                </div>

                {/* --- REGULÄR: MONTAGE / DEMONTAGE --- */}
                {m.aktion !== "Tausch" && m.aktion !== LK_SIKA_TAUSCH_ACTION && (
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
                              ? calculateArea(m.oberflaecheX, m.oberflaecheY)
                              : 0;
                            const extraTotal = normalizeExtraSurfaces(m.oberflaechenExtra).reduce((sum, entry) => {
                              if (normalizeSurfaceType(entry.typ) === "Grass") return sum;
                              return sum + calculateArea(entry.x, entry.y);
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
                            <div className="aufmass-flex-center" style={{ gap: '1px', flexWrap: 'nowrap', justifyContent: 'flex-end', flexShrink: 1, minWidth: 0 }}>
                              <input type="text" inputMode="decimal" placeholder="X" className="mast-input-base" style={{ width: '26px', minWidth: '26px', padding: '1px', height: '20px', textAlign: 'center', borderRadius: '4px' }} value={m.sondersacheRinnenflussX || ""} onChange={(e) => updateAufmass(originalIndex, 'sondersacheRinnenflussX', e.target.value)} />
                              <span className="aufmass-text-subtle" style={{ fontSize: '10px' }}>×</span>
                              <input type="text" inputMode="decimal" placeholder="Y" className="mast-input-base" style={{ width: '26px', minWidth: '26px', padding: '1px', height: '20px', textAlign: 'center', borderRadius: '4px' }} value={m.sondersacheRinnenflussY || ""} onChange={(e) => updateAufmass(originalIndex, 'sondersacheRinnenflussY', e.target.value)} />
                              <span className="aufmass-text-subtle" style={{ fontSize: '10px' }}>m²</span>
                            </div>
                          </div>
                          <div style={{ marginTop: '2px', textAlign: 'right', fontSize: '10px', color: '#22c55e', fontWeight: 'bold' }}>
                            Gesamtfläche: {calculateArea(m.sondersacheRinnenflussX, m.sondersacheRinnenflussY).toFixed(2)} m²
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
                            <span style={{ color: '#cbd5e1' }}>Muffen mont.:</span>
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
                            <span>Muffen mont. ANS (Stk):</span>
                            <input type="number" className="mast-input-base" style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenMontierenUeber1m || ""} onChange={(e) => updateAufmass(originalIndex, 'muffenMontierenUeber1m', e.target.value)} />
                            <span>Graben ANS (m):</span>
                            <input type="text" inputMode="decimal" className="mast-input-base" style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.grabenTiefeBreite || ""} onChange={(e) => updateAufmass(originalIndex, 'grabenTiefeBreite', e.target.value)} />
                            <span>Graben-Oberfläche ANS:</span>
                            <select className="mast-input-base" style={{ width: '96px', padding: '1px', height: '20px', borderRadius: '4px' }} value={normalizeSurfaceType(m.oberflaecheGraben || "Grass")} onChange={(e) => updateAufmass(originalIndex, 'oberflaecheGraben', normalizeSurfaceType(e.target.value))}>
                              {SURFACE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                            <span>Kabelverlegen ANS (m):</span>
                            <input type="text" inputMode="decimal" className="mast-input-base" style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.grabenKabelverlegen || ""} onChange={(e) => updateAufmass(originalIndex, 'grabenKabelverlegen', e.target.value)} />
                            <span>Montagegrube ANS (Stk):</span>
                            <input type="number" className="mast-input-base" style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.montagegrube || ""} onChange={(e) => updateAufmass(originalIndex, 'montagegrube', e.target.value)} />
                            <span>Endmuffen ANS (Stk):</span>
                            <input type="number" className="mast-input-base" style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.endmuffenAns || ""} onChange={(e) => updateAufmass(originalIndex, 'endmuffenAns', e.target.value)} />
                            <span>Muffen demont. ANS (Stk):</span>
                            <input type="number" className="mast-input-base" style={{ width: '40px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenDemoMontage || ""} onChange={(e) => updateAufmass(originalIndex, 'muffenDemoMontage', e.target.value)} />
                          </div>
                        )}
                        <div style={{ marginTop: '4px', fontSize: '10px', color: '#94a3b8' }}>
                          Für ANS zählt die externe Graben-Oberfläche plus zusätzlich die Oberflächen aus Montage.
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
                          <span>Muffen montieren (Neu-Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenMontierenDemo || ""} onChange={(e) => updateAufmass(originalIndex, 'muffenMontierenDemo', e.target.value)} />
                          <span>Muffen demontieren (Alt-Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenDemo || ""} onChange={(e) => updateAufmass(originalIndex, 'muffenDemo', e.target.value)} />
                        </div>
                      )}

                      {Number(m.netzanschlussDemoAnzahl) > 0 && (
                      <details className="aufmass-position-details aufmass-position-details-demo" style={{ marginTop: '6px' }}>
                        <summary style={{ cursor: 'pointer', fontSize: '11px', color: '#fda4af' }}>📦 Positionen ABR</summary>
                        <div className="aufmass-demo-block" style={{ marginTop: '4px' }}>
                          <span>Graben ABR (m):</span>
                          <input type="text" inputMode="decimal" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.grabenTiefeBreiteDemo || ""} onChange={(e) => updateAufmass(originalIndex, 'grabenTiefeBreiteDemo', e.target.value)} />
                          <span>Kabelverlegen ABR (m):</span>
                          <input type="text" inputMode="decimal" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.grabenKabelverlegenDemo || ""} onChange={(e) => updateAufmass(originalIndex, 'grabenKabelverlegenDemo', e.target.value)} />
                          <span>Montagegrube ABR (Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.montagegrubeDemo || ""} onChange={(e) => updateAufmass(originalIndex, 'montagegrubeDemo', e.target.value)} />
                          <span>Endmuffen ABR (Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.endmuffenDemo || ""} onChange={(e) => updateAufmass(originalIndex, 'endmuffenDemo', e.target.value)} />
                          <span>Graben-Oberfläche:</span>
                          <select className="mast-input-base" style={{ width: '88px', padding: '1px', height: '20px', borderRadius: '4px' }} value={normalizeSurfaceType(m.oberflaecheGrabenDemo || "Grass")} onChange={(e) => updateAufmass(originalIndex, 'oberflaecheGrabenDemo', normalizeSurfaceType(e.target.value))}>
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
                          <span>Muffen montieren (Neu-Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenMontierenTausch || ""} onChange={(e) => updateAufmass(originalIndex, 'muffenMontierenTausch', e.target.value)} />
                          <span>Muffen demontieren (Alt-Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.muffenDemoTausch || ""} onChange={(e) => updateAufmass(originalIndex, 'muffenDemoTausch', e.target.value)} />
                        </div>
                      )}

                      {Number(m.kabelAnAbklemmenAnzahl) > 0 && (
                      <details className="aufmass-position-details aufmass-position-details-tausch" style={{ marginTop: '6px' }}>
                        <summary style={{ cursor: 'pointer', fontSize: '11px', color: '#d8b4fe' }}>📦 Positionen ÄND</summary>
                        <div className="aufmass-tausch-block" style={{ marginTop: '4px' }}>
                          <span>Graben ÄND (m):</span>
                          <input type="text" inputMode="decimal" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.grabenTiefeBreiteTausch || ""} onChange={(e) => updateAufmass(originalIndex, 'grabenTiefeBreiteTausch', e.target.value)} />
                          <span>Kabelverlegen ÄND (m):</span>
                          <input type="text" inputMode="decimal" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.grabenKabelverlegenTausch || ""} onChange={(e) => updateAufmass(originalIndex, 'grabenKabelverlegenTausch', e.target.value)} />
                          <span>Montagegrube ÄND (Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.montagegrubeTausch || ""} onChange={(e) => updateAufmass(originalIndex, 'montagegrubeTausch', e.target.value)} />
                          <span>Endmuffen ÄND (Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.endmuffenTausch || ""} onChange={(e) => updateAufmass(originalIndex, 'endmuffenTausch', e.target.value)} />
                          <span>Graben-Oberfläche:</span>
                          <select className="mast-input-base" style={{ width: '88px', padding: '1px', height: '20px', borderRadius: '4px' }} value={normalizeSurfaceType(m.oberflaecheGrabenTausch || "Grass")} onChange={(e) => updateAufmass(originalIndex, 'oberflaecheGrabenTausch', normalizeSurfaceType(e.target.value))}>
                            {SURFACE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                      </details>
                      )}
                    </>
                  )}

                  {m.aktion === LK_SIKA_TAUSCH_ACTION && (
                    <div className="aufmass-flex-center" style={{ gap: '8px', borderLeft: '1px solid #334155', paddingLeft: '12px', flexShrink: 0 }}>
                      <span style={{ fontSize: '11px', color: '#93c5fd', fontWeight: 700 }}>LK / SiKa Tausch</span>
                    </div>
                  )}

                  {m.aktion === LK_SIKA_TAUSCH_ACTION && (
                    <>
                      <div className="aufmass-row-justify">
                        <span style={{ color: '#38bdf8' }}>LK montieren (Stk):</span>
                        <input type="number" className="mast-input-base" style={{ width: '45px', padding: '2px', height: '22px', borderRadius: '4px' }} placeholder="0" value={m.lkMontieren || ""} onChange={(e) => updateAufmass(originalIndex, 'lkMontieren', e.target.value)} />
                      </div>
                      <div className="aufmass-row-justify">
                        <span style={{ color: '#38bdf8' }}>LK demontieren (Stk):</span>
                        <input type="number" className="mast-input-base" style={{ width: '45px', padding: '2px', height: '22px', borderRadius: '4px' }} placeholder="0" value={m.lkDemontieren || ""} onChange={(e) => updateAufmass(originalIndex, 'lkDemontieren', e.target.value)} />
                      </div>
                      <div className="aufmass-row-justify">
                        <span style={{ color: '#38bdf8' }}>LK tauschen (Stk):</span>
                        <input type="number" className="mast-input-base" style={{ width: '45px', padding: '2px', height: '22px', borderRadius: '4px' }} placeholder="0" value={m.lkTauschen || ""} onChange={(e) => updateAufmass(originalIndex, 'lkTauschen', e.target.value)} />
                      </div>
                      <div className="aufmass-row-justify">
                        <span style={{ color: '#38bdf8' }}>SiKa montieren (Stk):</span>
                        <input type="number" className="mast-input-base" style={{ width: '45px', padding: '2px', height: '22px', borderRadius: '4px' }} placeholder="0" value={m.sikaMontieren || ""} onChange={(e) => updateAufmass(originalIndex, 'sikaMontieren', e.target.value)} />
                      </div>
                      <div className="aufmass-row-justify">
                        <span style={{ color: '#38bdf8' }}>SiKa demontieren (Stk):</span>
                        <input type="number" className="mast-input-base" style={{ width: '45px', padding: '2px', height: '22px', borderRadius: '4px' }} placeholder="0" value={m.sikaDemontieren || ""} onChange={(e) => updateAufmass(originalIndex, 'sikaDemontieren', e.target.value)} />
                      </div>
                      <div className="aufmass-row-justify">
                        <span style={{ color: '#38bdf8' }}>SiKa tauschen (Stk):</span>
                        <input type="number" className="mast-input-base" style={{ width: '45px', padding: '2px', height: '22px', borderRadius: '4px' }} placeholder="0" value={m.sikaTauschen || ""} onChange={(e) => updateAufmass(originalIndex, 'sikaTauschen', e.target.value)} />
                      </div>

                      <details className="aufmass-tausch-block" style={{ marginTop: '6px' }}>
                        <summary style={{ cursor: 'pointer', fontSize: '11px', color: '#93c5fd' }}>📦 Untermenü</summary>
                        <div className="aufmass-tausch-block" style={{ marginTop: '4px' }}>
                          <span>Ausleger montieren (Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.auslegerMontieren || ""} onChange={(e) => updateAufmass(originalIndex, 'auslegerMontieren', e.target.value)} />
                          <span>Ausleger demontieren (Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.auslegerDemontieren || ""} onChange={(e) => updateAufmass(originalIndex, 'auslegerDemontieren', e.target.value)} />
                          <span>Ausleger tauschen (Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.auslegerTauschen || ""} onChange={(e) => updateAufmass(originalIndex, 'auslegerTauschen', e.target.value)} />
                          <span>Steckdosenanschluss montieren (Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.steckdosenanschlussMontieren || ""} onChange={(e) => updateAufmass(originalIndex, 'steckdosenanschlussMontieren', e.target.value)} />
                          <span>Steckdosenanschluss demontieren (Stk):</span>
                          <input type="number" className="mast-input-base" style={{ width: '45px', padding: '1px', height: '20px', borderRadius: '4px' }} value={m.steckdosenanschlussDemontieren || ""} onChange={(e) => updateAufmass(originalIndex, 'steckdosenanschlussDemontieren', e.target.value)} />
                        </div>
                      </details>
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
                  <textarea
                    rows={1}
                    className="mast-input-base aufmass-autogrow"
                    style={{ padding: '2px 6px', borderRadius: '4px', width: '100%' }}
                    placeholder="Besonderheiten eintragen..."
                    onInput={autoResizeTextarea}
                    value={m.aufmassNotiz || ""} 
                    onChange={(e) => {
                      autoResizeTextarea(e);
                      updateAufmass(originalIndex, 'aufmassNotiz', e.target.value);
                    }}
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
        <div>
          <span style={{ color: '#cbd5e1', fontSize: '11px', display: 'block', marginBottom: '4px' }}>Sub-/Fremdkosten</span>
          <input
            type="text"
            inputMode="decimal"
            className="mast-input-base"
            value={nachkalkulation.subKosten || ''}
            onChange={(e) => updateNachkalkulation('subKosten', e.target.value)}
            placeholder="z. B. 1800"
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
        <div style={{ background: '#111827', border: '1px solid #334155', borderRadius: '6px', padding: '8px' }}>
          <div style={{ color: '#94a3b8', fontSize: '11px' }}>Kombinierte Gesamtsumme (brutto)</div>
          <strong style={{ color: '#e2e8f0', fontSize: '14px' }}>{formatEuro(nachkalkGesamtBrutto)}</strong>
        </div>
        <div style={{ background: '#111827', border: '1px solid #334155', borderRadius: '6px', padding: '8px' }}>
          <div style={{ color: '#94a3b8', fontSize: '11px' }}>Gesamtsumme nach Subkosten (netto)</div>
          <strong style={{ color: '#e2e8f0', fontSize: '14px' }}>{formatEuro(nachkalkGesamt)}</strong>
        </div>
        <div style={{ background: '#111827', border: '1px solid #334155', borderRadius: '6px', padding: '8px' }}>
          <div style={{ color: '#94a3b8', fontSize: '11px' }}>Dein Stundenlohn (netto / Stunden)</div>
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
        <span>Differenz Netto-Gesamtsumme zu Minimum: <strong style={{ color: gesamtDiffToMin >= 0 ? '#4ade80' : '#f87171' }}>{gesamtDiffToMin >= 0 ? '+' : ''}{formatEuro(gesamtDiffToMin)}</strong></span>
        <span>Differenz Netto-Gesamtsumme zu Maximum: <strong style={{ color: gesamtDiffToMax >= 0 ? '#4ade80' : '#f87171' }}>{gesamtDiffToMax >= 0 ? '+' : ''}{formatEuro(gesamtDiffToMax)}</strong></span>
      </div>

    </div>
  </div>
)}

{activeTab === 'Abrechnung' && (
  <div style={{ color: '#e2e8f0', padding: '15px', fontSize: '14px' }}>
    <h2 style={{ marginBottom: '15px', color: '#38bdf8' }}>Abrechnungs-Details</h2>

    {/* ABRECHNUNGSPOSITIONEN */}
    {(() => {
      const num = (val) => Number(String(val || '').replace(',', '.')) || 0;
      const getBillableOverage = (rawValue, includedCount) => {
        const value = num(rawValue);
        return value > includedCount ? value - includedCount : 0;
      };

      const createLkSikaBuckets = () => LK_SIKA_HSW_FIELDS.reduce((acc, field) => {
        acc[field.key] = { title: field.title, total: 0, items: [] };
        return acc;
      }, {});

      const createMastLvBuckets = () => MAST_LV_POSITION_DEFS.reduce((acc, def) => {
        acc[def.key] = { title: def.title, total: 0, items: [] };
        return acc;
      }, {});

      const buildData = () => ({
        surfaces: {},
        linear: {},
        stoerungseinsatzGefahrImVerzug: { title: "Störungseinsatz Gefahr im Verzug", total: 0, items: [] },
        mitarbeiterUndGeraete: { title: "Mitarbeiter und Geräte", total: 0, items: [] },
        kabel: { title: "Kabel An-/Abklemmen (Stk)", total: 0, items: [] },
        muffenMontierenUeber1m: { title: "Muffen montieren ANS(Stk)", total: 0, items: [] },
        muffenMontierenTausch: { title: "Muffen montieren ÄND(Stk)", total: 0, items: [] },
        muffenMontierenDemo: { title: "Muffen montieren ABR(Stk)", total: 0, items: [] },
        muffenDemoMontage: { title: "Muffen demontieren ANS(Stk)", total: 0, items: [] },
        muffenDemo: { title: "Muffen demontieren ABR(Stk)", total: 0, items: [] },
        muffenDemoTausch: { title: "Muffen demontieren ÄND(Stk)", total: 0, items: [] },
        endmuffenAns: { title: "Endmuffen ANS (Stk)", total: 0, items: [] },
        endmuffenAend: { title: "Endmuffen ÄND (Stk)", total: 0, items: [] },
        endmuffenAbr: { title: "Endmuffen ABR (Stk)", total: 0, items: [] },
        netzAns: { title: "Netzanschluss montieren ANS", total: 0, items: [] },
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
        transport: { title: "Transport (Std)", total: 0, items: [] },
        mastLv: createMastLvBuckets(),
        ...createLkSikaBuckets()
      });

      const dataHsw = buildData();
      const dataMueller = buildData();
      const ansMindestansatzBeiUnter1mAktiv = !!form.aufmass?.allgemein?.ansMindestansatzBeiUnter1m;

      if (normalizeProjectType(form.type) === "anfahrschaden") {
        dataHsw.stoerungseinsatzGefahrImVerzug.total = 1;
        dataHsw.stoerungseinsatzGefahrImVerzug.items.push({ label: form.name || "Projekt", val: 1 });
        dataHsw.mitarbeiterUndGeraete.total = 1;
        dataHsw.mitarbeiterUndGeraete.items.push({ label: form.name || "Projekt", val: 1 });
      }

      if (form.aufmass?.masten) {
        form.aufmass.masten.forEach((m, mastIdx) => {
          // WICHTIG: Hier nutzen wir das Label aus dem Formular statt des Index
          const mastLabel = m.mastLabel || "Mast ?";

          const addMastLvPosition = (targetData, input, entryLabel) => {
            const lvKey = getMastLvPositionKey(input);
            if (!lvKey) return;
            const bucket = targetData.mastLv?.[lvKey];
            if (!bucket) return;
            bucket.total += 1;
            bucket.items.push({ label: entryLabel, val: 1 });
          };

          if (m.aktion === 'Montage') {
            addMastLvPosition(
              dataHsw,
              {
                action: 'Montage',
                foundationType: m.montageTyp,
                mastType: m.mastTypNeu,
                heightValue: m.lichtpunkthoehe
              },
              mastLabel
            );
          } else if (m.aktion === 'Demontage') {
            addMastLvPosition(
              dataHsw,
              {
                action: 'Demontage',
                foundationType: m.demontageTyp,
                mastType: m.mastTypAlt,
                heightValue: m.lichtpunkthoehe
              },
              mastLabel
            );
          } else if (m.aktion === 'Tausch') {
            addMastLvPosition(
              dataHsw,
              {
                action: 'Demontage',
                foundationType: m.tauschDemoTyp,
                mastType: m.mastTypAlt,
                heightValue: m.lphAlt
              },
              `${mastLabel} (Alt)`
            );
            addMastLvPosition(
              dataHsw,
              {
                action: 'Montage',
                foundationType: m.tauschMontageTyp,
                mastType: m.mastTypNeu,
                heightValue: m.lphNeu
              },
              `${mastLabel} (Neu)`
            );
          }

          // --- 1. HSW POSITIONEN ---
          const mastSurfaces = [
            { typ: normalizeSurfaceType(m.oberflaeche || "Grass"), x: m.oberflaecheX, y: m.oberflaecheY },
            ...normalizeExtraSurfaces(m.oberflaechenExtra)
          ];

          mastSurfaces.forEach((entry, idx) => {
            if (normalizeSurfaceType(entry.typ) === "Grass") return;
            const xVal = num(entry.x);
            const yVal = num(entry.y);
            const flaeche = xVal * yVal;
            if (flaeche <= 0) return;

            const name = getSurfaceLabel(entry.typ);
            if (!dataHsw.surfaces[name]) dataHsw.surfaces[name] = { title: `${name} (m²)`, total: 0, items: [] };
            dataHsw.surfaces[name].total += flaeche;
            dataHsw.surfaces[name].items.push({
              label: idx === 0 ? mastLabel : `${mastLabel} (extra)`,
              val: flaeche,
              x: xVal,
              y: yVal,
              area: flaeche
            });
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
              if (s.key === 'sondersacheRinnenfluss') {
                dataHsw.linear[s.key].items.push({
                  label: mastLabel,
                  val,
                  x: num(m.sondersacheRinnenflussX),
                  y: num(m.sondersacheRinnenflussY),
                  area: val
                });
              } else {
                dataHsw.linear[s.key].items.push({ label: mastLabel, val: val });
              }
            }
          });

          if (num(m.handarbeitStd) > 0) {
            dataHsw.handarbeitStd.total += num(m.handarbeitStd);
            dataHsw.handarbeitStd.items.push({ label: mastLabel, val: num(m.handarbeitStd) });
          }

          LK_SIKA_HSW_FIELDS.forEach((field) => {
            const val = num(m[field.key]);
            if (val <= 0) return;
            dataHsw[field.key].total += val;
            dataHsw[field.key].items.push({ label: mastLabel, val });
          });

          // --- 2. MÜLLER POSITIONEN ---
          const ensureMuellerSurfaceCategory = (surfaceType, labelSuffix) => {
            const normalized = normalizeSurfaceType(surfaceType);
            if (normalized === "Grass") return null;
            const catGrabenName = `Graben ${getSurfaceLabel(normalized)}${labelSuffix ? ` ${labelSuffix}` : ""}`;
            if (!dataMueller.surfaces[catGrabenName]) {
              dataMueller.surfaces[catGrabenName] = { title: `${catGrabenName} (m²)`, total: 0, items: [] };
            }
            return catGrabenName;
          };

          const addMuellerSurface = (surfaceType, xVal, yVal, labelSuffix, detailLabel = "") => {
            const width = num(xVal);
            const height = num(yVal);
            const area = width * height;
            if (area <= 0) return;
            const catGrabenName = ensureMuellerSurfaceCategory(surfaceType, labelSuffix);
            if (!catGrabenName) return;
            dataMueller.surfaces[catGrabenName].total += area;
            dataMueller.surfaces[catGrabenName].items.push({
              label: detailLabel ? `${mastLabel} (${detailLabel})` : mastLabel,
              val: area,
              x: width,
              y: height,
              area
            });
          };

          const netzanschlussBis1mCount = num(m.netzanschlussBis1m);
          const ansMindestEinheiten = ansMindestansatzBeiUnter1mAktiv ? netzanschlussBis1mCount : 0;

          const laengeGrabenAns = num(m.grabenTiefeBreite) + ansMindestEinheiten;
          const laengeGrabenAend = num(m.grabenTiefeBreiteTausch);
          const laengeGrabenAbr = num(m.grabenTiefeBreiteDemo);
          const countGrubenAns = num(m.montagegrube) + ansMindestEinheiten;

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

            const shouldAddMontageSurfacesToAns = isMontageRelatedAction(m.aktion);

          if (laengeGrabenAns > 0 && countGrubenAns > 0) {
            // Externe Graben-Oberfläche bleibt erhalten.
            addMuellerSurface(m.oberflaecheGraben || "Grass", laengeGrabenAns, 0.5, "(ANS)", "Graben");

            // Oberflächen von Montage kommen zusaetzlich mit ihrer realen Fläche (X*Y) dazu.
            if (shouldAddMontageSurfacesToAns) {
              Object.entries(mergedLampAreasByType).forEach(([surfaceType, area]) => {
                const numericArea = Number(area) || 0;
                if (numericArea > 0) {
                  // Fuer aggregierte Montageflaechen liegt nur die fertige m²-Summe vor.
                  addMuellerSurface(surfaceType, numericArea, 1, "(ANS)");
                }
              });
            }
          } else if (shouldAddMontageSurfacesToAns && countGrubenAns > 0) {
            // Ohne Graben: Montage-Oberflächen trotzdem mit realer Fläche ausweisen.
            // Falls keine messbare Fläche hinterlegt ist, Position mit 0 sichtbar halten.
            const surfaceEntries = Object.entries(mergedLampAreasByType);
            const hasPositiveArea = surfaceEntries.some(([, area]) => (Number(area) || 0) > 0);

            surfaceEntries.forEach(([surfaceType, area]) => {
              const numericArea = Number(area) || 0;
              if (numericArea > 0) {
                addMuellerSurface(surfaceType, numericArea, 1, "(ANS)");
                return;
              }

              if (!hasPositiveArea) {
                const catName = ensureMuellerSurfaceCategory(surfaceType, "(ANS)");
                if (!catName) return;
                dataMueller.surfaces[catName].items.push({ label: mastLabel, val: 0, x: 0, y: 0, area: 0 });
              }
            });
          }

          if (laengeGrabenAend > 0) {
            addMuellerSurface(m.oberflaecheGrabenTausch || "Grass", laengeGrabenAend, 0.5, "(ÄND)", "Graben");
          }

          if (laengeGrabenAbr > 0) {
            addMuellerSurface(m.oberflaecheGrabenDemo || "Grass", laengeGrabenAbr, 0.5, "(ABR)", "Graben");
          }

          const countGrubenAend = num(m.montagegrubeTausch);
          const countGrubenAbr = num(m.montagegrubeDemo);

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
          const netzanschlussAnsTotal = num(m.netzanschlussBis1m) + num(m.netzanschlussUeber1m);
          if (netzanschlussAnsTotal > 0) {
            dataMueller.netzAns.total += netzanschlussAnsTotal;
            dataMueller.netzAns.items.push({ label: mastLabel, val: netzanschlussAnsTotal });
          }
          if (num(m.kabelAnAbklemmenAnzahl) > 0) { dataMueller.kabel.total += num(m.kabelAnAbklemmenAnzahl); dataMueller.kabel.items.push({ label: mastLabel, val: num(m.kabelAnAbklemmenAnzahl) }); }
          if (num(m.netzanschlussDemoAnzahl) > 0) { dataMueller.netzDemo.total += num(m.netzanschlussDemoAnzahl); dataMueller.netzDemo.items.push({ label: mastLabel, val: num(m.netzanschlussDemoAnzahl) }); }
          const muffenMontierenAnsAbrechenbar = getBillableOverage(m.muffenMontierenUeber1m, 2);
          if (muffenMontierenAnsAbrechenbar > 0) {
            dataMueller.muffenMontierenUeber1m.total += muffenMontierenAnsAbrechenbar;
            dataMueller.muffenMontierenUeber1m.items.push({ label: mastLabel, val: muffenMontierenAnsAbrechenbar });
          }
          if (num(m.muffenMontierenTausch) > 0) { dataMueller.muffenMontierenTausch.total += num(m.muffenMontierenTausch); dataMueller.muffenMontierenTausch.items.push({ label: mastLabel, val: num(m.muffenMontierenTausch) }); }
          const muffenMontierenAbrAbrechenbar = getBillableOverage(m.muffenMontierenDemo, 1);
          if (muffenMontierenAbrAbrechenbar > 0) {
            dataMueller.muffenMontierenDemo.total += muffenMontierenAbrAbrechenbar;
            dataMueller.muffenMontierenDemo.items.push({ label: mastLabel, val: muffenMontierenAbrAbrechenbar });
          }
          if (num(m.muffenDemoMontage) > 0) { dataMueller.muffenDemoMontage.total += num(m.muffenDemoMontage); dataMueller.muffenDemoMontage.items.push({ label: mastLabel, val: num(m.muffenDemoMontage) }); }
          if (num(m.muffenDemo) > 0) { dataMueller.muffenDemo.total += num(m.muffenDemo); dataMueller.muffenDemo.items.push({ label: mastLabel, val: num(m.muffenDemo) }); }
          if (num(m.muffenDemoTausch) > 0) { dataMueller.muffenDemoTausch.total += num(m.muffenDemoTausch); dataMueller.muffenDemoTausch.items.push({ label: mastLabel, val: num(m.muffenDemoTausch) }); }
          if (num(m.endmuffenAns) > 0) { dataMueller.endmuffenAns.total += num(m.endmuffenAns); dataMueller.endmuffenAns.items.push({ label: mastLabel, val: num(m.endmuffenAns) }); }
          if (num(m.endmuffenTausch) > 0) { dataMueller.endmuffenAend.total += num(m.endmuffenTausch); dataMueller.endmuffenAend.items.push({ label: mastLabel, val: num(m.endmuffenTausch) }); }
          if (num(m.endmuffenDemo) > 0) { dataMueller.endmuffenAbr.total += num(m.endmuffenDemo); dataMueller.endmuffenAbr.items.push({ label: mastLabel, val: num(m.endmuffenDemo) }); }
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
        const formatNumber = (value) => {
          const numeric = Number(value) || 0;
          return numeric.toLocaleString('de-DE', { maximumFractionDigits: 2 });
        };

        const formatItemLine = (item) => {
          if (
            item &&
            Number.isFinite(item.x) &&
            Number.isFinite(item.y) &&
            Number.isFinite(item.area)
          ) {
            return `${item.label}: ${formatNumber(item.x)}m x ${formatNumber(item.y)}m = ${formatNumber(item.area)}m²`;
          }
          return `${item.label}: ${formatNumber(item?.val)}`;
        };

        const getCategoryCopyText = (cat) =>
          (cat.items || [])
            .map((item) => {
              if (
                item &&
                Number.isFinite(item.x) &&
                Number.isFinite(item.y) &&
                Number.isFinite(item.area)
              ) {
                return `${item.label}:\t${formatNumber(item.x)}m x ${formatNumber(item.y)}m = ${formatNumber(item.area)}m²`;
              }

              const title = String(cat?.title || '').toLowerCase();
              let unit = '';
              if (title.includes('(stk)') || title.includes('(st)')) unit = 'St';
              else if (title.includes('(m)')) unit = 'm';
              else if (title.includes('(std)')) unit = 'Std';

              const valueText = formatNumber(item?.val);
              return `${item?.label || ''}\t\t${valueText}${unit ? ` ${unit}` : ''}`.trim();
            })
            .join('\n');

        const copyCategory = async (cat) => {
          try {
            await navigator.clipboard.writeText(getCategoryCopyText(cat));
            setToast(`Kopiert: ${cat.title}`);
            setTimeout(() => setToast(null), 1500);
          } catch {
            setToast('Kopieren fehlgeschlagen');
            setTimeout(() => setToast(null), 2000);
          }
        };

        const list = [
          ...Object.values(dataObj.surfaces),
          ...Object.values(dataObj.linear),
          ...MAST_LV_POSITION_DEFS.flatMap((def) => (dataObj.mastLv?.[def.key]?.total > 0 ? [dataObj.mastLv[def.key]] : [])),
          ...(dataObj.stoerungseinsatzGefahrImVerzug.total > 0 ? [dataObj.stoerungseinsatzGefahrImVerzug] : []),
          ...(dataObj.mitarbeiterUndGeraete.total > 0 ? [dataObj.mitarbeiterUndGeraete] : []),
          ...(dataObj.grabenAns.total > 0 ? [dataObj.grabenAns] : []),
          ...(dataObj.grabenAend.total > 0 ? [dataObj.grabenAend] : []),
          ...(dataObj.grabenAbr.total > 0 ? [dataObj.grabenAbr] : []),
          ...(dataObj.montagegrubeAns.total > 0 ? [dataObj.montagegrubeAns] : []),
          ...(dataObj.montagegrubeAend.total > 0 ? [dataObj.montagegrubeAend] : []),
          ...(dataObj.montagegrubeAbr.total > 0 ? [dataObj.montagegrubeAbr] : []),
          ...(dataObj.kabelverlegenAns.total > 0 ? [dataObj.kabelverlegenAns] : []),
          ...(dataObj.kabelverlegenAend.total > 0 ? [dataObj.kabelverlegenAend] : []),
          ...(dataObj.kabelverlegenAbr.total > 0 ? [dataObj.kabelverlegenAbr] : []),
          ...(dataObj.netzAns.total > 0 ? [dataObj.netzAns] : []),
          ...(dataObj.kabel.total > 0 ? [dataObj.kabel] : []),
          ...(dataObj.muffenMontierenUeber1m.total > 0 ? [dataObj.muffenMontierenUeber1m] : []),
          ...(dataObj.muffenMontierenTausch.total > 0 ? [dataObj.muffenMontierenTausch] : []),
          ...(dataObj.muffenMontierenDemo.total > 0 ? [dataObj.muffenMontierenDemo] : []),
          ...(dataObj.muffenDemoMontage.total > 0 ? [dataObj.muffenDemoMontage] : []),
          ...(dataObj.muffenDemo.total > 0 ? [dataObj.muffenDemo] : []),
          ...(dataObj.muffenDemoTausch.total > 0 ? [dataObj.muffenDemoTausch] : []),
          ...(dataObj.endmuffenAns.total > 0 ? [dataObj.endmuffenAns] : []),
          ...(dataObj.endmuffenAend.total > 0 ? [dataObj.endmuffenAend] : []),
          ...(dataObj.endmuffenAbr.total > 0 ? [dataObj.endmuffenAbr] : []),
          ...(dataObj.handarbeitStd.total > 0 ? [dataObj.handarbeitStd] : []),
          ...(dataObj.netzDemo.total > 0 ? [dataObj.netzDemo] : []),
          ...LK_SIKA_HSW_FIELDS.flatMap((field) => (dataObj[field.key]?.total > 0 ? [dataObj[field.key]] : [])),
          ...(dataObj.transport.total > 0 ? [dataObj.transport] : [])
        ];

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <h3 className="abrechnung-col-title">{title}</h3>
            {list.map((cat, idx) => (
              <details key={`${title}-${idx}`} style={{ background: '#1e293b', padding: '10px', borderRadius: '6px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', color: '#f8fafc' }}>
                  <span>{cat.title}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        copyCategory(cat);
                      }}
                      style={{
                        border: '1px solid #334155',
                        background: '#0f172a',
                        color: '#cbd5e1',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: '2px 6px'
                      }}
                    >
                      Kopieren
                    </button>
                    <span style={{ color: '#38bdf8' }}>{cat.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </span>
                </summary>
                <div style={{ marginTop: '10px', paddingLeft: '10px', borderLeft: '2px solid #38bdf8' }}>
                  {cat.items?.map((item, i) => (
                    <div
                      key={`${title}-${cat.title}-${i}`}
                      style={{
                        padding: '2px 0',
                        color: '#94a3b8',
                        fontSize: '12px',
                        lineHeight: '1.4',
                        fontFamily: 'Consolas, "Courier New", monospace'
                      }}
                    >
                      {formatItemLine(item)}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        );
      };

      const mastNotizen = (form.aufmass?.masten || [])
        .map((m, idx) => {
          const note = String(m?.aufmassNotiz || '').trim();
          if (!note) return null;
          const label = String(m?.mastLabel || `Mast ${idx + 1}`).trim();
          return {
            label: label || `Mast ${idx + 1}`,
            note
          };
        })
        .filter(Boolean);

      const allgemeineInfos = String(form.aufmass?.allgemein?.extraInfos || '').trim();

      return (
        <>
          {(allgemeineInfos || mastNotizen.length > 0) && (
            <div style={{ marginBottom: '12px', background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '10px' }}>
              <h3 style={{ margin: '0 0 8px 0', color: '#67e8f9', fontSize: '14px' }}>Allgemein</h3>

              {allgemeineInfos && (
                <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', padding: '8px', marginBottom: mastNotizen.length > 0 ? '8px' : 0 }}>
                  <div style={{ color: '#93c5fd', fontSize: '12px', fontWeight: 700 }}>Infos zur Baustelle</div>
                  <div style={{ color: '#cbd5e1', fontSize: '12px', marginTop: '2px', whiteSpace: 'pre-wrap' }}>{allgemeineInfos}</div>
                </div>
              )}

              {mastNotizen.length > 0 && (
                <div style={{ display: 'grid', gap: '6px' }}>
                  {mastNotizen.map((entry, idx) => (
                    <div key={`${entry.label}-${idx}`} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', padding: '8px' }}>
                      <div style={{ color: '#93c5fd', fontSize: '12px', fontWeight: 700 }}>{entry.label}</div>
                      <div style={{ color: '#cbd5e1', fontSize: '12px', marginTop: '2px', whiteSpace: 'pre-wrap' }}>{entry.note}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', width: '100%', padding: '10px' }}>
            {renderCol("HSW", dataHsw)}
            {renderCol("Müller", dataMueller)}
          </div>
        </>
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

  const uploadFiles = await compressFilesForUpload(rawFiles);

  // FALL A: Neues Projekt wird gerade erst erstellt (Lokal speichern)
  if (mode === "create") {
    // Hier brauchen wir noch kein Offline-Sync, da das Projekt noch gar nicht in PB existiert
    setTempFiles(prev => [...prev, ...uploadFiles]);
  } 
  
  // FALL B: Bestehendes Projekt aktualisieren (Online-Versuch + Offline-Rettung)
  else {
    if (!selectedProject?.id) return;

    try {
      setToast("⏳ Upload läuft...");

      const formData = new FormData();
      uploadFiles.forEach(file => {
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
        await saveToOfflineQueue(selectedProject.id, uploadFiles);
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
  onClick={async () => {
    if (mode !== "create") {
      try {
        const url = await getProjectFileUrl(selectedProject, f);

        // WICHTIG: Hier "window.desktopAPI" nutzen, statt "window.electron"
        if (window.desktopAPI && window.desktopAPI.send) {
          console.log("Sende an Hauptprozess via desktopAPI...");
          window.desktopAPI.send('open-external-file', url);
        } else {
          console.log("desktopAPI nicht gefunden, nutze Fallback");
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      } catch (err) {
        console.error("Datei konnte nicht geoeffnet werden:", err);
        setToast("❌ Datei konnte nicht geöffnet werden");
        setTimeout(() => setToast(null), 2500);
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
                  Nachkalkulation Excel Export
                </button>
                <button onClick={openOrdersExportPopup} style={{ backgroundColor: '#0f766e', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', fontWeight: 600 }}>
                  Aufträge Excel Export
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
              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8' }}>Firma Lat</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="z. B. 51.3515"
                  value={settingsCompanyLat}
                  onChange={(e) => setSettingsCompanyLat(e.target.value)}
                  className="mast-input-base"
                  style={{ width: '100%', marginTop: '4px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8' }}>Firma Lng</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="z. B. 8.2839"
                  value={settingsCompanyLng}
                  onChange={(e) => setSettingsCompanyLng(e.target.value)}
                  className="mast-input-base"
                  style={{ width: '100%', marginTop: '4px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8' }}>Heatmap Radius</label>
                <input
                  type="number"
                  min={18}
                  max={180}
                  step={1}
                  value={settingsHeatRadius}
                  onChange={(e) => {
                    const nextValue = Number(e.target.value);
                    if (!Number.isFinite(nextValue)) return;
                    setSettingsHeatRadius(Math.min(180, Math.max(18, Math.round(nextValue))));
                  }}
                  className="mast-input-base"
                  style={{ width: '100%', marginTop: '4px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8' }}>Heatmap Blur</label>
                <input
                  type="number"
                  min={10}
                  max={60}
                  step={1}
                  value={settingsHeatBlur}
                  onChange={(e) => {
                    const nextValue = Number(e.target.value);
                    if (!Number.isFinite(nextValue)) return;
                    setSettingsHeatBlur(Math.min(60, Math.max(10, Math.round(nextValue))));
                  }}
                  className="mast-input-base"
                  style={{ width: '100%', marginTop: '4px' }}
                />
              </div>
            </div>

            <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '8px' }}>
              <div style={{ background: '#111827', padding: '8px', borderRadius: '6px', border: '1px solid #334155' }}>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>Gewichteter Stundenlohn (Filter)</div>
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
                { id: 'geo-heatmap', label: 'Heatmap Karte' },
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
                        <div
                          key={item.key}
                          style={{ minWidth: '48px', textAlign: 'center', cursor: 'pointer' }}
                          title="Details anzeigen"
                          onClick={() => {
                            const detailRows = analyticsRows.filter((row) => row.createdDate && row.createdDate.startsWith(item.key));
                            openChartDetail(`Verlauf ${item.key} (${detailRows.length})`, detailRows);
                          }}
                        >
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
                      <div
                        key={item.city}
                        style={{ display: 'grid', gridTemplateColumns: '120px 1fr 150px', gap: '8px', alignItems: 'center', cursor: 'pointer' }}
                        title="Details anzeigen"
                        onClick={() => {
                          const detailRows = analyticsRows.filter((row) => row.city === item.city);
                          openChartDetail(`Stadt ${item.city} (${detailRows.length})`, detailRows);
                        }}
                      >
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
                      <div
                        key={item.type}
                        style={{ display: 'grid', gridTemplateColumns: '160px 1fr 150px', gap: '8px', alignItems: 'center', cursor: 'pointer' }}
                        title="Details anzeigen"
                        onClick={() => {
                          const detailRows = analyticsRowsByTypeChart.filter((row) => row.type === item.type);
                          openChartDetail(`Typ ${item.type} (${detailRows.length})`, detailRows);
                        }}
                      >
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

              {settingsChartView === 'geo-heatmap' && (
                <>
                  <h4 style={{ margin: '0 0 10px 0', color: '#93c5fd' }}>Karten-Heatmap: Stundenlohn und Entfernung zur Firma</h4>

                  <div style={{ marginBottom: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>Darstellung:</span>
                    {[
                      { id: 'heat', label: 'Wärmewolke' },
                      { id: 'raster', label: 'Raster' },
                      { id: 'points', label: 'Punkte' }
                    ].map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => setSettingsGeoOverlayMode(mode.id)}
                        style={{
                          background: settingsGeoOverlayMode === mode.id ? '#0284c7' : '#1e293b',
                          color: 'white',
                          border: '1px solid #334155',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          cursor: 'pointer',
                          fontSize: '11px',
                          fontWeight: 600
                        }}
                      >
                        {mode.label}
                      </button>
                    ))}

                    {settingsGeoOverlayMode === 'raster' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>Rastergröße (km):</span>
                        <input
                          type="number"
                          min={0.1}
                          max={25}
                          step={0.1}
                          value={settingsGeoCellSizeKm}
                          onChange={(e) => {
                            const nextValue = Number(e.target.value);
                            if (!Number.isFinite(nextValue)) return;
                            setSettingsGeoCellSizeKm(Math.min(25, Math.max(0.1, Number(nextValue.toFixed(1)))));
                          }}
                          className="mast-input-base"
                          style={{ width: '88px', marginTop: 0 }}
                        />
                      </div>
                    )}
                  </div>

                  {!hasCompanyCoordinates && (
                    <div style={{ marginBottom: '8px', color: '#fda4af', fontSize: '12px' }}>
                      Bitte gültige Firmen-Koordinaten (Lat/Lng) eintragen, damit die Distanzanalyse berechnet werden kann.
                    </div>
                  )}

                  <div style={{ border: '1px solid #334155', borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>
                    <MapContainer
                      key={geoMapBoundsKey}
                      center={geoMapCenter}
                      zoom={10}
                      style={{ width: '100%', height: '420px', minHeight: '420px', background: '#0b1220' }}
                      scrollWheelZoom={true}
                    >
                      <TileLayer
                        url={osmUrl}
                        attribution="OpenStreetMap"
                      />

                      <SettingsMapStabilizer
                        watchKey={`${geoMapBoundsKey}|${settingsGeoOverlayMode}`}
                        points={heatmapGeoPoints}
                        companyLat={settingsCompanyLatNum}
                        companyLng={settingsCompanyLngNum}
                      />

                      {settingsGeoOverlayMode === 'heat' && (
                        <SettingsHeatmapLayer
                          points={heatmapGeoPoints}
                          radius={settingsHeatRadius}
                          blur={settingsHeatBlur}
                        />
                      )}

                      {hasCompanyCoordinates && (
                        <Marker position={[settingsCompanyLatNum, settingsCompanyLngNum]}>
                          <Popup>
                            Firma<br />
                            Lat: {settingsCompanyLatNum.toFixed(5)}<br />
                            Lng: {settingsCompanyLngNum.toFixed(5)}
                          </Popup>
                        </Marker>
                      )}

                      {(settingsGeoOverlayMode === 'heat' || settingsGeoOverlayMode === 'points') && heatmapGeoPoints.map((point) => {
                        const isHeatMode = settingsGeoOverlayMode === 'heat';
                        return (
                        <CircleMarker
                          key={point.id}
                          center={[point.lat, point.lng]}
                          radius={isHeatMode ? 3 : 5}
                          pathOptions={{
                            color: isHeatMode ? 'rgba(15,23,42,0.28)' : '#0f172a',
                            weight: 1,
                            fillColor: getProfitabilityColor(point.hourlyRate, MIN_HOURLY_RATE, VERY_GOOD_HOURLY_RATE + 10),
                            fillOpacity: isHeatMode ? 0.16 : 0.95
                          }}
                          eventHandlers={{
                            click: () => openChartDetail(`Geo ${point.name}`, [point.baseRow])
                          }}
                        >
                          <Popup>
                            <strong>{point.name}</strong><br />
                            Typ: {point.type}<br />
                            Stadt: {point.city}<br />
                            Stundenlohn: {point.hourlyRate.toFixed(2)} EUR/h<br />
                            {Number.isFinite(point.distanceKm) ? `Entfernung: ${point.distanceKm.toFixed(2)} km` : 'Entfernung: -'}
                          </Popup>
                        </CircleMarker>
                        );
                      })}

                      {settingsGeoOverlayMode === 'raster' && geoRasterCells.map((cell) => {
                        const fillOpacity = Math.min(0.92, 0.24 + (cell.count / geoRasterCellMaxCount) * 0.68);
                        const fillColor = getProfitabilityColor(cell.avgRate, MIN_HOURLY_RATE, VERY_GOOD_HOURLY_RATE + 10);

                        return (
                          <Rectangle
                            key={cell.key}
                            bounds={cell.bounds}
                            pathOptions={{
                              color: '#111827',
                              weight: 0.6,
                              fillColor,
                              fillOpacity
                            }}
                            eventHandlers={{
                              click: () => openChartDetail(`Rasterzelle (${cell.count})`, cell.rows)
                            }}
                          >
                            <Popup>
                              Rasterzelle<br />
                              Gewichteter Stundenlohn: {cell.avgRate.toFixed(2)} EUR/h<br />
                              Baustellen: {cell.count}<br />
                              Min/Max: {cell.minRate.toFixed(2)} / {cell.maxRate.toFixed(2)} EUR/h
                            </Popup>
                          </Rectangle>
                        );
                      })}
                    </MapContainer>

                    {heatmapGeoPoints.length === 0 && (
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(2, 6, 23, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <div style={{ color: '#cbd5e1', fontSize: '13px', background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #334155', borderRadius: '8px', padding: '8px 10px' }}>
                          Keine geokodierten Datensätze im aktuellen Filter.
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '8px' }}>
                    <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', padding: '8px' }}>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>Geokodierte Baustellen</div>
                      <strong style={{ color: '#e2e8f0' }}>{heatmapGeoPoints.length}</strong>
                    </div>
                    <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', padding: '8px' }}>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>Ø Entfernung</div>
                      <strong style={{ color: '#e2e8f0' }}>
                        {geoRowsWithDistance.length > 0
                          ? `${(geoRowsWithDistance.reduce((sum, row) => sum + row.distanceKm, 0) / geoRowsWithDistance.length).toFixed(2)} km`
                          : '-'}
                      </strong>
                    </div>
                    <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', padding: '8px' }}>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>Korrelation Entfernung ↔ Stundenlohn</div>
                      <strong style={{ color: distanceCorrelation === null ? '#e2e8f0' : (distanceCorrelation < 0 ? '#22c55e' : distanceCorrelation > 0 ? '#f87171' : '#e2e8f0') }}>
                        {distanceCorrelation === null ? 'zu wenig Daten' : distanceCorrelation.toFixed(3)}
                      </strong>
                      <div style={{ marginTop: '4px', fontSize: '11px', color: distanceCorrelationInterpretation.toneColor, fontWeight: 700 }}>
                        {distanceCorrelationInterpretation.label}
                      </div>
                      <div style={{ marginTop: '2px', fontSize: '10px', color: '#94a3b8', lineHeight: 1.35 }}>
                        {distanceCorrelationInterpretation.detail} (n={geoRowsWithDistance.length})
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: '8px', display: 'grid', gap: '6px' }}>
                    {distanceBands.map((band) => (
                      <div
                        key={band.key}
                        style={{ display: 'grid', gridTemplateColumns: '180px 1fr 160px', gap: '8px', alignItems: 'center', cursor: band.count > 0 ? 'pointer' : 'default' }}
                        title={band.count > 0 ? 'Details anzeigen' : 'Keine Daten'}
                        onClick={() => {
                          if (band.count === 0) return;
                          const detailRows = geoRowsWithDistance.filter((row) => row.distanceKm >= band.min && row.distanceKm < band.max);
                          openChartDetail(`Distanz ${band.label} (${detailRows.length})`, detailRows);
                        }}
                      >
                        <span style={{ color: '#cbd5e1' }}>{band.label}</span>
                        <div style={{ height: '10px', borderRadius: '999px', background: '#1f2937', overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${Math.min(100, (band.count / Math.max(1, geoRowsWithDistance.length)) * 100)}%`,
                              background: getProfitabilityColor(band.avgRate, MIN_HOURLY_RATE, VERY_GOOD_HOURLY_RATE + 10)
                            }}
                          />
                        </div>
                        <span style={{ textAlign: 'right', color: '#e2e8f0' }}>
                          {band.count} Baust. | {band.count > 0 ? `${band.avgRate.toFixed(2)} EUR/h` : '-'}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: '8px', fontSize: '11px', color: '#94a3b8' }}>
                    Hinweis: Du kannst zwischen Wärmewolke, Raster und Punkten wechseln. Im Wärmewolken-Modus richten sich die Farben nach Stundenlohn (rot = niedriger, gruen = hoeher), Punkte sind dabei bewusst transparent. Klick auf Rasterzelle, Punkt oder Distanzband oeffnet Details.
                  </div>
                </>
              )}

              {settingsChartView === 'distribution' && (
                <>
                  <h4 style={{ margin: '0 0 10px 0', color: '#93c5fd' }}>Rentabilitäts-Verteilung</h4>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {distributionData.map((item) => (
                      <div
                        key={item.label}
                        style={{ display: 'grid', gridTemplateColumns: '170px 1fr 80px', gap: '8px', alignItems: 'center', cursor: 'pointer' }}
                        title="Details anzeigen"
                        onClick={() => {
                          const detailRows = analyticsRows.filter((row) => {
                            if (item.label.startsWith('<')) return row.hourlyRate < MIN_HOURLY_RATE;
                            if (item.label.startsWith('>=')) return row.hourlyRate >= VERY_GOOD_HOURLY_RATE;
                            if (item.label.startsWith(`${MIN_HOURLY_RATE.toFixed(0)}`)) {
                              return row.hourlyRate >= MIN_HOURLY_RATE && row.hourlyRate < NORMAL_HOURLY_RATE;
                            }
                            return row.hourlyRate >= NORMAL_HOURLY_RATE && row.hourlyRate < VERY_GOOD_HOURLY_RATE;
                          });
                          openChartDetail(`Verteilung ${item.label} (${detailRows.length})`, detailRows);
                        }}
                      >
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
                        <div
                          key={item.key}
                          style={{ minWidth: '48px', textAlign: 'center', cursor: 'pointer' }}
                          title="Details anzeigen"
                          onClick={() => {
                            const detailRows = analyticsRowsByTypeChart.filter((row) => row.createdDate && row.createdDate.startsWith(item.key));
                            openChartDetail(`Monat ${item.key} (${detailRows.length})`, detailRows);
                          }}
                        >
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

            {chartDetailOpen && (
              <div
                onClick={() => setChartDetailOpen(false)}
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(2,6,23,0.78)',
                  zIndex: 13100,
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  padding: '16px'
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: 'min(1180px, 98vw)',
                    maxHeight: '92vh',
                    overflow: 'auto',
                    background: '#0b1220',
                    border: '1px solid #1f2a44',
                    borderRadius: '10px',
                    padding: '14px',
                    color: '#e2e8f0'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <h4 style={{ margin: 0, color: '#7dd3fc' }}>{chartDetailTitle || 'Chart-Details'}</h4>
                    <button onClick={() => setChartDetailOpen(false)} style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer' }}>
                      Schließen
                    </button>
                  </div>

                  <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="Freitextsuche (Name, Status, Typ, Stadt, AB, Datum)"
                      value={chartDetailSearch}
                      onChange={(e) => setChartDetailSearch(e.target.value)}
                      className="mast-input-base"
                      style={{ marginTop: 0 }}
                    />
                    <select
                      value={chartDetailStatusFilter}
                      onChange={(e) => setChartDetailStatusFilter(e.target.value)}
                      className="mast-input-base"
                      style={{ marginTop: 0 }}
                    >
                      {chartDetailStatusOptions.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                    <select
                      value={chartDetailTypeFilter}
                      onChange={(e) => setChartDetailTypeFilter(e.target.value)}
                      className="mast-input-base"
                      style={{ marginTop: 0 }}
                    >
                      {chartDetailTypeOptions.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="Von dd.mm.yyyy"
                      value={normalizeDateValue(chartDetailDateFrom)}
                      onChange={(e) => setChartDetailDateFrom(e.target.value)}
                      onBlur={(e) => setChartDetailDateFrom(normalizeDateValue(e.target.value))}
                      className="mast-input-base"
                      style={{ marginTop: 0 }}
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="Bis dd.mm.yyyy"
                      value={normalizeDateValue(chartDetailDateTo)}
                      onChange={(e) => setChartDetailDateTo(e.target.value)}
                      onBlur={(e) => setChartDetailDateTo(normalizeDateValue(e.target.value))}
                      className="mast-input-base"
                      style={{ marginTop: 0 }}
                    />
                  </div>

                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#93c5fd' }}>
                    Treffer: {chartDetailFilteredRows.length} von {chartDetailRows.length}
                  </div>

                  <div style={{ marginTop: '10px', border: '1px solid #334155', borderRadius: '8px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ background: '#111827' }}>
                          <th onClick={() => toggleChartDetailSort('name')} style={{ textAlign: 'left', padding: '8px', color: '#93c5fd', cursor: 'pointer', userSelect: 'none' }}>Name {chartDetailSortKey === 'name' ? (chartDetailSortDir === 'asc' ? '↑' : '↓') : ''}</th>
                          <th onClick={() => toggleChartDetailSort('status')} style={{ textAlign: 'left', padding: '8px', color: '#93c5fd', cursor: 'pointer', userSelect: 'none' }}>Status {chartDetailSortKey === 'status' ? (chartDetailSortDir === 'asc' ? '↑' : '↓') : ''}</th>
                          <th onClick={() => toggleChartDetailSort('type')} style={{ textAlign: 'left', padding: '8px', color: '#93c5fd', cursor: 'pointer', userSelect: 'none' }}>Typ {chartDetailSortKey === 'type' ? (chartDetailSortDir === 'asc' ? '↑' : '↓') : ''}</th>
                          <th onClick={() => toggleChartDetailSort('createdDate')} style={{ textAlign: 'left', padding: '8px', color: '#93c5fd', cursor: 'pointer', userSelect: 'none' }}>Datum {chartDetailSortKey === 'createdDate' ? (chartDetailSortDir === 'asc' ? '↑' : '↓') : ''}</th>
                          <th onClick={() => toggleChartDetailSort('abHsw')} style={{ textAlign: 'left', padding: '8px', color: '#93c5fd', cursor: 'pointer', userSelect: 'none' }}>AB HSW {chartDetailSortKey === 'abHsw' ? (chartDetailSortDir === 'asc' ? '↑' : '↓') : ''}</th>
                          <th onClick={() => toggleChartDetailSort('abMueller')} style={{ textAlign: 'left', padding: '8px', color: '#93c5fd', cursor: 'pointer', userSelect: 'none' }}>AB Müller {chartDetailSortKey === 'abMueller' ? (chartDetailSortDir === 'asc' ? '↑' : '↓') : ''}</th>
                          <th onClick={() => toggleChartDetailSort('stunden')} style={{ textAlign: 'right', padding: '8px', color: '#93c5fd', cursor: 'pointer', userSelect: 'none' }}>Stunden {chartDetailSortKey === 'stunden' ? (chartDetailSortDir === 'asc' ? '↑' : '↓') : ''}</th>
                          <th onClick={() => toggleChartDetailSort('hourlyRate')} style={{ textAlign: 'right', padding: '8px', color: '#93c5fd', cursor: 'pointer', userSelect: 'none' }}>EUR/h {chartDetailSortKey === 'hourlyRate' ? (chartDetailSortDir === 'asc' ? '↑' : '↓') : ''}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chartDetailFilteredRows.map((row, idx) => (
                          <tr
                            key={`${row.id || row.name}-${idx}`}
                            onClick={() => openProjectFromChartRow(row)}
                            style={{
                              borderTop: '1px solid #1f2a44',
                              cursor: 'pointer',
                              background: idx % 2 === 0 ? '#0b1220' : '#0f172a'
                            }}
                            title="Baustelle öffnen"
                          >
                            <td style={{ padding: '8px', color: '#e2e8f0' }}>{row.name || '-'}</td>
                            <td style={{ padding: '8px', color: '#cbd5e1' }}>{row.status || '-'}</td>
                            <td style={{ padding: '8px', color: '#cbd5e1' }}>{row.type || '-'}</td>
                            <td style={{ padding: '8px', color: '#cbd5e1' }}>{row.createdDate ? `${row.createdDate.slice(8, 10)}.${row.createdDate.slice(5, 7)}.${row.createdDate.slice(0, 4)}` : '-'}</td>
                            <td style={{ padding: '8px', color: '#cbd5e1' }}>{row.abHsw || '-'}</td>
                            <td style={{ padding: '8px', color: '#cbd5e1' }}>{row.abMueller || '-'}</td>
                            <td style={{ padding: '8px', textAlign: 'right', color: '#cbd5e1' }}>{Number(row.stunden || 0).toFixed(2)}</td>
                            <td style={{ padding: '8px', textAlign: 'right', color: getProfitabilityColor(row.hourlyRate || 0, MIN_HOURLY_RATE, VERY_GOOD_HOURLY_RATE + 10), fontWeight: 700 }}>{Number(row.hourlyRate || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                        {chartDetailFilteredRows.length === 0 && (
                          <tr>
                            <td colSpan={8} style={{ padding: '14px', color: '#94a3b8', textAlign: 'center' }}>
                              Keine Baustellen für die aktuelle Filterauswahl.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {ordersExportPopupOpen && (
              <div
                onClick={() => setOrdersExportPopupOpen(false)}
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
                    width: 'min(900px, 97vw)',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    background: '#0b1220',
                    border: '1px solid #1f2a44',
                    borderRadius: '10px',
                    padding: '14px',
                    color: '#e2e8f0'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <h4 style={{ margin: 0, color: '#7dd3fc' }}>Aufträge Excel Export</h4>
                    <button onClick={() => setOrdersExportPopupOpen(false)} style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer' }}>
                      Schließen
                    </button>
                  </div>

                  <div style={{ marginTop: '10px', fontSize: '12px', color: '#93c5fd' }}>
                    Filter nach Typ, Zeitraum (Erstellt am) und Status. Danach auswählbare Felder exportieren.
                  </div>

                  <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
                    <div className="filter-multi" ref={ordersExportTypeFilterRef}>
                      <label className="filter-multi-label" style={{ color: '#94a3b8' }}>Typ</label>
                      <button
                        type="button"
                        onClick={() => setOrdersExportTypeFilterOpen((prev) => !prev)}
                        className="filter-multi-toggle filter-multi-toggle-export"
                      >
                        <span className="filter-multi-toggle-text">{getMultiFilterSummary(ordersExportTypeFilter, orderExportTypeOptions)}</span>
                        <span className="filter-multi-arrow">▾</span>
                      </button>
                      {ordersExportTypeFilterOpen && (
                        <div className="filter-multi-menu filter-multi-menu-export">
                          {orderExportTypeOptions.map((option) => {
                            const checked = ordersExportTypeFilter.includes(option.value);
                            return (
                              <label key={option.value} className="filter-multi-option">
                                <input
                                  type="checkbox"
                                  className="filter-multi-checkbox"
                                  checked={checked}
                                  onChange={() => toggleMultiFilterValue(option.value, ordersExportTypeFilter, setOrdersExportTypeFilter)}
                                />
                                <span className="filter-multi-option-text">{option.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="filter-multi" ref={ordersExportStatusFilterRef}>
                      <label className="filter-multi-label" style={{ color: '#94a3b8' }}>Status</label>
                      <button
                        type="button"
                        onClick={() => setOrdersExportStatusFilterOpen((prev) => !prev)}
                        className="filter-multi-toggle filter-multi-toggle-export"
                      >
                        <span className="filter-multi-toggle-text">{getMultiFilterSummary(ordersExportStatusFilter, orderExportStatusOptions)}</span>
                        <span className="filter-multi-arrow">▾</span>
                      </button>
                      {ordersExportStatusFilterOpen && (
                        <div className="filter-multi-menu filter-multi-menu-export">
                          {orderExportStatusOptions.map((option) => {
                            const checked = ordersExportStatusFilter.includes(option.value);
                            return (
                              <label key={option.value} className="filter-multi-option">
                                <input
                                  type="checkbox"
                                  className="filter-multi-checkbox"
                                  checked={checked}
                                  onChange={() => toggleMultiFilterValue(option.value, ordersExportStatusFilter, setOrdersExportStatusFilter)}
                                />
                                <span className="filter-multi-option-text">{option.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div>
                      <label style={{ fontSize: '11px', color: '#94a3b8' }}>Von Datum</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="dd.mm.yyyy"
                        value={normalizeDateValue(ordersExportDateFrom)}
                        onChange={(e) => setOrdersExportDateFrom(e.target.value)}
                        onBlur={(e) => setOrdersExportDateFrom(normalizeDateValue(e.target.value))}
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
                        value={normalizeDateValue(ordersExportDateTo)}
                        onChange={(e) => setOrdersExportDateTo(e.target.value)}
                        onBlur={(e) => setOrdersExportDateTo(normalizeDateValue(e.target.value))}
                        className="mast-input-base"
                        style={{ width: '100%', marginTop: '4px' }}
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <strong style={{ color: '#cbd5e1' }}>Felder auswählen</strong>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={selectAllOrdersExportFields}
                        style={{ background: '#0369a1', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer' }}
                      >
                        Alle wählen
                      </button>
                      <button
                        onClick={clearOrdersExportFields}
                        style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer' }}
                      >
                        Alle abwählen
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: '8px', border: '1px solid #1f2a44', borderRadius: '8px', padding: '10px', background: '#0f172a' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '6px 10px' }}>
                      {ORDER_EXPORT_FIELD_OPTIONS.map((field) => {
                        const isChecked = ordersExportSelectedFields.includes(field.key);
                        return (
                          <label key={field.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#e2e8f0' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleOrdersExportField(field.key)}
                              style={{ width: '16px', height: '16px', margin: 0 }}
                            />
                            <span>{field.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', color: '#93c5fd' }}>
                      Treffer: {ordersExportRows.length} | Ausgewählte Felder: {ordersExportSelectedFields.length}
                    </span>
                    <button onClick={exportOrdersToExcel} style={{ backgroundColor: '#0f766e', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', fontWeight: 600 }}>
                      Jetzt Aufträge exportieren
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