#!/usr/bin/env node
/**
 * marble-snapshot.mjs — pin Marble's open data into ONE committed file that BOTH hosts load.
 *
 *   node host/scripts/marble-snapshot.mjs          # writes into the repo (default)
 *   node host/scripts/marble-snapshot.mjs --out /tmp/x
 *
 * It downloads the two source files at the pinned commit, refuses to write unless their
 * sha256 match the recorded hashes (PIN below — a changed upstream can silently change what
 * the app serves, so a mismatch is a hard stop, never a silent refresh), trims each to the
 * fields the app uses, records the source commit and both hashes INSIDE the file, and writes:
 *
 *   host/data/marble/marble-snapshot.json   one JSON both hosts load; the frontend build
 *                                           serves it as a static asset (import ?url)
 *   host/data/marble/MARBLE-ATTRIBUTION.md  the notice that must sit next to it (both licences)
 *
 * The bytes that were downloaded are the hashes recorded here: `topicsSha256` is the hash of
 * the raw topics.json response, not of the trimmed copy. Tests re-check that the committed
 * file still names these bytes (host/test/marble-graph.test.mjs).
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

/** The pinned provenance. Re-verified by the PM on 14 Nov 2026 (downloads at this commit). */
export const PIN = {
  repo: "withmarbleapp/os-taxonomy",
  commit: "d4440e28d8fa0fb4a59b4accf3dd1cdde6297d63",
  licence: "ODbL-1.0",
  topicsSha256: "fd96ce5963e24f11dcfb549fee46d3cb6afae5d545dc30f4d01366a406444f35",
  dependenciesSha256: "ed38d8a265699d1687a7fa8166c528999e21771d54449a84ea5362dc1d0e7758",
};

const TOPIC_FIELDS = ["id", "type", "subject", "domain", "name", "description", "evidence", "ageRangeStart", "ageRangeEnd"];
const EDGE_FIELDS = ["topicId", "prerequisiteId", "strength", "reason"];

export const ATTRIBUTION = `Marble Skill Taxonomy (v1) · © Generative Spark, Inc. (Marble) · https://withmarble.com · licensed under ODbL 1.0 (database) and CC BY-SA 4.0 (content).

Source repository: \`${PIN.repo}\`, pinned at commit \`${PIN.commit}\`.

The trimmed snapshot in this folder (\`marble-snapshot.json\`) is a **derived database** built from that
repository. It is offered under the [Open Database License v1.0](https://opendatacommons.org/licenses/odbl/1-0/);
the Marble-authored content inside it (topic \`name\`, \`description\`, \`evidence\`, dependency \`reason\`s) is offered
under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), matching the upstream's own multi-licence
terms (its \`LICENSE\` and \`LICENSE-CONTENT\` files at the pinned commit). No other upstream files are vendored.
Snapshot written ${new Date().toISOString().slice(0, 10)}.`;

const url = (file) => `https://raw.githubusercontent.com/${PIN.repo}/${PIN.commit}/data/${file}`;

export async function buildSnapshot({ fetchImpl = fetch, now = () => new Date() } = {}) {
  const [topicsRaw, depsRaw] = await Promise.all([fetchImpl(url("topics.json")), fetchImpl(url("dependencies.json"))]);
  if (!topicsRaw.ok || !depsRaw.ok) throw new Error(`marble snapshot: upstream answered ${topicsRaw.status}/${depsRaw.status}`);
  const [topicsText, depsText] = await Promise.all([topicsRaw.text(), depsRaw.text()]);
  const topicsSha256 = createHash("sha256").update(topicsText).digest("hex");
  const dependenciesSha256 = createHash("sha256").update(depsText).digest("hex");
  if (topicsSha256 !== PIN.topicsSha256) throw new Error(`marble snapshot: topics.json hashes to ${topicsSha256}, expected ${PIN.topicsSha256}`);
  if (dependenciesSha256 !== PIN.dependenciesSha256) throw new Error(`marble snapshot: dependencies.json hashes to ${dependenciesSha256}, expected ${PIN.dependenciesSha256}`);
  return { topicsText, depsText, topicsSha256, dependenciesSha256 };
}

export function trimSnapshot({ topicsText, depsText, topicsSha256, dependenciesSha256, source = PIN }) {
  const topics = JSON.parse(topicsText);
  const deps = JSON.parse(depsText);
  return {
    format: "marble-snapshot",
    source: { repo: source.repo, commit: source.commit, licence: source.licence },
    topicsSha256, dependenciesSha256,
    topicCount: topics.topicCount,
    edgeCount: deps.edgeCount,
    topics: (topics.topics ?? []).map((t) => Object.fromEntries(TOPIC_FIELDS.map((k) => [k, t[k]]))),
    dependencies: (deps.dependencies ?? []).map((e) => Object.fromEntries(EDGE_FIELDS.map((k) => [k, e[k]]))),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const outDir = args.indexOf("--out") >= 0 ? args[args.indexOf("--out") + 1] : join(dirname(fileURLToPath(import.meta.url)), "..", "data", "marble");
  const raw = await buildSnapshot();
  const doc = trimSnapshot(raw);
  const json = JSON.stringify(doc);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "marble-snapshot.json"), json);
  await writeFile(join(outDir, "MARBLE-ATTRIBUTION.md"), `# Marble Skill Taxonomy — attribution\n\n${ATTRIBUTION}\n`);
  const gz = gzipSync(Buffer.from(json, "utf8")).length;
  process.stdout.write(`wrote ${resolve(join(outDir, "marble-snapshot.json"))}\n`);
  process.stdout.write(`topics=${doc.topicCount} edges=${doc.edgeCount} commit=${doc.source.commit}\n`);
  process.stdout.write(`raw=${Buffer.byteLength(json)} bytes (${(Buffer.byteLength(json) / 1e6).toFixed(2)} MB) gzip=${gz} bytes (${(gz / 1e6).toFixed(2)} MB)\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
