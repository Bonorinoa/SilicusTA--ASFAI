VERDICT: BLOCK

Independent re-verification of `fix/narrow-2` (HEAD `cec73b0`) against the round-1 review base
`cd146a0`. Worktree: `/Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/wt-narrow2-chk`
(detached at `cec73b0`; `frontend/node_modules` symlinked from the main repo, as instructed).
The producer's own worktree `wt-narrow2` (on branch `fix/narrow-2`) was left untouched.

Model route: `stepfun/step-5-preview:free` via provider `nous` — a different model family from
both producers (the shell/landing round ran on the Claude seat, the cards/engineer round on the
Codex seat). No producer rationale was read or used.

The block is one line of prose. Six of seven round-1 findings are genuinely clear on executed
evidence, the flake fix is real rather than cosmetic, and the gate's teeth were re-proven by
reverting this round's own CSS fix. The single blocking item is C5: the re-measured doc states a
count (`14 elements`) that the harness itself reports as `34`.

--------------------------------------------------------------------------------
CRITERIA TABLE
--------------------------------------------------------------------------------

| # | Criterion | Result | Command | Captured exit code |
|---|-----------|--------|---------|--------------------|
| C1a | confirm-gate suites, 41 | PASS | `cd confirm-gate && node --test` | 0 (tests 41, pass 41, fail 0) |
| C1b | `git diff main -- confirm-gate` empty | PASS | `git diff main -- confirm-gate \| wc -l` | 0 (0 lines) |
| C1c | api suites, 57 | PASS | `node --test api/test/` | 0 (tests 57, pass 57, fail 0) |
| C1d | host suites, 255 | PASS | `cd host && node --test --test-timeout=30000 --test-force-exit` | 0 (tests 255, pass 255, fail 0) |
| C1e | host restart e2e, 53 | PASS | `cd host && node scripts/e2e-restart.mjs` | 0 ("53/53 acceptance checks passed") |
| C1f | frontend typecheck | PASS | `cd frontend && npx tsc --noEmit -p .` | 0 |
| C1g | frontend unit tests, 280 | PASS | `cd frontend && npm test` | 0 (Test Files 24 passed; Tests 280 passed) |
| C1h | frontend build | PASS | `cd frontend && npm run build` | 0 |
| C1i | live-host smoke, 62 | PASS | `node frontend/scripts/live-host-smoke.mjs` | 0 ("62/62 live acceptance checks passed") |
| C1j | browser-mode smoke, 206 — run 1 | PASS | `node frontend/scripts/browser-mode-smoke.mjs` | 0 (206/206, 0 FAIL, ~22 s) |
| C1j | browser-mode smoke — run 2 | PASS | same | 0 (206/206) |
| C1j | browser-mode smoke — run 3 | PASS | same | 0 (206/206) |
| C1j | browser-mode smoke — run 4 (extra, timed) | PASS | same | 0 (206/206, elapsed 22 s) |
| C1k | narrow-shell harness, 16 | PASS | `node frontend/scripts/narrow-shell.mjs` | 0 ("16/16 narrow-shell checks passed") |
| C1l | (extra) worktree hygiene | PASS | `git status --porcelain`; `git rev-parse HEAD` | 0 (empty; `cec73b0`) |
| C2 | Every round-1 finding genuinely clear | **PASS with 1 gap** | executed probes (below) | see F-GAP2 |
| C3 | No new defect; no control's meaning or armed state changed; honesty copy untouched | PASS | `git diff cd146a0..HEAD -- '*.tsx'`; honesty-string counts | 0 / 1 (see evidence) |
| C4 | The narrow pass still has teeth after the flake fix | PASS | reverted the F3 CSS rule, re-ran the smoke | 1 (202/206, 4 FAIL) — restored, exit 0 |
| C5 | The docs match the artifact | **FAIL** | `node frontend/scripts/narrow-shell.mjs` | 0 — the doc's count is 14, the harness prints 34 |
| C6 | (round-2 extra) The flake fix is a fix, not a mask | PASS | 4 clean runs + a deliberately stuck-UI run | 0 / 1 (see F-LOW3) |

--------------------------------------------------------------------------------
CLAIM-BY-CLAIM ON THE PRODUCER'S FIVE CLAIMS
--------------------------------------------------------------------------------

