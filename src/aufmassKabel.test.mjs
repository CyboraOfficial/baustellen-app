import { strict as assert } from "node:assert";
import { test } from "node:test";
import { calculateKabelSummen } from "./aufmassKabel.mjs";
import { LK_SIKA_TAUSCH_ACTION } from "./projectTemplate.mjs";

test("Kabelmengen werden aus dem Kabel-Feld nach Mastaktion summiert", () => {
  const summen = calculateKabelSummen([
    { aktion: "Montage", aufmassKabel: "10,5", grabenKabelverlegen: "100" },
    { aktion: "Montage", aufmassKabel: "1" },
    { aktion: "Tausch", aufmassKabel: "4,5", grabenKabelverlegenTausch: "200" },
    { aktion: LK_SIKA_TAUSCH_ACTION, aufmassKabel: "2" },
    { aktion: "Demontage", aufmassKabel: "3", grabenKabelverlegenDemo: "300" }
  ]);

  assert.deepEqual(summen, { ans: 11.5, aend: 6.5, abr: 3, nichtZugeordnet: 0, gesamt: 21 });
});

test("Leere und alte Einträge sowie unbekannte Aktionen bleiben nachvollziehbar", () => {
  assert.deepEqual(calculateKabelSummen(undefined), { ans: 0, aend: 0, abr: 0, nichtZugeordnet: 0, gesamt: 0 });
  assert.deepEqual(calculateKabelSummen([
    { aufmassKabel: "2" },
    { aktion: "Sonstige", aufmassKabel: "5" },
    { aktion: "Tausch", aufmassKabel: "" }
  ]), { ans: 2, aend: 0, abr: 0, nichtZugeordnet: 5, gesamt: 7 });
});
