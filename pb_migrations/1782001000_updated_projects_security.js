/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_484305853")

  collection.listRule = "@request.auth.id != ''"
  collection.viewRule = "@request.auth.id != ''"
  collection.createRule = "@request.auth.id != ''"
  collection.updateRule = "@request.auth.id != ''"
  collection.deleteRule = "@request.auth.id != ''"

  const fileField = collection.fields.findById
    ? collection.fields.findById("file104153177")
    : (collection.fields.getById ? collection.fields.getById("file104153177") : null)

  if (fileField) {
    fileField.protected = true
  }

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_484305853")

  collection.listRule = null
  collection.viewRule = null
  collection.createRule = null
  collection.updateRule = null
  collection.deleteRule = null

  const fileField = collection.fields.findById
    ? collection.fields.findById("file104153177")
    : (collection.fields.getById ? collection.fields.getById("file104153177") : null)

  if (fileField) {
    fileField.protected = false
  }

  return app.save(collection)
})
