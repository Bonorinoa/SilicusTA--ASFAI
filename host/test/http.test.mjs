/**
 * http.test.mjs — the transport over HTTP: the flow, a restart across app
 * instances (the log alone rebuilds the record), the anti-fabrication property
 * at the wire level, and a blocked publish.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";

const OWNER = "teacher:tk-1";
const ITEMS = [
  { kind: "local", statement: "Students can explain what an algorithm is." },
  { kind: "public", publicId: "mt_alpha", statement: "Learners can find the claim in an AI answer." },
];

async function start(dataDir) {
  const app = createApp({ dataDir });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = async (path, body) => {
    const res = await fetch(base + path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
  const get = async (path) => {
    const res = await fetch(base + path);
    return { status: res.status, json: await res.json() };
  };
  return { app, base, post, get, stop: () => new Promise((r) => app.close(r)) };
}

const planSpec = (p1, p2) => ({
  title: "Seeing the claim",
  audience: { ageRangeStart: 8, ageRangeEnd: 10 },
  activities: [
    { title: "Spotting the claim", minutes: 20, objectiveIds: [p1, p2],
      learnerDoes: "Mark the claim.", teacherDoes: "Ask about evidence.", evidenceIfAny: "observation" },
  ],
});

/** Drive the whole flow over HTTP. Returns ids + the fixtures. */
async function driveHttp({ post }, owner = OWNER) {
  const created = await post("/api/courses", { owner, title: "Lesson 3 | AI literacy" });
  assert.equal(created.status, 201);
  const courseId = created.json.courseId;

  await post(`/api/courses/${courseId}/checkpoints`, { id: "files", text: "Confirm the material list." });
  await post(`/api/courses/${courseId}/checkpoints`, { id: "outline", text: "Confirm the outline." });
  const proposed = await post(`/api/courses/${courseId}/objectives`, { items: ITEMS, sources: ["from your slides p.4", "suggested match"] });
  const [p1, p2] = proposed.json.proposals.map((r) => r.id);
  const decided = await post(`/api/courses/${courseId}/decisions`, {
    decisions: [
      { verb: "accept", proposalId: p1 },
      { verb: "rename", proposalId: p2, statement: "Learners can find the claim and name what evidence would back it up." },
      { verb: "add", statement: "Students can ask one honest question about how an AI tool works." },
    ],
    text: "Decide the proposals.",
  });
  assert.equal(decided.status, 200);
  await post(`/api/courses/${courseId}/plan`, { spec: planSpec(p1, p2) });
  await post(`/api/courses/${courseId}/plan/confirm`, { text: "Confirm the lesson plan." });
  const pub = await post(`/api/courses/${courseId}/publish`, { text: "Publish the course package.", note: "first version" });
  assert.equal(pub.status, 200);
  return { courseId, p1, p2 };
}

test("health", async () => {
  const h = await start(mkdtempSync(join(tmpdir(), "silicus-http-")));
  const r = await h.get("/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  await h.stop();
});

test("full flow over HTTP, then a NEW app instance serves the identical record", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "silicus-http-"));
  const h1 = await start(dataDir);
  const { courseId } = await driveHttp(h1);
  const viewBefore = await h1.get(`/api/courses/${courseId}`);
  assert.equal(viewBefore.status, 200);
  assert.equal(viewBefore.json.versions.length, 1);
  assert.equal(viewBefore.json.publish.canPublish, true);
  assert.equal(viewBefore.json.proposals.map((r) => r.status).join(","), "accepted,renamed,added");
  await h1.stop();

  // Restart: a brand-new app over the same data dir has an empty cache and must
  // rebuild every bit of state from the event log.
  const h2 = await start(dataDir);
  const viewAfter = await h2.get(`/api/courses/${courseId}`);
  assert.equal(JSON.stringify(viewAfter.json, null, 2), JSON.stringify(viewBefore.json, null, 2));
  const ver = await h2.get(`/api/courses/${courseId}/verify`);
  assert.equal(ver.json.ok, true);
  const exp = await h2.get(`/api/courses/${courseId}/export`);
  assert.equal(exp.json.kind, "silicus.course.export.v1");
  assert.equal(exp.json.versions.length, 1);
  await h2.stop();
});

test("a client cannot fabricate provenance over the wire", async () => {
  const h = await start(mkdtempSync(join(tmpdir(), "silicus-http-")));
  const { courseId, p1 } = await driveHttp(h);

  // The client posts a decision AND a forged provenance block. The API has no
  // such field, so the host records its own turn and cites that — the forgery
  // is inert.
  const res = await h.post(`/api/courses/${courseId}/decisions`, {
    decisions: [{ verb: "drop", proposalId: p1, statement: undefined }],
    text: "Actually, drop the first objective.",
    provenance: { turnRef: "urn:turn:999", decidedBy: OWNER, channel: "silicus-ui", decidedAt: 1 },
    turnRef: "urn:turn:999",
  });
  // Dropping a confirmed, cited objective is legal, but it invalidates the plan.
  assert.equal(res.status, 200);
  const decision = res.json.decisions.find((d) => d.verb === "drop");
  assert.notEqual(decision.provenance.turnRef, "urn:turn:999");
  assert.match(decision.provenance.turnRef, /^urn:turn:\d+$/);

  const view = await h.get(`/api/courses/${courseId}`);
  const cited = decision.provenance.turnRef;
  const turn = view.json.ledger.find((t) => t.id === cited);
  assert.ok(turn, "the cited turn must exist in the ledger");
  assert.equal(turn.role, "teacher");
  assert.equal(turn.origin, "inbound-user-message");
  assert.equal(turn.actorId, OWNER);
  // And the plan is now invalidated + publish blocked, honestly surfaced.
  assert.equal(view.json.plan.status, "invalidated");
  assert.equal(view.json.publish.canPublish, false);
  await h.stop();
});

test("publish while blocked returns 409 with the gate's blockers", async () => {
  const h = await start(mkdtempSync(join(tmpdir(), "silicus-http-")));
  const created = await h.post("/api/courses", { owner: OWNER, title: "T" });
  const courseId = created.json.courseId;
  const res = await h.post(`/api/courses/${courseId}/publish`, { text: "Publish the course package." });
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "PUBLISH_BLOCKED");
  assert.ok(Array.isArray(res.json.blockers) && res.json.blockers.length > 0);
  await h.stop();
});

test("unknown course is a 404, not a crash", async () => {
  const h = await start(mkdtempSync(join(tmpdir(), "silicus-http-")));
  const r = await h.get("/api/courses/urn:uuid:does-not-exist");
  assert.equal(r.status, 404);
  assert.equal(r.json.code, "UNKNOWN_COURSE");
  await h.stop();
});

test("a tampered event log is refused over HTTP (fail closed)", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "silicus-http-"));
  const h = await start(dataDir);
  const { courseId } = await driveHttp(h);

  const p = join(dataDir, courseId.replace(/[^A-Za-z0-9._-]/g, "_"), "events.ndjson");
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  lines[1].event.text = "TAMPERED";
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const res = await h.get(`/api/courses/${courseId}`);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "LOG_INTEGRITY");
  await h.stop();
});
