/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const folders = app.findCollectionByNameOrId("file_folders")
  const adminRule = "@request.auth.role = 'admin'"
  folders.createRule = adminRule
  folders.updateRule = adminRule
  folders.deleteRule = adminRule
  app.save(folders)
}, (app) => {
  const folders = app.findCollectionByNameOrId("file_folders")
  const roles = "@collection.role_permissions"
  const assigned = `${roles}.id ?= @request.auth.roles.id`
  const isAdmin = `(${assigned} && ${roles}.role = 'admin')`
  folders.createRule = isAdmin
  folders.updateRule = isAdmin
  folders.deleteRule = isAdmin
  app.save(folders)
})
