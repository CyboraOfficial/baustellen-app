/// <reference path="../pb_data/types.d.ts" />
routerAdd("POST", "/api/app/release-state", (e) => {
  const body = e.requestInfo().body
  const version = body.version
  const operation = body.operation
  if (typeof version !== "string" ||
      version.length > 64 ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
      !["initialize", "acknowledge"].includes(operation)) {
    throw new BadRequestError("Ungültiger Versionsstand.")
  }

  const compare = (left, right) => {
    const a = left.split(".")
    const b = right.split(".")
    for (let i = 0; i < 3; i++) {
      if (a[i].length !== b[i].length) return a[i].length < b[i].length ? -1 : 1
      if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
    }
    return 0
  }

  let savedVersion
  e.app.runInTransaction((txApp) => {
    const records = txApp.findRecordsByFilter(
      "user_release_state", "user = {:user}", "", 1, 0, { user: e.auth.id }
    )
    let record = records[0]
    if (!record) {
      record = new Record(txApp.findCollectionByNameOrId("user_release_state"))
      record.set("user", e.auth.id)
      record.set("version", version)
      txApp.save(record)
    } else if (operation === "acknowledge" && compare(version, record.getString("version")) > 0) {
      record.set("version", version)
      txApp.save(record)
    }
    savedVersion = record.getString("version")
  })
  return e.json(200, { version: savedVersion })
}, $apis.requireAuth())
