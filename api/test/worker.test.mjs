/**
 * POST /api/worker — the model proxy. The function, not the client, decides the model, the token
 * cap and the retention routing; the key never leaves except upstream as a Bearer token.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createWorkerHandler, OPENROUTER_URL } from "../_lib/worker.mjs";
import { createRateLimiter } from "../_lib/ratelimit.mjs";
import { PlanWorker } from "../../host/worker.mjs";
import { KEY, PASS, MODEL, baseEnv, read, post, upstream, clock, WORKER_URL } from "./helpers.mjs";

const chat = (extra = {}) => ({ messages: [{ role: "user", content: "Propose objectives." }], ...extra });

function handler({ env = baseEnv(), respond, ...rest } = {}) {
  const up = upstream(respond);
  const { POST } = createWorkerHandler({ env, fetchImpl: up.fetchImpl, ...rest });
  return { POST, calls: up.calls };
}

/* ---------------------------------- passcode ---------------------------------- */

test("passcode env unset -> 503 NOT_CONFIGURED, never an open proxy", async () => {
  for (const env of [baseEnv({ SILICUS_DEMO_PASSCODE: undefined }), baseEnv({ SILICUS_DEMO_PASSCODE: "" })]) {
    const { POST, calls } = handler({ env });
    const r = await read(await POST(post(WORKER_URL, chat())));
    assert.equal(r.status, 503);
    assert.equal(r.json.error.code, "NOT_CONFIGURED");
    // Not even with an empty passcode header matching the empty env value.
    const r2 = await read(await POST(post(WORKER_URL, chat(), { passcode: "" })));
    assert.equal(r2.status, 503);
    assert.equal(calls.length, 0);
  }
});

test("key or model unset -> 503 NOT_CONFIGURED", async () => {
  for (const env of [baseEnv({ OPENROUTER_API_KEY: "" }), baseEnv({ SILICUS_WORKER_MODEL: undefined })]) {
    const { POST, calls } = handler({ env });
    const r = await read(await POST(post(WORKER_URL, chat())));
    assert.equal(r.status, 503);
    assert.equal(r.json.error.code, "NOT_CONFIGURED");
    assert.equal(calls.length, 0);
  }
});

test("wrong or missing passcode -> 401 BAD_PASSCODE and nothing goes upstream", async () => {
  const { POST, calls } = handler();
  // (Trailing whitespace is not a case: the Fetch Headers class itself trims header values.)
  for (const passcode of [null, "", "wrong", PASS.toUpperCase(), PASS.slice(0, -1), PASS + "x"]) {
    const r = await read(await POST(post(WORKER_URL, chat(), { passcode })));
    assert.equal(r.status, 401, `passcode ${JSON.stringify(passcode)}`);
    assert.equal(r.json.error.code, "BAD_PASSCODE");
  }
  assert.equal(calls.length, 0);
});

test("right passcode -> 200 with the upstream JSON, key sent only upstream as Bearer", async () => {
  const { POST, calls } = handler();
  const r = await read(await POST(post(WORKER_URL, chat())));
  assert.equal(r.status, 200);
  assert.equal(r.json.choices[0].message.content, "{\"ok\":true}");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OPENROUTER_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), `Bearer ${KEY}`);
});

test("the passcode is compared in constant time (timingSafeEqual on equal-length digests)", async () => {
  const spy = mock.method(crypto, "timingSafeEqual");
  try {
    const { POST } = handler();
    await read(await POST(post(WORKER_URL, chat(), { passcode: "x" })));
    await read(await POST(post(WORKER_URL, chat())));
    assert.ok(spy.mock.callCount() >= 2, "timingSafeEqual was not used");
    for (const c of spy.mock.calls) {
      const [a, b] = c.arguments;
      assert.ok(Buffer.isBuffer(a) && Buffer.isBuffer(b));
      assert.equal(a.length, 32);
      assert.equal(b.length, 32);
    }
  } finally {
    spy.mock.restore();
  }
});

