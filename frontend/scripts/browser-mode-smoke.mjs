/**
 * browser-mode-smoke.mjs — the online build, end to end, in real Chrome: the teacher's browser IS the host.
 *
 * Builds the app with VITE_SILICUS_MODE=browser (into a temp dir, so frontend/dist stays the host-mode build the
 * live smoke serves), serves it with EXACTLY the headers vercel.json sets (strict CSP included), and stands in for
 * the site's two functions with local mocks that follow their fixed contract (/api/worker: an OpenAI-shaped reply
 * behind the demo passcode; /api/worker/status; /api/fetch). Then drives the whole story through the STUDIO (#/studio):
 *
 *   landing -> studio home -> the wizard (course, learners, skill map, sources: paste text) -> review and confirm ->
 *   the arrival proposes from the source (the passcode is asked for and answered) -> accept the objectives -> confirm ->
 *   draft the plan -> confirm -> publish -> a student asks (#/learn) and gets a cited answer; Rehearse asks too ->
 *   reload: the course is still there and verifies -> export all (a file is downloaded) -> delete all ->
 *   a tampered file is refused -> import -> the course is back.
 *
 * State is asserted on the RECORD (IndexedDB, read in the page) and re-verified in Node with the host's own
 * chain and backup modules over real node:crypto, so a log written by the browser verifies on the Node host.
 * The model is slow on purpose: the mocked /api/worker takes SILICUS_SMOKE_PLAN_MS (default 2000) to draft a plan and 1.5 s to
 * answer a student, so the run also asserts the WAITING EXPERIENCE the studio has: the one status line ("Silicus is drafting
 * from 3 confirmed objectives") with a live clock and the typical range, one polite live region, the passcode pause, the
 * request that really left the page, and a still "thinking" indicator under prefers-reduced-motion.
 * SILICUS_SMOKE_PLAN_MS=48000 also holds the plan past the wait card's late mark to assert the "Still drafting" line.
 * Also asserted: real PDF and DOCX uploads (read in the tab, names recorded, text never stored), no /api/courses request ever
 * leaves the page, material text is never stored, student chat writes nothing, the passcode lives in sessionStorage only,
 * the landing has no 'Classic view' and an old #/live lands on it, 0 CSP violations, 0 console errors.
 * The classic view at #/live was deleted in K1; its checks moved here (docs: coverage map in the K4 handoff).
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
// Pasted text is named by its first line: "Lesson notes".
const MATERIAL_TEXT = `Lesson notes\nPlants make their own food from light.\nThe phrase ${SECRET} appears only in these notes.\nLeaves hold the green pigment that catches light.`;

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
    if (getComputedStyle(el).textOverflow === "ellipsis") return []; // a crumb that truncates with an ellipsis says so: that is not clipping
    return [{ tag: el.tagName, className: typeof el.className === "string" ? el.className : "", clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, text: (el.textContent ?? "").trim().slice(0, 60) }];
  });
  const button = [...document.querySelectorAll("button")].find((b) => /Confirm objectives|Draft the lesson plan|Confirm the lesson plan|Publish version/i.test(b.textContent ?? ""));
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
  // After "delete all" the database may exist without its stores: nothing recorded.
  const all = (name) => db.objectStoreNames.contains(name) ? new Promise((res) => { const r = db.transaction(name, "readonly").objectStore(name).getAll(); r.onsuccess = () => res(r.result); }) : Promise.resolve([]);
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

// ------------------------------------------------------------------ studio helpers (selectors follow studio-smoke.mjs)
const waitText = async (t, ms = 10000) => { try { await poll(() => bodyHas(t), ms); return true; } catch { return false; } };
/** Click a button / link / summary by its text: exact match first, else the shortest element that contains it. */
const clickBy = async (label) => {
  const hit = await page.evaluate((lab) => {
    const els = [...document.querySelectorAll("button, a, summary")];
    const exact = els.find((e) => (e.textContent ?? "").trim() === lab);
    const el = exact ?? els.filter((e) => (e.textContent ?? "").includes(lab)).sort((a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length)[0];
    if (el) { el.click(); return true; }
    return false;
  }, label);
  await sleep(300);
  return hit;
};
/** A step-1 control by its accessible text (radio cards are labels, steppers are aria-labelled). */
const clickLabel = (text) => page.evaluate((t) => {
  const el = [...document.querySelectorAll("label, button")].find((e) => (e.getAttribute("aria-label") ?? e.textContent ?? "").trim().includes(t));
  if (el) el.click();
  return !!el;
}, text);
/** A REAL mouse click on the enabled primary whose label contains `label`. */
const clickPrimaryBtn = async (label, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const h = await page.evaluateHandle((lab) => [...document.querySelectorAll('button[data-primary="true"]')]
      .find((e) => !e.disabled && (e.textContent ?? "").trim().includes(lab)) ?? null, label);
    const el = h.asElement();
    if (el) { await el.scrollIntoView(); await el.click(); await sleep(350); return true; }
    await sleep(150);
  }
  throw new Error(`no enabled primary: ${label}`);
};
const dialogOpen = () => page.evaluate(() => !!document.querySelector('[role="dialog"][aria-modal="true"] input[type="password"]'));
/** The passcode dialog: type the demo passcode with real keystrokes and press Continue. */
const answerPasscode = async () => {
  await page.waitForSelector('[role="dialog"] input[type="password"]', { timeout: 10000 });
  await page.type('[role="dialog"] input[type="password"]', PASSCODE);
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent ?? "").trim() === "Continue")?.click());
  await sleep(300);
};
/** The studio's ONE status line, clock included (the clock sits outside the live region, aria-hidden). */
const statusLine = () => page.evaluate(() => {
  const st = document.querySelector('[role="status"]');
  const p = st?.closest("p");
  return { words: (st?.textContent ?? "").trim(), line: (p?.innerText ?? "").replace(/\s+/g, " ").trim(), clockHidden: !!p?.querySelector('[aria-hidden="true"]') };
});
/** Every polite live region outside the dialog, minus the plan wait card's own (data-wait-lines). */
const liveRegions = () => page.evaluate(() => [...document.querySelectorAll('[role="status"],[role="alert"],[aria-live="polite"],[aria-live="assertive"]')]
  .filter((n) => !n.closest('[role="dialog"]') && !n.hasAttribute("data-wait-lines")).map((n) => (n.textContent ?? "").trim()).filter(Boolean));
