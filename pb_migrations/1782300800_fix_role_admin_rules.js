/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const rolePermissions = app.findCollectionByNameOrId("role_permissions")
  const users = app.findCollectionByNameOrId("users")
  const adminRole = app.findFirstRecordByFilter("role_permissions", "role = 'admin'")

  for (const user of app.findAllRecords("users")) {
    const assignedRoles = user.get("roles") || []
    if (!assignedRoles.includes(adminRole.id) || user.getString("role") !== "admin") {
      user.set("roles", [...new Set([...assignedRoles, adminRole.id])])
      user.set("role", "admin")
      app.save(user)
    }
  }

  const rp = "@collection.role_permissions"
  const assigned = `${rp}.id ?= @request.auth.roles.id`
  const isAdmin = `(@request.auth.role = 'admin' || (${assigned} && ${rp}.role = 'admin'))`
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
})