test("client headers (its own authorization) are never forwarded upstream", async () => {
  const { POST, calls } = handler();
  await read(await POST(post(WORKER_URL, chat(), { headers: { authorization: "Bearer client-supplied", cookie: "a=b", "x-other": "1" } })));
  const h = new Headers(calls[0].init.headers);
  assert.equal(h.get("authorization"), `Bearer ${KEY}`);
  assert.equal(h.get("cookie"), null);
  assert.equal(h.get("x-other"), null);
  assert.equal(h.get("x-silicus-passcode"), null, "the passcode must not travel upstream");
});

/* ------------------------------------ size ------------------------------------ */

test("413 TOO_LARGE by content-length, without reading the body", async () => {
  const { POST, calls } = handler();
  let pulled = 0;
  const body = new ReadableStream({ pull(c) { pulled += 1; c.enqueue(new TextEncoder().encode("x")); } });
  const req = new Request(WORKER_URL, {
    method: "POST", body, duplex: "half",
    headers: { "x-silicus-passcode": PASS, "content-type": "application/json", "content-length": String(512 * 1024 + 1) },
  });
  const r = await read(await POST(req));
  assert.equal(r.status, 413);
  assert.equal(r.json.error.code, "TOO_LARGE");
  assert.ok(pulled <= 1, `read ${pulled} chunks of a body it should have refused unread`);
  assert.equal(calls.length, 0);
});

test("413 TOO_LARGE by streamed bytes when content-length is absent or lies; reading stops at the cap", async () => {
  const { POST, calls } = handler();
  for (const lie of [null, "10"]) {
    let sent = 0;
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    const body = new ReadableStream({ pull(c) { sent += chunk.length; c.enqueue(chunk); } }); // endless
    const headers = { "x-silicus-passcode": PASS, "content-type": "application/json" };
    if (lie) headers["content-length"] = lie;
    const r = await read(await POST(new Request(WORKER_URL, { method: "POST", body, duplex: "half", headers })));
    assert.equal(r.status, 413);
    assert.equal(r.json.error.code, "TOO_LARGE");
    assert.ok(sent < 2 * 1024 * 1024, `kept reading an endless body (${sent} bytes)`);
  }
  assert.equal(calls.length, 0);
});

test("a body just under 512 KB is accepted", async () => {
  const { POST } = handler();
  const content = "a".repeat(500 * 1024);
  const r = await read(await POST(post(WORKER_URL, chat({ messages: [{ role: "user", content }] }))));
  assert.equal(r.status, 200);
});

/* ----------------------------------- shape ----------------------------------- */

test("400 on non-JSON, a non-object, or no messages array", async () => {
  const { POST, calls } = handler();
  for (const body of ["not json", "[1,2]", "null", JSON.stringify({}), JSON.stringify({ messages: "hi" }), JSON.stringify({ messages: [] }),
    JSON.stringify({ messages: [{ role: "tool", content: "x" }] }), JSON.stringify({ messages: [{ role: "user", content: [{ type: "image_url" }] }] })]) {
    const r = await read(await POST(post(WORKER_URL, body)));
    assert.equal(r.status, 400, body);
    assert.ok(typeof r.json.error.code === "string");
  }
  assert.equal(calls.length, 0);
});

test("client model/provider/tools/stream/etc are stripped and the env model is forced", async () => {
  const { POST, calls } = handler();
  await read(await POST(post(WORKER_URL, chat({
    model: "attacker/expensive-model",
    provider: { zdr: false, data_collection: "allow", order: ["somewhere"] },
    tools: [{ type: "function", function: { name: "x" } }],
    tool_choice: "auto",
    stream: true,
    n: 5,
    logprobs: true,
    plugins: [{ id: "web" }],
    transforms: ["middle-out"],
    temperature: 0.2,
    response_format: { type: "json_object" },
    max_tokens: 100,
  }))));
  const sent = calls[0].body;
  assert.deepEqual(Object.keys(sent).sort(), ["max_tokens", "messages", "model", "provider", "reasoning", "response_format", "temperature"]);
  assert.equal(sent.model, MODEL);
  assert.equal(sent.temperature, 0.2);
  assert.deepEqual(sent.response_format, { type: "json_object" });
  assert.deepEqual(sent.provider, { zdr: true, data_collection: "deny" });
  assert.deepEqual(sent.messages, [{ role: "user", content: "Propose objectives." }]);
});

