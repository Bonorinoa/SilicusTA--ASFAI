# Sprint 5: ASFAI recommended, never required

> **For Hermes:** use `subagent-driven-development` (or implement inline, task by task) — failing test first, commit per task.

**Goal:** A teacher with no ASFAI account can run the whole one-teacher story — name the course, answer three questions, confirm the outline, confirm the objectives, get a drafted plan, confirm it, publish — without the host ever calling ASFAI. A teacher who *has* ASFAI gets it as the recommended default, not as a toll gate.

**Architecture:** The host asks its own three questions (the same ids ASFAI uses, so every downstream derivation is unchanged), and binds checkpoint 2 to the teacher's own recorded answers when ASFAI was never consulted. The ASFAI path keeps its exact current semantics. `confirm-gate/` is not touched: the gate already delegates checkpoint 2 to `hostGuard.outlineAuthorized()`, so this is a host-and-UI sprint.

**Tech stack:** zero-dependency ES modules (`host/`), Vite + React + TS (`frontend/`), `node --test`, vitest.

---

## Current context (verified 2026-10-12, commit `4b3bcea`)

The gap, exactly:

- `host/intake.mjs:139` `outlineAuthorized()` returns true only for `#observedState === "ready_to_draft"` (with no outstanding clarifying round) or a PR #15 `draftAuthorization`. Both require the host to have called `prepare_outline` and ASFAI to have answered. A teacher who never connects ASFAI never reaches outline → objectives → plan → publish. They cannot use the product at all.
- `confirm-gate/confirm-gate.mjs:365` calls `this.#hostGuard.outlineAuthorized()` when the host provides it. **The gate is already the delegate — do not edit `confirm-gate/`.**
- `host/intake.mjs:77` `answer()` records every answer through `this.#guard.onTeacherReply(text, { via: viaChannel })`, which requires a `TeacherChannel` minted by the session. **A recorded answer is already bound to a real teacher turn.**
- `host/course.mjs:158-176` replays `intake.observed` and `intake.answered`, restoring `#observedState`, `#questions` and `#answers`. **The local path needs no new event to replay deterministically.**
- `host/course.mjs:330` derives objectives via `objectivesFromAnswers(this.#intake.answers())`; `host/proposer.mjs` owns `OUTCOMES_KEY = "learning_outcomes"`. The local questions must keep ASFAI's ids so this path is untouched.
- `host/course.mjs` publish and the plan checkpoint have **no ASFAI dependency** (grep: only `plan.validated`, which is an optional signal).

**Why this does not lower the bar.** The bar was always "a recorded teacher turn". The ASFAI path adds an extra requirement that ASFAI accepts the payload — but ASFAI's `ready_to_draft` proves the *fields were present*, not that a human answered (SPEC/PR #15; the skill says the same). So binding to the teacher's own recorded answers directly is not weaker; it is the same evidence with one fewer proxy.

**Scope note (state this to the user, do not smuggle it).** This removes the ASFAI dependency, **not the worker dependency**. A lesson plan is the one artifact that must be generated; `host/worker.mjs` is off by default by design. A teacher with no worker gets everything up to and including teacher-confirmed objectives, and the UI already says so plainly (`No drafting worker is configured on this host…`). That is accepted and unchanged.

---

## Design decisions (settled — do not relitigate)

