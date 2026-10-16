/// <reference path="../pb_data/types.d.ts" />
// Läuft erst nach erfolgreicher Passwortprüfung, so kann die App
// "Passwort falsch" (400) von "noch nicht freigeschaltet" (403) unterscheiden.
onRecordAuthRequest((e) => {
  if (!e.record.getBool("approved")) {
    throw new ForbiddenError("Das Konto wurde noch nicht freigeschaltet.")
  }
  e.next()
}, "users")