test("message objects are rebuilt to {role, content}: extra per-message keys never go upstream", async () => {
  const { POST, calls } = handler();
  await read(await POST(post(WORKER_URL, { messages: [{ role: "system", content: "s", name: "n", tool_calls: [] }, { role: "user", content: "u", cache_control: {} }] })));
  assert.deepEqual(calls[0].body.messages, [{ role: "system", content: "s" }, { role: "user", content: "u" }]);
});

test("reasoning is server-decided: low by default, every supported env value maps exactly", async () => {
  const cases = [
    [undefined, { effort: "low" }],
    ["low", { effort: "low" }],
    ["medium", { effort: "medium" }],
    ["high", { effort: "high" }],
    ["off", { enabled: false }],
    ["model-default", undefined],
  ];
  for (const [configured, want] of cases) {
    const { POST, calls } = handler({ env: baseEnv({ SILICUS_WORKER_REASONING: configured }) });
    await read(await POST(post(WORKER_URL, chat())));
    assert.deepEqual(calls[0].body.reasoning, want, `SILICUS_WORKER_REASONING=${configured}`);
  }
});

test("a client reasoning field is stripped; the server's low setting wins", async () => {
  const { POST, calls } = handler({ env: baseEnv({ SILICUS_WORKER_REASONING: "low" }) });
  await read(await POST(post(WORKER_URL, chat({ reasoning: { effort: "high", enabled: true } }))));
  assert.deepEqual(calls[0].body.reasoning, { effort: "low" });
});

/* ------------------------------------ ZDR ------------------------------------ */

test("ZDR provider block is present by default and for any SILICUS_WORKER_ZDR value except \"0\"", async () => {
  for (const zdr of [undefined, "", "1", "true", "false", "no"]) {
    const { POST, calls } = handler({ env: baseEnv({ SILICUS_WORKER_ZDR: zdr }) });
    await read(await POST(post(WORKER_URL, chat({ provider: { zdr: false } }))));
    assert.deepEqual(calls[0].body.provider, { zdr: true, data_collection: "deny" }, `SILICUS_WORKER_ZDR=${zdr}`);
  }
});

test("ZDR provider block is absent only with SILICUS_WORKER_ZDR=0 (and the client cannot add one)", async () => {
  const { POST, calls } = handler({ env: baseEnv({ SILICUS_WORKER_ZDR: "0" }) });
  await read(await POST(post(WORKER_URL, chat({ provider: { order: ["retains-data"] } }))));
  assert.equal("provider" in calls[0].body, false);
});

test("ZDR fails closed: one upstream attempt, never a retry, when the ZDR route is refused", async () => {
  const { POST, calls } = handler({ respond: () => Response.json({ error: { message: "No endpoints found matching your data policy" } }, { status: 404 }) });
  const r = await read(await POST(post(WORKER_URL, chat())));
  assert.equal(r.status, 502);
  assert.equal(r.json.error.code, "UPSTREAM_ERROR");
  assert.equal(r.json.error.status, 404);
  assert.equal(calls.length, 1);
});

/* --------------------------------- max_tokens --------------------------------- */