1. **ASFAI is the RECOMMENDED default; local is the fallback.** (User direction 2026-10-12.) The product steers the teacher to ASFAI — its questionnaire, its skill-map alignment, its outline validation — because that is the richest path and the one the ecosystem is built around. It must not *require* it. Concretely: connected → ASFAI's questionnaire is the primary flow; not connected → the host's own questions are answerable immediately, with ASFAI recommended prominently beside them. **The teacher is never blocked on a connection**, and the product never presents ASFAI as the price of entry.
2. **The local questions reuse ASFAI's ids and prompts** (`topic`, `course`, `learning_outcomes`). This is what keeps `KNOWN`, `FORWARDABLE`, `cleanAnswers`, `objectivesFromAnswers` and the `learningOutcomes` payload builder working with zero changes, and it makes the upgrade to ASFAI uniform — the answers a teacher gives the host are exactly the answers the host can forward. The ids are field names, not ASFAI IP. Accepted cost: ASFAI's `course` question overlaps the course name already collected in onboarding. Do not "fix" that this sprint.
3. **Local authorization is gated on ASFAI never having been consulted**, so the ASFAI flow's semantics are byte-for-byte unchanged and `host/test/intake.test.mjs:69-84` (the "armed is not yet authorized" assertion) must keep passing **without being edited**. A purely additive rule, not a replacement. This is what makes "recommended default" safe: preferring ASFAI changes what the UI *offers*, never what the gate *accepts*.
4. **The choice is derived, not declared.** "Was ASFAI consulted" is `#observedState !== null`. No new event, no `mode` field, and replay stays exact.
5. **The source label must tell the truth.** `"from your answer to ASFAI"` is a lie for a locally-answered course. It becomes `"from your answer"`. Frozen at proposal time (proposals are events), so a later ASFAI upgrade does not retroactively rewrite earlier proposals.

---

## Task 1: The fallback questionnaire exists, and says whose it is

**Objective:** A course whose teacher has not consulted ASFAI surfaces three questions from the host, marked as the host's — so the fallback path is always available and the teacher is never blocked.

**Files:**
- Modify: `host/intake.mjs`
- Test: `host/test/intake.test.mjs`

**Step 1: Write the failing test** (append to `host/test/intake.test.mjs`)

```js
test("a fresh course asks the teacher the three questions itself, with no ASFAI", () => {
  const s = sessionWithFiles();
  const st = s.intakeStatus();
  assert.deepEqual(st.questions.map((q) => q.id), ["topic", "course", "learning_outcomes"]);
  assert.equal(st.questionsFrom, "local");
  assert.equal(st.observedState, null);
  assert.equal(st.outlineAuthorized, false, "asking is not answering");
});
```

**Step 2: Run it.** `cd host && node --test --test-name-pattern "asks the teacher the three questions" test/intake.test.mjs`
Expected: FAIL — `questions` is `[]`, `questionsFrom` is `undefined`.

**Step 3: Implement** in `host/intake.mjs`

Add above the class (module scope, next to `MAX_FIELD`):

```js
/**
 * The questions the HOST asks when ASFAI is not in the loop. Same ids and prompts as
 * the live asfai_learning questionnaire (fixtures/lesson-intake.json) on purpose: every
 * downstream derivation keys on these ids, so "who asked" is the only difference.
 * Frozen and module-level so replay is deterministic.
 */
export const LOCAL_QUESTIONS = Object.freeze([
  Object.freeze({ id: "topic", prompt: "What topic should this lesson cover?", reason: "The outline needs a subject." }),
  Object.freeze({ id: "course", prompt: "Which course is this part of?", reason: "Course context sets scope and sequencing." }),
  Object.freeze({ id: "learning_outcomes", prompt: "What should learners be able to do by the end?", reason: "An observable outcome anchors the outline." }),
]);
```

Change the field default: `#questions = LOCAL_QUESTIONS;` (was `[]`).

In `status()`, add the provenance:

```js
      questionsFrom: this.#asfaiConsulted() ? "asfai" : "local",
```

and add the private predicate:

```js
  /** Has the host heard from ASFAI at all? Derived, so it replays with no extra event. */
  #asfaiConsulted() {
    return this.#observedState !== null;
  }
```

**Step 4: Run.** Expected: PASS. Then run the whole intake file — the existing `observedState: null` / `questions` assertions must still hold.

**Step 5: Commit** — `git commit -m "The host asks its own three questions when ASFAI is not in the loop"`

---

## Task 2: The teacher's own answers authorize the outline

**Objective:** Checkpoint 2 opens on the teacher's recorded answers when ASFAI was never consulted, and the ASFAI path is untouched.

**Files:**
- Modify: `host/intake.mjs`
- Test: `host/test/intake.test.mjs`

**Step 1: Write the failing tests**

