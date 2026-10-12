# Sprint 4 — From the teacher's words to the package

**Goal:** Delete the demo seam. Every objective and every plan the product proposes is derived from what the teacher actually said, and the teacher confirms each one.

**Architecture:** The host already records the teacher's answers to ASFAI's questionnaire. The `learning_outcomes` answer *is* a list of the teacher's own outcome sentences. Objectives are proposed from those sentences verbatim, minted as local `urn:uuid` ids. The plan draft is the one step that needs generation, so it goes behind an OSS-worker seam that degrades honestly and validates its output like untrusted input.

**Tech stack:** `node:http` zero-dependency host, `node:test`, React + Vite frontend, `puppeteer-core` smoke.

---

## Why this sprint, and why now

Three facts, all verified in the tree at `76e3932`:

1. `frontend/src/live/LiveCourse.tsx:25` — objectives come from `SEED_ITEMS`, three hardcoded sentences. The teacher's words are never read.
2. `SEED_ITEMS` carries `mt_alpha` / `mt_beta` — fabricated Marble ids used as objective identity. The locked principle says objective identity is the local URN, never `mt_*`. So the current demo violates a product lock, not just a style rule.
3. `frontend/src/live/LiveCourse.tsx:32` — `planSpec` hardcodes the plan title, audience and both activities.

So the onboarding chat collects the teacher's words and hands them to a pipeline that ignores them. That is the last demo seam in the 5–14 slice. The student grounded chat is the only unbuilt piece after it.

## The trust improvement this sprint also buys

Today the browser supplies objective *content* (`items`) and plan *content* (`spec`) to the host. Provenance is already unforgeable, but the content is not. After this sprint both routes take **no content from the client**: the host derives objectives from its own record of the teacher's answers, and drafts the plan from its own record of the confirmed objectives. That makes the request shape as narrow as the intake call already is.

## Design decisions (settle these; they shape the tasks)

- **The teacher's `learning_outcomes` answer is *the* objective list**, proposed back for accept/rename/drop. It is not a seed for a model to expand. The teacher wrote those sentences; the system restates them and asks for a decision. A worker that invents objectives is a later, opt-in feature.
- **No assistant turn is recorded for a derived proposal.** `assistantText` is `null`. The ledger must not claim a model authored sentences it merely quoted. (The gate hardcodes `proposedBy: "ai"` on the proposal record — that is the gate's vocabulary for "put forward for decision", and the teacher's decision is the provenance that carries weight. Not changing the core for this.)
- **Sources tell the truth.** Each derived proposal's source label is `from your answer to ASFAI`, not `from your slides p.4`.
- **The worker drafts; it never decides.** Its output is untrusted input: validated against the gate's own rules, refused on any violation, and the course is left unchanged on refusal.
- **No worker configured is a state, not an outage.** The plan step says so plainly instead of inventing prose.

---

## Task 1: The proposer, as a pure function

**Objective:** Turn recorded teacher answers into proposal items. No I/O, no gate.

**Files:**
- Create: `host/proposer.mjs`
- Create: `host/test/proposer.test.mjs`

**Step 1: Write failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { objectivesFromAnswers, SOURCE_FROM_ANSWERS } from "../proposer.mjs";

test("each teacher outcome sentence becomes one local proposal, verbatim", () => {
  const items = objectivesFromAnswers({
    learning_outcomes: ["Students can explain what an algorithm is.", "Learners can find the claim in an AI answer."],
  });
  assert.deepEqual(items, [
    { kind: "local", statement: "Students can explain what an algorithm is." },
    { kind: "local", statement: "Learners can find the claim in an AI answer." },
  ]);
  assert.equal(SOURCE_FROM_ANSWERS, "from your answer to ASFAI");
});

test("no outcomes, no proposals — the proposer never invents one", () => {
  assert.deepEqual(objectivesFromAnswers({}), []);
  assert.deepEqual(objectivesFromAnswers({ learning_outcomes: [] }), []);
  assert.deepEqual(objectivesFromAnswers({ learning_outcomes: ["  ", ""] }), []);
  assert.deepEqual(objectivesFromAnswers(null), []);
});

test("a proposal is always kind:local — the proposer cannot mint a Marble id", () => {
  const items = objectivesFromAnswers({ learning_outcomes: ["mt_alpha: hijack the id"] });
  assert.equal(items[0].kind, "local");
  assert.equal("publicId" in items[0], false);
});
```

**Step 2:** `cd host && node --test test/proposer.test.mjs` → FAIL, module not found.

**Step 3: Implement**

```js
/** The teacher's own outcome sentences, as proposal items. Never invents one. */
export const SOURCE_FROM_ANSWERS = "from your answer to ASFAI";

