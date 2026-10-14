/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("projects")

  if (!collection.fields.getByName("statuses")) {
    collection.fields.add(new Field({
      "hidden": false,
      "id": "json578322401",
      "maxSize": 0,
      "name": "statuses",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "json"
    }))
    app.save(collection)
  }

  app.db()
    .newQuery("UPDATE projects SET statuses = json_array(CASE WHEN status IS NULL OR status = '' THEN 'Offen' ELSE status END) WHERE statuses IS NULL OR statuses = '' OR statuses = 'null'")
    .execute()
}, (app) => {
  const collection = app.findCollectionByNameOrId("projects")
  if (collection.fields.getByName("statuses")) {
    collection.fields.removeByName("statuses")
    return app.save(collection)
  }
})
