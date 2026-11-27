import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { flushSync } from "react-dom";
import { pb } from "./pocketbase";
import {
  ROLE_LABELS,
  LEVEL_DEFS,
  BOOL_DEFS,
  ALL_PERMISSION_KEYS,
  STATUS_OPTIONS,
  getLevel,
  levelToValues,
  getRoleSecurityLevel
} from "./permissions";
import "./UserAdminPanel.css";

export function MultiSelect({ options, selected, disabled, onChange, placeholder, summary, single = false }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({});
  const toggleRef = React.useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const updatePosition = () => {
      const rect = toggleRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuHeight = Math.min(options.length * 36 + 10, 280);
      const availableBelow = window.innerHeight - rect.bottom - 16;
      const availableAbove = rect.top - 16;
      const openAbove = availableBelow < menuHeight && availableAbove > availableBelow;
      setMenuStyle({
        left: `${Math.max(8, Math.min(rect.left, window.innerWidth - Math.min(rect.width, window.innerWidth - 16) - 8))}px`,
        width: `${Math.min(rect.width, window.innerWidth - 16)}px`,
        top: openAbove ? "auto" : `${rect.bottom + 4}px`,
        bottom: openAbove ? `${window.innerHeight - rect.top + 4}px` : "auto",
        maxHeight: `${Math.max(80, Math.min(280, openAbove ? availableAbove : availableBelow))}px`
      });
    };
    const closeOnOutside = (event) => {
      if (!toggleRef.current?.contains(event.target) && !event.target.closest?.(".admin-crew-menu")) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open, options.length]);

  return (
    <div className="admin-crew-picker">
      <button
        ref={toggleRef}
        type="button"
        className="admin-crew-toggle"
        aria-expanded={open}
        aria-label={`${placeholder}: ${selected.length ? summary(selected) : "Keine Auswahl"}`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected.length ? summary(selected) : placeholder}</span>
        <span className={`admin-crew-chevron${open ? " is-open" : ""}`} aria-hidden="true">▾</span>
      </button>
      {open && createPortal(
        <div className="admin-crew-menu" style={menuStyle}         role="group" aria-label={placeholder}>
                  {options.map((option) => single ? (
            <button
              type="button"
              className={`admin-crew-option admin-crew-option-single${selected.includes(option.id) ? " is-selected" : ""}`}
              key={option.id}
              onClick={() => { onChange(option.id, true); setOpen(false); }}
            >
              <span>{option.label}</span>
              {selected.includes(option.id) && <span aria-hidden="true">✓</span>}
            </button>
          ) : (
                    <label className="admin-crew-option" key={option.id}>
              <input
                type="checkbox"
                        checked={selected.includes(option.id)}
                disabled={disabled}
                        onChange={(event) => onChange(option.id, event.target.checked)}
              />
                      <span>{option.label}</span>
            </label>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

export default function UserAdminPanel({ currentUserId, rolePerms = {}, onPermsChanged }) {
  const [users, setUsers] = useState([]);
  const [crews, setCrews] = useState([]);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRoles, setNewRoles] = useState(null);
  const [createPopupOpen, setCreatePopupOpen] = useState(false);
  const createButtonRef = React.useRef(null);
  const [newRoleName, setNewRoleName] = useState("");
  const [securityPopupOpen, setSecurityPopupOpen] = useState(false);
  const [securityOrder, setSecurityOrder] = useState(null);
  const [securityDrag, setSecurityDrag] = useState(null);

  const load = async () => {
    try {
      const [list, crewList, roleList] = await Promise.all([
        pb.collection("users").getFullList({ sort: "-created", requestKey: null }),
        pb.collection("crews").getFullList({ sort: "sortOrder,name", requestKey: null }),
        pb.collection("role_permissions").getFullList({ sort: "role", requestKey: null })
      ]);
      setUsers(list);
      setCrews(crewList);
      setRoles([...roleList].sort((a, b) => {
        if (a.role === "admin") return -1;
        if (b.role === "admin") return 1;
        return getRoleSecurityLevel(b) - getRoleSecurityLevel(a)
          || a.role.localeCompare(b.role, "de");
      }));
      setNewRoles((current) => current === null
        ? roleList.filter((role) => role.role === "monteur").map((role) => role.id)
        : current);
    } catch (err) {
      setError("Benutzer und Rollen konnten nicht geladen werden: " + err.message);
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
        roles: newRoles || [],
        approved: true
      });
      closeCreatePopup();
    });
  };

  const closeCreatePopup = () => {
    setCreatePopupOpen(false);
    setNewEmail("");
    setNewPass("");
    setNewRoles(roles.filter((role) => role.role === "monteur").map((role) => role.id));
    setError("");
    createButtonRef.current?.focus();
  };

  const update = (u, data) => run(() => pb.collection("users").update(u.id, data));

  const updateUserRoles = (u, roleId, checked) => {
    const currentRoles = u.roles || [];
    const nextRoles = checked
      ? [...new Set([...currentRoles, roleId])]
      : currentRoles.filter((id) => id !== roleId);
    update(u, { roles: nextRoles, role: "" });
  };

  const remove = (u) => {
    if (!window.confirm(`Benutzer ${u.email} wirklich löschen?`)) return;
    run(() => pb.collection("users").delete(u.id));
  };

  const createRole = (e) => {
    e.preventDefault();
    const name = newRoleName.trim();
    if (!name) return;
    run(async () => {
      const permissions = Object.fromEntries(ALL_PERMISSION_KEYS.map((key) => [key, false]));
      await pb.collection("role_permissions").create({ role: name, securityLevel: 1, ...permissions });
      setNewRoleName("");
      await onPermsChanged?.();
    });
  };

  const deleteRole = (role) => {
    if (role.role === "admin") {
      setError("Die Admin-Rolle kann nicht gelöscht werden.");
      return;
    }
    if (users.some((u) => (u.roles || []).includes(role.id))) {
      setError(`Die Rolle „${role.role}“ ist noch Benutzern zugewiesen. Entferne sie zuerst bei allen Benutzern.`);
      return;
    }
    if (!window.confirm(`Rolle „${role.role}“ wirklich löschen?`)) return;
    run(async () => {
      try {
        await pb.collection("role_permissions").delete(role.id);
      } catch (err) {
        if (err?.status !== 404) throw err;
        const currentRoles = await pb.collection("role_permissions").getFullList({ sort: "role", requestKey: null });
        setRoles(currentRoles);
        if (currentRoles.some((currentRole) => currentRole.id === role.id)) {
          throw new Error("PocketBase hat das Löschen abgelehnt (404). Die Rolle existiert noch; bitte Admin-Anmeldung und Löschberechtigung prüfen.");
        }
      }
      setNewRoles((current) => (current || []).filter((id) => id !== role.id));
      await onPermsChanged?.();
    });
  };

  const setPerms = (role, values) => run(async () => {
    await pb.collection("role_permissions").update(role.id, values);
    await onPermsChanged?.();
  });

  const saveSecurityOrder = (orderedRoles) => run(async () => {
    const admin = orderedRoles.find((role) => role.role === "admin");
    const highestLevel = Math.max(
      orderedRoles.length,
      admin ? getRoleSecurityLevel(admin) : 1,
      ...orderedRoles.map(getRoleSecurityLevel)
    );
    await Promise.all(orderedRoles
      .filter((role) => role.role !== "admin")
      .map((role, index) =>
        pb.collection("role_permissions").update(role.id, {
          securityLevel: Math.max(1, highestLevel - index - 1)
        })
      ));
    await onPermsChanged?.();
  });

  const moveSecurityRole = (role, direction) => {
    if (role.role === "admin") return;
    const ordered = [...orderedSecurityRoles];
    const index = ordered.findIndex((item) => item.id === role.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex <= 0 || targetIndex >= ordered.length) return;
    [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
    updateSecurityOrderWithAnimation(ordered);
    saveSecurityOrder(ordered);
  };

  const pending = users.filter((u) => !u.approved);
  const input = "admin-input";
  const roleLabel = (role) => ROLE_LABELS[role.role] || role.role;

  const roleOptions = roles.map((role) => ({ id: role.id, label: roleLabel(role) }));
  const roleSummary = (ids) => ids.map((id) => roleOptions.find((o) => o.id === id)?.label).filter(Boolean).join(", ");
  const crewOptions = crews.map((crew) => ({ id: crew.id, label: crew.name }));
  const orderedSecurityRoles = securityOrder
    ? securityOrder.map((id) => roles.find((role) => role.id === id)).filter(Boolean)
    : [...roles].sort((a, b) => {
      if (a.role === "admin") return -1;
      if (b.role === "admin") return 1;
      return getRoleSecurityLevel(b) - getRoleSecurityLevel(a);
    });

  const openSecurityPopup = () => {
    setSecurityOrder([...roles]
      .sort((a, b) => {
        if (a.role === "admin") return -1;
        if (b.role === "admin") return 1;
        return getRoleSecurityLevel(b) - getRoleSecurityLevel(a);
      })
      .map((role) => role.id));
    setSecurityPopupOpen(true);
  };

  const closeSecurityPopup = () => {
    setSecurityPopupOpen(false);
    setSecurityOrder(null);
    setSecurityDrag(null);
  };

  const updateSecurityOrderWithAnimation = (nextRoles) => {
    const commit = () => flushSync(() => {
      setSecurityOrder(nextRoles.map((role) => role.id));
    });
    if (document.startViewTransition) {
      document.startViewTransition(commit);
    } else {
      commit();
    }
  };

  const moveDraggedRole = (targetId) => {
    if (!securityDrag || targetId === securityDrag.id) return;
    const order = securityOrder || orderedSecurityRoles.map((role) => role.id);
    const sourceIndex = order.indexOf(securityDrag.id);
    const targetIndex = order.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex <= 0 || sourceIndex === targetIndex) return;
    const next = [...order];
    next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, securityDrag.id);
    updateSecurityOrderWithAnimation(
      next.map((id) => roles.find((role) => role.id === id)).filter(Boolean)
    );
  };

  const renderRoleCheckboxes = (user, disabled = false) => (
    <MultiSelect
      options={roleOptions}
      selected={user.roles || []}
      disabled={busy || disabled}
      placeholder="Rollen auswählen"
      summary={roleSummary}
      onChange={(roleId, checked) => updateUserRoles(user, roleId, checked)}
    />
  );

  return (
    <div className="user-admin-panel">
      {error && !createPopupOpen && <div role="alert" className="admin-error">{error}</div>}

      {pending.length > 0 && (
        <div className="admin-pending">
          <strong>Offene Registrierungen ({pending.length})</strong>
          {pending.map((u) => (
            <div key={u.id} className="admin-pending-row">
              <span className="admin-pending-email">{u.email}</span>
              <div>{renderRoleCheckboxes(u)}</div>
              <button
                disabled={busy || !(u.roles || []).length}
                className="admin-button admin-button-success"
                onClick={() => update(u, { approved: true })}
              >
                Freigeben
              </button>
              <button disabled={busy} className="admin-button admin-button-danger" onClick={() => remove(u)}>Ablehnen</button>
            </div>
          ))}
        </div>
      )}

      <button
        ref={createButtonRef}
        type="button"
        className="admin-button admin-button-primary admin-create-trigger"
        onClick={() => { setError(""); setCreatePopupOpen(true); }}
      >
        Benutzer anlegen
      </button>

      {createPopupOpen && createPortal(
        <div className="admin-security-overlay admin-create-overlay" role="presentation" onMouseDown={() => {
          if (!busy) closeCreatePopup();
        }}>
          <section
            className="admin-security-dialog admin-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-create-title"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                if (!busy) closeCreatePopup();
              } else if (event.key === "Tab") {
                const controls = Array.from(event.currentTarget.querySelectorAll("input:not(:disabled), button:not(:disabled)"));
                const picker = event.currentTarget.querySelector(".admin-crew-toggle");
                const menu = document.querySelector(".admin-crew-menu");
                if (picker && menu) {
                  controls.splice(controls.indexOf(picker) + 1, 0,
                    ...menu.querySelectorAll("input:not(:disabled), button:not(:disabled)"));
                }
                const index = controls.indexOf(document.activeElement);
                event.preventDefault();
                controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
              }
            }}
          >
            <div className="admin-security-header">
              <h3 id="admin-create-title">Benutzer anlegen</h3>
              <button type="button" className="admin-security-close" aria-label="Popup schließen"
                disabled={busy} onClick={closeCreatePopup}>×</button>
            </div>
            {error && <div role="alert" className="admin-error">{error}</div>}
            <form onSubmit={createUser} className="admin-create-user">
              <label htmlFor="admin-create-email">E-Mail</label>
              <input id="admin-create-email" type="email" required autoFocus autoComplete="email"
                value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className={input} />
              <label htmlFor="admin-create-password">Passwort</label>
              <input id="admin-create-password" type="password" required minLength={8} autoComplete="new-password"
                placeholder="Mindestens 8 Zeichen" value={newPass} onChange={(e) => setNewPass(e.target.value)} className={input} />
              <span id="admin-create-roles-label">Rollen</span>
              <div className="admin-create-roles" aria-labelledby="admin-create-roles-label">
                <MultiSelect
                  options={roleOptions}
                  selected={newRoles || []}
                  disabled={busy}
                  placeholder="Rollen auswählen"
                  summary={roleSummary}
                  onChange={(roleId, checked) => setNewRoles((current) => checked
                    ? [...new Set([...(current || []), roleId])]
                    : (current || []).filter((id) => id !== roleId))}
                />
              </div>
              <div className="admin-create-actions">
                <button type="button" disabled={busy} className="admin-button admin-button-secondary" onClick={closeCreatePopup}>Abbrechen</button>
                <button type="submit" disabled={busy || !(newRoles || []).length} className="admin-button admin-button-primary">
                  {busy ? "Wird angelegt…" : "Benutzer anlegen"}
                </button>
              </div>
            </form>
          </section>
        </div>,
        document.body
      )}

      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>E-Mail</th>
              <th>Rollen</th>
              <th>Truppen</th>
              <th>Status</th>
              <th aria-label="Aktionen"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <tr key={u.id}>
                  <td>{u.email}{isSelf ? " (du)" : ""}</td>
                  <td className="admin-role-cell">{renderRoleCheckboxes(u, isSelf)}</td>
                  <td>
                    {crews.length === 0
                      ? <span className="admin-muted">Keine Truppen angelegt</span>
                      : <MultiSelect
                        options={crewOptions}
                        selected={u.crews || []}
                        disabled={busy}
                        placeholder="Truppen auswählen"
                        summary={(ids) => `${ids.length} Truppe${ids.length === 1 ? "" : "n"} ausgewählt`}
                        onChange={(crewId, checked) => update(u, {
                          crews: checked
                            ? [...new Set([...(u.crews || []), crewId])]
                            : (u.crews || []).filter((id) => id !== crewId)
                        })}
                      />}
                  </td>
                  <td>{u.approved ? "Freigegeben" : "Wartet auf Freigabe"}</td>
                  <td className="admin-actions-cell">
                    {!isSelf && (
                      <>
                        <button
                          disabled={busy}
                          className={`admin-button ${u.approved ? "admin-button-warning" : "admin-button-success"}`}
                          onClick={() => update(u, { approved: !u.approved })}
                        >
                          {u.approved ? "Sperren" : "Freigeben"}
                        </button>
                        <button disabled={busy} className="admin-button admin-button-danger" onClick={() => remove(u)}>Löschen</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h4 className="admin-section-title">Berechtigungen je Rolle</h4>
      <div className="admin-table-scroll">
        <table className="admin-table admin-permissions-table">
          <thead>
            <tr>
              <th>Berechtigung</th>
              {roles.map((role) => <th key={role.id} className="admin-centered">{roleLabel(role)}</th>)}
            </tr>
          </thead>
          <tbody>
            {LEVEL_DEFS.map((def) => (
              <tr key={def.viewKey}>
                <td>{def.label}</td>
                {roles.map((role) => {
                  const source = rolePerms[role.id] || role;
                  const locked = role.role === "admin";
                  return (
                    <td key={role.id} className="admin-centered">
                      <select
                        value={locked ? "edit" : getLevel(source, def)}
                        disabled={busy || locked}
                        onChange={(e) => setPerms(role, levelToValues(def, e.target.value))}
                        className={input}
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
                <td>{p.label}</td>
                {roles.map((role) => {
                  const source = rolePerms[role.id] || role;
                  const locked = role.role === "admin";
                  return (
                    <td key={role.id} className="admin-centered">
                      <input
                        type="checkbox"
                        checked={locked ? p.key !== "onlyAssignedProjects" : !!source[p.key]}
                        disabled={busy || locked}
                        onChange={(e) => setPerms(role, { [p.key]: e.target.checked })}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td>Sichtbare Status</td>
              {roles.map((role) => {
                const source = rolePerms[role.id] || role;
                const locked = role.role === "admin";
                const stored = Array.isArray(source.visibleStatuses) ? source.visibleStatuses : [];
                const selected = locked || stored.length === 0 ? STATUS_OPTIONS.map((o) => o.id) : stored;
                return (
                  <td key={role.id} className="admin-centered">
                    <MultiSelect
                      options={STATUS_OPTIONS}
                      selected={selected}
                      disabled={busy || locked}
                      placeholder="Status auswählen"
                      summary={(ids) => ids.length === STATUS_OPTIONS.length ? "Alle Status" : `${ids.length} von ${STATUS_OPTIONS.length} Status`}
                      onChange={(id, checked) => {
                        const next = checked ? [...new Set([...selected, id])] : selected.filter((s) => s !== id);
                        if (next.length === 0) return;
                        setPerms(role, { visibleStatuses: next.length === STATUS_OPTIONS.length ? [] : next });
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="admin-help">
        Admin hat immer alle Rechte und ist als einzige Rolle für die Benutzerverwaltung zuständig.
        Bei mehreren Rollen werden Berechtigungen addiert. „Nur zugeordnete Baustellen“ greift nur,
        wenn alle Rollen des Benutzers auf zugeordnete Baustellen beschränkt sind.
        Änderungen gelten für Benutzer nach dem nächsten Laden der App.
      </div>

      <h4 className="admin-section-title">Rollen verwalten</h4>
      <form onSubmit={createRole} className="admin-role-bar">
        <input
          required
          maxLength={80}
          placeholder="Name der neuen Rolle"
          value={newRoleName}
          onChange={(e) => setNewRoleName(e.target.value)}
        />
        <button type="submit" disabled={busy || !newRoleName.trim()}>Anlegen</button>
      </form>
      <div className="admin-role-list">
        {roles.map((role) => (
          <div key={role.id} className="admin-role-chip">
            <span>{roleLabel(role)}</span>
            <span className="admin-security-badge" title="Sicherheitsstufe">Stufe {getRoleSecurityLevel(role)}</span>
            {role.role === "admin"
              ? <span className="admin-muted admin-small">System</span>
              : (
                <button
                  type="button"
                  disabled={busy}
                  className="admin-chip-remove"
                  title="Rolle löschen"
                  aria-label={`Rolle ${roleLabel(role)} löschen`}
                  onClick={() => deleteRole(role)}
                >
                  ×
                </button>
              )}
          </div>
        ))}
        <button
          type="button"
          className="admin-button admin-button-primary"
          onClick={openSecurityPopup}
        >
          Sicherheitsstufen anordnen
        </button>
      </div>

      {securityPopupOpen && createPortal(
        <div className="admin-security-overlay" role="presentation" onMouseDown={closeSecurityPopup}>
          <section
            className="admin-security-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-security-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="admin-security-header">
              <div>
                <h3 id="admin-security-title">Sicherheitsstufen der Rollen</h3>
                <p>Oben ist die höchste Priorität. Eine Rolle sieht ihre eigene Stufe und alle darunter.</p>
              </div>
              <button
                type="button"
                className="admin-security-close"
                aria-label="Popup schließen"
                onClick={closeSecurityPopup}
              >
                ×
              </button>
            </div>
            <div className="admin-security-order">
              {orderedSecurityRoles.map((role, index, orderedRoles) => (
                  <div
                    key={role.id}
                    className={`admin-security-role${securityDrag?.id === role.id ? " is-dragging" : ""}`}
                    style={{ viewTransitionName: `security-role-${role.id}` }}
                    draggable={!busy && role.role !== "admin"}
                    onDragStart={(event) => {
                      const transparentDragImage = document.createElement("canvas");
                      transparentDragImage.width = 1;
                      transparentDragImage.height = 1;
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", role.id);
                      event.dataTransfer.setDragImage(transparentDragImage, 0, 0);
                      setSecurityDrag({ id: role.id, x: event.clientX, y: event.clientY });
                    }}
                    onDrag={(event) => {
                      if (event.clientX || event.clientY) {
                        setSecurityDrag((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current);
                      }
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      moveDraggedRole(role.id);
                    }}
                    onDrop={(event) => event.preventDefault()}
                    onDragEnd={() => {
                      if (securityDrag && securityOrder) saveSecurityOrder(orderedSecurityRoles);
                      setSecurityDrag(null);
                    }}
                  >
                    <span className="admin-security-grip" aria-hidden="true">☰</span>
                    <span className="admin-security-level">
                      {index === 0 ? getRoleSecurityLevel(role) : Math.max(1, orderedRoles.length - index)}
                    </span>
                    <strong>{roleLabel(role)}</strong>
                    <div className="admin-security-move">
                      <button
                        type="button"
                        disabled={busy || role.role === "admin" || index === 1}
                        aria-label={`${roleLabel(role)} eine Stufe nach oben`}
                        onClick={() => moveSecurityRole(role, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={busy || role.role === "admin" || index === orderedRoles.length - 1}
                        aria-label={`${roleLabel(role)} eine Stufe nach unten`}
                        onClick={() => moveSecurityRole(role, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                  ))}
            </div>
            <div className="admin-security-footer">
              <span>Ziehen oder die Pfeile verwenden, um Reihenfolge und Zahl neu zu vergeben.</span>
              <button type="button" className="admin-button admin-button-primary" onClick={closeSecurityPopup}>
                Fertig
              </button>
            </div>
          </section>
        </div>,
        document.body
      )}
      {securityDrag && createPortal(
        <div
          className="admin-security-drag-preview"
          style={{ left: securityDrag.x, top: securityDrag.y }}
          aria-hidden="true"
        >
          <span className="admin-security-grip">☰</span>
          <span className="admin-security-level">
            {Math.max(1, orderedSecurityRoles.length - orderedSecurityRoles.findIndex((role) => role.id === securityDrag.id))}
          </span>
          <strong>{roleLabel(roles.find((role) => role.id === securityDrag.id))}</strong>
        </div>,
        document.body
      )}
    </div>
  );
}
