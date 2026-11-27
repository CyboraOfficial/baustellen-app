/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  const collection = new Collection({
    name: "user_release_state",
    type: "base",
    indexes: ["CREATE UNIQUE INDEX idx_user_release_state_user ON user_release_state (user)"]
  })
  collection.fields.add(
    new RelationField({
      name: "user",
      collectionId: users.id,
      cascadeDelete: true,
      minSelect: 1,
      maxSelect: 1,
      required: true
    }),
    new TextField({ name: "version", required: true, max: 64 })
  )
  collection.listRule = '@request.auth.id != "" && user = @request.auth.id'
  collection.viewRule = '@request.auth.id != "" && user = @request.auth.id'
  return app.save(collection)
}, (app) => {
  app.delete(app.findCollectionByNameOrId("user_release_state"))
})
