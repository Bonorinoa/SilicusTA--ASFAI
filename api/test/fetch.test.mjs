/**
 * POST /api/fetch — the guarded public-URL fetch, on the SAME code path as the host
 * (host/materials.mjs assertPublicUrl + fetchPublic: every redirect hop re-vetted).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFetchHandler, FETCH_DEADLINE_MS } from "../_lib/fetch.mjs";
import { createRateLimiter } from "../_lib/ratelimit.mjs";
import { digestText } from "../../host/materials.mjs";
import { PASS, baseEnv, read, post, clock, FETCH_URL } from "./helpers.mjs";

const PUBLIC_IP = "93.184.215.14";
/** DNS stub: a table of host -> address; anything else resolves public. */
const lookup = (table = {}) => async (host) => [{ address: table[host] ?? PUBLIC_IP, family: (table[host] ?? PUBLIC_IP).includes(":") ? 6 : 4 }];

/** A fetch over a table of url -> {status?, type?, body?, location?}. Records every URL asked for. */
function web(table) {
  const asked = [];
  const fetchImpl = async (url, init = {}) => {
    asked.push(String(url));
    assert.equal(init.redirect, "manual", "redirects must be followed by hand so each hop is vetted");
    const r = table[String(url)];
    if (!r) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    if (r.hang) return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const headers = { "content-type": r.type ?? "text/html; charset=utf-8" };
    if (r.location) headers.location = r.location;
    return new Response(r.body ?? "", { status: r.status ?? 200, headers });
  };
  return { fetchImpl, asked };
}

function handler({ table = {}, dns = {}, env = baseEnv(), ...rest } = {}) {
  const w = web(table);
  const { POST } = createFetchHandler({ env, fetchImpl: w.fetchImpl, lookupImpl: lookup(dns), ...rest });
  return { POST, asked: w.asked };
}

const PAGE = "<html><head><title>Photosynthesis &amp; Light</title></head><body><nav>menu</nav><main><h1>Plants</h1><p>Plants turn light into sugar.</p></main></body></html>";

/* ---------------------------------- passcode ---------------------------------- */

test("passcode env unset -> 503 NOT_CONFIGURED; wrong/missing -> 401 BAD_PASSCODE; nothing fetched", async () => {
  const off = handler({ env: baseEnv({ SILICUS_DEMO_PASSCODE: "" }) });
  const r0 = await read(await off.POST(post(FETCH_URL, { url: "https://example.org/" }, { passcode: "" })));
  assert.equal(r0.status, 503);
  assert.equal(r0.json.error.code, "NOT_CONFIGURED");
  const on = handler({ table: { "https://example.org/": { body: PAGE } } });
  for (const passcode of [null, "nope"]) {
    const r = await read(await on.POST(post(FETCH_URL, { url: "https://example.org/" }, { passcode })));
    assert.equal(r.status, 401);
    assert.equal(r.json.error.code, "BAD_PASSCODE");
  }
  assert.equal(off.asked.length + on.asked.length, 0);
});

test("fetch works with only the passcode configured (it needs no model key)", async () => {
  const { POST } = handler({ env: { SILICUS_DEMO_PASSCODE: PASS }, table: { "https://example.org/": { body: PAGE } } });
  assert.equal((await read(await POST(post(FETCH_URL, { url: "https://example.org/" })))).status, 200);
});

/* ---------------------------------- success ---------------------------------- */

test("success -> 200 {name, text, chars, digest}, name from the page title", async () => {
  const { POST, asked } = handler({ table: { "https://example.org/lesson": { body: PAGE } } });
  const r = await read(await POST(post(FETCH_URL, { url: "https://example.org/lesson" })));
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ["chars", "digest", "name", "text"]);
  assert.equal(r.json.name, "Photosynthesis & Light");
  assert.match(r.json.text, /Plants turn light into sugar\./);
  assert.ok(!r.json.text.includes("menu"), "the page's <main> is preferred over navigation");
  assert.equal(r.json.chars, r.json.text.length);
  assert.equal(r.json.digest, digestText(r.json.text));
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(asked, ["https://example.org/lesson"]);
});

