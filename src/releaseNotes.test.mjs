import { strict as assert } from "node:assert";
import { test } from "node:test";
import { compareVersions, parseReleaseNotes, promoteReleaseNotes, releaseHistory, unreadReleaseNotes } from "./releaseNotes.mjs";

const notes = parseReleaseNotes(`# Änderungen

## Unveröffentlicht
- Noch nicht veröffentlicht

## 1.6.1
- Neue Funktion

## 1.6.0

## 1.5.9
- Fehler behoben

## 1.5.8
- Ältere Änderung
`);

test("zeigt alle verpassten Einträge bis zur installierten Version", () => {
  const result = unreadReleaseNotes(notes, "1.5.8", "1.6.1");
  assert.deepEqual(result.map((entry) => entry.version), ["1.6.1", "1.5.9"]);
  assert.deepEqual(result[0].entries, ["Neue Funktion"]);
});

test("zeigt keine zukünftigen oder bereits bestätigten Änderungen", () => {
  assert.deepEqual(unreadReleaseNotes(notes, "1.6.1", "1.5.9"), []);
  assert.deepEqual(unreadReleaseNotes(notes, "1.5.9", "1.6.0"), []);
});

test("zeigt im Changelog veröffentlichte Versionen einschließlich leerer Einträge", () => {
  const history = releaseHistory(notes, "1.6.0");
  assert.deepEqual(history.map(({ version }) => version), ["1.6.0", "1.5.9", "1.5.8"]);
  assert.deepEqual(history[0].entries, []);
});

test("vergleicht Versionsbestandteile numerisch und lehnt ungültige Versionen ab", () => {
  assert.ok(compareVersions("1.10.0", "1.9.99") > 0);
  assert.ok(compareVersions("1.0.9007199254740993", "1.0.9007199254740992") > 0);
  assert.throws(() => compareVersions("1.5.x", "1.5.0"));
});

test("ordnet unveröffentlichte Änderungen der neuen Version zu", () => {
  const markdown = "# Änderungen\n\n## Unveröffentlicht\n\n- Neue Änderung\n\n## 1.5.0\n\n- Alte Änderung\n";
  const sections = parseReleaseNotes(promoteReleaseNotes(markdown, "1.5.1"));
  assert.deepEqual(sections.map(({ version, entries }) => [version, entries]), [
    ["Unveröffentlicht", []],
    ["1.5.1", ["Neue Änderung"]],
    ["1.5.0", ["Alte Änderung"]]
  ]);
  assert.throws(() => promoteReleaseNotes(markdown, "1.5.0"), /existiert bereits/);
});

test("erlaubt ein Release ohne Einträge und verlangt einen unveröffentlichten Abschnitt", () => {
  const sections = parseReleaseNotes(promoteReleaseNotes("## Unveröffentlicht\n", "1.5.1"));
  assert.deepEqual(sections.map(({ version, entries }) => [version, entries]), [
    ["Unveröffentlicht", []],
    ["1.5.1", []]
  ]);
  assert.throws(() => promoteReleaseNotes("# Änderungen\n", "1.5.1"), /genau einen Abschnitt/);
});
