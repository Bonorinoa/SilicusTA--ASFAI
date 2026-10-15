/**
 * Deployment wiring and hygiene: vercel.json gives the functions their duration and no-store,
 * the tests are not shipped as routes, and the functions never log.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { clientIp } from "../_lib/http.mjs";
import { createRateLimiter } from "../_lib/ratelimit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const API = join(ROOT, "api");

test("vercel.json: maxDuration 120 for api/**, /api gets cache-control no-store, the original CSP block is intact", () => {
  const v = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  assert.equal(v.functions?.["api/**/*.mjs"]?.maxDuration, 120);
  const api = v.headers.find((h) => h.source === "/api/(.*)");
  assert.ok(api, "no headers entry for /api");
  assert.ok(api.headers.some((h) => h.key.toLowerCase() === "cache-control" && h.value === "no-store"));
  const all = v.headers.find((h) => h.source === "/(.*)");
  assert.ok(all.headers.some((h) => h.key === "Content-Security-Policy" && h.value.startsWith("default-src 'self';") && h.value.includes("connect-src 'self'")));
  assert.equal(v.outputDirectory, "frontend/dist");
});

test(".vercelignore keeps api/test out of the deployment (it would otherwise become routes)", () => {
  const lines = readFileSync(join(ROOT, ".vercelignore"), "utf8").split("\n").map((l) => l.trim());
  assert.ok(lines.includes("api/test") || lines.includes("/api/test") || lines.includes("api/test/"));
});

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === "test" ? [] : walk(p)) : [p];
  });
}

test("the functions never log (no console.*), and every route file is .mjs", () => {
  const files = walk(API);
  assert.ok(files.length >= 5);
  for (const f of files) {
    assert.ok(f.endsWith(".mjs"), `${f} is not .mjs (there is no root package.json, so .js would be CommonJS)`);
    assert.doesNotMatch(readFileSync(f, "utf8"), /\bconsole\s*\./, `${f} logs`);
  }
});

test("clientIp: first x-forwarded-for hop, then x-real-ip, else 'unknown'", () => {
  const r = (h) => new Request("https://x/", { headers: h });
  assert.equal(clientIp(r({ "x-forwarded-for": " 203.0.113.1 , 10.0.0.1" })), "203.0.113.1");
  assert.equal(clientIp(r({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(clientIp(r({})), "unknown");
});

test("rate limiter memory is bounded: old IPs are evicted past maxKeys", () => {
  let t = 0;
  const rl = createRateLimiter({ now: () => t, maxKeys: 100 });
  for (let i = 0; i < 1000; i += 1) assert.equal(rl.hit(`ip${i}`).ok, true);
  assert.ok(rl.size() <= 100);
});
