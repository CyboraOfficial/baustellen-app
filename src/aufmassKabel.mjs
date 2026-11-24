import { LK_SIKA_TAUSCH_ACTION } from "./projectTemplate.mjs";

export function calculateKabelSummen(masten) {
  const summen = { ans: 0, aend: 0, abr: 0, nichtZugeordnet: 0, gesamt: 0 };

  for (const mast of Array.isArray(masten) ? masten : []) {
    const menge = Number(String(mast.aufmassKabel || "").replace(",", ".")) || 0;
    summen.gesamt += menge;

    switch (mast.aktion || "Montage") {
      case "Montage":
        summen.ans += menge;
        break;
      case "Tausch":
      case LK_SIKA_TAUSCH_ACTION:
        summen.aend += menge;
        break;
      case "Demontage":
        summen.abr += menge;
        break;
      default:
        summen.nichtZugeordnet += menge;
    }
  }

  return summen;
}
