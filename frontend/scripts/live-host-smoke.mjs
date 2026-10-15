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
const HOST_PORT = 8787;
const APP_PORT = 5173;
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

const bodyHas = (page, t) => page.evaluate((s) => document.body.innerText.toLowerCase().includes(s.toLowerCase()), t);

// ---------------------------------------------------------------- boot both
const hostProc1 = bg(process.execPath, ["server.mjs"], {
  cwd: join(REPO, "host"),
  env: {
    ...process.env, SILICUS_HOST_DATA: DATA, SILICUS_HOST_PORT: String(HOST_PORT),
    SILICUS_ASFAI_MCP_URL: MOCK.mcpUrl, SILICUS_ASFAI_PRM_URL: MOCK.prmUrl, SILICUS_ASFAI_ALLOW_INSECURE: "1",
    SILICUS_WORKER_URL: WORKER.url, SILICUS_WORKER_MODEL: "test-model",
    SILICUS_ONTOLOGY_FILE: join(REPO, "host", "fixtures", "ontology.example.json"),
  },
});
// Bind IPv4 explicitly: `localhost` can resolve to ::1 only, and this script (and the host proxy) talk to 127.0.0.1.
bg("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(APP_PORT), "--strictPort"], { cwd: HERE });

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
  !(await bodyHas(page, "host is not reachable")) && (await bodyHas(page, "What should we call this course")));

