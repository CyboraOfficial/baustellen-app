/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const roles = app.findCollectionByNameOrId("role_permissions")
  if (!roles.fields.getByName("securityLevel")) {
    roles.fields.add(new Field({
      "name": "securityLevel",
      "type": "number",
      "min": 1,
      "onlyInt": true
    }))
  }
  app.save(roles)

  const defaults = {
    admin: 4,
    buero: 3,
    bauleiter: 2,
    monteur: 1
  }
  let fallbackLevel = Math.max(
    1,
    ...app.findAllRecords("role_permissions").map((record) =>
      Number(record.get("securityLevel")) || 0
    )
  )
  for (const record of app.findAllRecords("role_permissions")) {
    if (Number(record.get("securityLevel")) > 0) continue
    record.set("securityLevel", defaults[record.getString("role")] || fallbackLevel)
    app.save(record)
  }

  const users = app.findCollectionByNameOrId("users")
  if (!users.fields.getByName("defaultFileSecurityLevel")) {
    users.fields.add(new Field({
      "name": "defaultFileSecurityLevel",
      "type": "number",
      "min": 1,
      "onlyInt": true
    }))
  }
  app.save(users)

  const projects = app.findCollectionByNameOrId("projects")
  if (!projects.fields.getByName("fileSecurityLevels")) {
    projects.fields.add(new Field({
      "name": "fileSecurityLevels",
      "type": "json"
    }))
  }
  app.save(projects)
}, (app) => {
  const projects = app.findCollectionByNameOrId("projects")
  projects.fields.removeByName("fileSecurityLevels")
  app.save(projects)

  const users = app.findCollectionByNameOrId("users")
  users.fields.removeByName("defaultFileSecurityLevel")
  app.save(users)

  const roles = app.findCollectionByNameOrId("role_permissions")
  roles.fields.removeByName("securityLevel")
  app.save(roles)
})