CLAIM 1 — F1, F2, F8 now use the shared helper, each pinned by a test.
CLEAR, on probes independent of the added tests. I wrote my own vitest probe file
(`frontend/src/__verifier_probe__/probe.test.tsx`, since deleted) that reuses only the
producer's fixture builders and asserts on the rendered text:

    PROBE  F1 plan meta: Ages 8–10 |  ·  | 1 minute |  ·  | 1 activity |  ·  | Course version 1
    PROBE  F2 decided card: Objective 1: accepted. All 1 proposal decided — every objective carries your decision.
    PROBE  F8a verify notice: Event log verified — 1 event, chain intact.
    PROBE  F8b material row: Lesson notes · 1 character
    PROBE  BrowserRecord n=0 export: "Exported 0 courses to e.json."   (PASS)

All five assertions passed (exit 0); none rendered "1 minutes", "All 1 proposals", "1 events",
"1 characters", or "0 course". The `n === 1 ? "" : "s"` inline form in BrowserRecord.tsx is gone
and `plural()` covers n=0 correctly.

Two counts in words that neither round listed, checked by execution and found NOT to be defects:

    PROBE  CourseLibrary standing (1 of 1): "t · 1 of 1 checkpoints confirmed"
    PROBE  CourseLibrary standing (0 of 0): "t · 0 of 0 checkpoints confirmed"
    PROBE  pin SHORTER detail: "the record is SHORTER than when you pinned (1 vs 3 events — history was removed)"
    PROBE  pin GROWN detail:   "the record has grown since you pinned (1 to 3 events) — expected if you have worked since"

In each the plural head governs a range or a pair, so the wording is right. The producer did not
change `pin.ts:101,107` and did not need to; I confirm that by execution rather than by reading.

