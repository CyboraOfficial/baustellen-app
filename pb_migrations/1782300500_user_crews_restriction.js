/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const crews = app.findCollectionByNameOrId("crews")

  const users = app.findCollectionByNameOrId("users")
  if (!users.fields.getByName("crews")) {
    users.fields.add(new Field({
      "hidden": false,
      "id": "relation782300500",
      "name": "crews",
      "collectionId": crews.id,
      "cascadeDelete": false,
      "maxSelect": 999,
      "minSelect": 0,
      "presentable": false,
      "required": false,
      "system": false,
      "type": "relation"
    }))
  }
  // Truppen-Zuordnung darf nur ein Admin setzen.
  users.createRule = "@request.auth.role = 'admin' || (@request.body.role:isset = false && @request.body.approved:isset = false && @request.body.crews:isset = false)"
  users.updateRule = "@request.auth.role = 'admin' || (id = @request.auth.id && @request.body.role:isset = false && @request.body.approved:isset = false && @request.body.crews:isset = false)"
  app.save(users)

  const perms = app.findCollectionByNameOrId("role_permissions")
  if (!perms.fields.getByName("onlyAssignedProjects")) {
    perms.fields.add(new Field({ "name": "onlyAssignedProjects", "type": "bool" }))
  }
  app.save(perms)

  const rp = "@collection.role_permissions"
  const unrestricted = `@request.auth.role = 'admin' || (${rp}.role ?= @request.auth.role && ${rp}.onlyAssignedProjects ?= false)`

  const projects = app.findCollectionByNameOrId("projects")
  const projectRule = `${unrestricted} || (schedule_entries_via_project.crew ?= @request.auth.crews.id && (statuses ~ 'Geplant' || statuses ~ 'In Bearbeitung'))`
  projects.listRule = projectRule
  projects.viewRule = projectRule
  app.save(projects)

  const entries = app.findCollectionByNameOrId("schedule_entries")
  const entryRule = `${unrestricted} || (crew ?= @request.auth.crews.id)`
  entries.listRule = entryRule
  entries.viewRule = entryRule
  app.save(entries)
}, (app) => {
  const open = "@request.auth.id != ''"
  for (const name of ["projects", "schedule_entries"]) {
    const c = app.findCollectionByNameOrId(name)
    c.listRule = open
    c.viewRule = open
    app.save(c)
  }

  const perms = app.findCollectionByNameOrId("role_permissions")
  perms.fields.removeByName("onlyAssignedProjects")
  app.save(perms)

  const users = app.findCollectionByNameOrId("users")
  users.createRule = "@request.auth.role = 'admin' || (@request.body.role:isset = false && @request.body.approved:isset = false)"
  users.updateRule = "@request.auth.role = 'admin' || (id = @request.auth.id && @request.body.role:isset = false && @request.body.approved:isset = false)"
  users.fields.removeByName("crews")
  app.save(users)
})
