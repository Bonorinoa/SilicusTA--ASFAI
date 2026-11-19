/**
 * live-host-smoke.mjs — the Sprint 1 UI acceptance run, real browser + real host.
 *
 * Spawns the Silicus host (fresh temp data dir) and the built app (frontend/dist, the host-mode
 * build), then drives the STUDIO (#/studio: home -> new-course wizard -> Brief / Objectives / Plan /
 * Publish) in system Chrome through the whole one-teacher story, and after every teacher action
 * asserts the resulting state IN THE HOST (not in the DOM). Proves: the GUI is a thin client, the
 * host records the turns, and the sealed package + hash chain are real.
 *
 * Needs a host-mode build first:  (cd frontend && npx vite build)   (no VITE_SILICUS_MODE)
 *
 * Run:  node scripts/live-host-smoke.mjs      (exit 0 = pass)
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { startMockAsfai } from "../../host/test/mock-asfai.mjs";
import { startMockWorker } from "../../host/test/mock-worker.mjs";

const HERE = fileURLToPath(new URL("..", import.meta.url));      // frontend/
const REPO = join(HERE, "..");

/** A plan worker that echoes the objective ids it was handed, so the plan is genuinely citable. */
const echoingWorker = ({ prompt }) => {
  const ids = [...String(prompt).matchAll(/^- (urn:uuid:[0-9a-f-]+):/gm)].map((m) => m[1]);
  const refs = [...String(prompt).matchAll(/^- \[([a-z]+:[^\]]+)\]/gm)].map((m) => m[1]);
  return {
    title: "Seeing the claim: how AI answers are built",
    audience: { ageRangeStart: 8, ageRangeEnd: 10 },
    activities: ids.map((id, i) => ({
      title: `Activity ${i + 1}`, minutes: 20, objectiveIds: [id],
      learnerDoes: "Mark the claim.", teacherDoes: "Ask about evidence.", evidenceIfAny: "observation",
      ...(refs[i] ? { citations: [refs[i]] } : {}),
    })),
  };
};

