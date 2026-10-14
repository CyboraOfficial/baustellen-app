/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const renames = [
    ["Proformarechnung weggeschickt", "Proforma Müller"],
    ["Proforma WN weggeschickt", "Proforma WN"],
  ]

  for (const [from, to] of renames) {
    app.db()
      .newQuery("UPDATE projects SET status = {:to} WHERE status = {:from}")
      .bind({ from, to })
      .execute()

    app.db()
      .newQuery("UPDATE projects SET statuses = REPLACE(statuses, {:qfrom}, {:qto}) WHERE statuses LIKE {:like}")
      .bind({ qfrom: JSON.stringify(from), qto: JSON.stringify(to), like: "%" + from + "%" })
      .execute()
  }
}, (app) => {
  // Umbenennung wird nicht zurückgesetzt
})
