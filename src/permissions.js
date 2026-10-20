export const ROLE_LABELS = {
  admin: "Admin",
  buero: "Büro",
  bauleiter: "Bauleiter",
  monteur: "Monteur"
};

// Bereiche mit drei Stufen: kein Zugriff / nur ansehen / bearbeiten.
// viewKey = sichtbar, editKey = bearbeitbar (setzt Sichtbarkeit voraus).
export const LEVEL_DEFS = [
  { tab: "Allgemein", label: "Reiter Allgemein", viewKey: "tabAllgemein", editKey: "editAllgemein" },
  { tab: "Dateien", label: "Reiter Dateien", viewKey: "tabDateien", editKey: "editDateien" },
  { tab: "Masten", label: "Reiter Masten", viewKey: "tabMasten", editKey: "editMasten" },
  { tab: "Aufmaß", label: "Reiter Aufmaß", viewKey: "tabAufmass", editKey: "editAufmass" },
  { tab: "Abrechnung", label: "Reiter Abrechnung", viewKey: "tabAbrechnung", editKey: "editAbrechnung" },
  { tab: "Bauzeitenplan", label: "Bauzeitenplan", viewKey: "bauzeitenplan", editKey: "editBauzeitenplan" }
];

// Einfache Ja/Nein-Berechtigungen.
export const BOOL_DEFS = [
  { key: "tabProtokoll", label: "Reiter Protokoll" },
  { key: "tabVorlage", label: "Reiter Vorlage" },
  { key: "createProject", label: "Baustellen anlegen" },
  { key: "deleteProject", label: "Baustellen löschen" },
  { key: "nachkalkulation", label: "Nachkalkulation & Excel-Export" },
  { key: "onlyAssignedProjects", label: "Nur zugeordnete Baustellen sehen (Geplant / In Bearbeitung, über Truppen des Benutzers)" }
];

export const TAB_LEVELS = Object.fromEntries(LEVEL_DEFS.map((d) => [d.tab, d]));
export const TAB_BOOL_KEYS = { "Protokoll": "tabProtokoll", "Vorlage": "tabVorlage" };

export const STATUS_OPTIONS = [
  "Offen", "Geplant", "Klärung", "Westnetznummer fehlt", "In Bearbeitung",
  "Fertig für Abrechnung", "Proforma Müller", "Proforma HSW", "Proforma WN", "Abgerechnet"
].map((status) => ({ id: status, label: status }));

export const ALL_PERMISSION_KEYS = [
  ...LEVEL_DEFS.flatMap((d) => [d.viewKey, d.editKey]),
  ...BOOL_DEFS.map((d) => d.key)
];

export const getLevel = (perms, def) => {
  if (!perms?.[def.viewKey]) return "none";
  return perms?.[def.editKey] ? "edit" : "view";
};

export const levelToValues = (def, level) => ({
  [def.viewKey]: level !== "none",
  [def.editKey]: level === "edit"
});
