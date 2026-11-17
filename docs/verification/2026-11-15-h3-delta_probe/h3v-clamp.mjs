/**
 * narrow-shell.mjs — the online build at narrow widths: does anything overflow or clip?
 *
 * A COPY of scripts/browser-mode-smoke.mjs, adapted for layout: it builds the app with
 * VITE_SILICUS_MODE=browser, serves it with EXACTLY the headers vercel.json sets (strict CSP
 * included) and the same two mock functions, then drives the same teacher story through the UI
 * (name the course -> confirm materials -> answer the intake -> paste material -> propose ->
 * accept -> draft -> confirm -> publish -> a student asks) so every surface the product owner
 * can reach is on the page. The model is instant here (this harness measures layout, not timing).
 *
 * At each width in NARROW_SHELL_WIDTHS (default 320,380,480,768,1440) it records, per surface:
 *   - documentElement.scrollWidth vs clientWidth (does the PAGE scroll sideways?)
 *   - every element whose right edge passes the viewport's right edge (and any that start left of it)
 *   - every element whose own box is too small for its content (scrollWidth > clientWidth) — text
 *     or a button label being clipped at the edge
 * and exits non-zero if any of those is non-zero. SILICUS_SMOKE_SHOTS=<dir> also captures a cropped
 * PNG of each surface (for before/after proof in docs/design/narrow-width.md).
 *
 * Run:  node frontend/scripts/narrow-shell.mjs                    (exit 0 = nothing overflows)
 *       NARROW_SHELL_WIDTHS=380 node frontend/scripts/narrow-shell.mjs
 */
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { modelReply, scriptedPlanV2 } from "../../host/test/scripted-course.mjs";
const MODE = process.env.H3V_MODE ?? "stage3";
const planFor = (p) => {
  const plan = scriptedPlanV2(p);
  if (MODE === "stage3") return plan;
  if (MODE === "unclamped") return { ...plan, activities: plan.activities.map((a, i) => i === 2 ? { ...a, learnerFirst: "Each learner first predicts the count alone on paper.", aiStatus: "permitted" } : a) };
  if (MODE === "v1") return { title: plan.title, activities: plan.activities.map((a) => ({ title: a.title, minutes: a.minutes, objectiveIds: a.objectiveIds, learnerDoes: a.learnerDoes, teacherDoes: a.teacherDoes, evidenceIfAny: a.evidenceIfAny })) };
  throw new Error("bad mode");
};

const HERE = fileURLToPath(new URL("..", import.meta.url));   // frontend/
const REPO = join(HERE, "..");
const PASSCODE = "smoke-demo-passcode";
const SECRET = "SAFFRON-HERON-8812";
const MATERIAL_TEXT = `Plants make their own food from light.\nThe phrase ${SECRET} appears only in these notes.\nLeaves hold the green pigment that catches light.`;

/** The widths under test. 1440 is the regression guard: the wide-screen design must not move. */
const WIDTHS = (process.env.NARROW_SHELL_WIDTHS ?? "320,380,480,768,1440").split(",").map((s) => Number(s.trim()));
/** Which width the proof screenshots are taken at, and what this run is called (before/after). */
const SHOT_WIDTH = Number(process.env.NARROW_SHELL_SHOT_WIDTH ?? 380);
const SUFFIX = process.env.NARROW_SHELL_SHOT_SUFFIX ?? "run";
const SHOTS = process.env.SILICUS_SMOKE_SHOTS ?? null;