```js
test("the teacher's own answers authorize checkpoint 2 with no ASFAI at all", () => {
  const s = sessionWithFiles();
  // No observeIntake call anywhere in this test: ASFAI is never consulted.
  s.answerIntake({ text: "how AI answers are built", answers: { topic: "how AI answers are built" }, at: 2000 });
  assert.equal(s.intakeStatus().outlineAuthorized, false, "one answer is not all of them");

  s.answerIntake({ text: "AI literacy, ages 8-10", answers: { course: "AI literacy, ages 8-10" }, at: 2100 });
  s.answerIntake({ text: "explain an algorithm", answers: { learning_outcomes: "explain an algorithm" }, at: 2200 });

  const st = s.intakeStatus();
  assert.equal(st.outlineAuthorized, true);
  assert.equal(st.questionsFrom, "local");
  const cp = s.confirmCheckpoint({ id: "outline", text: "Confirm the outline.", at: 3000 });
  assert.equal(cp.status, "confirmed");
});

test("a locally-authorized course replays: the answers are the evidence, not memory", () => {
  const store = newStore();
  const s = CourseSession.create(store, { owner: OWNER, title: "T" });
  s.confirmCheckpoint({ id: "files", text: "Confirm the material list.", at: 1000 });
  s.answerIntake({ text: "my answers", answers: { topic: "t", course: "c", learning_outcomes: "o" }, at: 2000 });
  const reloaded = CourseSession.load(store, s.courseId);
  assert.equal(reloaded.intakeStatus().outlineAuthorized, true);
});

test("consulting ASFAI does not open checkpoint 2 on the answers alone", () => {
  // The ASFAI flow's semantics, unchanged: once ASFAI is in the loop, ASFAI's
  // observed outcome governs. This is the existing intake.test.mjs:69-84 rule.
  const s = sessionWithFiles();
  s.observeIntake({ state: CLARIFY.state, questions: CLARIFY.questions, at: 2000 });
  s.answerIntake({ text: ANSWER, at: 3000 });
  assert.equal(s.intakeStatus().outlineAuthorized, false, "ASFAI must still finish its round");
});
```

**Step 2: Run.** Expected: the first two FAIL (`outlineAuthorized` is false), the third PASSES already.

**Step 3: Implement** in `host/intake.mjs` — replace `outlineAuthorized()`:

```js
  /**
   * May checkpoint 2 be teacher-confirmed?
   *
   * Two paths, and which one applies is DERIVED, not declared:
   *
   *  - ASFAI was never consulted: the host asked its own questions and the teacher
   *    answered every one of them. The only evidence is their recorded turn — no
   *    server token is involved, so there is nothing to fabricate.
   *  - ASFAI was consulted: the existing rule, unchanged. An OBSERVED ready_to_draft
   *    with no outstanding clarifying round, or an observed draftAuthorization.
   *
   * The ASFAI path is not weakened by the local one: gating local on "never consulted"
   * means the ASFAI flow behaves exactly as before.
   */
  outlineAuthorized() {
    if (this.#guard.hasDraftAuthorization()) return true;
    if (!this.#asfaiConsulted()) return this.#localAnswersComplete();
    return (
      this.#observedState === "ready_to_draft" &&
      this.#guard.state !== "clarifying" &&
      (!this.#roundOpened || this.#roundAnswered)
    );
  }

  /**
   * Every question the host asked that it knows how to forward has an answer.
   * `KNOWN` and `hasAnswer` are the same rules `nextCall()` uses for INCOMPLETE_ANSWERS,
   * so "authorized" and "complete" cannot drift apart.
   */
  #localAnswersComplete() {
    const asked = this.#questions.filter((q) => KNOWN.has(q.id));
    return asked.length > 0 && asked.every((q) => hasAnswer(this.#answers, q.id));
  }
```

**Step 4: Run the whole host suite.** Expected: green, and **`host/test/intake.test.mjs` must not have been edited** — verify with `git diff --stat host/test/intake.test.mjs` showing only the three appended tests.

Two existing tests carry the weight here, and neither may be edited:
- `intake.test.mjs:40-49` ("checkpoint 2 refuses until the intake is authorized") — a fresh course has the host's questions but no answers, so it is now the BYSS test for the local path. The host cannot authorize itself by merely asking.
- `intake.test.mjs:69-84` ("the real round … authorizes checkpoint 2"), including `assert.equal(..., false, "armed is not yet authorized")` — the proof that consulting ASFAI does not open checkpoint 2 on the answers alone.