CLAIM 2 — F3, the decorative aria-hidden type-lines no longer clip below 40rem.
CLEAR, measured with my own harness at 320 and 380 while the waiting card was running. I copied
the smoke, replaced `checkNarrow` with my own probe (none of the smoke's predicates), and measured
the running card at three waiting states × two widths:

    INKPROBE passcode pause @320: page 320/320 running=true defects=0 inkElements=1
       INK {"display":"none","visibility":"visible","w":0,"h":0,"scrollW":0,"clientW":0,
            "overflowX":"visible","boxW":224,"boxScrollW":221,"boxClientW":221}
    INKPROBE waiting card, proposing objectives @320: page 320/320 running=true defects=0 inkElements=1
    INKPROBE waiting card, drafting the plan @320: page 320/320 running=true defects=0 inkElements=1
    INKPROBE passcode pause @380: page 380/380 running=true defects=0 inkElements=1
    INKPROBE waiting card, proposing objectives @380: page 380/380 running=true defects=0 inkElements=1
    INKPROBE waiting card, drafting the plan @380: page 380/380 running=true defects=0 inkElements=1

The ink container computes `display: none` at both widths, so the 283>189 (320) and 283>249 (380)
clips round 1 measured are gone. The fix is removal of the decoration, not repositioning.

CLAIM 3 — F4/F5/F7: the narrow pass measures after navigation and covers every reachable surface.
CLEAR, and the count is 25 stages (round 1: 9). Every surface round 1 named as unmeasured is now
measured at 380px:

    1 landing                     10 material panel                 19 post-reload event log
    2 design system workbench     11 passcode pause, waiting card   20 published course
    3 onboarding step 1           12 waiting card, proposing        21 footer data controls
    4 onboarding step 2           13 confirm bar, undecided         22 footer data controls,
    5 onboarding step 3           14 confirmed objectives              delete confirm
    6 onboarding: confirm list    15 waiting card, drafting         23 plan card, drafted
    7 intake question 1           16 plan card                      24 seal confirm step
    8 intake question 2           17 publish card, sealed           25 student answer, running
    9 intake question 3           18 outline confirm

The false "workbench overflows" note is gone and replaced by a real measurement
(`browser-mode-smoke.mjs:249`, `checkNarrow("design system workbench")`).

Two reachable states are still not layout-checked, neither of them a distinct surface: the compact
student card's *done* phase (only its running phase is measured) and the fresh landing after
delete-all (the same component already measured at stage 1). I judge neither to be a gap worth
blocking on.

CLAIM 4 — F6, the doc's after column re-measured on the merged branch.
MOSTLY CLEAR. I re-ran `node frontend/scripts/narrow-shell.mjs` (exit 0, 16/16) and checked nine
of the doc's claims against my own numbers. Eight match:

  doc claim                                                    my measurement
  after column, all 10 rows                                    320/320, 380/380, 480/480 ... 0 overflowing, mine
  "the page never scrolls sideways, at any width"              0 sideways scroll at 320/380/480/768/1440 × 5 surfaces
  "the shell's own surfaces report zero overflowing elements"   21 of 25 stage-widths report `mine: 0`
  "(not mine) ... at 320px only"                               true: 0 at 380/480/768/1440
  "TimelineCard's and DecisionCard's inner rows"               28 TimelineCard + 6 DecisionCard
  "the smoke's stricter predicate ... reports zero there"      my own 320px run of the smoke: 153/153, 0 FAIL
  "At 380px and up the cards are clean under both"             confirmed
  "the waiting card adds a 40rem rule of its own"              AiWaiting.module.css:114-116 exists
  "40rem in the shell's sheets, 34rem in the cards'"           Workbench 40rem, LiveCourse 40rem, OnboardingChat 40rem;
                                                               DecisionCard/PlanCard/PublishCard/AiWaiting 34rem
  "narrow-width.test.tsx — 10 tests"                           10

One does not: the count. That is the blocking finding, F-DOC1 below.

CLAIM 5 — the smoke harness flake fix. Judged: 4 clean runs, and a stuck UI still fails.
CLEAR on the substance. I ran the full smoke four times on this branch:

    RUN1 EXIT=0   206/206
    RUN2 EXIT=0   206/206
    RUN3 EXIT=0   206/206
    RUN4 EXIT=0   206/206   (elapsed 22 s)

The flake is not merely hidden. To test that directly I made a control genuinely dead — I replaced
the "Delete all data from this browser" onClick with a no-op, so the confirm panel can never
appear — and ran the smoke:

    NODE_EXIT=1  ELAPSED=144s
    FAIL  [wide 1440] the whole flow completed — Error: poll timed out
        at poll (browser-mode-smoke.mjs:58:9) at async clickAndWait (browser-mode-smoke.mjs:200:18)
    FAIL  [narrow 380] the whole flow completed — Error: poll timed out ...
    184/186 browser-mode checks passed

So `clickAndWait` retries three times and then throws; a genuinely stuck UI fails the gate, it
just takes ~61 s per pass to say so instead of ~12 s. The longer budget is a loosening on
non-latency polls only — the three explicitly latency-sensitive budgets are untouched
(`browser-mode-smoke.mjs:330` 15000, `:381` 8000, `:384` PLAN_MS, `:390` PLAN_MS+15000), so the
"the clock actually runs" and "taking longer than usual" assertions keep their teeth, and the
documented `SILICUS_SMOKE_PLAN_MS=28000` mode still works. No defect is masked; two costs are
recorded as F-LOW3 and F-LOW4.

--------------------------------------------------------------------------------
FINDINGS
--------------------------------------------------------------------------------

### BLOCKING

**F-DOC1 — C5: the re-measured doc states a count the harness contradicts.
`docs/design/narrow-width.md:131`**

    What `narrow-shell.mjs` still marks `(not mine)` is the cards' sheets at **320px only** —
    TimelineCard's and DecisionCard's inner rows (14 elements on the full-course and record-band
    views, which share the same card stack) whose own box is narrower than the content it holds.

Command: `node frontend/scripts/narrow-shell.mjs` — captured exit code 0. Its own headline:

    NOTE: 34 overflowing element(s) on surfaces owned by the parallel card round
          (TimelineCard (other agent), DecisionCard (other agent))

Per view, from the same run:

    full live course            @320   other agent's surfaces: 14
    record band, delete confirm @320   other agent's surfaces: 14
    materials panel             @320   other agent's surfaces: 4
    onboarding: intake question @320   other agent's surfaces: 2
                                  ---
                                  34

The doc's `14` covers the two views it names only if read as "14 per view" (which the clause
"which share the same card stack" does support, giving 28). It omits the 6 elements on the
materials-panel and intake-question views entirely, and it reconciles with neither reading of the
harness's printed `34`. Every other claim in the paragraph — 320px only, TimelineCard and
DecisionCard rows, box narrower than content, the smoke's stricter predicate reporting zero, clean
at 380px and up — is true and verified. This is the same criterion (C5/C7) that blocked round 1,
and it is a one-line fix.

