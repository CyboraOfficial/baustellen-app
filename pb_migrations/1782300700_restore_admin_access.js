/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const adminRole = app.findFirstRecordByFilter("role_permissions", "role = 'admin'")
  const users = app.findAllRecords("users")

  for (const user of users) {
    const roles = user.get("roles") || []
    if (!roles.includes(adminRole.id)) {
      user.set("roles", [...roles, adminRole.id])
      app.save(user)
    }
  }
}, (app) => {
  const adminRole = app.findFirstRecordByFilter("role_permissions", "role = 'admin'")

  for (const user of app.findAllRecords("users")) {
    if (user.getString("role") !== "admin") {
      const roles = (user.get("roles") || []).filter((roleId) => roleId !== adminRole.id)
      user.set("roles", roles)
      app.save(user)
    }
  }
})
