/** The host holds an ASFAI credential on loopback: hostile pages and rebinding names must not reach it. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { connectedAsfai } from "./asfai-fixture.mjs";

const CLEAN = []; after(() => CLEAN.forEach((f) => f()));
async function boot() {
  const c = await connectedAsfai();
  const app = createApp({ dataDir: mkdtempSync(join(tmpdir(), "silicus-guard-")), asfai: c.svc });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  CLEAN.push(() => { app.closeAllConnections?.(); app.close(); c.mock.close(); });
  return app.address().port;
}
const raw = (port, { method = "GET", path, headers = {}, body }) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
    let t = ""; res.on("data", (d) => (t += d)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, json: t ? JSON.parse(t) : null }));
  });
  req.on("error", reject); if (body) req.write(body); req.end();
});
const J = { "content-type": "application/json" };

test("a hostile web page (foreign Origin) cannot create a course, read status, or get CORS", async () => {
  const port = await boot();
  const evil = { ...J, origin: "https://evil.example" };
  const post = await raw(port, { method: "POST", path: "/api/courses", headers: evil, body: JSON.stringify({ owner: "x", title: "pwn" }) });
  assert.equal(post.status, 403); assert.equal(post.json.code, "BAD_ORIGIN");
  assert.equal(post.headers["access-control-allow-origin"], undefined);
  const get = await raw(port, { path: "/api/asfai/status", headers: { origin: "https://evil.example" } });
  assert.equal(get.status, 403);
  const conn = await raw(port, { method: "POST", path: "/api/asfai/connect", headers: evil, body: "{}" });
  assert.equal(conn.status, 403, "a hostile page cannot start a consent flow either");
});

test("the app's own origin works and is the only one echoed back", async () => {
  const port = await boot();
  const ok = await raw(port, { path: "/api/health", headers: { origin: "http://127.0.0.1:5173" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers["access-control-allow-origin"], "http://127.0.0.1:5173");
  const noOrigin = await raw(port, { path: "/api/health" });         // curl, the e2e, server-to-server
  assert.equal(noOrigin.status, 200);
});

test("DNS rebinding: a non-loopback Host header is refused", async () => {
  const port = await boot();
  const r = await raw(port, { path: "/api/asfai/status", headers: { host: "evil.example:8787" } });
  assert.equal(r.status, 403); assert.equal(r.json.code, "BAD_HOST");
});

test("a POST must be JSON (so a hostile form cannot skip the CORS preflight)", async () => {
  const port = await boot();
  const r = await raw(port, { method: "POST", path: "/api/courses", headers: { "content-type": "text/plain" }, body: JSON.stringify({ owner: "x", title: "y" }) });
  assert.equal(r.status, 415);
});

test("the callback is reachable from ASFAI's redirect (no Origin on a navigation) but a forged state is refused", async () => {
  const port = await boot();
  const res = await new Promise((resolve) => http.get({ host: "127.0.0.1", port, path: "/api/asfai/callback?state=forged&code=x" }, (r) => { let t = ""; r.on("data", (d) => (t += d)); r.on("end", () => resolve({ status: r.statusCode, t })); }));
  assert.equal(res.status, 400);
  assert.match(res.t, /not connected/i);
});