test("a page with no title is named by its hostname; plain text is read as text", async () => {
  const { POST } = handler({ table: { "https://notes.example.org/a.txt": { type: "text/plain", body: "Line one.\n\n\n\nLine two." } } });
  const r = await read(await POST(post(FETCH_URL, { url: "https://notes.example.org/a.txt" })));
  assert.equal(r.status, 200);
  assert.equal(r.json.name, "notes.example.org");
  assert.equal(r.json.text, "Line one.\n\nLine two.");
});

test("text is clipped to the host's per-material limit", async () => {
  const { LIMITS } = await import("../../host/materials.mjs");
  const { POST } = handler({ table: { "https://example.org/big": { type: "text/plain", body: "word ".repeat(30_000) } } });
  const r = await read(await POST(post(FETCH_URL, { url: "https://example.org/big" })));
  assert.equal(r.status, 200);
  assert.equal(r.json.chars, LIMITS.maxChars);
});

test("a public redirect is followed", async () => {
  const { POST, asked } = handler({ table: {
    "https://example.org/old": { status: 301, location: "/new" },
    "https://example.org/new": { body: PAGE },
  } });
  const r = await read(await POST(post(FETCH_URL, { url: "https://example.org/old" })));
  assert.equal(r.status, 200);
  assert.deepEqual(asked, ["https://example.org/old", "https://example.org/new"]);
});

/* ------------------------------------ SSRF ------------------------------------ */

test("private, loopback and metadata addresses are refused with 422 URL_REFUSED and never fetched", async () => {
  const { POST, asked } = handler({ dns: { "intranet.example.com": "10.1.2.3", "v6.example.com": "fd00::1" } });
  for (const url of [
    "https://127.0.0.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::ffff:127.0.0.1]/",
    "https://[::1]/",
    "https://10.0.0.8/",
    "https://192.168.1.1/",
    "https://localhost/",
    "https://intranet.example.com/",
    "https://v6.example.com/",
  ]) {
    const r = await read(await POST(post(FETCH_URL, { url })));
    assert.equal(r.status, 422, url);
    assert.equal(r.json.error.code, "URL_REFUSED", url);
    assert.equal(typeof r.json.error.message, "string");
  }
  assert.deepEqual(asked, []);
});

test("non-https, credentials in the URL and odd ports are refused", async () => {
  const { POST, asked } = handler();
  for (const url of ["http://example.org/", "https://user:pw@example.org/", "https://example.org:8443/", "file:///etc/passwd", "not a url"]) {
    const r = await read(await POST(post(FETCH_URL, { url })));
    assert.equal(r.status, 422, url);
    assert.equal(r.json.error.code, "URL_REFUSED", url);
  }
  assert.deepEqual(asked, []);
});

test("a redirect to a private address is refused at the hop, before it is fetched", async () => {
  const { POST, asked } = handler({
    dns: { "internal.example.net": "10.9.8.7" },
    table: {
      "https://example.org/a": { status: 302, location: "https://169.254.169.254/latest/meta-data/iam" },
      "https://example.org/b": { status: 302, location: "https://internal.example.net/admin" },
      "https://example.org/c": { status: 307, location: "https://[::ffff:7f00:1]/" },
    },
  });
  for (const url of ["https://example.org/a", "https://example.org/b", "https://example.org/c"]) {
    const r = await read(await POST(post(FETCH_URL, { url })));
    assert.equal(r.status, 422, url);
    assert.equal(r.json.error.code, "URL_REFUSED", url);
  }
  assert.deepEqual(asked, ["https://example.org/a", "https://example.org/b", "https://example.org/c"]);
});

