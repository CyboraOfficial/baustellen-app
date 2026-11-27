const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function compareVersions(left, right) {
  if (!versionPattern.test(left) || !versionPattern.test(right)) {
    throw new Error(`Ungültige Versionsnummer: ${left} oder ${right}`);
  }
  const a = left.split(".");
  const b = right.split(".");
  for (let i = 0; i < 3; i += 1) {
    if (a[i].length !== b[i].length) return a[i].length < b[i].length ? -1 : 1;
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function parseReleaseNotes(markdown) {
  const sections = [];
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^## (Unveröffentlicht|\d+\.\d+\.\d+)\s*$/);
    if (heading) {
      current = { version: heading[1], entries: [] };
      sections.push(current);
    } else if (current && line.startsWith("- ")) {
      const entry = line.slice(2).trim();
      if (entry) current.entries.push(entry);
    }
  }
  return sections;
}

export function unreadReleaseNotes(sections, seenVersion, currentVersion) {
  return sections
    .filter(({ version, entries }) =>
      version !== "Unveröffentlicht" &&
      entries.length > 0 &&
      compareVersions(version, seenVersion) > 0 &&
      compareVersions(version, currentVersion) <= 0
    )
    .sort((a, b) => compareVersions(b.version, a.version));
}

export function promoteReleaseNotes(markdown, version) {
  if (!versionPattern.test(version)) {
    throw new Error("Eine gültige Release-Version wird benötigt.");
  }
  const sections = parseReleaseNotes(markdown);
  if (sections.filter((section) => section.version === "Unveröffentlicht").length !== 1) {
    throw new Error("APP_CHANGELOG.md muss genau einen Abschnitt 'Unveröffentlicht' enthalten.");
  }
  if (sections.some((section) => section.version === version)) {
    throw new Error(`Changelog für ${version} existiert bereits.`);
  }
  return markdown.replace(
    /^## Unveröffentlicht[ \t]*\r?$/m,
    `## Unveröffentlicht\n\n## ${version}`
  );
}
