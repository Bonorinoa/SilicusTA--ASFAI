# Tonight's prototype: one stage at a time, the background work in plain view

> **For Hermes:** this plan is executed through the Kanban board. Three worker cards (E1 engineer, C2 creative,
> C1 creative) and one verifier card. The orchestrator (silicus-ta) owns the contract, integration, every suite
> re-run, deploy and the production live test. Workers never push, never touch `main`, never run `vercel`.

**Goal:** Ship a deployable Silicus TA prototype tonight. The course page shows ONE stage at a time with ONE
primary action. A "Behind the scenes" rail makes visible which component (you, Silicus, the drafting model,
ASFAI) did what to which artifact. A first-run tour orients a new teacher. The defects found in the 15 October
walkthrough are fixed and pinned by tests, and the result is on production via preview -> verifier -> main.

**Architecture:** The host stays the source of truth. It adds two ADDITIVE, optional fields to the course view:
`publish.reasons` (gate blockers classified into codes) and `activity` (what each actor did, derived from the
event log). The UI adds a pure `stageOf(view)` that decides only what to SHOW (never policy), a rail that
renders `activity` plus the in-flight AI step, and a tour whose "seen" flag lives in localStorage, not the
record. `confirm-gate/` is untouched (`git diff main -- confirm-gate` must stay empty).

**Tech stack:** Node 22 host (zero dependencies, `node:test`), Vite + React + TS frontend (vitest, Testing
Library), puppeteer-core smokes against system Chrome, Vercel (browser-as-host build + three functions).

---

## 0. What the 15 October walkthrough found (evidence)

Runs: production with the model mocked in-page; local app with real ASFAI + real DeepSeek V4 Flash on
ZDR (23 s end to end, plan in 5.1 s); local app without ASFAI (29 s, plan 11.9 s). Captures:
`~/.hermes/profiles/silicus-ta/cache/scratch/vibe/{prod,local-asfai,local-noasfai}/`.

Defects (each becomes a test):

| # | Defect | Where | Lane |
|---|---|---|---|
| D1 | "Confirm N objectives · build the plan" does nothing: `LiveCourse` never passes `onConfirm`. It stays armed after the plan exists and after publish. | `frontend/src/live/LiveCourse.tsx:604` | C1 |
| D2 | The lesson plan renders twice (PlanCard, then the PublishCard preview). Pages reach 5,600-7,000 px. | `LiveCourse.tsx:613-642` | C1 |
| D3 | Raw gate text reaches the teacher: `checkpoint "files" is not teacher-confirmed`, urn lists. | `PublishCard.tsx:185-190` | E1 (codes) + C1 (words) |
| D4 | Host-guard developer text in the teacher's intake: "Surface them and wait ... before calling prepare_outline again." | `OnboardingChat.tsx:368` renders `intake.refusal.reason` | C1 |
| D5 | Off-topic student answer leaks: "capital of France?" got the 1/4 answer + "not covered", citing Objective 2. | `host/worker.mjs` `buildStudentPrompt`/`validateAnswer` | E1 |
| D6 | Age shown twice: "Fractions on a number line (age 8+) (ages 8–9)". | `host/sources/asfai-graph.mjs:73` | E1 |
| D7 | The teacher's course answer (with "45-minute lesson") never reaches the plan prompt; the ASFAI-path plan came back 30 minutes. | `host/worker.mjs:265` `buildPrompt` | E1 |
| D8 | The notice "Course recorded. Confirm the material list when it is right." stays on screen through publish. | `LiveCourse.tsx:137` | C1 |
| D9 | The local app shows the developer header ("design workbench · tokens-first · bound to confirm-gate", six tabs). | `frontend/src/workbench/Workbench.tsx:68` | C1 |

UX direction (three critic passes converged; adjudicated here, do not re-litigate):
- One stage expanded, finished stages as one-line summaries (expandable), future stages hidden.
- The confirm action sits BELOW what it confirms.
- Machine keys (urns, "log 13 events", turn refs) leave the reading path; they live in a "Record details"
  disclosure. The audit trail stays, behind a disclosure, never removed.
- The published moment is a moment: the sealed version, then three outward actions (Try it as a student,
  Download the handout, Export). "Revise" is secondary. Decided objectives are read-only until Revise.