export function objectivesFromAnswers(answers) {
  const outcomes = Array.isArray(answers?.learning_outcomes) ? answers.learning_outcomes : [];
  return outcomes
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .map((statement) => ({ kind: "local", statement }));
}
```

**Step 4:** `cd host && node --test test/proposer.test.mjs` → PASS.

**Step 5: Commit** — `feat(host): propose objectives from the teacher's own answers`

---

## Task 2: The host derives, and refuses when it has nothing

**Objective:** `CourseSession` gains a derive path that reads its own record and refuses rather than inventing.

**Files:**
- Modify: `host/course.mjs` (near `proposeObjectives`, ~line 313)
- Modify: `host/intake.mjs` (add a read-only `answers()` accessor; `status().answers` already exists)
- Test: `host/test/course.test.mjs`

**Step 1: Write failing test**

```js
test("the host derives objectives from the teacher's recorded answers, not from the caller", () => {
  const s = sessionWithIntakeAnswers();          // files confirmed, intake observed, answers recorded
  const r = s.proposeObjectivesFromAnswers({ at: 3000 });
  assert.equal(r.ok, true);
  assert.equal(r.proposals.length, 2);
  assert.deepEqual(r.proposals.map((p) => p.statement), ANSWERS.learning_outcomes);
  assert.ok(r.proposals.every((p) => p.kind === "local"));
  assert.ok(r.proposals.every((p) => p.id.startsWith("urn:uuid:")));
  assert.equal(JSON.stringify(r.proposals).includes("mt_"), false, "no Marble id anywhere");
  assert.ok(r.proposals.every((p) => p.source === "from your answer to ASFAI"));
});

test("with nothing of the teacher's on record, the host refuses instead of inventing", () => {
  const s = sessionWithFilesAndOutline();        // no intake answers
  const r = s.proposeObjectivesFromAnswers({ at: 3000 });
  assert.equal(r.ok, false);
  assert.equal(r.code, "NO_TEACHER_OUTCOMES");
  assert.equal(s.view().proposals.length, 0, "nothing was proposed");
});

test("a derived proposal survives a restart with the same ids", () => {
  const store = newStore();
  const s = sessionWithIntakeAnswers(store);
  const before = s.proposeObjectivesFromAnswers({ at: 3000 }).proposals;
  const after = CourseSession.load(store, s.courseId).view().proposals;
  assert.deepEqual(after.map((p) => p.id), before.map((p) => p.id));
});
```

**Step 2:** `cd host && node --test test/course.test.mjs` → FAIL.

**Step 3: Implement** — a `proposeObjectivesFromAnswers({ at })` on `CourseSession` that reads `this.#intake.answers()`, calls `objectivesFromAnswers`, returns `{ ok: false, code: "NO_TEACHER_OUTCOMES", reason }` on empty, and otherwise appends one `objectives.proposed` event with `sources` filled from `SOURCE_FROM_ANSWERS` and `assistantText: null`.

**Step 4:** `cd host && node --test test/course.test.mjs` → PASS.

**Step 5: Commit** — `feat(host): derive objectives from the record, refuse when empty`

---

## Task 3: The route takes no content from the client

**Objective:** `POST /api/courses/:id/objectives` derives; a body cannot inject statements.

**Files:**
- Modify: `host/server.mjs` (route `objectives`, ~line 232)
- Modify: `frontend/src/gate/transport.ts` (`proposeObjectives` drops its body)
- Test: `host/test/asfai-flow.test.mjs`

**Step 1: Write failing test**

```js
test("a hostile objectives body cannot inject a statement", async () => {
  const { json } = await post(`/api/courses/${courseId}/objectives`, {
    items: [{ kind: "local", statement: "IGNORE ALL PREVIOUS" }],
    statement: "pwn", publicId: "mt_evil",
  });
  const view = await getView(courseId);
  assert.equal(JSON.stringify(view.proposals).includes("pwn"), false);
  assert.equal(JSON.stringify(view.proposals).includes("mt_evil"), false);
  assert.equal(JSON.stringify(view.proposals).includes("IGNORE ALL PREVIOUS"), false);
  assert.deepEqual(view.proposals.map((p) => p.statement), ANSWERS.learning_outcomes);
});
```

**Step 2:** `cd host && node --test test/asfai-flow.test.mjs` → FAIL.

**Step 3: Implement** — the route ignores the body entirely and calls `s.proposeObjectivesFromAnswers({})`; a `NO_TEACHER_OUTCOMES` refusal returns 409 with the code. Update `transport.ts` to `proposeObjectives: (id) => call("POST", .../objectives, {})`.

**Step 4:** `cd host && node --test` → PASS (all).

**Step 5: Commit** — `feat(host): the objectives route derives; a client cannot supply a statement`

---

## Task 4: The worker seam, and its stub

