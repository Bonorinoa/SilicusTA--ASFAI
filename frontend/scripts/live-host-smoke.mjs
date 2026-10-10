/**
 * live-host-smoke.mjs — the Sprint 1 UI acceptance run, real browser + real host.
 *
 * Spawns the Silicus host (fresh temp data dir) and the built app, then drives
 * the Live course tab in system Chrome through the whole one-teacher story, and
 * after every teacher action asserts the resulting state IN THE HOST (not in the
 * DOM). Proves: the GUI is a thin client, the host records the turns, and the
 * sealed package + hash chain are real.
 *
 * Run:  node scripts/live-host-smoke.mjs      (exit 0 = pass)
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = fileURLToPath(new URL("..", import.meta.url));      // frontend/
const REPO = join(HERE, "..");
const DATA = mkdtempSync(join(tmpdir(), "silicus-live-"));
const HOST_PORT = 8787;
const APP_PORT = 5173;
const HOST = `http://127.0.0.1:${HOST_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;

// The live server's clarifying questions (captured from asfai-learning 2.0.0).
const CLARIFY = [
  { id: "topic", prompt: "What topic should this lesson cover?" },
  { id: "course", prompt: "Which course is this part of?" },
  { id: "learning_outcomes", prompt: "What should learners be able to do by the end?" },
];
const ANSWER = "Topic: how AI answers are built. Course: AI literacy, ages 8-10.";

const results = [];
const check = (name, ok, extra = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`;
  results.push(line);
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const children = [];
const killAll = () => { for (const c of children) { try { c.kill("SIGTERM"); } catch { /* gone */ } } };
process.on("exit", killAll);

function bg(cmd, args, opts) {
  const c = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  c.stderr.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  children.push(c);
  return c;
}

async function waitHttp(url, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* not up */ }
    await sleep(150);
  }
  return false;
}

async function poll(fn, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await sleep(150);
  }
  throw new Error("poll timed out");
}

