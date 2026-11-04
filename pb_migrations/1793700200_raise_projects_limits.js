/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("projects")

  // Bisher maximal 10 Dateien pro Projekt; weitere Uploads wurden mit 400 abgelehnt
  collection.fields.getByName("files").maxSelect = 99

  // maxSize 0 entspricht dem Standardlimit von 1 MiB; das Aktivitätslog erreicht dieses bereits
  for (const name of ["log", "masten", "aufmass", "leuchten", "lampen"]) {
    const field = collection.fields.getByName(name)
    if (field && field.type() === "json") field.maxSize = 20 * 1024 * 1024
  }

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("projects")
  collection.fields.getByName("files").maxSelect = 10
  for (const name of ["log", "masten", "aufmass", "leuchten", "lampen"]) {
    const field = collection.fields.getByName(name)
    if (field && field.type() === "json") field.maxSize = 0
  }
  return app.save(collection)
})
