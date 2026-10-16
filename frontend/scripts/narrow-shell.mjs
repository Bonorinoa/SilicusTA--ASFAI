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
import { modelReply } from "../../host/test/scripted-course.mjs";

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
      return sendJson(res, 200, { id: "mock", choices: [{ message: { role: "assistant", content: JSON.stringify(modelReply(parsed?.messages?.[0]?.content ?? "")) } }] });
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
    ["section[aria-label='Try it as a student']", "student chat"],
    ["section[aria-label='Where your courses are kept']", "record band + data controls"],
    ["section[aria-label='Pinned copies on this device']", "pinned copies"],
    ["details", "course library"],
    ["button[aria-haspopup='menu']", "course library"],
    ["ol[aria-label='Checkpoints']", "checkpoint chips"],
    ["article", "PlanCard (other agent)"],
    ["section[aria-label='Objective proposals']", "DecisionCard (other agent)"],
    ["section[aria-label='Course package — preview and publish']", "PublishCard (other agent)"],
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
  ["section[aria-label='Try it as a student']", "student-chat"],
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
const reply = async (text, button) => { await page.waitForSelector("#onboarding-reply"); await setValue("#onboarding-reply", text); await clickText(button); };
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
  // ---- first impression: the BARE url lands on the live course (landing + onboarding)
  await page.goto(`${APP}/#/live`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("h1") !== null);
  check("the bare URL lands on the live course", await bodyHas("Build a course, one decision at a time"));
  for (const w of WIDTHS) print(await at(w, "landing + onboarding"));
  if (SHOT_WIDTH && WIDTHS.includes(SHOT_WIDTH)) { await page.setViewport({ width: SHOT_WIDTH, height: 1000 }); await shots(`${SUFFIX}-landing`, ["shell-header", "hero-steps", "onboarding-card", "record-band"]); }

  // ---- name the course, confirm the materials, answer the intake
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await reply("Photosynthesis for the very young — a course whose title is long enough to need wrapping in a narrow window", "Record the course title");
  // Renamed by the intake-clarity round: the label step is now "What name should this course show for you?".
  await page.waitForFunction(() => document.body.innerText.includes("What name should this course show for you"));
  await reply("Ada Lovelace", "Record this name");
  await page.waitForFunction(() => document.body.innerText.includes("Name the materials"));
  await reply("Lesson notes", "Record these names");
  await poll(() => bodyHas("Confirm the material list"));
  await poll(async () => (await stored()).metas.length === 1);
  await clickText("Confirm the material list");

  await poll(() => page.evaluate(() => !!document.querySelector("#intake-topic")));
  // The intake question state of the onboarding card, at every width.
  for (const w of WIDTHS) print(await at(w, "onboarding: intake question"));
  if (SHOT_WIDTH && WIDTHS.includes(SHOT_WIDTH)) { await page.setViewport({ width: 1440, height: 1000 }); }
  await setValue("#intake-topic", "Photosynthesis"); await clickText("Record this answer");
  await poll(() => page.evaluate(() => !!document.querySelector("#intake-course")));
  await setValue("#intake-course", "Science, ages 8-10"); await clickText("Record this answer");
  await poll(() => bodyHas("Propose these from my materials instead"));
  await clickText("Propose these from my materials instead");
  await poll(() => bodyHas("Confirm the brief"));
  await clickText("Confirm the brief");

  // ---- the material panel, at every width (with one item already added, so the rows are set)
  await poll(() => bodyHas("Add your material here")); // the intake-clarity round reworded this prompt
  await page.evaluate(() => {
    const label = [...document.querySelectorAll("label")].find((l) => /Or paste text/.test(l.textContent ?? ""));
    const input = document.getElementById(label.htmlFor);
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "Lesson notes");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await setValue('textarea[aria-label="Pasted text"]', MATERIAL_TEXT);
  await clickText("Add this text");
  await poll(() => bodyHas("Lesson notes ·"));
  for (const w of WIDTHS) print(await at(w, "materials panel"));
  if (SHOT_WIDTH && WIDTHS.includes(SHOT_WIDTH)) { await page.setViewport({ width: SHOT_WIDTH, height: 1000 }); await shots(`${SUFFIX}-materials`, ["materials-panel", "shell-header"]); }
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await clickText("Propose objectives from my materials");
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await page.type('[role="dialog"] input[type="password"]', PASSCODE);
  await clickText("Continue");
  await poll(recorded("objectives.proposed"), 20000);
  await poll(async () => {
    if ((await stored()).events.filter((e) => JSON.parse(e.line).event.kind === "objectives.decided").length >= 3) return true;
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") ?? "").trim().startsWith("Accept objective"));
      if (b && !b.disabled) b.click();
    });
    await sleep(150);
    return null;
  }, 25000);
  // C1.5: the confirm bar under the decided objectives carries this act now (it used to be a separate button).
  await poll(() => bodyHas("build the plan"));
  await clickText("Confirm 3 objectives · build the plan");
  await poll(recorded("plan.proposed"), 20000);
  await poll(() => bodyHas("Confirm the lesson plan"));
  await clickText("Confirm the lesson plan");
  await poll(recorded("plan.confirmed"));
  await poll(async () => {
    const opened = await page.evaluate(() => !!document.querySelector('[role="group"][aria-label^="Confirm sealing"]'));
    if (opened) return true;
    await page.evaluate(() => {
      const sec = document.querySelector('section[aria-label*="Course package"]');
      const armed = !!sec && /ready to seal/i.test(sec.innerText);
      const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith("Review & publish"));
      if (btn && armed) btn.click();
    });
    await sleep(200);
    return null;
  }, 12000);
  await clickText("Publish version 1");
  await poll(recorded("package.published"));
  await page.waitForSelector('section[aria-label="Try it as a student"] input');
  await page.type('section[aria-label="Try it as a student"] input', "What do plants need to make food?");
  await clickText("Ask");
  await poll(() => bodyHas("A plant uses light"), 20000);

  // ---- the whole app at every width
  check("the published course is on the page with a student answer", await bodyHas("From Objective 1, Activity 1"));
  for (const w of WIDTHS) print(await at(w, "full live course"));
  // C-a (workspace): at 380 the stage navigator is the stepper again: a row of labels, no summaries, nothing sticky.
  await page.setViewport({ width: 380, height: 900, deviceScaleFactor: 1 });
  const stepper = await page.evaluate(() => {
    const ol = document.querySelector('ol[aria-label="Steps"]');
    if (!ol) return null;
    let sticky = false;
    for (let e = ol; e && e !== document.body; e = e.parentElement) if (getComputedStyle(e).position === "sticky") sticky = true;
    return { dir: getComputedStyle(ol).flexDirection, text: ol.innerText.replace(/\s+/g, " "), sticky, right: Math.round(ol.getBoundingClientRect().right), vw: innerWidth };
  });
  check("380px: the stage navigator collapses to the stepper (a row of labels, no summaries, nothing sticky)",
    !!stepper && stepper.dir === "row" && /Material.*Brief.*Objectives.*Plan.*Publish/.test(stepper.text) && !/Version \d|confirmed|min\b/.test(stepper.text) && !stepper.sticky && stepper.right <= stepper.vw,
    JSON.stringify(stepper));
  if (SHOT_WIDTH && WIDTHS.includes(SHOT_WIDTH)) { await page.setViewport({ width: SHOT_WIDTH, height: 1000 }); await shots(`${SUFFIX}-course`, ["shell-header", "student-chat", "pinned-copies", "record-band"]); }

  // ---- the data controls in their confirm state (nothing is deleted: "Keep them" is pressed after)
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await clickText("Delete all data from this browser");
  await poll(() => bodyHas("This cannot be undone"));
  for (const w of WIDTHS) print(await at(w, "record band: delete confirm"));
  await clickText("Keep them");
  await poll(() => bodyHas("Export all courses"));
  if (SHOT_WIDTH && WIDTHS.includes(SHOT_WIDTH)) { await page.setViewport({ width: SHOT_WIDTH, height: 1000 }); await shots(`${SUFFIX}-confirm`, ["record-band"]); }
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
