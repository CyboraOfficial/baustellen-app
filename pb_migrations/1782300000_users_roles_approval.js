/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const users = app.findCollectionByNameOrId("users")

  if (!users.fields.getByName("role")) {
    users.fields.add(new Field({
      "hidden": false,
      "id": "select782300001",
      "maxSelect": 1,
      "name": "role",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "select",
      "values": ["admin", "buero", "bauleiter", "monteur"]
    }))
  }
  if (!users.fields.getByName("approved")) {
    users.fields.add(new Field({
      "hidden": false,
      "id": "bool782300002",
      "name": "approved",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "bool"
    }))
  }

  // Registrierung ist offen, aber Rolle/Freigabe darf nur ein Admin setzen.
  users.authRule = "approved = true"
  users.listRule = "id = @request.auth.id || @request.auth.role = 'admin'"
  users.viewRule = "id = @request.auth.id || @request.auth.role = 'admin'"
  users.createRule = "@request.auth.role = 'admin' || (@request.body.role:isset = false && @request.body.approved:isset = false)"
  users.updateRule = "@request.auth.role = 'admin' || (id = @request.auth.id && @request.body.role:isset = false && @request.body.approved:isset = false)"
  users.deleteRule = "@request.auth.role = 'admin'"
  app.save(users)

  // Bestehende Benutzer behalten vollen Zugriff.
  app.db()
    .newQuery("UPDATE users SET role = 'admin', approved = 1")
    .execute()

  const projects = app.findCollectionByNameOrId("projects")
  projects.createRule = "@request.auth.role = 'admin' || @request.auth.role = 'buero' || @request.auth.role = 'bauleiter'"
  projects.deleteRule = "@request.auth.role = 'admin' || @request.auth.role = 'buero'"
  app.save(projects)
}, (app) => {
  const projects = app.findCollectionByNameOrId("projects")
  projects.createRule = "@request.auth.id != ''"
  projects.deleteRule = "@request.auth.id != ''"
  app.save(projects)

  const users = app.findCollectionByNameOrId("users")
  users.authRule = ""
  users.listRule = "id = @request.auth.id"
  users.viewRule = "id = @request.auth.id"
  users.createRule = ""
  users.updateRule = "id = @request.auth.id"
  users.deleteRule = "id = @request.auth.id"
  users.fields.removeByName("role")
  users.fields.removeByName("approved")
  app.save(users)
})
