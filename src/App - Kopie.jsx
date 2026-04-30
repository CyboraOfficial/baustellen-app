import React, { useEffect, useState } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { useMap } from "react-leaflet"; 

function FlyToPosition({ position }) {
  const map = useMap();

  useEffect(() => {
    if (!position) return;

    map.flyTo([position.lat, position.lng], 17, {
      duration: 0.8,
    });
  }, [position]);

  return null;
}

function MarkerCluster({ projects, openProject }) {
  const map = useMap();

  useEffect(() => {
  if (!map) return;

  const markers = L.markerClusterGroup();

  projects.forEach((p) => {
    if (!p.position) return;

    const marker = L.marker(
      [p.position.lat, p.position.lng],
      { icon: ICONS[p.status] || ICONS.Offen }
    );

    marker._id = p.id; // 🔥 eindeutige ID setzen

    marker.on("click", () => openProject(p));

    markers.addLayer(marker);
  });

  map.addLayer(markers);

  return () => {
    map.removeLayer(markers);
  };
}, [projects]);

  return null;
}

function FitBounds({ projects, enabled }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return;

    const valid = projects.filter(p => p.position);
    if (valid.length === 0) return;

    const bounds = valid.map(p => [
      p.position.lat,
      p.position.lng
    ]);

    map.fitBounds(bounds, { padding: [50, 50] });
  }, [projects, enabled]);

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
  Offen: createIcon("red"),
  Klärung: createIcon("orange"),
  "In Bearbeitung": createIcon("blue"),
  "Fertig für Abrechnung": createIcon("violet"),
  Abgerechnet: createIcon("green"),
};

