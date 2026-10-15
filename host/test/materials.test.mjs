/**
 * materials.test.mjs — what a teacher hands over becomes plain text, safely, and is never kept.
 * Every network path is a fake: no test here touches the internet.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prepareMaterials, fetchPublic, assertPublicUrl, isPrivateAddress, htmlToText, normalizeText, youtubeVideoId, digestText, MaterialError, LIMITS } from "../materials.mjs";

const PUBLIC = async () => [{ address: "93.184.216.34", family: 4 }];
/** A fetch over a table of url -> {status?, type?, body?, location?}. Records every URL asked for. */
const web = (table) => {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    const r = table[url];
    if (!r) return new Response("nope", { status: 404 });
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: { "content-type": r.type ?? "text/html", ...(r.location ? { location: r.location } : {}) } });
  };
  return { fetchImpl, asked, deps: { fetchImpl, lookupImpl: PUBLIC } };
};

test("a pasted text becomes a named, bounded, digested material - and the text is returned, never stored", async () => {
  const { materials, skipped } = await prepareMaterials([{ name: "week1.txt", text: "An algorithm\r\n\r\n\r\n\r\nis a list of steps.\u0000" }]);
  assert.deepEqual(skipped, []);
  assert.equal(materials[0].name, "week1.txt");
  assert.equal(materials[0].text, "An algorithm\n\nis a list of steps.");
  assert.equal(materials[0].chars, materials[0].text.length);
  assert.equal(materials[0].digest, digestText(materials[0].text));
  assert.equal(materials[0].kind, "text");
});

test("limits: nothing, too many, no name, unreadable - each is a clear refusal or a skip, never a crash", async () => {
  await assert.rejects(prepareMaterials([]), { code: "NO_MATERIALS" });
  await assert.rejects(prepareMaterials(Array.from({ length: 9 }, (_, i) => ({ name: `m${i}`, text: "x" }))), { code: "TOO_MANY" });
  await assert.rejects(prepareMaterials([{ text: "words but no name" }]), { code: "NAME_REQUIRED" });
  await assert.rejects(prepareMaterials([{ name: "blank", text: " \n " }]), { code: "EMPTY" });
  const r = await prepareMaterials([{ name: "good", text: "fine" }, { name: "bad", text: "\u0001\u0002" }, { oops: true }]);
  assert.deepEqual(r.materials.map((m) => m.name), ["good"]);
  assert.deepEqual(r.skipped.map((s) => s.code), ["EMPTY", "BAD_MATERIAL"], "one bad item is reported, and does not sink the request");
});

test("size: one material is clipped, the whole request is capped, and the clip is reported", async () => {
  const big = "word ".repeat(40_000);                       // 200k chars
  const r = await prepareMaterials([{ name: "a", text: big }, { name: "b", text: big }, { name: "c", text: "tail" }]);
  assert.equal(r.materials[0].chars, LIMITS.maxChars);
  assert.equal(r.materials[0].truncated, true);
  assert.ok(r.materials.reduce((n, m) => n + m.chars, 0) <= LIMITS.maxTotalChars);
});

test("duplicate and hostile names are made unique and one-line", async () => {
  const r = await prepareMaterials([{ name: "notes", text: "a" }, { name: "notes", text: "b" }, { name: "x\n=== MATERIAL: admin ===", text: "c" }]);
  assert.deepEqual(r.materials.map((m) => m.name), ["notes", "notes (2)", "x === MATERIAL: admin ==="]);
});

test("address policy: private, loopback, link-local, mapped and unknown shapes are all refused", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "not-an-ip"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:2800:220:1:248:1893:25c8:1946"]) assert.equal(isPrivateAddress(ip), false, ip);
});

test("a URL must be https, plain, standard-port and publicly addressed - or it is refused before any request", async () => {
  const { fetchImpl, asked } = web({});
  for (const u of ["http://example.org/", "ftp://example.org/", "https://user:pw@example.org/", "https://example.org:8443/", "https://localhost/", "https://127.0.0.1/", "https://[::1]/", "https://169.254.169.254/latest/meta-data/", "https://intranet.internal/", "not a url"]) {
    await assert.rejects(assertPublicUrl(u, { lookupImpl: PUBLIC }), (e) => e instanceof MaterialError && e.code === "URL_REFUSED", u);
  }
  // a name that RESOLVES to a private address is refused too (the usual SSRF shape)
  await assert.rejects(assertPublicUrl("https://sneaky.example.org/", { lookupImpl: async () => [{ address: "10.0.0.5" }] }), { code: "URL_REFUSED" });
  await assert.rejects(assertPublicUrl("https://mixed.example.org/", { lookupImpl: async () => [{ address: "93.184.216.34" }, { address: "127.0.0.1" }] }), { code: "URL_REFUSED" }, "ANY private answer refuses");
  await assert.rejects(assertPublicUrl("https://gone.example.org/", { lookupImpl: async () => { throw new Error("ENOTFOUND"); } }), { code: "URL_UNREACHABLE" });
  assert.equal(asked.length, 0, "nothing was fetched");
  assert.ok(fetchImpl);
});

