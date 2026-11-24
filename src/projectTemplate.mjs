export const LK_SIKA_TAUSCH_ACTION = "LK / SiKa Tausch";

export function buildProjectTemplate(form) {
  const mastenStats = {};
  const leuchtenGruppiert = {};
  let lkSikaTauschCount = 0;

  (form.masten || []).forEach((m) => {
    if (m.aktion === "Demontage" || m.aktion === "Tausch") {
      const artAlt = m.mastTypAlt || "Gerade";
      const keyAlt = `${m.lphAlt || "Unbekannt"}m Stahl ${artAlt}`;
      if (!mastenStats[keyAlt]) mastenStats[keyAlt] = { rein: 0, raus: 0 };
      mastenStats[keyAlt].raus += 1;
    }

    if (m.aktion === "Montage" || m.aktion === "Tausch") {
      const artNeu = m.mastTypNeu || "Gerade";
      const keyNeu = `${m.lphNeu || "Unbekannt"}m Stahl ${artNeu}`;
      if (!mastenStats[keyNeu]) mastenStats[keyNeu] = { rein: 0, raus: 0 };
      mastenStats[keyNeu].rein += 1;
    }

    if (m.aktion === LK_SIKA_TAUSCH_ACTION) lkSikaTauschCount += 1;

    if (m.aktion === "Montage" || m.aktion === "Tausch" || m.aktion === LK_SIKA_TAUSCH_ACTION) {
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

  const mastenLines = Object.entries(mastenStats)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([beschreibung, w]) => {
      const info = [];
      if (w.rein > 0) info.push(`Montage: ${w.rein}`);
      if (w.raus > 0) info.push(`Demontage: ${w.raus}`);
      return `${beschreibung} → ${info.join(" | ")}`;
    });
  if (lkSikaTauschCount > 0) {
    mastenLines.push(`${LK_SIKA_TAUSCH_ACTION} → ${lkSikaTauschCount} Stk`);
  }
  const mastenText = mastenLines.join("\n");

  const leuchtenText = Object.values(leuchtenGruppiert)
    .map(l => `${l.typ} → ${l.anzahl} Stk${l.lumen ? ` | ${l.lumen}lm` : ""}`)
    .join("\n");

  return `Ort: ${form.address || ""}

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
}