WHAT CLEARS IT: state the number the harness prints, or state the split. For example: "…
TimelineCard's and DecisionCard's inner rows — 34 in all on this branch: 14 each on the full-course
and record-band views (which share the same card stack), 4 on the materials panel and 2 on the
intake question — whose own box is narrower than the content it holds." Any wording that reconciles
with `NOTE: 34` and names all four affected views is sufficient.

### MEDIUM

**F-GAP2 — C2: round-1 F4's three assertion blind spots are still there.
`frontend/scripts/browser-mode-smoke.mjs:157-172`**

Round 1 found the smoke's `layoutSnapshot()` measures horizontal geometry only: `past` tests
`rect.right > clientWidth + 1` and never `rect.left < 0`; `clipped` tests `scrollWidth > clientWidth`
and never `scrollHeight`; a `display:none` element has a zero rect so both predicates skip it, and
nothing measures visibility. This round added coverage (F5/F7) but not predicates, so all three
blind spots survive unchanged.

They are currently latent, not live. My own probe (`inkProbe`, none of the smoke's predicates)
measured all 25 stages at 320 and 380 — 56 measurements — with left-edge, vertical-clip and
visibility checks included, and found zero defects:

    56 INKPROBE measurements (25 stages × 2 widths, +6 repeats at the waiting stages)
    0 DEFECT lines

So the artifact is clean under predicates stricter than the gate's. I am not blocking on this: it
was not in the round-2 brief's scope, and it hides nothing today. It is recorded because C2 asks
for every round-1 finding to be clear and this one is not — the producer's answer is that the
brief named coverage, not predicates, which I accept as the reason.

### LOW

**F-LOW3 — the gate is ~5× slower to report a genuinely dead control.**
`frontend/scripts/browser-mode-smoke.mjs:196-201` (`clickAndWait`) and `:52` (`poll` default
12000 → 20000). Measured: a stuck "Delete all data" button takes 144 s to fail, against a 22 s
clean pass. Round 1's single `poll(12000)` would have failed in ~12 s. The retry is the right
shape (three attempts, then throw — verified above), but the budget could be per-call: `poll`'s
20 s default is inherited by `clickAndWait`, so one dead control costs 3 × 20 s. Passing an
explicit smaller budget to the two `clickAndWait` call sites would keep the flake fix and the fast
failure.

**F-LOW4 — `PROPOSE_MS` introduces a race in the opposite direction.**
`frontend/scripts/browser-mode-smoke.mjs:78-80` adds a 600 ms delay to the "Propose learning
objectives" prompt so the running waiting card is measurable (a legitimate technique — it adds
latency, it removes none). But `:329` then does
`await page.waitForSelector('section[data-phase="running"]', { timeout: 5000 })`. If the running
card finishes before that line executes, the wait times out and the stage FAILs — a new flake
source replacing the old one. My four runs are clean, and 600 ms against a 5 s timeout is a wide
margin, so the risk is low; it is noted because "the flake is gone" currently rests on four runs,
not on a mechanism that cannot race.

**F-LOW5 — the F3 CSS comment describes the rule inaccurately.
`frontend/src/components/AiWaiting/AiWaiting.module.css:110-115`**

    …so below 40rem they rest instead of clipping — the wording and the clock carry the state,
    not the ink. */
    @media (max-width: 40rem) { .ink { display: none; } }

My measurement shows `display: none`, i.e. the lines are removed, not at rest. Cosmetic wording in
a comment, but the comment carries measured numbers a reader may check.

**F-LOW6 — pre-existing doc looseness, unchanged by this round.
`docs/design/narrow-width.md:75`** names `CourseLibrary.module.css` as one of the four sheets with
"one breakpoint throughout … 40rem". That file contains no `@media` rule at all
(`grep -c '@media'` → 0); its only narrow-relevant change is an all-width `max-width: 100%` on its
two buttons (line 13). This text predates `cd146a0` and round 1 did not flag it, so it is not a
regression; it is listed because the same sentence now also carries the corrected 40rem/34rem
note, and a reader will check it.