**Test helpers you need** (already in the file): `newStore()`, `sessionWithFiles()`, `OWNER`, `CLARIFY`, `READY`, `ANSWER`.

**Step 5: Commit** — `git commit -m "The teacher's own answers authorize the outline when ASFAI is not in the loop"`

---

## Task 3: The source label tells the truth

**Objective:** A locally-derived objective does not claim it came from ASFAI.

**Files:**
- Modify: `host/proposer.mjs`, `host/intake.mjs`, `host/course.mjs`
- Test: `host/test/proposer.test.mjs`, `host/test/derive-objectives.test.mjs`

**Step 1: Write the failing tests**

In `host/test/proposer.test.mjs`:

```js
test("the two source labels are distinct and both honest", () => {
  assert.equal(SOURCE_FROM_ANSWERS, "from your answer to ASFAI");
  assert.equal(SOURCE_FROM_LOCAL_ANSWERS, "from your answer");
  assert.notEqual(SOURCE_FROM_ANSWERS, SOURCE_FROM_LOCAL_ANSWERS);
});
```

In `host/test/derive-objectives.test.mjs` (which drives a course with **no** ASFAI):

```js
test("a locally-answered course does not claim ASFAI as the source", () => {
  // ... drive a course to the objectives checkpoint using ONLY the host's own questions
  const r = s.proposeObjectivesFromAnswers({ at: 5000 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.proposals.map((p) => p.source), ["from your answer", "from your answer"]);
});
```

**Step 2: Run.** Expected: FAIL (`SOURCE_FROM_LOCAL_ANSWERS` is not exported; the source reads `"from your answer to ASFAI"`).

**Step 3: Implement**

`host/proposer.mjs`:

```js
/** The label the UI shows beside a derived proposal. It must be the truth. */
export const SOURCE_FROM_ANSWERS = "from your answer to ASFAI";
/** The same, when the teacher answered the host's own questions and nothing left the machine. */
export const SOURCE_FROM_LOCAL_ANSWERS = "from your answer";
```

`host/intake.mjs` — add the accessor:

```js
  /** Did the teacher's answers go to ASFAI? The honest basis for a source label. */
  sentToAsfai() {
    return this.#asfaiConsulted();
  }
```

`host/course.mjs` — in `proposeObjectivesFromAnswers`, replace the label use:

```js
    const source = this.#intake.sentToAsfai() ? SOURCE_FROM_ANSWERS : SOURCE_FROM_LOCAL_ANSWERS;
    const event = {
      kind: "objectives.proposed",
      items,
      sources: items.map(() => source),
      assistantText: null,
      at: a,
    };
```

Update the import at `host/course.mjs:27` to include `SOURCE_FROM_LOCAL_ANSWERS`.

**Step 4: Run.** Expected: PASS. The existing ASFAI-driven tests still read `"from your answer to ASFAI"`.

**Step 5: Commit** — `git commit -m "The objective source label says where the answer actually came from"`

---

## Task 4: The whole story with no ASFAI service at all (the sprint's acceptance test)

**Objective:** Prove end to end, over HTTP, that a course reaches a sealed package with `asfai: null`.

**Files:**
- Test: `host/test/local-only.test.mjs` (new)

**Step 1: Write the failing test**

```js
/**
 * local-only.test.mjs — the teacher who never connects ASFAI.
 *
 * The host is created with NO ASFAI service at all (`asfai: null`), so every
 * `/api/asfai/*` route is unavailable and `/intake/call` cannot succeed. The whole
 * one-teacher story must still run: the host asks its own questions, the teacher's
 * answers authorize the outline, the objectives derive from those answers, the worker
 * drafts the plan, and the package seals.
 */
