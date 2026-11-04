/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("user_settings")
  collection.updateRule = '@request.auth.id != "" && user = @request.auth.id && (@request.body.user:isset = false || @request.body.user = @request.auth.id)'
  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("user_settings")
  collection.updateRule = '@request.auth.id != "" && user = @request.auth.id && @request.body.user = @request.auth.id'
  return app.save(collection)
})