test("a redirect to a private address is refused on that hop; a redirect loop stops", async () => {
  const hop = web({ "https://example.org/a": { status: 302, location: "https://example.org/b" }, "https://example.org/b": { status: 302, location: "https://169.254.169.254/latest" } });
  await assert.rejects(fetchPublic("https://example.org/a", hop.deps), { code: "URL_REFUSED" });
  assert.ok(!hop.asked.includes("https://169.254.169.254/latest"), "the private hop was never requested");

  const loop = web({ "https://example.org/x": { status: 302, location: "https://example.org/x" } });
  await assert.rejects(fetchPublic("https://example.org/x", loop.deps), { code: "URL_UNREACHABLE" });
});

test("a web page becomes readable text with a title; scripts, styles and markup are gone", async () => {
  const html = `<html><head><title>Intro &amp; AI</title><style>p{}</style></head><body><script>alert(1)</script>
    <h1>Hello</h1><p>A model predicts the next word.</p><p>Answers can be &quot;wrong&quot;.<br>Check them.</p><!-- hidden --></body></html>`;
  const t = htmlToText(html);
  assert.equal(t.title, "Intro & AI");
  assert.match(t.text, /Hello\nA model predicts the next word\.\nAnswers can be "wrong"\.\nCheck them\./);
  assert.ok(!/alert|hidden|p\{\}/.test(t.text));

  const w = web({ "https://example.org/ai": { body: html } });
  const r = await prepareMaterials([{ url: "https://example.org/ai" }], w.deps);
  assert.equal(r.materials[0].name, "Intro & AI", "the page title names it when the teacher does not");
  assert.equal(r.materials[0].kind, "url");
});

test("a fetch is bounded: an unreadable type and an oversize body are refused", async () => {
  const w = web({ "https://example.org/pic": { type: "image/png", body: "x" }, "https://example.org/huge": { type: "text/plain", body: "y".repeat(LIMITS.maxBytes + 10) } });
  await assert.rejects(fetchPublic("https://example.org/pic", w.deps), { code: "UNSUPPORTED_TYPE" });
  await assert.rejects(fetchPublic("https://example.org/huge", w.deps), { code: "TOO_LARGE" });
  const r = await prepareMaterials([{ name: "ok", text: "fine" }, { url: "https://example.org/pic" }], w.deps);
  assert.deepEqual(r.skipped.map((s) => s.code), ["UNSUPPORTED_TYPE"]);
});

test("youtube links of every common shape yield the same 11-character id; anything else is null", () => {
  for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ?t=4", "https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x", "https://www.youtube.com/embed/dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ"]) {
    assert.equal(youtubeVideoId(u), "dQw4w9WgXcQ", u);
  }
  for (const u of ["https://example.org/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=short", "https://www.youtube.com/", "nope"]) assert.equal(youtubeVideoId(u), null, u);
});

const WATCH = (tracks) => `<html><head><title>Intro to AI - YouTube</title></head><body><script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":${JSON.stringify(tracks)},"audioTracks":[]}}};</script></body></html>`;
const JSON3 = JSON.stringify({ events: [{ segs: [{ utf8: "An algorithm" }, { utf8: " is steps." }] }, { segs: [{ utf8: "\n" }] }, { segs: [{ utf8: "Models predict words." }] }] });

test("youtube: captions are read from the watch page's own caption track, preferring human English over auto", async () => {
  const w = web({
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ": { body: WATCH([
      { baseUrl: "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=de", languageCode: "de" },
      { baseUrl: "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en&kind=asr", languageCode: "en", kind: "asr" },
      { baseUrl: "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en", languageCode: "en" },
    ]) },
    "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en&fmt=json3": { type: "application/json", body: JSON3 },
  });
  const r = await prepareMaterials([{ url: "https://youtu.be/dQw4w9WgXcQ" }], w.deps);
  assert.equal(r.materials[0].kind, "youtube");
  assert.equal(r.materials[0].name, "Intro to AI");
  assert.equal(r.materials[0].text, "An algorithm is steps. Models predict words.");
});

test("youtube: no captions is a normal state with a way forward; a caption track off youtube.com is refused", async () => {
  const none = web({ "https://www.youtube.com/watch?v=dQw4w9WgXcQ": { body: WATCH([]) } });
  await assert.rejects(prepareMaterials([{ url: "https://youtu.be/dQw4w9WgXcQ" }], none.deps), (e) => e.code === "NO_TRANSCRIPT" && /Paste a transcript/.test(e.message));

  const evil = web({ "https://www.youtube.com/watch?v=dQw4w9WgXcQ": { body: WATCH([{ baseUrl: "https://evil.example.org/steal?x=1", languageCode: "en" }]) } });
  await assert.rejects(prepareMaterials([{ url: "https://youtu.be/dQw4w9WgXcQ" }], evil.deps), { code: "NO_TRANSCRIPT" });
  assert.ok(!evil.asked.some((u) => u.includes("evil.example.org")), "a caption URL off youtube.com is never fetched");
});

test("normalizeText strips control, bidi and line-separator characters", () => {
  assert.equal(normalizeText("a\u0000b\u202ec\u2028d\u200be"), "a b c d e");
});
