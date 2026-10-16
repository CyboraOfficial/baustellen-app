/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const perms = ["tabAllgemein", "tabDateien", "tabProtokoll", "tabMasten", "tabAufmass", "tabAbrechnung", "tabVorlage",
    "createProject", "deleteProject", "bauzeitenplan", "nachkalkulation"]

  const collection = new Collection({
    "type": "base",
    "name": "role_permissions",
    "listRule": "@request.auth.id != ''",
    "viewRule": "@request.auth.id != ''",
    "createRule": "@request.auth.role = 'admin'",
    "updateRule": "@request.auth.role = 'admin'",
    "deleteRule": "@request.auth.role = 'admin'",
    "fields": [
      { "name": "role", "type": "text", "required": true },
      ...perms.map((name) => ({ "name": name, "type": "bool" }))
    ],
    "indexes": ["CREATE UNIQUE INDEX idx_role_permissions_role ON role_permissions (role)"]
  })
  app.save(collection)

  const all = Object.fromEntries(perms.map((p) => [p, true]))
  const none = Object.fromEntries(perms.map((p) => [p, false]))
  const defaults = {
    admin: all,
    buero: all,
    bauleiter: { ...all, tabAbrechnung: false, deleteProject: false, nachkalkulation: false },
    monteur: { ...none, tabAllgemein: true, tabDateien: true, tabProtokoll: true, tabMasten: true }
  }
  for (const role of Object.keys(defaults)) {
    const record = new Record(collection)
    record.set("role", role)
    for (const p of perms) record.set(p, defaults[role][p])
    app.save(record)
  }

  // Projekt-Regeln folgen jetzt der konfigurierbaren Rollen-Tabelle.
  const projects = app.findCollectionByNameOrId("projects")
  projects.createRule = "@request.auth.role = 'admin' || (@collection.role_permissions.role ?= @request.auth.role && @collection.role_permissions.createProject ?= true)"
  projects.deleteRule = "@request.auth.role = 'admin' || (@collection.role_permissions.role ?= @request.auth.role && @collection.role_permissions.deleteProject ?= true)"
  app.save(projects)
}, (app) => {
  const projects = app.findCollectionByNameOrId("projects")
  projects.createRule = "@request.auth.role = 'admin' || @request.auth.role = 'buero' || @request.auth.role = 'bauleiter'"
  projects.deleteRule = "@request.auth.role = 'admin' || @request.auth.role = 'buero'"
  app.save(projects)

  app.delete(app.findCollectionByNameOrId("role_permissions"))
})
