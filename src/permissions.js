export const ROLE_LABELS = {
  admin: "Admin",
  buero: "Büro",
  bauleiter: "Bauleiter",
  monteur: "Monteur"
};

export const DEFAULT_ROLE_SECURITY_LEVELS = {
  admin: 4,
  buero: 3,
  bauleiter: 2,
  monteur: 1
};

export const getRoleSecurityLevel = (role) => {
  const stored = Number(role?.securityLevel);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored);
  return DEFAULT_ROLE_SECURITY_LEVELS[role?.role] || 1;
};

export const getEffectiveSecurityLevel = (roles) => Math.max(
  1,
  ...(Array.isArray(roles) ? roles.map(getRoleSecurityLevel) : [])
);

export const getAllowedFileSecurityLevels = (roles) =>
  Array.from({ length: getEffectiveSecurityLevel(roles) }, (_, index) => index + 1);

export const parseFileSecurityLevels = (value) => {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return {};

  return Object.fromEntries(
    Object.entries(parsed)
      .map(([fileName, level]) => [fileName, Math.max(1, Math.round(Number(level) || 1))])
      .filter(([fileName]) => Boolean(fileName))
  );
};

export const getFileSecurityLevel = (project, fileName) =>
  parseFileSecurityLevels(project?.fileSecurityLevels)[fileName] || 1;

export const getVisibleProjectFiles = (project, securityLevel) =>
  (Array.isArray(project?.files) ? project.files : [])
    .filter((fileName) => getFileSecurityLevel(project, fileName) <= securityLevel);

export const parseFileFolders = (value) => {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return {};
  return Object.fromEntries(
    Object.entries(parsed)
      .map(([fileName, folderId]) => [fileName, String(folderId || "")])
      .filter(([fileName]) => Boolean(fileName))
  );
};

export const getFileFolderId = (project, fileName) =>
  parseFileFolders(project?.fileFolders)[fileName] || "";

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