const results = [];
const check = (name, ok, extra = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`;
  results.push(line);
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await sleep(120);
  }
  throw new Error("poll timed out");
}

// ------------------------------------------------------------------ build (browser mode)
const OUT = mkdtempSync(join(tmpdir(), "silicus-narrow-build-"));
const build = spawnSync("npx", ["vite", "build", "--outDir", OUT, "--emptyOutDir"], { cwd: HERE, env: { ...process.env, VITE_SILICUS_MODE: "browser" }, encoding: "utf8" });
check("the app builds with VITE_SILICUS_MODE=browser", build.status === 0, build.status === 0 ? "" : build.stderr.slice(-400));
if (build.status !== 0) process.exit(1);

// ------------------------------------------------------------------ serve with vercel.json's headers + mock functions
const vercel = JSON.parse(readFileSync(join(REPO, "vercel.json"), "utf8"));
const HEADERS = Object.fromEntries(vercel.headers.find((h) => h.source === "/(.*)").headers.map((h) => [h.key, h.value]));
check("serving with vercel.json's strict CSP", /default-src 'self'; script-src 'self'/.test(HEADERS["Content-Security-Policy"] ?? ""));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml" };
const api = { calls: [] };
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
      return sendJson(res, 200, { id: "mock", choices: [{ message: { role: "assistant", content: JSON.stringify(((p) => p.startsWith("Draft one lesson plan") ? planFor(p) : modelReply(p))(parsed?.messages?.[0]?.content ?? "")) } }] });
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
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(e.message));

const bodyHas = (t) => page.evaluate((s) => document.body.innerText.toLowerCase().includes(s.toLowerCase()), t);
const setValue = (selector, text) => page.evaluate((sel, text) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`no element: ${sel}`);
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, selector, text);
  const g2bClick = (t) => page.evaluate((x) => { const el = [...document.querySelectorAll("label, button")].find((e) => (e.getAttribute("aria-label") ?? e.textContent ?? "").trim().includes(x)); el?.click(); return !!el; }, t);
  const g2cBtn = (label) => page.evaluate((x) => { const b = [...document.querySelectorAll("button")].find((e) => !e.disabled && (e.textContent ?? "").trim() === x); b?.click(); return !!b; }, label);
  const g2cWait = (fn, ms = 10000, arg) => page.waitForFunction(fn, { timeout: ms }, arg).then(() => true, () => false);
  await page.evaluate(() => { const i = document.querySelector('form[aria-label="Course and learners"] input[placeholder="How plants make food from sunlight"]'); if (i && !i.value) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "AI in daily life"); i.dispatchEvent(new Event("input", { bubbles: true })); } });
  // Each move retries its click until the next screen is there (a click can land while the step still settles).
  const g2cMove = async (label, ready, ms = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await page.evaluate(ready)) return true;
      await g2cBtn(label);
      await sleep(500);
    }
    return page.evaluate(ready);
  };


const g2cTall = async (width, scale, file) => {
    await page.setViewport({ width, height: 900, deviceScaleFactor: scale });
    await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
    await sleep(400);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewport({ width, height: h, deviceScaleFactor: scale });
    await sleep(400);
    await page.screenshot({ path: join(process.env.NARROW_SHELL_WIZARD_SHOTS, file) });
  };
const OUTDIR = process.env.H3V_SHOTS;
try {
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  // ---- H2b: a stage-3 course (ages 12–14, Computing, no anchor). The scripted plan's third activity asks for AI
  // with no first try; the host clamps it and the plan shows the note under "Silicus adjusted".
  await page.goto(`${APP}/#/studio/new`, { waitUntil: "networkidle0" });
  await sleep(1500); await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Begin")?.click(); }); await poll(() => bodyHas("Who are your learners?"));
  await g2bClick("Lower secondary");
  await g2bClick("Oldest age: one year younger");
  await g2bClick("Write your own");
  await page.waitForFunction(() => /Ages 12–14/.test(document.body.innerText), { timeout: 10000 }).catch(() => null);
  await page.type('form[aria-label="Course and learners"] input[placeholder="How plants eat"]', "Searching and sorting");
  await page.type('form[aria-label="Course and learners"] input[placeholder="Ms. Lovelace"]', "Ada Lovelace");
  await page.evaluate(() => { const i = document.querySelector('form[aria-label="Course and learners"] input[placeholder="How plants make food from sunlight"]'); if (i && !i.value) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "How a computer searches and sorts"); i.dispatchEvent(new Event("input", { bubbles: true })); } });
  await sleep(400);
  const s3Walk = [
    await g2cMove("Continue", () => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without sources")),
    await g2cMove("Continue without sources", () => !!document.querySelector('section[aria-label="Your objectives"] textarea')),
  ];
  await setValue('section[aria-label="Your objectives"] textarea', "Explain why binary search needs a sorted list\nCarry out a bubble sort and count its swaps");
  s3Walk.push(await g2cMove("Continue", () => !!document.querySelector('section[aria-label="Review and confirm"]')));
  s3Walk.push(await g2cMove("Confirm and create the course", () => /^#\/studio\/(?!new$)./.test(location.hash), 15000));
  if (s3Walk.includes(false)) console.log(`H2b stage-3 walk stalled: ${JSON.stringify(s3Walk)} at ${(await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\s+/g, " ")}`);
  // No anchor, so no suggestions: the brief's outcomes come back as proposals ("Use my answers"); accept each.
  await g2cMove("Use my answers", () => document.querySelectorAll('aside[aria-label="Proposals"] article').length > 0, 8000);
  for (let i = 0; i < 10 && await page.evaluate(() => document.querySelectorAll('aside[aria-label="Proposals"] article').length) > 0; i++) {
    await g2cBtn("Accept");
    await sleep(400);
  }
  await g2cWait(() => !!document.querySelector("li[data-objective-id]"), 10000);
  await g2cWait(() => [...document.querySelectorAll('button[data-primary="true"]')].some((b) => b.textContent.trim() === "Confirm objectives" && !b.disabled), 8000);
  await g2cMove("Confirm objectives", () => /Step 3 of 4/i.test(document.body.innerText), 12000);
  await g2cMove("Draft the lesson plan", () => !!document.querySelector('[role="dialog"] input[type="password"]') || !!document.querySelector("[data-session-evidence]"));
  if (await page.evaluate(() => !!document.querySelector('[role="dialog"] input[type="password"]'))) {
    await page.type('[role="dialog"] input[type="password"]', PASSCODE);
    await g2cBtn("Continue");
  }
  const s3 = await g2cWait(() => !!document.querySelector("[data-adjusted]"), 20000);
  const s3Notes = await page.evaluate(() => [...document.querySelectorAll("[data-adjusted] li")].map((e) => e.textContent));
  if (!s3) console.log(`H2b stage-3 plan missing at: ${(await page.evaluate(() => location.hash + " " + document.body.innerText)).slice(0, 900).replace(/\s+/g, " ")}`);
  check("H2b the stage-3 plan shows the host's clamp under 'Silicus adjusted'",
    s3 && s3Notes.length === 1 && /clamped to .?forbidden/i.test(s3Notes[0]) && /How a computer finds things fast/.test(await page.evaluate(() => document.body.innerText)), JSON.stringify({ s3Walk, s3Notes }));
  const info = async () => page.evaluate(() => {
    const vis = (e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { display: cs.display, visibility: cs.visibility, h: Math.round(r.height), w: Math.round(r.width) }; };
    const marks = [...document.querySelectorAll("[data-clamped]")];
    const items = [...document.querySelectorAll("li")].filter((li) => li.querySelector("[data-design-row]"));
    return {
      markerCount: marks.length,
      markers: marks.map((m) => ({ text: m.textContent, vis: vis(m), inItemIndex: items.findIndex((li) => li.contains(m)), itemTitle: (items.find((li) => li.contains(m))?.innerText ?? "").split("\n")[0].slice(0, 80) })),
      activityCount: items.length,
      notes: [...document.querySelectorAll("[data-adjusted] li")].map((e) => e.textContent),
      bodyHasMarkerText: /AI removed by Silicus/.test(document.body.innerText),
    };
  });
  const screen = await info();
  console.log("MODE", MODE, "SCREEN", JSON.stringify(screen));
  if (OUTDIR) { const m = await page.$("[data-clamped]"); await (m ?? await page.$('article[aria-label^="Lesson plan"]')).evaluate((e) => e.scrollIntoView({ block: "center" })); await g2cTall(1440, 1, `h3v-${MODE}-screen.png`); }
  await page.emulateMediaType("print");
  await sleep(300);
  const print = await info();
  console.log("MODE", MODE, "PRINT", JSON.stringify(print));
  if (OUTDIR) { await page.setViewport({ width: 794, height: 1200, deviceScaleFactor: 2 }); await sleep(300); await page.setViewport({ width: 794, height: await page.evaluate(() => document.documentElement.scrollHeight), deviceScaleFactor: 2 }); await sleep(400); const sheet = await page.$('article[aria-label^="Lesson plan"]'); if (sheet) await sheet.screenshot({ path: join(OUTDIR, `h3v-${MODE}-print.png`) }); }
  await page.emulateMediaType(null);
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  // reload: does the flag survive persistence?
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(1500);
  const after = await info();
  console.log("MODE", MODE, "RELOAD", JSON.stringify({ hash: await page.evaluate(() => location.hash), markerCount: after.markerCount, bodyHasMarkerText: after.bodyHasMarkerText, activityCount: after.activityCount }));
  console.log("CONSOLE_ERRORS", JSON.stringify(consoleErrors.slice(0, 5)));
} catch (e) { console.log("DRIVER_ERROR", e.stack?.split("\n").slice(0, 4).join(" | ")); }
finally { await browser.close(); server.close(); }