const post = async (p, body) => {
  const r = await fetch(HOST + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};
const get = async (p) => {
  const r = await fetch(HOST + p);
  return { status: r.status, json: await r.json() };
};
const listCourses = async () => (await (await fetch(`${HOST}/api/courses`)).json()).courses;
const getView = async (id) => await (await fetch(`${HOST}/api/courses/${encodeURIComponent(id)}`)).json();

/** Click the first <button> whose label starts with `text`. */
const clickText = (page, text) => page.evaluate((t) => {
  // Verb buttons in the cards show a bare verb ("Accept") and carry the full
  // name in aria-label ("Accept objective: “…”"), so match either.
  const b = [...document.querySelectorAll("button")].find((x) =>
    (x.textContent ?? "").trim().startsWith(t) || (x.getAttribute("aria-label") ?? "").trim().startsWith(t));
  if (!b) throw new Error(`no button matching: ${t}`);
  b.click();
  return true;
}, text);

const bodyHas = (page, t) => page.evaluate((s) => document.body.innerText.toLowerCase().includes(s.toLowerCase()), t);

// ---------------------------------------------------------------- boot both
bg(process.execPath, ["server.mjs"], {
  cwd: join(REPO, "host"),
  env: { ...process.env, SILICUS_HOST_DATA: DATA, SILICUS_HOST_PORT: String(HOST_PORT) },
});
bg("npm", ["run", "preview", "--", "--port", String(APP_PORT), "--strictPort"], { cwd: HERE });

check("Silicus host is up", await waitHttp(`${HOST}/api/health`));
check("built app is served", await waitHttp(`${APP}/`));

const exe = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"].find((p) => existsSync(p));
if (!exe) throw new Error("no system chrome found");

const browser = await puppeteer.launch({ executablePath: exe, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") console.log(`[console.error] ${m.text()}`); });

try {
await page.goto(`${APP}/#/live`, { waitUntil: "networkidle0" });
await page.waitForFunction(() => document.querySelector("button") !== null);

check("Live tab reaches the host (not the offline notice)",
  !(await bodyHas(page, "host is not reachable")) && (await bodyHas(page, "Start a course")));

await clickText(page, "Start a course");
const courseId = await poll(async () => (await listCourses())[0]?.courseId);
check("a course exists on the host after Start", typeof courseId === "string" && courseId.startsWith("urn:uuid:"));

// innerText reflects rendered text: CSS text-transform uppercases the chip labels.
await page.waitForFunction(() => document.body.innerText.toLowerCase().includes("materials"));
check("five checkpoint chips render", await bodyHas(page, "Objectives"));

// checkpoint 1
await clickText(page, "Confirm the material list");
await poll(async () => (await getView(courseId)).checkpoints.files.status === "confirmed");
check("materials confirmed IN THE HOST", true);

// checkpoint 2 — the ASFAI intake round. The smoke plays the RUNTIME's role for the
// MCP call (it reports what a real prepare_outline returned); the teacher's answer
// goes through the UI, and only that answer unblocks the outline.
await post(`/api/courses/${courseId}/intake/observe`, { state: "clarifying", questions: CLARIFY });
// The runtime reports out of band, so the page re-reads (an operator refresh).
await page.reload({ waitUntil: "networkidle0" });
await poll(() => page.evaluate(() => document.body.innerText.includes("What topic should this lesson cover?")));
check("the intake questions surface in the UI", true);

const premature = await post(`/api/courses/${courseId}/checkpoints`, { id: "outline", text: "Confirm the outline." });
check(
  "an outline confirm is refused before the teacher answers",
  premature.status === 409 && premature.json.code === "MISSING_DRAFT_AUTHORIZATION",
  `status=${premature.status} code=${premature.json.code}`,
);

await page.evaluate((text) => {
  const ta = document.querySelector("#intake-answer");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, text);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}, ANSWER);
await clickText(page, "Send my answer");
await poll(async () => (await getView(courseId)).intake.roundAnswered === true);
check("the teacher's answer is recorded on the host and arms the round", true);

// The runtime now reports the completed intake; only then does the outline open.
const stillBlocked = await post(`/api/courses/${courseId}/intake/observe`, { state: "ready_to_draft" });
check("the intake reports ready_to_draft", stillBlocked.json.outlineAuthorized === true);
await page.reload({ waitUntil: "networkidle0" });
await poll(async () => await bodyHas(page, "Confirm the outline"));
await clickText(page, "Confirm the outline");
await poll(async () => (await getView(courseId)).checkpoints.outline.status === "confirmed");
check("outline confirmed IN THE HOST after the real intake round", true);

// AI proposes (no teacher turn required)
await poll(async () => await bodyHas(page, "Ask the assistant to propose objectives"));
await clickText(page, "Ask the assistant to propose objectives");
await poll(async () => (await getView(courseId)).proposals.length === 3);
check("assistant proposed 3 objectives on the host", true);

// teacher decides: accept every awaiting proposal through the UI. State-driven,
// because each accept triggers an async reload and re-render.
const decided = await poll(async () => {
  const v = await getView(courseId);
  if (v.proposals.length > 0 && v.proposals.every((p) => p.status !== "proposed")) return v;
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.getAttribute("aria-label") ?? "").trim().startsWith("Accept objective"));
    if (b && !b.disabled) b.click();
  });
  await sleep(400);
  return null;
}, 25000);
check("three teacher decisions recorded in the host", decided.decisions.length >= 3, `decisions=${decided.decisions.length}`);
check("objectives checkpoint auto-confirmed", decided.checkpoints.objectives.status === "confirmed");
check("every decision cites a real teacher turn",
  decided.decisions.every((d) => d.provenance && /^urn:turn:\d+$/.test(d.provenance.turnRef)));

// AI drafts the plan
await poll(async () => await bodyHas(page, "Ask the assistant to draft the lesson plan"));
await clickText(page, "Ask the assistant to draft the lesson plan");
await poll(async () => (await getView(courseId)).plan?.status === "draft");
check("plan drafted on the host", true);
await poll(async () => await bodyHas(page, "Seeing the claim: how AI answers are built"));
check("PlanCard renders the host's plan", true);

// teacher confirms the plan
await poll(async () => await bodyHas(page, "Confirm the lesson plan"));
await clickText(page, "Confirm the lesson plan");
await poll(async () => (await getView(courseId)).plan?.status === "confirmed");
check("plan confirmed IN THE HOST", true);

// teacher publishes: the host arms it, then review -> confirm step -> publish.
// `innerText` lags the async reload, so drive off the DOM + HOST state.
const armed = await poll(async () => {
  const v = await getView(courseId);
  return v.plan?.status === "confirmed" && v.publish.canPublish ? v : null;
});
check("host arms publish once the plan is confirmed", armed.publish.canPublish === true,
  armed.publish.blockers.join("; ") || "no blockers");
check("UI reflects the armed publish checkpoint",
  await poll(() => page.evaluate(() => document.body.innerText.toLowerCase().includes("ready to seal")), 8000));

