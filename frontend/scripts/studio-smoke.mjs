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
import { modelReply } from "../../host/test/scripted-course.mjs";

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
        if (/game|ignore|instructions|address|my name/.test(q)) reply = { inScope: false, basis: "plan", refusal: "off_topic", answer: "", cites: [] };
        else if (/grade|pass|how am i doing|score|mark/.test(q)) reply = { inScope: false, basis: "plan", refusal: "assessment", answer: "", cites: [] };
        else reply = modelReply(prompt);
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
const setVal = async (selector, value) => page.evaluate((sel, v) => {
  const el = document.querySelector(sel); if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, selector, value);
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

  // ---- new course
  await clickBy("New course");
  await sleep(300);
  await page.type('dialog input[placeholder="How plants eat"]', "How plants eat");
  await page.type('dialog input[placeholder="Ms. Lovelace"]', "Ada Lovelace");
  await page.type('dialog textarea[placeholder*="Photosynthesis"]', "Lesson notes\nChapter 4 slides\n" + "x".repeat(200));
  await clickBy("Create course");
  await page.waitForFunction(() => location.hash.startsWith("#/studio/"), { timeout: 8000 });
  check("creating a course opens it in the studio", /#\/studio\//.test(await page.evaluate(() => location.hash)));

  // ---- brief
  await waitText("The brief");
  await waitText("Step 1 of 4", 8000).catch(() => {});
  t = await body();
  check("the Brief step renders (Step 1 of 4)", /The brief/.test(t) && /step 1 of 4/i.test(t), t.slice(0, 120));
  check("the three questions open before the sources are confirmed", /Three questions/.test(t));
  check("a 200-character unbroken source name wraps: the Brief step does not scroll sideways", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.body.innerText.includes("x".repeat(200))));
  const nFields = await page.evaluate(() => document.querySelectorAll('section[aria-label="Questions"] input:not([type="checkbox"]), section[aria-label="Questions"] textarea').length);
  check("three question fields render", nFields === 3, `found ${nFields}`);
  await setVal('section[aria-label="Questions"] textarea', "Explain how a plant makes its food\nName what a plant needs to make sugar");
  await page.evaluate(() => {
    const ins = [...document.querySelectorAll('section[aria-label="Questions"] input:not([type="checkbox"])')];
    const set = (el, v) => { if (!el) return; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    set(ins[0], "How plants make food from sunlight"); set(ins[1], "Grade 4 science, ages 9-10");
  });
  await sleep(300);
  check("the brief bar offers a quiet 'Save answers' secondary beside the confirm primary", /Save answers/.test(await body()));
  // One click does the whole brief: confirm the source list (files), record the answers, confirm the outline.
  await clickBy("Confirm the brief");
  check("one click confirms the sources, saves the answers and confirms the brief (Objectives, Step 2 of 4)", await waitText("From your answers", 10000));

  // ---- objectives
  await clickBy("Use my answers");
  await waitText("Proposals", 8000);
  await sleep(500);
  const cards = await page.evaluate(() => document.querySelectorAll('aside[aria-label="Proposals"] article').length);
  check("the proposals tray fills from the teacher's answers", cards >= 1, `${cards} proposal(s)`);
  // Add the teacher's own objective BEFORE deciding every proposal: once the last one is
  // decided the host auto-confirms objectives and the studio moves on (backend-asks #13).
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

  // ---- plan (needs the passcode)
  await clickBy("Draft the lesson plan");
  await enterPasscode();
  check("drafting the plan completes and shows a draft", await waitText("Confirm the lesson plan", 15000));
  await clickBy("Confirm the lesson plan");
  check("confirming the plan moves to Publish (Step 4 of 4)", await waitText("Review and publish", 10000));

  // ---- publish
  await clickBy("Publish version 1…");
  check("publishing asks for a second, explicit confirm", await waitText("Publish version 1?", 5000));
  await clickBy("Publish version 1");
  check("the published moment renders with the student and Rehearse links", await waitText("Version 1 is published", 10000) && /Open the student space/.test(await body()) && /Rehearse student questions/.test(await body()));

  // ---- rehearse
  const id = (await page.evaluate(() => location.hash)).split("/")[2];
  await page.goto(`${APP}/#/studio/${id}/rehearse`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("h1") !== null);
  await waitText("Type as a student would", 6000);
  check("Rehearse renders the simulator and the guardrail probes", /Ask what your students will ask/.test(await body()) && /Guardrail probes/.test(await body()));
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
