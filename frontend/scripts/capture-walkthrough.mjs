#!/usr/bin/env node
/**
 * capture-walkthrough.mjs — the README's walkthrough pictures, taken from the online build.
 *
 * Builds the app exactly as Vercel does (VITE_SILICUS_MODE=browser) into a temp dir, serves it with
 * vercel.json's headers, and stands in for the site's /api/worker with a SCRIPTED worker that answers a
 * grade 4 fractions lesson (the same lesson as the eval fixtures in eval/student-helper/). No real model, no
 * passcode, no network. The host in the page still validates every scripted reply as it would a model's.
 *
 *   node frontend/scripts/capture-walkthrough.mjs                 # writes docs/img/walkthrough/*.png
 *   node frontend/scripts/capture-walkthrough.mjs --text <dir>    # also writes each screen's innerText
 *
 * Exit 0 only when every picture was taken and every screen showed the copy it is meant to show.
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const HERE = fileURLToPath(new URL("..", import.meta.url));   // frontend/
const REPO = join(HERE, "..");
const IMG = join(REPO, "docs", "img", "walkthrough");
const ti = process.argv.indexOf("--text");
const TEXT = ti > 0 ? process.argv[ti + 1] : null;
mkdirSync(IMG, { recursive: true });
if (TEXT) mkdirSync(TEXT, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? " — " + String(detail).slice(0, 120) : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? " — " + String(detail).slice(0, 300) : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the lesson (public, made up for this walkthrough)
const COURSE = {
  title: "Fractions on a number line",
  teacher: "Ms. Rivera",
  topic: "Placing unit fractions between 0 and 1",
  audience: "Grade 4 math, ages 9–10",
};
const SOURCE = [
  "Fractions on a number line: lesson notes",
  "The space from 0 to 1 on a number line is one whole.",
  "Partition the interval from 0 to 1 into 4 equal parts by drawing tick marks.",
  "Each part is 1/4 of the whole. Label the tick marks 1/4, 2/4, 3/4 and 4/4.",
  "A unit fraction such as 1/4 sits at the end of the first equal part, counting from 0.",
  "4/4 and 1 are two names for the same point on the number line.",
].join("\n");
const OWN = "Students can label the tick marks 1/4, 2/4, 3/4 and 4/4 on a number line.";

/** The scripted worker: one reply per prompt kind the host sends. */
function scripted(prompt) {
  const p = String(prompt ?? "");
  if (p.startsWith("Propose learning objectives")) {
    return { objectives: [
      { statement: "Students can partition the interval from 0 to 1 into equal parts on a number line.", from: ["M1"] },
      { statement: "Students can place a unit fraction such as 1/4 on a number line.", from: ["M1"] },
      { statement: "Students can explain why 4/4 and 1 name the same point.", from: ["M1"] },
    ] };
  }
  if (p.startsWith("SUGGEST")) return { objectives: [{ statement: "Students can compare two unit fractions using a number line." }] };
  if (p.startsWith("Draft one lesson plan")) {
    const objs = [...p.matchAll(/^- (urn:uuid:[0-9a-f-]+): (.*)$/gm)].map((m) => ({ id: m[1], s: m[2].toLowerCase() }));
    const pick = (re) => (objs.find((o) => re.test(o.s)) ?? objs[0]).id;
    const label = pick(/label/), partition = pick(/partition/), place = pick(/place/), same = pick(/same point/);
    return {
      title: "Fractions on a number line",
      audience: { ageRangeStart: 9, ageRangeEnd: 10 },
      activities: [
        { title: "Partition One", minutes: 10, objectiveIds: [...new Set([partition, label])],
          learnerDoes: "Draw a number line from 0 to 1 and split it into 4 equal parts with tick marks, then label each mark.",
          teacherDoes: "Draw the first line on the board and ask how we know the parts are equal.", evidenceIfAny: "work-product" },
        { title: "Place Unit Fractions", minutes: 20, objectiveIds: [place],
          learnerDoes: "Place 1/4 on their own number line, then find 1/2 and 3/4 the same way.",
          teacherDoes: "Model placing 1/4, then walk around and help students count equal parts from 0.", evidenceIfAny: "observation" },
        { title: "Same Point, Two Names", minutes: 15, objectiveIds: [same],
          learnerDoes: "Write one sentence explaining why 4/4 and 1 are the same point.",
          teacherDoes: "Collect a few sentences and read two aloud without names.", evidenceIfAny: "work-product" },
      ],
    };
  }
  if (p.startsWith("You are a study helper")) {
    const items = [...p.matchAll(/^- \[([^\]]+)\] ([^:]*):/gm)].map((m) => ({ id: m[1], label: m[2] }));
    const q = (p.trim().split("\n").at(-1) ?? "").replace(/^Student:\s*/, "").toLowerCase();
    if (/grade|pass|how am i doing|score|mark/.test(q)) return { inScope: false, basis: "plan", refusal: "assessment", answer: "", cites: [] };
    if (/partition one/.test(q)) {
      const act = items.find((i) => /partition one/i.test(i.label)) ?? items.find((i) => i.id.startsWith("activity"));
      const obj = items.find((i) => i.id.startsWith("objective"));
      return { inScope: true, basis: "plan", refusal: null,
        answer: "In Partition One you draw a number line from 0 to 1 and split it into 4 equal parts with tick marks. Then you label each mark: 1/4, 2/4, 3/4 and 4/4.",
        cites: [act?.id, obj?.id].filter(Boolean) };
    }
    return { inScope: false, basis: "plan", refusal: "off_topic", answer: "", cites: [] };
  }
  return null;
}