test("guard refusals other than the address keep their MaterialError code (422)", async () => {
  const { POST } = handler({ table: {
    "https://example.org/img": { type: "image/png", body: "x" },
    "https://example.org/gone": { status: 410, type: "text/plain", body: "gone" },
    "https://example.org/empty": { body: "<html><head><title>t</title></head><body><script>x()</script></body></html>" },
  } });
  const codes = {};
  for (const p of ["img", "gone", "empty"]) {
    const r = await read(await POST(post(FETCH_URL, { url: `https://example.org/${p}` })));
    assert.equal(r.status, 422, p);
    codes[p] = r.json.error.code;
  }
  assert.deepEqual(codes, { img: "UNSUPPORTED_TYPE", gone: "URL_UNREACHABLE", empty: "EMPTY" });
});

/* ----------------------------------- YouTube ----------------------------------- */

test("YouTube links -> 422 YOUTUBE_LOCAL_ONLY, never fetched", async () => {
  const { POST, asked } = handler();
  for (const url of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://m.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/@somechannel",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ]) {
    const r = await read(await POST(post(FETCH_URL, { url })));
    assert.equal(r.status, 422, url);
    assert.deepEqual(r.json, { error: { code: "YOUTUBE_LOCAL_ONLY", message: "YouTube captions need the local app. Paste the transcript instead." } });
  }
  assert.deepEqual(asked, []);
});

/* ------------------------------------ body ------------------------------------ */

test("body over 4 KB -> 413 TOO_LARGE (by content-length and by bytes)", async () => {
  const { POST, asked } = handler();
  const big = JSON.stringify({ url: "https://example.org/?" + "a".repeat(5000) });
  const r1 = await read(await POST(post(FETCH_URL, big)));
  assert.equal(r1.status, 413);
  assert.equal(r1.json.error.code, "TOO_LARGE");
  const r2 = await read(await POST(post(FETCH_URL, "{}", { headers: { "content-length": "999999" } })));
  assert.equal(r2.status, 413);
  assert.deepEqual(asked, []);
});

test("400 on non-JSON or no url string", async () => {
  const { POST } = handler();
  for (const body of ["nope", "[]", JSON.stringify({}), JSON.stringify({ url: 5 }), JSON.stringify({ url: "" })]) {
    const r = await read(await POST(post(FETCH_URL, body)));
    assert.equal(r.status, 400, body);
  }
});

/* ---------------------------------- deadline ---------------------------------- */

test("the whole fetch has a deadline: a hanging site -> 504 UPSTREAM_TIMEOUT", async () => {
  assert.equal(FETCH_DEADLINE_MS, 20_000);
  const { POST } = handler({ deadlineMs: 50, table: { "https://slow.example.org/": { hang: true } } });
  const t0 = Date.now();
  const r = await read(await POST(post(FETCH_URL, { url: "https://slow.example.org/" })));
  assert.equal(r.status, 504);
  assert.equal(r.json.error.code, "UPSTREAM_TIMEOUT");
  assert.ok(Date.now() - t0 < 5000);
});

/* --------------------------------- rate limit --------------------------------- */

test("the same rate limiter applies: 429 after 20 per 10 minutes from one IP", async () => {
  const c = clock();
  const { POST } = handler({ now: c.now, limiter: createRateLimiter({ now: c.now }), table: { "https://example.org/": { body: PAGE } } });
  const req = () => post(FETCH_URL, { url: "https://example.org/" }, { headers: { "x-forwarded-for": "203.0.113.5" } });
  for (let i = 0; i < 20; i += 1) assert.equal((await read(await POST(req()))).status, 200);
  const r = await read(await POST(req()));
  assert.equal(r.status, 429);
  assert.equal(r.json.error.code, "RATE_LIMITED");
  assert.ok(Number(r.headers.get("retry-after")) > 0);
});

test("the route file exports a Web-standard POST bound to real globals (503 with no env)", async () => {
  const saved = process.env.SILICUS_DEMO_PASSCODE;
  delete process.env.SILICUS_DEMO_PASSCODE;
  try {
    const mod = await import("../fetch.mjs");
    assert.equal(typeof mod.POST, "function");
    assert.equal((await read(await mod.POST(post(FETCH_URL, { url: "https://example.org/" })))).status, 503);
  } finally {
    if (saved !== undefined) process.env.SILICUS_DEMO_PASSCODE = saved;
  }
});
