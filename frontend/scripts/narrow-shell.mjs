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
      return sendJson(res, 200, { id: "mock", choices: [{ message: { role: "assistant", content: JSON.stringify(((p) => p.startsWith("Draft one lesson plan") ? scriptedPlanV2(p) : modelReply(p))(parsed?.messages?.[0]?.content ?? "")) } }] });
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

/**
 * The measurement, run in the page. Surfaces are named by stable structure (aria-labels and tags),
 * never by a hashed CSS-module class.
 */
const measure = () => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  // The shell's own header/footer only: cards inside main carry their own <header>/<footer>.
  const surfaces = [
    ["body > div > header", "shell header (masthead)"],
    ["body > div > footer", "shell footer (colophon)"],
    ["header.stageHeader, [data-surface='stage-header']", "stage header (title + chips)"],
    ["section[aria-label='Course onboarding']", "onboarding card"],
    ["ol[aria-label='How it goes']", "hero steps line"],
    ["section[aria-label='Course material']", "materials panel"],
    ["section[aria-label='Check a student question']", "student chat"],
    ["section[aria-label='Where your courses are kept']", "record band + data controls"],
    ["section[aria-label='Pinned copies on this device']", "pinned copies"],
    ["details", "course library"],
    ["button[aria-haspopup='menu']", "course library"],
    ["ol[aria-label='Checkpoints']", "checkpoint chips"],
    ["article", "PlanCard (other agent)"],
    ["section[aria-label='Objective proposals']", "DecisionCard (other agent)"],
    ["section[aria-label='Preview and publish']", "PublishCard (other agent)"],
    ["section[aria-label='Decision history']", "TimelineCard (other agent)"],
    ["section[aria-label='Revise this course']", "RevisionPanel"],
    ["section[data-variant]", "AiWaiting (other agent)"],
  ];
  /** The surfaces this round owns: the shell, the landing and the intake surfaces. */
  const MINE = new Set(["shell header (masthead)", "shell footer (colophon)", "stage header (title + chips)",
    "onboarding card", "hero steps line", "materials panel", "student chat", "record band + data controls",
    "pinned copies", "course library", "checkpoint chips", "course page (shell)"]);
  const surfaceOf = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      for (const [sel, label] of surfaces) {
        try { if (n.matches(sel)) return label; } catch { /* not this one */ }
      }
    }
    return "course page (shell)";
  };
  const name = (el) => {
    const label = el.getAttribute("aria-label") ?? "";
    const text = (el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? el.getAttribute("placeholder") ?? "" : el.textContent ?? "")
      .replace(/\s+/g, " ").trim().slice(0, 48);
    return `${el.tagName.toLowerCase()}${label ? `[${label}]` : ""}${text ? ` "${text}"` : ""}`;
  };
  const past = [];   // elements crossing the viewport's right (or left) edge
  const clipped = []; // elements whose own box is smaller than their content
  const boxes = new Map();
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const surface = surfaceOf(el);
    if (r.right > vw + 0.5 || r.left < -0.5) {
      const chain = [];
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const b = n.getBoundingClientRect();
        chain.push(`${n.tagName.toLowerCase()}${n.className && typeof n.className === "string" ? "." + String(n.className).split(" ")[0] : ""}[${Math.round(b.left)}..${Math.round(b.right)}]`);
      }
      past.push({ surface, mine: MINE.has(surface), el: name(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), chain });
    }
    // Content wider than its own box: the label or the line is being cut off. A deliberately
    // visually-hidden control (the 1px file input) is not a clip.
    const scrolls = el.scrollWidth - el.clientWidth;
    if (scrolls > 1 && el.clientWidth > 8 && /^(P|H1|H2|H3|LI|SPAN|BUTTON|INPUT|TEXTAREA|A|SUMMARY|LABEL)$/.test(el.tagName)) {
      clipped.push({ surface, mine: MINE.has(surface), el: name(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflowX: cs.overflowX, whiteSpace: cs.whiteSpace });
    }
    // One bounding box per surface (the widest child box tells us how wide the surface wants to be).
    const box = boxes.get(surface) ?? { right: 0, left: vw };
    boxes.set(surface, { right: Math.max(box.right, Math.round(r.right)), left: Math.min(box.left, Math.round(r.left)) });
  }
  // Dedupe by (surface, element, side): keep the outermost instance of a repeated run of overflows.
  const uniq = (list) => {
    const seen = new Set();
    return list.filter((x) => {
      const k = `${x.surface}|${x.el}|${x.right}|${x.left}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  return {
    width: vw,
    scrollWidth: de.scrollWidth,
    clientWidth: vw,
    bodyScrollWidth: document.body.scrollWidth,
    horizontalScroll: de.scrollWidth > vw,
    past: uniq(past),
    clipped: uniq(clipped),
    boxes: [...boxes.entries()].map(([surface, b]) => ({ surface, left: b.left, right: b.right, width: b.right - b.left })),
  };
};

/** Cropped proof screenshots, one per surface, at the shot width. `only` limits which targets. */
const SHOT_TARGETS = [
  ["header", "shell-header"],
  ["ol[aria-label='How it goes']", "hero-steps"],
  ["section[aria-label='Course onboarding']", "onboarding-card"],
  ["section[aria-label='Course material']", "materials-panel"],
  ["section[aria-label='Check a student question']", "student-chat"],
  ["section[aria-label='Where your courses are kept']", "record-band"],
  ["section[aria-label='Pinned copies on this device']", "pinned-copies"],
];
const shots = async (suffix, only = null) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const [selector, file] of SHOT_TARGETS) {
    if (only && !only.includes(file)) continue;
    const el = await page.$(selector);
    if (!el) continue;
    await el.screenshot({ path: join(SHOTS, `narrow-${SHOT_WIDTH}-${file}-${suffix}.png`) });
  }
};

const bodyHas = (t) => page.evaluate((s) => document.body.innerText.toLowerCase().includes(s.toLowerCase()), t);
const clickText = (text) => page.evaluate((t) => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    (x.textContent ?? "").trim().startsWith(t) || (x.getAttribute("aria-label") ?? "").trim().startsWith(t));
  if (!b) throw new Error(`no button matching: ${t}`);
  b.click();
  return true;
}, text);
const setValue = (selector, text) => page.evaluate((sel, text) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`no element: ${sel}`);
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, selector, text);
/** Everything this origin holds in IndexedDB. Read IN the page. (Only after a course exists: opening
 *  the store early would create an empty database whose "courses" store does not exist yet.) */
const stored = () => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open("silicus-host"); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const all = (name) => new Promise((res) => { const r = db.transaction(name, "readonly").objectStore(name).getAll(); r.onsuccess = () => res(r.result); });
  const out = { metas: await all("courses"), events: await all("events") };
  db.close();
  return out;
});
const kinds = (s) => s.events.sort((a, b) => a.seq - b.seq).map((e) => JSON.parse(e.line).event.kind);
const recorded = (kind, n = 1) => async () => kinds(await stored()).filter((k) => k === kind).length >= n;

const report = []; // every width's measurement, for the table in the report
const at = async (width, label) => {
  await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(120);
  const m = await page.evaluate(measure);
  report.push({ width, label, ...m });
  return { width, label, ...m };
};
const print = (m) => {
  const mine = [...m.past.filter((x) => x.mine), ...m.clipped.filter((x) => x.mine)];
  const theirs = [...m.past.filter((x) => !x.mine), ...m.clipped.filter((x) => !x.mine)];
  console.log(`\n  ${m.label} @ ${m.width}px — page scrollWidth ${m.scrollWidth} vs clientWidth ${m.clientWidth} (${m.horizontalScroll ? "SCROLLS SIDEWAYS" : "no sideways scroll"})`);
  console.log(`    mine: ${mine.length} overflowing  |  other agent's surfaces: ${theirs.length}`);
  for (const r of mine) {
    const detail = r.right === undefined ? `content ${r.scrollWidth} > box ${r.clientWidth} (overflow-x ${r.overflowX}, ${r.whiteSpace})` : `left ${r.left} → right ${r.right} (width ${r.width})`;
    console.log(`      [${r.surface}] ${r.el} — ${detail}`);
    if (r.chain) console.log(`        inside: ${r.chain.join(" < ")}`);
  }
  for (const r of theirs) {
    const detail = r.right === undefined ? `content ${r.scrollWidth} > box ${r.clientWidth}` : `left ${r.left} → right ${r.right} (width ${r.width})`;
    console.log(`      (not mine) [${r.surface}] ${r.el} — ${detail}`);
  }
};

try {
  // ---- first impression (K1): the classic #/live view is deleted. An old #/live link lands on the landing page,
  // and the landing is checked at every width. The studio's own surfaces are walked below.
  await page.goto(`${APP}/#/live`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("h1") !== null);
  check("an old #/live link lands on the landing page", await page.evaluate(() => !!document.getElementById("landing-title")));
  for (const w of WIDTHS) print(await at(w, "landing + onboarding"));
  if (SHOT_WIDTH && WIDTHS.includes(SHOT_WIDTH)) { await page.setViewport({ width: SHOT_WIDTH, height: 1000 }); await shots(`${SUFFIX}-landing`, ["shell-header", "hero-steps"]); }
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

  // ---- G2b/M1: the new-course wizard's step 1 (title, name, goal, learners, length, note, one consequence line).
  // Checked at every width: the page never scrolls sideways and nothing in the step crosses the viewport.
  await page.goto(`${APP}/#/studio/new`, { waitUntil: "networkidle0" });
  // K1: with the classic view gone no course exists yet, so the wizard opens on its first-run welcome: Begin.
  await poll(() => page.evaluate(() => /Who are your learners\?|Let’s set up your course/.test(document.body.innerText)));
  if (await bodyHas("Let’s set up your course")) await clickText("Begin");
  await poll(() => bodyHas("Who are your learners?"));
  const g2bClick = (t) => page.evaluate((x) => { const el = [...document.querySelectorAll("label, button")].find((e) => (e.getAttribute("aria-label") ?? e.textContent ?? "").trim().includes(x)); el?.click(); return !!el; }, t);
  const GOAL = 'form[aria-label="Course and learners"] input[placeholder="Why leaves stay green, and what that tells us about light"]';
  const g2cBtn = (label) => page.evaluate((x) => { const b = [...document.querySelectorAll("button")].find((e) => !e.disabled && (e.textContent ?? "").trim() === x); b?.click(); return !!b; }, label);
  const g2cWait = (fn, ms = 10000, arg) => page.waitForFunction(fn, { timeout: ms }, arg).then(() => true, () => false);
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
  // M1: the browser host asks for the passcode before the ranking call; give it when asked.
  const mapPasscode = async () => {
    if (await g2cWait(() => !!document.querySelector('[role="dialog"] input[type="password"]'), 4000)) {
      await page.type('[role="dialog"] input[type="password"]', PASSCODE);
      await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "Continue")?.click());
    }
  };
  const mapContinue = (enabled) => page.evaluate((en) => [...document.querySelectorAll('section[aria-label="On the skill map"] button[data-primary="true"]')]
    .some((b) => b.textContent.trim() === "Continue" && b.disabled === !en), enabled);
  const overflowIn = (sel) => page.evaluate((s) => {
    const vw = document.documentElement.clientWidth;
    const past = [...document.querySelectorAll(s)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1; })
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className?.baseVal ?? e.className).slice(0, 30)}`);
    return { sw: document.documentElement.scrollWidth, vw, past };
  }, sel);
  const tall = async (width, scale, file) => {
    await page.setViewport({ width, height: 900, deviceScaleFactor: scale });
    await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
    await sleep(400);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewport({ width, height: h, deviceScaleFactor: scale });
    await sleep(400);
    await page.screenshot({ path: join(process.env.NARROW_SHELL_WIZARD_SHOTS, file) });
  };
  await g2bClick("Early primary");
  await g2bClick("Youngest age: one year older");
  for (let i = 0; i < 4; i++) await g2bClick("Oldest age: one year older");
  await page.waitForFunction(() => /map topics fit/.test(document.querySelector("[data-consequences]")?.textContent ?? ""), { timeout: 20000 }).catch(() => null);
  await page.type('form[aria-label="Course and learners"] input[placeholder="How plants eat"]', "AI around us");
  await page.type('form[aria-label="Course and learners"] input[placeholder="Ms. Lovelace"]', "Ada Lovelace");
  await page.type(GOAL, "Spot the AI in things we use every day");
  await g2bClick("+ Add a note about the class");
  await sleep(200);
  await page.type('form[aria-label="Course and learners"] textarea', "Mixed class; two learners are new to English.");
  check("M1 the wizard's step 1 is complete (Continue enabled, no anchor picker)", await page.evaluate(() => [...document.querySelectorAll('form[aria-label="Course and learners"] button[data-primary="true"]')].some((b) => !b.disabled)
    && !document.querySelector('form[aria-label="Course and learners"] input[type="search"]')));
  for (const w of [...new Set([...WIDTHS, 390])].sort((a, b) => a - b)) {
    await page.setViewport({ width: w, height: 1000, deviceScaleFactor: 1 });
    await sleep(250);
    const m = await overflowIn('form[aria-label="Course and learners"] *');
    check(`G2b wizard step 1 does not overflow at ${w}px`, m.sw <= m.vw + 1 && m.past.length === 0, `scrollWidth ${m.sw} vw ${m.vw} ${m.past.slice(0, 4).join("; ")}`);
  }
  // K5 (KV2 C3-C4): at 390 px the top bar keeps brand and the landing link on one row, and the wizard's step bar
  // keeps every segment on one row.
  await page.setViewport({ width: 390, height: 1000, deviceScaleFactor: 1 });
  await sleep(250);
  const rows = await page.evaluate(() => {
    const tops = (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))];
    const segs = [...document.querySelectorAll('[class*="mobileSeg"]')];
    const bar = document.querySelector("header");
    const about = bar ? [...bar.querySelectorAll("a")].find((a) => a.getAttribute("aria-label") === "About Silicus") : null;
    const mark = bar ? bar.querySelector("a") : null;
    const mid = (e) => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); };
    return { segs: segs.length, segTops: tops(segs), aboutText: about ? about.innerText.trim() : null,
      sameRow: !!(about && mark && Math.abs(mid(about) - mid(mark)) <= 8) };
  });
  check("K5 at 390 px the wizard's step bar is one row", rows.segs >= 6 && rows.segTops.length === 1, JSON.stringify(rows));
  check("K5 at 390 px the top bar keeps the brand and 'About' on one row", rows.sameRow && rows.aboutText === "About", JSON.stringify(rows));
  if (process.env.K5_SHOTS) await page.screenshot({ path: `${process.env.K5_SHOTS}/k5-wizard-390.png` });
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  if (process.env.NARROW_SHELL_WIZARD_SHOTS) {
    await tall(1440, 1, "2026-11-17-wizard-step1-desktop.png");
    await tall(390, 2, "2026-11-17-wizard-step1-390.png");
  }
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

  // ---- M1 · step 2, "On the skill map": anchor AI in Daily Life through search (this course's title is not the fixture's).
  await g2cMove("Continue", () => !!document.querySelector('section[aria-label="On the skill map"]'));
  await mapPasscode();
  check("M1 the map step renders after step 1 and Continue waits for an anchor or Skip", await g2cWait(() => !document.querySelector('[aria-busy="true"]') && !!document.querySelector('section[aria-label="On the skill map"]'), 15000) && await mapContinue(false));
  if (!(await page.evaluate(() => !!document.querySelector("#map-search")))) await g2cBtn("Search the map");
  await g2cWait(() => !!document.querySelector("#map-search"), 5000);
  await page.type("#map-search", "AI in Daily Life");
  await g2cWait(() => !!document.querySelector('button[aria-label="Anchor here: AI in Daily Life"]'), 15000);
  await page.evaluate(() => document.querySelector('button[aria-label="Anchor here: AI in Daily Life"]')?.click());
  check("M1 anchoring a search result shows 'Your pick' and enables Continue", await g2cWait(() => /Your pick, with what comes before/.test(document.body.innerText), 10000) && await mapContinue(true));
  for (const w of [...new Set([...WIDTHS, 390])].sort((a, b) => a - b)) {
    await page.setViewport({ width: w, height: 1000, deviceScaleFactor: 1 });
    await sleep(300);
    const m = await overflowIn('section[aria-label="On the skill map"] *');
    check(`M1 the map step ('Your pick') does not overflow at ${w}px`, m.sw <= m.vw + 1 && m.past.length === 0, `scrollWidth ${m.sw} vw ${m.vw} ${m.past.slice(0, 4).join("; ")}`);
  }
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await g2cMove("Continue", () => !!document.querySelector('input[aria-label="Use the skill-map topics as a source"]'));
  check("M1 the sources step's map row is checked by default when an anchor exists", await page.evaluate(() => document.querySelector('input[aria-label="Use the skill-map topics as a source"]')?.checked === true));
  await page.evaluate(() => document.querySelector('input[aria-label="Use the skill-map topics as a source"]')?.click());
  await sleep(500);
  const g2cWalk = [
    await g2cMove("Continue without sources", () => !!document.querySelector('section[aria-label="Your objectives"] textarea')),
  ];
  await setValue('section[aria-label="Your objectives"] textarea', "Spot AI at home and at school");
  g2cWalk.push(await g2cMove("Continue", () => !!document.querySelector('section[aria-label="Review and confirm"]')));
  g2cWalk.push(await g2cMove("Confirm and create the course", () => /^#\/studio\/(?!new$)./.test(location.hash), 15000));
  if (g2cWalk.includes(false)) console.log(`G2c walk stalled: ${JSON.stringify(g2cWalk)} at ${(await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\s+/g, " ")}`);
  const g2cIn = await g2cWait(() => !!document.querySelector("[data-evidence-suggestions]") && !!document.querySelector("[data-map-context]") && !document.querySelector("[data-neighbourhood]"), 20000);
  check("M1 the anchored course opens on objectives with the suggestions and the 'On the map' line, and no map", g2cIn);
  const g2cOverflow = async (label) => {
    for (const w of [...new Set([...WIDTHS, 390])].sort((a, b) => a - b)) {
      await page.setViewport({ width: w, height: 1000, deviceScaleFactor: 1 });
      await sleep(300);
      const m = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const past = [...document.querySelectorAll("[data-neighbourhood] *, [data-evidence-suggestions] *, [data-prereq-strip] *")]
          .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1; })
          .map((e) => `${e.tagName.toLowerCase()}.${String(e.className?.baseVal ?? e.className).slice(0, 30)}`);
        const svg = document.querySelector("[data-neighbourhood] svg");
        return { sw: document.documentElement.scrollWidth, vw, past, orient: svg?.getAttribute("data-orientation") ?? null };
      });
      check(`G2c ${label} does not overflow at ${w}px (view: ${m.orient})`, m.sw <= m.vw + 1 && m.past.length === 0, `scrollWidth ${m.sw} vw ${m.vw} ${m.past.slice(0, 4).join("; ")}`);
    }
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
  await g2cOverflow("objectives step (suggestions + neighbourhood)");
  await page.setViewport({ width: 390, height: 1000, deviceScaleFactor: 1 });
  await sleep(300);
  if (process.env.NARROW_SHELL_WIZARD_SHOTS) { await g2cTall(390, 2, "2026-11-17-objectives-onthemap-390.png"); await g2cTall(1440, 1, "2026-11-17-objectives-onthemap-desktop.png"); }
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  // Use a suggestion, add it, confirm the objectives: the plan step opens on the prerequisite strip.
  // H2b: use all three suggestions, so the scripted plan cites three of the course's own objectives.
  for (let k = 0; k < 3; k++) {
    await page.evaluate((i) => { const b = [...document.querySelectorAll("button")].filter((e) => (e.textContent ?? "").trim() === "Use as my objective")[i]; b?.click(); }, k);
    await sleep(200);
    await g2cBtn("Add");
    await g2cWait((n) => document.querySelectorAll("li[data-objective-id]").length >= n, 8000, k + 1);
  }
  // N1: the wizard's typed lines are now proposals on this page too; drop them so the set is the three suggestions
  // (Confirm stays held while any proposal waits, as before).
  for (let i = 0; i < 10 && await page.evaluate(() => document.querySelectorAll('aside[aria-label="Proposals"] article').length) > 0; i++) {
    await g2cBtn("Drop");
    await sleep(200);
    await g2cBtn("Drop it");
    await sleep(400);
  }
  await g2cWait(() => [...document.querySelectorAll('button[data-primary="true"]')].some((b) => b.textContent.trim() === "Confirm objectives" && !b.disabled), 8000);
  await g2cBtn("Confirm objectives");
  const g2cPlan = await g2cWait(() => !!document.querySelector("[data-prereq-strip]") && /Step 3 of 4/i.test(document.body.innerText), 12000);
  check("G2c confirming reaches the plan step, which opens on the prerequisite strip", g2cPlan);
  await page.evaluate(() => { const d = document.querySelector("[data-neighbourhood]"); if (d) d.open = true; });
  await sleep(300);
  await g2cOverflow("plan step (strip + neighbourhood open)");
  if (process.env.NARROW_SHELL_WIZARD_SHOTS) { await g2cTall(390, 2, "2026-11-14-graph-plan-390.png"); await g2cTall(1440, 1, "2026-11-14-graph-plan-desktop.png"); }
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

  // ---- P2ui: the anchored course drafts a v2 plan (learning design on the page); nothing overflows, 390 px included.
  await g2cMove("Draft the lesson plan", () => !!document.querySelector('[role="dialog"] input[type="password"]') || !!document.querySelector("[data-session-evidence]"));
  if (await page.evaluate(() => !!document.querySelector('[role="dialog"] input[type="password"]'))) {
    await page.type('[role="dialog"] input[type="password"]', PASSCODE);
    await g2cBtn("Continue");
  }
  const p2Plan = await g2cWait(() => !!document.querySelector("[data-session-evidence]") && !!document.querySelector("[data-later]"), 20000);
  check("P2ui the anchored course's v2 plan shows the evidence line and the Later section", p2Plan);
  const p2Sel = "[data-session-evidence] *, [data-ai-policy] *, [data-adjusted] *, [data-design-row] *, [data-learner-first] *, [data-then-decide] *, [data-later] *";
  const p2Past = [];
  for (const w of [...new Set([...WIDTHS, 390])].sort((a, b) => a - b)) {
    await page.setViewport({ width: w, height: 1000, deviceScaleFactor: 1 });
    await sleep(300);
    const past = await page.evaluate((sel) => {
      const vw = document.documentElement.clientWidth;
      return [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1; })
        .map((e) => `${e.tagName.toLowerCase()}.${(e.className || "").toString().slice(0, 30)}`);
    }, p2Sel);
    if (past.length) p2Past.push(`${w}px: ${past.slice(0, 3).join(", ")}`);
  }
  check("P2ui no learning-design element crosses the edge at 320–1440 px and at 390 px", p2Past.length === 0, p2Past.join("; "));
  await page.setViewport({ width: 390, height: 1000, deviceScaleFactor: 1 });
  await sleep(300);
  check("P2ui at 390 px the Later rows stack (offset above the prompt)", await page.evaluate(() => {
    const li = document.querySelector("[data-later] li"); if (!li) return false;
    const [a, b] = li.children; return !!a && !!b && b.getBoundingClientRect().top >= a.getBoundingClientRect().bottom - 1;
  }));
  if (process.env.NARROW_SHELL_WIZARD_SHOTS) {
    await g2cTall(390, 2, "2026-11-14-plan-v2-390.png");
    await g2cTall(1440, 1, "2026-11-14-plan-v2-desktop.png");
    await page.emulateMediaType("print");
    // Print preview: the plan sheet alone, under print media, at A4's CSS width (210 mm ≈ 794 px).
    await page.setViewport({ width: 794, height: 1200, deviceScaleFactor: 2 });
    await sleep(300);
    // A viewport as tall as the page, so no sticky chrome sits over the sheet in the capture.
    await page.setViewport({ width: 794, height: await page.evaluate(() => document.documentElement.scrollHeight), deviceScaleFactor: 2 });
    await sleep(400);
    const sheet = await page.$('article[aria-label^="Lesson plan"]');
    if (sheet) await sheet.screenshot({ path: join(process.env.NARROW_SHELL_WIZARD_SHOTS, "2026-11-14-plan-v2-print.png") });
    await page.emulateMediaType(null);
  }
  await page.emulateMediaType("print");
  check("P2ui print media keeps the learning design (policy line, evidence line, phase chips, Later)", await page.evaluate(() => {
    const vis = (sel) => [...document.querySelectorAll(sel)].some((e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0);
    return vis("[data-session-evidence]") && vis("[data-later]") && vis("[data-ai-policy]") && vis("[data-phase]");
  }));
  check("H2b the 5–12 scripted plan fits its course: no 'Silicus adjusted', no plants story",
    await page.evaluate(() => !document.querySelector("[data-adjusted]") && /Spotting AI in daily life/.test(document.body.innerText) && !/How plants eat/.test(document.body.innerText)));
  await page.emulateMediaType(null);
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

  // ---- M1 · the map with the scripted ranking ("Why is the grass green?", ages 4–10: the fixture's own course).
  // The tab holds the passcode by now, so the ranking call runs against the scripted worker.
  await page.goto(`${APP}/#/studio/new`, { waitUntil: "networkidle0" });
  await poll(() => bodyHas("Who are your learners?"));
  await g2bClick("Early primary");
  for (let i = 0; i < 2; i++) await g2bClick("Oldest age: one year older");
  await page.waitForFunction(() => /Ages 4–10|4–10/.test(document.body.innerText), { timeout: 10000 }).catch(() => null);
  await page.type('form[aria-label="Course and learners"] input[placeholder="How plants eat"]', "Why is the grass green?");
  await page.type('form[aria-label="Course and learners"] input[placeholder="Ms. Lovelace"]', "Ada Lovelace");
  await page.type(GOAL, "Why grass stays green, and what that tells us about light");
  await sleep(300);
  await g2cMove("Continue", () => !!document.querySelector('section[aria-label="On the skill map"]'));
  await mapPasscode();
  const lanesIn = await g2cWait(() => document.querySelectorAll('section[aria-label^="Thread: "]').length > 0, 20000);
  const mp = await page.evaluate(() => ({ threads: document.querySelectorAll('section[aria-label^="Thread: "]').length,
    anchored: document.querySelectorAll('section[aria-label="On the skill map"] [data-anchor="true"]').length,
    credits: document.querySelectorAll("[data-marble-credit]").length, badges: document.querySelectorAll('[aria-label^="Suggestion "]').length,
    cols: [...document.querySelectorAll('section[aria-label="On the skill map"] [aria-hidden="true"] > span')].map((s) => s.textContent).join("·") }));
  check("M1 the scripted ranking draws 1–3 threads with numbered suggestions in five columns, nothing anchored, one credit",
    lanesIn && mp.threads >= 1 && mp.threads <= 3 && mp.badges >= 1 && mp.anchored === 0 && mp.credits === 1 && mp.cols === "Earlier·Comes before·Best fit·Leads to·Later", JSON.stringify(mp));
  check("M1 suggestion 1 is selected, not anchored: Continue stays disabled", await mapContinue(false) && await page.evaluate(() => !!document.querySelector("[data-map-detail] [data-anchor-here]")));
  await page.evaluate(() => document.querySelector("[data-map-detail] [data-anchor-here]")?.click());
  await sleep(300);
  check("M1 'Anchor here' anchors the selected topic and enables Continue", await mapContinue(true) && await page.evaluate(() => document.querySelectorAll('section[aria-label="On the skill map"] [data-anchor="true"]').length >= 1));
  // Connect one topic from the other thread, if the map drew two.
  const other = await page.evaluate(() => {
    const lanes = [...document.querySelectorAll('section[aria-label^="Thread: "]')];
    const lane = lanes.find((l) => !l.querySelector('[data-anchor="true"]'));
    const b = lane?.querySelector("button[aria-pressed]");
    b?.click(); return !!b;
  });
  if (other) {
    await sleep(300);
    await page.evaluate(() => document.querySelector("[data-map-detail] [data-connect]")?.click());
    await sleep(300);
    check("M1 Connect marks a topic from the other thread; status and Undo are separate controls", await page.evaluate(() => {
      const d = document.querySelector("[data-map-detail]");
      return [...(d?.querySelectorAll("span") ?? [])].some((s) => s.textContent.trim() === "Connected") && [...(d?.querySelectorAll("button") ?? [])].some((b) => b.textContent.trim() === "Undo")
        && document.querySelectorAll('[data-connected="true"]').length >= 1;
    }));
  }
  for (const w of [...new Set([...WIDTHS, 390])].sort((a, b) => a - b)) {
    await page.setViewport({ width: w, height: 1000, deviceScaleFactor: 1 });
    await sleep(300);
    const m = await overflowIn('section[aria-label="On the skill map"] *');
    check(`M1 the ranked map does not overflow at ${w}px`, m.sw <= m.vw + 1 && m.past.length === 0, `scrollWidth ${m.sw} vw ${m.vw} ${m.past.slice(0, 4).join("; ")}`);
  }
  await page.setViewport({ width: 390, height: 1000, deviceScaleFactor: 1 });
  await sleep(300);
  check("M1 at 390 px the lanes are a list (no column header, no arcs)", await page.evaluate(() => !document.querySelector('section[aria-label="On the skill map"] svg') && /Top to bottom: each topic comes before the next/.test(document.body.innerText)));
  // K4 (C6): at 1440 px two-word topic names stay on one line, the node state is its own line, no " · " can break,
  // and the skip arc has a key.
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await sleep(300);
  const c6 = await page.evaluate(() => {
    const sec = document.querySelector('section[aria-label="On the skill map"]');
    const two = [...sec.querySelectorAll("li[data-col] button")].map((b) => [...b.children].find((s) => !s.hasAttribute("aria-label")))
      .filter((s) => s.textContent.trim().split(/\s+/).length === 2)
      .map((s) => ({ name: s.textContent.trim(), lines: Math.round(s.getBoundingClientRect().height / parseFloat(getComputedStyle(s).lineHeight)) }));
    const breakable = [...sec.querySelectorAll("li[data-col] button span"), ...document.querySelectorAll("nav li span")]
      .map((s) => s.textContent).filter((x) => / ·|· /.test(x));
    return { two, wrapped: two.filter((x) => x.lines > 1), breakable, states: sec.querySelectorAll("[data-node-state]").length, legend: sec.querySelector("[data-arc-legend]")?.textContent.trim() ?? null, arcs: sec.querySelectorAll("svg path").length - sec.querySelectorAll("[data-arc-legend] path").length };
  });
  check("K4 C6 at 1440 px every two-word topic name in the map columns sits on one line", c6.two.length > 0 && c6.wrapped.length === 0, JSON.stringify(c6.wrapped.length ? c6.wrapped : c6.two));
  check("K4 C6 no ' · ' in a map node or the step spine can break (non-breaking joins; the state word is its own line)", c6.breakable.length === 0 && c6.states >= 1, JSON.stringify({ breakable: c6.breakable, states: c6.states }));
  check("K4 C6 the skip arc has a key when an arc is drawn", c6.arcs === 0 || /must come first \(skips a step\)/.test(c6.legend ?? ""), JSON.stringify({ arcs: c6.arcs, legend: c6.legend }));
  if (process.env.NARROW_SHELL_WIZARD_SHOTS) {
    await tall(1440, 1, "2026-11-17-step2-map-desktop.png");
    await tall(390, 2, "2026-11-17-step2-map-390.png");
  }
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(`${APP}/#/studio`, { waitUntil: "networkidle0" });   // leave the half-made wizard, so the next goto reloads it fresh
  // ---- H2b: a stage-3 course (ages 12–14, Computing, no anchor). The scripted plan's third activity asks for AI
  // with no first try; the host clamps it and the plan shows the note under "Silicus adjusted".
  await page.goto(`${APP}/#/studio/new`, { waitUntil: "networkidle0" });
  await poll(() => bodyHas("Who are your learners?"));
  await g2bClick("Lower secondary");
  await g2bClick("Oldest age: one year younger");
  await g2bClick("Write your own");
  await page.waitForFunction(() => /Ages 12–14/.test(document.body.innerText), { timeout: 10000 }).catch(() => null);
  await page.type('form[aria-label="Course and learners"] input[placeholder="How plants eat"]', "Searching and sorting");
  await page.type('form[aria-label="Course and learners"] input[placeholder="Ms. Lovelace"]', "Ada Lovelace");
  await page.evaluate(() => { const i = document.querySelector('form[aria-label="Course and learners"] input[placeholder="Why leaves stay green, and what that tells us about light"]'); if (i && !i.value) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "How a computer searches and sorts"); i.dispatchEvent(new Event("input", { bubbles: true })); } });
  await sleep(400);
  const s3Walk = [
    await g2cMove("Continue", () => !!document.querySelector('section[aria-label="On the skill map"]')),
    await g2cMove("Skip the map", () => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without sources")),
    await g2cMove("Continue without sources", () => !!document.querySelector('section[aria-label="Your objectives"] textarea')),
  ];
  await setValue('section[aria-label="Your objectives"] textarea', "Explain why binary search needs a sorted list\nCarry out a bubble sort and count its swaps");
  s3Walk.push(await g2cMove("Continue", () => !!document.querySelector('section[aria-label="Review and confirm"]')));
  s3Walk.push(await g2cMove("Confirm and create the course", () => /^#\/studio\/(?!new$)./.test(location.hash), 15000));
  if (s3Walk.includes(false)) console.log(`H2b stage-3 walk stalled: ${JSON.stringify(s3Walk)} at ${(await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\s+/g, " ")}`);
  // No anchor, so no suggestions. N1: the brief's typed outcomes arrive as proposals on their own; accept each.
  await g2cWait(() => document.querySelectorAll('aside[aria-label="Proposals"] article').length > 0, 8000);
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
  if (process.env.NARROW_SHELL_WIZARD_SHOTS) await g2cTall(1440, 1, "2026-11-14-plan-v2-stage3.png");
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

  // ---- N2 (K5V C1): revise the published stage-3 course and look at the revision note at 390 px. Removing an
  // objective the plan cites invalidates the plan, so the note offers "Draft a new lesson plan from your confirmed
  // objectives" — the button that ran 462 px wide before the fix.
  const rv = [
    await g2cMove("Confirm the lesson plan", () => /Review and publish/.test(document.body.innerText), 12000),
    await g2cMove("Publish version 1…", () => /Publish version 1\?/.test(document.body.innerText)),
    await g2cMove("Publish version 1", () => /Version 1 is published/.test(document.body.innerText), 12000),
    await g2cMove("Revise objectives", () => /Objectives confirmed\./.test(document.body.innerText)),
    // Remove an objective the plan cites ("In the plan"), so the plan is invalidated and a new one is needed.
    await (async () => { for (let i = 0; i < 20; i++) {
      if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Remove objective"))) return true;
      await page.evaluate(() => { const li = [...document.querySelectorAll("li[data-objective-id]")].find((l) => /In the plan/.test(l.textContent ?? "")); [...(li?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "Remove")?.click(); });
      await sleep(500);
    } return false; })(),
    await g2cMove("Remove objective", () => !!document.querySelector('section[aria-label="Revising this course"]'), 12000),
  ];
  const rvShot = async (name) => { if (process.env.NARROW_SHELL_REVISION_SHOT) { await page.evaluate(() => document.querySelector('section[aria-label="Revising this course"]')?.scrollIntoView({ block: "center" })); await sleep(200); await page.screenshot({ path: `${process.env.NARROW_SHELL_REVISION_SHOT}/${name}` }); } };
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await sleep(400);
  const rvm = await page.evaluate(() => {
    const card = document.querySelector('section[aria-label="Revising this course"]');
    const btn = card && [...card.querySelectorAll("button")].find((b) => /Draft a new lesson plan/.test(b.textContent ?? ""));
    const cr = card?.getBoundingClientRect(), br = btn?.getBoundingClientRect();
    return { card: !!card, btn: !!btn, cardLeft: cr?.left ?? null, cardRight: cr?.right ?? null, btnLeft: br?.left ?? null, btnRight: br?.right ?? null, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  });
  await rvShot("n2-revision-note-390.png");
  check("N2 K5V C1 at 390 px the revision note's 'Draft a new lesson plan' button stays inside its card, and the page does not scroll sideways",
    !rv.includes(false) && rvm.card && rvm.btn && rvm.btnLeft >= rvm.cardLeft - 0.5 && rvm.btnRight <= rvm.cardRight + 0.5 && rvm.sw <= rvm.cw, JSON.stringify({ rv, ...rvm }));
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

  check("0 console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
  check("the only network calls were the site's functions", api.calls.every((c) => ["/api/worker", "/api/worker/status"].includes(c.path)));

  // ---- the gate: nothing crosses the edge and nothing is clipped, on the surfaces this round owns
  const overflowOnMine = report.flatMap((m) => [...m.past, ...m.clipped].filter((x) => x.mine).map((x) => ({ ...x, width: m.width, label: m.label })));
  for (const w of WIDTHS) {
    const atWidth = overflowOnMine.filter((x) => x.width === w);
    check(`no overflow on the shell, landing or intake surfaces at ${w}px`, atWidth.length === 0,
      atWidth.length ? atWidth.slice(0, 6).map((x) => `[${x.surface}] ${x.el}`).join("; ") : "");
  }
  // The page itself must not scroll sideways where the whole page is ours (the landing has no cards).
  for (const m of report.filter((r) => r.label === "landing + onboarding")) {
    check(`the landing does not scroll sideways at ${m.width}px`, !m.horizontalScroll, `scrollWidth ${m.scrollWidth}`);
  }
  // Anything left on another agent's surface is reported, not silently attributed.
  const theirs = report.flatMap((m) => [...m.past, ...m.clipped].filter((x) => !x.mine));
  if (theirs.length > 0) {
    console.log(`\n  NOTE: ${theirs.length} overflowing element(s) on surfaces owned by the parallel card round (${[...new Set(theirs.map((t) => t.surface))].join(", ")})`);
  }
} catch (e) {
  check("narrow-shell run completed", false, e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" ") : String(e));
} finally {
  await browser.close();
  server.close();
}

// The table, as data, for docs/design/narrow-width.md and the report.
if (process.env.NARROW_SHELL_JSON) writeFileSync(process.env.NARROW_SHELL_JSON, JSON.stringify(report, null, 2));
console.log("\n--- surface widths (how wide each surface wants to be) ---");
for (const m of report) {
  const widest = m.boxes.filter((b) => b.width > 0).sort((a, b) => b.width - a.width)[0];
  console.log(`  ${String(m.width).padStart(4)}px  ${m.label.padEnd(20)} scrollWidth ${String(m.scrollWidth).padStart(4)}  widest surface: ${widest ? `${widest.surface} ${widest.left}→${widest.right}` : "—"}`);
}
const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(`\n${results.length - failed.length}/${results.length} narrow-shell checks passed`);
process.exit(failed.length ? 1 : 0);
