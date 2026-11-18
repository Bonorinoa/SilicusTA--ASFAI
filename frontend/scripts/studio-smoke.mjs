#!/usr/bin/env node
/**
 * studio-smoke.mjs — the new #/studio surface, walked end to end in a real browser.
 *
 * Builds the app with VITE_SILICUS_MODE=browser (into a temp dir, so frontend/dist stays the host-mode
 * build), serves it with EXACTLY the headers vercel.json sets, and stands in for the Vercel functions
 * (/api/worker, /api/fetch) with the same scripted model the other smokes use. It does not touch the
 * network: the whole flow runs against the browser host (IndexedDB) and the mock worker.
 *
 *   node scripts/studio-smoke.mjs
 *
 * Every check is a product claim: the studio opens, a course is created, the brief is answered and
 * confirmed, objectives are proposed and decided, the plan is drafted and confirmed, a version is
 * published, Rehearse refuses an off-topic question, and the student space answers from the package.
 */
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import puppeteer from "puppeteer-core";
import { modelReply, scriptedPlanV2 } from "../../host/test/scripted-course.mjs";
let planDrafts = 0;   // P2ui: the first plan draft is a v1 reply, every later one carries the v2 learning design

const HERE = fileURLToPath(new URL("..", import.meta.url));   // frontend/
const REPO = join(HERE, "..");
const PASSCODE = "studio-smoke-passcode";
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? " — " + String(detail).slice(0, 120) : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? " — " + String(detail).slice(0, 200) : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- build (browser mode)
const OUT = mkdtempSync(join(tmpdir(), "silicus-studio-smoke-"));
const build = spawnSync("npx", ["vite", "build", "--outDir", OUT, "--emptyOutDir"], { cwd: HERE, env: { ...process.env, VITE_SILICUS_MODE: "browser" }, encoding: "utf8" });
check("the app builds with VITE_SILICUS_MODE=browser", build.status === 0, build.status === 0 ? "" : (build.stderr ?? build.stdout).slice(-400));
if (build.status !== 0) process.exit(1);

// ---------------------------------------------------------------- serve with vercel.json's headers + mock functions
const vercel = JSON.parse(readFileSync(join(REPO, "vercel.json"), "utf8"));
const HEADERS = Object.fromEntries(vercel.headers.find((h) => h.source === "/(.*)").headers.map((h) => [h.key, h.value]));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml", ".mjs": "text/javascript; charset=utf-8" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const sendJson = (status, obj) => { res.writeHead(status, { ...HEADERS, "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (url.pathname.startsWith("/api/")) {
    let raw = ""; for await (const c of req) raw += c;
    if (url.pathname === "/api/worker/status" && req.method === "GET")
      return sendJson(200, { configured: true, zdr: true, provider: "openrouter", passcodeRequired: true, model: "mock", typicalSeconds: { objectives: [3, 15], plan: [5, 25], answer: [2, 8] } });
    if ((url.pathname === "/api/worker" || url.pathname === "/api/fetch") && req.method === "POST") {
      if (req.headers["x-silicus-passcode"] !== PASSCODE) return sendJson(401, { error: { code: "BAD_PASSCODE" } });
      if (url.pathname === "/api/fetch") return sendJson(422, { error: { code: "URL_REFUSED" } });
      const body = JSON.parse(raw || "{}");
      const prompt = body?.messages?.[0]?.content ?? "";
      let reply;
      if (prompt.startsWith("SUGGEST")) reply = { objectives: [{ statement: "Students can label the parts of a leaf." }] };
      else if (prompt.startsWith("You are a study helper")) {
        const q = (prompt.trim().split("\n").at(-1) ?? "").replace(/^Student:\s*/, "").toLowerCase();
        // K3: the model only picks a kind; the host writes the words.
        if (/your name|who are you/.test(q)) reply = { kind: "about_helper", basis: null, answer: "", cites: [] };
        else if (q === "plants") reply = { kind: "clarify", basis: null, answer: "", cites: ["[objective:1]", "activity:1"] };
        else if (/game|ignore|instructions|address|my name/.test(q)) reply = { inScope: false, basis: "plan", refusal: "off_topic", answer: "", cites: [] };
        else if (/grade|pass|how am i doing|score|mark/.test(q)) reply = { inScope: false, basis: "plan", refusal: "assessment", answer: "", cites: [] };
        else reply = modelReply(prompt);
      } else if (prompt.startsWith("Draft one lesson plan")) {
        planDrafts += 1;
        reply = planDrafts === 1 ? modelReply(prompt) : scriptedPlanV2(prompt); // v1 first, then the scripted v2 plan (H2b)
      } else reply = modelReply(prompt);
      await sleep(prompt.startsWith("Draft one lesson plan") ? 800 : 200);
      if (reply?.error) return sendJson(502, { error: { code: "UPSTREAM_ERROR" } });
      return sendJson(200, { id: "mock", choices: [{ message: { role: "assistant", content: JSON.stringify(reply) } }] });
    }
    return sendJson(404, { error: { code: "NOT_FOUND" } });
  }
  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = normalize(join(OUT, rel));
  if (!file.startsWith(OUT) || !existsSync(file)) { res.writeHead(404, HEADERS); return res.end("not found"); }
  res.writeHead(200, { ...HEADERS, "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const APP = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------- Chrome
const exe = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
if (!exe) throw new Error("no system chrome found");
const browser = await puppeteer.launch({ executablePath: exe, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

const body = () => page.evaluate(() => document.body.innerText);
const waitText = async (text, ms = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if ((await body()).includes(text)) return true; await sleep(200); }
  return (await body()).includes(text);
};
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
/** G2b: click a step-1 control by its accessible text (radio cards are labels, steppers are aria-labelled). */
const clickLabel = (text) => page.evaluate((t) => {
  const el = [...document.querySelectorAll("label, button")].find((e) => (e.getAttribute("aria-label") ?? e.textContent ?? "").trim().includes(t));
  if (el) el.click();
  return !!el;
}, text);
const setVal = async (selector, value) => page.evaluate((sel, v) => {
  const el = document.querySelector(sel); if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, selector, value);
/** Everything this origin holds in IndexedDB, read in the page (no store yet = nothing recorded). */
const stored = () => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open("silicus-host"); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  if (!db.objectStoreNames.contains("courses")) { db.close(); return { metas: [], events: [] }; }
  const all = (name) => new Promise((res) => { const r = db.transaction(name, "readonly").objectStore(name).getAll(); r.onsuccess = () => res(r.result); });
  const out = { metas: await all("courses"), events: await all("events") };
  db.close();
  return out;
});
const enterPasscode = async () => {
  const open = await page.evaluate(() => !!document.querySelector('[role="dialog"][aria-modal="true"] input[type="password"]'));
  if (!open) return false;
  await page.evaluate((pc) => {
    const d = document.querySelector('[role="dialog"][aria-modal="true"] input[type="password"]');
    if (d) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(d, pc); d.dispatchEvent(new Event("input", { bubbles: true })); }
  }, PASSCODE);
  await sleep(100);
  return clickBy("Continue");
};
// A REAL mouse click: a programmatic el.click() does not move focus, and B5 is about where focus goes.
const clickPrimary = async (label, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const h = await page.evaluateHandle((lab) => [...document.querySelectorAll("button[data-primary=\"true\"]")]
      .find((e) => !e.disabled && (e.textContent ?? "").trim().includes(lab)) ?? null, label);
    const el = h.asElement();
    if (el) { await el.scrollIntoView(); await el.click(); await sleep(350); return true; }
    await sleep(150);
  }
  return false;
};
const dialogOpen = () => page.evaluate(() => !!document.querySelector('[role="dialog"][aria-modal="true"] input[type="password"]'));
// A REAL mouse click on a button by its exact label (the Rehearse Ask button is not the step's primary).
const clickReal = async (label, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const h = await page.evaluateHandle((lab) => [...document.querySelectorAll("button")]
      .find((e) => !e.disabled && (e.textContent ?? "").trim() === lab) ?? null, label);
    const el = h.asElement();
    if (el) { await el.scrollIntoView(); await el.click(); await sleep(250); return true; }
    await sleep(100);
  }
  return false;
};
const setComposer = (value) => page.evaluate((v) => {
  const el = document.querySelector('textarea[placeholder="Type as a student would…"]');
  if (!el) return null;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return el.value;
}, value);
// The studio's one status line (StepStatus) and the step's live regions, minus anything inside the dialog.
const liveRegions = () => page.evaluate(() => [...document.querySelectorAll('[role="status"],[role="alert"],[aria-live="polite"],[aria-live="assertive"]')]
  .filter((n) => !n.closest('[role="dialog"]')).map((n) => (n.textContent ?? "").trim()).filter(Boolean));
