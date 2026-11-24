/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("projects")

  collection.fields.add(new Field({
    "hidden": false,
    "id": "date391029010",
    "max": "",
    "min": "",
    "name": "status_changed_at",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  app.save(collection)

  // Bestehende Projekte starten mit ihrem letzten Änderungsdatum
  app.db().newQuery("UPDATE projects SET status_changed_at = updated").execute()
}, (app) => {
  const collection = app.findCollectionByNameOrId("projects")
  collection.fields.removeById("date391029010")
  return app.save(collection)
})
