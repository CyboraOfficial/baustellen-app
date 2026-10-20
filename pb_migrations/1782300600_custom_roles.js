/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  const rolePermissions = app.findCollectionByNameOrId("role_permissions")

  if (!users.fields.getByName("roles")) {
    users.fields.add(new Field({
      "name": "roles",
      "type": "relation",
      "collectionId": rolePermissions.id,
      "cascadeDelete": false,
      "maxSelect": 999,
      "minSelect": 0
    }))
  }
  app.save(users)

  const roleIds = Object.fromEntries(
    app.findAllRecords("role_permissions").map((record) => [record.getString("role"), record.id])
  )
  for (const user of app.findAllRecords("users")) {
    const legacyRole = user.getString("role")
    const existingRoles = user.get("roles") || []
    const roleId = roleIds[legacyRole]
    if (roleId && !existingRoles.includes(roleId)) {
      user.set("roles", [...existingRoles, roleId])
      app.save(user)
    }
  }

  const rp = "@collection.role_permissions"
  const assigned = `${rp}.id ?= @request.auth.roles.id`
  const isAdmin = `(${assigned} && ${rp}.role = 'admin')`
  const hasPermission = (permission) => `(${assigned} && ${rp}.${permission} ?= true)`
  const adminOr = (permission) => `${isAdmin} || ${hasPermission(permission)}`

  rolePermissions.listRule = "@request.auth.id != ''"
  rolePermissions.viewRule = "@request.auth.id != ''"
  rolePermissions.createRule = isAdmin
  rolePermissions.updateRule = `${isAdmin} && role != 'admin'`
  rolePermissions.deleteRule = `${isAdmin} && role != 'admin'`
  app.save(rolePermissions)

  users.listRule = `id = @request.auth.id || ${isAdmin}`
  users.viewRule = `id = @request.auth.id || ${isAdmin}`
  users.createRule = `${isAdmin} || (@request.body.role:isset = false && @request.body.roles:isset = false && @request.body.approved:isset = false && @request.body.crews:isset = false)`
  users.updateRule = `${isAdmin} || (id = @request.auth.id && @request.body.role:isset = false && @request.body.roles:isset = false && @request.body.approved:isset = false && @request.body.crews:isset = false)`
  users.deleteRule = isAdmin
  app.save(users)

  const projects = app.findCollectionByNameOrId("projects")
  projects.createRule = adminOr("createProject")
  projects.deleteRule = adminOr("deleteProject")
  projects.updateRule = `${isAdmin} || ${[
    "editAllgemein",
    "editDateien",
    "editMasten",
    "editAufmass",
    "editAbrechnung"
  ].map(hasPermission).join(" || ")}`
  const unrestricted = `${isAdmin} || (${assigned} && ${rp}.onlyAssignedProjects ?= false)`
  const projectVisibility = `${unrestricted} || (schedule_entries_via_project.crew ?= @request.auth.crews.id && (statuses ~ 'Geplant' || statuses ~ 'In Bearbeitung'))`
  projects.listRule = projectVisibility
  projects.viewRule = projectVisibility
  app.save(projects)

  const planRule = adminOr("editBauzeitenplan")
  for (const name of ["crews", "schedule_entries"]) {
    const collection = app.findCollectionByNameOrId(name)
    collection.createRule = planRule
    collection.updateRule = planRule
    collection.deleteRule = planRule
    if (name === "schedule_entries") {
      const entryVisibility = `${unrestricted} || (crew ?= @request.auth.crews.id)`
      collection.listRule = entryVisibility
      collection.viewRule = entryVisibility
    }
    app.save(collection)
  }
}, (app) => {
  const open = "@request.auth.id != ''"
  const rolePermissions = app.findCollectionByNameOrId("role_permissions")
  rolePermissions.listRule = open
  rolePermissions.viewRule = open
  rolePermissions.createRule = "@request.auth.role = 'admin'"
  rolePermissions.updateRule = "@request.auth.role = 'admin'"
  rolePermissions.deleteRule = "@request.auth.role = 'admin'"
  app.save(rolePermissions)

  const users = app.findCollectionByNameOrId("users")
  users.fields.removeByName("roles")
  users.listRule = "id = @request.auth.id || @request.auth.role = 'admin'"
  users.viewRule = "id = @request.auth.id || @request.auth.role = 'admin'"
  users.createRule = "@request.auth.role = 'admin' || (@request.body.role:isset = false && @request.body.approved:isset = false && @request.body.crews:isset = false)"
  users.updateRule = "@request.auth.role = 'admin' || (id = @request.auth.id && @request.body.role:isset = false && @request.body.approved:isset = false && @request.body.crews:isset = false)"
  users.deleteRule = "@request.auth.role = 'admin'"
  app.save(users)

  const rp = "@collection.role_permissions"
  const own = `${rp}.role ?= @request.auth.role`
  const unrestricted = `@request.auth.role = 'admin' || (${own} && ${rp}.onlyAssignedProjects ?= false)`
  const editProject = ["editAllgemein", "editDateien", "editMasten", "editAufmass", "editAbrechnung"]
    .map((permission) => `${rp}.${permission} ?= true`).join(" || ")
  const projects = app.findCollectionByNameOrId("projects")
  projects.listRule = `${unrestricted} || (schedule_entries_via_project.crew ?= @request.auth.crews.id && (statuses ~ 'Geplant' || statuses ~ 'In Bearbeitung'))`
  projects.viewRule = projects.listRule
  projects.createRule = `@request.auth.role = 'admin' || (${rp}.role ?= @request.auth.role && ${rp}.createProject ?= true)`
  projects.deleteRule = `@request.auth.role = 'admin' || (${rp}.role ?= @request.auth.role && ${rp}.deleteProject ?= true)`
  projects.updateRule = `@request.auth.role = 'admin' || (${own} && (${editProject}))`
  app.save(projects)

  for (const name of ["crews", "schedule_entries"]) {
    const collection = app.findCollectionByNameOrId(name)
    const planRule = `@request.auth.role = 'admin' || (${own} && ${rp}.editBauzeitenplan ?= true)`
    collection.createRule = planRule
    collection.updateRule = planRule
    collection.deleteRule = planRule
    if (name === "schedule_entries") {
      collection.listRule = `${unrestricted} || (crew ?= @request.auth.crews.id)`
      collection.viewRule = collection.listRule
    }
    app.save(collection)
  }
})