const reply = async (text, button) => {
  await page.waitForSelector("#onboarding-reply");
  await page.evaluate((text) => {
    const el = document.querySelector("#onboarding-reply");
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await clickText(page, button);
};
await reply("Lesson 3 · AI literacy", "Record the course title");
await page.waitForFunction(() => document.body.innerText.includes("What label should your copy"));
await reply("Ada Lovelace", "Record the label");
await page.waitForFunction(() => document.body.innerText.includes("Name the materials"));
await clickText(page, "No materials");
const courseId = await poll(async () => (await listCourses())[0]?.courseId);
check("a course exists on the host after Start", typeof courseId === "string" && courseId.startsWith("urn:uuid:"));

// innerText reflects rendered text: CSS text-transform uppercases the chip labels.
await page.waitForFunction(() => document.body.innerText.toLowerCase().includes("materials"));
check("five checkpoint chips render", await bodyHas(page, "Objectives"));

// checkpoint 1
await clickText(page, "Confirm the material list");
await poll(async () => (await getView(courseId)).checkpoints.files.status === "confirmed");
check("materials confirmed IN THE HOST", true);

// checkpoint 2 — the ASFAI intake round, now driven BY THE HOST. The teacher's consent click is played
// by the mock issuer; everything after it goes through the real UI.
const unconnected = await post(`/api/courses/${courseId}/intake/call`, {});
check("before consent the host refuses to call ASFAI (401 AUTH_REQUIRED)", unconnected.status === 401 && unconnected.json.code === "AUTH_REQUIRED");
const conn = await post("/api/asfai/connect", {});
const consent = MOCK.consent(conn.json.authorizeUrl);
const cbRes = await fetch(`${HOST}/api/asfai/callback?code=${consent.code}&state=${consent.state}`);
check("ASFAI consent completes through the host's own callback", cbRes.status === 200);
await page.reload({ waitUntil: "networkidle0" });
// Sprint 5: the host's own questions were already on screen; connected ASFAI is the RECOMMENDED upgrade.
await poll(async () => await bodyHas(page, "Use ASFAI's questionnaire"));
check("connected: ASFAI is recommended, and the host's own questions are live beside it",
  (await bodyHas(page, "Recommended:")) && (await page.evaluate(() => !!document.querySelector("#intake-topic"))));
await clickText(page, "Use ASFAI's questionnaire");
await poll(async () => (await getView(courseId)).intake.questionsFrom === "asfai");
await poll(() => page.evaluate(() => !!document.querySelector('section[aria-label="ASFAI course intake"]')));
check("the host called ASFAI and its questions surface in the UI, attributed to ASFAI", true);

const premature = await post(`/api/courses/${courseId}/checkpoints`, { id: "outline", text: "Confirm the outline." });
check(
  "an outline confirm is refused before the teacher answers",
  premature.status === 409 && premature.json.code === "MISSING_DRAFT_AUTHORIZATION",
  `status=${premature.status} code=${premature.json.code}`,
);
const rushed = await post(`/api/courses/${courseId}/intake/call`, {});
check("the host cannot ask ASFAI again before the teacher answers", rushed.status === 409 && rushed.json.code === "AWAITING_TEACHER_REPLY");

const fill = (id, text) => page.evaluate((id, text) => {
  const ta = document.querySelector(`#intake-${id}`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, text);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}, id, text);
await fill("topic", "how AI answers are built");
await clickText(page, "Record this answer");
await poll(() => page.evaluate(() => !!document.querySelector("#intake-course")));
await fill("course", "AI literacy, ages 8-10");
await clickText(page, "Record this answer");
await poll(() => page.evaluate(() => !!document.querySelector("#intake-learning_outcomes")));
await fill("learning_outcomes", "Students can explain what an algorithm is.\nLearners can find the claim in an AI answer.");
await clickText(page, "Record this answer");
await poll(async () => (await getView(courseId)).intake.roundAnswered === true);
check("the teacher's answers are recorded on the host and arm the round", true);

await poll(async () => await bodyHas(page, "Send your answers to ASFAI"));
await clickText(page, "Send your answers to ASFAI");
await poll(async () => (await getView(courseId)).intake.outlineAuthorized === true);
const sent = (MOCK.st.toolArgs ?? []).filter((a) => a.action === "prepare_outline").at(-1).payload;
check("ASFAI received exactly the teacher's words", sent.topic === "how AI answers are built" && sent.learningOutcomes.length === 2, JSON.stringify(Object.keys(sent)));
await page.reload({ waitUntil: "networkidle0" });
await poll(async () => await bodyHas(page, "Confirm the outline"));
await clickText(page, "Confirm the outline");
await poll(async () => (await getView(courseId)).checkpoints.outline.status === "confirmed");
check("outline confirmed IN THE HOST after the real intake round", true);

// AI proposes (no teacher turn required)
await poll(async () => await bodyHas(page, "Propose objectives from your answers"));
await clickText(page, "Propose objectives from your answers");
await poll(async () => (await getView(courseId)).proposals.length === 2);
check("the host proposed 2 objectives, one per recorded outcome line", true);

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
check("one teacher decision recorded per derived objective", decided.decisions.length === 2, `decisions=${decided.decisions.length}`);
check("objectives checkpoint auto-confirmed", decided.checkpoints.objectives.status === "confirmed");
check("every decision cites a real teacher turn",
  decided.decisions.every((d) => d.provenance && /^urn:turn:\d+$/.test(d.provenance.turnRef)));

// AI drafts the plan
await poll(async () => await bodyHas(page, "Draft the plan from your confirmed objectives"));
await clickText(page, "Draft the plan from your confirmed objectives");
await poll(async () => (await getView(courseId)).plan?.status === "draft");
check("plan drafted on the host", true);
await poll(async () => await bodyHas(page, "Seeing the claim: how AI answers are built"));
check("PlanCard renders the host's plan", true);
await poll(() => page.evaluate(() => !!document.querySelector('section[aria-label="Suggested alignment"]')));
check("the plan shows suggested alignment from ASFAI's graph, labelled as a suggestion",
  (await bodyHas(page, "from ASFAI's skill map")) && (await bodyHas(page, "not part of the sealed package")));
check("the publish preview does NOT show the suggestions (they are not in the package)",
  await page.evaluate(() => document.querySelectorAll('section[aria-label="Suggested alignment"]').length === 1));

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


// ======================================================================================
// Phase 2 (Sprint 5): a teacher who NEVER connects ASFAI, through the real UI. A second host
// on a fresh data dir has no ASFAI tokens at all; the mock counts every request that reaches it.
// ======================================================================================
await new Promise((r) => { hostProc1.once("exit", r); hostProc1.kill("SIGTERM"); });
const DATA2 = mkdtempSync(join(tmpdir(), "silicus-live2-"));
bg(process.execPath, ["server.mjs"], {
  cwd: join(REPO, "host"),
  env: {
    ...process.env, SILICUS_HOST_DATA: DATA2, SILICUS_HOST_PORT: String(HOST_PORT),
    SILICUS_ASFAI_MCP_URL: MOCK.mcpUrl, SILICUS_ASFAI_PRM_URL: MOCK.prmUrl, SILICUS_ASFAI_ALLOW_INSECURE: "1",
    SILICUS_WORKER_URL: WORKER.url, SILICUS_WORKER_MODEL: "test-model",
    SILICUS_ONTOLOGY_FILE: join(REPO, "host", "fixtures", "ontology.example.json"),
  },
});
check("local: a second host, with no ASFAI credential, is up", await waitHttp(`${HOST}/api/health`));
const asfaiRequestsBefore = MOCK.st.calls.length;
await page.goto(`${APP}/#/live`, { waitUntil: "networkidle0" });
await page.reload({ waitUntil: "networkidle0" });
await poll(async () => await bodyHas(page, "What should we call this course"));
await reply("Local only · AI literacy", "Record the course title");
await page.waitForFunction(() => document.body.innerText.includes("What label should your copy"));
await reply("Grace Hopper", "Record the label");
await page.waitForFunction(() => document.body.innerText.includes("Name the materials"));
await clickText(page, "No materials");
const course2 = await poll(async () => (await listCourses())[0]?.courseId);
await poll(async () => await bodyHas(page, "Confirm the material list"));
await clickText(page, "Confirm the material list");
await poll(async () => (await getView(course2)).checkpoints.files.status === "confirmed");

await poll(() => page.evaluate(() => !!document.querySelector('section[aria-label="Course intake"]') && !!document.querySelector("#intake-topic")));
check("local: the host's own questions are live with ASFAI unconnected, and are not attributed to ASFAI",
  (await getView(course2)).intake.questionsFrom === "local" &&
  !(await page.evaluate(() => [...document.querySelectorAll("span")].some((x) => (x.textContent ?? "").trim() === "ASFAI"))));
check("local: ASFAI is recommended, not required (Connect ASFAI is offered beside the live questions)",
  (await bodyHas(page, "Recommended:")) && (await bodyHas(page, "Connect ASFAI")) && (await bodyHas(page, "Nothing waits on it")));
const premature2 = await post(`/api/courses/${course2}/checkpoints`, { id: "outline", text: "Confirm the outline." });
check("local: the outline is refused until the teacher has answered", premature2.status === 409 && premature2.json.code === "MISSING_DRAFT_AUTHORIZATION");

await fill("topic", "how AI answers are built");
await clickText(page, "Record this answer");
await poll(() => page.evaluate(() => !!document.querySelector("#intake-course")));
await fill("course", "AI literacy, ages 8-10");
await clickText(page, "Record this answer");
await poll(() => page.evaluate(() => !!document.querySelector("#intake-learning_outcomes")));
check("local: two of three answers do not open the outline", (await getView(course2)).intake.outlineAuthorized === false);
await fill("learning_outcomes", "Students can explain what an algorithm is.\nLearners can find the claim in an AI answer.");
await clickText(page, "Record this answer");
await poll(async () => (await getView(course2)).intake.outlineAuthorized === true);
await poll(async () => await bodyHas(page, "Confirm the outline"));
await clickText(page, "Confirm the outline");
await poll(async () => (await getView(course2)).checkpoints.outline.status === "confirmed");
check("local: outline confirmed IN THE HOST on the teacher's own answers", true);

await poll(async () => await bodyHas(page, "Propose objectives from your answers"));
await clickText(page, "Propose objectives from your answers");
await poll(async () => (await getView(course2)).proposals.length === 2);
const labelled = (await getView(course2)).proposals;
check("local: proposals are the teacher's own sentences, labelled 'from your answer' (not 'to ASFAI')",
  labelled.every((p) => p.source === "from your answer") && labelled[0].statement === "Students can explain what an algorithm is.");
const decided2 = await poll(async () => {
  const v = await getView(course2);
  if (v.proposals.length > 0 && v.proposals.every((p) => p.status !== "proposed")) return v;
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") ?? "").trim().startsWith("Accept objective"));
    if (b && !b.disabled) b.click();
  });
  await sleep(400);
  return null;
}, 25000);
check("local: objectives confirmed through the gate", decided2.checkpoints.objectives.status === "confirmed");
await poll(async () => await bodyHas(page, "Draft the plan from your confirmed objectives"));
await clickText(page, "Draft the plan from your confirmed objectives");
await poll(async () => (await getView(course2)).plan?.status === "draft");
await poll(() => page.evaluate(() => !!document.querySelector('section[aria-label="Suggested alignment"]')));
check("local: the plan is aligned from the ontology file alone, with no ASFAI",
  (await bodyHas(page, "from your ontology file")) && !(await bodyHas(page, "from ASFAI's skill map")));
