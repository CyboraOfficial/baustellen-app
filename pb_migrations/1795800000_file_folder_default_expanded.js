/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const folders = app.findCollectionByNameOrId("file_folders")
  if (!folders.fields.getByName("defaultExpanded")) {
    folders.fields.add(new Field({
      "name": "defaultExpanded",
      "type": "bool",
      "default": true
    }))
  }
  app.save(folders)

  for (const folder of app.findAllRecords("file_folders")) {
    folder.set("defaultExpanded", true)
    app.save(folder)
  }
}, (app) => {
  const folders = app.findCollectionByNameOrId("file_folders")
  folders.fields.removeByName("defaultExpanded")
  app.save(folders)
})