Rejected critic advice (locks): no green "verified" shield (overclaims proof; the log is evidence, not proof);
no cloud sync or accounts; keep the three opening correspondence turns and the verb "Record"; never hide what
the model sees.

---

## 1. The contract (landed by the orchestrator on `integration/tonight`)

`frontend/src/gate/types.ts` and `frontend/src/gate/transport.ts` (already committed, `tsc` exit 0):

```ts
// PublishStatusView gains:
reasons?: readonly PublishReason[];   // one per blockers[] entry, SAME ORDER
export type PublishReason =
  | { code: "CHECKPOINT_UNCONFIRMED"; checkpoint: "files" | "outline" | "objectives" }
  | { code: "UNDECIDED_PROPOSALS"; count: number }
  | { code: "NO_CONFIRMED_PLAN" }
  | { code: "PLAN_INVALIDATED" }
  | { code: "PLAN_EMPTY" }
  | { code: "PLAN_CITES_UNCONFIRMED"; count: number }
  | { code: "OTHER"; text: string };

// HostView gains:
activity?: ActivityItem[];            // oldest first
export type ActivityActor = "teacher" | "silicus" | "worker" | "asfai";
export interface ActivityItem {
  seq: number; at: number; actor: ActivityActor;
  action: "course.created" | "checkpoint.confirmed" | "intake.asked" | "intake.answered" | "intake.sent"
        | "objectives.derived" | "objectives.drafted" | "objectives.decided"
        | "plan.drafted" | "plan.checked" | "plan.confirmed" | "package.sealed";
  artifact: "record" | "outline" | "objectives" | "plan" | "package";
  facts: Readonly<Record<string, string | number | boolean>>;   // counts, names, flags ONLY
}
```

Rules on `facts`: counts (objectives, activities, citations, decisions by verb, characters), material NAMES,
`source: "asfai" | "local"`, `checkpoint`, `version`. NEVER material text, an objective statement (it is
already in the view), a passcode, a key, or a model name the host does not know.

Actor mapping (host side, from event kinds in `host/course.mjs`):

| Event kind | actor | action | artifact |
|---|---|---|---|
| `course.created` | teacher | course.created | record |
| `checkpoint.confirmed` | teacher | checkpoint.confirmed | `files`->record, `outline`->outline, `objectives`->objectives, `plan`->plan |
| `intake.observed` (state clarifying) | asfai | intake.asked | outline |
| `intake.observed` with `sent` / state ready | asfai | intake.sent | outline |
| `intake.answered` | teacher | intake.answered | outline |
| `objectives.proposed` with `assistantText` | worker | objectives.drafted | objectives |
| `objectives.proposed` without `assistantText` | silicus | objectives.derived | objectives |
| `objectives.decided` | teacher | objectives.decided | objectives |
| `plan.proposed` | worker | plan.drafted | plan |
| `plan.validated` | asfai | plan.checked | plan |
| `plan.confirmed` | teacher | plan.confirmed | plan |
| `package.published` | teacher | package.sealed | package |

If an event kind is not in this table, skip it (the rail is a reading aid, the timeline is the record).
Read the real kinds in `host/course.mjs` (lines ~230-560) before coding; correct the table in your report if
the log differs.

---

## 2. Task graph (Kanban)

```
E1 engineer: host contract + D3/D5/D6/D7 ----\
                                               >-- C1 creative: stage page + rail/tour mounted + D1/D2/D4/D8/D9 --> V1 verifier
C2 creative: ActivityRail + FirstRunTour ----/
```

E1 and C2 run in parallel (disjoint files). C1 starts when both are done and merges both branches first.
V1 audits the C1 branch head. Then the orchestrator merges, re-runs every suite, pushes a preview, checks it,
merges to main, and live-tests production.

Worktrees (branches from `integration/tonight`; `frontend/node_modules` symlinked):
- E1 `~/.hermes/profiles/silicus-ta/cache/scratch/wt-host` on `feat/host-contract`
- C2 `~/.hermes/profiles/silicus-ta/cache/scratch/wt-rail` on `feat/rail-tour`
- C1 `~/.hermes/profiles/silicus-ta/cache/scratch/wt-stage` on `feat/stage-page`

Baselines (re-measure first in your worktree and report them): confirm-gate 41, api 57, host 262,
e2e-restart 53/53, frontend 286 + tsc + build, live-host-smoke 62/62, browser-mode-smoke 208/208,
narrow-shell 16/16.

