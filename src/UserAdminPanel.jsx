import React, { useEffect, useState } from "react";
import { pb } from "./pocketbase";
import { ROLES, ROLE_LABELS, LEVEL_DEFS, BOOL_DEFS, DEFAULT_ROLE_PERMISSIONS, getLevel, levelToValues } from "./permissions";

const cell = { padding: "6px 8px", borderBottom: "1px solid #334155", textAlign: "left", fontSize: "13px" };
const btn = (bg) => ({ background: bg, color: "white", border: "none", borderRadius: "6px", padding: "6px 10px", cursor: "pointer", fontWeight: 600 });

export default function UserAdminPanel({ currentUserId, rolePerms = {}, onPermsChanged }) {
  const [users, setUsers] = useState([]);
  const [crews, setCrews] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState("monteur");

  const load = async () => {
    try {
      const [list, crewList] = await Promise.all([
        pb.collection("users").getFullList({ sort: "-created", requestKey: null }),
        pb.collection("crews").getFullList({ sort: "sortOrder,name", requestKey: null })
      ]);
      setUsers(list);
      setCrews(crewList);
    } catch (err) {
      setError("Benutzer konnten nicht geladen werden: " + err.message);
    }
  };

  useEffect(() => { load(); }, []);

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (err) {
      const detail = err?.response?.data
        ? Object.values(err.response.data).map((v) => v?.message).filter(Boolean).join(" ")
        : "";
      setError(detail || err.message);
    } finally {
      setBusy(false);
    }
  };

  const createUser = (e) => {
    e.preventDefault();
    run(async () => {
      await pb.collection("users").create({
        email: newEmail,
        password: newPass,
        passwordConfirm: newPass,
        emailVisibility: true,
        role: newRole,
        approved: true
      });
      setNewEmail("");
      setNewPass("");
    });
  };

  const update = (u, data) => run(() => pb.collection("users").update(u.id, data));

  const remove = (u) => {
    if (!window.confirm(`Benutzer ${u.email} wirklich löschen?`)) return;
    run(() => pb.collection("users").delete(u.id));
  };

  const setPerms = (role, values) => run(async () => {
    const existing = rolePerms[role];
    if (existing) {
      await pb.collection("role_permissions").update(existing.id, values);
    } else {
      await pb.collection("role_permissions").create({ ...DEFAULT_ROLE_PERMISSIONS[role], role, ...values });
    }
    await onPermsChanged?.();
  });

  const pending = users.filter((u) => !u.approved);
  const input = { className: "mast-input-base", style: { padding: "6px 8px" } };

  return (
    <div style={{ marginTop: "12px" }}>
      {error && <div role="alert" style={{ color: "#fca5a5", marginBottom: "8px" }}>{error}</div>}

      {pending.length > 0 && (
        <div style={{ background: "#422006", border: "1px solid #b45309", borderRadius: "8px", padding: "10px", marginBottom: "12px" }}>
          <strong>Offene Registrierungen ({pending.length})</strong>
          {pending.map((u) => (
            <div key={u.id} style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" }}>
              <span style={{ flex: 1, minWidth: "180px" }}>{u.email}</span>
              <select defaultValue={u.role || "monteur"} id={`role-${u.id}`} {...input}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              <button
                disabled={busy}
                style={btn("#16a34a")}
                onClick={() => update(u, { approved: true, role: document.getElementById(`role-${u.id}`).value })}
              >
                Freigeben
              </button>
              <button disabled={busy} style={btn("#dc2626")} onClick={() => remove(u)}>Ablehnen</button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={createUser} style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
        <input type="email" required placeholder="E-Mail" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} {...input} />
        <input type="password" required minLength={8} placeholder="Passwort (min. 8 Zeichen)" value={newPass} onChange={(e) => setNewPass(e.target.value)} {...input} />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value)} {...input}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <button type="submit" disabled={busy} style={btn("#0284c7")}>Benutzer anlegen</button>
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={cell}>E-Mail</th>
            <th style={cell}>Rolle</th>
            <th style={cell}>Truppen</th>
            <th style={cell}>Status</th>
            <th style={cell}></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <tr key={u.id}>
                <td style={cell}>{u.email}{isSelf ? " (du)" : ""}</td>
                <td style={cell}>
                  <select
                    value={u.role || ""}
                    disabled={busy || isSelf}
                    onChange={(e) => update(u, { role: e.target.value })}
                    {...input}
                  >
                    {!u.role && <option value="">–</option>}
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </td>
                <td style={cell}>
                  {crews.length === 0 && <span style={{ color: "#94a3b8" }}>Keine Truppen angelegt</span>}
                  {crews.map((c) => {
                    const assigned = (u.crews || []).includes(c.id);
                    return (
                      <label key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginRight: "10px", whiteSpace: "nowrap" }}>
                        <input
                          type="checkbox"
                          checked={assigned}
                          disabled={busy}
                          onChange={(e) => update(u, {
                            crews: e.target.checked
                              ? [...(u.crews || []), c.id]
                              : (u.crews || []).filter((id) => id !== c.id)
                          })}
                        />
                        {c.name}
                      </label>
                    );
                  })}
                </td>
                <td style={cell}>{u.approved ? "Freigegeben" : "Wartet auf Freigabe"}</td>
                <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>
                  {!isSelf && (
                    <>
                      <button
                        disabled={busy}
                        style={{ ...btn(u.approved ? "#b45309" : "#16a34a"), marginRight: "6px" }}
                        onClick={() => update(u, { approved: !u.approved })}
                      >
                        {u.approved ? "Sperren" : "Freigeben"}
                      </button>
                      <button disabled={busy} style={btn("#dc2626")} onClick={() => remove(u)}>Löschen</button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h4 style={{ margin: "18px 0 8px" }}>Berechtigungen je Rolle</h4>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cell}>Berechtigung</th>
              {ROLES.map((r) => <th key={r} style={{ ...cell, textAlign: "center" }}>{ROLE_LABELS[r]}</th>)}
            </tr>
          </thead>
          <tbody>
            {LEVEL_DEFS.map((def) => (
              <tr key={def.viewKey}>
                <td style={cell}>{def.label}</td>
                {ROLES.map((r) => {
                  const source = rolePerms[r] || DEFAULT_ROLE_PERMISSIONS[r];
                  const locked = r === "admin";
                  return (
                    <td key={r} style={{ ...cell, textAlign: "center" }}>
                      <select
                        value={locked ? "edit" : getLevel(source, def)}
                        disabled={busy || locked}
                        onChange={(e) => setPerms(r, levelToValues(def, e.target.value))}
                        {...input}
                      >
                        <option value="none">Kein Zugriff</option>
                        <option value="view">Nur ansehen</option>
                        <option value="edit">Bearbeiten</option>
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
            {BOOL_DEFS.map((p) => (
              <tr key={p.key}>
                <td style={cell}>{p.label}</td>
                {ROLES.map((r) => {
                  const source = rolePerms[r] || DEFAULT_ROLE_PERMISSIONS[r];
                  const locked = r === "admin";
                  return (
                    <td key={r} style={{ ...cell, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={r === "admin" ? p.key !== "onlyAssignedProjects" : !!source?.[p.key]}
                        disabled={busy || locked}
                        onChange={(e) => setPerms(r, { [p.key]: e.target.checked })}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: "8px", color: "#94a3b8", fontSize: "12px" }}>
        Admin hat immer alle Rechte und ist als einzige Rolle für die Benutzerverwaltung zuständig.
        „Nur zugeordnete Baustellen“: Benutzer dieser Rolle sehen nur Baustellen mit Status Geplant oder In Bearbeitung,
        die im Bauzeitenplan einer ihnen zugeordneten Truppe zugewiesen sind (ohne Zuordnung sehen sie nichts).
        Änderungen gelten für Benutzer nach dem nächsten Laden der App.
      </div>
    </div>
  );
}
