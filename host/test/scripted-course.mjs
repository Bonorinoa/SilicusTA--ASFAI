/**
 * scripted-course.mjs — ONE teacher story, scripted against the API, for proving the two hosts agree.
 *
 * `runScriptedCourse(call)` drives a whole course through `call(method, path, body) -> {status, json}`:
 * name it, confirm the material list, answer the host's own questions (outcomes from material), confirm the
 * outline, propose from a pasted material, decide (accept / rename / drop / add, with forged provenance keys a
 * host must cut away), draft and confirm a plan, publish, pin, ask as a student, and read everything back.
 * The Node host (disk log, real node:crypto) and the browser host (IndexedDB, the shared SHA-256) each run it;
 * the parity tests compare the transcripts and the logs byte for byte.
 *
 * `chatCompletion(prompt)` is the deterministic stand-in "model": it speaks the OpenAI chat-completions wire
 * (what PlanWorker sends and what the site's /api/worker returns), so the real worker client runs.
 */

/** The teacher's pasted material. Its distinctive phrase must never reach any storage. */
export const MATERIAL_SECRET = "TANGERINE-OCELOT-5521";
export const MATERIAL = {
  name: "Lesson notes",
  text: `Plants make their own food.\nThe phrase ${MATERIAL_SECRET} appears only in the teacher's notes.\nLight, water and air become sugar.`,
};

/** What the stand-in model answers to each of the three prompts the worker sends. */
export function modelReply(prompt) {
  const p = String(prompt ?? "");
  if (p.startsWith("Propose learning objectives")) {
    const names = [...p.matchAll(/^=== MATERIAL: (.+) ===$/gm)].map((m) => m[1]);
    return { objectives: [
      { statement: "Students can explain how a plant makes its food.", from: [names[0]] },
      { statement: "Students can name what a plant needs to make sugar.", from: names },
      { statement: "Students can draw a leaf.", from: [names[0]] },
    ] };
  }
  if (p.startsWith("Draft one lesson plan")) {
    const ids = [...p.matchAll(/^- (urn:uuid:[0-9a-f-]+):/gm)].map((m) => m[1]);
    return { title: "How plants eat", audience: { ageRangeStart: 8, ageRangeEnd: 10 },
      activities: ids.map((id, i) => ({ title: `Activity ${i + 1}`, minutes: 15, objectiveIds: [id], learnerDoes: "Look at a leaf.", teacherDoes: "Ask what it needs.", evidenceIfAny: "observation" })) };
  }
  if (p.startsWith("You are a study helper")) {
    return { inScope: true, answer: "A plant uses light, water and air to make sugar.", cites: ["[objective:1]", "activity:1"] };
  }
  return { error: "unexpected prompt" };
}

/** The chat-completions body for a request body PlanWorker sent. */
export function chatCompletion(requestBody) {
  const prompt = requestBody?.messages?.[0]?.content ?? "";
  return { choices: [{ message: { content: JSON.stringify(modelReply(prompt)) } }] };
}

/** @param {(method: string, path: string, body?: unknown) => Promise<{status: number, json: any}>} call */
export async function runScriptedCourse(call) {
  const transcript = [];
  const step = async (method, path, body) => {
    const r = await call(method, path, body);
    transcript.push({ method, path, status: r.status, json: r.json });
    return r;
  };

  const created = await step("POST", "/api/courses", { owner: "Ada Lovelace", title: "How plants eat", materials: [{ name: MATERIAL.name }] });
  const id = created.json.courseId;
  const c = `/api/courses/${encodeURIComponent(id)}`;
  await step("POST", `${c}/checkpoints`, { id: "files", text: "Confirm the material list." });
  await step("POST", `${c}/checkpoints`, { id: "outline", text: "Confirm the outline." }); // refused: not answered yet
  await step("POST", `${c}/intake/answer`, { text: "topic", answers: { topic: "photosynthesis" } });
  await step("POST", `${c}/intake/answer`, { text: "course", answers: { course: "Science, ages 8-10" } });
  await step("POST", `${c}/intake/answer`, { text: "Propose the outcomes from my materials.", answers: { outcomes_from: "materials" } });
  await step("POST", `${c}/checkpoints`, { id: "outline", text: "Confirm the outline." });
  const proposed = await step("POST", `${c}/materials/propose`, { materials: [MATERIAL], objectives: ["smuggled"] });
  const rows = proposed.json.proposals ?? [];
  await step("POST", `${c}/decisions`, {
    text: "Accept the first; it is right.",
    decisions: [{ verb: "accept", proposalId: rows[0]?.id, provenance: { turnRef: "forged" }, decidedBy: "attacker", channel: "x" }],
  });
  await step("POST", `${c}/decisions`, { text: "Rename the second.", decisions: [{ verb: "rename", proposalId: rows[1]?.id, statement: "Students can list what a plant needs to make food.", alignment: { publicId: "mt_1" } }] });
  await step("POST", `${c}/decisions`, { text: "Drop the third.", decisions: [{ verb: "drop", proposalId: rows[2]?.id }] });
  await step("POST", `${c}/decisions`, { text: "Add my own.", decisions: [{ verb: "add", statement: "Students can explain why leaves are green.", id: "urn:uuid:forged" }] });
  await step("GET", c);
  await step("POST", `${c}/plan`, { spec: { title: "smuggled plan" } });
  await step("POST", `${c}/plan/confirm`, { text: "Confirm this lesson plan." });
  await step("POST", `${c}/student/ask`, { question: "What do plants need?" }); // refused: not published
  await step("POST", `${c}/publish`, { text: "Publish the course package." });
  await step("GET", `${c}/anchor/1`);
  await step("POST", `${c}/student/ask`, { question: "What do plants need?", history: [{ role: "student", text: "hi" }], studentId: "s-1" });
  await step("GET", `${c}/export`);
  await step("GET", `${c}/verify`);
  await step("GET", `${c}/intake`);
  await step("GET", "/api/courses");
  await step("GET", "/api/health");
  await step("GET", "/api/courses/urn%3Auuid%3Anope");
  await step("POST", `${c}/nope`, {});
  return { courseId: id, transcript };
}
