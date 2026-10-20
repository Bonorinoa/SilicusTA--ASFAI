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
  await page.type(`${step1}[placeholder="How plants make food from sunlight"]`, "How plants make food from sunlight");
  check("step 1 waits for all four answers before it can continue", await page.evaluate(() => [...document.querySelectorAll('button[data-primary="true"]')].some((b) => b.disabled && b.textContent.trim() === "Continue")));
  await page.type(`${step1}[placeholder="Grade 4 science, ages 9–10"]`, "Grade 4 science, ages 9-10");
  await clickBy("Continue");
  await waitText("Drop files here", 5000);
  t = await body();
  check("the sources step is one drop zone (files, paste, web page) with no source-name field", /Drop files here/.test(t) && /Or paste text, or a web page address/.test(t)
    && await page.evaluate(() => ![...document.querySelectorAll("label")].some((l) => /^\s*(Name|Source name|Sources)\b/.test(l.textContent ?? ""))));
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
  check("the course is created with no names-only material rows", Array.isArray(created?.materials ?? []) && (created?.materials ?? []).length === 0, JSON.stringify(created?.materials));

  // ---- brief, looked back at (a wizard-made course never stops on it)
  await clickBy("Brief");
  await waitText("Step 1 of 4", 6000);
  t = await body();
  check("the Brief step renders (Step 1 of 4), looked back at", /The brief/.test(t) && /step 1 of 4/i.test(t), t.slice(0, 120));
  const nFields = await page.evaluate(() => document.querySelectorAll('section[aria-label="Questions"] input:not([type="checkbox"]), section[aria-label="Questions"] textarea').length);
  check("three question fields render, holding the wizard's answers", nFields === 3 && await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Questions"] input')].some((i) => i.value === "Grade 4 science, ages 9-10")), `found ${nFields}`);
  // ---- lane C · F5: the header's AI status opens the same diagnosis as the wizard's AI check
  await clickBy("AI needs passcode");
  check("the studio's AI status opens the wizard's diagnosis", await waitText("AI drafting on this site needs the demo passcode", 4000) && await page.evaluate(() => !!document.querySelector('dialog[aria-label="AI status"][open]')));
  await page.keyboard.press("Escape");
  await sleep(300);
  await clickBy("Objectives");
  await waitText("From your answers", 6000);

  // ---- objectives
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
  await clickBy("Confirm the lesson plan");
  check("confirming the plan moves to Publish (Step 4 of 4)", await waitText("Review and publish", 10000));

  // ---- publish
  await clickBy("Publish version 1…");
  check("publishing asks for a second, explicit confirm", await waitText("Publish version 1?", 5000));
  await clickBy("Publish version 1");
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

  // ---- lane C · R7: a second course through the wizard, proposing from a pasted source on arrival
  await page.goto(`${APP}/#/studio/new`, { waitUntil: "networkidle0" });
  check("a returning teacher's wizard opens on step 1, without the welcome", await waitText("Your course and learners", 6000) && !/Let’s set up your course/.test(await body()));
  await page.type('form[aria-label="Course and learners"] input[placeholder="How plants eat"]', "Leaves and light");
  await page.type('form[aria-label="Course and learners"] input[placeholder="Ms. Lovelace"]', "Ada Lovelace");
  await page.type('form[aria-label="Course and learners"] input[placeholder="How plants make food from sunlight"]', "Why leaves are green");
  await page.type('form[aria-label="Course and learners"] input[placeholder="Grade 4 science, ages 9–10"]', "Grade 4 science");
  await clickBy("Continue");
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
