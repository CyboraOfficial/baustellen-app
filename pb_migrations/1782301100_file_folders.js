/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const rolePermissions = app.findCollectionByNameOrId("role_permissions")
  const roles = "@collection.role_permissions"
  const assigned = `${roles}.id ?= @request.auth.roles.id`
  const isAdmin = `(${assigned} && ${roles}.role = 'admin')`

  const collection = new Collection({
    "type": "base",
    "name": "file_folders",
    "listRule": "@request.auth.id != ''",
    "viewRule": "@request.auth.id != ''",
    "createRule": isAdmin,
    "updateRule": isAdmin,
    "deleteRule": isAdmin,
    "fields": [
      { "name": "name", "type": "text", "required": true, "max": 120 },
      { "name": "securityLevel", "type": "number", "min": 1, "onlyInt": true },
      { "name": "sortOrder", "type": "number", "onlyInt": true }
    ],
    "indexes": ["CREATE UNIQUE INDEX idx_file_folders_name ON file_folders (name)"]
  })
  app.save(collection)

  const projects = app.findCollectionByNameOrId("projects")
  if (!projects.fields.getByName("fileFolders")) {
    projects.fields.add(new Field({
      "name": "fileFolders",
      "type": "json"
    }))
  }
  app.save(projects)
}, (app) => {
  const projects = app.findCollectionByNameOrId("projects")
  projects.fields.removeByName("fileFolders")
  app.save(projects)
  app.delete(app.findCollectionByNameOrId("file_folders"))
})
