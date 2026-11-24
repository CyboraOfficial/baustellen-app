/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3910284772")

  const projectField = collection.fields.getById
    ? collection.fields.getById("relation391029002")
    : collection.fields.findById("relation391029002")
  if (projectField) {
    projectField.required = false
  }

  // add field
  collection.fields.addAt(5, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text391029009",
    "max": 0,
    "min": 0,
    "name": "color",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3910284772")

  const projectField = collection.fields.getById
    ? collection.fields.getById("relation391029002")
    : collection.fields.findById("relation391029002")
  if (projectField) {
    projectField.required = true
  }

  collection.fields.removeById("text391029009")

  return app.save(collection)
})
