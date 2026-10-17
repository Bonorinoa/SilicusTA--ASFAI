VERDICT: NO BLOCK

# V1 — independent verification of `feat/stage-page` (2026-10-16, round 1)

Verifier: profile `verifier`, model route `deepseek/deepseek-v4.1-flash` via provider `nous`
(task `model_override`, run_id 72). Fence honored: read-only; the only file written under the
worktree is this report.

- Artifact under test: branch `feat/stage-page`, committed HEAD `fbc57509f4463fae794740cc22842c984945096b`.
- Worktree: `/Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/wt-stage`.
- Base for comparison: `integration/tonight` (`ecce485`) and `main` (`d04e162`) in
  `/Users/bonorinoa/Hermes/Projects/silicus-asfai-handoff`.
- Node v22.22.3; `frontend/node_modules` symlinked to the handoff checkout, as designed.

## 5. Every suite green (counts + real exit codes)

All commands run from the worktree at HEAD `fbc5750`; exit codes captured directly (not through a pipe's tail).

| Suite | Command | Result | Exit |
|---|---|---|---|
| confirm-gate | `cd confirm-gate && node --test` | 41 pass / 0 fail | 0 |
| api | `node --test api/test/` | 57 pass / 0 fail | 0 |
| host | `cd host && node --test --test-timeout=30000 --test-force-exit` | 276 pass / 0 fail | 0 |
| e2e-restart | `cd host && node scripts/e2e-restart.mjs` | 53/53 acceptance checks | 0 |
| frontend tsc | `cd frontend && npx tsc --noEmit -p .` | no diagnostics | 0 |
| frontend unit | `cd frontend && npm test` | 388 pass / 0 fail (31 files) | 0 |
| frontend build | `cd frontend && npm run build` | built (118 modules, index 405.90 kB) | 0 |
| live smoke | `node frontend/scripts/live-host-smoke.mjs` | 77/77 | 0 |
| browser smoke | `node frontend/scripts/browser-mode-smoke.mjs` | 219/219 | 0 |
| narrow shell | `node frontend/scripts/narrow-shell.mjs` | 16/16 | 0 |

Growth vs the plan's baselines (§2) — no suite lost tests, all gained: confirm-gate 41→41,
api 57→57, host 262→276, e2e 53→53, frontend 286→388, live 62→77, browser 208→219, narrow 16→16.

## 1. D1–D9 each have a test that fails on the base and passes on the branch

Method per defect: keep the branch test, restore the base version of the fixed source file
(`git show integration/tonight:<file>`), run the named test, observe failure, then
`git checkout HEAD -- <file>` and confirm `git diff --quiet HEAD -- <file>` (all restores verified clean).
This matches the plan's §6 spot-check procedure.

| # | Fixed file reverted to base | Test | On base | On branch |
|---|---|---|---|---|
| D1 | `frontend/src/live/LiveCourse.tsx` | `LiveCourse.stage.test.tsx > D1: …` (4 tests) | 4 FAIL | pass |
| D2 | `frontend/src/live/LiveCourse.tsx` | `LiveCourse.stage.test.tsx > D2: …` (3 tests) | 3 FAIL | pass |
| D3 (words) | `frontend/src/live/LiveCourse.tsx` | `LiveCourse.stage.test.tsx > D3 in words: …` | 1 FAIL | pass |
| D3 (codes) | `host/reasons.mjs` absent (new on branch, absent on base) | `cd host && node --test test/reasons.test.mjs` | 1 FAIL (module not found) | pass |
| D4 | `frontend/src/live/LiveCourse.tsx` | `LiveCourse.stage.test.tsx > D4: … AWAITING_TEACHER_REPLY` | 1 FAIL | pass |
| D5 | `host/worker.mjs` | `cd host && node --test test/student.test.mjs` → `not ok 9 - an answer the package does not cover falls back, fail-closed on inScope (the capital-of-France leak)` | 2 FAIL | pass |
| D6 | `host/sources/asfai-graph.mjs` | `cd host && node --test test/source-asfai-graph.test.mjs` → `not ok 9 - a name that already carries an age phrase gets exactly ONE age phrase in its label` | 1 FAIL | pass |
| D7 | `host/worker.mjs` | `cd host && node --test test/worker.test.mjs` → `not ok 38/39 - the course answer is in the plan prompt …` | 2 FAIL | pass |
| D8 | `frontend/src/live/LiveCourse.tsx` | `LiveCourse.stage.test.tsx > D8: …` (2 tests) | 2 FAIL | pass |
| D9 | `frontend/src/workbench/Workbench.tsx` | `npx vitest run src/workbench/Workbench.masthead.test.tsx` | 3 FAIL | pass |

Representative raw output (base `LiveCourse.tsx`): `Tests 25 failed | 2 passed (27)` in
`LiveCourse.stage.test.tsx`; the D1/D2/D3-words/D4/D8 describes are all in the failing set
(`npx vitest run src/live/LiveCourse.stage.test.tsx --reporter=verbose`, exit 1).
All reverts restored; `git status` shows no source file modified by this verification.

## 2. No route accepts provenance / turnRef / decidedBy / channel

- `grep -rn "provenance\|turnRef\|decidedBy\|channel" host/handler.mjs` → the only hit is the
  header comment (`host/handler.mjs:16`) stating no field accepts them; the route bodies
  (`handler.mjs:135-298`) destructure intents only (`{ verb, proposalId, statement, text }`).
- The host mints provenance itself (`host/course.mjs:153-154 #prov`), and each decision verb is
  cut to the fields it uses before logging (`host/course.mjs:428-437`).
- `cd host && node --test --test-timeout=30000 test/decisions-whitelist.test.mjs` → 2 pass / 0 fail,
  exit 0. The test posts forged `provenance`, `decidedBy`, `turnRef`, an invented `urn:uuid`,
  and an `mt_*` alignment, then asserts none reaches the data directory and `verify.ok === true`.

## 3. `view.activity` facts carry no material text

Independent probe (script in the verifier scratch dir, not the repo) drives the real HTTP story with
`MATERIAL_SECRET = "TANGERINE-OCELOT-5521"` from `host/test/scripted-course.mjs`, then scans the
serialized view JSON and every byte of the temp data dir:

```
SECRET = TANGERINE-OCELOT-5521
views scanned = 1
view hits = 0
data-dir hits = 0
activity rows in last view = 11
materials fact example = {"count":3,"materials":1,"characters":132}
VERDICT = CLEAN   (exit 0)
```

Confirmed by the suite's own teeth: `host/test/activity.test.mjs` (part of the host 276) asserts
`JSON.stringify(view.activity).includes(MATERIAL_SECRET) === false` for every view in the scripted
transcript, and `facts` are counts/names/flags only (`typeof` swept per row).

## 4. `git diff main -- confirm-gate` is empty

`git diff main -- confirm-gate` → no output, exit 0. Also empty against `integration/tonight`
(`git diff integration/tonight -- confirm-gate`), and `api/` is unchanged (`git diff --stat main -- api` empty).

## 6. Smoke rewrites kept their meaning

Diffed committed `frontend/scripts/{live-host-smoke,browser-mode-smoke,narrow-shell}.mjs` vs
`integration/tonight`. Changes are additions of new stage/tour/rail checks plus three rewrites; I
found no assertion that became weaker:

- Plan-draft trigger: `"Draft the plan from your confirmed objectives"` → `"Confirm N objectives · build the plan"`.
  Same act (a click that POSTs `/plan`), new wording — the separate button was removed by D1. The
  live smoke still asserts the resulting host state, not just the DOM.
- Intake attribution (live): the search for a stray `"ASFAI"` span is scoped to
  `section[aria-label="Course intake"]` because the rail's lane key now also names ASFAI. The claim
  ("the local questions are not attributed to ASFAI") is unchanged and still asserted.
- Published-moment sentence: `bodyHas("A draft is never what students see")` was replaced by
  `bodyHas("Students read this version")` in the published assertion, and the old sentence is
  asserted by a NEW check while drafting v2. Meaning preserved, coverage increased.
- Pin / verify-log checks now open the `Record details` disclosure first (a reload closes it); the
  assertions themselves are byte-for-byte the same.
- `narrow-shell.mjs`: only the plan-button rename. No check removed.
- `browser-mode-smoke.mjs` adds an on-failure `[dump]` diagnostic line only (inside the `catch`); no assertion touched.

## 7. Honesty copy

- No progress bar or percentage: `grep -rniE "progressbar|percentage"` in `frontend/src` finds only
  the two comments (`ActivityRail.tsx:9`, `AiWaiting.tsx:8`) that state there is none; no rendered `%`.
- Zero-retention is claimed only on `zdr === true` — `ActivityRail.tsx:139`, `AiWaiting.tsx:191-199`,
  `MaterialsPanel.tsx:79-81`; `zdr === false` prints the normal-retention sentence, `null` prints nothing.
- No "verified/secure/proof" language about the log: the only log-language is the integrity check
  ("Verify the event log" → "chain intact", `LiveCourse.tsx:373`) and the tour's explicit
  "It is evidence of what was decided, not proof of who decided it" (`FirstRunTour/panels.ts:37`).
  `PlanCard.module.css:45` deliberately avoids green "confirmed" text.
- Nothing implies the AI decided: `ActivityRail/lanes.ts` — worker "proposes and drafts, never decides";
  `AiWaiting.tsx:119` — "The AI is drafting · nothing is decided yet"; `FirstRunTour/panels.ts:25` —
  "The AI proposes, you decide."

## Findings by severity

### Blocker — none

### Minor

1. **Rail decision counts never render (facts-key drift between lanes).**
   `host/activity.mjs:16` emits decision counts under verb keys
   `accept, rename, reword, drop, add`, while the rail reads
   `accepted, renamed, dropped, added` (`frontend/src/components/ActivityRail/copy.ts:13,68`) and the
   design note documents the latter (`docs/design/behind-the-scenes.md:91,181`). Result: the sentence
   "Your decisions: 2 accepted, 1 renamed" never appears; the rail silently falls back to the generic
   "Decided on the proposed objectives". Cosmetic only — no data leak, no honesty issue, every suite
   still green. Note this is the same drift the C1.5 handoff already listed as "open for integration";
   it was not reconciled upstream. Fix is one of: change `VERBS` in the host, or change the four keys
   in `copy.ts` (and the doc table) to match.
   Evidence: `node --test ... test/activity.test.mjs` asserts `{ decisions: 3, accept: 1, rename: 1, add: 1 }`
   (host keys), while `copy.ts` reads the `-ed` forms.

### Info / coordination (no block)

2. **A second worker is mutating the same worktree during this verification.** Task `t_4d77cc67`
   (`creative`, "stage-page screenshots …") has `workspace_path` = this same
   `.../scratch/wt-stage`, and mid-run it added an uncommitted `stageShot(...)` block to
   `frontend/scripts/browser-mode-smoke.mjs` and ~30 untracked `docs/design/img/stage-*.png`. This
   report verifies the committed HEAD `fbc5750`; the uncommitted script edit is assertion-neutral
   (guarded by `if (!SHOTS) return;`), and the committed-diff review in §6 uses committed revisions
   only. Flagged because the artifact directory is not exclusive to the verifier: if that worker
   commits to `feat/stage-page`, the branch will move past the SHA verified here and re-verification
   would be needed.
3. **`narrow-shell` at 320 px.** The C1.5 handoff reports 28 report-only `TimelineCard`/`DecisionCard`
   overflow notes at 320 px (pre-existing on the base, which reported 34) and that the page does not
   scroll sideways — consistent with my `16/16` pass, but I did not independently re-measure the
   320 px overflow count. Reported as-is; not a defect introduced tonight.
4. **`frontend/scripts/prod-narrow.mjs`** is syntax-checked only (not run against production), per the C1.5 handoff.

## What was not verified by me

- Anything requiring the network/host-browser (`vercel`, the deployed preview, the live AI path) — orchestrator's §7.
- Real-model behavior (capital-of-France fallback, the 45-minute plan) — orchestrator's real-model run.
- The screenshots/design note for the stage page — the separate creative card `t_4d77cc67` (running).