// ---------------------------------------------------------------- build (browser mode, the deployed build)
const OUT = mkdtempSync(join(tmpdir(), "silicus-walkthrough-"));
const build = spawnSync("npx", ["vite", "build", "--outDir", OUT, "--emptyOutDir"], { cwd: HERE, env: { ...process.env, VITE_SILICUS_MODE: "browser" }, encoding: "utf8" });
check("the app builds with VITE_SILICUS_MODE=browser", build.status === 0, build.status === 0 ? "" : (build.stderr ?? build.stdout).slice(-400));
if (build.status !== 0) process.exit(1);

const vercel = JSON.parse(readFileSync(join(REPO, "vercel.json"), "utf8"));
const HEADERS = Object.fromEntries(vercel.headers.find((h) => h.source === "/(.*)").headers.map((h) => [h.key, h.value]));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml", ".mjs": "text/javascript; charset=utf-8", ".png": "image/png" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const sendJson = (status, obj) => { res.writeHead(status, { ...HEADERS, "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (url.pathname.startsWith("/api/")) {
    let raw = ""; for await (const c of req) raw += c;
    if (url.pathname === "/api/worker/status" && req.method === "GET")
      return sendJson(200, { configured: true, zdr: true, provider: "scripted", passcodeRequired: false, model: "scripted", typicalSeconds: { objectives: [3, 15], plan: [5, 25], answer: [2, 8] } });
    if (url.pathname === "/api/fetch") return sendJson(422, { error: { code: "URL_REFUSED" } });
    if (url.pathname === "/api/worker" && req.method === "POST") {
      const prompt = JSON.parse(raw || "{}")?.messages?.[0]?.content ?? "";
      const reply = scripted(prompt);
      await sleep(300);
      if (!reply) return sendJson(502, { error: { code: "UPSTREAM_ERROR" } });
      return sendJson(200, { id: "scripted", choices: [{ message: { role: "assistant", content: JSON.stringify(reply) } }] });
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
const browser = await puppeteer.launch({ executablePath: exe, headless: "new", args: ["--no-sandbox", "--hide-scrollbars"] });
const page = await browser.newPage();
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1 };
// No isMobile/hasTouch: puppeteer reloads the page when those change, and the preview keeps no chat across a reload.
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2 };
await page.setViewport(DESKTOP);
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
    const els = [...document.querySelectorAll("button, a, summary")].filter((e) => !e.disabled);
    const exact = els.find((e) => (e.textContent ?? "").trim() === lab);
    const el = exact ?? els.filter((e) => (e.textContent ?? "").includes(lab)).sort((a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length)[0];
    if (el) { el.click(); return true; }
    return false;
  }, label);
  await sleep(300);
  return hit;
};
const setVal = async (selector, value) => page.evaluate((sel, v) => {
  const el = document.querySelector(sel); if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, selector, value);
const scrollTo = (selector) => page.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.scrollIntoView({ block: "start" }); return !!el; }, selector);
const scrollToText = (text) => page.evaluate((t) => {
  const el = [...document.querySelectorAll("h1, h2, h3, p, li, button, article, section")].find((e) => (e.textContent ?? "").trim().startsWith(t));
  if (el) el.scrollIntoView({ block: "center" }); return !!el;
}, text);
const top = () => page.evaluate(() => window.scrollTo(0, 0));