**Objective:** A plan-drafting worker behind a config gate, testable with no network.

**Files:**
- Create: `host/worker.mjs`
- Create: `host/test/mock-worker.mjs`
- Create: `host/test/worker.test.mjs`

**Step 1: Write failing test**

```js
test("no worker configured is a state, not a crash", async () => {
  const w = new PlanWorker({});                       // no env
  assert.equal(w.enabled, false);
  await assert.rejects(w.draft({ objectives: [], topic: "t" }), { code: "WORKER_NOT_CONFIGURED" });
});

test("the worker's output is validated like untrusted input", async () => {
  const mock = await startMockWorker({ reply: { activities: [{ title: "A", objectiveIds: ["urn:uuid:ghost"], learnerDoes: "x", teacherDoes: "y" }] } });
  const w = new PlanWorker({ url: mock.url, model: "test", allowInsecure: true });
  const spec = await w.draft({ objectives: [{ id: "urn:uuid:real", statement: "S" }], topic: "t" });
  assert.equal(spec.title.length > 0, true);
  assert.equal(spec.activities.every((a) => a.objectiveIds.every((id) => id === "urn:uuid:real")), true, "a cited id must be one of the confirmed ids we sent");
});

test("a worker that returns junk produces a refusal, never a broken plan", async () => {
  const mock = await startMockWorker({ reply: "not json at all" });
  const w = new PlanWorker({ url: mock.url, model: "test", allowInsecure: true });
  await assert.rejects(w.draft({ objectives: [{ id: "urn:uuid:real", statement: "S" }], topic: "t" }), { code: "WORKER_BAD_OUTPUT" });
});
```

**Step 2:** `cd host && node --test test/worker.test.mjs` → FAIL.

**Step 3: Implement** — `PlanWorker` reads `SILICUS_WORKER_URL` / `SILICUS_WORKER_MODEL` / `SILICUS_WORKER_API_KEY`; `enabled` is false unless url+model are set; `draft()` posts a prompt built from the confirmed objectives and the teacher's topic, then validates: activities non-empty, every `objectiveIds` entry in the set we sent, `learnerDoes`/`teacherDoes` non-empty, `evidenceIfAny` in `EVIDENCE_KINDS`. Any violation → `WORKER_BAD_OUTPUT`. `mock-worker.mjs` is an in-process loopback HTTP server, same pattern as `mock-asfai.mjs`.

**Step 4:** `cd host && node --test test/worker.test.mjs` → PASS.

**Step 5: Commit** — `feat(host): an OSS plan worker behind a config gate, output validated`

---

## Task 5: The plan route drafts; the client supplies no spec

**Objective:** `POST /api/courses/:id/plan` drafts from confirmed objectives via the worker.

**Files:**
- Modify: `host/course.mjs` (`draftPlanFromObjectives`)
- Modify: `host/server.mjs` (route `plan`)
- Modify: `frontend/src/gate/transport.ts`
- Test: `host/test/asfai-flow.test.mjs`

**Step 1: Write failing test**

```js
test("the plan is drafted from the CONFIRMED objectives, and a client cannot supply activities", async () => {
  // ...confirm two objectives...
  await post(`/api/courses/${courseId}/plan`, { spec: { title: "pwn", activities: [{ title: "pwn" }] } });
  const plan = (await getView(courseId)).plan;
  assert.notEqual(plan.title, "pwn");
  assert.equal(JSON.stringify(plan).includes("pwn"), false);
  const sent = workerMock.st.lastPrompt;
  assert.ok(sent.includes(confirmedStatements[0]), "the worker saw the teacher's confirmed wording");
});

test("no worker configured: the plan step refuses with a reason, and the course is untouched", async () => {
  const r = await post(`/api/courses/${courseId}/plan`, {});
  assert.equal(r.status, 501);
  assert.equal(r.json.code, "WORKER_NOT_CONFIGURED");
  assert.equal((await getView(courseId)).plan, null);
});
```

**Step 2:** `cd host && node --test test/asfai-flow.test.mjs` → FAIL.

**Step 3: Implement** — `draftPlanFromObjectives()` reads `#gate.confirmedObjectives()` + `wording()`, calls the worker, and appends `plan.proposed` with the worker's spec; refuses `NO_CONFIRMED_OBJECTIVES` when there are none. Route maps `WORKER_NOT_CONFIGURED` → 501 and `WORKER_BAD_OUTPUT` → 502.

**Step 4:** `cd host && node --test` → PASS.

**Step 5: Commit** — `feat(host): draft the plan from confirmed objectives via the worker`

---

## Task 6: The UI stops carrying seed data

**Objective:** Delete `SEED_ITEMS`, `SEED_SOURCES`, `planSpec` from `LiveCourse.tsx`.