---

## 3. E1 — engineer: the host contract and four host defects

Files E1 may touch: `host/**` (not `host/test/fixtures`), `api/**`, `frontend/src/browser/site.ts`,
`frontend/src/browser/browserHost.ts`, `frontend/src/components/AiWaiting/model.ts` (+ its test, for D7 only),
and tests next to them. Nothing else in `frontend/`.

### Task E1.1: classify publish blockers (D3, host half)

**Files:** Create `host/reasons.mjs`, `host/test/reasons.test.mjs`. Modify `host/course.mjs` `view()` (line ~747).

Step 1, failing test (`host/test/reasons.test.mjs`):

```js
import test from "node:test";
import assert from "node:assert/strict";
import { classifyBlocker } from "../reasons.mjs";

test("every gate blocker form gets a code; unknown text is kept, never dropped", () => {
  assert.deepEqual(classifyBlocker('checkpoint "files" is not teacher-confirmed'), { code: "CHECKPOINT_UNCONFIRMED", checkpoint: "files" });
  assert.deepEqual(classifyBlocker("undecided proposals await teacher decisions: urn:uuid:a, urn:uuid:b, urn:uuid:c"), { code: "UNDECIDED_PROPOSALS", count: 3 });
  assert.deepEqual(classifyBlocker("no teacher-confirmed lesson plan"), { code: "NO_CONFIRMED_PLAN" });
  assert.deepEqual(classifyBlocker("lesson plan urn:uuid:p is invalidated (objective dropped) and needs teacher re-confirmation"), { code: "PLAN_INVALIDATED" });
  assert.deepEqual(classifyBlocker("lesson plan has no activities"), { code: "PLAN_EMPTY" });
  assert.deepEqual(classifyBlocker("objective urn:uuid:x is not confirmed (status: proposed) — unconfirmed objectives must not appear on a published lesson plan"), { code: "PLAN_CITES_UNCONFIRMED", count: 1 });
  assert.deepEqual(classifyBlocker("a brand new rule"), { code: "OTHER", text: "a brand new rule" });
});
```

Then a SECOND test that drives a real `CourseSession` (helpers `newStore()` and the `drive()` pattern in
`host/test/course.test.mjs`) through each state and asserts `view().publish.reasons.length ===
view().publish.blockers.length` and that no reason is `OTHER`. This is the teeth: if the gate's wording
changes, this test fails instead of the UI quietly showing "OTHER".

Step 2: `cd host && node --test test/reasons.test.mjs` -> FAIL (module not found).

Step 3, implementation (`host/reasons.mjs`):

```js
/**
 * reasons.mjs — the gate's publish blockers, classified so a UI can say them in plain words.
 * The gate's strings stay the source of truth (confirm-gate is not touched); this maps each one to a code.
 * A blocker this file does not recognise is returned as OTHER with its text: never silently dropped.
 */
export function classifyBlocker(text) {
  const t = String(text);
  let m;
  if ((m = t.match(/^checkpoint "(files|outline|objectives)" is not teacher-confirmed$/))) return { code: "CHECKPOINT_UNCONFIRMED", checkpoint: m[1] };
  if ((m = t.match(/^undecided proposals await teacher decisions: (.+)$/))) return { code: "UNDECIDED_PROPOSALS", count: m[1].split(",").filter((s) => s.trim()).length };
  if (t === "no teacher-confirmed lesson plan") return { code: "NO_CONFIRMED_PLAN" };
  if (/^lesson plan \S+ is invalidated /.test(t)) return { code: "PLAN_INVALIDATED" };
  if (t === "lesson plan has no activities") return { code: "PLAN_EMPTY" };
  if (/^objective \S+ is not confirmed /.test(t)) return { code: "PLAN_CITES_UNCONFIRMED", count: 1 };
  return { code: "OTHER", text: t };
}

/** Collapse per-objective PLAN_CITES_UNCONFIRMED into one counted reason? NO: keep one reason per blocker, same order. */
export const reasonsOf = (blockers) => blockers.map(classifyBlocker);
```

In `host/course.mjs` `view()`, replace `publish: this.#gate.publishStatus(),` with:

