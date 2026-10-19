/**
 * browser-mode-smoke.mjs — the online build, end to end, in real Chrome: the teacher's browser IS the host.
 *
 * Builds the app with VITE_SILICUS_MODE=browser (into a temp dir, so frontend/dist stays the host-mode build the
 * live smoke serves), serves it with EXACTLY the headers vercel.json sets (strict CSP included), and stands in for
 * the site's two functions with local mocks that follow their fixed contract (/api/worker: an OpenAI-shaped reply
 * behind the demo passcode; /api/worker/status; /api/fetch). Then drives the whole story through the UI:
 *
 *   name the course -> confirm materials -> answer Silicus's questions -> confirm the outline -> paste material ->
 *   propose (the passcode is asked for and answered) -> accept the objectives -> draft the plan -> confirm ->
 *   publish -> a student asks and gets a cited answer -> reload: the course is still there and verifies ->
 *   export all (a file is downloaded) -> delete all -> a tampered file is refused -> import -> the course is back.
 *
 * State is asserted on the RECORD (IndexedDB, read in the page) and re-verified in Node with the host's own
 * chain and backup modules over real node:crypto, so a log written by the browser verifies on the Node host.
 * The model is slow on purpose: the mocked /api/worker takes SILICUS_SMOKE_PLAN_MS (default 2000) to draft a plan and 1.5 s to
 * answer a student, so the run also asserts the WAITING EXPERIENCE: the plain-words title with the real count, a live clock, the
 * typical range, one polite live region, "What the model sees" matching the request that really left the page (and never
 * the teacher's label), a true receipt afterwards, the passcode pause, and still motion under prefers-reduced-motion.
 * SILICUS_SMOKE_PLAN_MS=28000 also holds the plan past its usual range to assert (and capture) the "taking longer" line.
 * Also asserted: no /api/courses request ever leaves the page, material text is never stored, student chat
 * writes nothing, the passcode lives in sessionStorage only, 0 CSP violations, 0 console errors.
 *
 * Run:  node frontend/scripts/browser-mode-smoke.mjs     (exit 0 = pass)
 */
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import JSZip from "jszip";
import { modelReply } from "../../host/test/scripted-course.mjs";
import { verifyRecords } from "../../host/chain.mjs";
import { readBackup } from "../../host/backup.mjs";

const HERE = fileURLToPath(new URL("..", import.meta.url));   // frontend/
const REPO = join(HERE, "..");
const PASSCODE = "smoke-demo-passcode";
const SECRET = "SAFFRON-HERON-8812";
const MATERIAL_TEXT = `Plants make their own food from light.\nThe phrase ${SECRET} appears only in these notes.\nLeaves hold the green pigment that catches light.`;

const results = [];
/** Which pass is running ("wide 1440" / "narrow 380"). Every check line carries it. */
let passLabel = "setup";
const check = (name, ok, extra = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  [${passLabel}] ${name}${extra ? " — " + extra : ""}`;
  results.push(line);
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await sleep(150);
  }
  throw new Error("poll timed out");
}

// ------------------------------------------------------------------ build (browser mode)
const OUT = mkdtempSync(join(tmpdir(), "silicus-browser-build-"));
const build = spawnSync("npx", ["vite", "build", "--outDir", OUT, "--emptyOutDir"], { cwd: HERE, env: { ...process.env, VITE_SILICUS_MODE: "browser" }, encoding: "utf8" });
check("the app builds with VITE_SILICUS_MODE=browser", build.status === 0, build.status === 0 ? "" : build.stderr.slice(-400));
if (build.status !== 0) process.exit(1);
const chunks = readdirSync(join(OUT, "assets"));
check("the browser host is its own chunk in the browser build", chunks.some((f) => /^browserHost-.*\.js$/.test(f)));

// ------------------------------------------------------------------ serve with vercel.json's headers + mock functions
const vercel = JSON.parse(readFileSync(join(REPO, "vercel.json"), "utf8"));
const HEADERS = Object.fromEntries(vercel.headers.find((h) => h.source === "/(.*)").headers.map((h) => [h.key, h.value]));
check("serving with vercel.json's strict CSP", /default-src 'self'; script-src 'self'/.test(HEADERS["Content-Security-Policy"] ?? ""));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml", ".mjs": "text/javascript; charset=utf-8" };

const PLAN_MS = Number(process.env.SILICUS_SMOKE_PLAN_MS ?? 2000);
const STUDENT_MS = 1500;
/** How long the mocked model "thinks", by the kind of prompt (host/worker.mjs builds each prompt's first line). */
// The propose worker is instant by default; a small delay lets the running waiting card be measured (F5).
const PROPOSE_MS = Number(process.env.SILICUS_SMOKE_PROPOSE_MS ?? 600);
const modelDelay = (prompt) => prompt.startsWith("Draft one lesson plan") ? PLAN_MS : prompt.startsWith("You are a study helper") ? STUDENT_MS : prompt.startsWith("Propose learning objectives") ? PROPOSE_MS : 0;

const api = { calls: [], workerBodies: [] };
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c).toString("utf8"))); });
const sendJson = (res, status, obj, extra = {}) => { res.writeHead(status, { ...HEADERS, "content-type": "application/json", ...extra }); res.end(JSON.stringify(obj)); };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) {
    const body = await readBody(req);
    api.calls.push({ method: req.method, path: url.pathname, passcode: req.headers["x-silicus-passcode"] ?? null });
    if (url.pathname === "/api/worker/status" && req.method === "GET") return sendJson(res, 200, { configured: true, zdr: true, provider: "openrouter", passcodeRequired: true, model: "mock" });
    if ((url.pathname === "/api/worker" || url.pathname === "/api/fetch") && req.method === "POST") {
      if (req.headers["x-silicus-passcode"] !== PASSCODE) return sendJson(res, 401, { error: { code: "BAD_PASSCODE" } });
      if (url.pathname === "/api/fetch") return sendJson(res, 422, { error: { code: "URL_REFUSED" } });
      const parsed = JSON.parse(body || "{}");
      api.workerBodies.push(body);
      const prompt = parsed?.messages?.[0]?.content ?? "";
      if (modelDelay(prompt) > 0) await sleep(modelDelay(prompt));
      return sendJson(res, 200, { id: "mock", choices: [{ message: { role: "assistant", content: JSON.stringify(modelReply(prompt)) } }] });
    }
    return sendJson(res, 404, { error: { code: "NOT_FOUND" } });
  }
  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = normalize(join(OUT, rel));
  if (!file.startsWith(OUT) || !existsSync(file)) { res.writeHead(404, HEADERS); return res.end("not found"); }
  res.writeHead(200, { ...HEADERS, "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const APP = `http://127.0.0.1:${server.address().port}`;

// ------------------------------------------------------------------ Chrome
const exe = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
if (!exe) throw new Error("no system chrome found");
const browser = await puppeteer.launch({ executablePath: exe, headless: "new", args: ["--no-sandbox"] });
let page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
// No server configuration in the public bundle (verifier finding MED-1): no env-variable or key names, nothing key-shaped.
{
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  const text = walk(OUT).filter((f) => /\.(js|html|css|map)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
  const names = [...new Set(text.match(/\b(SILICUS_[A-Z_]+|OPENROUTER_API_KEY|ANTHROPIC_API_KEY)\b/g) ?? [])];
  check("the built bundle names no server env variable or key", names.length === 0, names.join(", "));
  check("the built bundle holds nothing key-shaped", !/sk-(or-)?(v1-)?[A-Za-z0-9]{20,}/.test(text));
}

const DOWNLOADS = mkdtempSync(join(tmpdir(), "silicus-downloads-"));

const consoleErrors = [];
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") { consoleErrors.push(m.text()); console.log(`[console.error] ${m.text()}`); } });
page.on("pageerror", (e) => { pageErrors.push(e.message); console.log(`[pageerror] ${e.message}`); });
page.on("response", (r) => { if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.url()}`); });
await page.evaluateOnNewDocument(() => {
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
});

/* ------------------------------ the narrow pass ------------------------------
 * The SAME story runs twice: once at 1440 (the design's own width) and once at
 * 380, where a teacher's narrow window lives. The narrow pass additionally asserts
 * at every stage that the page never scrolls sideways, that no element's right edge
 * passes the viewport, that nothing is clipped by its own box, and — the defect a
 * real user hit — that the primary confirm button still shows its whole label.
 * -------------------------------------------------------------------------- */
const layoutSnapshot = () => page.evaluate(() => {
  const clientWidth = document.documentElement.clientWidth;
  // Real overflow: a box that extends past the viewport. Text in normal flow WRAPS, so a card that
  // genuinely cannot fit shows up here as a widened ancestor chain — no heuristic needed.
  const past = [...document.querySelectorAll("body *")].flatMap((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.right <= clientWidth + 1) return [];
    return [{ tag: el.tagName, className: typeof el.className === "string" ? el.className : "", right: Math.round(rect.right), text: (el.textContent ?? "").trim().slice(0, 60) }];
  });
  // Clipping: only where the element really HIDES what does not fit (overflow hidden/clip, or a control
  // whose label is cut). Text that overflows without clipping is not a defect.
  const clipped = [...document.querySelectorAll("body *")].flatMap((el) => {
    const hidden = /hidden|clip/.test(getComputedStyle(el).overflowX);
    const control = /^(BUTTON|INPUT|TEXTAREA)$/.test(el.tagName);
    if ((!hidden && !control) || el.clientWidth <= 1) return [];
    if (el.scrollWidth <= el.clientWidth + 1) return [];
    return [{ tag: el.tagName, className: typeof el.className === "string" ? el.className : "", clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, text: (el.textContent ?? "").trim().slice(0, 60) }];
  });
  const button = [...document.querySelectorAll("button")].find((b) => /build the plan|Review & publish/i.test(b.textContent ?? ""));
  return {
    clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    button: button ? { clientWidth: button.clientWidth, scrollWidth: button.scrollWidth, text: button.textContent.trim() } : null,
    past,
    clipped,
  };
});

/** The narrow pass's standing assertion, run at every stage of the story. */
const checkNarrow = async (stage) => {
  const m = await layoutSnapshot();
  check(`narrow ${stage}: the page does not scroll sideways`, m.scrollWidth <= m.clientWidth + 1, `scrollWidth ${m.scrollWidth} vs clientWidth ${m.clientWidth}`);
  check(`narrow ${stage}: no element's right edge passes the viewport`, m.past.length === 0,
    m.past.slice(0, 4).map((o) => `${o.tag}.${o.className} right=${o.right} "${o.text}"`).join(" | "));
  check(`narrow ${stage}: no element's content is clipped by its own box`, m.clipped.length === 0,
    m.clipped.slice(0, 4).map((o) => `${o.tag}.${o.className} ${o.scrollWidth}>${o.clientWidth} "${o.text}"`).join(" | "));
  if (m.button) {
    check(`narrow ${stage}: the confirm button "${m.button.text}" shows its whole label`, m.button.scrollWidth <= m.button.clientWidth + 1, `scrollWidth ${m.button.scrollWidth} vs clientWidth ${m.button.clientWidth}`);
  }
};

// C1.5 helpers: the stage page marks exactly one primary action; the plan's title is the plan's text.
const primaryCount = () => page.evaluate(() => [...document.querySelectorAll('[data-primary="true"]')].filter((b) => b.offsetParent !== null).length);
const countIn = (t) => page.evaluate((s) => document.body.innerText.split(s).length - 1, t);
const bodyHas = (t) => page.evaluate((s) => document.body.innerText.toLowerCase().includes(s.toLowerCase()), t);
const clickText = (text) => page.evaluate((t) => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    (x.textContent ?? "").trim().startsWith(t) || (x.getAttribute("aria-label") ?? "").trim().startsWith(t));
  if (!b) throw new Error(`no button matching: ${t}`);
  b.click();
  return true;
}, text);
/** Click, then wait for the consequence; re-click if React replaced the node between find and click (a real flake). */
async function clickAndWait(text, predicate, attempts = 3, perAttemptMs = 6000) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    try { await clickText(text); } catch (e) { last = e; }
    // Per-attempt budget, so a genuinely dead control fails in ~18 s, not 3 x the 20 s poll default.
    try { return await poll(predicate, perAttemptMs); } catch (e) { last = e; await sleep(400); }
  }
  throw last ?? new Error(`clickAndWait failed: ${text}`);
}
const setValue = (selector, text) => page.evaluate((sel, text) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`no element: ${sel}`);
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
  setter.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, selector, text);