```

Drive: create course → confirm files → answer the host's three questions (`/intake/answer`, one at a time) → assert `outlineAuthorized` → confirm outline → `POST /objectives` with `{}` → decide (accept all) → `POST /plan` with a mock worker → confirm plan → `POST /publish`.

Assertions, at minimum:

```js
assert.equal(view.intake.questionsFrom, "local");
assert.deepEqual(view.proposals.map((p) => p.statement), ["explain an algorithm"]);   // the teacher's own words
assert.ok(view.proposals.every((p) => p.source === "from your answer"));
assert.deepEqual(view.objectives.map((o) => o.statement), ["explain an algorithm"]);  // derived, not invented
assert.ok(view.objectives.every((o) => o.id.startsWith("urn:uuid:")));                // local URN identity
assert.equal(view.checkpoints.publish.status, "confirmed");
assert.equal(view.versions.length, 1);
const ver = await get(`/api/courses/${courseId}/verify`);
assert.equal(ver.json.ok, true);
// and nothing was ever sent anywhere
assert.equal(ASFAI_CALLS, 0);
```

Use `startMockWorker` + `PlanWorker` from `host/test/` (pattern: `host/test/asfai-flow.test.mjs` `appAtConfirmedObjectives`). Reuse the harness style already in that file.

**Step 2: Run.** Expected: FAIL until Tasks 1-3 are in (and it is the honest proof that they compose).

**Step 3:** no production code should be needed. If it is, that is a finding — stop and fix the design, do not patch the test.

**Step 4: Commit** — `git commit -m "Prove the one-teacher story runs with no ASFAI service at all"`

---

## Task 5: The UI recommends ASFAI and never blocks on it

**Objective:** ASFAI is the recommended default the teacher is steered toward; the host's own questions are the always-available fallback; nothing is gated on a connection.

**Files:**
- Modify: `frontend/src/gate/transport.ts` (add `questionsFrom` to the intake view type)
- Modify: `frontend/src/live/OnboardingChat.tsx`
- Test: `frontend/src/live/LiveCourse.test.tsx`

**Step 1: Write the failing tests**

```tsx
it("recommends ASFAI when it is connected, as the primary way in", async () => {
  // stub: asfai connected, no ASFAI round open yet, questionsFrom "local" (nothing consulted yet)
  expect(await screen.findByRole("button", { name: /use ASFAI's questionnaire/i })).toBeInTheDocument();
  expect(screen.getByText(/recommended/i)).toBeInTheDocument();
});

it("recommends ASFAI without blocking when it is not connected", async () => {
  // stub: asfai NOT connected, questionsFrom "local", three questions, no answers
  expect(await screen.findByRole("button", { name: /connect ASFAI/i })).toBeInTheDocument();
  // the teacher can simply answer: the questions are live, not disabled
  expect(await screen.findByLabelText(/what topic should this lesson cover/i)).toBeInTheDocument();
  // and nothing attributes the host's questions to ASFAI
  expect(screen.queryByText(/ASFAI asked/i)).not.toBeInTheDocument();
});

it("opens the outline confirm once the teacher's own answers are in, with ASFAI untouched", async () => {
  // stub: outlineAuthorized true, questionsFrom "local", no ASFAI
  expect(await screen.findByRole("button", { name: "Confirm the outline" })).toBeInTheDocument();
  expect(screen.queryByText(/Connect ASFAI to continue/i)).not.toBeInTheDocument();
});
```

**Step 2: Run.** `cd frontend && npx vitest run src/live/LiveCourse.test.tsx`
Expected: FAIL.

**Step 3: Implement**

- `transport.ts`: add `questionsFrom: "asfai" | "local"` to the intake shape.
- `OnboardingChat.tsx`, the intake panel:
  - **Connected, ASFAI round not yet open:** the PRIMARY affordance is `Use ASFAI's questionnaire` — it calls `/intake/call`, ASFAI asks, and its questions replace the host's. Mark it recommended. Leave the host's questions visible underneath so a failed call loses nothing.
  - **Not connected:** the PRIMARY affordance is `Connect ASFAI`, marked recommended, with one quiet line saying what it buys (align the lesson to its skill map; have the outline validated). The host's questions are answerable immediately — not disabled, not behind the connection.
  - **Never attribute the host's questions to ASFAI.** `questionsFrom` drives that copy; when `"local"` the panel must not say "ASFAI asked".
  - The outline confirm appears whenever `outlineAuthorized` is true. No connection required.
  - Keep the `unforwardable` notice and the standing "Recorded on this course. Sent only when you send the round." line.
- Do not add a new accent, a new card, or a modal. Calm editorial, one accent (see `references/frontend-design-review.md`). "Recommended" is a typographic weight plus a one-line rationale — not a badge and not a second color.

**Step 4: Run** `npm test`, `npm run build`, and `cd ../confirm-gate && node --test` (proves the core is untouched).

**Step 5: Commit** — `git commit -m "Onboarding: the host's own questions are the default, ASFAI is the upgrade"`

---

## Task 6: Close — both end-to-end runs prove the ASFAI-free path

**Objective:** The process-boundary and browser acceptance runs exercise the local path, and the ASFAI path still passes.

**Files:**
- Modify: `host/scripts/e2e-restart.mjs` (add a second phase: a fresh course on the same data dir, answered locally, sealed with no ASFAI call)
- Modify: `frontend/scripts/live-host-smoke.mjs` (drive the questions locally; keep the ASFAI assertions for the connected course, or add a second course)

**Step 1:** Write the new assertions first; run each script and watch them fail.
**Step 2:** Implement.
**Step 3:** Run the full verification block (below).
**Step 4: Commit** — `git commit -m "Close Sprint 5: the acceptance runs cover the teacher with no ASFAI"`

---

## Verification (all of it, every time)

```bash
cd confirm-gate && node --test          # expect 26 pass
cd ../host && node --test               # expect 97 + the new tests
cd ../frontend && npm test              # expect 81 + the new tests
cd ../frontend && npm run build         # expect clean
cd ../host && node scripts/e2e-restart.mjs          # expect 15/15 + the new local phase
cd ../frontend && node scripts/live-host-smoke.mjs  # expect 34/34 + the new local checks
cd .. && git diff --stat -- confirm-gate | wc -l    # MUST be 0
```

**The non-negotiable check:** `git diff --stat -- confirm-gate` is 0 lines. The trust core is byte-identical; the gate already delegates checkpoint 2 to the host, so this sprint has no business touching it. If a change seems to require editing `confirm-gate/`, stop — the seam is being used wrong.

**Also verify `host/test/intake.test.mjs` was only appended to.** The "armed is not yet authorized" assertion is the proof that the ASFAI path was not weakened. If it needed editing, the design slipped.

---

## Risks and tradeoffs

| Risk | Why it is acceptable / how it is contained |
|---|---|
| The local path could be read as "the host can authorize itself". | It cannot: `#localAnswersComplete()` requires an answer for every question, and `#answers` is only ever written by `answer()`, which requires a `TeacherChannel` minted by the session (`host-guard.mjs` makes that structurally unforgeable in-process). Add the BYSS test: a session with no answers and no ASFAI must stay unauthorized. |
| Two paths through one predicate is a place for a future bug. | Gated on a derived flag with a test on each side, plus the third test in Task 2 that pins the boundary explicitly. |
| The `course` question duplicates the onboarding course name. | Accepted for id uniformity; noted as a known cost. Do not "fix" it this sprint. |
| The plan still needs a worker. | Out of scope, stated plainly above and already surfaced in the UI. Do not add a second drafting path. |
| A locally-authorized course silently loses ASFAI validation. | Intentional, and the UI must say what ASFAI buys rather than imply a block. `validate_outline` stays an optional signal — it never confirmed anything. |

## Open questions (decide during the sprint, do not guess silently)

1. Should a locally-authorized course still be *offered* ASFAI validation after the fact (send the outline, not the answers)? Cheap if the connection exists; it needs no new authorization rule. Default: yes, as a quiet affordance, if it does not complicate the panel.
2. Does the archive/export need to record *which* intake authorized the course? `intake.observed` presence already answers it, and the export carries the intake status. Default: no new field.

## Explicitly out of scope

- Student grounded chat, deploy, and the ASFAI storage round-trip (S5+).
- Any change to `confirm-gate/`.
- A second plan-drafting path that does not use the worker.
- RA.