test("max_tokens = min(client, env cap, default 4000)", async () => {
  const cases = [
    [{}, undefined, 4000],
    [{}, 100, 100],
    [{}, 99999, 4000],
    [{}, -5, 4000],
    [{}, "50", 4000],
    [{ SILICUS_WORKER_MAX_TOKENS: "1000" }, undefined, 1000],
    [{ SILICUS_WORKER_MAX_TOKENS: "1000" }, 5000, 1000],
    [{ SILICUS_WORKER_MAX_TOKENS: "1000" }, 300, 300],
    [{ SILICUS_WORKER_MAX_TOKENS: "junk" }, undefined, 4000],
  ];
  for (const [over, client, want] of cases) {
    const { POST, calls } = handler({ env: baseEnv(over) });
    await read(await POST(post(WORKER_URL, chat(client === undefined ? {} : { max_tokens: client }))));
    assert.equal(calls[0].body.max_tokens, want, `${JSON.stringify(over)} client=${client}`);
  }
});

/* -------------------------------- rate limiting -------------------------------- */

test("429 RATE_LIMITED after 20 requests per 10 minutes from one IP, with retry-after; another IP is unaffected", async () => {
  const c = clock();
  const { POST } = handler({ now: c.now, limiter: createRateLimiter({ now: c.now }) });
  const from = (ip) => post(WORKER_URL, chat(), { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
  for (let i = 0; i < 20; i += 1) assert.equal((await read(await POST(from("203.0.113.7")))).status, 200);
  const r = await read(await POST(from("203.0.113.7")));
  assert.equal(r.status, 429);
  assert.equal(r.json.error.code, "RATE_LIMITED");
  const after = Number(r.headers.get("retry-after"));
  assert.ok(Number.isInteger(after) && after > 0 && after <= 600, `retry-after ${after}`);
  assert.equal((await read(await POST(from("198.51.100.9")))).status, 200);
  c.advance(10 * 60 * 1000 + 1);
  assert.equal((await read(await POST(from("203.0.113.7")))).status, 200);
});

test("failed passcode attempts count toward the per-IP limit (no free brute force)", async () => {
  const c = clock();
  const { POST } = handler({ now: c.now, limiter: createRateLimiter({ now: c.now }) });
  const req = (passcode) => post(WORKER_URL, chat(), { passcode, headers: { "x-real-ip": "192.0.2.44" } });
  for (let i = 0; i < 20; i += 1) assert.equal((await read(await POST(req("guess" + i)))).status, 401);
  assert.equal((await read(await POST(req(PASS)))).status, 429);
});

test("429 RATE_LIMITED at the per-instance daily cap (SILICUS_DAILY_CAP), reset the next UTC day", async () => {
  const c = clock();
  const { POST, calls } = handler({ env: baseEnv({ SILICUS_DAILY_CAP: "3" }), now: c.now, limiter: createRateLimiter({ now: c.now }) });
  const from = (i) => post(WORKER_URL, chat(), { headers: { "x-forwarded-for": `203.0.113.${i}` } });
  for (let i = 1; i <= 3; i += 1) assert.equal((await read(await POST(from(i)))).status, 200);
  const r = await read(await POST(from(4)));
  assert.equal(r.status, 429);
  assert.equal(r.json.error.code, "RATE_LIMITED");
  assert.ok(Number(r.headers.get("retry-after")) > 0);
  assert.equal(calls.length, 3);
  c.set(Date.UTC(2026, 9, 15, 0, 0, 1));
  assert.equal((await read(await POST(from(5)))).status, 200);
});

test("the daily cap defaults to 300", async () => {
  const c = clock();
  const { POST } = handler({ now: c.now, limiter: createRateLimiter({ now: c.now }) });
  let ok = 0;
  for (let i = 0; i < 301; i += 1) {
    const r = await read(await POST(post(WORKER_URL, chat(), { headers: { "x-forwarded-for": `ip-${i}` } })));
    if (r.status === 200) ok += 1;
    else assert.equal(r.status, 429);
  }
  assert.equal(ok, 300);
});

/* ---------------------------------- upstream ---------------------------------- */

test("upstream that never answers -> 504 UPSTREAM_TIMEOUT at the deadline", async () => {
  const { POST } = handler({
    timeoutMs: 50,
    respond: (_u, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
  });
  const r = await read(await POST(post(WORKER_URL, chat())));
  assert.equal(r.status, 504);
  assert.equal(r.json.error.code, "UPSTREAM_TIMEOUT");
});

test("upstream that ignores the abort signal still yields 504 at the deadline", async () => {
  const { POST } = handler({ timeoutMs: 50, respond: () => new Promise(() => {}) });
  const r = await read(await POST(post(WORKER_URL, chat())));
  assert.equal(r.status, 504);
});

test("the default upstream deadline leaves 5 s of headroom under the 120 s function duration", async () => {
  const { UPSTREAM_TIMEOUT_MS } = await import("../_lib/worker.mjs");
  assert.equal(UPSTREAM_TIMEOUT_MS, 115_000);
});

test("upstream 402 -> 502 UPSTREAM_ERROR with status 402, and the upstream body is never echoed", async () => {
  const { POST } = handler({ respond: () => Response.json({ error: { message: `Insufficient credits for key ${KEY}` } }, { status: 402 }) });
  const r = await read(await POST(post(WORKER_URL, chat())));
  assert.equal(r.status, 502);
  assert.deepEqual(r.json, { error: { code: "UPSTREAM_ERROR", status: 402 } });
});

test("upstream 401/429/500 -> 502 with the status; network failure -> 502 without echoing the error", async () => {
  for (const status of [401, 429, 500]) {
    const { POST } = handler({ respond: () => new Response(`bad key ${KEY}`, { status, headers: { "x-echo": KEY } }) });
    const r = await read(await POST(post(WORKER_URL, chat())));
    assert.equal(r.status, 502);
    assert.equal(r.json.error.status, status);
  }
  const { POST } = handler({ respond: () => { throw new Error(`connect failed with ${KEY}`); } });
  const r = await read(await POST(post(WORKER_URL, chat())));
  assert.equal(r.status, 502);
  assert.equal(r.json.error.code, "UPSTREAM_ERROR");
});

test("a 200 that is not JSON, or that would echo the key, is a 502", async () => {
  for (const respond of [() => new Response("<html>oops</html>", { status: 200 }), () => Response.json({ choices: [{ message: { content: KEY } }] })]) {
    const { POST } = handler({ respond });
    const r = await read(await POST(post(WORKER_URL, chat())));
    assert.equal(r.status, 502);
    assert.equal(r.json.error.code, "UPSTREAM_ERROR");
  }
});

/* ------------------------- the real browser worker's body ------------------------- */

test("the exact body host/worker.mjs PlanWorker sends (placeholder model, zdr provider block) is accepted end-to-end", async () => {
  const reply = { objectives: [{ statement: "Students can explain what an algorithm is.", from: ["Notes"] }] };
  const { POST, calls } = handler({ respond: () => Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] }) });
  const worker = new PlanWorker({
    url: WORKER_URL, model: "placeholder", zdr: true, provider: "openai",
    fetchImpl: (url, init) => POST(new Request(url, { ...init, headers: { ...init.headers, "x-silicus-passcode": PASS } })),
  });
  const got = await worker.draftObjectives({ materials: [{ name: "Notes", text: "An algorithm is a list of steps." }] });
  assert.deepEqual(got, [{ statement: "Students can explain what an algorithm is.", from: ["Notes"] }]);
  assert.equal(calls[0].body.model, MODEL);
  assert.deepEqual(calls[0].body.provider, { zdr: true, data_collection: "deny" });
  assert.equal(calls[0].body.max_tokens, 4000);
});

test("the route file exports a Web-standard POST bound to real globals (503 with no env)", async () => {
  const saved = process.env.SILICUS_DEMO_PASSCODE;
  delete process.env.SILICUS_DEMO_PASSCODE;
  try {
    const mod = await import("../worker/index.mjs");
    assert.equal(typeof mod.POST, "function");
    const r = await read(await mod.POST(post(WORKER_URL, chat())));
    assert.equal(r.status, 503);
  } finally {
    if (saved !== undefined) process.env.SILICUS_DEMO_PASSCODE = saved;
  }
});
