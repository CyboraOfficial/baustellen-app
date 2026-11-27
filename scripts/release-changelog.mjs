import { readFile, writeFile } from "node:fs/promises";
import { promoteReleaseNotes } from "../src/releaseNotes.mjs";

const version = process.argv[2]?.replace(/^v/, "");
const path = new URL("../APP_CHANGELOG.md", import.meta.url);
const markdown = await readFile(path, "utf8");
await writeFile(path, promoteReleaseNotes(markdown, version));
