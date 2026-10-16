/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const perms = ["editAllgemein", "editDateien", "editMasten", "editAufmass", "editAbrechnung", "editBauzeitenplan"]
  const collection = app.findCollectionByNameOrId("role_permissions")

  for (const name of perms) {
    if (!collection.fields.getByName(name)) {
      collection.fields.add(new Field({ "name": name, "type": "bool" }))
    }
  }
  app.save(collection)

  // Bisheriges Verhalten beibehalten: wer einen Bereich sehen durfte, durfte ihn auch bearbeiten.
  const pairs = {
    editAllgemein: "tabAllgemein", editDateien: "tabDateien", editMasten: "tabMasten",
    editAufmass: "tabAufmass", editAbrechnung: "tabAbrechnung", editBauzeitenplan: "bauzeitenplan"
  }
  const records = app.findAllRecords("role_permissions")

  // Frühere Version von 1782300100 hat die Standardwerte falsch geschrieben (alles false).
  // Nur komplett leere Rollen werden neu befüllt, eigene Einstellungen bleiben erhalten.
  const viewKeys = ["tabAllgemein", "tabDateien", "tabProtokoll", "tabMasten", "tabAufmass", "tabAbrechnung", "tabVorlage",
    "createProject", "deleteProject", "bauzeitenplan", "nachkalkulation"]
  const allOn = Object.fromEntries(viewKeys.map((k) => [k, true]))
  const seed = {
    admin: allOn,
    buero: allOn,
    bauleiter: { ...allOn, tabAbrechnung: false, deleteProject: false, nachkalkulation: false },
    monteur: { tabAllgemein: true, tabDateien: true, tabProtokoll: true, tabMasten: true }
  }
  for (const record of records) {
    const defaults = seed[record.getString("role")]
    if (defaults && viewKeys.every((k) => !record.getBool(k))) {
      for (const k of viewKeys) record.set(k, !!defaults[k])
    }
  }
  for (const record of records) {
    for (const [edit, view] of Object.entries(pairs)) {
      record.set(edit, record.getBool(view))
    }
    app.save(record)
  }

  const rp = "@collection.role_permissions"
  const own = `${rp}.role ?= @request.auth.role`
  const anyEdit = ["editAllgemein", "editDateien", "editMasten", "editAufmass", "editAbrechnung"]
    .map((f) => `${rp}.${f} ?= true`).join(" || ")

  const projects = app.findCollectionByNameOrId("projects")
  projects.updateRule = `@request.auth.role = 'admin' || (${own} && (${anyEdit}))`
  app.save(projects)

  const planRule = `@request.auth.role = 'admin' || (${own} && ${rp}.editBauzeitenplan ?= true)`
  for (const name of ["crews", "schedule_entries"]) {
    const c = app.findCollectionByNameOrId(name)
    c.createRule = planRule
    c.updateRule = planRule
    c.deleteRule = planRule
    app.save(c)
  }
}, (app) => {
  const open = "@request.auth.id != ''"
  for (const name of ["projects", "crews", "schedule_entries"]) {
    const c = app.findCollectionByNameOrId(name)
    c.updateRule = open
    if (name !== "projects") {
      c.createRule = open
      c.deleteRule = open
    }
    app.save(c)
  }
  const collection = app.findCollectionByNameOrId("role_permissions")
  for (const name of ["editAllgemein", "editDateien", "editMasten", "editAufmass", "editAbrechnung", "editBauzeitenplan"]) {
    collection.fields.removeByName(name)
  }
  app.save(collection)
})