await poll(async () => await bodyHas(page, "Confirm the lesson plan"));
await clickText(page, "Confirm the lesson plan");
await poll(async () => (await getView(course2)).plan?.status === "confirmed");
const sealOpen2 = await poll(async () => {
  if (await page.evaluate(() => !!document.querySelector('[role="group"][aria-label^="Confirm sealing"]'))) return true;
  await page.evaluate(() => {
    const sec = document.querySelector('section[aria-label*="Course package"]');
    const armed = !!sec && /ready to seal/i.test(sec.innerText);
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith("Review & publish"));
    if (btn && armed) btn.click();
  });
  await sleep(250);
  return null;
}, 12000);
check("local: seal confirm step appears", sealOpen2 === true);
await clickText(page, "Publish version 1");
const sealed2 = await poll(async () => { const v = await getView(course2); return v.versions.length === 1 ? v : null; });
check("local: all five checkpoints confirmed and sealed with no ASFAI",
  ["files", "outline", "objectives", "plan", "publish"].every((k) => sealed2.checkpoints[k].status === "confirmed"));
check("local: the log verifies", (await get(`/api/courses/${encodeURIComponent(course2)}/verify`)).json.ok === true);
// ---- revising the published course: a labelled action that changes nothing until the teacher acts ----
await poll(async () => await bodyHas(page, "Revise this course"));
check("revise: the published course says version 1 is unchanged, and students keep reading it",
  (await bodyHas(page, "Version 1 is published and unchanged.")) && !(await bodyHas(page, "you are drafting")) && (await bodyHas(page, "A draft is never what students see")));