--------------------------------------------------------------------------------
WHAT PASSES, ON EVIDENCE
--------------------------------------------------------------------------------

- **C1**: all eleven required commands green at exactly the stated counts — 41 / 0-line diff / 57 /
  255 / 53 / tsc 0 / 280 / build 0 / 62 / 206 / 16. The frontend count rose from 272 to 280, the
  smoke from 145 to 206, both by exactly the added tests and stages.
- **C2 (the round-1 findings that matter)**: F1, F2, F3, F5, F7, F8 all clear on executed probes,
  not on the tests added for them. F4 (this round's numbering — coverage) is clear at 25 stages.
- **C3**: the entire non-test `.tsx` delta is six count labels and three `plural()` imports. A grep
  of the diff for `onClick|onChange|disabled|aria-|data-verb|data-phase|data-variant|type="button"|
  value=|useState|useRef|ref=` returns exactly two lines, both inside the new
  `DecisionCard.test.tsx`. No control was added, removed, re-armed or reworded. Eleven honesty
  strings compared file-by-file between `cd146a0` and HEAD: ten identical, and the eleventh
  ("Every record was checked") is 1 → 2 only because the new `BrowserRecord.test.tsx` asserts it.
  `OnboardingChat.tsx`'s long-string set is byte-identical.
- **C4 — the narrow pass has teeth after the flake fix.** I reverted this round's own F3 rule
  (`AiWaiting.module.css` `@media (max-width: 40rem) { .ink { display: none } }`) and re-ran the
  smoke: exit 1, 202/206, four FAILs —

      FAIL  [narrow 380] narrow passcode pause, waiting card held: no element's content is clipped
            by its own box — DIV._line_jla8e_33 283>249
      FAIL  [narrow 380] narrow waiting card, proposing objectives: … DIV._line_jla8e_33 283>249
      FAIL  [narrow 380] narrow waiting card, drafting the plan: … DIV._line_jla8e_33 283>249
      FAIL  [narrow 380] narrow student answer, running: … DIV._line_jla8e_33 283>223

  Three of the four fire at stages that did not exist in round 1 — so the new coverage has teeth
  for exactly the defect round 1 could not catch. Restored → exit 0, 206/206, worktree pristine.
- **The flake fix is honest.** Four clean runs, and a deliberately dead control still fails the
  gate. `clickAndWait` throws after three attempts; the raised budget loosens only non-latency
  polls, and the latency-sensitive budgets are untouched. Nothing is masked.

--------------------------------------------------------------------------------
FENCE COMPLIANCE
--------------------------------------------------------------------------------

Read-only against the artifact. No commit, push, merge, tag or `vercel` command was run; no `.env`
was read or printed; no model network call was made (the only `/api/worker` traffic was the local
scripted mock). All work happened in `wt-narrow2-chk`; the producer's `wt-narrow2` worktree was
not touched.

Temporary in-worktree edits, all fully reverted and verified by `git status --porcelain` (empty)
with HEAD still `cec73b0`:
  1. the smoke's width array patched to `[[320, 900, "narrow 320"]]` — my own 320px run (153/153);
  2. the F3 CSS rule reverted — the C4 teeth test (exit 1, 4 FAILs), then restored;
  3. `BrowserRecord.tsx`'s delete onClick replaced with a no-op — the stuck-UI test (exit 1), then
     restored;
  4. `frontend/scripts/__verifier_ink.mjs` — my own harness, deleted;
  5. `frontend/src/__verifier_probe__/{probe,probe2}.test.tsx` — my own probes, deleted.

Verification commands and their captured exit codes are in the criteria table. Logs:
`n2r2-narrowshell.log`, `n2r2-smoke-{1,2,3,4}.log`, `n2r2-smoke-320.log`, `n2r2-inkprobe-all.log`,
`n2r2-teeth-revert.log`, `n2r2-stuck.log`, `n2r2-frontend.log`, `n2r2-live.log`, `verify-c1a.log`,
`verify-c1b.log` — all under
`/Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/`.