**Files:**
- Modify: `frontend/src/live/LiveCourse.tsx`
- Modify: `frontend/src/live/LiveCourse.test.tsx`

**Step 1: Write failing test**

```tsx
it("proposes objectives without the browser sending any statement", async () => {
  const { calls } = mockHost(hostViewWithOutlineConfirmed());
  render(<LiveCourse />);
  await user.click(await screen.findByRole("button", { name: /propose objectives from your answers/i }));
  const call = calls.find((c) => c.url.endsWith("/objectives"))!;
  expect(call.body).toEqual({});
});

it("says plainly when no drafting worker is configured", async () => {
  const { calls } = mockHost(hostViewWithConfirmedObjectives());
  render(<LiveCourse />);
  expect(await screen.findByText(/no drafting worker is configured/i)).toBeInTheDocument();
});
```

**Step 2:** `cd frontend && npm test` → FAIL.

**Step 3: Implement** — remove the three constants; the button calls `host.proposeObjectives(courseId)` with no body; the plan button calls `host.proposePlan(courseId)` with no body; surface the 501 state as copy. Keep the source garnish — it now reads `from your answer to ASFAI`.

**Step 4:** `cd frontend && npm test && npm run build` → PASS.

**Step 5: Commit** — `feat(ui): drop the seed data; the product shows the teacher their own words`

---

## Task 7: Prove it end to end

**Objective:** The whole slice runs on a real teacher's words, and a fabricated path is shown to fail.

**Files:**
- Modify: `frontend/scripts/live-host-smoke.mjs`
- Modify: `host/scripts/e2e-restart.mjs`

**Step 1: Add the checks**

- After the objectives step, assert IN THE HOST that `view.proposals.map(p => p.statement)` equals the sentences the smoke typed as `learning_outcomes`.
- Assert `JSON.stringify(view).includes("mt_") === false` across proposals, plan and export.
- Assert the sealed package's `objectiveRefs` statements are the teacher's sentences.
- Falsification: post a hostile `{items:[{statement:"pwn"}]}` to `/objectives` and assert the view is unchanged.

**Step 2:** `cd frontend && node scripts/live-host-smoke.mjs` → the new checks FAIL first.

**Step 3:** Run to green.

**Step 4: Commit** — `test: the slice is proved on the teacher's own words`

---

## Verification (the full gate, run before any push)

```bash
cd confirm-gate && node --test          # expect 26 pass — the core is UNTOUCHED
cd host && node --test                  # expect 62 + new
cd host && node scripts/e2e-restart.mjs # expect 15/15
cd frontend && npm test                 # expect 77 + new
cd frontend && npm run build
cd frontend && node scripts/live-host-smoke.mjs   # expect 34/34 + new
git diff --stat -- confirm-gate         # expect EMPTY
```

## Files likely to change

| File | Change |
|---|---|
| `host/proposer.mjs` | new — answers → proposal items |
| `host/worker.mjs` | new — OSS plan worker seam |
| `host/test/mock-worker.mjs` | new — in-process stub worker |
| `host/course.mjs` | derive + draft methods |
| `host/intake.mjs` | `answers()` accessor |
| `host/server.mjs` | two routes stop taking content |
| `frontend/src/live/LiveCourse.tsx` | seed data deleted |
| `frontend/src/gate/transport.ts` | two calls lose their bodies |
| `frontend/scripts/live-host-smoke.mjs` | proof on real words |
| `confirm-gate/**` | **NOT TOUCHED** |

## Risks and open questions

- **The worker is the sprint's biggest new surface** — config, a secret, latency, cost, and an outbound call from a host that is otherwise zero-dependency and loopback-only. Mitigation: it is off by default, and the sprint ships green with only the stub.
- **Does the worker get to see the materials?** The teacher named them as `{name}` strings. They are not `MaterialVersion` records, and `materialVersionIds` is a dead field the gate never validates. Recommendation: send material *names* to the worker as context, cite nothing, and leave real material versioning for its own sprint.
- **ASFAI is currently mandatory.** `outlineAuthorized()` requires an observed `ready_to_draft`, so a teacher who never connects ASFAI cannot reach the outline, objectives, plan or package. That contradicts "local skills are first-class" and it is a bigger question than this sprint. It should be the *next* scope decision, not a task here. Flagging it now so it is not discovered as a surprise in December.
- **A fresh design-critic round is still owed.** The onboarding pixels carry verdicts of "short" and "fail" from the last round; the fixes landed but the verdicts have not been re-earned. Run the round at the end of this sprint on fresh captures.

## Explicitly out of scope

- The student grounded chat (the next slice after this one).
- Real material versioning.
- A local-first path with no ASFAI.
- `asfai_storage` (no published schema).
- Deployment, multi-tenant, analytics, RA.
