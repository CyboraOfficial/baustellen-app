/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  const collection = new Collection({
    "indexes": [
      "CREATE UNIQUE INDEX idx_notification_dismissals_user_key ON notification_dismissals (user, notification_key)"
    ],
    "name": "notification_dismissals",
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
    new TextField({
      "name": "notification_key",
      "required": true,
      "max": 255
    }),
    new NumberField({
      "name": "dismissed_at",
      "required": true
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
  const collection = app.findCollectionByNameOrId("notification_dismissals")
  return app.delete(collection)
})
