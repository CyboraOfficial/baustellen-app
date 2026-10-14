/// <reference path="../pb_data/types.d.ts" />
onRecordCreate((e) => {
  e.record.set("status_changed_at", new Date().toISOString().replace("T", " "))
  e.next()
}, "projects")

onRecordUpdate((e) => {
  const statusChanged = e.record.get("status") !== e.record.original().get("status")
  const statusesChanged = JSON.stringify(e.record.get("statuses")) !== JSON.stringify(e.record.original().get("statuses"))
  if (statusChanged || statusesChanged) {
    e.record.set("status_changed_at", new Date().toISOString().replace("T", " "))
  }
  e.next()
}, "projects")
