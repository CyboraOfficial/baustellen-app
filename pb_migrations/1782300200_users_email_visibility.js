/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Ohne emailVisibility sieht auch ein Admin die E-Mail anderer Benutzer nicht.
  app.db()
    .newQuery("UPDATE users SET emailVisibility = 1")
    .execute()
}, (app) => {
})