const MOCK = await startMockAsfai();   // the host calls this over real HTTP; no network, no real teacher data
const WORKER = await startMockWorker({ reply: echoingWorker });   // the OSS plan drafter, stubbed
const DATA = mkdtempSync(join(tmpdir(), "silicus-live-"));
// K5: overridable, and refused when taken. Another worktree's host on 8787 would otherwise receive this run's writes.
const HOST_PORT = Number(process.env.SMOKE_HOST_PORT ?? 8787);
const APP_PORT = Number(process.env.SMOKE_APP_PORT ?? 5173);
for (const port of [HOST_PORT, APP_PORT]) {
  const busy = await new Promise((res) => {
    const srv = createServer().once("error", () => res(true)).once("listening", () => srv.close(() => res(false)));
    srv.listen(port, "127.0.0.1");
  });
  if (busy) { console.error(`Port ${port} is already in use. Free it, or set SMOKE_HOST_PORT / SMOKE_APP_PORT.`); process.exit(2); }
}
const HOST = `http://127.0.0.1:${HOST_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;

// The live server's clarifying questions (captured from asfai-learning 2.0.0).

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

// C1.5 helpers: the stage page marks exactly one primary action; the plan's title is the plan's text.
const primaryCount = () => page.evaluate(() => [...document.querySelectorAll('[data-primary="true"]')].filter((b) => b.offsetParent !== null).length);
/** C-a (workspace): at the two laptop sizes the stage's primary is inside the window when the stage opens (measured from the top of the page). */
const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));
const primaryInViewport = async (stage) => {
  const orig = page.viewport();
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitMs(200);
    const r = await page.evaluate(() => {
      const els = [...document.querySelectorAll('[data-primary="true"]')].filter((b) => b.offsetParent !== null);
      if (els.length === 0) return null;
      const b = els[0].getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), vh: innerHeight, vw: innerWidth, count: els.length };
    });
    check(`workspace ${w}x${h}: the ${stage} primary is inside the window when the stage opens`, !!r && r.count === 1 && r.top >= 0 && r.bottom <= r.vh && r.left >= 0 && r.right <= r.vw, JSON.stringify(r));
  }
  await page.setViewport(orig);
  await page.evaluate(() => window.scrollTo(0, 0));
};
const countIn = (t) => page.evaluate((s) => document.body.innerText.split(s).length - 1, t);
const PLAN_TITLE = "Seeing the claim: how AI answers are built";
const bodyHas = (page, t) => page.evaluate((s) => document.body.innerText.toLowerCase().includes(s.toLowerCase()), t);

// ---------------------------------------------------------------- boot both
const hostProc1 = bg(process.execPath, ["server.mjs"], {
  cwd: join(REPO, "host"),
  env: {
    ...process.env, SILICUS_HOST_DATA: DATA, SILICUS_HOST_PORT: String(HOST_PORT), SILICUS_ALLOWED_ORIGINS: APP,
    SILICUS_ASFAI_MCP_URL: MOCK.mcpUrl, SILICUS_ASFAI_PRM_URL: MOCK.prmUrl, SILICUS_ASFAI_ALLOW_INSECURE: "1",
    SILICUS_WORKER_URL: WORKER.url, SILICUS_WORKER_MODEL: "test-model",
    SILICUS_ONTOLOGY_FILE: join(REPO, "host", "fixtures", "ontology.example.json"),
  },
});
// Bind IPv4 explicitly: `localhost` can resolve to ::1 only, and this script (and the host proxy) talk to 127.0.0.1.
bg("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(APP_PORT), "--strictPort"], { cwd: HERE, env: { ...process.env, SILICUS_API_TARGET: HOST } });

check("Silicus host is up", await waitHttp(`${HOST}/api/health`));
check("built app is served", await waitHttp(`${APP}/`));

const exe = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"].find((p) => existsSync(p));
if (!exe) throw new Error("no system chrome found");

const browser = await puppeteer.launch({ executablePath: exe, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();

// D2 (design review): viewport shots of each screen at 1280x800 and 390x844, scripted worker only. Off unless
// D2_SHOTS names a folder, so a normal run is unchanged. The viewport and scroll position are restored after.
const D2_DIR = process.env.D2_SHOTS ?? null;
async function snap(name, prep) {
  if (!D2_DIR) return;
  const orig = page.viewport();
  const y = await page.evaluate(() => window.scrollY);
  for (const [width, height, deviceScaleFactor] of [[1280, 800, 1], [390, 844, 2]]) {
    await page.setViewport({ width, height, deviceScaleFactor });
    await sleep(400);
    if (prep) await page.evaluate(prep).catch(() => undefined);
    await sleep(150);
    await page.screenshot({ path: `${D2_DIR}/node-${name}-${width}.png` }).catch(() => undefined);
    await page.screenshot({ path: `${D2_DIR}/full/node-${name}-${width}.png`, fullPage: true }).catch(() => undefined);
  }
  await page.setViewport(orig);
  await sleep(250);
  await page.evaluate((y) => window.scrollTo(0, y), y);
}
await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") console.log(`[console.error] ${m.text()}`); });

// ---------------------------------------------------------------- studio helpers
const hasText = (t) => page.evaluate((s) => document.body.innerText.includes(s), t);
const waitBody = (t, ms = 10000) => poll(() => hasText(t), ms);
/** Click an enabled button/link/summary by its exact text or its aria-label (waits for it). */
const clickBtn = (label, ms = 10000) => poll(() => page.evaluate((lab) => {
  const el = [...document.querySelectorAll("button, a, summary")].find((e) =>
    !e.disabled && ((e.textContent ?? "").trim() === lab || (e.getAttribute("aria-label") ?? "").trim() === lab));
  if (!el) return false;
  el.click();
  return true;
}, label), ms);
/** Click the step's enabled primary action by its text. */
const clickPrimary = (label, ms = 10000) => poll(() => page.evaluate((lab) => {
  const el = [...document.querySelectorAll('button[data-primary="true"]')].find((e) => !e.disabled && (e.textContent ?? "").trim() === lab);
  if (!el) return false;
  el.click();
  return true;
}, label), ms);
/** React-safe value setter for an input or textarea. */
const setVal = (selector, value) => page.evaluate((sel, v) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, selector, value);
const hash = () => page.evaluate(() => location.hash);
const courseTitleOf = async (title) => (await listCourses()).find((c) => c.title === title)?.courseId;
const idFromHash = async () => decodeURIComponent((await hash()).split("/")[2] ?? "");
const verifyOk = async (id) => (await get(`/api/courses/${encodeURIComponent(id)}/verify`)).json.ok === true;
/** Open the studio's History drawer (the activity rail), run `fn` on it, close it. */
const inHistory = async (fn) => {
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /decisions? recorded|No decisions yet/.test(x.textContent ?? "")); if (b) b.click(); });
  await poll(() => page.evaluate(() => !!document.querySelector('dialog[open] li[data-actor], [role="dialog"] li[data-actor]')));
  const out = await fn();
  await page.keyboard.press("Escape");
  await poll(() => page.evaluate(() => !document.querySelector("dialog[open]")));
  return out;
};
/** Accept every proposal in the tray, one real click at a time (each accept reloads the view), until the host says none wait. */
const acceptAll = (id) => poll(async () => {
  const v = await getView(id);
  if (v.proposals.length > 0 && v.proposals.every((p) => p.status !== "proposed")) return v;
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside[aria-label="Proposals"] button')].find((x) => (x.textContent ?? "").trim() === "Accept");
    if (b && !b.disabled) b.click();
  });
  await sleep(400);
  return null;
}, 25000);
/** The new-course wizard, start to finish, as a first-run teacher: welcome -> course -> map (skipped) -> sources (none) -> objectives -> AI check -> review -> confirm. */
const rankCalls = [];
page.on("response", (r) => { if (r.url().includes("/api/knowledge/marble/rank")) rankCalls.push(r.status()); });
async function runWizard({ title, owner, goal, outcomes }) {
  await page.goto(`${APP}/#/studio/new`, { waitUntil: "networkidle0" });
  await waitBody("Let’s set up your course", 8000);
  const shoot = D2_DIR && !runWizard.shot; runWizard.shot = true;
  if (shoot) await snap("03-wizard-welcome");
  await clickBtn("Begin");
  await waitBody("Your course and learners", 8000);
  const f = 'form[aria-label="Course and learners"]';
  await page.type(`${f} input[placeholder="How plants eat"]`, title);
  await page.type(`${f} input[placeholder="Ms. Lovelace"]`, owner);
  await page.type(`${f} input[placeholder="Why leaves stay green, and what that tells us about light"]`, goal);
  await page.evaluate(() => [...document.querySelectorAll("label")].find((e) => (e.textContent ?? "").includes("Early primary"))?.click());
  if (shoot) await snap("04-wizard-1-course", () => window.scrollTo(0, 0));
  await clickPrimary("Continue");
  await waitBody("On the skill map", 8000);
  await poll(() => page.evaluate(() => !!document.querySelector('button[data-skip-map="true"]')), 20000);
  if (shoot) { await sleep(1500); await snap("05-wizard-2-map", () => window.scrollTo(0, 0)); }
  await page.evaluate(() => document.querySelector('button[data-skip-map="true"]').click());
  await waitBody("Drop files here", 8000);
  if (shoot) await snap("06-wizard-3-sources", () => window.scrollTo(0, 0));
  await clickPrimary("Continue without sources");
  await waitBody("Write a few", 8000);
  await setVal('section[aria-label="Your objectives"] textarea', outcomes);
  if (shoot) await snap("07-wizard-4-objectives", () => window.scrollTo(0, 0));
  await clickPrimary("Continue");
  await waitBody("AI drafting is ready.", 10000);
  if (shoot) await snap("08-wizard-5-ai-check", () => window.scrollTo(0, 0));
  await clickPrimary("Continue");
  await waitBody("Review and confirm", 8000);
  if (shoot) await snap("09-wizard-6-review", () => window.scrollTo(0, 0));
  await clickPrimary("Confirm and create the course");
  await page.waitForFunction(() => /^#\/studio\/(?!new$)./.test(location.hash), { timeout: 15000 });
  return await idFromHash();
}
const OUTCOMES = "Students can explain what an algorithm is.\nLearners can find the claim in an AI answer.";
/** Seal-confirm step: arm with the primary, return what holds focus, then confirm. */
async function publishThroughConfirm(version) {
  await clickPrimary(`Publish version ${version}…`);
  await waitBody(`Publish version ${version}?`, 8000);
  const focus = await page.evaluate(() => document.activeElement?.textContent?.trim());
  await clickPrimary(`Publish version ${version}`);
  return focus;
}