```js
      publish: (() => { const s = this.#gate.publishStatus(); return { ...s, reasons: reasonsOf(s.blockers) }; })(),
```

and `import { reasonsOf } from "./reasons.mjs";` at the top.

Step 4: `cd host && node --test test/reasons.test.mjs` -> PASS. Full host suite still green.
Step 5: `git commit -m "host: classify publish blockers into codes (additive publish.reasons)"`.

### Task E1.2: the activity feed

**Files:** Create `host/activity.mjs`, `host/test/activity.test.mjs`. Modify `host/course.mjs` `view()`.

Test first: drive a session like `drive()` in `course.test.mjs` and assert:
1. `view().activity` is oldest-first, `seq` strictly increasing, one row per mapped event (table in section 1).
2. A worker-drafted proposal is `actor: "worker"`, a teacher-derived one is `actor: "silicus"`.
3. `facts` of `objectives.drafted` carry `count` and material NAMES but no material text. Use the
   `MATERIAL_SECRET` constant from `host/test/scripted-course.mjs`: `JSON.stringify(view().activity)` must not
   contain it after a material-proposal run.
4. Replay: a session reloaded from the same log yields a byte-identical `activity`.

Implementation: a pure `activityOf(records)` over the verified log records, called from `view()`. If the
session does not keep the record list in memory, read it the way `#timeline()`/`integrity` already do (they
use `this.#log`). Keep it pure and replay-exact: no `Date.now()`, no random ids.

Commit: `host: derive the activity feed from the event log (additive view.activity)`.

### Task E1.3: off-topic student answers fall back (D5)

**Files:** Modify `host/worker.mjs` (`buildStudentPrompt` ~line 391, `validateAnswer` ~line 407),
`host/student.mjs` if the fallback is decided there. Test: `host/test/student.test.mjs` (use its `boot()` and
`model()` helpers).

1. Prompt: the JSON shape becomes `{"inScope": boolean, "answer": string, "cites": [string]}` with the line
   `Set "inScope" to false when the package does not cover the question; then answer with an empty string.`
2. Validation fails CLOSED: `inScope !== true` -> the fixed fallback (`FALLBACK` from `student.mjs`), even
   when cites are valid. A mixed answer ("1/4 goes here... the capital of France is not covered") with
   `inScope: true` and valid cites is out of reach of validation; the prompt line
   `Answer only the student's question. Never answer a different question from the package.` covers it and
   the live check below measures it.
3. Tests: (a) `inScope: false` with valid cites -> fallback; (b) missing `inScope` -> fallback; (c)
   `inScope: true` + valid cite -> grounded answer (existing tests must stay green UNEDITED; if an existing
   mock reply lacks `inScope`, the existing test's mock must be updated, and that is the ONE allowed edit:
   list each one in the report).

Commit: `student: an answer the package does not cover falls back, fail-closed on inScope`.

### Task E1.4: one age range on an ASFAI alignment (D6)

**File:** `host/sources/asfai-graph.mjs:73`. Test in `host/test/source-asfai-graph.test.mjs`: a hit named
`"Fractions on a number line (age 8+)"` with ages 8-9 yields a label with exactly ONE age phrase. Rule: append
`(ages a–b)` only when the name does not already match `/\(ages? [^)]*\)\s*$/i`.

Commit: `asfai-graph: never print the age twice`.

### Task E1.5: the teacher's course answer reaches the plan prompt (D7)

**Files:** `host/worker.mjs` `buildPrompt` (line 265) and its caller in `host/course.mjs` (~line 390, where
`course` is already computed); `frontend/src/components/AiWaiting/model.ts` (the plan step's "What the model
sees" list gains the course line, so the disclosure stays EXACT). Tests: `host/test/worker.test.mjs` asserts
the prompt contains `Course: Grade 3 math, one 45-minute lesson` and the line
`Fit the plan to any length or audience the teacher states above.`; AiWaiting test asserts the disclosure
lists the course. Clean the course text with the same `oneLine(text, 300)` as other prompt inputs.

The plan step's `WaitingStep` gains `course?: string` (optional, so C1 can pass it; an absent value renders
nothing).

Commit: `plan: the teacher's course answer (length, audience) reaches the drafting prompt`.

### E1 acceptance
- Every new test red first, then green. Teeth for E1.1 (break a regex, the real-session test fails) and E1.3
  (remove the `inScope` check, test (a) fails).
