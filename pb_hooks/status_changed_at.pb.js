/// <reference path="../pb_data/types.d.ts" />
onRecordCreate((e) => {
  e.record.set("status_changed_at", new Date().toISOString().replace("T", " "))
  e.next()
}, "projects")

onRecordUpdate((e) => {
  if (e.record.get("status") !== e.record.original().get("status")) {
    e.record.set("status_changed_at", new Date().toISOString().replace("T", " "))
  }
  e.next()
}, "projects")
