// @vitest-environment node
// N6V probe (copy into <tree>/frontend/src/browser/ and run with vitest): my own parity story, not N6's.
// Node host = n6v_run_course.mjs over real HTTP+disk; browser host = same steps through rig(). Two-field plan edit.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { rig } from "./testkit";
afterEach(() => vi.restoreAllMocks());
const RUNNER = process.env.N6V_RUNNER!;
const TREE = fileURLToPath(new URL("../../../", import.meta.url));
it("N6V: Node-host and browser-host logs are byte-identical on a 2-field-edit course", async () => {
  const out = `${process.env.TMPDIR}/n6v-parity-node.json`;
  const node = spawnSync(process.execPath, [RUNNER, TREE, out], { encoding: "utf8", timeout: 60_000 });
  expect(node.status, node.stderr + node.stdout).toBe(0);
  const disk = JSON.parse(readFileSync(out, "utf8"));
  let n = 0;
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` as any);
  vi.spyOn(Date, "now").mockReturnValue(1767225600000);
  const r = await rig();
  const call = (m: string, p: string, b?: unknown) => r.call(m as any, p, b);
  const created = await call("POST", "/api/courses", { owner: "Ada Lovelace", title: "N6V course" });
  const c = `/api/courses/${encodeURIComponent(created.json.courseId)}`;
  await call("POST", `${c}/checkpoints`, { id: "files", text: "Confirm the empty material list." });
  await call("POST", `${c}/intake/answer`, { text: "Brief.", answers: { topic: "photosynthesis", course: "Science, ages 8-10", learning_outcomes: "Students can explain how a plant makes food." } });
  await call("POST", `${c}/checkpoints`, { id: "outline", text: "Confirm the outline." });
  const proposed = await call("POST", `${c}/objectives`, {});
  await call("POST", `${c}/decisions`, { text: "Accept.", decisions: proposed.json.proposals.map((p: any) => ({ verb: "accept", proposalId: p.id })) });
  const drafted = await call("POST", `${c}/plan`, {});
  const ed = await call("POST", `${c}/plan/edit`, { planId: drafted.json.id, text: "Edit the plan.", edits: [{ path: "title", value: "Plants make food" }, { path: "activities.0.decisionAfterHelp", value: "Each child says which guess they keep, and why." }] });
  expect(ed.status).toBe(200);
  await call("POST", `${c}/plan/confirm`, { text: "Confirm the lesson plan." });
  await call("POST", `${c}/publish`, { text: "Publish." });
  const dump = await r.host.dump();
  const lines = dump.events.sort((a, b) => a.seq - b.seq).map((e) => e.line);
  expect(lines.length).toBe(disk.lines.length);
  expect(lines).toEqual(disk.lines);
  expect(dump.metas.map((m) => m.text)).toEqual([disk.meta]);
  const confirmed = lines.find((l) => l.includes('"plan.confirmed"'))!;
  expect(confirmed).toContain('"teacherEditCount":2');
  expect(lines.find((l) => l.includes('"objectives.proposed"'))).toContain('"proposedBy":"teacher"');
});