const shots = [];
/** One picture: the viewport only, checked for the copy it must show, with its innerText kept beside it. */
const shoot = async (name, mustShow) => {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await sleep(400);
  const t = await body();
  const missing = mustShow.filter((s) => !t.includes(s));
  const file = join(IMG, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const kb = Math.round(statSync(file).size / 1024);
  check(`${name}.png shows ${mustShow.map((s) => JSON.stringify(s)).join(", ")}`, missing.length === 0, missing.length ? `missing ${JSON.stringify(missing)}` : `${kb} KB`);
  check(`${name}.png is under 400 KB`, kb < 400, `${kb} KB`);
  if (TEXT) writeFileSync(join(TEXT, `${name}.txt`), t);
  shots.push({ name, kb });
};

try {
  // 1 · home
  await page.goto(`${APP}/#/studio`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("h1") !== null);
  await waitText("New course", 6000);
  await shoot("01-home", ["Your courses", "New course"]);

  // 2 · wizard: course and learners
  await clickBy("New course");
  await waitText("Let’s set up your course", 8000);
  await clickBy("Begin");
  await waitText("Your course and learners", 5000);
  const f = 'form[aria-label="Course and learners"] input';
  await page.type(`${f}[placeholder="How plants eat"]`, COURSE.title);
  await page.type(`${f}[placeholder="Ms. Lovelace"]`, COURSE.teacher);
  await page.type(`${f}[placeholder="How plants make food from sunlight"]`, COURSE.topic);
  await page.type(`${f}[placeholder="Grade 4 science, ages 9–10"]`, COURSE.audience);
  await shoot("02-wizard-course", ["Your course and learners"]);

  // 3 · wizard: sources (a pasted page of lesson notes)
  await clickBy("Continue");
  await waitText("Drop files here", 5000);
  await setVal('section[aria-label="Sources"] textarea', SOURCE);
  await sleep(200);
  await clickBy("Add text");
  await waitText("Read in this tab", 4000);
  await shoot("03-wizard-sources", ["Fractions on a number line: lesson notes", "Read in this tab"]);

  // 4 · wizard: your objectives (with a source and nothing written, Silicus proposing is already chosen; the
  // teacher writes their own on the Objectives step, where it lands in the document straight away)
  await clickBy("Continue");
  await waitText("Let Silicus propose objectives from my sources", 5000);
  const box = await page.evaluate(() => {
    const c = document.querySelector('section[aria-label="Your objectives"] input[type="checkbox"]');
    if (c && !c.checked) c.click();
    return c?.checked ?? null;
  });
  check("the teacher asks Silicus to propose from the source", box === true);
  await shoot("04-wizard-objectives", ["Let Silicus propose objectives from my sources"]);

  // 5 · wizard: AI check, then the review the teacher confirms
  await clickBy("Continue");
  check("the AI check reads ready (scripted worker, no passcode)", await waitText("AI drafting is ready.", 6000));
  await clickBy("Continue");
  await waitText("Review and confirm", 5000);
  // the confirm button sits below the fold at 900: bring the bottom of the card into view
  await page.evaluate(() => { const b = [...document.querySelectorAll('button[data-primary="true"]')].find((e) => /Confirm and/.test(e.textContent ?? "")); b?.scrollIntoView({ block: "end" }); window.scrollBy(0, 40); });
  await shoot("05-wizard-review", ["Review and confirm", COURSE.title, COURSE.teacher, "Silicus proposes objectives from 1 source", "Confirm and propose objectives"]);

  // 6 · objectives: proposals from the source, each saying where it came from, beside the teacher's own
  await clickBy("Confirm and propose objectives");
  await page.waitForFunction(() => /^#\/studio\/(?!new$)./.test(location.hash), { timeout: 8000 });
  check("proposals arrive from the source, each saying where it came from", await waitText("From material:", 30000) && /Not yours until you accept/.test(await body()));
  await sleep(600);
  // the teacher writes one of their own while the proposals wait
  await setVal('input[placeholder="Students can…"]', OWN);
  await sleep(300);
  await clickBy("Add");
  check("the teacher's own objective lands in the document", await waitText("label the tick marks", 6000));
  await sleep(400);
  await top();
  await shoot("06-objectives-proposals", ["From material:", "Not yours until you accept", "label the tick marks"]);

  // the teacher accepts the three proposals, then confirms the objectives
  for (let i = 0; i < 6 && await page.evaluate(() => document.querySelectorAll('aside[aria-label="Proposals"] article').length) > 0; i++) {
    await clickBy("Accept"); await sleep(400);
  }
  await sleep(400);
  check("every proposal is decided and Confirm objectives is offered", await page.evaluate(() => [...document.querySelectorAll('button[data-primary="true"]')].some((b) => b.textContent.trim() === "Confirm objectives" && !b.disabled)));
  await clickBy("Confirm objectives");
  check("confirming the objectives moves to the plan", await waitText("Draft the lesson plan", 6000));

  // 7 · the lesson plan, drafted by the worker, waiting for the teacher's confirm
  await clickBy("Draft the lesson plan");
  check("the plan is drafted", await waitText("Confirm the lesson plan", 15000));
  await sleep(500);
  await top();
  await shoot("07-lesson-plan", ["Partition One", "Place Unit Fractions", "Confirm the lesson plan"]);

  // 8 · publish (a second, explicit confirm), then the published moment
  await clickBy("Confirm the lesson plan");
  await waitText("Review and publish", 10000);
  await clickBy("Publish version 1…");
  await waitText("Publish version 1?", 5000);
  await clickBy("Publish version 1");
  check("version 1 is published", await waitText("Version 1 is published", 10000));
  await sleep(500);
  await top();
  await shoot("08-published", ["Version 1 is published", "Open the student space"]);

  // 9 · the student preview: one answer with its citations, one refusal
  const id = (await page.evaluate(() => location.hash)).split("/")[2];
  await page.goto(`${APP}/#/learn/${id}`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("h1") !== null);
  const ask = async (q, expect) => {
    await setVal('input[placeholder="Ask about today’s lesson"]', q);
    await sleep(150);
    await clickBy("Ask");
    return waitText(expect, 8000);
  };
  check("the helper answers an in-course question from the published lesson", await ask("What do we do in Partition One?", "Then you label each mark"));
  await sleep(400);
  check("the helper refuses to judge a student", await ask("Did I pass the fractions quiz?", "Your teacher decides that."));
  await sleep(600);
  const learnText = await body();
  check("the refusal is on screen (no grade given)", !/you passed|you got/i.test(learnText));
  await page.evaluate(() => { const els = [...document.querySelectorAll("main *")]; const hit = els.find((e) => (e.textContent ?? "").trim().startsWith("What do we do in Partition One?")); hit?.scrollIntoView({ block: "start" }); });
  await sleep(300);
  await shoot("09-student-preview", ["Then you label each mark", "From the lesson: Activity 1: Partition One", "Your teacher decides that."]);

  // phone · the same student preview at 390 x 844
  await page.setViewport(PHONE);
  await sleep(600);
  // the chat ends the page, above the pinned composer: scroll to the end so both replies show
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(400);
  check("390: no sideways scroll", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await shoot("10-student-phone", ["Then you label each mark", "From the lesson: Activity 1: Partition One", "Your teacher decides that."]);
  await page.setViewport(DESKTOP);
} catch (e) {
  check("the walk finished without throwing", false, e.message);
  console.log("LAST BODY:", (await body().catch(() => "?")).slice(0, 600));
}

const realErrors = consoleErrors.filter((e) => !/React DevTools/.test(e));
check("no console or page errors during the walk", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
const totalKb = shots.reduce((a, s) => a + s.kb, 0);
check("the pictures total under 3 MB", totalKb < 3 * 1024, `${shots.length} pictures, ${totalKb} KB`);

console.log(`\n${pass}/${pass + fail} walkthrough checks passed; pictures in ${IMG}`);
await browser.close();
server.close();
process.exit(fail > 0 ? 1 : 0);