/** Everything this origin holds: every IndexedDB value plus both Web Storages. Read IN the page. */
const stored = () => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open("silicus-host"); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const all = (name) => new Promise((res) => { const r = db.transaction(name, "readonly").objectStore(name).getAll(); r.onsuccess = () => res(r.result); });
  const out = { metas: await all("courses"), events: await all("events"), local: { ...localStorage }, session: { ...sessionStorage } };
  db.close();
  return out;
});
/** Optional captures for design review: SILICUS_SMOKE_SHOTS=<dir>. */
const SHOTS = process.env.SILICUS_SMOKE_SHOTS ?? null;
const shot = async (name, selector = null) => {
  if (!SHOTS) return;
  const el = selector ? await page.$(selector) : null;
  await (el ?? page).screenshot({ path: join(SHOTS, `${name}.png`) });
};
/** Stage captures for docs/design/stage-page.md: the whole page (height-capped), named by stage and width; a .txt of its words beside each. */
const stageShot = async (name, selector = null, viewportOnly = false) => {
  if (!SHOTS) return;
  const w = page.viewport().width;
  await page.evaluate(() => window.scrollTo(0, 0)); // the sticky navigator and rail are drawn where the window is: capture from the top
  const path = join(SHOTS, `stage-${name}-${w}.png`);
  const el = selector ? await page.$(selector) : null;
  writeFileSync(path.replace(/\.png$/, ".txt"), await page.evaluate((sel) => (sel ? document.querySelector(sel) : document.body).innerText, selector));
  if (el) { await el.screenshot({ path }); return; }
  // A modal is fixed to the viewport, so its capture is the viewport, not the scrolled-out page.
  if (viewportOnly) { await page.screenshot({ path }); return; }
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({ path, captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 6000) } });
};
/** C-d: the landing's hero is a REAL capture of the Objectives stage of this build: SILICUS_SMOKE_SHOTS=<dir> writes hero-objectives.png (2x, the proposals card only). */
const heroShot = async () => {
  if (!SHOTS) return;
  const orig = page.viewport();
  if (orig.width < 1100) return;
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  // The card's top to the foot of the second proposal (its divider is left out: the image border closes the card): the first two rows with Accept / Rename / Drop, and not the
  // sticky decision bar (it would sit over the third row in a capture).
  const box = await page.evaluate(() => {
    const card = document.querySelector('section[aria-label="Objective proposals"]');
    const rows = card ? [...card.querySelectorAll("li")].filter((li) => li.querySelector("h3")) : [];
    if (!card || rows.length < 2) return null;
    const c = card.getBoundingClientRect(), r = rows[1].getBoundingClientRect();
    return { x: c.left + scrollX, y: c.top + scrollY, width: c.width, height: r.bottom - c.top - 1 };
  });
  if (box) await page.screenshot({ path: join(SHOTS, "hero-objectives.png"), captureBeyondViewport: true, clip: box });
  await page.setViewport(orig);
};
/** C-a (workspace): at the two laptop sizes, the stage's primary action is inside the window the moment the stage opens. */
// `settled`: the stage is a conversation whose cards (OnboardingChat, MaterialsPanel) are not this page's: measured where the page
// came to rest (their own autofocus scrolls their input into view). Every other stage is measured from the top of the page.
const primaryInViewport = async (stage, { settled = false } = {}) => {
  const orig = page.viewport();
  if (orig.width < 1100) return; // narrow keeps its single column; its own checks are the narrow ones
    for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    if (!settled) await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(200);
    const r = await page.evaluate(() => {
      const els = [...document.querySelectorAll('[data-primary="true"]')].filter((b) => b.offsetParent !== null);
      if (els.length === 0) return null;
      const b = els[0].getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), vh: innerHeight, vw: innerWidth, label: els[0].textContent.trim().slice(0, 40), count: els.length };
    });
    if (SHOTS && w === 1440) await page.screenshot({ path: join(SHOTS, `ws-${stage.replace(/[^a-z]+/g, "-")}-1440x900.png`) });
    check(`workspace ${w}x${h}: the ${stage} primary is inside the window when the stage opens`,
      !!r && r.count === 1 && r.top >= 0 && r.bottom <= r.vh && r.left >= 0 && r.right <= r.vw, JSON.stringify(r));
  }
  await page.setViewport(orig);
  await page.evaluate(() => window.scrollTo(0, 0));
};
/**
 * C-e (workspace polish): measured in a real 1440x900 VIEWPORT, scrolled the way a teacher scrolls.
 * (A full-page capture draws a sticky bar mid-page, which is how this was first misread.) Wide pass only.
 *  - the stage's sticky bar is a layer: an opaque background and a shadow;
 *  - scrolled to the bottom, the last content of the open stage is fully above that bar;
 *  - the page keeps scroll-padding under the bar, and a control focused from the top of the page ends up clear of it;
 *  - everything in the stage column ends at one right edge, and there is no dead band above Record details.
 * Captures: SILICUS_SMOKE_SHOTS=<dir> writes polish-<name>.png (top of the stage) and polish-<name>-bottom.png.
 */
const polishCheck = async (name) => {
  const orig = page.viewport();
  if (orig.width < 1100) return;
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(250);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `polish-${name}.png`) });
  const probe = () => page.evaluate(() => {
    const bars = [...document.querySelectorAll('[data-stage-bar], [data-armed][data-print="hide"]')].filter((b) => b.offsetParent !== null);
    const bar = bars[bars.length - 1];
    if (!bar) return null;
    const last = bar.previousElementSibling;
    const cs = getComputedStyle(bar);
    const b = bar.getBoundingClientRect();
    const l = last ? last.getBoundingClientRect() : null;
    const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 0; const p = m[1].split(/[ ,\/]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; };
    return {
      sticky: cs.position === "sticky", opaque: alpha(cs.backgroundColor) === 1, shadow: cs.boxShadow !== "none",
      barTop: Math.round(b.top), barHeight: Math.round(b.height), lastBottom: l ? Math.round(l.bottom) : null, hasLast: !!last,
    };
  });
  // Docked, not floating: while the bar is stuck to the window (page at the top, long stage), it sits flush on the
  // window's bottom edge, so no strip of the page shows under it (a 16 px gap did, at integration).
  const dock = await page.evaluate(() => {
    const bars = [...document.querySelectorAll('[data-stage-bar], [data-armed][data-print="hide"]')].filter((b) => b.offsetParent !== null);
    const bar = bars[bars.length - 1];
    if (!bar) return null;
    const b = bar.getBoundingClientRect();
    return { stuck: b.bottom > innerHeight - 40, gap: Math.round(innerHeight - b.bottom) };
  });
  check(`polish ${name}: a stuck bar is docked flush to the window's bottom edge (nothing shows under it)`, !dock || !dock.stuck || Math.abs(dock.gap) <= 1, JSON.stringify(dock));
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(250);
  const r = await probe();
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `polish-${name}-bottom.png`) });
  check(`polish ${name}: the stage's bar is a layer (sticky, opaque background, a shadow)`, !!r && r.sticky && r.opaque && r.shadow, JSON.stringify(r));
  check(`polish ${name}: scrolled to the bottom, the last content of the open stage is fully above the bar`, !!r && r.hasLast && r.lastBottom <= r.barTop, JSON.stringify(r));
  // A control in the stage's last content, focused from the top of the page, must come to rest clear of the bar.
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(150);
  const f = await page.evaluate(async () => {
    const bars = [...document.querySelectorAll('[data-stage-bar], [data-armed][data-print="hide"]')].filter((b) => b.offsetParent !== null);
    const bar = bars[bars.length - 1];
    const last = bar?.previousElementSibling;
    if (!last) return { ok: false, why: "no last content" };
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary';
    const ctl = [...last.querySelectorAll(sel), ...(last.matches(sel) ? [last] : [])].filter((c) => c.offsetParent !== null).pop();
    if (!ctl) return { ok: true, why: "the last content holds no control" };
    // (the bar's own buttons must keep NO scroll margin: focusing the primary must not move the page)
    ctl.focus();
    await new Promise((res) => setTimeout(res, 400));
    const c = ctl.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    const own = bar.querySelector('button'); const m = parseFloat(getComputedStyle(ctl).scrollMarginBottom) || 0;
    return { ok: (c.bottom <= b.top || c.top >= b.bottom) && m >= b.height + 16 && (!own || !(parseFloat(getComputedStyle(own).scrollMarginBottom) > 0)), margin: m, ownMargin: own ? parseFloat(getComputedStyle(own).scrollMarginBottom) : null, ctl: ctl.textContent.trim().slice(0, 30), ctlTop: Math.round(c.top), ctlBottom: Math.round(c.bottom), barTop: Math.round(b.top), barBottom: Math.round(b.bottom) };
  });
  check(`polish ${name}: a control in the stage's last content, focused from the top, lands clear of the bar (scroll-margin >= bar + 16 px); the bar's own buttons keep none`, f.ok === true, JSON.stringify(f));
  // The record sections close the stage column: they share its right edge and sit one rhythm step under the stage.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(150);
  const e = await page.evaluate(() => {
    const rd = document.querySelector('details[aria-label="Record details"]');
    const main = rd?.parentElement;
    const shown = main ? [...main.children].filter((k) => k.getBoundingClientRect().height > 0) : [];
    const rights = shown.map((k) => Math.round(k.getBoundingClientRect().right));
    const gaps = shown.slice(1).map((k, i) => Math.round(k.getBoundingClientRect().top - shown[i].getBoundingClientRect().bottom));
    const at = shown.indexOf(rd);
    return { rights, gaps, gapAboveDetails: at > 0 ? gaps[at - 1] : null, maxGap: gaps.length ? Math.max(...gaps) : null, kids: shown.length };
  });
  check(`polish ${name}: every block of the stage column, Record details and the browser notice included, ends at one right edge`,
    e.kids >= 3 && Math.max(...e.rights) - Math.min(...e.rights) <= 1, JSON.stringify(e));
  check(`polish ${name}: no dead band: no gap in the stage column is taller than 40 px, and Record details sits within 24 px of the stage`,
    e.gapAboveDetails !== null && e.gapAboveDetails <= 24 && e.maxGap <= 40, JSON.stringify(e));
  await page.setViewport(orig);
  await page.evaluate(() => window.scrollTo(0, 0));
};
/**
 * C-e items 2 and 3, in a real 1440x900 viewport at the plan stage (steps 1-3 finished):
 *  - a finished step keeps its number, shows it is finished, and looks openable (a chevron, a pointer, a hover state);
 *  - the left column's course title is at the navigator's scale, on one line, and the byline does not orphan a word.
 */
