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
const PASSCODE = "probe-passcode";
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
      if (url.pathname === "/api/fetch") {
        const u = JSON.parse(raw || "{}").url ?? "";
        globalThis.__fetches = (globalThis.__fetches ?? 0) + 1;
        if (/blocked/.test(u)) return sendJson(422, { error: { code: "URL_UNREACHABLE", message: "that link answered 403" } });
        if (/gone/.test(u)) return sendJson(422, { error: { code: "URL_UNREACHABLE", message: "that link answered 404" } });
        if (/slow/.test(u)) return sendJson(504, { error: { code: "TIMEOUT" } });
        return sendJson(200, { name: "Leaf page", text: "A leaf has a blade and a stalk. Chlorophyll makes leaves green. Plants turn light into sugar." });
      }
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

