import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildProjectTemplate, LK_SIKA_TAUSCH_ACTION } from "./projectTemplate.mjs";

test("Vorlage enthält LK / SiKa Tausch und dessen neue Leuchten", () => {
  const text = buildProjectTemplate({
    type: "LK-Tausch",
    masten: [
      { aktion: LK_SIKA_TAUSCH_ACTION, leuchten: [{ typ: "Cuvia", lumen: "2600" }] },
      { aktion: LK_SIKA_TAUSCH_ACTION, leuchten: [{ typ: "Cuvia", lumen: "2600" }] },
      { aktion: LK_SIKA_TAUSCH_ACTION, leuchten: [{ typ: "Andere", lumen: "" }] }
    ]
  });

  assert.match(text, /Masten Übersicht:\nLK \/ SiKa Tausch → 3 Stk\n\nLeuchten Übersicht:/);
  assert.match(text, /Leuchten Übersicht:\nCuvia → 2 Stk \| 2600lm\nAndere → 1 Stk\n/);
  assert.doesNotMatch(text, /Unbekanntm Stahl|Keine Einträge|Keine neuen Leuchten geplant/);
});

test("Vorlage kombiniert Mastaktionen und Leuchten ohne LK-Tausch als Mastwechsel zu zählen", () => {
  const text = buildProjectTemplate({
    masten: [
      { aktion: "Montage", lphNeu: "6", mastTypNeu: "Gerade", leuchten: [{ typ: "Cuvia", lumen: "2600" }] },
      { aktion: "Tausch", lphAlt: "4", lphNeu: "6", leuchten: [{ typ: "Cuvia", lumen: "2600" }] },
      { aktion: "Demontage", lphAlt: "4", leuchten: [{ typ: "Alt", lumen: "1000" }] },
      { aktion: LK_SIKA_TAUSCH_ACTION, leuchten: [{ typ: "Cuvia", lumen: "2600" }, { typ: "", lumen: "" }] }
    ]
  });

  assert.match(text, /Masten Übersicht:\n4m Stahl Gerade → Demontage: 2\n6m Stahl Gerade → Montage: 2\nLK \/ SiKa Tausch → 1 Stk\n/);
  assert.match(text, /Leuchten Übersicht:\nCuvia → 3 Stk \| 2600lm\n/);
  assert.doesNotMatch(text, /Alt →|Unbekanntm Stahl/);
});

test("Leere Vorlage behält bisherige Hinweise", () => {
  const text = buildProjectTemplate({});
  assert.match(text, /Masten Übersicht:\nKeine Einträge\n\nLeuchten Übersicht:\nKeine neuen Leuchten geplant/);
  assert.doesNotMatch(text, /LK \/ SiKa Tausch/);
});