// Open the seal step. State-driven: a pending reload can leave one stale
// render where the button is not yet armed, so retry while the chip is armed.
const sealOpen = await poll(async () => {
  const opened = await page.evaluate(() => !!document.querySelector('[role="group"][aria-label^="Confirm sealing"]'));
  if (opened) return true;
  await page.evaluate(() => {
    const sec = document.querySelector('section[aria-label*="Course package"]');
    const armed = !!sec && /ready to seal/i.test(sec.innerText);
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith("Review & publish"));
    if (btn && armed) btn.click();
  });
  await sleep(250);
  return null;
}, 12000);
check("seal confirm step appears", sealOpen === true);
const focus = await page.evaluate(() => document.activeElement?.textContent?.trim());
check("seal confirm defaults to the safe choice", focus === "Keep editing", `focused=${focus}`);
await clickText(page, "Publish version 1");
const sealed = await poll(async () => {
  const v = await getView(courseId);
  return v.versions.length === 1 ? v : null;
});
check("package sealed as version 1 on the host", sealed.versions[0].version === 1);
check("all five checkpoints confirmed after publish",
  ["files", "outline", "objectives", "plan", "publish"].every((k) => sealed.checkpoints[k].status === "confirmed"));

// Sprint 2a: the export archives with an atomic write + read-back verified digest.
const arch = await post(`/api/courses/${courseId}/archive`, {});
check("export archived with a verified read-back digest", arch.status === 200 && arch.json.verified === true, `digest=${String(arch.json.digest ?? "").slice(0, 12)}`);
const back = await get(`/api/courses/${courseId}/archive/${encodeURIComponent(arch.json.ref)}`);
check("the archived record reloads and re-verifies", back.json.verified === true && back.json.export.versions.length === 1);

const exp = await (await fetch(`${HOST}/api/courses/${encodeURIComponent(courseId)}/export`)).json();
check("tamper-evident export carries one sealed version", exp.versions.length === 1 && typeof exp.integrity.head === "string");
const ver = await (await fetch(`${HOST}/api/courses/${encodeURIComponent(courseId)}/verify`)).json();
check("event-log hash chain verifies", ver.ok === true, `events=${ver.events}`);

// ---- the PIN (the trust anchor): the teacher's device holds a reference the host cannot reach ----
await poll(() => page.evaluate(() => document.body.innerText.includes("Pinned on this device")));
check("the sealed version is pinned on the device", await page.evaluate(() => document.body.innerText.includes("v1")));

// Rewrite history with a SELF-CONSISTENT chain — the attack verify() cannot see.
const logFile = join(DATA, courseId.replace(/[^A-Za-z0-9._-]/g, "_"), "events.ndjson");
const recs = readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
recs.find((rec) => rec.event.kind === "objectives.proposed").event.items[0].statement =
  "Students must memorize the teacher's answers verbatim.";
let prev = "genesis";
for (let i = 0; i < recs.length; i += 1) {
  recs[i].seq = i + 1;
  recs[i].prev = prev;
  recs[i].digest = createHash("sha256").update(`${prev}\n${JSON.stringify(recs[i].event)}`).digest("hex");
  prev = recs[i].digest;
}
writeFileSync(logFile, recs.map((rec) => JSON.stringify(rec)).join("\n") + "\n");

const verAfter = await get(`/api/courses/${encodeURIComponent(courseId)}/verify`);
check("the host still blesses the rewritten chain (this is the ledger problem)", verAfter.json.ok === true);

await page.reload({ waitUntil: "networkidle0" });
await poll(async () => await bodyHas(page, "Check my pinned copies"));
await clickText(page, "Check my pinned copies");
await poll(() => page.evaluate(() => document.body.innerText.toLowerCase().includes("differs from what you pinned")));
check("THE PIN CATCHES IT: the device's copy differs from the rewritten record", true);

await page.screenshot({ path: `${DATA}/live-sealed.png`, fullPage: true });
console.log(`screenshot: ${DATA}/live-sealed.png`);
} catch (err) {
  check(`flow completed without throwing`, false, err && err.message ? err.message : String(err));
  console.log(`\n[FLOW ERROR] ${err && err.message ? err.message : err}`);
  try {
    const text = await page.evaluate(() => document.body.innerText.slice(0, 900));
    console.log("[DOM DUMP]\n" + text);
  } catch { /* page gone */ }
}

await browser.close();
killAll();
console.log("\n" + results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} live acceptance checks passed`);
process.exit(failed ? 1 : 0);
