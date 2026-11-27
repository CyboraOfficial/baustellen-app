import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import changelog from "../APP_CHANGELOG.md?raw";
import { pb } from "./pocketbase";
import { compareVersions, parseReleaseNotes, releaseHistory, unreadReleaseNotes } from "./releaseNotes.mjs";

const currentVersion = __APP_VERSION__;
const sections = parseReleaseNotes(changelog);

export default function ReleaseNotesDialog({ userId, historyOpen = false, onCloseHistory }) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [dismissedFor, setDismissedFor] = useState(null);

  useEffect(() => {
    let active = true;
    let unsubscribe;
    setSnapshot(null);
    setError("");
    setDismissedFor(null);
    if (!userId) return undefined;

    const acceptVersion = (version) => {
      if (!active) return;
      setSnapshot((previous) => {
        if (previous?.userId === userId && compareVersions(previous.version, version) >= 0) return previous;
        return { userId, version };
      });
    };

    const initialize = async () => {
      try {
        unsubscribe = await pb.collection("user_release_state").subscribe("*", (event) => {
          if (event.action !== "delete" && event.record?.user === userId) {
            acceptVersion(event.record.version);
          }
        });
        if (!active) {
          unsubscribe();
          return;
        }
        const result = await pb.send("/api/app/release-state", {
          method: "POST",
          body: { operation: "initialize", version: currentVersion },
          requestKey: null
        });
        acceptVersion(result.version);
      } catch (err) {
        if (active) {
          console.error("Versionshinweise konnten nicht geladen werden:", err);
          setError("Die Versionshinweise konnten nicht geladen werden. Bitte erneut versuchen.");
        }
      }
    };
    initialize();

    return () => {
      active = false;
      if (unsubscribe) unsubscribe();
    };
  }, [userId, retry]);

  const seenVersion = snapshot?.userId === userId ? snapshot.version : null;
  const notes = useMemo(
    () => seenVersion ? unreadReleaseNotes(sections, seenVersion, currentVersion) : [],
    [seenVersion]
  );
  const needsUpdate = seenVersion && compareVersions(seenVersion, currentVersion) < 0;

  useEffect(() => {
    if (!userId || !needsUpdate || notes.length || error) return undefined;
    let active = true;
    pb.send("/api/app/release-state", {
      method: "POST",
      body: { operation: "acknowledge", version: currentVersion },
      requestKey: null
    }).then((result) => {
      if (active) setSnapshot((previous) => previous?.userId === userId
        && compareVersions(previous.version, result.version) < 0
        ? { userId, version: result.version }
        : previous);
    }).catch((err) => {
      if (active) {
        console.error("Versionsstand konnte nicht gespeichert werden:", err);
        setError("Der Versionsstand konnte nicht gespeichert werden. Bitte erneut versuchen.");
      }
    });
    return () => { active = false; };
  }, [userId, needsUpdate, notes.length, error]);

  const acknowledge = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await pb.send("/api/app/release-state", {
        method: "POST",
        body: { operation: "acknowledge", version: currentVersion },
        requestKey: null
      });
      setSnapshot((previous) => previous?.userId === userId
        && compareVersions(previous.version, result.version) < 0
        ? { userId, version: result.version }
        : previous);
    } catch (err) {
      console.error("Versionshinweise konnten nicht bestätigt werden:", err);
      setError("Die Bestätigung konnte nicht gespeichert werden. Bitte erneut versuchen.");
    } finally {
      setSaving(false);
    }
  };

  if (!userId || (!historyOpen && (dismissedFor === userId || (!error && (!needsUpdate || notes.length === 0))))) return null;

  const displayedNotes = historyOpen ? releaseHistory(sections, currentVersion) : notes;

  return createPortal(
    <div className="app-dialog-backdrop release-notes-backdrop">
      <section className="app-dialog release-notes-dialog" role="dialog" aria-modal="true"
        aria-labelledby="release-notes-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !saving) {
            event.stopPropagation();
            if (historyOpen) onCloseHistory();
            else setDismissedFor(userId);
          } else if (event.key === "Tab") {
            const controls = Array.from(event.currentTarget.querySelectorAll("button:not(:disabled), summary, [tabindex='0']"));
            const index = controls.indexOf(document.activeElement);
            event.preventDefault();
            controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
          }
        }}>
        <h2 id="release-notes-title">{historyOpen ? "Changelog" : notes.length ? "Was ist neu?" : "Versionshinweise"}</h2>
        {displayedNotes.length > 0 ? (
          <div className="release-notes-list" tabIndex={0} aria-label="Versionsübersicht">
            {displayedNotes.map(({ version, entries }, index) => (
              <details key={version} open={index === 0}>
                <summary>Version {version}</summary>
                {entries.length > 0
                  ? <ul>{entries.map((entry, index) => <li key={`${version}-${index}`}>{entry}</li>)}</ul>
                  : <p>Keine Änderungen dokumentiert.</p>}
              </details>
            ))}
          </div>
        ) : historyOpen && <p>Keine veröffentlichten Änderungen vorhanden.</p>}
        {!historyOpen && error && <p role="alert" className="release-notes-error">{error}</p>}
        <div className="app-dialog-actions">
          {historyOpen ? (
            <button type="button" autoFocus className="app-dialog-button app-dialog-button-primary" onClick={onCloseHistory}>
              Schließen
            </button>
          ) : (
            <>
              <button type="button" className="app-dialog-button app-dialog-button-secondary"
                onClick={() => setDismissedFor(userId)} disabled={saving}>
                Später
              </button>
              {notes.length > 0 ? (
                <button type="button" autoFocus className="app-dialog-button app-dialog-button-primary"
                  onClick={acknowledge} disabled={saving}>
                  {saving ? "Speichern…" : "Verstanden"}
                </button>
              ) : (
                <button type="button" autoFocus className="app-dialog-button app-dialog-button-primary"
                  onClick={() => setRetry((value) => value + 1)}>
                  Erneut versuchen
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}
