/**
 * parity-run.mjs — run the scripted course (test/scripted-course.mjs) on the NODE host and print what happened.
 *
 * Real node:http server, real disk log, real node:crypto; ids and clock pinned so a second, independent run on
 * another host (the browser host, in frontend/src/browser/parity.test.ts) can be compared byte for byte.
 *
 *   node host/scripts/parity-run.mjs   ->  stdout: {"transcript": [...], "lines": [...], "meta": "..."}
 */
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

crypto.randomUUID = (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })();
syncBuiltinESMExports();
Date.now = () => 1767225600000;

const { createApp } = await import("../server.mjs");
const { PlanWorker } = await import("../worker.mjs");
const { runScriptedCourse, chatCompletion } = await import("../test/scripted-course.mjs");

const fakeModel = async (_url, init) => new Response(JSON.stringify(chatCompletion(JSON.parse(init.body))), { status: 200, headers: { "content-type": "application/json" } });
const noAsfai = { status: () => ({ connected: false }), runIntake: async () => { throw Object.assign(new Error("off"), { code: "OFF" }); }, validate: async () => null };

const dir = mkdtempSync(join(tmpdir(), "silicus-parity-"));
const app = createApp({ dataDir: dir, worker: new PlanWorker({ url: "http://127.0.0.1:9/v1/chat/completions", model: "m", fetchImpl: fakeModel }), sources: [], asfai: noAsfai });
await new Promise((r) => app.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.address().port}`;
try {
  const { transcript } = await runScriptedCourse(async (method, path, body) => {
    const r = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: r.status, json: await r.json() };
  });
  const slug = readdirSync(dir).find((d) => d.startsWith("urn"));
  const lines = readFileSync(join(dir, slug, "events.ndjson"), "utf8").split("\n").filter(Boolean);
  const meta = readFileSync(join(dir, slug, "meta.json"), "utf8");
  process.stdout.write(JSON.stringify({ transcript, lines, meta }));
} finally {
  app.closeAllConnections?.();
  app.close();
  rmSync(dir, { recursive: true, force: true });
}
