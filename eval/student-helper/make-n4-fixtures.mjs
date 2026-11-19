/**
 * make-n4-fixtures.mjs — N4: builds the two eval courses the age modes need, through the real host routes with a
 * scripted stand-in "model" (no network, no paid call), and copies their hash-chained logs into
 * eval/fixtures/hostdata. Run once; the committed fixtures are the output. Course text is invented for the eval.
 *
 *   node eval/student-helper/make-n4-fixtures.mjs
 *
 * thermo (ages 18-25, the 18+ mode): activity 2 has AI forbidden, so it is attempt-first (an adult gets a nudge).
 * cells  (ages 13-15, the under-18 mode): activity 2 has AI forbidden, so the helper replies attempt_first.
 * It prints the two course ids; questions.json names them.
 */
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../host/server.mjs";
import { PlanWorker } from "../../host/worker.mjs";
import { startMockWorker } from "../../host/test/mock-worker.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "fixtures", "hostdata");

const COURSES = [
  {
    key: "thermo",
    title: "Thermodynamics I",
    owner: "Dr. Okafor",
    ages: { min: 18, max: 25 },
    outcomes: "Students can state the first law of thermodynamics for a closed system.\nStudents can compute the work done by a gas expanding at constant pressure.",
    plan: {
      title: "Energy, heat and work in a closed system",
      activities: [
        { title: "Energy bookkeeping", minutes: 20, learnerDoes: "Write the energy balance for a piston-cylinder: change in internal energy equals heat added minus work done by the gas.", teacherDoes: "Derive the first law on the board for a closed system and fix the sign convention.", evidenceIfAny: "observation", aiStatus: "permitted", noAiAlternative: "Use the course notes, section 2." },
        { title: "Work at constant pressure", minutes: 25, learnerDoes: "Compute the boundary work when 0.2 m3 of gas at 300 kPa expands to 0.5 m3 at constant pressure, before any help.", teacherDoes: "Walk around and wait; show the worked example only after every learner has a first answer.", evidenceIfAny: "work-product", aiStatus: "forbidden" },
        { title: "Sign check in pairs", minutes: 15, learnerDoes: "Compare answers with a partner and agree on the sign of the work and the heat.", teacherDoes: "Collect two common sign errors and discuss them.", evidenceIfAny: "observation", aiStatus: "permitted", noAiAlternative: "Use the sign table in the notes." },
      ],
    },
  },
  {
    key: "cells",
    title: "Plant and animal cells",
    owner: "Mr. Haddad",
    ages: { min: 13, max: 15 },
    outcomes: "Students can name the parts of a plant cell seen under a microscope.\nStudents can explain one difference between a plant cell and an animal cell.",
    plan: {
      title: "What a cell looks like",
      activities: [
        { title: "Cell parts tour", minutes: 15, learnerDoes: "Label the cell wall, membrane, nucleus and chloroplasts on a diagram.", teacherDoes: "Show the diagram and name each part once.", evidenceIfAny: "observation" },
        { title: "Predict the onion cell", minutes: 15, learnerDoes: "Before looking, draw what you expect an onion skin cell to look like and say which parts you will see.", teacherDoes: "Collect the drawings; do not show the slide yet.", evidenceIfAny: "work-product", aiStatus: "forbidden" },
        { title: "Microscope check", minutes: 15, learnerDoes: "Look at the onion skin slide and compare it with your drawing.", teacherDoes: "Help focus the microscopes.", evidenceIfAny: "observation" },
      ],
    },
  },
];

const byTitle = new Map(COURSES.map((c) => [c.title, c]));
let current = null;
const reply = ({ prompt }) => {
  const p = String(prompt);
  if (/COURSE PACKAGE/.test(p)) return { kind: "off_topic", basis: null, answer: "", cites: [] };
  const ids = [...p.matchAll(/^- (urn:uuid:[0-9a-f-]+):/gm)].map((m) => m[1]);
  const spec = current.plan;
  return { title: spec.title, audience: { ageRangeStart: current.ages.min, ageRangeEnd: current.ages.max },
    activities: spec.activities.map((a, i) => ({ ...a, objectiveIds: [ids[Math.min(i, ids.length - 1)]] })) };
};

const wm = await startMockWorker({ reply });
const dir = mkdtempSync(join(tmpdir(), "silicus-n4-fixtures-"));
const app = createApp({ dataDir: dir, worker: new PlanWorker({ url: wm.url, model: "scripted-fixture" }), sources: [] });
await new Promise((r) => app.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.address().port}`;
const call = async (method, p, b) => {
  const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, ...(b ? { body: JSON.stringify(b) } : {}) });
  const json = await r.json();
  if (r.status >= 400) throw new Error(`${method} ${p}: ${r.status} ${JSON.stringify(json)}`);
  return json;
};

try {
  for (const course of COURSES) {
    current = byTitle.get(course.title);
    const { courseId } = await call("POST", "/api/courses", { owner: course.owner, title: course.title, ages: course.ages });
    const c = `/api/courses/${encodeURIComponent(courseId)}`;
    await call("POST", `${c}/checkpoints`, { id: "files", text: "Confirm the material list." });
    await call("POST", `${c}/intake/answer`, { text: "all", answers: { topic: course.title, course: course.title, learning_outcomes: course.outcomes } });
    await call("POST", `${c}/checkpoints`, { id: "outline", text: "Confirm the outline." });
    const { proposals } = await call("POST", `${c}/objectives`, {});
    await call("POST", `${c}/decisions`, { decisions: proposals.map((p) => ({ verb: "accept", proposalId: p.id })), text: "Accept the objectives." });
    await call("POST", `${c}/plan`, {});
    await call("POST", `${c}/plan/confirm`, { text: "Confirm this lesson plan." });
    await call("POST", `${c}/publish`, { text: "Publish the course package." });
    const view = await call("GET", c);
    const acts = view.versions.at(-1).lessonPlan.activities.map((a) => `${a.title}=${a.aiStatus ?? "-"}`);
    console.log(`${course.key} ${courseId} ages ${course.ages.min}-${course.ages.max} activities: ${acts.join(", ")}`);
  }
  for (const name of readdirSync(dir).filter((n) => n.startsWith("urn_"))) cpSync(join(dir, name), join(FIXTURES, name), { recursive: true });
} finally {
  app.closeAllConnections?.();
  app.close();
  await wm.close();
  rmSync(dir, { recursive: true, force: true });
}
