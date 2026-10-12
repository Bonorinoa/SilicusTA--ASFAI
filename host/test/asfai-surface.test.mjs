/**
 * Red-team of the Sprint 3 surface. These are the attacks that were leads, reproduced,
 * and either closed here or confirmed already closed. A finding that only restates the
 * ledger's documented limit (a writer with the data dir) does not belong in this file.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { CourseStore } from "../store.mjs";
import { connectedAsfai } from "./asfai-fixture.mjs";

const CLEAN = [];
after(() => CLEAN.forEach((f) => f()));

async function boot() {
  const c = await connectedAsfai();
  const dataDir = mkdtempSync(join(tmpdir(), "silicus-surface-"));
  const app = createApp({ dataDir, asfai: c.svc });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  CLEAN.push(() => { app.closeAllConnections?.(); app.close(); c.mock.close(); });
  return { port: app.address().port, dataDir, mock: c.mock };
}
const raw = (port, { method = "GET", path, headers = {}, body }) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
    let t = ""; res.on("data", (d) => (t += d)); res.on("end", () => resolve({ status: res.statusCode, body: t }));
  });
  req.on("error", reject); if (body) req.write(body); req.end();
});
const J = { "content-type": "application/json" };
const SECRETISH = /accessToken|refreshToken|Bearer |at-[0-9a-f]|rt-[0-9a-f]/;

test("the report-back route is gone: a client cannot supply a prepare_outline result", async () => {
  const { port } = await boot();
  const r = await raw(port, { method: "POST", path: "/api/courses/whatever/intake/observe", headers: J, body: JSON.stringify({ state: "ready_to_draft" }) });
  assert.equal(r.status, 404);
});

test("status, connect, and a refused callback leak no token material, and a script in the error is not reflected", async () => {
  const { port } = await boot();
  const status = await raw(port, { path: "/api/asfai/status" });
  assert.equal(status.status, 200);
  assert.doesNotMatch(status.body, SECRETISH);
  const conn = await raw(port, {
    method: "POST", path: "/api/asfai/connect", headers: J,
    body: JSON.stringify({ url: "http://169.254.169.254/", mcpUrl: "http://evil.example/mcp", prmUrl: "http://evil.example/prm" }),
  });
  assert.equal(conn.status, 200);
  const url = JSON.parse(conn.body).authorizeUrl;
  assert.equal(new URL(url).hostname, "127.0.0.1", "a connect body cannot retarget the issuer");
  assert.equal(url.includes("code_verifier"), false);
  assert.doesNotMatch(conn.body, SECRETISH);
  const cb = await raw(port, { path: "/api/asfai/callback?state=forged&error=%3Cscript%3Ealert(1)%3C/script%3E&code=at-deadbeef" });
  assert.equal(cb.status, 400);
  assert.equal(cb.body.includes("<script>"), false);
  assert.equal(cb.body.includes("at-deadbeef"), false);
  assert.match(cb.body, /BAD_STATE|CONSENT_DENIED/);
});

test("a course id of . or .. cannot escape the data directory", async () => {
  const { port, dataDir } = await boot();
  const parent = join(dataDir, "..");
  // Node's HTTP client resolves a ".." segment before it is sent, so the wire never
  // delivers that id. The escape is in-process: join(root, "..") leaves the data dir.
  const store = new CourseStore(dataDir);
  for (const id of ["..", "."]) {
    assert.equal(store.has(id), false, id);
    assert.throws(() => store.log(id), { code: "BAD_COURSE_ID" }, id);
  }
  assert.equal(store.has("../asfai-tokens.json"), false, "a slash is slug-stripped; it is absent, not an escape");
  assert.equal(existsSync(join(parent, "meta.json")), false);
  assert.equal(existsSync(join(parent, "events.ndjson")), false);
  // a percent-encoded traversal that survives as a segment is still not a course
  const encoded = await raw(port, { path: "/api/courses/..%2F..%2Fetc" });
  assert.equal(encoded.status, 404);
});

test("an archive ref cannot traverse, and the HTTP response does not carry the absolute path", async () => {
  const { port, dataDir } = await boot();
  const created = await raw(port, { method: "POST", path: "/api/courses", headers: J, body: JSON.stringify({ owner: "t", title: "t" }) });
  const { courseId } = JSON.parse(created.body);
  const saved = await raw(port, {
    method: "POST", path: `/api/courses/${encodeURIComponent(courseId)}/archive`, headers: J,
    body: JSON.stringify({ ref: "../asfai-tokens" }),
  });
  assert.equal(saved.status, 200);
  const body = JSON.parse(saved.body);
  assert.equal("path" in body, false);
  assert.equal(JSON.stringify(body).includes(dataDir), false);
  assert.equal(existsSync(join(dataDir, "asfai-tokens.json")), false, "the traversal ref must not touch the credential file");
  const loaded = await raw(port, { path: `/api/courses/${encodeURIComponent(courseId)}/archive/${encodeURIComponent("../asfai-tokens")}` });
  assert.equal(loaded.status, 200, "the slug stays inside the archive dir, so the save is readable back");
  assert.equal(loaded.body.includes(dataDir), false);
});

test("Host and Origin lookalikes are refused", async () => {
  const { port } = await boot();
  for (const host of ["evil.example", "127.0.0.1.evil.com", "localhost.evil.com"]) {
    const r = await raw(port, { path: "/api/asfai/status", headers: { host } });
    assert.equal(r.status, 403, host);
    assert.equal(JSON.parse(r.body).code, "BAD_HOST");
  }
  const origin = await raw(port, { path: "/api/asfai/status", headers: { origin: "http://127.0.0.1:5173.evil.com" } });
  assert.equal(origin.status, 403);
  assert.equal(JSON.parse(origin.body).code, "BAD_ORIGIN");
});

test("two racing intake calls cannot authorize the outline before the teacher answers", async () => {
  const { port, mock } = await boot();
  const created = await raw(port, { method: "POST", path: "/api/courses", headers: J, body: JSON.stringify({ owner: "t", title: "t" }) });
  const { courseId } = JSON.parse(created.body);
  const path = `/api/courses/${encodeURIComponent(courseId)}/intake/call`;
  const [a, b] = await Promise.all([
    raw(port, { method: "POST", path, headers: J, body: "{}" }),
    raw(port, { method: "POST", path, headers: J, body: "{}" }),
  ]);
  const statuses = [a, b].map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409], [a, b].map((r) => r.status + " " + r.body.slice(0, 80)).join(" | "));
  const refused = [a, b].find((r) => r.status === 409);
  assert.equal(JSON.parse(refused.body).code, "AWAITING_TEACHER_REPLY");
  const view = JSON.parse((await raw(port, { path: `/api/courses/${encodeURIComponent(courseId)}` })).body);
  assert.equal(view.intake.outlineAuthorized, false);
  assert.equal(view.intake.observedState, "clarifying");
  assert.equal(view.integrity.ok ?? true, true);
  const sent = (mock.st.toolArgs ?? []).filter((x) => x.action === "prepare_outline");
  assert.ok(sent.every((x) => !x.payload.topic && !x.payload.learningOutcomes), "a race still cannot smuggle fields");
});