const STATUS_COLORS = {
  Offen: "#e74c3c",
  Klärung: "#f39c12",
  "In Bearbeitung": "#3498db",
  "Fertig für Abrechnung": "#9b59b6",
  Abgerechnet: "#2ecc71",
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
  `/api/reverse?format=json&lat=${lat}&lon=${lng}`
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
  const [projects, setProjects] = useState([]);
  const [mode, setMode] = useState("list");
  const [activeTab, setActiveTab] = useState("Allgemein");

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

  const AUTOSAVE_DELAY = 2000; // 2 Sekunden
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

  const text = `
Ort: ${form.address || ""}
Ortsteil: 
Straße: 

Westnetz Nr.: ${form.westnetz || ""}

Maßnahme: ${form.type || ""}
Einmesser: 
Bauplan: 
Pläne Strom: 
Pläne Gas: 
Pläne Telekom: 

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

setTimeout(() => {
  setToast(null);
}, 2000);
};

  /* ================= LOAD ================= */
  const loadProjects = async () => {
    const data = await window.desktopAPI.listProjects();
    setProjects(data);
  };

  useEffect(() => {
    loadProjects();
  }, []);

  /* ================= FILTER ================= */
  const filteredProjects = projects.filter((p) => {
    const text = search.toLowerCase();

    return (
      (p.name?.toLowerCase().includes(text) ||
        p.address?.toLowerCase().includes(text) ||
        p.westnetz?.toLowerCase().includes(text) ||
        p.notes?.toLowerCase().includes(text)) &&
      (filterStatus === "OffenAlle" && OFFENE_STATUS.includes(p.status)) &&
      (filterType === "Alle" || p.type === filterType)
    );
  });

  /* ================= ADRESSSUCHE / AUTOCOMPLETE ================= */
  const searchLocation = async (query) => {
  if (!query || query.length < 3) {
    setSearchResults([]);
    return;
  }

  try {
    const res = await fetch(
      `/api/search?format=json&q=${encodeURIComponent(query)}&limit=5`
    );

    if (!res.ok) {
      setSearchResults([]);
      return;
    }

    const data = await res.json();

    if (!Array.isArray(data)) {
      setSearchResults([]);
      return;
    }

    setSearchResults(data);

  } catch (err) {
    console.error(err);
    setSearchResults([]);
  }
};

  /* ================= OPEN ================= */
  const openProject = (p) => {
    setSelectedProject(p);
    setSelectedPosition(p.position || null);
    setOriginalProject(p);
    setSelectedPosition(p.position);

    setForm({
      name: p.name || "",
      address: p.address || "",
      westnetz: p.westnetz || "",
      type: p.type || "Konzept",
      status: p.status || "Offen",
      pgk: p.pgk || "",
      notes: p.notes || "",
      masten: p.masten || [],
      leuchten: p.leuchten || [],
      log: p.log ?? [],
      ab: p.ab || "",
    });

    setMode("detail");
    setActiveTab("Allgemein");
    setSearchAddress("");
    setSearchResults([]);
  };

  /* ================= Export Log =============== */

  const exportLog = () => {
  if (!form.log || form.log.length === 0) {
    alert("Kein Protokoll vorhanden");
    return;
  }

  let text = `Änderungsprotokoll - ${form.name}\n\n`;

  form.log.forEach((entry) => {
    text += `Datum: ${entry.date}\n`;

    entry.changes.forEach((c) => {
      text += `- ${c.field}: ${c.old} → ${c.new}\n`;
    });

    text += "\n";
  });

  const blob = new Blob([text], { type: "text/plain;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `Protokoll_${form.name}.txt`;
  a.click();

  URL.revokeObjectURL(url);
};

  /* ================= AUTOSAVE ================= */
  useEffect(() => {
  if (mode !== "detail" || !selectedProject) return;

  const t = setTimeout(async () => {
    const changes = [];

    Object.keys(form).forEach((key) => {
      if (key === "log") return;

      if (JSON.stringify(form[key]) !== JSON.stringify(selectedProject[key])) {
        changes.push({
          field: key,
          old: selectedProject[key],
          new: form[key],
        });
      }
    });

    if (changes.length === 0) return;

    const newLogEntry = {
      date: new Date().toLocaleString(),
      changes,
    };

    const updatedLog = [newLogEntry, ...(selectedProject.log || [])];

    const updatedProject = {
      ...selectedProject,
      ...form,
      log: updatedLog,
    };

    await window.desktopAPI.updateProject(updatedProject);

    setSelectedProject(updatedProject);
    setForm((prev) => ({
      ...prev,
      log: updatedLog,
    }));

    loadProjects();
  }, AUTOSAVE_DELAY);

  return () => clearTimeout(t);
}, [form, mode, selectedProject]);

  /* ================= CREATE ================= */
  const createProject = async () => {
    if (!selectedPosition) {
      alert("Bitte auf die Karte klicken oder eine Adresse suchen.");
      return;
    }

    const result = await window.desktopAPI.createProject({
  ...form,
  position: selectedPosition,
  notes: form.notes || "",
});

for (let file of tempFiles) {
  await window.desktopAPI.uploadFile({
    projectName: form.name,
    filePath: file.path,
  });
}

for (let file of tempFiles) {
  await window.desktopAPI.uploadFile({
    projectName: form.name,
    filePath: file.path,
  });
}

    setTempFiles([]);
    setMode("list");
    setForm(emptyForm);
    setSelectedPosition(null);
    setSelectedProject(null);
    setSearchAddress("");
    setSearchResults([]);
    setActiveTab("Allgemein");
    loadProjects();

    
  };

  /* ================= SUMMEN ================= */
  const mastenSumme = form.masten.reduce((a, m) => a + (Number(m.anzahl) || 0), 0);

  const mastenTypen = {
    stellen: 0,
    demontieren: 0,
    tausch: 0,
  };

  form.masten.forEach((m) => {
    const typ = m.typ || "stellen";
    if (mastenTypen[typ] !== undefined) {
      mastenTypen[typ] += Number(m.anzahl) || 0;
    }
  });

  const leuchtenSumme = form.leuchten.reduce(
    (a, l) => a + (Number(l.anzahl) || 0),
    0
  );

  const lumenSumme = form.leuchten.reduce(
    (a, l) => a + (Number(l.lumen) || 0) * (Number(l.anzahl) || 1),
    0
  );

  return (
    <div className="app-layout">
      {/* SIDEBAR */}
      <div className="sidebar">
        <div className="sidebar-content">
          <div className="header-bar">
            <button
              onClick={() => {
                setMode("create");
                setForm(emptyForm);
                setSelectedPosition(null);
                setSelectedProject(null);
                setActiveTab("Allgemein");
                setSearchAddress("");
                setSearchResults([]);
              }}
            >
              + Neue Baustelle
            </button>

            <button onClick={() => setMode("list")}>← Zurück</button>
          </div>

          {/* ================= LISTE ================= */}
          {mode === "list" && (
            <>
                <div style={{ flex: 1 }}>
                  <label>Status</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                  >
                    <option>Alle</option>
                    <option>Offen</option>
                    <option value="OffenAlle">Offen (alle)</option>
                    <option>Klärung</option>
                    <option>In Bearbeitung</option>
                    <option>Fertig für Abrechnung</option>
                    <option>Abgerechnet</option>
                  </select>
                </div>

                <div style={{ flex: 1 }}>
                  <label>Typ</label>
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                  >
                    <option>Alle</option>
                    <option>Konzept</option>
                    <option>Anfahrschaden</option>
                    <option>Störung</option>
                    <option>LK-Tausch</option>
                    <option>Sonstiges</option>
                  </select>
                </div>

              <h3>Baustellen</h3>

              {filteredProjects.map((p) => (
                <div
                  key={p.id}
                  className="project-card"
                  onClick={() => openProject(p)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        background: STATUS_COLORS[p.status] || "#999",
                      }}
                    />
                    <strong>{p.name}</strong>
                  </div>

                  <div>{p.status}</div>
                  <div style={{ fontSize: 12 }}>{p.type}</div>

{p.ab && (
  <div style={{ fontSize: 12 }}>
    AB: {p.ab}
  </div>
)}

                  {p.westnetz && (
  <div style={{ fontSize: 12 }}>
    <strong>WN:</strong>
    {p.westnetz
      .split("\n")
      .map((w, i) => (
        <div key={i} style={{ marginLeft: 6 }}>
          • {w}
        </div>
      ))}
  </div>
)}
   </div>   
   )}  
     

          {/* ================= DETAIL / CREATE ================= */}
          {(mode === "detail" || mode === "create") && (
            <>
              {mode === "detail" && (
                <div
                  style={{
                    background: STATUS_COLORS[form.status] || "#999",
                    color: "white",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    marginBottom: "10px",
                    fontWeight: "bold",
                    textAlign: "center",
                  }}
                >
                  {form.status}
                </div>
              )}

              <div className="tabs">
                {tabs.map((t) => (
                  <div
                    key={t}
                    className={`tab ${activeTab === t ? "active" : ""}`}
                    onClick={() => {
  if (t === "Vorlage") {
    copyTemplate(); // 🔥 Funktion ausführen
  } else {
    setActiveTab(t);
  }
}}
                  >
                    {t}
                  </div>
                ))}
              </div>
              )}
              {/* ================= ALLGEMEIN ================= */}
              {activeTab === "Allgemein" && (
  <>
    {mode === "create" && (
      <>
        <label>Adresse suchen</label>

        <div style={{ position: "relative", zIndex: 1000 }}>
          <input
            value={searchAddress}
            onChange={(e) => {
              const value = e.target.value;
              setSearchAddress(value);

              if (searchTimeout) clearTimeout(searchTimeout);

              const timeout = setTimeout(() => {
                searchLocation(value);
              }, 500);

              setSearchTimeout(timeout);
            }}
            placeholder="Straße + Ort"
          />

          {searchResults.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                background: "#fff",
                border: "1px solid #ccc",
                borderRadius: "6px",
                marginTop: "4px",
                maxHeight: "200px",
                overflowY: "auto",
                zIndex: 99999,
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)"
              }}
            >
              {searchResults.map((r, i) => (
                <div
                  key={i}
                  onClick={() => {
                    const pos = {
                      lat: Number(r.lat),
                      lng: Number(r.lon),
                    };

                    setSelectedPosition(pos);

                    setForm((prev) => ({
                      ...prev,
                      address: r.display_name,
                    }));

                    setSearchAddress(r.display_name);
                    setSearchResults([]);
                  }}
                  style={{
                    padding: "8px",
                    cursor: "pointer",
                    borderBottom: "1px solid #eee"
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#f5f5f5")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "white")
                  }
                >
                  {r.display_name}
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    )}

    <label>Name</label>
    <input
      value={form.name}
      onChange={(e) =>
        setForm({ ...form, name: e.target.value })
      }
    />

    <label>Adresse</label>
    <input
      value={form.address}
      onChange={(e) =>
        setForm({ ...form, address: e.target.value })
      }
    />

    <label>Westnetznummer</label>
    <textarea
      value={form.westnetz || ""}
      onChange={(e) =>
        setForm({ ...form, westnetz: e.target.value })
      }
      rows={2}
      placeholder="Mehrere Nummern (eine pro Zeile)"
      style={{ resize: "vertical", minHeight: "60px" }}
    />

    <label>AB-Nummer</label>
    <input
      value={form.ab || ""}
      onChange={(e) =>
        setForm({ ...form, ab: e.target.value })
      }
    />

    <label>Typ</label>
    <select
      value={form.type}
      onChange={(e) =>
        setForm({ ...form, type: e.target.value })
      }
    >
      <option>Konzept</option>
      <option>Anfahrschaden</option>
      <option>Störung</option>
      <option>LK-Tausch</option>
      <option>Sonstiges</option>
    </select>

    <label>Status</label>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: STATUS_COLORS[form.status] || "#999",
        }}
      />
      <select
        value={form.status}
        onChange={(e) =>
          setForm({ ...form, status: e.target.value })
        }
      >
        <option>Offen</option>
        <option>Klärung</option>
        <option>In Bearbeitung</option>
        <option>Fertig für Abrechnung</option>
        <option>Abgerechnet</option>
      </select>
    </div>

    <label>PGK</label>
    <input
      value={form.pgk}
      onChange={(e) =>
        setForm({ ...form, pgk: e.target.value })
      }
    />

    <label>Notizen</label>
    <textarea
      value={form.notes || ""}
      onChange={(e) =>
        setForm({ ...form, notes: e.target.value })
      }
      rows={4}
      style={{ resize: "vertical" }}
    />

    {mode === "create" && (
      <div>
        📍 {selectedPosition ? "Position gewählt" : "Karte klicken!"}
      </div>
    )}
  </>
)}
              {/* ================= DATEIEN ================= */}
              {activeTab === "Dateien" && (
                <>
                  <div
  onDragOver={(e) => e.preventDefault()}
  onDrop={(e) => {
    e.preventDefault();

    if (mode === "create") {
      if (!e.dataTransfer || !e.dataTransfer.files) return;
      const files = Array.from(e?.dataTransfer?.files || []);

      setTempFiles((prev) => [...prev, ...files]);
    } else {
      (async () => {
        for (let file of e.dataTransfer.files) {
          await window.desktopAPI.uploadFile({
            projectName: selectedProject.name,
            filePath: file.path,
          });
        }
        loadProjects();
      })();
    }
  }}
  style={{ border: "2px dashed #aaa", padding: 10 }}
>
  Dateien hier ablegen
</div>

{mode === "create" &&
  tempFiles.map((f, i) => (
    <div
      key={i}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "4px 0"
      }}
    >
      <span>📄 {f.name}</span>

      <button
        onClick={() => {
          setTempFiles(tempFiles.filter((_, idx) => idx !== i));
        }}
        style={{
          background: "#e74c3c",
          color: "white",
          border: "none",
          borderRadius: "4px",
          padding: "2px 6px",
          cursor: "pointer"
        }}
      >
        ✕
      </button>
    </div>
  ))}

                  {selectedProject?.files || []?.map((f, i) => (
                    <div key={i}>
                      <button onClick={() => window.desktopAPI.openFile(f.path)}>
                        {f.name}
                      </button>
                    </div>
                  ))}
                </>
              )}

              {/* ================= MASTEN ================= */}
              {activeTab === "Masten" && (
                <>
                  <div>
                    Gesamt: {mastenSumme} | Stellen: {mastenTypen.stellen} |
                    Demontieren: {mastenTypen.demontieren} | Tausch:{" "}
                    {mastenTypen.tausch}
                  </div>

                  {form.masten.map((m, i) => (
                    <div key={i}>
                      <label>LPH</label>
                      <input
                        value={m.lph}
                        onChange={(e) => {
                          const u = [...form.masten];
                          u[i].lph = e.target.value;
                          setForm({ ...form, masten: u });
                        }}
                      />

                      <label>Anzahl</label>
                      <input
                        type="number"
                        value={m.anzahl}
                        onChange={(e) => {
                          const u = [...form.masten];
                          u[i].anzahl = Number(e.target.value);
                          setForm({ ...form, masten: u });
                        }}
                      />

                      <label>Typ</label>
                      <select
                        value={m.typ}
                        onChange={(e) => {
                          const u = [...form.masten];
                          u[i].typ = e.target.value;
                          setForm({ ...form, masten: u });
                        }}
                      >
                        <option>stellen</option>
                        <option>demontieren</option>
                        <option>tausch</option>
                      </select>
                    </div>
                  ))}

                  <button
                    onClick={() =>
                      setForm({
                        ...form,
                        masten: [
                          ...form.masten,
                          { lph: "", anzahl: 1, typ: "stellen" },
                        ],
                      })
                    }
                  >
                    + Mast
                  </button>
                </>
              )}

              {/* ================= LEUCHTEN ================= */}
              {activeTab === "Leuchten" && (
                <>
                  <div>
                    Gesamt: {leuchtenSumme} | Lumen: {lumenSumme}
                  </div>

                  {form.leuchten.map((l, i) => (
                    <div key={i}>
                      <label>Typ</label>
<input
  list="leuchten-liste"
  value={l.typ}
  onChange={(e) => {
    const value = e.target.value;

    const u = [...form.leuchten];
    u[i].typ = value;
    u[i].grad = 0;

    // 🔥 AUTOMATISCHE LUMEN SETZEN
    if (value === "Trilux Cuvia") u[i].lumen = 2600;
    if (value === "Trilux 9701") u[i].lumen = 4600;
    if (value === "Trilux 9821") u[i].lumen = 2600;

    setForm({ ...form, leuchten: u });
  }}
/>

<datalist id="leuchten-liste">
  {leuchtenOptionen.map((opt, i) => (
    <option key={i} value={opt} />
  ))}
</datalist>

                      <label>Lumen</label>
                      <input
                        value={l.lumen}
                        onChange={(e) => {
                          const u = [...form.leuchten];
                          u[i].lumen = Number(e.target.value);
                          setForm({ ...form, leuchten: u });
                        }}
                      />

                      <label>Grad</label>
                      <input
                        type="number"
                        value={l.grad ?? 0}
                        onChange={(e) => {
                          const u = [...form.leuchten];
                          u[i].grad = Number(e.target.value);
                          setForm({ ...form, leuchten: u });
                        }}
                      />

                      <label>Anzahl</label>
                      <input
                        type="number"
                        value={l.anzahl}
                        onChange={(e) => {
                          const u = [...form.leuchten];
                          u[i].anzahl = Number(e.target.value);
                          setForm({ ...form, leuchten: u });
                        }}
                      />

                      <label>Info</label>
<input
  value={l.info || ""}
  onChange={(e) => {
    const u = [...form.leuchten];
    u[i].info = e.target.value;
    setForm({ ...form, leuchten: u });
  }}
  placeholder="z. B. Gehweglinse"
/>
                    </div>
                  ))}

                  <button
                    onClick={() =>
                      setForm({
                        ...form,
                        leuchten: [
                          ...form.leuchten,
                          { typ: "", lumen: 0, grad: 0, anzahl: 1, info: "" }
                        ],
                      })
                    }
                  >
                    + Leuchte
                  </button>
                </>
              )}

            {/* ================= Protokoll ================= */}

              {activeTab === "Protokoll" && (
                
  <div style={{ maxHeight: "400px", overflowY: "auto" }}>
    <button onClick={exportLog} style={{ marginBottom: 10 }}>
  📄 Protokoll exportieren
</button>
    {(form.log || []).length === 0 && (
      <div>Keine Änderungen vorhanden</div>
    )}

    {(form.log || []).map((entry, i) => (
      <div key={i} style={{
        borderBottom: "1px solid #ddd",
        padding: 8,
        marginBottom: 6
      }}>
        <div style={{ fontSize: 12, color: "#666" }}>
          {entry.date}
        </div>

        {entry.changes.map((c, j) => (
          <div key={j} style={{ fontSize: 13 }}>
            <strong>{c.field}</strong>: {String(c.old)} → {String(c.new)}
          </div>
        ))}
      </div>
    ))}
  </div>
)}

              {mode === "create" && (
                <button onClick={createProject}>Speichern</button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ================= MAP ================= */}
      <div className="map-area">
        <MapContainer center={[51.3, 8.2]} zoom={12} style={{ height: "100%" }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          <MapClickHandler
            mode={mode}
            onPick={setSelectedPosition}
            setAddress={(addr) =>
              setForm((prev) => ({ ...prev, address: addr }))
            }
          />

<FitBounds
  projects={filteredProjects}
  enabled={mode === "list"} // 🔥 nur in Übersicht
/>
<FlyToPosition position={selectedPosition} />

          {selectedPosition && mode === "create" && (
            <Marker position={[selectedPosition.lat, selectedPosition.lng]} />
          )}

          {filteredProjects.map(
  (p) =>
    p.position && (
      <MarkerCluster
  projects={filteredProjects}
  openProject={openProject}
/>
    )
)}
        </MapContainer>
        {toast && (
  <div style={{
    position: "fixed",
    bottom: 20,
    left: "50%",
    transform: "translateX(-50%)",
    background: "#2ecc71",
    color: "white",
    padding: "10px 20px",
    borderRadius: "8px",
    boxShadow: "0 4px 10px rgba(0,0,0,0.2)",
    fontSize: 14,
    zIndex: 9999,
    transition: "0.3s"
  }}>
    {toast}
  </div>
)}
      </div>
      
    </div>
</div>
    
  );
}