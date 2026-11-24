/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const perms = app.findCollectionByNameOrId("role_permissions")
  if (!perms.fields.getByName("visibleStatuses")) {
    // Leer = alle Status sichtbar
    perms.fields.add(new Field({ "name": "visibleStatuses", "type": "json", "maxSize": 20000 }))
  }
  app.save(perms)
}, (app) => {
  const perms = app.findCollectionByNameOrId("role_permissions")
  perms.fields.removeByName("visibleStatuses")
  app.save(perms)
})