const navigatorCheck = async (name) => {
  const orig = page.viewport();
  if (orig.width < 1100) return;
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(250);
  const a = await page.evaluate(() => {
    const items = [...document.querySelectorAll('ol[aria-label="Steps"] > li')];
    const done = items.filter((li) => li.dataset.state === "done");
    const mk = (li) => li.querySelector('[aria-hidden="true"]')?.textContent?.trim();
    const go = (li) => { const g = [...li.querySelectorAll('[aria-hidden="true"]')].find((x) => x.textContent.trim() === "\u203a"); return !!g && getComputedStyle(g).display !== "none"; };
    return {
      count: done.length,
      numbers: items.map(mk),
      doneHaveChevron: done.every(go), doneAreButtons: done.every((li) => li.querySelector("button")),
      cursor: done[0] ? getComputedStyle(done[0].querySelector("button")).cursor : null,
      doneCheck: done.every((li) => li.textContent.includes("\u2713")),
    };
  });
  check(`navigator ${name}: finished steps keep their numbers 1-5 and say they are finished`, a.count >= 3 && a.numbers.join(",") === "1,2,3,4,5" && a.doneCheck, JSON.stringify(a));
  check(`navigator ${name}: finished steps look openable (a chevron, a pointer)`, a.doneHaveChevron && a.doneAreButtons && a.cursor === "pointer", JSON.stringify(a));
  const bg = () => page.evaluate(() => getComputedStyle(document.querySelector('ol[aria-label="Steps"] li[data-state="done"] button')).backgroundColor);
  await page.mouse.move(5, 5);
  const rest = await bg();
  await page.hover('ol[aria-label="Steps"] li[data-state="done"] button');
  await sleep(250);
  const hov = await bg();
  await page.mouse.move(5, 5);
  check(`navigator ${name}: a finished step has a hover state`, rest !== hov, `${rest} -> ${hov}`);
  const t = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const label = document.querySelector('ol[aria-label="Steps"] li[data-state="current"] [class*="stepLabel"]');
    const lines = (el) => {
      const r = document.createRange(); const rows = new Map();
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const re = /\S+/g; let m;
        while ((m = re.exec(n.textContent))) { r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); const bb = r.getBoundingClientRect(); if (bb.width === 0) continue; const top = Math.round(bb.top); rows.set(top, (rows.get(top) ?? 0) + 1); }
      }
      return [...rows.entries()].sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    };
    const sub = h1.nextElementSibling;
    const stepFont = parseFloat(getComputedStyle(label).fontSize);
    const docTitle = document.querySelector('article h1, article h2');
    return {
      titleFont: parseFloat(getComputedStyle(h1).fontSize), stepFont, titleLines: lines(h1), subLines: lines(sub),
      docFont: docTitle ? parseFloat(getComputedStyle(docTitle).fontSize) : null, colWidth: Math.round(h1.getBoundingClientRect().width),
    };
  });
  check(`navigator ${name}: the left column's course title is at the navigator's scale (at most 1.25x a step name), on one line, and no louder than the document title`,
    t.titleFont <= t.stepFont * 1.25 && t.titleLines.length === 1 && (t.docFont === null || t.titleFont <= t.docFont), JSON.stringify(t));
  check(`navigator ${name}: the byline is two deliberate lines (who, then where it is kept) and leaves no word alone`, t.subLines.length <= 2 && t.subLines.every((n) => n >= 2), JSON.stringify(t));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `polish-${name}-navigator.png`), clip: { x: 40, y: 60, width: 290, height: 520 } });
  await page.setViewport(orig);
  await page.evaluate(() => window.scrollTo(0, 0));
};
/**
 * C-e item 4, plan stage, 1440x900: "draft" is said once per surface. The navigator's line for the plan does not say it, and the finished
 * waiting card is a short receipt (no "Draft ready" eyebrow, no "stays a draft" line), not a second page.
 */
const draftOnceCheck = async (name) => {
  const orig = page.viewport();
  if (orig.width < 1100) return;
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(250);
  const d = await page.evaluate(() => {
    const steps = [...document.querySelectorAll('ol[aria-label="Steps"] > li')].find((li) => /^\s*4?\s*Plan/.test(li.innerText) || li.innerText.includes("Plan"));
    const card = document.querySelector('section[data-phase="done"][data-variant="card"]');
    const bar = document.querySelector("[data-stage-bar]");
    return {
      navPlan: steps ? steps.innerText.replace(/\s+/g, " ").trim() : null,
      card: card ? card.innerText.replace(/\s+/g, " ").trim() : null, cardHeight: card ? Math.round(card.getBoundingClientRect().height) : null,
      barSaysDraft: bar ? /draft/i.test(bar.innerText) : null,
    };
  });
  check(`draft-once ${name}: the navigator's plan line does not say "draft" (the tag and the bar do)`, !!d.navPlan && !/draft/i.test(d.navPlan) && d.barSaysDraft === true, JSON.stringify(d));
  check(`draft-once ${name}: the finished waiting card is a receipt: no "Draft ready" eyebrow, no "stays a draft" line, at most 130 px tall`,
    !!d.card && !/draft ready|stays a draft|nothing is decided yet/i.test(d.card) && /Took\s*\d+ s/.test(d.card) && /each cites only objectives you confirmed/.test(d.card) && d.cardHeight <= 130, JSON.stringify(d));
  await page.setViewport(orig);
};
/**
 * C-e item 5, the rail at 1440x900: the header is one line; a row's tag is a stage word (Material, Brief, Objectives, Plan, Version);
 * when every row would say "just now" the rows show the clock; " · 2 times" is not broken across lines.
 */
const railCheck = async (name) => {
  const orig = page.viewport();
  if (orig.width < 1100) return;
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(250);
  const r = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    if (!aside) return null;
    const h2 = aside.querySelector("h2");
    const meta = h2?.nextElementSibling;
    const lineOf = (el) => { const rs = [...el.getClientRects()]; return rs.length; };
    const rows = [...aside.querySelectorAll("li[data-action]")];
    const tags = rows.map((li) => li.querySelector("[data-artifact]")?.textContent.replace("Changed: ", "").trim());
    const times = rows.map((li) => li.querySelector("time")?.textContent.trim());
    const timesSpan = [...aside.querySelectorAll('[class*="_times_"]')];
    const hb = h2.getBoundingClientRect(); const mb = meta ? meta.getBoundingClientRect() : null;
    return {
      headOneLine: !!mb && Math.abs(hb.top - mb.top) < 12 && hb.height < 36 && meta.getBoundingClientRect().height < 24, titleH: Math.round(hb.height), metaH: mb ? Math.round(mb.height) : null,
      tags: [...new Set(tags)], times, timesCount: timesSpan.length, timesBroken: timesSpan.some((t) => t.getClientRects().length > 1),
      nowrap: timesSpan.every((t) => getComputedStyle(t).whiteSpace === "nowrap"), rows: rows.length,
    };
  });
  const okTags = ["Material", "Brief", "Objectives", "Plan", "Version"];
  check(`rail ${name}: the header ("Behind the scenes" and the count) is on one line`, !!r && r.headOneLine, JSON.stringify(r));
  check(`rail ${name}: every tag is a stage word (Material, Brief, Objectives, Plan, Version), never Outline, Record or Package`, !!r && r.tags.length > 0 && r.tags.every((t) => okTags.includes(t)), JSON.stringify(r?.tags));
  check(`rail ${name}: rows do not all say "just now": the clock is shown instead`, !!r && r.rows > 1 && r.times.every((t) => /^\d\d:\d\d(:\d\d)?$/.test(t) || !/just now/.test(t)) && !r.times.every((t) => t === "just now"), JSON.stringify(r?.times));
  check(`rail ${name}: " · 2 times" stays whole (no break inside it)`, !!r && (r.timesCount === 0 || (r.nowrap && !r.timesBroken)), `times spans: ${r?.timesCount}, nowrap ${r?.nowrap}, broken ${r?.timesBroken}`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `polish-${name}-rail.png`), clip: { x: 1060, y: 60, width: 380, height: 700 } });
  await page.setViewport(orig);
};
const kinds = (s) => s.events.sort((a, b) => a.seq - b.seq).map((e) => JSON.parse(e.line).event.kind);