- All suites green with counts and exit codes; `git diff integration/tonight -- confirm-gate` empty.
- `node frontend/scripts/browser-mode-smoke.mjs` still 208/208 (the browser host shares `host/handler.mjs`).

---

## 4. C2 — creative: the Behind-the-scenes rail and the first-run tour (standalone components)

Files C2 may touch: create `frontend/src/components/ActivityRail/*` and `frontend/src/components/FirstRunTour/*`
(component, CSS module, `index.ts`, tests). Nothing else (C1 mounts them).

### ActivityRail

Props:

```ts
interface ActivityRailProps {
  items: readonly ActivityItem[];                 // from view.activity (import type from "../../gate/types")
  now?: { actor: ActivityActor; label: string; startedAt: number } | null;   // the AI step in flight, from LiveCourse's waiting state
  worker?: { zdr?: boolean | null; model?: string | null } | null;           // from worker status
  asfaiAvailable: boolean;                        // false online: the ASFAI lane is not drawn at all
}
```

Design brief:
- Title "Behind the scenes". Four named lanes, in this order and wording:
  **You** (the teacher's decisions), **Silicus** (keeps the record and the rules), **Drafting model**
  (proposes and drafts, never decides), **ASFAI** (asks questions, checks format; local app only).
- Each row: actor, a plain-words sentence from a copy table keyed by `action` + facts (e.g. "Drafted 3
  objectives from 1 material", "Sealed version 1", "Recorded your decisions: 2 accepted, 1 renamed"), the
  artifact it changed as a small label, relative time. Counts go through `frontend/src/lib/plural.ts`.
- The in-flight row (`now`) is the ONE animated element (ink-line motion, off under
  `prefers-reduced-motion`), and says which actor is working. No progress bar, no percentage.
- When the drafting model is working, a single line states what it sees in one sentence and points to the
  waiting card's full "What the model sees" disclosure. Zero-retention wording only when `worker.zdr === true`.
- Calm editorial: hairlines, one accent, serif for the sentence, sans for chrome. A rail on wide screens
  (sticky side column >= 72rem), a collapsible section below the stage under that width. One
  `aria-live="polite"` region announcing only when a row is ADDED, never per second.
- Empty `items` and no `now`: render nothing.

### FirstRunTour

Props: `{ open: boolean; onClose: () => void; asfaiAvailable: boolean }`. A modal dialog
(`role="dialog"`, `aria-modal`, focus trapped, Escape closes, focus returns to the opener) with 4 short
panels and Back/Next/"Start my course":
1. **You bring the course.** A title, your name for your copy, and the names of your material.
2. **The AI proposes, you decide.** A drafting model proposes objectives and drafts a plan. Nothing counts
   until you accept, rename, drop or add. You can always see what it was sent.
3. **Silicus keeps the record.** Every decision is written to an append-only record you can check and export.
   It is evidence of what was decided, not proof of who decided it.
4. **Publish, then let students ask.** Publishing seals a version. Students' questions are answered only from
   what you sealed; asking is never evidence of learning.
Panel 2 adds, only when `asfaiAvailable`: "ASFAI can ask its own questions and align to its skill map. It is
recommended, never required."
Persistence is the PARENT's job (C1): `localStorage["silicus.tour.seen"] = "1"`. The tour never writes the record.

### C2 acceptance
- vitest: rail renders one row per item with the right lane and sentence; N=1 pluralization; `now` row
  animated vs `data-motion="still"` under reduced motion; ASFAI lane absent when `asfaiAvailable=false`;
  live region announces only on add (rerender with the same items -> no new announcement). Tour: 4 panels,
  focus trap, Escape closes and calls `onClose`, ASFAI line conditional.
- No new runtime dependencies. `npx tsc --noEmit -p . && npm test && npm run build` green.
- Screenshots of both components (rendered in a scratch harness or the vitest DOM is not enough: use
  `npm run dev` + puppeteer, or a temporary demo route NOT committed) in `docs/design/img/rail-*.png`,
  `tour-*.png`, referenced from `docs/design/behind-the-scenes.md`.

---

## 5. C1 — creative: the stage-focused course page (mounts E1 + C2)

Start: `git merge feat/host-contract feat/rail-tour` into `feat/stage-page`; resolve; run every suite; commit.

Files C1 may touch: `frontend/src/live/**`, `frontend/src/components/{DecisionCard,PlanCard,PublishCard,TimelineCard}/**`
(layout and copy; never the verbs' meaning), `frontend/src/workbench/**`, `frontend/src/styles/**`,
`frontend/src/design/tokens.{css,ts}` (in the same pass, the parity test enforces it), `frontend/index.html`,
`frontend/scripts/*.mjs` (smokes), `docs/design/**`.

### Task C1.1: `stageOf(view)` — pure, tested

`frontend/src/live/stage.ts` and `stage.test.ts`:

```ts
export type Stage = "intake" | "material" | "objectives" | "plan" | "publish" | "published";
/** Which stage the page shows expanded. Display only: every rule stays in the host. */
export function stageOf(v: HostView): Stage
```

Order: files/outline not confirmed -> `intake`; outline confirmed, no proposals, outcomes from materials ->
`material`; objectives not confirmed -> `objectives`; no plan or plan not confirmed (draft/invalidated) ->
`plan`; `publish.canPublish` and no unpublished version -> `publish`; a version exists and nothing pending ->
`published`; a version exists and changes pending -> `publish` (drafting version N+1). Write one test per row
using the `stubView()` builder style in `LiveCourse.test.tsx`.

### Task C1.2: one stage expanded, the rest summarized

`LiveCourse.tsx` renders: masthead -> course title (no urn in the reading path) -> a typographic step index
(replaces the five boxed chips: `1 Material · 2 Outline · 3 Objectives · 4 Plan · 5 Publish`, the current one
marked, finished ones ticked) -> the current stage's card, expanded -> finished stages as one-line summaries
with a "Show" disclosure -> the Behind-the-scenes rail (C2) -> "Record details" disclosure (course id, event
count, Verify the event log, pinned copies, decision history TimelineCard) -> BrowserRecord panel.

Rules:
- Exactly ONE primary (filled accent) button visible per stage.
- D1: when objectives are confirmed and there is no plan, the DecisionCard confirm bar is the stage's
  primary and is wired: `onConfirm={draftPlan}` (its label "Confirm N objectives · build the plan" becomes
  true). When a worker is not configured, pass no `onConfirm` and show the existing "not set up" aside.
- D2: the plan renders ONCE. At the `plan` stage: PlanCard, then BELOW it the AiWaiting receipt and the
  "Confirm the lesson plan" primary. At the `publish` stage: PublishCard with its embedded preview, PlanCard
  not rendered separately. After publish: the sealed PlanCard once.
- D3 words: PublishCard renders `reasons` through one copy table (`frontend/src/live/reasonText.ts`, tested):
  CHECKPOINT_UNCONFIRMED files -> "Confirm the material list", outline -> "Confirm the outline",
  objectives -> "Decide every proposed objective"; UNDECIDED_PROPOSALS -> "Decide the N proposed objectives
  still waiting"; NO_CONFIRMED_PLAN -> "Confirm a lesson plan"; PLAN_INVALIDATED -> "Re-confirm the plan: it
  cites an objective you revoked"; PLAN_EMPTY -> "The plan has no activities"; PLAN_CITES_UNCONFIRMED ->
  "The plan cites N objectives you have not confirmed"; OTHER -> its text. Raw `blockers` move into the Record
  details disclosure. Absent `reasons` (older host) -> raw blockers as today.
- D4: `intake.refusal` renders a teacher sentence by code: `AWAITING_TEACHER_REPLY` -> "Answer the questions
  above, then send them." `INCOMPLETE_ANSWERS` -> "Answer every question before sending." Other codes ->
  "Silicus could not continue the intake." The host's `reason` text goes to Record details only.
- D8: the notice clears when the stage changes (`useEffect` on `stageOf(view)`).
- Waiting/rail: LiveCourse passes `now` to the rail from its `waiting` state (actor `worker` for objectives,
  plan and answers; `asfai` while `askAsfai`/`checkPlan` run) and passes `course` into `planStep` (E1.5).

### Task C1.3: the published moment

At `published`: a sealed header ("Version 1 is published" + sealed date + the teacher's name), then three
actions in this order: **Try it as a student** (scrolls to and focuses the student chat, which now sits right
under the header), **Download the student handout**, **Export the package**. "Revise this course" is a
secondary ghost button. DecisionCard rows are read-only (no Edit wording / Revoke) until Revise is pressed;
Revise reveals the existing RevisionPanel tools unchanged.

### Task C1.4: first run and the tour

- First visit (no `silicus.tour.seen` in localStorage) and no courses: open FirstRunTour once; "Start my
  course" closes it and focuses `#onboarding-reply`. A quiet "How it works" link in the masthead reopens it.
- D9: host mode gets the same product masthead as browser mode; the workbench stays reachable through the
  footer "Design system" link. Check `Workbench.test.tsx` and `scripts/b-c-smoke.mjs` (they navigate by hash
  `#/publish` etc., which must keep working). If an existing assertion would need editing, STOP and report.

### Task C1.5: smokes follow the new page

Update `frontend/scripts/browser-mode-smoke.mjs`, `live-host-smoke.mjs`, `narrow-shell.mjs`,
`prod-narrow.mjs` so they drive the new flow. Keep every existing CHECK (an assertion may change its selector,
never its meaning); add checks: one primary per stage; the plan text appears exactly once on the page at
every stage; the rail shows a worker row after drafting and no ASFAI lane online; the tour opens on first
visit and not on reload; "Try it as a student" focuses the student input. Narrow pass at 380 and 320 stays
at zero overflow.

### C1 acceptance
- All suites green with counts and exit codes; `confirm-gate` diff empty; screenshots of every stage at 1440
  and 380 in `docs/design/img/stage-*.png`, referenced from `docs/design/stage-page.md`, read line by line
  for wording before the report.

---

## 6. V1 — verifier (on the C1 branch head)

Artifact: branch `feat/stage-page` in `~/.hermes/profiles/silicus-ta/cache/scratch/wt-stage`. Acceptance:
section 0 defects D1-D9 each have a test that fails on `main` and passes on the branch (spot-check at least
D1, D2, D3, D5 by checking out `main`'s version of the fix file); no route accepts provenance; `activity`
facts carry no material text (run the material-secret scan); `confirm-gate` diff empty; all suites green.
Verdict NO BLOCK / BLOCK with findings by severity, written to
`docs/verification/2026-10-16-tonight-round1.md`.

---

## 7. Orchestrator: integrate, deploy, live-test

1. Merge `feat/stage-page` into `integration/tonight`; `cd frontend && npm ci`; run every suite myself:
   `cd confirm-gate && node --test` · `node --test api/test/` ·
   `cd host && node --test --test-timeout=30000 --test-force-exit` · `cd host && node scripts/e2e-restart.mjs` ·
   `cd frontend && npx tsc --noEmit -p . && npm test && npm run build` · `node frontend/scripts/live-host-smoke.mjs` ·
   `node frontend/scripts/browser-mode-smoke.mjs` · `node frontend/scripts/narrow-shell.mjs`.
2. Real-model local run (scratch `walk-local.mjs`, both with and without ASFAI): the capital-of-France
   question falls back; the plan honours "45-minute lesson"; the rail names the worker.
3. Push `integration/tonight` (needs the owner's word) -> protected preview -> `vercel curl` checks per
   `references/online-deploy.md` -> merge to `main` after V1 NO BLOCK -> `prod-narrow.mjs` on production ->
   Phase B live AI path (needs a working agent browser: quit Brave or turn `browser.use_real_profile` off; the
   cloud browser is out of credit).

## 8. Risks and open questions

- **Same-profile serialization.** C2 and C1 are both creative; C1 waits on C2 anyway. If creative stalls,
  C2 can be reassigned to engineer (`hermes kanban reassign`).
- **Verifier route.** Its log shows a fallback to nous with a 429 and a 600 s retry, and it is busy on an SCA
  card. A verifier that cannot complete is not a pass: record it and get the owner's word before main.
- **Smoke churn.** C1 rewrites the page the smokes drive; the rule "assertions keep their meaning" is the
  guard against a smoke rewritten to pass.
- **Mixed student answers** with `inScope: true` are a prompt-level guard, measured live, not proven.
  A data-scientist eval (20 questions) is the next step if the live check shows leaks.
- **Tour fatigue.** It opens once, never on reload, and is one link away. If Augusto dislikes it, it is one
  flag to remove.