const typeInto = (sel, text) => page.type(sel, text);
const eventsOf = (s) => s.events.sort((a, b) => a.seq - b.seq).map((e) => JSON.parse(e.line).event);
/** Every `statement` string in an event (a proposal's wording), for what-left-the-page checks. */
const statementsIn = (o, out = []) => {
  if (Array.isArray(o)) o.forEach((x) => statementsIn(x, out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (k === "statement" && typeof v === "string") out.push(v); else statementsIn(v, out); }
  return out;
};

/**
 * The wizard, welcome through step 3 (Sources): the same on every pass. Returns with the Sources step on screen.
 * The ranking call asks for the passcode at step 2: "Not now" sends nothing and the step falls back to search (a
 * passcode is answered later, where the AI step needs it, so the passcode pause there is the one measured).
 */
async function wizardToSources(narrow, { title, goal, note }) {
  await clickBy("New course");
  check("wizard: a first run opens on the welcome (#/studio/new)", await waitText("Let’s set up your course", 8000) && (await page.evaluate(() => location.hash)) === "#/studio/new");
  if (narrow) await checkNarrow("wizard welcome");
  await clickBy("Begin");
  await waitText("Your course and learners", 5000);
  if (narrow) await checkNarrow("wizard step 1: course and learners");
  const f1 = 'form[aria-label="Course and learners"] input';
  await typeInto(`${f1}[placeholder="How plants eat"]`, title);
  await typeInto(`${f1}[placeholder="Ms. Lovelace"]`, "Ada Lovelace");
  await typeInto(`${f1}[placeholder="Why leaves stay green, and what that tells us about light"]`, goal);
  await clickLabel("Early primary");
  await clickBy("+ Add a note about the class");
  await sleep(200);
  await setValue('form[aria-label="Course and learners"] textarea', note);
  await sleep(200);
  await clickBy("Continue");
  await waitText("On the skill map", 6000);
  // The ranking call needs the passcode: the dialog opens. "Not now" sends nothing; the step shows search.
  await page.waitForSelector('[role="dialog"] input[type="password"]', { timeout: 8000 });
  check("wizard: the ranking call asks for the demo passcode first (browser host)", true);
  await clickBy("Not now");
  await page.waitForSelector("#map-search", { timeout: 15000 });
  if (narrow) await checkNarrow("wizard step 2: the skill map");
  await page.evaluate(() => document.querySelector('button[data-skip-map="true"]')?.click());
  await waitText("Drop files here", 5000);
  if (narrow) await checkNarrow("wizard step 3: sources");
}

/** From the Sources step to the course: Continue past the sources, accept "propose from my sources", AI check, review, confirm. */
async function wizardFinish(narrow, { proposeFromSources = true } = {}) {
  await clickBy("Continue");
  await waitText("Let Silicus propose objectives from my sources", 5000);
  if (narrow) await checkNarrow("wizard step 4: your objectives");
  check("wizard: with a source and nothing written, proposing from the sources is already chosen",
    await page.evaluate(() => document.querySelector('section[aria-label="Your objectives"] input[type="checkbox"]')?.checked === true));
  await clickBy("Continue");
  check("wizard: the AI check says in plain words that the demo passcode is needed (online build)",
    await waitText("needs the demo passcode", 6000) && !/BAD_PASSCODE|WORKER_|passcodeRequired/.test(await page.evaluate(() => document.body.innerText)));
  if (narrow) await checkNarrow("wizard step 5: the AI check");
  await clickPrimaryBtn("Continue");
  await waitText("Review and confirm", 5000);
  if (narrow) await checkNarrow("wizard step 6: review and confirm");
}

/**
 * The history drawer's "Behind the scenes" rail (the same ActivityRail the classic page drew), at 1440 wide: the header is one line;
 * a row's tag is a stage word (Material, Brief, Objectives, Plan, Version); when every row would say "just now" the rows show the
 * clock; " · 2 times" is not broken across lines; a worker row exists and no ASFAI lane is drawn online.
 */
const railCheck = async (name) => {
  if (page.viewport().width < 1100) return;
  await page.evaluate(() => { const b = [...document.querySelectorAll("header button")].find((x) => /decision/i.test(x.textContent ?? "")); b?.click(); });
  await poll(() => page.evaluate(() => !!document.querySelector("dialog[open] aside")));
  await sleep(300);
  const r = await page.evaluate(() => {
    const aside = document.querySelector("dialog[open] aside");
    if (!aside) return null;
    const h2 = aside.querySelector("h2");
    const meta = h2?.nextElementSibling;
    const rows = [...aside.querySelectorAll("li[data-action]")];
    const tags = rows.map((li) => li.querySelector("[data-artifact]")?.textContent.replace("Changed: ", "").trim());
    const times = rows.map((li) => li.querySelector("time")?.textContent.trim());
    const timesSpan = [...aside.querySelectorAll('[class*="_times_"]')];
    const hb = h2.getBoundingClientRect(); const mb = meta ? meta.getBoundingClientRect() : null;
    return {
      headOneLine: !!mb && Math.abs(hb.top - mb.top) < 12 && hb.height < 36 && mb.height < 24, titleH: Math.round(hb.height), metaH: mb ? Math.round(mb.height) : null,
      tags: [...new Set(tags)], times, timesCount: timesSpan.length, timesBroken: timesSpan.some((x) => x.getClientRects().length > 1),
      nowrap: timesSpan.every((x) => getComputedStyle(x).whiteSpace === "nowrap"), rows: rows.length,
      worker: !!aside.querySelector('li[data-actor="worker"]'), asfaiLane: [...aside.querySelectorAll("[data-lane-name]")].some((x) => (x.textContent ?? "").trim() === "ASFAI"),
    };
  });
  const okTags = ["Material", "Brief", "Objectives", "Plan", "Version"];
  check(`rail ${name}: the header ("Behind the scenes" and the count) is on one line`, !!r && r.headOneLine, JSON.stringify(r));
  check(`rail ${name}: every tag is a stage word (Material, Brief, Objectives, Plan, Version), never Outline, Record or Package`, !!r && r.tags.length > 0 && r.tags.every((x) => okTags.includes(x)), JSON.stringify(r?.tags));
  check(`rail ${name}: rows do not all say "just now": the clock is shown instead`, !!r && r.rows > 1 && !r.times.every((x) => x === "just now"), JSON.stringify(r?.times));
  check(`rail ${name}: " · 2 times" stays whole (no break inside it)`, !!r && (r.timesCount === 0 || (r.nowrap && !r.timesBroken)), `times spans: ${r?.timesCount}, nowrap ${r?.nowrap}, broken ${r?.timesBroken}`);
  check(`rail ${name}: a worker row after drafting, and no ASFAI lane in the online app`, !!r && r.worker && !r.asfaiLane, JSON.stringify(r));
  await page.keyboard.press("Escape");
  await sleep(300);
};

const kinds = (s) => eventsOf(s).map((e) => e.kind);

async function story(label, narrow) {
  passLabel = label;
  const bodiesAtStart = api.workerBodies.length;
  // ---- first impression: the BARE url shows the landing; its primary opens the studio
  await page.goto(`${APP}/`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("h1") !== null);
  if (narrow) await checkNarrow("landing (bare URL)");
  const bare = await page.evaluate(() => ({ h1: document.querySelector("h1")?.textContent ?? "", hash: location.hash, proposals: !!document.querySelector('section[aria-label="Objective proposals"]') }));
  check("the bare URL shows the landing, not the studio and not the demo decision card", /^Plan a lesson with an AI that proposes\./.test(bare.h1) && !bare.proposals, bare.h1);
  await page.click('main a[href="#/studio"]');
  await page.waitForSelector('section[aria-label="Courses"]');
  if (narrow) await checkNarrow("studio home, first visit");
  const first = await page.evaluate(() => ({
    title: document.title, header: document.querySelector("header")?.innerText ?? "",
    icon: document.querySelector('link[rel="icon"]')?.getAttribute("href") ?? "", tabs: document.querySelectorAll('nav[aria-label="Workbench sections"]').length,
    about: document.querySelector('header a[href="#/"]')?.textContent ?? null,
    newCard: [...document.querySelectorAll("a")].some((a) => /New course/.test(a.textContent ?? "") && a.getAttribute("href") === "#/studio/new"),
    courses: document.querySelectorAll('section[aria-label="Courses"] a[href^="#/studio/"]').length,
  }));
  check("#/studio (the landing's primary) opens the studio home: 'Your courses' with a 'New course' card and no course yet", first.newCard && first.courses === 1 && (await page.evaluate(() => location.hash)) === "#/studio" && first.about === "About Silicus", JSON.stringify(first.newCard) + " links=" + first.courses + " hash=" + (await page.evaluate(() => location.hash)));
  check("the page is titled as the product, with an inline SVG favicon", /^Silicus TA/.test(first.title) && /^data:image\/svg\+xml,/.test(first.icon), first.title);
  check("the studio header reads as the product, not 'design workbench · tokens-first'", /Silicus/.test(first.header) && !/workbench|tokens-first/i.test(first.header) && first.tabs === 0, first.header.replace(/\n/g, " | "));
  await shot("00-first-impression");
  await stageShot("01-studio-home");
  // The component workbench is not linked from the studio any more: a typed #/decision still opens it (and measures clean).
  await page.evaluate(() => { location.hash = "#/decision"; });
  await poll(() => page.evaluate(() => document.querySelector('nav[aria-label="Workbench sections"]') !== null && document.querySelector('section[aria-label="Objective proposals"]') !== null));
  check("a typed #/decision still opens the component workbench (it is no longer linked from the app)", true);
  if (narrow) await checkNarrow("design system workbench");
  await page.evaluate(() => { location.hash = "#/studio"; });
  await page.waitForFunction(() => /Your courses/.test(document.body.innerText));

  // ---- the wizard: name the course (it is recorded only at the review's confirm)
  await wizardToSources(narrow, { title: "How plants eat", goal: "Photosynthesis", note: "Science, ages 8-10" });
  check("nothing is recorded in IndexedDB before the review's confirm, and no /api/courses request left the page", (await stored()).metas.length === 0 && !api.calls.some((c) => c.path.startsWith("/api/courses")));

  // ---- material: pasted text, read in this tab. Its first line names it ("Lesson notes").
  await setValue('section[aria-label="Sources"] textarea', "https://www.youtube.com/watch?v=abc123");
  check("the sources step says YouTube needs the local app (online), and will not add it",
    (await bodyHas("YouTube needs the local app")) && await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Sources"] button')].some((b) => /^Add (text|web page)$/.test(b.textContent.trim()) && b.disabled)));
  await setValue('section[aria-label="Sources"] textarea', MATERIAL_TEXT);
  await sleep(200);
  await clickBy("Add text");
  await waitText("Read in this tab", 4000);
  await stageShot("05-sources");
  await shot("06-material-panel", 'section[aria-label="Sources"]');
  await wizardFinish(narrow);
  await stageShot("03-review");
  const review = await page.evaluate(() => document.body.innerText);
  check("the review lists the course, the label, the topic and the source by its name; no source text", ["How plants eat", "Ada Lovelace", "Photosynthesis", "Lesson notes"].every((x) => review.includes(x)) && !review.includes(SECRET));
  check("nothing is recorded before the review's confirm (still IndexedDB-empty)", (await stored()).metas.length === 0);
  await clickPrimaryBtn("Confirm and propose objectives");
  await page.waitForFunction(() => /^#\/studio\/(?!new$)./.test(location.hash), { timeout: 8000 });
  const courseId = (await page.evaluate(() => location.hash)).split("/")[2];
  await poll(async () => (await stored()).metas.length === 1);
  check("the course is recorded in IndexedDB (not on a server)", true);
  check("no /api/courses request ever left the page", !api.calls.some((c) => c.path.startsWith("/api/courses")));
  await poll(async () => kinds(await stored()).filter((k) => k === "checkpoint.confirmed").length === 2);
  check("the review's confirm records the materials list and the outline as confirmed (files, then outline)",
    JSON.stringify(eventsOf(await stored()).filter((e) => e.kind === "checkpoint.confirmed").map((e) => e.id)) === JSON.stringify(["files", "outline"]));
  const created = eventsOf(await stored()).find((e) => e.kind === "course.created");
  check("the course record keeps the label as the owner, and no material text", created?.owner === "Ada Lovelace" && !JSON.stringify(created).includes(SECRET), JSON.stringify(created).slice(0, 160));

  // ---- the arrival proposes from the source: the passcode is asked for, and the step says it is waiting for it
  await page.waitForSelector('[role="dialog"] input[type="password"]', { timeout: 10000 });
  check("an AI action asks for the demo passcode", await dialogOpen());
  const paused = await poll(async () => { const l = await statusLine(); return /Waiting for your passcode/.test(l.words) ? l : null; }, 5000);
  check("while the passcode dialog is open the status line holds its clock and says why", paused.line === "Waiting for your passcode", paused.line);
  check("one polite live region on the step after the wizard", (await liveRegions()).length === 1, JSON.stringify(await liveRegions()));
  await shot("02-passcode", '[role="dialog"]');
  if (narrow) await checkNarrow("passcode pause, status line held");
  await answerPasscode();
  const proposing = await page.waitForFunction(() => {
    const st = document.querySelector('[role="status"]');
    const p = st?.closest("p");
    return /Silicus is reading 1 source/.test(st?.textContent ?? "") ? (p?.innerText ?? "").replace(/\s+/g, " ").trim() : false;
  }, { timeout: 8000, polling: 50 }).then((h) => h.jsonValue()).catch(() => null);
  check("proposing says in plain words what is happening, with the real count, and the usual range", !!proposing && /usually 2–10 s/.test(proposing), String(proposing));
  if (narrow) await checkNarrow("status line, proposing objectives");
  await page.evaluate(() => document.querySelector('header button[aria-haspopup="dialog"]')?.click());
  await poll(() => page.evaluate(() => !!document.querySelector("dialog[open]")));
  check("zero-retention is claimed only because the site's status says zdr: true (the AI status says the text is not kept by the provider)", await bodyHas("Not kept by the model provider"));
  await page.keyboard.press("Escape");
  await sleep(300);
  await poll(async () => kinds(await stored()).includes("objectives.proposed"), 15000);
  await poll(() => page.evaluate(() => document.querySelectorAll('aside[aria-label="Proposals"] article').length === 3));
  check("proposing ends with the proposals on the page, none accepted (3 waiting, 'Not yours until you accept')",
    (await bodyHas("Not yours until you accept")) && (await bodyHas("From material:")) && !(await bodyHas("Accepted ·")));
  await shot("11-receipt-proposals", 'aside[aria-label="Proposals"]');
  await stageShot("06-objectives-proposed");
  check("the worker proposed objectives through /api/worker, with the passcode header", api.calls.some((c) => c.path === "/api/worker" && c.passcode === PASSCODE));
  let s = await stored();
  check("the passcode is in sessionStorage only", s.session["silicus.demoPasscode"] === PASSCODE
    && !JSON.stringify(s.local).includes(PASSCODE) && !JSON.stringify(s.metas).includes(PASSCODE) && !JSON.stringify(s.events).includes(PASSCODE));
  check("the material text went to the model once…", api.workerBodies.slice(bodiesAtStart).filter((b) => b.includes(SECRET)).length === 1);
  check("…and is in no IndexedDB value, localStorage or sessionStorage", !JSON.stringify(s).includes(SECRET));
  const proposedStatements = [...new Set(eventsOf(s).filter((e) => e.kind === "objectives.proposed").flatMap((e) => statementsIn(e)))];

  // ---- the teacher decides (accept every proposal), then confirms the objectives herself
  if (narrow) await checkNarrow("proposals, undecided");
  await primaryInViewport("objectives (proposed)");
  await poll(async () => {
    const st = await stored();
    if (kinds(st).filter((k) => k === "objectives.decided").length >= 3) return true;
    await page.evaluate(() => { const b = [...document.querySelectorAll('aside[aria-label="Proposals"] button')].find((x) => (x.textContent ?? "").trim() === "Accept" && !x.disabled); if (b) b.click(); });
    await sleep(400);
    return null;
  }, 25000);
  check("one teacher decision recorded per proposal", kinds(await stored()).filter((k) => k === "objectives.decided").length === 3);
  const accepted = await page.evaluate(() => [...document.querySelectorAll("li[data-objective-id]")].map((li) => li.textContent));
  check("three accepted objectives are on the page to be sent", accepted.length === 3 && proposedStatements.length >= 3 && proposedStatements.every((t) => accepted.some((a) => a.includes(t))), `${accepted.length} li, ${proposedStatements.length} statements`);
  if (narrow) await checkNarrow("accepted objectives");
  await poll(() => page.evaluate(() => [...document.querySelectorAll('button[data-primary="true"]')].some((b) => b.textContent.trim() === "Confirm objectives" && !b.disabled)));
  await stageShot("07-objectives-decided");
  await primaryInViewport("objectives (decided)");
  check("stage: the objectives step has exactly one primary action", (await primaryCount()) === 1, `primaries=${await primaryCount()}`);
  await clickPrimaryBtn("Confirm objectives");
  await waitText("Step 3 of 4", 8000);

  // ---- plan: draft (the waiting experience), confirm
  await poll(() => page.evaluate(() => [...document.querySelectorAll('button[data-primary="true"]')].some((b) => /Draft the lesson plan/.test(b.textContent))));
  await primaryInViewport("plan (before drafting)");
  const planBodiesBefore = api.workerBodies.length;
  await clickPrimaryBtn("Draft the lesson plan");
  const drafting = await page.waitForFunction(() => {
    const st = document.querySelector('[role="status"]');
    return /Silicus is drafting from/.test(st?.textContent ?? "") ? (st.closest("p")?.innerText ?? "").replace(/\s+/g, " ").trim() : false;
  }, { timeout: 8000, polling: 50 }).then((h) => h.jsonValue()).catch(() => null);
  check("the waiting experience says in plain words what is happening, with the real count", /^Silicus is drafting from 3 confirmed objectives/.test(drafting ?? ""), String(drafting));
  check("it states the typical range the documented defaults give: usually 10–60 s", /usually 10–60 s/.test(drafting ?? ""), String(drafting));
  if (narrow) await checkNarrow("status line, drafting the plan");
  const polite = await liveRegions();
  check("exactly one polite live region announces the start, without the ticking clock (the clock is aria-hidden)", polite.length === 1 && /^Silicus is drafting from 3 confirmed objectives$/.test(polite[0]) && (await statusLine()).clockHidden, JSON.stringify(polite));
  check("there is no progress bar and no percentage", await page.evaluate(() => !document.querySelector('progress, [role="progressbar"]') && !/%/.test(document.querySelector('[role="status"]')?.closest("p")?.innerText ?? "")));
  await shot("10-waiting-plan", 'section[aria-label="Drafting the plan"]');
  await stageShot("08-plan-drafting");
  await poll(async () => /\b0:0[1-9]\b/.test((await statusLine()).line), 8000);
  check("the elapsed readout is a real clock: it has advanced", true);
  if (PLAN_MS > 47000) {
    await poll(() => bodyHas("Still drafting. Long plans can take a minute."), PLAN_MS);
    check("past the late mark the calm 'still drafting' line appears", true);
    await shot("13-waiting-longer", 'section[aria-label="Drafting the plan"]');
  } else {
    check("before the late mark there is no 'still drafting' line", !(await bodyHas("Still drafting. Long plans can take a minute.")));
  }
  await poll(async () => kinds(await stored()).includes("plan.proposed"), PLAN_MS + 15000);
  await poll(() => bodyHas("Confirm the lesson plan"));
  await poll(async () => (await statusLine()).words !== "" && !/Silicus is drafting/.test((await statusLine()).words));
  check("when the plan arrives the status line leaves the waiting state and the clock goes", !/Silicus is drafting|usually/.test((await statusLine()).line), (await statusLine()).line);
  const planBody = api.workerBodies.slice(planBodiesBefore).find((b) => b.includes("Draft one lesson plan")) ?? "";
  check("what left the page: every accepted statement and the topic were sent; the label and the material text were NOT",
    proposedStatements.every((t) => planBody.includes(t)) && planBody.includes("Photosynthesis") && !planBody.includes("Ada Lovelace") && !planBody.includes(SECRET),
    `statements=${proposedStatements.every((t) => planBody.includes(t))} topic=${planBody.includes("Photosynthesis")} label=${planBody.includes("Ada Lovelace")} secret=${planBody.includes(SECRET)}`);
  check("the plan is drafted (no second passcode prompt: it is kept for this tab)", !(await dialogOpen()));
  await stageShot("09-plan-drafted");
  await primaryInViewport("plan");
  check("stage: the plan step has exactly one primary action", (await primaryCount()) === 1, `primaries=${await primaryCount()}`);
  check("stage: the lesson plan's text appears exactly once on the plan step", (await countIn("Look at a leaf.")) === 3, `lines=${await countIn("Look at a leaf.")} (3 = once)`);
  await railCheck("plan");
  // Edit the objectives from the plan and come back: two clicks, and the plan is where it was.
  await clickBy("Edit objectives");
  check("'Edit objectives' opens the objectives, looking back, with 'Back to the current step' as the way out",
    (await waitText("Back to the current step", 5000)) && (await bodyHas("Step 2 of 4")));
  await stageShot("09b-edit-objectives");
  await clickBy("Back to the current step");
  check("back from editing the objectives lands on the plan, to confirm", await waitText("Confirm the lesson plan", 5000));
  check("looking wrote nothing (still exactly the three objective decisions)", kinds(await stored()).filter((k) => k === "objectives.decided").length === 3);
  if (narrow) await checkNarrow("plan, drafted");
  await clickPrimaryBtn("Confirm the lesson plan");
  await poll(async () => kinds(await stored()).includes("plan.confirmed"));
  check("plan confirmed on the record", true);

  // ---- publish (review -> arm -> publish)
  await poll(() => bodyHas("Review and publish"));
  await stageShot("10-publish");
  await primaryInViewport("publish");
  check("stage: the publish step has exactly one primary action", (await primaryCount()) === 1, `primaries=${await primaryCount()}`);
  check("stage: the lesson plan's text appears exactly once on the publish step", (await countIn("Look at a leaf.")) === 3, `lines=${await countIn("Look at a leaf.")} (3 = once)`);
  if (narrow) await checkNarrow("review and publish");
  await clickBy("Publish version 1…");
  await poll(() => bodyHas("Publish version 1?"));
  if (narrow) await checkNarrow("publish confirm step");
  await stageShot("11-seal-confirm");
  await clickBy("Publish version 1");
  await poll(async () => kinds(await stored()).includes("package.published"));
  await poll(() => bodyHas("Version 1 is published"));
  s = await stored();
  check("version 1 sealed, and pinned in this browser", Object.keys(s.local).some((k) => k.startsWith("silicus.pin.")));
  if (narrow) await checkNarrow("published");
  await stageShot("12-published");

  // ---- a student asks (the student space); nothing is written
  await page.goto(`${APP}/#/learn/${courseId}`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("h1") !== null);
  check("the student space is a preview on this device and shows the published title", (await bodyHas("Preview on this device")) && (await bodyHas("How plants eat")));
  if (narrow) await checkNarrow("student space");
  const beforeAsk = JSON.stringify(await stored());
  await page.type('input[placeholder="Ask about today’s lesson"]', "What do plants need to make food?");
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await clickBy("Ask");
  await page.waitForSelector('[aria-label="Silicus is thinking"]', { timeout: 5000 });
  if (narrow) await checkNarrow("student answer, thinking");
  const thinking = await page.evaluate(() => { const el = document.querySelector('[aria-label="Silicus is thinking"]'); return { n: el.querySelectorAll("span").length, anim: getComputedStyle(el.querySelector("span")).animationName }; });
  check("a student's wait shows the 'Silicus is thinking' indicator", thinking.n === 3, JSON.stringify(thinking));
  check("under prefers-reduced-motion the indicator is still (no CSS animation)", thinking.anim === "none", thinking.anim);
  await shot("15-waiting-student");
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await poll(() => bodyHas("A plant uses light, water and air to make sugar."), 15000);
  check("the student gets an answer that cites the published lesson", await bodyHas("From the lesson:"));
  await stageShot("13-student-answer");
  check("student chat wrote nothing (IndexedDB and web storage identical before and after)", JSON.stringify(await stored()) === beforeAsk);
  // The teacher's Rehearse is the same: it asks, it writes nothing.
  await page.goto(`${APP}/#/studio/${courseId}/rehearse`, { waitUntil: "networkidle0" });
  await page.waitForSelector('textarea[placeholder="Type as a student would…"]');
  if (narrow) await checkNarrow("rehearse");
  const beforeRehearse = JSON.stringify(await stored());
  await page.type('textarea[placeholder="Type as a student would…"]', "What do plants need to make food?");
  await clickBy("Ask");
  await poll(() => bodyHas("A plant uses light, water and air to make sugar."), 15000);
  check("Rehearse answers from the published version and writes nothing", JSON.stringify(await stored()) === beforeRehearse);

  // ---- the record verifies under node:crypto, too
  s = await stored();
  const records = s.events.sort((a, b) => a.seq - b.seq).map((e) => JSON.parse(e.line));
  const v = verifyRecords(records);
  check("the browser-written log verifies on the Node host's chain (node:crypto)", v.ok === true, `${v.events} events`);

  // ---- reload: still there, still verifies (History -> Check the record)
  await page.goto(`${APP}/#/studio/${courseId}`, { waitUntil: "networkidle0" });
  await page.reload({ waitUntil: "networkidle0" });
  await poll(() => bodyHas("Version 1 is published"));
  check("after a reload the published course is still there", true);
  const checkRecord = async () => {
    await page.evaluate(() => { const b = [...document.querySelectorAll("header button")].find((x) => /decision/i.test(x.textContent ?? "")); b?.click(); });
    await poll(() => page.evaluate(() => !!document.querySelector("dialog[open]")));
    await clickBy("Check the record");
    await poll(() => bodyHas("chain intact"));
  };
  await checkRecord();
  if (narrow) await checkNarrow("history drawer, record checked");
  check("after a reload the record verifies", await bodyHas(`The record checks out: ${v.events} events, chain intact.`));
  const noticeCopies = await page.evaluate(() => [...document.querySelectorAll("p,span,div")].filter((e) => (e.textContent ?? "").includes("The record checks out") && e.children.length === 0).length);
  check("the record notice is shown exactly once", noticeCopies === 1, `${noticeCopies} cop(y|ies) on the page`);
  await page.keyboard.press("Escape");
  await sleep(300);
  if (narrow) await checkNarrow("published course");

  // ---- export all (the home's record section)
  await page.goto(`${APP}/#/studio`, { waitUntil: "networkidle0" });
  await page.waitForSelector('section[aria-label="Where your courses are kept"]', { timeout: 10000 });
  if (narrow) await checkNarrow("home, the record section");
  await clickBy("Export all courses");
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
  await clickBy("Delete all data from this browser");
  await poll(() => bodyHas("This cannot be undone"));
  if (narrow) await checkNarrow("home, delete confirm");
  await shot("04-delete-confirm", 'section[aria-label="Where your courses are kept"]');
  await clickBy("Delete everything");
  await poll(async () => { const st = await stored(); return st.metas.length === 0 && st.events.length === 0; });
  await poll(() => page.evaluate(() => document.querySelectorAll('section[aria-label="Courses"] a[href^="#/studio/"]').length === 1));
  s = await stored();
  check("delete all empties IndexedDB, the pins and the passcode", Object.keys(s.local).filter((k) => k.startsWith("silicus.")).length === 0 && !s.session["silicus.demoPasscode"]);
  check("delete all says so, and the home lists no course", await bodyHas("Every course, pinned copy and passcode this browser held for Silicus is gone."));

  // ---- a tampered file is refused, whole
  const input = await page.$('input[type="file"][aria-label="Import courses from an exported file"]');
  const tampered = join(DOWNLOADS, "tampered.json");
  writeFileSync(tampered, text.replace("How plants eat", "How plants dine"));
  await input.uploadFile(tampered);
  await poll(() => bodyHas("does not match its own fingerprint"));
  await shot("05-tampered", 'section[aria-label="Where your courses are kept"]');
  check("a tampered export is refused with a clear message, and nothing is written", (await stored()).events.length === 0 && (await bodyHas("Nothing was imported")));

  // ---- import: the course comes back
  const input2 = await page.$('input[type="file"][aria-label="Import courses from an exported file"]');
  await input2.uploadFile(exported);
  await poll(() => bodyHas("Imported 1 course"));
  await poll(() => bodyHas("How plants eat"));
  s = await stored();
  check("import brings the course back, record intact", s.events.length === v.events && verifyRecords(s.events.sort((a, b) => a.seq - b.seq).map((e) => JSON.parse(e.line))).head === v.head);
  check("the imported course is listed as published on the home", await bodyHas("Version 1 published"));
  await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Courses"] a')].find((a) => /How plants eat/.test(a.textContent))?.click());
  await poll(() => bodyHas("Version 1 is published"));
  await checkRecord();
  check("the imported course verifies in the app", await bodyHas(`The record checks out: ${v.events} events, chain intact.`));

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


/* ------------------------------ real file uploads (studio) ------------------------------
 * A FRESH context: a teacher drops a real PDF and a real DOCX at the wizard's Sources step; the file is read in the tab
 * (name, kind and character count shown before anything is sent); the course is created; the arrival proposes from the
 * files (their text is in the request, once each); the record holds the names and never the text; a reload forgets the
 * text and says so; failures are plain sentences and add nothing; the PDF's marker is in no IndexedDB or web-storage
 * value; the page made no request outside its own origin (pdf.js's worker comes from the bundle); 0 CSP violations.
 * ---------------------------------------------------------------------------------------- */
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
    await page.goto(`${APP}/#/studio`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => /Your courses/.test(document.body.innerText));
    await wizardToSources(false, { title: "Photosynthesis from real files", goal: "Photosynthesis", note: "Science, ages 8-10" });

    // ---- choose a real PDF and a real DOCX at the Sources step
    check("uploads: the sources step offers 'Choose files' with the PDF, DOCX and PPTX types, several at once",
      await page.evaluate(() => { const i = document.querySelector('section[aria-label="Sources"] input[type="file"]'); return !!i && i.multiple && /\.pdf/.test(i.accept) && /\.docx/.test(i.accept) && /\.pptx/.test(i.accept); }));
    await (await page.$('section[aria-label="Sources"] input[type="file"]')).uploadFile(pdfPath, docxPath);
    await poll(async () => (await bodyHas("Syllabus notes.docx")) && (await bodyHas("hello.pdf")) && (await page.evaluate(() => document.querySelectorAll('ul[aria-label="Sources added"] li').length === 2)));
    const listed = await page.evaluate(() => [...document.querySelectorAll('ul[aria-label="Sources added"] li')].map((li) => li.textContent.replace(/\s+/g, " ")));
    check("uploads: each file shows its name, kind and character count before anything is sent",
      listed.some((t) => /hello\.pdf.*Read in this tab · PDF · [\d,]+ characters/.test(t)) && listed.some((t) => /Syllabus notes\.docx.*Read in this tab · Word · [\d,]+ characters/.test(t)), listed.join(" | "));
    const pdfChars = Number((listed.find((t) => t.includes("hello.pdf")) ?? "").match(/([\d,]+) characters/)?.[1].replace(/,/g, "") ?? 0);
    check("uploads: the PDF's character count is the length of its real text layer", pdfChars > 50 && pdfChars < 200, String(pdfChars));
    check("uploads: nothing has left the page (no worker call, no /api/courses) while files are only chosen",
      api.workerBodies.length === bodiesBefore && !api.calls.some((c) => c.path.startsWith("/api/courses")));
    await shot("20-onboarding-files");
    await stageShot("20-onboarding-files");
    await wizardFinish(false);
    const review = await page.evaluate(() => document.body.innerText);
    check("uploads: the review names the two files and says they are read in this tab; none of their text", /hello\.pdf/.test(review) && /Syllabus notes\.docx/.test(review) && /read in this tab/.test(review) && !review.includes(PDF_MARK) && !review.includes(DOCX_MARK));
    check("uploads: nothing is recorded before the review's confirm", (await stored()).metas.length === 0);
    await clickPrimaryBtn("Confirm and propose objectives");
    await page.waitForFunction(() => /^#\/studio\/(?!new$)./.test(location.hash), { timeout: 8000 });
    await answerPasscode();
    await poll(async () => kinds(await stored()).includes("objectives.proposed"), 20000);
    let s = await stored();
    const recordedNames = JSON.stringify(eventsOf(s));
    check("uploads: the record holds the file names, and not their text",
      recordedNames.includes("hello.pdf") && recordedNames.includes("Syllabus notes.docx") && !JSON.stringify(s).includes(PDF_MARK) && !JSON.stringify(s).includes(DOCX_MARK), recordedNames.slice(0, 200));
    const sent = api.workerBodies.slice(bodiesBefore);
    check("uploads: the proposal request carries the PDF's text and the DOCX's text, once each",
      sent.filter((b) => b.includes(PDF_MARK)).length === 1 && sent.filter((b) => b.includes(DOCX_MARK)).length === 1, `${sent.length} worker request(s)`);
    await poll(() => page.evaluate(() => document.querySelectorAll('aside[aria-label="Proposals"] article').length >= 1));
    check("uploads: the proposals say which materials they were drawn from (both files named)",
      await page.evaluate(() => { const t = document.querySelector('aside[aria-label="Proposals"]')?.innerText ?? ""; return /From material:.*hello\.pdf/.test(t) && /From material:.*Syllabus notes\.docx/.test(t); }));
    check("uploads: the sources panel lists both files, read in this tab, and says what they were used for",
      await poll(() => page.evaluate(() => { const t = document.querySelector('aside[aria-label="Sources"]')?.innerText ?? ""; return /hello\.pdf/.test(t) && /Syllabus notes\.docx/.test(t) && /Read in this tab/.test(t) && /Used for \d+ proposals?/.test(t); }), 15000).then(() => true, () => false));
    s = await stored();
    check("uploads: after proposing, the PDF's marker is STILL in no IndexedDB value, localStorage or sessionStorage",
      !JSON.stringify(s).includes(PDF_MARK) && !JSON.stringify(s).includes(DOCX_MARK) && !JSON.stringify(s).includes("Hello from the fixture PDF"));
    await stageShot("22-objectives-from-files");

    // ---- reload: the text is gone, and the panel says what to do
    await page.reload({ waitUntil: "networkidle0" });
    await poll(() => page.evaluate(() => !!document.querySelector('aside[aria-label="Sources"]')));
    await poll(() => bodyHas("Text is read in this tab, sent once when you ask for a draft, and forgotten on reload."));
    check("uploads: after a reload the files are not held any more (the text was never stored)", await page.evaluate(() => { const t = document.querySelector('aside[aria-label="Sources"]')?.innerText ?? ""; return !/Read in this tab/.test(t) && !/hello\.pdf|Syllabus notes\.docx/.test(t); }));
    check("uploads: and the panel says in its own words that text is forgotten on reload (add the file again to use it)",
      (await bodyHas("No sources yet.")) && (await bodyHas("forgotten on reload")));
    await stageShot("21-material-offered");
    s = await stored();
    check("uploads: the PDF's marker text is in no IndexedDB value, localStorage or sessionStorage after the reload",
      !JSON.stringify(s).includes(PDF_MARK) && !JSON.stringify(s).includes(DOCX_MARK) && !JSON.stringify(s).includes("Hello from the fixture PDF"));

    // ---- failures are plain sentences, and add nothing (the panel's Add a source dialog)
    await clickBy("+ Add a source");
    await poll(() => page.evaluate(() => !!document.querySelector("dialog[open] input[type=file]")));
    const dialogInput = async () => page.$("dialog[open] input[type=file]");
    const dialogText = () => page.evaluate(() => document.querySelector("dialog[open]")?.innerText ?? "");
    await (await dialogInput()).uploadFile(scanPath);
    await poll(() => bodyHas("This PDF has no text layer"));
    const scanNote = await dialogText();
    check("uploads: an image-only PDF says it has no text layer, and makes no OCR claim", /This PDF has no text layer/.test(scanNote) && !/\bOCR\b|recogni[sz]/i.test(scanNote.replace(/Silicus does not read text from pictures/, "")), scanNote.slice(0, 200));
    await (await dialogInput()).uploadFile(docPath);
    await poll(async () => /\.docx/.test(await dialogText()) && /older \.doc/.test(await dialogText()));
    const docNote = await dialogText();
    check("uploads: a legacy .doc says what to do instead (save as .docx)", /Save an older \.doc or \.ppt as \.docx/.test(docNote), docNote.slice(0, 200));
    check("uploads: neither failed file was added to the list", await page.evaluate(() => !/scan-only|old\.doc/.test(document.querySelector('aside[aria-label="Sources"] ul')?.innerText ?? "")));

    // ---- add the real files again: they are listed with their counts, ready for another proposal round
    // One file per choose: choosing two at once in this panel's dialog keeps only the last (SourceDrop calls onFile per file with the
    // panel's stale `held`); reported to the owner in the K4 handoff. The wizard's Sources step takes two at once (asserted above).
    const inPanel = (name) => page.evaluate((n) => (document.querySelector('aside[aria-label="Sources"] ul')?.innerText ?? "").includes(n), name);
    await (await dialogInput()).uploadFile(pdfPath);
    await poll(() => inPanel("hello.pdf"));
    await (await dialogInput()).uploadFile(docxPath);
    await poll(() => inPanel("Syllabus notes.docx"));
    await clickBy("Done");
    check("uploads: the files added again in the panel are listed with their character counts", await page.evaluate(() => (document.querySelector('aside[aria-label="Sources"]')?.innerText.match(/Read in this tab · (PDF|Word) · [\d,]+ characters/g) ?? []).length === 2));
    s = await stored();
    check("uploads: adding them again records nothing and their text is still in no stored value", !JSON.stringify(s).includes(PDF_MARK) && !JSON.stringify(s).includes(DOCX_MARK));

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

// ------------------------------------------------------------------ the landing (#/), both widths, appended by C-c, reworked by C-d and K1
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
    return {
      h1: [...document.querySelectorAll("h1")].map((h) => h.textContent),
      h1Lines: [...document.querySelectorAll("h1 > span")].map((n) => [n.textContent, Math.round(n.getBoundingClientRect().top)]),
      banner: document.querySelectorAll("header").length, main: document.querySelectorAll("main").length, footer: document.querySelectorAll("footer").length,
      steps: [...document.querySelectorAll("ol > li > h3")].map((h) => h.textContent),
      nevers: [...document.querySelectorAll("h3")].map((h) => h.textContent).filter((t) => /^Never /.test(t)),
      tryIt: [...document.querySelectorAll("main a")].find((a) => a.textContent === "Open the studio")?.getAttribute("href") ?? null,
      five: [...document.querySelectorAll("a")].some((a) => a.textContent === "How it works"),
      classicLink: [...document.querySelectorAll("a")].some((a) => /Classic view/.test(a.textContent ?? "") || a.getAttribute("href") === "#/live"),
      oldLocalLink: [...document.querySelectorAll("a")].some((a) => /Run it on your computer/.test(a.textContent)),
      controls: document.querySelectorAll("button, input").length,
      text: document.body.innerText, html: document.body.textContent,
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      imgs: document.querySelectorAll("main img").length,
      img: img ? { loaded: true, alt: img.querySelector("figcaption")?.textContent ?? "", w: Math.round(ib.width), left: Math.round(ib.left), right: Math.round(ib.right), top: Math.round(ib.top), bottom: Math.round(ib.bottom), vw: innerWidth } : null,
      copyBox: cb ? { left: Math.round(cb.left), right: Math.round(cb.right), top: Math.round(cb.top), bottom: Math.round(cb.bottom) } : null,
      details: (() => { const d = document.querySelector("details"); return d ? { open: d.open, title: d.querySelector("summary")?.textContent ?? "", last: !!d.closest("main > section:last-child") } : null; })(),
    };
  });
  check("landing: the bare URL shows one h1, one banner, one main and one footer", L.h1.length === 1 && /^Plan a lesson with an AI that proposes\. You decide\.$/.test(L.h1[0]) && L.banner === 1 && L.main === 1 && L.footer === 1, L.h1.join(" | "));
  check("landing: the headline breaks after 'proposes.' (two lines, the second is 'You decide.')", L.h1Lines.length === 2 && L.h1Lines[0][0] === "Plan a lesson with an AI that proposes." && L.h1Lines[1][0] === "You decide." && L.h1Lines[1][1] > L.h1Lines[0][1], JSON.stringify(L.h1Lines));
  check("landing: the four steps in order, the three 'Never ...' headings, Open the studio to #/studio, How it works, no 'Classic view' link and no link to #/live, no controls and no sign-in",
    L.steps.join(",") === "Brief,Objectives,Plan,Publish"
    && L.nevers.join("|") === "Never decides for you|Never keeps your files|Never grades students"
    && L.tryIt === "#/studio" && L.five && !L.classicLink && !L.oldLocalLink && L.controls === 0 && !/sign[ -]?in|log[ -]?in/i.test(L.text), L.steps.join(",") + " :: " + L.nevers.join("|"));
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
  // The studio's way back: its 'About Silicus' link returns to the landing (#/); there is no 'Classic view'.
  await page.click('a[href="#/studio"]:not(header a)');
  await page.waitForSelector('section[aria-label="Courses"]', { timeout: 10000 });
  check("landing: Open the studio opens the studio home at #/studio", true);
  await page.evaluate(() => document.querySelector('header a[href="#/"]').click());
  const back = await poll(() => page.evaluate(() => /^Plan a lesson with an AI that proposes\./.test(document.querySelector("h1")?.textContent ?? "") && /^(#\/)?$/.test(location.hash))).catch(async () => {
    console.log("[debug] " + (await page.evaluate(() => location.hash + " :: " + (document.querySelector("h1")?.textContent ?? "") + " :: " + document.body.innerText.slice(0, 300))));
    return false;
  });
  check("landing: the studio's 'About Silicus' link returns to the landing (#/)", back);
  // The old classic URL is gone: typed, it lands on the landing, not on an app page.
  await page.goto(`${APP}/#/studio`, { waitUntil: "networkidle0" });
  await page.evaluate(() => { location.hash = "#/live"; });
  const old = await poll(() => page.evaluate(() => /^Plan a lesson with an AI that proposes\./.test(document.querySelector("h1")?.textContent ?? ""))).catch(() => false);
  check("landing: an old typed #/live lands on the landing (the classic view is gone)", old && !(await page.evaluate(() => /Build a course, one decision at a time/.test(document.body.innerText))));
  const cspLanding = await page.evaluate(() => window.__csp);
  check("landing: 0 CSP violations and 0 console errors", cspLanding.length === 0 && landingErrors.length === 0, [...cspLanding, ...landingErrors].join("; "));
  await context.close();
}

await browser.close();
server.close();

const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(`\n${results.length - failed.length}/${results.length} browser-mode checks passed`);
process.exit(failed.length ? 1 : 0);
