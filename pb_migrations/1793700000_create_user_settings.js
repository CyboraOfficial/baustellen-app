/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  const collection = new Collection({
    "indexes": [
      "CREATE UNIQUE INDEX idx_user_settings_user ON user_settings (user)"
    ],
    "name": "user_settings",
    "type": "base"
  })
  collection.fields.add(
    new RelationField({
      "name": "user",
      "collectionId": users.id,
      "cascadeDelete": true,
      "minSelect": 1,
      "maxSelect": 1,
      "required": true
    }),
    new JSONField({
      "name": "data",
      "maxSize": 100000
    })
  )

  app.save(collection)
  collection.createRule = '@request.auth.id != "" && @request.body.user = @request.auth.id'
  collection.listRule = '@request.auth.id != "" && user = @request.auth.id'
  collection.viewRule = '@request.auth.id != "" && user = @request.auth.id'
  collection.updateRule = '@request.auth.id != "" && user = @request.auth.id && @request.body.user = @request.auth.id'
  collection.deleteRule = '@request.auth.id != "" && user = @request.auth.id'
  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("user_settings")
  return app.delete(collection)
})