const active = () => page.evaluate(() => {
  const a = document.activeElement;
  return { tag: a?.tagName, text: (a?.textContent ?? "").trim().slice(0, 40), primary: a?.getAttribute?.("data-primary") ?? null, isBody: a === document.body };
});
const statusLine = () => page.evaluate(() => {
  const st = document.querySelector('[role="status"]');
  const line = st?.closest("p");
  const tray = document.querySelector('aside[aria-label="Proposals"]');
  const r = (e) => { const b = e.getBoundingClientRect(); return { left: Math.round(b.left), width: Math.round(b.width) }; };
  return { text: (st?.textContent ?? "").trim(), line: line ? r(line) : null, parent: line ? r(line.parentElement) : null,
    tray: tray ? r(tray) : null, sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
});

try {
  // ---- the landing leads into the studio
  await page.goto(`${APP}/`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("h1") !== null);
  check("the landing's primary opens the studio (#/studio)", await page.evaluate(() => [...document.querySelectorAll("main a")].some((a) => a.textContent === "Open the studio" && a.getAttribute("href") === "#/studio")));

  // ---- the studio home
  await page.goto(`${APP}/#/studio`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("h1") !== null);
  let t = await body();
  check("the studio home shows 'Your courses' and 'New course'", /Your courses/.test(t) && /New course/.test(t));

  // ---- new course: the onboarding wizard (lane C, R7). The old one-sheet dialog with a source-NAMES field is gone.
  await clickBy("New course");
  check("the New course card opens the wizard, on its welcome at first run", await waitText("Let’s set up your course", 8000) && (await page.evaluate(() => location.hash)) === "#/studio/new");
  await clickBy("Begin");
  await waitText("Your course and learners", 5000);
  const step1 = 'form[aria-label="Course and learners"] input';
  await page.type(`${step1}[placeholder="How plants eat"]`, "How plants eat");
  await page.type(`${step1}[placeholder="Ms. Lovelace"]`, "Ada Lovelace");
  // M1: "What should they get out of it?" is the course's required topic field (the old anchor picker is gone).
  await page.type(`${step1}[placeholder="Why leaves stay green, and what that tells us about light"]`, "How plants make food from sunlight");
  check("step 1 waits for the learners' ages before it can continue", await page.evaluate(() => [...document.querySelectorAll('button[data-primary="true"]')].some((b) => b.disabled && b.textContent.trim() === "Continue")));
  // ---- G2b: who the learners are. Early primary (4–8), then the steppers refine to 5–12.
  check("G2b five learner groups are one radio group", await page.evaluate(() => document.querySelectorAll('form[aria-label="Course and learners"] fieldset input[type="radio"]:not([name="lesson-minutes"])').length) === 5);
  await clickLabel("Early primary");
  await clickLabel("Youngest age: one year older");
  for (let i = 0; i < 4; i++) await clickLabel("Oldest age: one year older");
  check("M1 step 1's one consequence line names the stage, how many map topics fit (of the total) and the plan length",
    await page.waitForFunction(() => /[\d,]+ of [\d,]+ map topics fit · one 45-minute plan/.test(document.querySelector("[data-consequences]")?.textContent ?? ""), { timeout: 20000 }).then(() => true, () => false),
    await page.evaluate(() => document.querySelector("[data-consequences]")?.textContent ?? ""));
  check("M1 step 1 has no anchor picker, no map search and no Marble credit (the map is step 2)",
    await page.evaluate(() => !document.querySelector('form[aria-label="Course and learners"] input[type="search"]') && !document.querySelector('form[aria-label="Course and learners"] [data-marble-credit]') && !document.querySelector('button[aria-label^="Clear the skill-map anchor"]')));
  await clickBy("+ Add a note about the class");
  await sleep(200);
  await setVal('form[aria-label="Course and learners"] textarea', "Grade 4 science, ages 9-10");
  await sleep(200);
  await clickBy("Continue");
  // ---- M1 · step 2, "On the skill map". No passcode in this tab yet, so the ranking call cannot run: the step
  // falls back to search, with no error, and Continue waits for an anchor or Skip.
  check("M1 step 2 'On the skill map' renders after step 1", await waitText("On the skill map", 6000) && await page.evaluate(() => !!document.querySelector('section[aria-label="On the skill map"]')));
  const mapContinueDisabled = () => page.evaluate(() => [...document.querySelectorAll('section[aria-label="On the skill map"] button[data-primary="true"]')].some((b) => b.disabled && b.textContent.trim() === "Continue"));
  check("M1 Continue is disabled on the map step until the teacher anchors or skips", await mapContinueDisabled());
  // The browser host asks for the passcode before the ranking call; "Not now" sends nothing and the step falls back to search.
  check("M1 the ranking call asks for the demo passcode first (browser host)", await page.waitForFunction(() => !!document.querySelector('[role="dialog"] input[type="password"]'), { timeout: 8000 }).then(() => true, () => false));
  await clickBy("Not now");
  check("M1 with no ranking (Not now) the map step shows search, not an error", await page.waitForFunction(() => !!document.querySelector("#map-search"), { timeout: 15000 }).then(() => true, () => false)
    && !/error|failed/i.test(await page.evaluate(() => document.querySelector('section[aria-label="On the skill map"]')?.innerText ?? "")));
  // G1bV gap (PM 14 Nov): ONE credit component on every Marble surface, with both licence texts and the attribution notice reachable.
  const creditOn = (scope) => page.evaluate((sel) => {
    const root = document.querySelector(sel);
    const c = root?.querySelector('[data-marble-credit="true"]');
    if (!c || !/Marble Skill Taxonomy \(v1\) · © Generative Spark, Inc\. \(Marble\)/.test(c.textContent ?? "")) return null;
    const href = (k) => c.querySelector(`a[data-licence="${k}"]`)?.getAttribute("href") ?? null;
    return { odbl: href("odbl"), cc: href("cc-by-sa"), attribution: href("attribution") };
  }, scope);
  const creditOk = (c) => !!c && /opendatacommons\.org\/licenses\/odbl\/1-0/.test(c.odbl ?? "") && /creativecommons\.org\/licenses\/by-sa\/4\.0/.test(c.cc ?? "") && /MARBLE-ATTRIBUTION.*\.md$/.test(c.attribution ?? "");
  const mapCredits = () => page.evaluate(() => document.querySelectorAll("[data-marble-credit]").length);
  await page.type("#map-search", "AI in Daily Life");
  await page.waitForFunction(() => document.querySelector('button[aria-label="Anchor here: AI in Daily Life"]'), { timeout: 15000 }).catch(() => null);
  check("M1 the map step shows exactly one Marble credit while searching", (await mapCredits()) === 1, `${await mapCredits()}`);
  await page.evaluate(() => document.querySelector('button[aria-label="Anchor here: AI in Daily Life"]')?.click());
  check("M1 anchoring a search result enables Continue and shows its lane, 'Your pick'", await page.waitForFunction(() => /Your pick, with what comes before and after it/.test(document.body.innerText)
    && [...document.querySelectorAll('section[aria-label="On the skill map"] button[data-primary="true"]')].some((b) => !b.disabled && b.textContent.trim() === "Continue"), { timeout: 10000 }).then(() => true, () => false));
  const pickerCredit = await creditOn('section[aria-label="On the skill map"]');
  check("G1bV the map step shows the Marble credit with ODbL, CC BY-SA and attribution links", creditOk(pickerCredit), JSON.stringify(pickerCredit));
  check("M1 the map step still shows exactly one Marble credit with the lane drawn", (await mapCredits()) === 1, `${await mapCredits()}`);
  const notice = await page.evaluate(async (u) => { const r = await fetch(u); return { status: r.status, text: (await r.text()).slice(0, 2000) }; }, pickerCredit?.attribution ?? "/missing");
  check("G1bV the attribution notice ships with the app and names the pinned upstream", notice.status === 200 && /Marble Skill Taxonomy/.test(notice.text) && /d4440e28d8fa0fb4a59b4accf3dd1cdde6297d63/.test(notice.text), `${notice.status}`);
  await clickPrimary("Continue");
  await waitText("Drop files here", 5000);
  t = await body();
  check("the sources step is one drop zone (files, paste, web page) with no source-name field", /Drop files here/.test(t) && /Or paste text, or a web page address/.test(t)
    && await page.evaluate(() => ![...document.querySelectorAll("label")].some((l) => /^\s*(Name|Source name|Sources)\b/.test(l.textContent ?? ""))));
  check("M1 with an anchor, 'Use the skill-map topics as a source' is the first source row, checked by default",
    await page.evaluate(() => document.querySelector('input[aria-label="Use the skill-map topics as a source"]')?.checked === true));
  // This walk keeps the no-sources path (the map source is covered by its own tests): untick it.
  await page.evaluate(() => document.querySelector('input[aria-label="Use the skill-map topics as a source"]')?.click());
  await sleep(200);
  await clickBy("Continue without sources");
  await waitText("Write a few", 5000);
  await setVal('section[aria-label="Your objectives"] textarea', "Explain how a plant makes its food\nName what a plant needs to make sugar");
  await sleep(200);
  await clickBy("Continue");
  check("the AI check names the missing passcode in plain words (online build)", await waitText("needs the demo passcode", 6000) && !/BAD_PASSCODE|WORKER_|passcodeRequired/.test(await body()));
  // A REAL click on the primary (programmatic clicks keep focus on <body>; B5 below relies on real focus).
  await clickPrimary("Continue");
  await waitText("Review and confirm", 5000);
  t = await body();
  { const rc = await creditOn('section[aria-label="Review and confirm"]'); check("G1bV the review's anchor row shows the Marble credit with both licence links", creditOk(rc), JSON.stringify(rc)); }
  check("K2 the review shows the lesson length (the default chip, 45)", /Lesson length\s*45 min lesson/.test(t), (t.match(/Lesson length[^\n]*\n?[^\n]*/) ?? [""])[0].slice(0, 80));
  check("G2b the review shows ages, stage and the anchor", /Ages 5–12 · Early primary · AI stage 1 of 4/.test(t) && /AI in Daily Life/.test(t) && /Marble Skill Taxonomy/.test(t));
  check("the review shows everything that will be recorded", ["How plants eat", "Ada Lovelace", "How plants make food from sunlight", "Grade 4 science, ages 9-10", "Explain how a plant makes its food", "Name what a plant needs to make sugar"].every((x) => t.includes(x)));
  check("nothing is recorded before the review's confirm", (await stored()).metas.length === 0);
  await clickPrimary("Confirm and create the course");
  await page.waitForFunction(() => /^#\/studio\/(?!new$)./.test(location.hash), { timeout: 8000 });
  check("confirming the review creates the course and opens it in the studio", /#\/studio\//.test(await page.evaluate(() => location.hash)));
  check("it lands on Objectives (the brief is confirmed by the same click)", await waitText("From your answers", 10000));
  const ev = (await stored()).events.sort((x, y) => x.seq - y.seq).map((e) => JSON.parse(e.line).event);
  const trail = ev.filter((e) => ["course.created", "intake.answered", "checkpoint.confirmed"].includes(e.kind)).map((e) => e.kind === "checkpoint.confirmed" ? `${e.kind}:${e.id}` : e.kind);
  check("one confirm leaves the brief's intents in the brief's order: create, answers, files, outline", JSON.stringify(trail) === JSON.stringify(["course.created", "intake.answered", "checkpoint.confirmed:files", "checkpoint.confirmed:outline"]), JSON.stringify(trail));
  const created = ev.find((e) => e.kind === "course.created");
  check("G2b the course is created with ages 5–12 and the anchor mt_AzTrT5ySCx", JSON.stringify(created?.ages) === JSON.stringify({ min: 5, max: 12 }) && created?.marbleAnchor === "mt_AzTrT5ySCx", JSON.stringify({ ages: created?.ages, anchor: created?.marbleAnchor }));
  check("K2 the course is created with lessonMinutes 45 on the chained course.created event", created?.lessonMinutes === 45, JSON.stringify(created?.lessonMinutes));
  check("the course is created with no names-only material rows", Array.isArray(created?.materials ?? []) && (created?.materials ?? []).length === 0, JSON.stringify(created?.materials));

  // ---- brief, looked back at (a wizard-made course never stops on it)
  await clickBy("Brief");
  await waitText("Step 1 of 4", 6000);
  t = await body();
  check("the Brief step renders (Step 1 of 4), looked back at", /The brief/.test(t) && /step 1 of 4/i.test(t), t.slice(0, 120));
  const nFields = await page.evaluate(() => document.querySelectorAll('section[aria-label="Questions"] input:not([type="checkbox"]), section[aria-label="Questions"] textarea').length);
  check("three question fields render, holding the wizard's answers", nFields === 3 && await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Questions"] input')].some((i) => i.value.includes("Grade 4 science, ages 9-10"))), `found ${nFields}`);
  // ---- lane C · F5: the header's AI status opens the same diagnosis as the wizard's AI check
  await clickBy("AI needs passcode");
  check("the studio's AI status opens the wizard's diagnosis", await waitText("AI drafting on this site needs the demo passcode", 4000) && await page.evaluate(() => !!document.querySelector('dialog[aria-label="AI status"][open]')));
  await page.keyboard.press("Escape");
  await sleep(300);
  await clickBy("Objectives");
  await waitText("From your answers", 6000);

  // ---- objectives (lane D): the wizard made an EXPLICIT course (R4). Writing your own comes first, before any proposal (R3 UI).
  check("D the course is explicit: one held 'Confirm objectives' primary, the add form before any proposal",
    await page.evaluate(() => [...document.querySelectorAll('button[data-primary="true"]')].filter((b) => b.textContent.trim() === "Confirm objectives" && b.disabled).length === 1
      && !!document.querySelector('form[aria-label="Write your own objective"] input[placeholder="Students can…"]')));
  await setVal('input[placeholder="Students can…"]', "Students can say where a plant gets its water.");
  await sleep(300);
  await clickBy("Add");
  await sleep(900);
  check("D adding your own objective before any proposal lands it in the document, and nothing confirms by itself",
    /where a plant gets its water/.test(await body()) && /Your own objective/i.test(await body()) && /Step 2 of 4/i.test(await body()));

  // ---- M1 · the map once: the objectives step keeps the anchor's suggestions and one "On the map" line, no map.
  const g2cReady = await page.waitForSelector("[data-evidence-suggestions]", { timeout: 15000 }).then(() => true, () => false);
  check("G2c objectives: the anchor's evidence lines are offered as wording", g2cReady
    && await page.evaluate(() => document.querySelectorAll("[data-evidence-suggestions] button").length >= 1));
  {
    const oc = await page.evaluate(() => ({ total: document.querySelectorAll("[data-marble-credit]").length,
      line: document.querySelector("[data-map-context]")?.textContent ?? null, lineCredit: document.querySelectorAll("[data-map-context] [data-marble-credit]").length,
      map: document.querySelectorAll("[data-neighbourhood]").length }));
    check("M1 the objectives step shows the 'On the map' line naming the anchor and no map", /^On the map: AI in Daily Life/.test(oc.line ?? "") && oc.map === 0, JSON.stringify(oc));
    check("M1 the objectives step shows exactly one Marble credit (on the 'On the map' line)", oc.total === 1 && oc.lineCredit === 1, JSON.stringify(oc));
  }
  const before = (await stored()).events.length;
  await clickReal("Use as my objective");
  const filled = await page.evaluate(() => document.querySelector('form[aria-label="Write your own objective"] input')?.value ?? "");
  await sleep(500);
  check("G2c 'Use as my objective' pre-fills the teacher's own field and records nothing",
    /^Students can identify at least five examples of AI/.test(filled) && (await stored()).events.length === before, `filled=${JSON.stringify(filled)} events ${before}->${(await stored()).events.length}`);
  await setVal('input[placeholder="Students can…"]', `${filled} Name two you use at home.`);
  await sleep(300);
  await clickBy("Add");
  await sleep(900);
  const g2cEv = (await stored()).events.map((e) => JSON.parse(e.line).event).filter((e) => JSON.stringify(e).includes("Name two you use at home."));
  const g2cJson = JSON.stringify(g2cEv);
  const g2cRow = await page.evaluate(() => { const li = [...document.querySelectorAll("li[data-objective-id]")].find((n) => /Name two you use at home\./.test(n.textContent)); return li ? { id: li.getAttribute("data-objective-id"), by: li.getAttribute("data-by"), own: /Your own/.test(li.textContent) } : null; });
  check("G2c submitting it is the ordinary teacher add: one add intent with no Marble id; the objective is teacher-origin with a local URN",
    g2cEv.length === 1 && g2cEv[0].kind === "objectives.decided" && g2cEv[0].decisions?.length === 1 && g2cEv[0].decisions[0].verb === "add" && !/mt_/.test(g2cJson)
      && /^urn:uuid:[0-9a-f-]{36}$/.test(g2cRow?.id ?? "") && g2cRow?.by === "teacher" && g2cRow?.own === true, `${JSON.stringify(g2cRow)} ${g2cJson.slice(0, 300)}`);
  await clickBy("Use my answers");
  await waitText("Proposals", 8000);
  await sleep(500);
  const cards = await page.evaluate(() => document.querySelectorAll('aside[aria-label="Proposals"] article').length);
  check("the proposals tray fills from the teacher's answers", cards >= 1, `${cards} proposal(s)`);
  // ---- B1: the status line owns its row, and the proposals tray sits in the right column
  await sleep(400);
  let g = await statusLine();
  check("B1 the status line spans its row (not a sliver beside the tray)", !!g.line && !!g.parent && g.line.width >= g.parent.width - 4 && !g.sideways,
    `line=${g.line?.width} parent=${g.parent?.width} sideways=${g.sideways}`);
  check("B1 1440: the proposals tray sits in the right column, not squeezed under the status line", !!g.tray && g.tray.left > 300,
    `tray.left=${g.tray?.left} line.left=${g.line?.left}`);
  await page.setViewport({ width: 380, height: 800 });
  await sleep(400);
  g = await statusLine();
  check("B1 380: the status line does not force a sideways scroll", !g.sideways, `sideways=${g.sideways}`);
  await page.setViewport({ width: 1440, height: 900 });
  await sleep(400);
  // Add another of the teacher's own while proposals wait (an explicit course never confirms by itself).
  await setVal('input[placeholder="Students can…"]', "Students can explain why leaves are green.");
  await sleep(400);
  await clickBy("Add");
  await sleep(900);
  check("adding the teacher's own objective works", /why leaves are green/.test(await body()));
  await clickBy("Accept");
  await sleep(400);
  check("accepting a proposal puts it in the document", /Accepted ·/.test(await body()));
  for (let i = 0; i < 8 && await page.evaluate(() => document.querySelectorAll('aside[aria-label="Proposals"] article').length) > 0; i++) {
    await clickBy("Drop"); await sleep(200);
    await clickBy("Drop it"); await sleep(300);
  }
  await sleep(400);
  // ---- D · R4: every proposal decided, and the objectives still wait for the teacher's own confirm
  check("D with every proposal decided the step stays open until the teacher confirms",
    /Step 2 of 4/i.test(await body()) && await page.evaluate(() => [...document.querySelectorAll('button[data-primary="true"]')].some((b) => b.textContent.trim() === "Confirm objectives" && !b.disabled)));
  await clickPrimary("Confirm objectives");
  check("D confirming the objectives explicitly moves to the plan", await waitText("Objectives confirmed. On to the plan.", 6000) || await waitText("Step 3 of 4", 2000));

  // ---- G2c: the confirmed objective from the skill map is the teacher's own, and the plan opens on the strip
  await waitText("Step 3 of 4", 6000);
  const strip = await page.waitForSelector("[data-prereq-strip]", { timeout: 10000 }).then(() => page.evaluate(() => {
    const r = document.querySelector("[data-prereq-strip]");
    return { text: r.textContent, hard: r.querySelector('[data-marble-id="mt_WRRv1ABECC"]')?.getAttribute("data-strength"), soft: r.querySelector('[data-marble-id="mt_u6SYiVx7FX"]')?.textContent ?? null, credit: !!r.querySelector("[data-marble-credit]") };
  }), () => null);
  check("G2c plan: the strip names mt_WRRv1ABECC as the hard prerequisite, the soft one as optional, with the credit",
    !!strip && strip.hard === "hard" && /Before this, learners need: Smart Versus Not-Smart Devices \(hard prerequisite\)/.test(strip.text) && (strip.soft === null || /\(optional\)/.test(strip.soft)) && strip.credit, JSON.stringify(strip));
  check("G2c plan: the neighbourhood view is there, collapsed", await page.evaluate(() => { const d = document.querySelector("[data-neighbourhood]"); return !!d && d.open === false && !!d.querySelector("[data-marble-credit]"); }));
  await clickBy("Objectives");
  await waitText("Objectives confirmed", 6000);
  check("G2c after confirming, the skill-map objective is in the confirmed list as the teacher's own",
    await page.evaluate(() => [...document.querySelectorAll("li[data-objective-id]")].some((li) => /Name two you use at home\./.test(li.textContent) && /Your own/.test(li.textContent) && li.getAttribute("data-by") === "teacher" && /^urn:uuid:/.test(li.getAttribute("data-objective-id"))))
      && (await stored()).events.map((e) => JSON.parse(e.line).event).some((e) => e.kind === "checkpoint.confirmed" && e.id === "objectives"));
  await clickBy("Back to the current step");
  await waitText("Step 3 of 4", 6000);

  // ---- B5: cancelling the passcode gives focus back to the step's primary action, every time
  // (a real mouse click opens it, so the invoking control — not <body> — is what the dialog stores)
  let b5 = 0;
  for (let i = 0; i < 20; i += 1) {
    const route = i % 2 === 0 ? "Not now" : "Escape";
    const opened = (await clickPrimary("Draft the lesson plan")) && (await dialogOpen());
    if (route === "Escape") await page.keyboard.press("Escape"); else await clickBy("Not now");
    await sleep(700);
    const a = await active();
    const back = a.primary === "true" || /Draft the lesson plan/.test(a.text);
    if (opened && back) b5 += 1;
    else console.log(`  B5-b miss ${i} (${route}): opened=${opened} focus=${JSON.stringify(a)}`);
    if (i === 0) check("B5-a one live region after a cancelled passcode", (await liveRegions()).length === 1, JSON.stringify(await liveRegions()));
  }
  check("B5-b focus returns to the primary action after 20 cancels, both routes", b5 === 20, `${b5}/20`);

  // ---- plan (needs the passcode)
  await clickPrimary("Draft the lesson plan");
  await enterPasscode();
  check("drafting the plan completes and shows a draft", await waitText("Confirm the lesson plan", 15000));
  const align = await page.evaluate(() => {
    const el = document.querySelector('section[aria-label="Suggested alignment"]');
    return el ? el.textContent ?? "" : "";
  });
  check("one draft plan shows a Marble suggested alignment (the mock worker cited the local snapshot)", /Marble/.test(align), align.slice(0, 120));
  // H2a: the Marble credit lives inside "Suggested alignment", once; the section is never an empty area (collapsed: heading + count).
  {
    const sa = await page.evaluate(() => {
      const el = document.querySelector('section[aria-label="Suggested alignment"]');
      const d = el?.querySelector("details");
      return { credits: el ? el.querySelectorAll("[data-marble-credit]").length : -1, inside: !!d?.querySelector("[data-marble-credit]"),
        summary: d?.querySelector("summary")?.textContent ?? "", rows: d ? d.querySelectorAll("li").length : 0 };
    });
    const saCredit = await creditOn('section[aria-label="Suggested alignment"]');
    check("H2a Suggested alignment holds exactly one Marble credit, inside the fold, with ODbL, CC BY-SA and attribution links; collapsed it shows its count",
      sa.credits === 1 && sa.inside && creditOk(saCredit) && /Suggested alignment\s*\d+ references?/.test(sa.summary) && sa.rows >= 1, JSON.stringify(sa));
  }

  // ---- P2ui: a v1 plan shows none of the learning design; "Draft again" brings the v2 plan, which does.
  const designOf = () => page.evaluate(() => ({
    policy: [...document.querySelectorAll("[data-ai-policy]")].map((e) => e.textContent),
    evidence: [...document.querySelectorAll("[data-session-evidence]")].map((e) => e.textContent),
    phases: [...document.querySelectorAll("[data-phase]")].map((e) => e.textContent),
    later: [...document.querySelectorAll("[data-later] li")].map((e) => e.textContent),
    adjusted: [...document.querySelectorAll("[data-adjusted] li")].map((e) => e.textContent),
    first: document.querySelectorAll("[data-learner-first]").length,
    tags: document.querySelectorAll("[data-ai-status]").length,
    text: document.body.innerText,
    plan: document.querySelector('article[aria-label^="Lesson plan"]')?.innerText ?? "",
    activities: [...document.querySelectorAll('article[aria-label^="Lesson plan"] h2')].map((h) => h.parentElement?.innerText ?? "").join("\n"),
  }));
  const d1 = await designOf();
  check("P2ui a v1 plan shows no policy line, phase chip, evidence line, Later section or adjusted list",
    d1.policy.length + d1.evidence.length + d1.phases.length + d1.later.length + d1.adjusted.length + d1.first + d1.tags === 0, JSON.stringify({ ...d1, text: undefined }));
  const planIdBefore = await page.evaluate(() => document.querySelector("[data-session-evidence]") ? "v2" : (document.querySelector('article[aria-label^="Lesson plan"]')?.textContent ?? "").length);
  await clickBy("Draft again");
  await enterPasscode();
  const gotV2 = await page.waitForFunction(() => !!document.querySelector("[data-session-evidence]"), { timeout: 15000 }).then(() => true, () => false);
  const d2 = await designOf();
  check("P2ui the v2 plan shows the stage-1 policy line once, in plain words",
    gotV2 && d2.policy.length === 1 && /Children don’t use AI in this lesson\. You may use it to prepare\./.test(d2.policy[0]), JSON.stringify(d2.policy));
  check("P2ui stage 1-2: no per-activity AI tag beside the policy line", d2.tags === 0, `tags=${d2.tags}`);
  check("P2ui phase chips on the activities", d2.phases.length >= 2 && d2.phases[0] === "1 Notice and guess" && /^2 Try and fix/.test(d2.phases[1]), JSON.stringify(d2.phases));
  check("P2ui exactly one 'Evidence for this session' line", d2.evidence.length === 1 && /sorted card strip/.test(d2.evidence[0]), JSON.stringify(d2.evidence));
  check("P2ui the Later section lists each review with its offset", d2.later.length === 2 && d2.later[0].startsWith("In 2 days") && d2.later[1].startsWith("Next week"), JSON.stringify(d2.later).slice(0, 200));
  // H2b: the scripted v2 plan matches the course (AI in Daily Life, 5–12), so the host has nothing to adjust.
  // The "replaced the AI line" quote (H2a item 6) is unit-tested in PlanCard.design.test.tsx; the stage-3
  // clamp note is shown and checked by narrow-shell.mjs on its own stage-3 course.
  check("H2b the scripted v2 plan fits the course: 'Learners first' on all three activities, nothing under 'Silicus adjusted', no plants in the plan's title or activities (this smoke course's own title and objectives stay the plants ones)",
    d2.first >= 3 && d2.adjusted.length === 0 && /Spotting AI in daily life/.test(d2.plan) && /Smart Versus Not-Smart Devices/.test(d2.plan) && !/How plants eat|Look at a leaf|Ask what it needs/.test(d2.plan.split("\n")[0] + d2.activities),
    JSON.stringify({ first: d2.first, adjusted: d2.adjusted, head: d2.plan.slice(0, 120) }).slice(0, 300));
  check("K2 the plan header reads '45 min lesson · activities 45 min' (the scripted minutes add up), with no length note",
    /45 min lesson · activities 45 min/i.test(await body()) && !/Activities add up to/.test(await body()));
  check("P2ui the UI names no model or author it is not yet allowed to", !/SYNAPSE|Chardonnens/i.test(d2.text), String(planIdBefore));
  await clickBy("Confirm the lesson plan");
  check("confirming the plan moves to Publish (Step 4 of 4)", await waitText("Review and publish", 10000));

  // ---- publish
  await clickBy("Publish version 1…");
  check("publishing asks for a second, explicit confirm", await waitText("Publish version 1?", 5000));
  await clickBy("Publish version 1");
  check("K2 the published moment names the lesson length", /A 45 min lesson\./.test(await body()));
  check("the published moment renders with the student and Rehearse links", await waitText("Version 1 is published", 10000) && /Open the student space/.test(await body()) && /Rehearse student questions/.test(await body()));
  await sleep(500);
  const published = await body();
  const line = await statusLine();
  check("B2 the published screen stops asking to review and publish", line.text.includes("Version 1 is published") && !/Your turn: review and publish/.test(published), `status="${line.text}"`);

  // ---- rehearse
  const id = (await page.evaluate(() => location.hash)).split("/")[2];
  await page.goto(`${APP}/#/studio/${id}/rehearse`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("h1") !== null);
  await waitText("Type as a student would", 6000);
  check("Rehearse renders the simulator and the guardrail probes", /Ask what your students will ask/.test(await body()) && /Guardrail probes/.test(await body()));
  // ---- G4: a cancelled passcode in Rehearse keeps the question the teacher typed, and focus returns to
  // the Ask button (the opener, since a real click focuses it). 20 repeats, both cancel routes. The tab
  // forgets the passcode first, so Ask really does ask for it again.
  await page.evaluate(() => sessionStorage.removeItem("silicus.demoPasscode"));
  const G4_Q = "What is a fraction?";
  let g4 = 0;
  for (let i = 0; i < 20; i += 1) {
    const route = i % 2 === 0 ? "Not now" : "Escape";
    await setComposer(G4_Q);
    await sleep(120);
    const opened = (await clickReal("Ask")) && (await dialogOpen());
    if (route === "Escape") await page.keyboard.press("Escape"); else await clickReal("Not now");
    await sleep(600);
    const value = await page.evaluate(() => document.querySelector('textarea[placeholder="Type as a student would…"]')?.value ?? null);
    const a = await active();
    const back = a.tag === "TEXTAREA" || /^Ask$/.test(a.text ?? "");
    if (opened && value === G4_Q && back) g4 += 1;
    else console.log(`  G4 miss ${i} (${route}): opened=${opened} value=${JSON.stringify(value)} focus=${JSON.stringify(a)}`);
  }
  check("G4 20 cancelled passcodes in Rehearse keep the question and return focus, both routes", g4 === 20, `${g4}/20`);
  await setComposer("");
  await sleep(150);
  await page.type('textarea[placeholder="Type as a student would…"]', "What's the best video game right now?");
  await clickBy("Ask");
  await enterPasscode();
  check("Rehearse refuses an off-topic question from the host's answer", await waitText("Refused", 8000));

  // ---- learn
  await page.goto(`${APP}/#/learn/${id}`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("h1") !== null);
  t = await body();
  check("the student space is labelled a preview on this device", /Preview on this device/.test(t));
  check("the student space shows the published title and goals", /How plants eat/.test(t) && /learning to/i.test(t));
  await page.type('input[placeholder="Ask about today’s lesson"]', "What do plants need?");
  await clickBy("Ask");
  await enterPasscode();
  check("the student helper answers from the published package", await waitText("A plant uses light, water and air", 8000));
  // ---- K3: a vague one-word question gets the host's clarify, with the lesson's items to tap; a name question gets the fixed introduction.
  await page.type('input[placeholder="Ask about today’s lesson"]', "plants");
  await clickBy("Ask");
  check("K3 a one-word question gets the host's clarify listing the lesson's items", await waitText("What would you like to know? I can help with:", 8000));
  const offers = await page.evaluate(() => [...document.querySelectorAll('[role="group"][aria-label="Ask about"] button')].map((b) => (b.textContent ?? "").trim()));
  check("K3 the clarify offers the lesson's items as buttons (1 to 3)", offers.length >= 1 && offers.length <= 3, JSON.stringify(offers));
  await page.type('input[placeholder="Ask about today’s lesson"]', "what is your name");
  await clickBy("Ask");
  check("K3 'what is your name' gets the fixed introduction naming the lesson", await waitText("I'm Silicus, a helper for today's lesson: How plants eat. Ask me about it.", 8000));
  if (process.env.K3_SHOTS) {
    await sleep(400);
    await page.screenshot({ path: `${process.env.K3_SHOTS}/k3-learn-clarify-desktop.png`, fullPage: true });
  }
  const answersBefore = await page.evaluate(() => (document.body.innerText.match(/A plant uses light, water and air/g) ?? []).length);
  await page.evaluate((label) => [...document.querySelectorAll('[role="group"][aria-label="Ask about"] button')].find((b) => (b.textContent ?? "").trim() === label)?.click(), offers[offers.length - 1]);
  check("K3 tapping an offered item asks about it", await page.waitForFunction((n) => (document.body.innerText.match(/A plant uses light, water and air/g) ?? []).length > n, { timeout: 8000 }, answersBefore).then(() => true, () => false));

  // ---- lane C · R7: a second course through the wizard, proposing from a pasted source on arrival
  await page.goto(`${APP}/#/studio/new`, { waitUntil: "networkidle0" });
  check("a returning teacher's wizard opens on step 1, without the welcome", await waitText("Your course and learners", 6000) && !/Let’s set up your course/.test(await body()));
  await page.type('form[aria-label="Course and learners"] input[placeholder="How plants eat"]', "Leaves and light");
  await page.type('form[aria-label="Course and learners"] input[placeholder="Ms. Lovelace"]', "Ada Lovelace");
  // ---- G2b: ages 19–22 have no skill-map topics: it says so, the teacher writes their own, no anchor.
  await clickLabel("University / adult");
  await clickLabel("Youngest age: one year older");
  for (let i = 0; i < 3; i++) await clickLabel("Oldest age: one year younger");
  check("M1 ages 19–22: the consequence line says no map topics fit", await page.waitForFunction(() => /\b0 of [\d,]+ map topics fit/.test(document.querySelector("[data-consequences]")?.textContent ?? ""), { timeout: 15000 }).then(() => true, () => false),
    await page.evaluate(() => document.querySelector("[data-consequences]")?.textContent ?? ""));
  await page.type('form[aria-label="Course and learners"] input[placeholder="Why leaves stay green, and what that tells us about light"]', "Why leaves are green");
  await clickBy("+ Add a note about the class");
  await sleep(200);
  await setVal('form[aria-label="Course and learners"] textarea', "Grade 4 science");
  await sleep(200);
  await clickBy("Continue");
  await waitText("On the skill map", 6000);
  check("M1 ages 19–22: the map step has nothing to rank, shows search with no error, and Continue waits", await page.waitForFunction(() => !!document.querySelector("#map-search"), { timeout: 15000 }).then(() => true, () => false)
    && await page.evaluate(() => [...document.querySelectorAll('section[aria-label="On the skill map"] button[data-primary="true"]')].some((b) => b.disabled)));
  await page.evaluate(() => document.querySelector('button[data-skip-map="true"]')?.click());
  await waitText("Drop files here", 5000);
  // The source is named by its own first line: a 200-character unbroken one must wrap, never widen the page.
  await setVal('section[aria-label="Sources"] textarea', "x".repeat(200) + "\nPlants make their own food from light.\nLeaves hold the green pigment that catches light.");
  await sleep(200);
  await clickBy("Add text");
  await waitText("Read in this tab", 4000);
  await page.setViewport({ width: 390, height: 844 });
  await sleep(400);
  check("a 200-character unbroken first line names the pasted source, and at 390 the wizard does not scroll sideways",
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.body.innerText.includes("x".repeat(40))));
  await page.setViewport({ width: 1440, height: 900 });
  await sleep(300);
  await clickBy("Continue");
  await waitText("Let Silicus propose objectives from my sources", 5000);
  check("with a source and nothing written, proposing from sources is already chosen", await page.evaluate(() => document.querySelector('section[aria-label="Your objectives"] input[type="checkbox"]')?.checked === true));
  await clickBy("Continue");
  check("the AI check reads ready once the tab holds the passcode", await waitText("AI drafting is ready.", 6000));
  await clickBy("Continue");
  await waitText("Review and confirm", 5000);
  await clickPrimary("Confirm and propose objectives");
  await page.waitForFunction(() => /^#\/studio\/(?!new$)./.test(location.hash), { timeout: 8000 });
  await enterPasscode().catch(() => false);
  check("R7 the confirm lands on Objectives and starts proposing from the sources there", await waitText("Not yours until you accept", 15000) && /From material:/.test(await body()));
  check("R7 one live region on the step after the wizard", (await liveRegions()).length === 1, JSON.stringify(await liveRegions()));
  {
    const all = (await stored()).events.map((e) => JSON.parse(e.line).event).filter((e) => e.kind === "course.created");
    const leaves = all.find((e) => e.title === "Leaves and light");
    check("G2b the second course is created with ages 19–22 and no anchor", JSON.stringify(leaves?.ages) === JSON.stringify({ min: 19, max: 22 }) && leaves?.marbleAnchor === undefined, JSON.stringify(leaves ? { ages: leaves.ages, anchor: leaves.marbleAnchor } : all.map((e) => e.title)));
  }
  check("H2a ages 19–22: the objectives step says once, quietly, that there are no skill-map topics",
    await waitText("No skill-map topics for these ages. Write your own objectives.", 8000)
      && await page.evaluate(() => document.querySelectorAll("[data-no-skill-map-topics]").length === 1 && !document.querySelector("[data-neighbourhood]")));
  // ---- F1 (verifier): a long unbroken source name in the proposals' provenance must wrap, never widen the page.
  await page.setViewport({ width: 390, height: 844 });
  await sleep(500);
  check("F1 at 390 the Objectives step does not scroll sideways with a 200-character source name in the provenance",
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
    await page.evaluate(() => `sw=${document.documentElement.scrollWidth} vw=${document.documentElement.clientWidth}`));
  await page.setViewport({ width: 1440, height: 900 });
} catch (e) {
  check("the walk finished without throwing", false, e.message);
  console.log("LAST BODY:", (await body().catch(() => "?")).slice(0, 400));
}

const realErrors = consoleErrors.filter((e) => !/React DevTools/.test(e));
check("no console or page errors during the walk", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

console.log(`\n${pass}/${pass + fail} studio checks passed`);
await browser.close();
server.close();
process.exit(fail > 0 ? 1 : 0);
