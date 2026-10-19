/**
 * GET /api/worker/status — config, never a credential. Same shape as the Node host's
 * GET /api/worker/status ({configured, zdr, provider}) plus passcodeRequired.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStatusHandler } from "../_lib/worker.mjs";
import { KEY, PASS, MODEL, baseEnv, read, STATUS_URL } from "./helpers.mjs";

const get = () => new Request(STATUS_URL, { method: "GET" });

test("status shape: configured, zdr, provider openrouter, passcodeRequired, model; nothing else", async () => {
  const { GET } = createStatusHandler({ env: baseEnv() });
  const r = await read(await GET(get()));
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { configured: true, zdr: true, provider: "openrouter", passcodeRequired: true, model: MODEL,
    typicalSeconds: { objectives: [3, 35], plan: [5, 35], answer: [3, 35] } });
  assert.ok(!r.text.includes(PASS), "the passcode must never be in the status");
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("configured needs the key AND the model AND the passcode", async () => {
  const cases = [
    [{}, true],
    [{ OPENROUTER_API_KEY: undefined }, false],
    [{ OPENROUTER_API_KEY: "" }, false],
    [{ SILICUS_WORKER_MODEL: undefined }, false],
    [{ SILICUS_DEMO_PASSCODE: undefined }, false],
    [{ SILICUS_DEMO_PASSCODE: "" }, false],
  ];
  for (const [over, want] of cases) {
    const { GET } = createStatusHandler({ env: baseEnv(over) });
    const r = await read(await GET(get()));
    assert.equal(r.json.configured, want, JSON.stringify(over));
    assert.equal(r.json.passcodeRequired, true);
    assert.equal(r.json.provider, "openrouter");
  }
});

test("zdr is reported exactly as configured: false only with SILICUS_WORKER_ZDR=0", async () => {
  for (const [zdr, want] of [[undefined, true], ["1", true], ["", true], ["0", false]]) {
    const { GET } = createStatusHandler({ env: baseEnv({ SILICUS_WORKER_ZDR: zdr }) });
    assert.equal((await read(await GET(get()))).json.zdr, want, `SILICUS_WORKER_ZDR=${zdr}`);
  }
});

test("typicalSeconds defaults per task, accepts per-task JSON overrides, and ignores invalid JSON", async () => {
  const expected = { objectives: [3, 35], plan: [5, 35], answer: [3, 35] };
  const custom = await read(await createStatusHandler({ env: baseEnv({ SILICUS_TYPICAL_SECONDS: '{"plan":[7,30]}' }) }).GET(get()));
  assert.deepEqual(custom.json.typicalSeconds, { ...expected, plan: [7, 30] });
  for (const value of ["not json", "[]", '{"plan":"fast"}']) {
    const r = await read(await createStatusHandler({ env: baseEnv({ SILICUS_TYPICAL_SECONDS: value }) }).GET(get()));
    assert.deepEqual(r.json.typicalSeconds, expected, value);
  }
});

test("status needs no passcode and never reveals the key, even with nothing configured", async () => {
  const { GET } = createStatusHandler({ env: {} });
  const r = await read(await GET(get()));
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { configured: false, zdr: true, provider: "openrouter", passcodeRequired: true, model: null,
    typicalSeconds: { objectives: [3, 35], plan: [5, 35], answer: [3, 35] } });
  const r2 = await read(await createStatusHandler({ env: { OPENROUTER_API_KEY: KEY } }).GET(get()));
  assert.equal(r2.json.configured, false);
});

test("the route file exports a Web-standard GET", async () => {
  const mod = await import("../worker/status.mjs");
  assert.equal(typeof mod.GET, "function");
  const r = await read(await mod.GET(get()));
  assert.equal(r.status, 200);
  assert.equal(r.json.provider, "openrouter");
  assert.ok(r.text.length < 300);
});
