/**
 * The modules the BROWSER host bundles must carry no server configuration: no env-variable names, no key names.
 * Verifier finding (2026-10-14, MED-1): host/worker.mjs error messages named SILICUS_WORKER_URL / _MODEL / _ZDR, so
 * those names shipped in the public browser bundle. Operator hints belong to the Node host (server.mjs), which the
 * browser never imports. This walks the real import graph from the browser host's entry imports, so a new shared
 * module is covered automatically.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = resolve(HOST, "../frontend/src/browser/browserHost.ts");
const SERVER_NAMES = /\b(SILICUS_[A-Z_]+|OPENROUTER_API_KEY|ANTHROPIC_API_KEY)\b/g;

function graph() {
  const seen = new Set(); const stack = [];
  for (const m of readFileSync(ENTRY, "utf8").matchAll(/from\s+"(\.\.\/\.\.\/\.\.\/host\/[^"]+)"/g)) stack.push(resolve(dirname(ENTRY), m[1]));
  while (stack.length) {
    const f = stack.pop(); if (seen.has(f) || !existsSync(f)) continue; seen.add(f);
    for (const m of readFileSync(f, "utf8").matchAll(/(?:from|import)\s*\(?\s*"(\.[^"]+)"/g)) {
      const dep = resolve(dirname(f), m[1]); if (dep.startsWith(HOST) || dep.includes("/confirm-gate/")) stack.push(dep);
    }
  }
  return [...seen];
}

test("the browser host's shared modules name no server env variable or key", () => {
  const files = graph();
  assert.ok(files.some((f) => f.endsWith("host/worker.mjs")) && files.some((f) => f.endsWith("host/handler.mjs")), "the graph walk found the shared modules");
  assert.ok(!files.some((f) => f.endsWith("host/server.mjs")), "server.mjs (where env is read) is not in the browser graph");
  const hits = files.flatMap((f) => [...readFileSync(f, "utf8").matchAll(SERVER_NAMES)].map((m) => `${f.slice(HOST.length - 4)}: ${m[0]}`));
  assert.deepEqual(hits, []);
});