const eventsBeforeOpen = (await getView(course2)).integrity.events;
await clickText(page, "Revise this course");
await poll(async () => await bodyHas(page, "Revising: what has changed since version 1"));
check("revise: opening the revision tools wrote nothing to the host", (await getView(course2)).integrity.events === eventsBeforeOpen);
await clickText(page, "Add a new local objective");
await poll(() => page.evaluate(() => !!document.querySelector("#add-objective")));
await page.type("#add-objective", "Students can debug a short program.");
await clickText(page, "Add");
const drafting = await poll(async () => { const v = await getView(course2); return v.revision?.drafting ? v : null; });
check("revise: the host reads the record as drafting version 2, with the teacher's own objective added",
  drafting.revision.sealedVersion === 1 && drafting.revision.nextVersion === 2 && drafting.revision.changes.objectivesAdded[0]?.statement === "Students can debug a short program.");
await poll(async () => await bodyHas(page, "you are drafting version 2"));
check("revise: the UI says you are drafting version 2, and version 1 is still the only sealed version",
  (await bodyHas(page, "Version 1 is published and unchanged; you are drafting version 2.")) && drafting.versions.length === 1);
const sealOpenV2 = await poll(async () => {
  if (await page.evaluate(() => !!document.querySelector('[role="group"][aria-label^="Confirm sealing"]'))) return true;
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith("Review & publish"));
    if (btn) btn.click();
  });
  await sleep(250);
  return null;
}, 12000);
check("revise: the seal confirm step appears for version 2", sealOpenV2 === true);
await clickText(page, "Publish version 2");
const sealedV2 = await poll(async () => { const v = await getView(course2); return v.versions.length === 2 ? v : null; });
check("revise: version 2 is sealed by a teacher turn, linked to version 1, and version 1 is untouched",
  sealedV2.versions[1].previousVersion === 1 && sealedV2.versions[1].objectiveRefs.length === 3
    && JSON.stringify(sealedV2.versions[0]) === JSON.stringify(sealed2.versions[0])
    && sealedV2.ledger.find((t) => t.id === sealedV2.versions[1].provenance.turnRef)?.role === "teacher");
check("revise: the log still verifies and the UI now reports version 2", (await get(`/api/courses/${encodeURIComponent(course2)}/verify`)).json.ok === true
  && await poll(async () => await bodyHas(page, "Version 2 is published and unchanged.")));
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