async function story(label, narrow) {
  passLabel = label;
  // ---- first impression: the BARE url shows the landing (product decision, C-d); its footer's "Classic view" opens the live course
  await page.goto(`${APP}/`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("h1") !== null);
  // F5: the landing is measured AFTER navigation — before it, the frame is still about:blank.
  if (narrow) await checkNarrow("landing (bare URL)");
  const bare = await page.evaluate(() => ({ h1: document.querySelector("h1")?.textContent ?? "", hash: location.hash, proposals: !!document.querySelector('section[aria-label="Objective proposals"]') }));
  check("the bare URL shows the landing, not the live course and not the demo decision card", /^Plan a lesson with an AI that proposes\./.test(bare.h1) && !bare.proposals, bare.h1);
  await page.click('a[href="#/live"]');
  await page.waitForFunction(() => /Build a course, one decision at a time/.test(document.querySelector("h1")?.textContent ?? ""));
  if (narrow) await checkNarrow("live course, first visit");
  const first = await page.evaluate(() => ({
    title: document.title, h1: document.querySelector("h1")?.textContent ?? "", header: document.querySelector("header")?.innerText ?? "",
    icon: document.querySelector('link[rel="icon"]')?.getAttribute("href") ?? "", tabs: document.querySelectorAll('nav[aria-label="Workbench sections"]').length,
    design: [...document.querySelectorAll("footer a")].map((a) => [a.textContent, a.getAttribute("href")]),
    wordmark: document.querySelector('header a[aria-label="Silicus TA, home"]')?.getAttribute("href") ?? null,
  }));
  check("#/live (Classic view) opens the live course, not the demo decision card", /Build a course, one decision at a time/.test(first.h1) && (await page.$('section[aria-label="Objective proposals"]')) === null, first.h1);
  check("the app masthead's Silicus wordmark links back to the landing (#/)", first.wordmark === "#/", String(first.wordmark));
  check("the page is titled as the product, with an inline SVG favicon", /^Silicus TA/.test(first.title) && /^data:image\/svg\+xml,/.test(first.icon), first.title);
  check("the header reads as the product, not 'design workbench · tokens-first'", /Silicus/.test(first.header) && !/workbench|tokens-first/i.test(first.header) && first.tabs === 0, first.header.replace(/\n/g, " | "));
  check("the component workbench stays reachable through a discreet footer 'Design system' link", first.design.some(([t, h]) => t === "Design system" && h === "#/decision"));
  await shot("00-first-impression");
  // C1.5 (new): the tour opens on a teacher's first visit and not on a reload; the passes use a fresh context each.
  check("tour: opens on the first visit, before any course exists", await poll(() => page.evaluate(() => !!document.querySelector('[role="dialog"][aria-modal="true"]'))));
  if (narrow) await checkNarrow("first-run tour");
  await shot("00b-tour");
  await stageShot("01-tour", null, true);
  await page.click('button[aria-label="Close the tour"]');
  await stageShot("02-landing-first-question");
  check("tour: closing it puts the cursor in the first question", await poll(() => page.evaluate(() => !document.querySelector('[role="dialog"]') && document.activeElement?.id === "onboarding-reply")));
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("h1") !== null);
  check("tour: does not open again on reload", await page.evaluate(() => !document.querySelector('[role="dialog"]')));
  await page.click('footer a[href="#/decision"]');
  await poll(() => page.evaluate(() => document.querySelector('section[aria-label="Objective proposals"]') !== null));
  check("the Design system link opens the workbench, with a way back to the course", await page.evaluate(() => [...document.querySelectorAll("nav a")].some((a) => a.textContent === "Back to the course")));
  // F7: the workbench route measures clean at 320 and 380 (there is no "report" claiming otherwise), so check it here.
  if (narrow) await checkNarrow("design system workbench");
  // The workbench is a detour: set the hash back to the live course and wait for its own first control.
  // (A same-document goto to another hash would leave the app on the workbench route.)
  await page.evaluate(() => { location.hash = "#/live"; });
  await page.waitForSelector("#onboarding-reply");
  if (narrow) await checkNarrow("onboarding step 1: name the course");
  // ---- name the course (checkpoint 1)
  const reply = async (text, button) => { await page.waitForSelector("#onboarding-reply"); await setValue("#onboarding-reply", text); await clickText(button); };
  await reply("How plants eat", "Record the course title");
  await page.waitForFunction(() => document.body.innerText.includes("What name should this course show for you"));
  if (narrow) await checkNarrow("onboarding step 2: name the label");
  await reply("Ada Lovelace", "Record this name");
  await page.waitForFunction(() => document.body.innerText.includes("Name the materials"));
  if (narrow) await checkNarrow("onboarding step 3: name the materials");
  await reply("Lesson notes", "Record these names");
  await poll(async () => (await stored()).metas.length === 1);
  check("the course is recorded in IndexedDB (not on a server)", true);
  check("no /api/courses request ever left the page", !api.calls.some((c) => c.path.startsWith("/api/courses")));
  await poll(() => bodyHas("Confirm the material list"));
  if (narrow) await checkNarrow("onboarding: confirm the material list");
  await stageShot("03-confirm-material-list");
  await primaryInViewport("confirm material list", { settled: true });
  await clickText("Confirm the material list");
  await poll(async () => kinds(await stored()).includes("checkpoint.confirmed"));
  check("materials confirmed on the record", true);

  // ---- checkpoint 2: Silicus's own questions; ASFAI says it needs the local app
  await poll(() => page.evaluate(() => !!document.querySelector("#intake-topic")));
  await shot("01b-intake");
  await stageShot("04-intake");
  await primaryInViewport("intake", { settled: true });
  if (narrow) await checkNarrow("intake question 1: topic");
  check("ASFAI says plainly it needs the local app, with no Connect button",
    (await bodyHas("needs the local Silicus app")) && !(await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /Connect ASFAI/.test(b.textContent ?? "")))));
  const fill = (id, text) => page.evaluate((id, text) => {
    const ta = document.querySelector(`#intake-${id}`);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, id, text);
  await fill("topic", "Photosynthesis"); await clickText("Record this answer");
  await poll(() => page.evaluate(() => !!document.querySelector("#intake-course")));
  if (narrow) await checkNarrow("intake question 2: course");
  await fill("course", "Science, ages 8-10"); await clickText("Record this answer");
  await poll(() => bodyHas("Propose these from my materials instead"));
  if (narrow) await checkNarrow("intake question 3: outcomes");
  await clickText("Propose these from my materials instead");
  await poll(() => bodyHas("Confirm the brief"));
  await primaryInViewport("confirm brief");
  if (narrow) await checkNarrow("brief confirm");
  await clickText("Confirm the brief");
  await poll(async () => kinds(await stored()).filter((k) => k === "checkpoint.confirmed").length === 2);
  check("outline confirmed on the record", true);

  if (narrow) await checkNarrow("material panel");
  // ---- material -> propose (the passcode is asked for)
  await poll(() => bodyHas("Add your material here"));
  check("the material panel says YouTube needs the local app", await bodyHas("YouTube captions need the local Silicus app"));
  check("zero-retention is claimed only because the site's status says zdr: true", await bodyHas("zero-data-retention providers only"));
  await page.evaluate(() => {
    const name = [...document.querySelectorAll("label")].find((l) => /Or paste text/.test(l.textContent ?? ""));
    const input = document.getElementById(name.htmlFor);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "Lesson notes");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate((text) => {
    const ta = document.querySelector('textarea[aria-label="Pasted text"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, MATERIAL_TEXT);
  await clickText("Add this text");
  await poll(() => bodyHas("Lesson notes ·"));
  await shot("06-material-panel", 'section[aria-label="Course material"]');
  await stageShot("05-material");
  await primaryInViewport("material", { settled: true });
  await clickText("Propose objectives from my materials");
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  check("an AI action asks for the demo passcode", await bodyHas("Demo passcode"));
  check("while the passcode dialog is open the waiting card holds its clock and says why",
    await page.evaluate(() => /Waiting for your passcode/.test(document.querySelector('section[data-phase="running"]')?.innerText ?? "")));
  await shot("02-passcode", '[role="dialog"]');
  if (narrow) await checkNarrow("passcode pause, waiting card held");
  await page.type('[role="dialog"] input[type="password"]', PASSCODE);
  await clickText("Continue");
  // No race: the card is already running before Continue (it held its clock through the passcode pause, asserted
  // above), and the mocked proposal takes PROPOSE_MS more after the click.
  await page.waitForSelector('section[data-phase="running"]', { timeout: 5000 });
  if (narrow) await checkNarrow("waiting card, proposing objectives");
  await poll(async () => kinds(await stored()).includes("objectives.proposed"), 15000);
  const objReceipt = await poll(() => page.evaluate(() => document.querySelector('section[data-phase="done"][data-variant="card"]')?.innerText ?? null));
  check("proposing objectives ends with a true receipt: the proposals, none confirmed, what was read",
    /3 proposals\. None is confirmed until you decide\./.test(objReceipt) && /Drawn from 1 material/.test(objReceipt), objReceipt.replace(/\n+/g, " | "));
  await shot("11-receipt-proposals", 'section[data-phase="done"][data-variant="card"]');
  await stageShot("06-objectives-proposed");
  await primaryInViewport("objectives (proposed)");
  await polishCheck("objectives");
  await heroShot();
  check("the worker proposed objectives through /api/worker, with the passcode header",
    api.calls.some((c) => c.path === "/api/worker" && c.passcode === PASSCODE));
  let s = await stored();
  check("the passcode is in sessionStorage only", s.session["silicus.demoPasscode"] === PASSCODE
    && !JSON.stringify(s.local).includes(PASSCODE) && !JSON.stringify(s.metas).includes(PASSCODE) && !JSON.stringify(s.events).includes(PASSCODE));
  check("the material text went to the model once…", api.workerBodies.some((b) => b.includes(SECRET)));
  check("…and is in no IndexedDB value, localStorage or sessionStorage", !JSON.stringify(s).includes(SECRET));

  if (narrow) await checkNarrow("confirm bar, proposals undecided");
  // ---- the teacher decides (accept every proposal)
  await poll(async () => {
    const st = await stored();
    const ks = kinds(st);
    if (ks.filter((k) => k === "objectives.decided").length >= 3) return true;
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") ?? "").trim().startsWith("Accept objective"));
      if (b && !b.disabled) b.click();
    });
    await sleep(400);
    return null;
  }, 25000);
  check("one teacher decision recorded per proposal", kinds(await stored()).filter((k) => k === "objectives.decided").length === 3);

  if (narrow) await checkNarrow("confirmed objectives");
  // ---- plan: draft, confirm
  // C1.5: the confirm bar under the decided objectives carries this act now (it used to be a separate button).
  await poll(() => bodyHas("build the plan"));
  await stageShot("07-objectives-decided");
  await primaryInViewport("objectives (decided)");
  check("stage: the objectives stage has exactly one primary action", await poll(async () => (await primaryCount()) === 1) === true, `primaries=${await primaryCount()}`);
  const confirmedStatements = await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Objective proposals"] h3')].map((h) => h.textContent.trim()));
  check("three confirmed objectives are on the page to be sent", confirmedStatements.length === 3 && confirmedStatements.every(Boolean), String(confirmedStatements.length));
  const planBodiesBefore = api.workerBodies.length;
  await clickText("Confirm 3 objectives · build the plan");
  await page.waitForSelector('section[data-phase="running"][data-variant="card"]', { timeout: 5000 });
  if (narrow) await checkNarrow("waiting card, drafting the plan");
  const running = () => page.evaluate(() => document.querySelector('section[data-phase="running"][data-variant="card"]')?.innerText ?? "");
  const live = () => page.evaluate(() => [...document.querySelectorAll('section[data-variant="card"] [aria-live="polite"]')].map((n) => n.textContent));
  check("the waiting experience says in plain words what is happening, with the real count",
    /Drafting a lesson plan from your 3 confirmed objectives/.test(await running()));
  check("it states the typical range the documented defaults give: usually 8–30 seconds", /usually 8\u201330 seconds/.test(await running()));
  const liveAtStart = await live();
  check("exactly one polite aria-live region announces the start (not every second)", liveAtStart.length === 1 && /^Drafting a lesson plan from your 3 confirmed objectives\. Usually 8 to 30 seconds\.$/.test(liveAtStart[0]), JSON.stringify(liveAtStart));
  check("there is no progress bar and no percentage", !(await page.evaluate(() => !!document.querySelector('section[data-phase="running"] progress, section[data-phase="running"] [role="progressbar"]') || /%/.test(document.querySelector('section[data-phase="running"]')?.innerText ?? ""))));
  await shot("10-waiting-plan", 'section[data-phase="running"][data-variant="card"]');
  await stageShot("08-plan-drafting");
  await page.evaluate(() => { [...document.querySelectorAll('section[data-phase="running"] button')].find((b) => b.textContent.trim() === "What the model sees").click(); });
  const sees = await page.evaluate(() => { const b = document.querySelector('section[data-phase="running"] button[aria-expanded="true"]'); return b ? document.getElementById(b.getAttribute("aria-controls")).innerText : null; });
  check("'What the model sees' opens and lists the confirmed statements, the topic, the material names, and what it never sees",
    !!sees && confirmedStatements.every((t) => sees.includes(t)) && /Photosynthesis/.test(sees) && /Lesson notes/.test(sees) && /What it never sees/i.test(sees), sees === null ? "did not open" : "");
  await shot("12-waiting-plan-sees", 'section[data-phase="running"][data-variant="card"]');
  await poll(async () => /\b[1-9] s elapsed/.test(await running()), 8000);
  check("the elapsed readout is a real clock: it has advanced", true);
  if (PLAN_MS > 27000) {
    await poll(async () => /Taking longer than usual/.test(await running()), PLAN_MS);
    check("past the high end the calm 'taking longer' line appears, and says nothing is lost", /If the model does not answer, this step stops by itself, and nothing you have recorded is lost/.test(await running()));
    await shot("13-waiting-longer", 'section[data-phase="running"][data-variant="card"]');
  } else {
    check("before the high end there is no 'taking longer' line", !/Taking longer than usual/.test(await running()));
  }
  await poll(async () => kinds(await stored()).includes("plan.proposed"), PLAN_MS + 15000);
  const planReceipt = await poll(() => page.evaluate(() => document.querySelector('section[data-phase="done"][data-variant="card"]')?.innerText ?? null));
  check("drafting the plan ends with a true receipt computed from the resulting view (C-e: it no longer repeats \"It stays a draft until you confirm it.\"; the stage bar and the DRAFT tag say it)",
    /Checked: \d+ activit(y|ies), each cites only objectives you confirmed \(\d+ citations?\)\./.test(planReceipt) && !/It stays a draft until you confirm it\./.test(planReceipt), planReceipt.replace(/\n+/g, " | "));
  const announced = await poll(async () => {
    const t = await page.evaluate(() => document.querySelector('section[data-variant="card"] [aria-live="polite"]')?.textContent ?? "");
    return /^Finished after \d+ s\. Checked:/.test(t) ? t : null;
  }).catch(() => "");
  check("it says how long the step took, and the live region announces the finish", /Took\s*\d+ s/.test(planReceipt) && announced !== "", `${planReceipt.split("\n").filter((l) => /Took/.test(l))[0] ?? "(no 'Took' line)"} | announced: ${announced || "(never)"}`);
  await shot("14-receipt-plan", 'section[data-phase="done"][data-variant="card"]');
  const planBody = api.workerBodies.slice(planBodiesBefore).find((b) => b.includes("Draft one lesson plan")) ?? "";
  check("what the model sees is what left the page: every statement, the topic and the material name were sent; the label was NOT",
    confirmedStatements.every((t) => planBody.includes(t)) && planBody.includes("Photosynthesis") && planBody.includes("Lesson notes") && !planBody.includes("Ada Lovelace") && !planBody.includes(SECRET));
  await poll(() => bodyHas("How plants eat"));
  check("the plan is drafted (no second passcode prompt: it is kept for this tab)", !(await page.evaluate(() => !!document.querySelector('[role="dialog"]'))));
  await poll(() => bodyHas("Confirm the lesson plan"));
  // C1.5 (new): the plan stage. The mock plan has 3 activities, each with one "Look at a leaf." line: the plan is on the page ONCE.
  await stageShot("09-plan-drafted");
  await primaryInViewport("plan");
  await polishCheck("plan");
  await navigatorCheck("plan");
  await draftOnceCheck("plan");
  await railCheck("plan");
  check("stage: the plan stage has exactly one primary action", await poll(async () => (await primaryCount()) === 1) === true, `primaries=${await primaryCount()}`);
  check("stage: the lesson plan's text appears exactly once on the plan stage", (await countIn("Look at a leaf.")) === 3, `lines=${await countIn("Look at a leaf.")} (3 = once)`);
  check("rail: a worker row after drafting, and no ASFAI lane in the online app",
    await page.evaluate(() => !!document.querySelector('li[data-actor="worker"]') && ![...document.querySelectorAll("[data-lane-name]")].some((x) => (x.textContent ?? "").trim() === "ASFAI")));
  // C-a (workspace): edit the objectives from the plan and come back: two clicks, and the page is where it was (within 40 px).
  if (!narrow) {
    const orig = page.viewport();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await sleep(200);
    const y0 = await page.evaluate(() => { const y = Math.max(0, Math.min(700, document.documentElement.scrollHeight - innerHeight - 50)); window.scrollTo(0, y); return window.scrollY; });
    await sleep(150);
    check("workspace: the plan page is tall enough to scroll, so the return check means something", y0 >= 300, `scrollY ${y0}`);
    await clickText("Edit objectives"); // click 1
    await poll(() => bodyHas("Back to the plan"));
    check("workspace: 'Edit objectives' opens the objectives, with 'Back to the plan' as the one primary",
      (await page.evaluate(() => !!document.querySelector('section[aria-label="Objective proposals"]'))) && (await primaryCount()) === 1);
    await stageShot("09b-edit-objectives");
    await clickText("Back to the plan"); // click 2
    await poll(() => bodyHas("Confirm the lesson plan"));
    await sleep(250);
    const y1 = await page.evaluate(() => window.scrollY);
    check("workspace: edit objectives from the plan and back is two clicks, with scrollY within 40 px", Math.abs(y1 - y0) <= 40, `scrollY ${y0} -> ${y1}`);
    check("workspace: looking wrote nothing (still exactly the three objective decisions)", kinds(await stored()).filter((k) => k === "objectives.decided").length === 3);
    await page.setViewport(orig);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  if (narrow) await checkNarrow("plan card, drafted");
  await clickText("Confirm the lesson plan");
  await poll(async () => kinds(await stored()).includes("plan.confirmed"));
  check("plan confirmed on the record", true);

  if (narrow) await checkNarrow("plan card");
  await poll(() => bodyHas("Review & publish"));
  await stageShot("10-publish");
  await primaryInViewport("publish");
  await polishCheck("publish");
  check("stage: the publish stage has exactly one primary action", await poll(async () => (await primaryCount()) === 1) === true, `primaries=${await primaryCount()}`);
  check("stage: the lesson plan's text appears exactly once on the publish stage", (await countIn("Look at a leaf.")) === 3, `lines=${await countIn("Look at a leaf.")} (3 = once)`);
  // ---- publish (review -> confirm step -> publish)
  await poll(async () => {
    const opened = await page.evaluate(() => !!document.querySelector('[role="group"][aria-label^="Confirm sealing"]'));
    if (opened) return true;
    await page.evaluate(() => {
      const sec = document.querySelector('section[aria-label*="Preview and publish"]');
      const armed = !!sec && /ready to publish/i.test(sec.innerText);
      const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith("Review & publish"));
      if (btn && armed) btn.click();
    });
    await sleep(250);
    return null;
  }, 12000);
  if (narrow) await checkNarrow("seal confirm step");
  await stageShot("11-seal-confirm", 'section[aria-label*="Preview and publish"]');
  await clickText("Publish version 1");
  await poll(async () => kinds(await stored()).includes("package.published"));
  await poll(() => bodyHas("published and pinned on this device"));
  s = await stored();
  check("version 1 sealed, and pinned in this browser", Object.keys(s.local).some((k) => k.startsWith("silicus.pin.")));

  if (narrow) await checkNarrow("publish card, sealed");
  await stageShot("12-published");
  await primaryInViewport("published");
  await page.evaluate(() => window.scrollTo(0, 0));
  check("stage: the published stage has exactly one primary action", await poll(async () => (await primaryCount()) === 1) === true, `primaries=${await primaryCount()}`);
  check("stage: the lesson plan's text appears exactly once on the published stage", (await countIn("Look at a leaf.")) === 3, `lines=${await countIn("Look at a leaf.")} (3 = once)`);
  await clickText("Check a student question");
  check("'Check a student question' puts the cursor in the student's question box", await poll(() => page.evaluate(() => document.activeElement?.id === "student-question")));
  // ---- a student asks; nothing is written
  const beforeAsk = JSON.stringify(await stored());
  await page.waitForSelector('section[aria-label="Check a student question"] input');
  await page.type('section[aria-label="Check a student question"] input', "What do plants need to make food?");
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await clickText("Ask");
  await page.waitForSelector('section[data-variant="compact"][data-phase="running"]', { timeout: 5000 });
  if (narrow) await checkNarrow("student answer, running");
  const compact = await page.evaluate(() => {
    const el = document.querySelector('section[data-variant="compact"][data-phase="running"]');
    const word = el.querySelector("span[style]");
    return { text: el.innerText, motion: el.getAttribute("data-motion"), anim: getComputedStyle(word).animationName, live: el.querySelectorAll('[aria-live="polite"]').length };
  });
  check("a student's answer shows the compact waiting line: where it looks, a clock, the usual 2–15 seconds",
    /Looking for the answer in version 1 of this lesson/.test(compact.text) && /usually 2\u201315 seconds/.test(compact.text) && compact.live === 1, compact.text.replace(/\n+/g, " | "));
  check("under prefers-reduced-motion the type-setting motion is off (data-motion=still, no CSS animation)", compact.motion === "still" && compact.anim === "none", `${compact.motion} / ${compact.anim}`);
  await shot("15-waiting-student", 'section[data-variant="compact"][data-phase="running"]');
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await poll(() => bodyHas("A plant uses light, water and air to make sugar."), 15000);
  check("the student gets an answer that cites the published version", await bodyHas("From Objective 1 \u00b7 Activity 1"));
  await stageShot("13-student-answer");
  // The rail, open: at 380 it is a disclosure that starts closed; at 1440 it is already open.
  await page.evaluate(() => { const t = document.querySelector('aside button[aria-expanded="false"]'); if (t) t.click(); });
  await page.evaluate(() => document.querySelector("aside")?.scrollIntoView({ block: "start" }));
  await stageShot("14-rail-open", "aside");
  check("student chat wrote nothing (IndexedDB and web storage identical before and after)", JSON.stringify(await stored()) === beforeAsk);

  // ---- the record verifies under node:crypto, too
  s = await stored();
  const records = s.events.sort((a, b) => a.seq - b.seq).map((e) => JSON.parse(e.line));
  const v = verifyRecords(records);
  check("the browser-written log verifies on the Node host's chain (node:crypto)", v.ok === true, `${v.events} events`);

  // ---- reload: still there, still verifies
  await page.reload({ waitUntil: "networkidle0" });
  await poll(() => bodyHas("How plants eat"));
  check("after a reload the published course is still there", (await bodyHas("published, version 1")) || (await bodyHas("Version 1")));
  // C1.5: "Verify the event log" lives under Record details (a disclosure); a reload closes it, so open it.
  await page.evaluate(() => { const d = document.querySelector('details[aria-label="Record details"]'); if (d) d.open = true; });
  await poll(() => bodyHas("Verify the event log"));
  await clickText("Verify the event log");
  await poll(() => bodyHas("chain intact"));
  if (narrow) await checkNarrow("post-reload event log");
  check("after a reload the record verifies", await bodyHas(`Event log verified — ${v.events} events, chain intact.`));
  // The notice is shown ONCE (it used to be echoed by every card it was passed to — three copies on screen).
  const noticeCopies = await page.evaluate(() => {
    const t = "Event log verified";
    return [...document.querySelectorAll("p,span,div")].filter((e) => (e.textContent ?? "").includes(t) && e.children.length === 0).length;
  });
  check("the course notice is shown exactly once, not echoed by every card", noticeCopies === 1, `${noticeCopies} cop(y|ies) on the page`);

  if (narrow) await checkNarrow("published course");
  if (narrow) await checkNarrow("footer data controls");
  // ---- export all
  await clickText("Export all courses");
  const exported = await poll(() => {
    const f = readdirSync(DOWNLOADS).find((n) => /^silicus-courses-\d{4}-\d{2}-\d{2}\.json$/.test(n));
    return f ? join(DOWNLOADS, f) : null;
  }, 10000);
  const text = readFileSync(exported, "utf8");
  check("an export file was downloaded", text.length > 100, exported.split("/").at(-1));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("03-course-top");
  const back = readBackup(text);
  check("the export verifies in Node (envelope digest, chain, meta, replay)", back.courses.length === 1 && back.courses[0].events === v.events);
  check("the export holds no material text", !text.includes(SECRET));

  // ---- delete all (confirmed first)
  await clickAndWait("Delete all data from this browser", () => bodyHas("This cannot be undone"));
  if (narrow) await checkNarrow("footer data controls, delete confirm");
  await shot("04-delete-confirm", 'section[aria-label="Where your courses are kept"]');
  await clickAndWait("Delete everything", async () => { const st = await stored(); return st.metas.length === 0 && st.events.length === 0; });
  await poll(() => bodyHas("What should we call this course"));
  s = await stored();
  check("delete all empties IndexedDB, the pins and the passcode", Object.keys(s.local).filter((k) => k.startsWith("silicus.")).length === 0 && !s.session["silicus.demoPasscode"]);

  // ---- a tampered file is refused, whole
  const input = await page.$('input[type="file"][aria-label="Import courses from an exported file"]');
  const tampered = join(DOWNLOADS, "tampered.json");
  writeFileSync(tampered, text.replace("Confirm this lesson plan.", "Confirm a plan I never read."));
  await input.uploadFile(tampered);
  await poll(() => bodyHas("does not match its own fingerprint"));
  await shot("05-tampered", 'section[aria-label="Where your courses are kept"]');
  check("a tampered export is refused with a clear message, and nothing is written",
    (await stored()).events.length === 0 && (await bodyHas("Nothing was imported")));

  // ---- import: the course comes back
  const input2 = await page.$('input[type="file"][aria-label="Import courses from an exported file"]');
  await input2.uploadFile(exported);
  await poll(() => bodyHas("Imported 1 course"));
  await poll(() => bodyHas("How plants eat"));
  s = await stored();
  check("import brings the course back, record intact", s.events.length === v.events && verifyRecords(s.events.sort((a, b) => a.seq - b.seq).map((e) => JSON.parse(e.line))).head === v.head);
  // C1.5: "Verify the event log" lives under Record details (a disclosure); a reload closes it, so open it.
  await page.evaluate(() => { const d = document.querySelector('details[aria-label="Record details"]'); if (d) d.open = true; });
  await poll(() => bodyHas("Verify the event log"));
  await clickText("Verify the event log");
  await poll(() => bodyHas("chain intact"));
  check("the imported course verifies in the app", await bodyHas(`Event log verified — ${v.events} events, chain intact.`));

  // ---- the whole run
  const csp = await page.evaluate(() => window.__csp);
  check("0 CSP violations", csp.length === 0, csp.join("; "));
  check("0 console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  check("0 page errors", pageErrors.length === 0, pageErrors.join(" | "));
  check("the only network calls were the site's functions", api.calls.every((c) => ["/api/worker", "/api/worker/status"].includes(c.path)),
    [...new Set(api.calls.map((c) => c.path))].join(", "));
}

await page.close();

for (const [width, height, label] of [[1440, 1100, "wide 1440"], [380, 900, "narrow 380"]]) {
  // A FRESH context per pass: its own IndexedDB and Web Storage, so the first pass's
  // imported course cannot put the second pass's first-run story into the middle of a course.
  const context = await browser.createBrowserContext();
  page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") { consoleErrors.push(m.text()); console.log(`[console.error] ${m.text()}`); } });
  page.on("pageerror", (e) => { pageErrors.push(e.message); console.log(`[pageerror] ${e.message}`); });
  page.on("response", (r) => { if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.url()}`); });
  await page.evaluateOnNewDocument(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  // A context id names the browser context just created; without it the download is only
  // allowed for the default context, and the export silently misses this pass's directory.
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS, browserContextId: context.id });
  try {
    await story(label, label.startsWith("narrow"));
    check("the whole flow completed", true);
  } catch (e) {
    console.log("[dump] " + (await page.evaluate(() => location.hash + " :: " + document.body.innerText.slice(0, 1500)).catch(() => "?")));
    console.log("[debug] " + (await page.evaluate(() => document.querySelector('section[aria-label="Where your courses are kept"]')?.innerText ?? "(no notice)").catch(() => "?")));
    check("the whole flow completed", false, e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" ") : String(e));
  }
  await context.close();
}

/* ------------------------------ E-b: real file uploads ------------------------------
 * Appended after the two passes (no existing check is touched). A FRESH context: a teacher adds a real PDF and a real
 * DOCX at the naming question; the names are recorded, the text is read in the tab; "propose from my materials" uses
 * it; a reload forgets it and says so; the PDF's marker string is in no IndexedDB or web-storage value; the page
 * made no request outside its own origin (pdf.js's worker comes from the bundle); 0 CSP violations.
 * ------------------------------------------------------------------------------- */
{
  passLabel = "uploads 1440";
  const FIX = join(HERE, "src", "materials", "__fixtures__");
  const PDF_MARK = "HELLO-PDF-MARKER-7731";
  const DOCX_MARK = "DOCX-MARKER-4410";
  const UP = mkdtempSync(join(tmpdir(), "silicus-uploads-"));

  // The main entry chunk must not carry pdf.js: it is a lazy chunk, fetched only when a PDF is chosen.
  {
    const html = readFileSync(join(OUT, "index.html"), "utf8");
    const entry = (html.match(/src="\/(assets\/[^"]+\.js)"/) ?? [])[1];
    const entryText = entry ? readFileSync(join(OUT, entry), "utf8") : "";
    const LIB = ["InvalidPDFException", "PasswordException", "PDFDocumentLoadingTask"];
    const lazy = readdirSync(join(OUT, "assets")).filter((f) => /\.m?js$/.test(f) && f !== entry.split("/").pop())
      .filter((f) => LIB.every((m) => readFileSync(join(OUT, "assets", f), "utf8").includes(m)));
    check("uploads: the main entry chunk does not contain pdf.js (a lazy chunk does)", !!entry && LIB.every((m) => !entryText.includes(m)) && lazy.length >= 1,
      `entry ${entry} (${entryText.length} bytes); lazy pdf.js chunk: ${lazy.join(", ") || "none"}`);
    const lazyDocx = readdirSync(join(OUT, "assets")).filter((f) => /^mammoth\.browser\.min-.*\.js$/.test(f) || /^jszip\.min-.*\.js$/.test(f));
    check("uploads: mammoth and jszip are lazy chunks too, not in the entry", lazyDocx.length === 2 && !entryText.includes("Can't find end of central directory"), lazyDocx.join(", "));
  }

  // A real DOCX, built here.
  const docx = new JSZip();
  docx.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  docx.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  docx.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${[`Leaves hold the green pigment.`, `The code ${DOCX_MARK} appears only in this document.`].map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  const docxPath = join(UP, "Syllabus notes.docx");
  writeFileSync(docxPath, await docx.generateAsync({ type: "nodebuffer" }));
  const pdfPath = join(FIX, "hello.pdf");
  const scanPath = join(FIX, "scan-only.pdf");
  const docPath = join(UP, "old.doc");
  writeFileSync(docPath, "not a real old word file");

  const context = await browser.createBrowserContext();
  page = await context.newPage();
  const errs = [];
  const foreign = [];
  const workerLoads = [];
  page.on("console", (m) => { if (m.type() === "error") { errs.push(m.text()); console.log(`[console.error] ${m.text()}`); } });
  page.on("pageerror", (e) => { errs.push(e.message); console.log(`[pageerror] ${e.message}`); });
  page.on("request", (r) => { if (!r.url().startsWith(APP) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) foreign.push(r.url()); });
  page.on("response", (r) => { if (/pdf\.worker/.test(r.url())) workerLoads.push(`${r.status()} ${r.headers()["content-type"] ?? ""}`); });
  await page.evaluateOnNewDocument(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  const bodiesBefore = api.workerBodies.length;
  try {
    await page.goto(`${APP}/#/live`, { waitUntil: "networkidle0" });
    await page.waitForSelector('button[aria-label="Close the tour"]');
    await page.click('button[aria-label="Close the tour"]');
    const reply = async (text, button) => { await page.waitForSelector("#onboarding-reply"); await setValue("#onboarding-reply", text); await clickText(button); };
    await reply("Photosynthesis from real files", "Record the course title");
    await page.waitForFunction(() => document.body.innerText.includes("What name should this course show for you"));
    await reply("Ada Lovelace", "Record this name");
    await page.waitForFunction(() => document.body.innerText.includes("Name the materials"));

    // ---- choose a real PDF and a real DOCX beside the typed names
    await setValue("#onboarding-reply", "Textbook chapter 3");
    check("uploads: the materials question offers 'Add files' with the PDF, DOCX and PPTX types",
      await page.evaluate(() => { const i = document.querySelector("#onboarding-files"); return !!i && i.multiple && /\.pdf/.test(i.accept) && /\.docx/.test(i.accept) && /\.pptx/.test(i.accept); }));
    await (await page.$("#onboarding-files")).uploadFile(pdfPath, docxPath);
    await poll(async () => (await bodyHas("Syllabus notes.docx ·")) && (await bodyHas("hello.pdf ·")));
    const listed = await page.evaluate(() => [...document.querySelectorAll('ul[aria-label="Files added"] li')].map((li) => li.textContent));
    check("uploads: each file shows its name, kind and character count before anything is sent",
      listed.some((t) => /^hello\.pdf · PDF · [\d,]+ characters$/.test(t)) && listed.some((t) => /^Syllabus notes\.docx · Word · [\d,]+ characters$/.test(t)), listed.join(" | "));
    const pdfChars = Number((listed.find((t) => t.startsWith("hello.pdf")) ?? "").match(/([\d,]+) characters/)?.[1].replace(/,/g, "") ?? 0);
    check("uploads: the PDF's character count is the length of its real text layer", pdfChars > 50 && pdfChars < 200, String(pdfChars));
    const typed = await page.evaluate(() => document.querySelector("#onboarding-reply").value);
    check("uploads: the file names sit on their own lines beside the typed name", typed === "Textbook chapter 3\nhello.pdf\nSyllabus notes.docx", JSON.stringify(typed));
    check("uploads: nothing has left the page (no worker call, no /api/courses) while files are only chosen",
      api.workerBodies.length === bodiesBefore && !api.calls.some((c) => c.path.startsWith("/api/courses")));
    await shot("20-onboarding-files");
    await stageShot("20-onboarding-files");

    // ---- record: the NAMES go on the course, exactly as typed names do
    await clickText("Record these names");
    await poll(async () => (await stored()).metas.length === 1);
    let s = await stored();
    const created = s.events.sort((a, b) => a.seq - b.seq).map((e) => JSON.parse(e.line).event).find((e) => e.kind === "course.created");
    const recordedNames = JSON.stringify(created ?? {});
    check("uploads: the record holds the file names as typed names, and not their text",
      recordedNames.includes("hello.pdf") && recordedNames.includes("Syllabus notes.docx") && recordedNames.includes("Textbook chapter 3") && !JSON.stringify(s).includes(PDF_MARK) && !JSON.stringify(s).includes(DOCX_MARK), recordedNames.slice(0, 200));
    await poll(() => bodyHas("Confirm the material list"));
    await clickText("Confirm the material list");
    await poll(() => page.evaluate(() => !!document.querySelector("#intake-topic")));
    const fill = (id, text) => page.evaluate((id, text) => {
      const ta = document.querySelector(`#intake-${id}`);
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(ta, text);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }, id, text);
    await fill("topic", "Photosynthesis"); await clickText("Record this answer");
    await poll(() => page.evaluate(() => !!document.querySelector("#intake-course")));
    await fill("course", "Science, ages 8-10"); await clickText("Record this answer");
    await poll(() => bodyHas("Propose these from my materials instead"));
    await clickText("Propose these from my materials instead");
    await poll(() => bodyHas("Confirm the brief"));
    await clickText("Confirm the brief");

    // ---- the material panel offers the files chosen at the naming question: no second upload
    await poll(() => bodyHas("Add your material here"));
    await poll(() => bodyHas("hello.pdf · PDF"));
    const offered = await page.evaluate(() => [...document.querySelectorAll('ul[aria-label="Material added"] li p')].map((p) => p.textContent));
    check("uploads: 'propose from my materials' finds the files already chosen in this tab (names and counts shown, no second upload)",
      offered.length === 2 && offered.some((t) => /^hello\.pdf · PDF · [\d,]+ characters$/.test(t)) && offered.some((t) => /^Syllabus notes\.docx · Word · [\d,]+ characters$/.test(t)), offered.join(" | "));
    await shot("21-material-offered", 'section[aria-label="Course material"]');
    await stageShot("21-material-offered");

    // ---- reload: the text is gone, and the panel says what to do
    await page.reload({ waitUntil: "networkidle0" });
    await poll(() => bodyHas("Add your material here"));
    check("uploads: after a reload the files are not offered (the text was never stored)", !(await bodyHas("hello.pdf · PDF")) && !(await bodyHas("Syllabus notes.docx · Word")));
    check("uploads: and the panel says to add the file again, in the glossary's words",
      await bodyHas("Add the file again to use its text. Silicus does not keep your files."));
    s = await stored();
    check("uploads: the PDF's marker text is in no IndexedDB value, localStorage or sessionStorage",
      !JSON.stringify(s).includes(PDF_MARK) && !JSON.stringify(s).includes(DOCX_MARK) && !JSON.stringify(s).includes("Hello from the fixture PDF"));

    // ---- failures are plain sentences, and add nothing
    const panelInput = async () => page.$('section[aria-label="Course material"] input[type="file"]');
    await (await panelInput()).uploadFile(scanPath);
    await poll(() => bodyHas("This PDF has no text layer"));
    const scanNote = await page.evaluate(() => document.querySelector('section[aria-label="Course material"] [role="status"]')?.textContent ?? "");
    check("uploads: an image-only PDF says it has no text layer, names the file, and makes no OCR claim",
      /^scan-only\.pdf: This PDF has no text layer/.test(scanNote) && !/\bOCR\b|recogni[sz]/i.test(scanNote), scanNote);
    await (await panelInput()).uploadFile(docPath);
    await poll(() => bodyHas("old.doc:"));
    const docNote = await page.evaluate(() => document.querySelector('section[aria-label="Course material"] [role="status"]')?.textContent ?? "");
    check("uploads: a legacy .doc says what to do instead", /^old\.doc: .*\.docx/.test(docNote), docNote);
    check("uploads: neither failed file was added to the list", !(await page.evaluate(() => !!document.querySelector('ul[aria-label="Material added"]'))));

    // ---- add the real files again, then propose: the model request carries their text
    await (await panelInput()).uploadFile(pdfPath, docxPath);
    await poll(async () => (await bodyHas("Syllabus notes.docx · Word")) && (await bodyHas("hello.pdf · PDF")));
    check("uploads: the files added again in the panel are listed with their character counts", await page.evaluate(() => document.querySelectorAll('ul[aria-label="Material added"] li').length === 2));
    await clickText("Propose objectives from my materials");
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    await page.type('[role="dialog"] input[type="password"]', PASSCODE);
    await clickText("Continue");
    await poll(async () => kinds(await stored()).includes("objectives.proposed"), 20000);
    const sent = api.workerBodies.slice(bodiesBefore);
    check("uploads: the proposal request carries the PDF's text and the DOCX's text, once each",
      sent.filter((b) => b.includes(PDF_MARK)).length === 1 && sent.filter((b) => b.includes(DOCX_MARK)).length === 1, `${sent.length} worker request(s)`);
    check("uploads: the receipt says the proposals were drawn from 2 materials", await poll(() => bodyHas("Drawn from 2 materials")).catch(() => false) === true);
    s = await stored();
    check("uploads: after proposing, the PDF's marker is STILL in no IndexedDB value, localStorage or sessionStorage",
      !JSON.stringify(s).includes(PDF_MARK) && !JSON.stringify(s).includes(DOCX_MARK));
    await stageShot("22-objectives-from-files");

    // ---- the page stayed inside its own origin and its CSP
    check("uploads: pdf.js's worker came from the bundle, same origin, as JavaScript", workerLoads.length >= 1 && workerLoads.every((w) => /^200 text\/javascript/.test(w)), workerLoads.join(" | "));
    check("uploads: no request left the page's own origin (no CDN)", foreign.length === 0, foreign.join(", "));
    const csp = await page.evaluate(() => window.__csp);
    check("uploads: 0 CSP violations", csp.length === 0, csp.join("; "));
    check("uploads: 0 console or page errors", errs.length === 0, errs.join(" | "));
    check("uploads: the whole upload flow completed", true);
  } catch (e) {
    console.log("[dump] " + (await page.evaluate(() => location.hash + " :: " + document.body.innerText.slice(0, 1500)).catch(() => "?")));
    check("uploads: the whole upload flow completed", false, e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" ") : String(e));
  }
  await context.close();
}

// ------------------------------------------------------------------ the landing (#/), both widths, appended by C-c, reworked by C-d
for (const [width, height, label] of [[1440, 1100, "landing 1440"], [380, 900, "landing 380"]]) {
  passLabel = label;
  const context = await browser.createBrowserContext();
  page = await context.newPage();
  const landingErrors = [];
  page.on("console", (m) => { if (m.type() === "error") landingErrors.push(m.text()); });
  page.on("pageerror", (e) => landingErrors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  // C-d: the landing is the BARE url (the link people paste), not only "#/".
  await page.goto(`${APP}/`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("h1") !== null);
  const L = await page.evaluate(() => {
    const img = document.querySelector("main figure");
    const copy = document.querySelector("main h1")?.closest("div");
    const ib = img?.getBoundingClientRect(), cb = copy?.getBoundingClientRect();
    const rect = (el) => (el ? { w: el.clientWidth, sw: el.scrollWidth } : null);
    return {
      h1: [...document.querySelectorAll("h1")].map((h) => h.textContent),
      h1Lines: [...document.querySelectorAll("h1 > span")].map((n) => [n.textContent, Math.round(n.getBoundingClientRect().top)]),
      banner: document.querySelectorAll("header").length, main: document.querySelectorAll("main").length, footer: document.querySelectorAll("footer").length,
      steps: [...document.querySelectorAll("ol > li > h3")].map((h) => h.textContent),
      nevers: [...document.querySelectorAll("h3")].map((h) => h.textContent).filter((t) => /^Never /.test(t)),
      tryIt: [...document.querySelectorAll("main a")].find((a) => a.textContent === "Open the studio")?.getAttribute("href") ?? null,
      five: [...document.querySelectorAll("a")].some((a) => a.textContent === "How it works"),
      classic: [...document.querySelectorAll("footer a")].find((a) => a.textContent === "Classic view")?.getAttribute("href") ?? null,
      oldLocalLink: [...document.querySelectorAll("a")].some((a) => /Run it on your computer/.test(a.textContent)),
      controls: document.querySelectorAll("button, input").length,
      text: document.body.innerText, html: document.body.textContent,
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      imgs: document.querySelectorAll("main img").length,
      img: img ? { loaded: true, alt: img.querySelector("figcaption")?.textContent ?? "", w: Math.round(ib.width), left: Math.round(ib.left), right: Math.round(ib.right), top: Math.round(ib.top), bottom: Math.round(ib.bottom), vw: innerWidth } : null,
      copyBox: cb ? { left: Math.round(cb.left), right: Math.round(cb.right), top: Math.round(cb.top), bottom: Math.round(cb.bottom) } : null,
      details: (() => { const d = document.querySelector("details"); return d ? { open: d.open, title: d.querySelector("summary")?.textContent ?? "", last: !!d.closest("main > section:last-child") } : null; })(),
      tryRect: rect(document.querySelector("a[href='#/live']")),
    };
  });
  check("landing: the bare URL shows one h1, one banner, one main and one footer", L.h1.length === 1 && /^Plan a lesson with an AI that proposes\. You decide\.$/.test(L.h1[0]) && L.banner === 1 && L.main === 1 && L.footer === 1, L.h1.join(" | "));
  check("landing: the headline breaks after 'proposes.' (two lines, the second is 'You decide.')", L.h1Lines.length === 2 && L.h1Lines[0][0] === "Plan a lesson with an AI that proposes." && L.h1Lines[1][0] === "You decide." && L.h1Lines[1][1] > L.h1Lines[0][1], JSON.stringify(L.h1Lines));
  check("landing: the four steps in order, the three 'Never ...' headings, Open the studio to #/studio, How it works, Classic view to #/live, no controls and no sign-in",
    L.steps.join(",") === "Brief,Objectives,Plan,Publish"
    && L.nevers.join("|") === "Never decides for you|Never keeps your files|Never grades students"
    && L.tryIt === "#/studio" && L.five && L.classic === "#/live" && !L.oldLocalLink && L.controls === 0 && !/sign[ -]?in|log[ -]?in/i.test(L.text), L.steps.join(",") + " :: " + L.nevers.join("|"));
  check("landing: says prototype and ages 5–14, says once where the record is kept (this browser), the demo passcode note is beside Open the studio, claims no approval",
    /prototype/i.test(L.text) && /aged\s5–14/i.test(L.text) && (L.text.match(/kept in this browser/g) ?? []).length === 1 && /Where it stands/.test(L.text)
    && /The AI steps ask for a demo passcode\. Ask the person who shared this link\./.test(L.text) && !/approved|endorse|Google|Arizona/.test(L.text));
  check("landing: 'decide' appears at most three times; no retention promise", (L.html.match(/decid/gi) ?? []).length <= 3 && !/zero[- ]?retention|not retained|never leaves/i.test(L.html) && /Silicus does not keep it/.test(L.html), String((L.html.match(/decid/gi) ?? []).length));
  check("landing: no screenshot; the hero is a drawing of the Objectives step with a caption", L.imgs === 0 && !!L.img && /Objectives step/.test(L.img.alt), JSON.stringify(L.img));
  check(width === 380 ? "landing 380: the drawing sits below the copy, inside the viewport" : "landing 1440: the drawing sits beside the copy, not over it",
    !!L.img && !!L.copyBox && (width === 380 ? L.img.top >= L.copyBox.bottom && L.img.left >= 0 && L.img.right <= L.img.vw : L.img.left >= L.copyBox.right && L.img.right <= L.img.vw && Math.abs(L.img.top - L.copyBox.top) < 120), JSON.stringify([L.img, L.copyBox]));
  check("landing: the technical detail is one collapsed 'Under the hood' disclosure, last on the page, and its text is hidden until opened",
    !!L.details && !L.details.open && /Under the hood/.test(L.details.title) && L.details.last && !/npm install/.test(L.text) && /npm install/.test(L.html), JSON.stringify(L.details));
  check("landing: ASFAI is defined as a protocol where it first appears", L.html.indexOf("ASFAI") === L.html.indexOf("ASFAI is a protocol"), String(L.html.indexOf("ASFAI")));
  check("landing: the page does not scroll sideways", L.sideways <= 0, `overflow ${L.sideways}px`);
  if (width === 380) await checkNarrow("landing page");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `landing-${width}.png`), captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(await page.evaluate(() => document.documentElement.scrollHeight), 6000) } });
  // How it works: in-page, the route (hash) does not change, focus lands on the steps heading.
  await page.click("a[href='#/']:not(header a)");
  const five = await page.evaluate(() => ({ hash: location.hash, focus: document.activeElement?.textContent ?? "", h1: !!document.querySelector("h1") }));
  check("landing: How it works stays on the landing (hash unchanged) and moves focus to the steps heading", five.hash === "" && /^Four steps/.test(five.focus) && five.h1, JSON.stringify(five));
  // The disclosure opens on demand and shows the local setup.
  await page.click("details > summary");
  const opened = await page.evaluate(() => ({ open: document.querySelector("details")?.open, shown: document.body.innerText.includes("npm install"), sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  check("landing: opening Under the hood shows the setup steps, with no sideways scroll", opened.open === true && opened.shown && opened.sideways <= 0, JSON.stringify(opened));
  if (width === 380) await checkNarrow("landing page, Under the hood open");
  await page.click('a[href="#/live"]');
  await poll(() => page.evaluate(() => location.hash === "#/live" && /Build a course/.test(document.querySelector("h1")?.textContent ?? "")));
  check("landing: Classic view opens the app at #/live", true);
  // The way back: the app's wordmark goes to the landing, and #/live still opens the app when typed in directly.
  await page.click('button[aria-label="Close the tour"]').catch(() => {});
  await poll(() => page.evaluate(() => !document.querySelector('[role="dialog"]')));
  await sleep(400); // closing the tour hands focus to the first question, which scrolls the page: a coordinate click can miss
  await page.evaluate(() => document.querySelector('header a[aria-label="Silicus TA, home"]').click());
  const back = await poll(() => page.evaluate(() => /^Plan a lesson with an AI that proposes\./.test(document.querySelector("h1")?.textContent ?? "") && location.hash === "#/")).catch(async () => {
    console.log("[debug] " + (await page.evaluate(() => location.hash + " :: " + (document.querySelector("h1")?.textContent ?? "") + " :: " + document.body.innerText.slice(0, 300))));
    return false;
  });
  check("landing: the app's Silicus wordmark returns to the landing (#/)", back);
  await page.goto(`${APP}/#/live`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => /Build a course/.test(document.querySelector("h1")?.textContent ?? ""));
  check("landing: typing #/live opens the app, not the landing", true);
  const cspLanding = await page.evaluate(() => window.__csp);
  check("landing: 0 CSP violations and 0 console errors", cspLanding.length === 0 && landingErrors.length === 0, [...cspLanding, ...landingErrors].join("; "));
  await context.close();
}

await browser.close();
server.close();

const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(`\n${results.length - failed.length}/${results.length} browser-mode checks passed`);
process.exit(failed.length ? 1 : 0);
