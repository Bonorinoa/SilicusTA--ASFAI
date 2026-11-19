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
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import puppeteer from "puppeteer-core";
import { modelReply, scriptedPlanV2 } from "../../host/test/scripted-course.mjs";
let planDrafts = 0;
const REQS = [];   // N1V: every /api/worker body the browser host sent   // P2ui: the first plan draft is a v1 reply, every later one carries the v2 learning design

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
const DL = mkdtempSync(join(tmpdir(), "n1v-dl-"));
const SHOTS = process.env.N1V_SHOTS || DL;
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
      REQS.push({ at: Date.now(), task: body.task ?? null, reasoning: body.reasoning ?? null, kind: prompt.slice(0, 14), keys: Object.keys(body).sort().join(",") });
      if (prompt.startsWith("RANK")) await sleep(40000);   // N1V: a ranking that never answers in time
      if (prompt.startsWith("You are a study helper") && /hang/i.test(prompt.trim().split("\n").at(-1) ?? "")) await sleep(40000);
      let reply;
      if (prompt.startsWith("SUGGEST")) reply = { objectives: [{ statement: "Students can label the parts of a leaf." }] };
      else if (prompt.startsWith("You are a study helper")) {
        const q = (prompt.trim().split("\n").at(-1) ?? "").replace(/^Student:\s*/, "").toLowerCase();
        // K3: the model only picks a kind; the host writes the words.
        if (/your name|who are you/.test(q)) reply = { kind: "about_helper", basis: null, answer: "", cites: [] };
        // N4: a goal question rests on the objective only. The scripted v2 plan (ages 5-12) has AI forbidden in every
        // activity, so an answer resting on an activity is the host's attempt_first reply instead (checked below).
        else if (/plants need/i.test(q)) reply = { kind: "answer", basis: "plan", answer: "A plant uses light, water and air to make sugar.", cites: ["objective:1"] };
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
  const cdpS = await browser.target().createCDPSession();
  await cdpS.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
  await page.goto(`${APP}/#/studio`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("h1") !== null);
  await clickBy("New course");
  await waitText("Let’s set up your course", 8000);
  await clickBy("Begin");
  await waitText("Your course and learners", 5000);
  const step1 = 'form[aria-label="Course and learners"] input';
  await page.type(`${step1}[placeholder="How plants eat"]`, "How plants eat");
  await page.type(`${step1}[placeholder="Ms. Lovelace"]`, "Ada Lovelace");
  await page.type(`${step1}[placeholder="Why leaves stay green, and what that tells us about light"]`, "How plants make food from sunlight");
  await clickLabel("Early primary");
  await clickLabel("Youngest age: one year older");
  for (let i = 0; i < 4; i++) await clickLabel("Oldest age: one year older");
  await sleep(1500);
  await clickBy("Continue");
  // ---- map step: give the passcode so the RANK call is really made, and let the mock never answer it.
  await waitText("On the skill map", 6000);
  const tMap = Date.now();
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] input[type="password"]'), { timeout: 8000 });
  await enterPasscode();
  const sawElapsed = await page.waitForFunction(() => /\b\d+ s\b/.test(document.querySelector('section[aria-label="On the skill map"]')?.innerText ?? ""), { timeout: 20000 }).then(() => Date.now() - tMap, () => null);
  check("ITEM3 the map wait shows elapsed seconds (first seen)", sawElapsed !== null && sawElapsed >= 9000, `first seen at ${sawElapsed} ms after the rank call began (rule: after 10 s)`);
  const textAt = await page.evaluate(() => document.querySelector('section[aria-label="On the skill map"]')?.innerText ?? "");
  console.log("  map text while waiting:", JSON.stringify(textAt.slice(0, 300)));
  await shot("n1v-map-waiting-elapsed");
  const gotTimeout = await waitText("The map took too long. Search it, or skip it.", 30000);
  const tTimeout = Date.now() - tMap;
  check("ITEM3 the map ranking times out with its own words", gotTimeout, `shown ${tTimeout} ms after the call began (rule: 25 s)`);
  check("ITEM3 the ranking timeout falls between 24 s and 27 s", tTimeout >= 24000 && tTimeout <= 27500, `${tTimeout} ms`);
  await shot("n1v-map-timeout-fallback");
  await page.type("#map-search", "AI in Daily Life");
  await page.waitForFunction(() => document.querySelector('button[aria-label="Anchor here: AI in Daily Life"]'), { timeout: 15000 }).catch(() => null);
  await page.evaluate(() => document.querySelector('button[aria-label="Anchor here: AI in Daily Life"]')?.click());
  await page.waitForFunction(() => [...document.querySelectorAll('section[aria-label="On the skill map"] button[data-primary="true"]')].some((b) => !b.disabled && b.textContent.trim() === "Continue"), { timeout: 10000 });
  await clickPrimary("Continue");
  await waitText("Drop files here", 5000);
  await page.evaluate(() => document.querySelector('input[aria-label="Use the skill-map topics as a source"]')?.click());
  await sleep(200);
  await clickBy("Continue without sources");
  await waitText("Write a few", 5000);
  const TYPED = ["Explain how a plant makes its food", "Name what a plant needs to make sugar", "Compare a leaf and a root in one sentence"];
  await setVal('section[aria-label="Your objectives"] textarea', TYPED.join("\n"));
  await sleep(200);
  await clickBy("Continue");
  await sleep(1200); await enterPasscode(); await sleep(500);
  await clickPrimary("Continue");
  await waitText("Review and confirm", 6000);
  await clickPrimary("Confirm and create the course");
  await page.waitForFunction(() => /^#\/studio\/(?!new$)./.test(location.hash), { timeout: 8000 });
  await page.waitForFunction(() => /step 2 of 4/i.test(document.body.innerText), { timeout: 10000 });
  await sleep(1500);
  // ---- ITEM 1
  const props = await page.evaluate(() => [...document.querySelectorAll('aside[aria-label="Proposals"] article')].map((n) => n.innerText.replace(/\s+/g, " ").trim()));
  console.log("  proposals on the objectives page:", JSON.stringify(props));
  check("ITEM1 each typed line is a proposal on the objectives page (3 of 3, no click)", props.length >= 3 && TYPED.every((x) => props.some((p) => p.includes(x))), `${props.length} proposals`);
  check("ITEM1 the proposals are labelled as the teacher's own", props.filter((p) => TYPED.some((x) => p.includes(x))).every((p) => /from your answer/i.test(p)), props[0]?.slice(0, 100));
  check("ITEM1 there is no 'Use my answers' button", !(await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Use my answers"))));
  await shot("n1v-typed-proposals");
  // accept the second typed one, by clicking Accept inside ITS article
  const accepted = await page.evaluate((txt) => { const a = [...document.querySelectorAll('aside[aria-label="Proposals"] article')].find((n) => n.textContent.includes(txt)); const b = a && [...a.querySelectorAll("button")].find((x) => x.textContent.trim() === "Accept"); if (b) { b.click(); return true; } return false; }, TYPED[1]);
  await sleep(900);
  check("ITEM1 accepting a typed proposal puts exactly that statement in the document", accepted && /Accepted ·/.test(await body()) && (await body()).includes(TYPED[1]));
  const stored1 = (await stored()).events.sort((x, y) => x.seq - y.seq).map((e) => JSON.parse(e.line).event);
  const kinds = stored1.map((e) => e.kind);
  console.log("  event kinds so far:", JSON.stringify(kinds));
  const acc = stored1.filter((e) => /objective/.test(e.kind));
  console.log("  objective events:", JSON.stringify(acc.map((e) => ({ kind: e.kind, from: e.proposal?.source ?? e.source ?? undefined, keys: Object.keys(e).filter((k) => !["seq","at","hash","prev"].includes(k)).join(",") })).slice(0, 8)));
  // drop the two typed lines the teacher does not want (the proposal tray empties; nothing is accepted by default)
  for (let i = 0; i < 2; i++) { await clickBy("Drop"); await sleep(250); await clickBy("Drop it"); await sleep(400); }
  console.log("  proposals left after dropping two:", await page.evaluate(() => document.querySelectorAll('aside[aria-label="Proposals"] article').length));
  await clickPrimary("Confirm objectives");
  const at3 = await waitText("Step 3 of 4", 6000);
  if (!at3) console.log("  BODY at objectives confirm:", (await body()).replace(/\s+/g, " ").slice(0, 500));
  await clickPrimary("Draft the lesson plan"); await enterPasscode();
  check("drafting the plan completes", await waitText("Confirm the lesson plan", 15000));
  await clickBy("Confirm the lesson plan");
  check("confirming the plan moves to Publish", await waitText("Review and publish", 10000));
  await clickBy("Publish version 1…");
  await waitText("Publish version 1?", 5000);
  await clickBy("Publish version 1");
  check("ITEM1 version 1 is published", await waitText("Version 1 is published", 10000));
  await shot("n1v-published");
  const clickedExport = await clickBy("Export the published version");
  console.log("  export button clicked:", clickedExport);
  let file = null; for (let i = 0; i < 30 && !file; i++) { await sleep(300); file = readdirSync(DL).find((f) => f.endsWith(".json")); }
  check("ITEM1 export downloads a JSON file", !!file, file);
  const exp = file ? readFileSync(join(DL, file), "utf8") : "";
  let j = null; try { j = JSON.parse(exp); } catch {}
  const objText = JSON.stringify(j?.version?.objectives ?? j?.objectives ?? j?.plan?.objectives ?? j ?? {});
  check("ITEM1 the export is valid JSON and holds the accepted statement", !!j && exp.includes(TYPED[1]), `${exp.length} bytes`);
  check("ITEM1 the export's objectives list is exactly the one accepted statement (typed lines never accepted stay out of the published objectives)", Array.isArray(j?.objectives) && j.objectives.length === 1 && j.objectives[0].statement === TYPED[1] && j.objectives[0].confirmedByEducator === true, JSON.stringify((j?.objectives ?? []).map((o) => [o.statement, o.proposedBy])));
  console.log("  export top-level keys:", Object.keys(j ?? {}).join(","));

  // ---- ITEM 3 in the browser: the helper's wait and timeout (Rehearse)
  const id = (await page.evaluate(() => location.hash)).split("/")[2];
  await page.goto(`${APP}/#/studio/${id}/rehearse`, { waitUntil: "networkidle0" });
  await waitText("Type as a student would", 6000);
  await setComposer("Please hang on, what is a plant?");
  const tAsk = Date.now();
  await clickReal("Ask");
  const sawE2 = await page.waitForFunction(() => !!document.querySelector("[data-elapsed]") || /\b\d+ s\b/.test(document.querySelector('[aria-label="Silicus is answering"]')?.innerText ?? ""), { timeout: 20000 }).then(() => Date.now() - tAsk, () => null);
  check("ITEM3 the helper's wait shows elapsed seconds after ten", sawE2 !== null && sawE2 >= 9000, `${sawE2} ms`);
  const gotH = await waitText("That took too long. Ask again.", 25000);
  const tH = Date.now() - tAsk;
  check("ITEM3 the helper times out with its own words", gotH, `${tH} ms (rule: 20 s)`);
  check("ITEM3 the helper timeout falls between 19 s and 22 s", tH >= 19000 && tH <= 22500, `${tH} ms`);
  await shot("n1v-helper-timeout");

  // ---- the captured request bodies
  const sum = {};
  for (const r of REQS) { const k = `${r.kind.trim()} | task=${r.task} | reasoning=${JSON.stringify(r.reasoning)}`; sum[k] = (sum[k] ?? 0) + 1; }
  console.log("  browser->/api/worker bodies:", JSON.stringify(sum, null, 1));
  const rank = REQS.filter((r) => r.kind.startsWith("RANK")), help = REQS.filter((r) => r.kind.startsWith("You are a stud"));
  check("ITEM3 the browser sent the RANK call with task=rank", rank.length > 0 && rank.every((r) => r.task === "rank"), JSON.stringify(rank[0]));
  check("ITEM3 the browser sent helper calls with task=answer", help.length > 0 && help.every((r) => r.task === "answer"));
  const plans = REQS.filter((r) => r.kind.startsWith("Draft one less"));
  check("ITEM3 the plan call carries task=plan", plans.length > 0 && plans.every((r) => r.task === "plan"));
} catch (e) {
  check("the probe walk finished without throwing", false, e.stack?.split("\n").slice(0, 3).join(" | "));
  console.log("LAST BODY:", (await body().catch(() => "?")).slice(0, 500));
}
console.log(`\n${pass}/${pass + fail} N1V browser checks passed`);
await browser.close();
server.close();
process.exit(fail > 0 ? 1 : 0);