try {
// ---------------------------------------------------------------- Phase 1: a teacher WITH ASFAI connected
await page.goto(`${APP}/#/studio`, { waitUntil: "networkidle0" });
await page.waitForFunction(() => document.querySelector("h1") !== null);
await snap("02-studio-home");
if (D2_DIR) {
  await page.goto(`${APP}/`, { waitUntil: "networkidle0" });
  await sleep(800);
  await snap("01-landing");
  await page.goto(`${APP}/#/studio`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("h1") !== null);
}
await waitBody("Your courses");
check("studio home reaches the host (course list, not the offline notice)",
  (await hasText("New course")) && !(await bodyHas(page, "host isn’t reachable")) && !(await bodyHas(page, "isn’t reachable")));

const COURSE1 = "Lesson 3 · AI literacy";
const courseId = await runWizard({ title: COURSE1, owner: "Ada Lovelace", goal: "How AI answers are built", outcomes: OUTCOMES });
const v0 = await getView(courseId);
check("a course exists on the host after the wizard's confirm", courseId.startsWith("urn:uuid:") && (await listCourses()).length === 1 && v0.course.title === COURSE1);
check("the wizard asked the host to rank the skill map (the ranking call went to the host and was answered)", rankCalls.length >= 1 && rankCalls.every((s) => s === 200), JSON.stringify(rankCalls));
check("the lesson plan stage is not open yet: the wizard lands on Objectives", await poll(() => page.evaluate(() => /step 2 of 4/i.test(document.body.innerText)), 10000).then(() => true, () => false));
check("materials confirmed IN THE HOST (the wizard's confirm sent the source-list intent)", v0.checkpoints.files.status === "confirmed");
check("the teacher's answers are recorded on the host and arm the round",
  v0.intake.roundAnswered === true && v0.intake.outlineAuthorized === true && v0.intake.questionsFrom === "local"
    && String(v0.intake.answers.topic).includes("How AI answers are built") && [].concat(v0.intake.answers.learning_outcomes).length === 2,
  JSON.stringify({ ...v0.intake, questions: undefined }));
check("outline confirmed IN THE HOST in the same click (the wizard sends the brief's intents)", v0.checkpoints.outline.status === "confirmed");
check("the four-step stepper renders (Brief, Objectives, Plan, Publish)",
  await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Steps"] button')].map((b) => (b.textContent ?? "").replace(/^[✓\d\s]+/, "").trim()).join(",") === "Brief,Objectives,Plan,Publish"));

// ASFAI: the host's own call. The teacher's consent click is played by the mock issuer.
const unconnected = await post(`/api/courses/${courseId}/intake/call`, {});
check("before consent the host refuses to call ASFAI (401 AUTH_REQUIRED)", unconnected.status === 401 && unconnected.json.code === "AUTH_REQUIRED", `status=${unconnected.status} code=${unconnected.json.code}`);
const conn = await post("/api/asfai/connect", {});
const consent = MOCK.consent(conn.json.authorizeUrl);
const cbRes = await fetch(`${HOST}/api/asfai/callback?code=${consent.code}&state=${consent.state}`);
check("ASFAI consent completes through the host's own callback", cbRes.status === 200);

// The studio has no control that sends a course's answers to ASFAI (the host only consults ASFAI's graph for a course whose answers
// were sent), so the script sends this course's already-recorded answers through the host's own route.
const asfaiRound1 = await post(`/api/courses/${courseId}/intake/call`, {});
check("the host called ASFAI for this course and its questions are attributed to ASFAI (host record; the studio shows none of it)", asfaiRound1.status === 200 && (await getView(courseId)).intake.questionsFrom === "asfai", `status=${asfaiRound1.status}`);
const ans1 = v0.intake.answers;
const answered = await post(`/api/courses/${courseId}/intake/answer`, { text: "My answers, as recorded in the brief.", answers: { topic: ans1.topic, course: ans1.course, learning_outcomes: [].concat(ans1.learning_outcomes).join("\n") } });
const asfaiRound2 = await post(`/api/courses/${courseId}/intake/call`, {});
const sentC1 = (MOCK.st.toolArgs ?? []).filter((a) => a.action === "prepare_outline").at(-1).payload;
check("ASFAI received exactly the teacher's words", answered.status === 200 && asfaiRound2.status === 200 && sentC1.topic === ans1.topic && sentC1.learningOutcomes.length === 2,
  `answer=${answered.status} call=${asfaiRound2.status} ${JSON.stringify(Object.keys(sentC1))}`);

// The ASFAI intake round has no studio control, so its host-side claims run on a probe course through the host's HTTP API.
const probe = (await post("/api/courses", { owner: "Ada Lovelace", title: "ASFAI probe" })).json.courseId;
await post(`/api/courses/${probe}/checkpoints`, { id: "files", text: "Confirm the material list." });
const premature = await post(`/api/courses/${probe}/checkpoints`, { id: "outline", text: "Confirm the outline." });
check("an outline confirm is refused before the teacher answers", premature.status === 409 && premature.json.code === "MISSING_DRAFT_AUTHORIZATION", `status=${premature.status} code=${premature.json.code}`);
await post(`/api/courses/${probe}/intake/call`, {});
check("probe: a course with no answers gets ASFAI's questions from the host's call", (await getView(probe)).intake.questionsFrom === "asfai");
const rushed = await post(`/api/courses/${probe}/intake/call`, {});
check("the host cannot ask ASFAI again before the teacher answers", rushed.status === 409 && rushed.json.code === "AWAITING_TEACHER_REPLY");

// AI proposes (no teacher turn required), the teacher decides, the teacher confirms.
await page.goto(`${APP}/#/studio/${encodeURIComponent(courseId)}`, { waitUntil: "networkidle0" });
// N1: the wizard already turned the typed lines into proposals (the host derived them); no "Use my answers" click.
await poll(async () => (await getView(courseId)).proposals.length === 2);
check("the host proposed 2 objectives, one per recorded outcome line, with no click (N1)", !(await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Use my answers"))));
await poll(() => page.evaluate(() => document.querySelectorAll('aside[aria-label="Proposals"] article').length === 2));
check("stage: the objectives stage has exactly one primary action (Confirm objectives, held until every proposal is decided)",
  (await primaryCount()) === 1 && await page.evaluate(() => [...document.querySelectorAll('button[data-primary="true"]')].every((b) => b.textContent.trim() === "Confirm objectives" && b.disabled)), `primaries=${await primaryCount()}`);
await primaryInViewport("objectives (decided)");
await snap("12-course-objectives", () => window.scrollTo(0, 0));
const decided = await acceptAll(courseId);
check("one teacher decision recorded per derived objective", decided.decisions.length === 2, `decisions=${decided.decisions.length}`);
check("objectives are NOT confirmed by accepting: the explicit course waits for the teacher's own confirm", decided.checkpoints.objectives.status !== "confirmed");
check("every decision cites a real teacher turn", decided.decisions.every((d) => d.provenance && /^urn:turn:\d+$/.test(d.provenance.turnRef)));
await clickPrimary("Confirm objectives");
await poll(async () => (await getView(courseId)).checkpoints.objectives.status === "confirmed");
check("objectives checkpoint confirmed IN THE HOST by the teacher's own Confirm", true);

// AI drafts the plan
await waitBody("Lesson plan");
await clickPrimary("Draft the lesson plan");
await poll(async () => (await getView(courseId)).plan?.status === "draft", 20000);
check("plan drafted on the host", true);
await waitBody(PLAN_TITLE);
check("PlanCard renders the host's plan", true);
check("stage: the plan stage has exactly one primary action", await poll(async () => (await primaryCount()) === 1) === true, `primaries=${await primaryCount()}`);
await primaryInViewport("plan");
await snap("13-course-plan-view", () => window.scrollTo(0, 0));
if (D2_DIR && await page.evaluate(() => { const b = document.querySelector('button[aria-label="Edit activity 1"]'); b?.click(); return !!b; })) {
  await sleep(500);
  await snap("14-course-plan-edit", () => { document.querySelector("form[data-plan-edit-form]")?.scrollIntoView({ block: "start" }); window.scrollBy(0, -80); });
  await page.evaluate(() => [...document.querySelectorAll("form[data-plan-edit-form] button")].find((b) => b.textContent === "Cancel")?.click());
  await sleep(300);
  await page.evaluate(() => window.scrollTo(0, 0));
}
// C-a (workspace): edit the objectives from the plan and come back: two clicks, scrollY within 40 px.
{
  const orig = page.viewport();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await waitMs(200);
  const y0 = await page.evaluate(() => { const y = Math.max(0, Math.min(700, document.documentElement.scrollHeight - innerHeight - 50)); window.scrollTo(0, y); return window.scrollY; });
  await waitMs(150);
  await clickBtn("Edit objectives"); // click 1
  await poll(async () => await bodyHas(page, "Back to the current step"));
  check("workspace: 'Edit objectives' opens the objectives, with 'Back to the current step' as the one way on (no competing primary)",
    // K5 (K4-reported): the one way on is now the page's one primary, so exactly one data-primary, and it is that button.
    await page.evaluate(() => { const back = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Back to the current step"); const prim = [...document.querySelectorAll('[data-primary="true"]')]; return back.length === 1 && prim.length === 1 && prim[0] === back[0]; }));
  await clickBtn("Back to the current step"); // click 2
  await poll(async () => await bodyHas(page, "Confirm the lesson plan"));
  await waitMs(250);
  const y1 = await page.evaluate(() => window.scrollY);
  check("workspace: edit objectives from the plan and back is two clicks, with scrollY within 40 px", Math.abs(y1 - y0) <= 40, `scrollY ${y0} -> ${y1}`);
  await page.setViewport(orig);
  await page.evaluate(() => window.scrollTo(0, 0));
}
check("stage: the lesson plan's text appears exactly once on the plan stage", (await countIn(PLAN_TITLE)) === 1, `count=${await countIn(PLAN_TITLE)}`);
check("rail: a worker row names the drafting model after drafting, and ASFAI has its own lane in the local app",
  await inHistory(() => page.evaluate(() => !!document.querySelector('li[data-actor="worker"]') && [...document.querySelectorAll("[data-lane-name]")].some((x) => (x.textContent ?? "").trim() === "ASFAI"))));
await poll(() => page.evaluate(() => !!document.querySelector('section[aria-label="Suggested alignment"]')));
await page.evaluate(() => document.querySelectorAll('section[aria-label="Suggested alignment"] details').forEach((d) => { d.open = true; })); // collapsed by default; open it as a teacher would, or innerText hides it and the negative half passes vacuously
check("the plan shows suggested alignment from ASFAI's graph, labelled as a suggestion",
  (await bodyHas(page, "from ASFAI's skill map")) && (await bodyHas(page, "not part of the published version")),
  await page.evaluate(() => document.querySelector('section[aria-label="Suggested alignment"]')?.innerText.slice(0, 400)));

// teacher confirms the plan
await clickPrimary("Confirm the lesson plan");
await poll(async () => (await getView(courseId)).plan?.status === "confirmed");
check("plan confirmed IN THE HOST", true);

// publish: the host arms it, then arm -> confirm step -> publish.
const armed = await poll(async () => {
  const v = await getView(courseId);
  return v.plan?.status === "confirmed" && v.publish.canPublish ? v : null;
});
check("host arms publish once the plan is confirmed", armed.publish.canPublish === true, armed.publish.blockers.join("; ") || "no blockers");
await waitBody("Review and publish");
check("stage: the publish stage has exactly one primary action", await poll(async () => (await primaryCount()) === 1) === true, `primaries=${await primaryCount()}`);
await primaryInViewport("publish");
check("stage: the lesson plan's text appears exactly once on the publish stage", (await countIn(PLAN_TITLE)) === 1, `count=${await countIn(PLAN_TITLE)}`);
check("UI reflects the armed publish checkpoint", await poll(() => page.evaluate(() => document.body.innerText.includes("Ready.")), 8000));
check("the publish preview does NOT show the suggestions (they are not in the package)",
  await page.evaluate(() => document.querySelectorAll('section[aria-label="Suggested alignment"]').length === 0 || !document.body.innerText.includes("not part of the published version")),
  await page.evaluate(() => `sections=${document.querySelectorAll('section[aria-label="Suggested alignment"]').length}`));

await clickPrimary("Publish version 1…");
check("seal confirm step appears", await waitBody("Publish version 1?", 8000));
const focus = await page.evaluate(() => document.activeElement?.textContent?.trim());
check("seal confirm defaults to the safe choice", focus === "Keep editing", `focused=${focus}`);
await clickPrimary("Publish version 1");
const sealed = await poll(async () => {
  const v = await getView(courseId);
  return v.versions.length === 1 ? v : null;
});
check("package sealed as version 1 on the host", sealed.versions[0].version === 1);
check("all five checkpoints confirmed after publish",
  ["files", "outline", "objectives", "plan", "publish"].every((k) => sealed.checkpoints[k].status === "confirmed"));

await waitBody("Version 1 is published");
check("the published moment links to the student space and Rehearse (and offers no second publish)",
  (await hasText("Open the student space")) && (await hasText("Rehearse student questions")) && !(await hasText("Publish version 1?")));
await page.evaluate(() => [...document.querySelectorAll("a")].find((a) => a.textContent.trim() === "Open the student space")?.click());
await page.waitForFunction((id) => location.hash === `#/learn/${encodeURIComponent(id)}`, { timeout: 8000 }, courseId);
check("'Open the student space' opens the student preview, with the question box and the published title",
  await poll(() => page.evaluate(() => !!document.querySelector('input[placeholder="Ask about today’s lesson"]') && document.body.innerText.includes("Preview on this device") && document.body.innerText.includes("Lesson 3"))));
await page.goto(`${APP}/#/studio/${encodeURIComponent(courseId)}`, { waitUntil: "networkidle0" });
await waitBody("Version 1 is published");

// K5: the studio's own "Archive a verified copy" (Node host only) shows the read-back digest.
{
  const ok = await poll(() => page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Archive a verified copy" && !x.disabled);
    if (b) b.click();
    return !!b;
  }));
  check("the studio's 'Archive a verified copy' reports a read-back digest", ok === true && await poll(() => page.evaluate(() => document.body.innerText.includes("Archived and read back, digest"))));
}
await snap("17-publish-record", () => { document.querySelector('section[aria-label="Your record"]')?.scrollIntoView({ block: "start" }); window.scrollBy(0, -80); });
await snap("17b-publish-top", () => window.scrollTo(0, 0));
if (D2_DIR) {
  await page.goto(`${APP}/#/studio/${encodeURIComponent(courseId)}/rehearse`, { waitUntil: "networkidle0" });
  await sleep(1500);
  await snap("18-rehearse", () => window.scrollTo(0, 0));
  await page.goto(`${APP}/#/learn/${encodeURIComponent(courseId)}`, { waitUntil: "networkidle0" });
  await sleep(1500);
  await snap("19b-learn-top", () => window.scrollTo(0, 0));
  await page.goto(`${APP}/#/studio/${encodeURIComponent(courseId)}`, { waitUntil: "networkidle0" });
  await sleep(1500);
  await page.evaluate(() => [...document.querySelectorAll("a, button")].find((e) => (e.textContent ?? "").trim() === "Brief")?.click());
  await sleep(1200);
  await snap("11-course-brief", () => window.scrollTo(0, 0));
  await page.goto(`${APP}/#/studio/${encodeURIComponent(courseId)}`, { waitUntil: "networkidle0" });
  await waitBody("Version 1 is published");
}
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
// The studio pins on publish (useCourse publish -> pinVersion). K5: the comparison is the APP's own action, "Check my pinned
// copies" on the Publish step (studio/RecordCard.tsx -> gate/pin.ts comparePin). The script clicks it and reads the verdict.
const clickButton = (label) => page.evaluate((l) => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === l && !x.disabled);
  if (b) b.click();
  return !!b;
}, label);
const pinKey = `silicus.pin.${courseId}.1`;
const readPin = () => page.evaluate((k) => { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; }, pinKey);
const pin = await poll(readPin);
check("the sealed version is pinned on the device", pin?.version === 1 && typeof pin.versionDigest === "string" && pin.versionDigest.length > 0, `v${pin?.version}`);
check("the pin is exactly what the host says about version 1 right now", JSON.stringify((await get(`/api/courses/${encodeURIComponent(courseId)}/anchor/1`)).json.anchor?.versionDigest) === JSON.stringify(pin.versionDigest));

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
await waitBody("Version 1 is published");
const pinAfter = await readPin();
const nowAnchor = (await get(`/api/courses/${encodeURIComponent(courseId)}/anchor/1`)).json.anchor;
const clicked = await poll(() => clickButton("Check my pinned copies"));
const verdict = clicked ? await poll(() => page.evaluate(() => {
  const row = [...document.querySelectorAll("li")].find((li) => li.textContent.startsWith("Version 1") && !li.textContent.includes("Not checked yet"));
  return row ? row.textContent : null;
})) : null;
check("THE PIN CATCHES IT: the app's 'Check my pinned copies' says the record differs from the device's copy",
  clicked === true && typeof verdict === "string" && verdict.includes("Differs from the record: the record may have been changed"),
  `pinned=${String(pinAfter.versionDigest).slice(0, 10)} host=${String(nowAnchor?.versionDigest).slice(0, 10)}`);


// ======================================================================================
// Phase 2 (Sprint 5): a teacher who NEVER connects ASFAI, through the real UI. A second host
// on a fresh data dir has no ASFAI tokens at all; the mock counts every request that reaches it.
// ======================================================================================
await new Promise((r) => { hostProc1.once("exit", r); hostProc1.kill("SIGTERM"); });
const DATA2 = mkdtempSync(join(tmpdir(), "silicus-live2-"));
bg(process.execPath, ["server.mjs"], {
  cwd: join(REPO, "host"),
  env: {
    ...process.env, SILICUS_HOST_DATA: DATA2, SILICUS_HOST_PORT: String(HOST_PORT), SILICUS_ALLOWED_ORIGINS: APP,
    SILICUS_ASFAI_MCP_URL: MOCK.mcpUrl, SILICUS_ASFAI_PRM_URL: MOCK.prmUrl, SILICUS_ASFAI_ALLOW_INSECURE: "1",
    SILICUS_WORKER_URL: WORKER.url, SILICUS_WORKER_MODEL: "test-model",
    SILICUS_ONTOLOGY_FILE: join(REPO, "host", "fixtures", "ontology.example.json"),
  },
});
check("local: a second host, with no ASFAI credential, is up", await waitHttp(`${HOST}/api/health`));
const asfaiRequestsBefore = MOCK.st.calls.length;
await page.goto(`${APP}/#/studio`, { waitUntil: "networkidle0" });
await page.reload({ waitUntil: "networkidle0" });
await waitBody("Your courses");

const COURSE2 = "Local only · AI literacy";
const course2 = await runWizard({ title: COURSE2, owner: "Grace Hopper", goal: "How AI answers are built", outcomes: OUTCOMES });
const w2 = await poll(async () => { const v = await getView(course2); return v.checkpoints.outline.status === "confirmed" ? v : null; });
check("local: the host's own questions are live with ASFAI unconnected, and are not attributed to ASFAI",
  w2.intake.questionsFrom === "local" && w2.intake.questions.length === 3);
check("local: the teacher's own answers opened the outline, and it is confirmed IN THE HOST",
  w2.intake.outlineAuthorized === true && w2.checkpoints.files.status === "confirmed" && w2.checkpoints.outline.status === "confirmed");

// Probe: the host's refusals on a course whose teacher has not answered (the wizard answers in one go, so these run via the API).
const probe2 = (await post("/api/courses", { owner: "Grace Hopper", title: "Local probe" })).json.courseId;
await post(`/api/courses/${probe2}/checkpoints`, { id: "files", text: "Confirm the material list." });
const premature2 = await post(`/api/courses/${probe2}/checkpoints`, { id: "outline", text: "Confirm the outline." });
check("local: the outline is refused until the teacher has answered", premature2.status === 409 && premature2.json.code === "MISSING_DRAFT_AUTHORIZATION");
await post(`/api/courses/${probe2}/intake/answer`, { text: "two", answers: { topic: "how AI answers are built", course: "AI literacy, ages 8-10" } });
check("local: two of three answers do not open the outline", (await getView(probe2)).intake.outlineAuthorized === false);
await post(`/api/courses/${probe2}/intake/answer`, { text: "three", answers: { learning_outcomes: "Students can explain what an algorithm is." } });
check("local: the third answer opens the outline", (await getView(probe2)).intake.outlineAuthorized === true);

await page.goto(`${APP}/#/studio/${encodeURIComponent(course2)}`, { waitUntil: "networkidle0" });
await poll(async () => (await getView(course2)).proposals.length === 2);
const labelled = (await getView(course2)).proposals;
check("local: proposals are the teacher's own sentences, labelled 'from your answer' (not 'to ASFAI')",
  labelled.every((p) => p.source === "from your answer") && labelled[0].statement === "Students can explain what an algorithm is.");
const decided2 = await acceptAll(course2);
await clickPrimary("Confirm objectives");
const confirmed2 = await poll(async () => { const v = await getView(course2); return v.checkpoints.objectives.status === "confirmed" ? v : null; });
check("local: objectives confirmed through the gate", confirmed2.checkpoints.objectives.status === "confirmed" && decided2.decisions.length === 2);
await waitBody("Lesson plan");
await clickPrimary("Draft the lesson plan");
await poll(async () => (await getView(course2)).plan?.status === "draft", 20000);
await poll(() => page.evaluate(() => !!document.querySelector('section[aria-label="Suggested alignment"]')));
check("rail (local): a worker row names the drafting model after drafting, and no ASFAI step is shown that never happened",
  await inHistory(() => page.evaluate(() => !!document.querySelector('li[data-actor="worker"]') && !document.querySelector('li[data-actor="asfai"]'))));
await page.evaluate(() => document.querySelectorAll('section[aria-label="Suggested alignment"] details').forEach((d) => { d.open = true; }));
check("local: the plan is aligned from the ontology file alone, with no ASFAI",
  (await bodyHas(page, "from your ontology file")) && !(await bodyHas(page, "from ASFAI's skill map")));
await clickPrimary("Confirm the lesson plan");
await poll(async () => (await getView(course2)).plan?.status === "confirmed");
await waitBody("Review and publish");
const focus2 = await publishThroughConfirm(1).catch(() => null);
check("local: seal confirm step appears", focus2 === "Keep editing", `focused=${focus2}`);
const sealed2 = await poll(async () => { const v = await getView(course2); return v.versions.length === 1 ? v : null; });
check("local: all five checkpoints confirmed and sealed with no ASFAI",
  ["files", "outline", "objectives", "plan", "publish"].every((k) => sealed2.checkpoints[k].status === "confirmed"));
check("local: the log verifies", await verifyOk(course2));

// ---- revising the published course: a labelled action that changes nothing until the teacher acts ----
await waitBody("Version 1 is published");
check("revise: the published course says version 1 is unchanged, and students keep reading it",
  (await hasText("Students keep seeing version 1 until then.")) && (await hasText("It can’t change; your next edits become version 2.")) && !(await hasText("Publish version 2")));
const eventsBeforeOpen = (await getView(course2)).integrity.events;
await clickBtn("Revise objectives");
await waitBody("Objectives confirmed.");
check("revise: opening the revision tools wrote nothing to the host", (await getView(course2)).integrity.events === eventsBeforeOpen && (await getView(course2)).revision?.drafting !== true);
// A confirmed set has no 'add' control in the studio, so the teacher's add goes to the host's own decisions route.
const addRes = await post(`/api/courses/${course2}/decisions`, { decisions: [{ verb: "add", statement: "Students can debug a short program." }], text: "Add a new local objective." });
check("revise: the host accepts the teacher's own added objective on the published course", addRes.status === 200, `status=${addRes.status}`);
const drafting = await poll(async () => { const v = await getView(course2); return v.revision?.drafting ? v : null; });
check("revise: the host reads the record as drafting version 2, with the teacher's own objective added",
  drafting.revision.sealedVersion === 1 && drafting.revision.nextVersion === 2 && drafting.revision.changes.objectivesAdded[0]?.statement === "Students can debug a short program.");
await page.reload({ waitUntil: "networkidle0" });   // the API add happened behind the page's back
await page.evaluate((id) => { location.hash = `#/studio/${encodeURIComponent(id)}`; }, course2);
await waitBody("Publish version 2");
// N5 C6 (N1V): N2 saw no "Revising this course" note here. Cause: the studio is on the PUBLISH step at this point, and
// K5 renders the note on every step except publish (CourseStudio.tsx, `shown !== "publish"`); the publish card lists
// the changes itself. Not a Node-host difference. Check both halves: absent on publish, present one step back.
check("N5 C6 on the publish step the revision note is not shown (K5 hides it there; the publish card lists the changes)",
  !(await page.evaluate(() => !!document.querySelector('section[aria-label="Revising this course"]'))));
{
  const back = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /^← Back to /.test(x.textContent ?? "")); b?.click(); return b?.textContent ?? null; });
  await sleep(600);
  const orig = page.viewport();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await sleep(400);
  const m = await page.evaluate(() => {
    const card = document.querySelector('section[aria-label="Revising this course"]');
    const btn = card && [...card.querySelectorAll("button")].find((x) => /Draft a new lesson plan/.test(x.textContent ?? ""));
    return { card: !!card, text: card?.textContent?.slice(0, 120) ?? null, btn: !!btn, cardRight: card?.getBoundingClientRect().right ?? null, btnRight: btn?.getBoundingClientRect().right ?? null, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  });
  check("N5 C6 one step back, the Node host shows the 'Revising this course' note after the api add, and at 390 px it fits (any button inside its card, no sideways scroll)",
    back !== null && m.card && (!m.btn || m.btnRight <= m.cardRight + 0.5) && m.sw <= m.cw, JSON.stringify({ back, ...m }));
  await page.setViewport(orig);
  // Return to where the flow was: a fresh load lands on the current (publish) step again.
  await page.reload({ waitUntil: "networkidle0" });
  await page.evaluate((id) => { location.hash = `#/studio/${encodeURIComponent(id)}`; }, course2);
  await waitBody("Publish version 2");
}
check("revise: while drafting, the page lists what changed since version 1 and offers to publish version 2",
  (await hasText("Since version 1")) && (await hasText("Added: Students can debug a short program.")) && !(await hasText("Version 1 is published")));
check("revise: the UI says you are drafting version 2, and version 1 is still the only sealed version",
  (await hasText("later edits become version 3")) && drafting.versions.length === 1);
const focusV2 = await publishThroughConfirm(2);
check("revise: the seal confirm step appears for version 2", focusV2 === "Keep editing", `focused=${focusV2}`);
const sealedV2 = await poll(async () => { const v = await getView(course2); return v.versions.length === 2 ? v : null; });
check("revise: version 2 is sealed by a teacher turn, linked to version 1, and version 1 is untouched",
  sealedV2.versions[1].previousVersion === 1 && sealedV2.versions[1].objectiveRefs.length === 3
    && JSON.stringify(sealedV2.versions[0]) === JSON.stringify(sealed2.versions[0])
    && sealedV2.ledger.find((t) => t.id === sealedV2.versions[1].provenance.turnRef)?.role === "teacher");
check("revise: the log still verifies and the UI now reports version 2", await verifyOk(course2)
  && await poll(async () => await bodyHas(page, "Version 2 is published") && await hasText("your next edits become version 3")));
// ---- reword a CONFIRMED objective in place, in the browser: same id, the plan keeps citing it, v2 untouched ----
const beforeReword = await getView(course2);
const rewordTarget = beforeReword.proposals.find((r) => r.status === "accepted");
await clickBtn("Revise objectives");
await waitBody("Objectives confirmed.");
await poll(() => page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Edit wording")));
await page.evaluate(() => [...document.querySelectorAll("li[data-objective-id]")].find((li) => li.querySelector("button") && /Edit wording/.test(li.textContent))?.querySelector("button")?.click());
await poll(() => page.evaluate(() => document.activeElement?.tagName === "TEXTAREA"));
await page.evaluate((id) => {
  const li = document.querySelector(`li[data-objective-id="${id}"]`);
  if (!li?.querySelector("textarea")) throw new Error("the wording editor is not on the target objective");
}, rewordTarget.id).catch(() => null);
await page.evaluate(() => { const t = document.activeElement; t.setSelectionRange(t.value.length, t.value.length); });
await page.keyboard.type(" with one example.");
await clickBtn("Save wording");
const reworded = await poll(async () => { const v = await getView(course2); return v.decisions.some((d) => d.verb === "reword") ? v : null; });
const rwRow = reworded.proposals.find((r) => r.id === (reworded.decisions.find((d) => d.verb === "reword")?.proposalId ?? rewordTarget.id)) ?? reworded.proposals.find((r) => r.reworded);
check("reword: the UI sent a reword and the host kept the objective's id, kind and status",
  rwRow.reworded === true && rwRow.status === "accepted" && rwRow.statement.endsWith(" with one example.") && typeof rwRow.originalStatement === "string" && rwRow.statement === `${rwRow.originalStatement} with one example.`,
  JSON.stringify({ s: rwRow.statement, o: rwRow.originalStatement }));
check("reword: the plan is still confirmed and publishable, and the host says it was written from the old wording",
  reworded.plan.status === "confirmed" && reworded.publish.canPublish === true && reworded.planWording.stale === true);
check("reword: version 2 is byte-identical and the host reads the record as drafting version 3",
  JSON.stringify(reworded.versions[1]) === JSON.stringify(sealedV2.versions[1]) && reworded.revision.drafting === true && reworded.revision.nextVersion === 3
    && reworded.revision.changes.objectivesReworded.length === 1);
await poll(async () => await bodyHas(page, "Reworded by you"));
check("reword: the page says 'Reworded by you' with the original visible, and flags the plan without invalidating it",
  (await bodyHas(page, "Reworded by you")) && (await bodyHas(page, "was “")) && !(await bodyHas(page, "Why this plan is invalidated")));
await clickBtn("Back to the current step");
await waitBody("Publish version 3");
check("reword: the publish step flags the reworded objective without invalidating the plan",
  (await hasText("Reworded:")) && (await bodyHas(page, "reworded since this plan was confirmed")) && !(await hasText("Why this plan is invalidated")),
  await page.evaluate(() => `${document.body.innerText.includes("reworded since this plan was")}`));
check("reword: the log still verifies", await verifyOk(course2));
check("local: not one request reached ASFAI during the whole local story", MOCK.st.calls.length === asfaiRequestsBefore,
  `before=${asfaiRequestsBefore} after=${MOCK.st.calls.length}`);

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
MOCK.close();
console.log("\n" + results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} live acceptance checks passed`);
process.exit(failed ? 1 : 0);
