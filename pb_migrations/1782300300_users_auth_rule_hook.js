/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Die Freigabe wird jetzt im Hook user_approval.pb.js geprüft.
  const users = app.findCollectionByNameOrId("users")
  users.authRule = ""
  app.save(users)
}, (app) => {
  const users = app.findCollectionByNameOrId("users")
  users.authRule = "approved = true"
  app.save(users)
})
