/** N6 parity runner: teacher-typed objective + teacher-edited plan on the Node host. */
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
const { runAuthorshipCourse, chatCompletion } = await import("../test/scripted-course.mjs");

const fakeModel = async (_url, init) => new Response(JSON.stringify(chatCompletion(JSON.parse(init.body))), {
  status: 200,
  headers: { "content-type": "application/json" },
});
const noAsfai = {
  status: () => ({ connected: false }),
  runIntake: async () => { throw Object.assign(new Error("off"), { code: "OFF" }); },
  validate: async () => null,
};

const dir = mkdtempSync(join(tmpdir(), "silicus-n6-parity-"));
const app = createApp({
  dataDir: dir,
  worker: new PlanWorker({ url: "http://127.0.0.1:9/v1/chat/completions", model: "m", fetchImpl: fakeModel }),
  sources: [],
  asfai: noAsfai,
});
await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${app.address().port}`;
try {
  const { transcript } = await runAuthorshipCourse(async (method, path, body) => {
    const response = await fetch(base + path, {
      method,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    return { status: response.status, json: await response.json() };
  });
  const slug = readdirSync(dir).find((name) => name.startsWith("urn"));
  const lines = readFileSync(join(dir, slug, "events.ndjson"), "utf8").split("\n").filter(Boolean);
  const meta = readFileSync(join(dir, slug, "meta.json"), "utf8");
  process.stdout.write(JSON.stringify({ transcript, lines, meta }));
} finally {
  app.closeAllConnections?.();
  app.close();
  rmSync(dir, { recursive: true, force: true });
}
