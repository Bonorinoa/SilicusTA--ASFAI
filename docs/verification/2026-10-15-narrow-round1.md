VERDICT: BLOCK

Independent verification of `fix/narrow` (HEAD cd146a0, "Merge fix/narrow-cards and fix/narrow-shell")
against `main` (e33844f). Worktree: `/Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/wt-verify-narrow`
(`frontend/node_modules` symlinked from the main repo, as instructed).

Model route: `stepfun/step-5-preview:free` via provider `nous` — a different model family from
both producers (the shell/landing round ran on the Claude seat, the cards/engineer round on the
Codex seat). No producer rationale was read or used.

The block is narrow and cheap to clear: the functional work is sound and five of seven criteria
pass on executed evidence. Two criteria fail on hard evidence — C4 (pluralisation is incomplete in
exactly the defect class the user reported) and C7 (the shipped design doc misdescribes the
artifact). Both are a handful of lines.

--------------------------------------------------------------------------------
CRITERIA TABLE
--------------------------------------------------------------------------------

| # | Criterion | Result | Command | Captured exit code |
|---|-----------|--------|---------|--------------------|
| C1a | confirm-gate suites green, 41 | PASS | `cd confirm-gate && node --test` | 0 (tests 41, pass 41, fail 0) |
| C1b | `git diff main -- confirm-gate` empty | PASS | `git diff main -- confirm-gate \| wc -l` | 0 (0 lines) |
| C1c | api suites green, 57 | PASS | `node --test api/test/` | 0 (tests 57, pass 57, fail 0) |
| C1d | host suites green, 255 | PASS | `cd host && node --test --test-timeout=30000 --test-force-exit` | 0 (tests 255, pass 255, fail 0) |
| C1e | host restart e2e, 53 | PASS | `cd host && node scripts/e2e-restart.mjs` | 0 ("53/53 acceptance checks passed") |
| C1f | frontend typecheck | PASS | `cd frontend && npx tsc --noEmit -p .` | 0 |
| C1g | frontend unit tests, 272 | PASS | `cd frontend && npm test` | 0 (Test Files 23 passed; Tests 272 passed) |
| C1h | frontend build | PASS | `cd frontend && npm run build` | 0 |
| C1i | live-host smoke, 62 | PASS | `node frontend/scripts/live-host-smoke.mjs` | 0 ("62/62 live acceptance checks passed") |
| C1j | browser-mode smoke, 145 | PASS | `node frontend/scripts/browser-mode-smoke.mjs` | 0 ("145/145 browser-mode checks passed") |
| C1k | (extra) narrow-shell harness | PASS | `node frontend/scripts/narrow-shell.mjs` | 0 ("16/16 narrow-shell checks passed") |
| C1l | (extra) whitespace hygiene | PASS | `git diff --check` | 0 |
| C2a | The narrow pass has teeth: revert a CSS fix | PASS | reverted `white-space: nowrap` on `PublishCard .confirmStatus`, then `node frontend/scripts/browser-mode-smoke.mjs` | 1 (140/145; 5 FAILs) — restored, re-ran: exit 0, 145/145 |
| C2b | Would the assertions catch right-edge overflow, left-edge overflow, a clipped button label, vertical clipping, a hidden element? | PARTIAL — 2 of 5 caught | own harness `defeat-assertions.mjs` running the smoke's `layoutSnapshot()` verbatim against the built app at 380px | 0 (see findings) |
| C3 | Nothing overflows anywhere, at 320 and 380 | PASS with 1 finding | own harness `verify-layout.mjs`, 26 stages x {320,380} = 52 measurements | 0 (see finding F3) |
| C4 | Pluralisation right everywhere | **FAIL** | source grep + two executed vitest probes | probes exit 1 then 0; see findings F4a/F4b |
| C5 | No regression at wide widths | PASS | `git diff main...fix/narrow -- '*.tsx'`; wide pass inside C1j; own narrow-shell run at 1440 | 0 |
| C6 | Honesty copy untouched | PASS | `git diff main...fix/narrow -- frontend/src`; honesty-string file counts main vs fix/narrow | 0 |
| C7 | `docs/design/narrow-width.md` matches reality | **FAIL** | re-ran `narrow-shell.mjs` on a `main` worktree (e33844f) and on `fix/narrow` | 0 / 0 — the "after" column does not match (see F7) |

Note on C1: `node --test` run from the **worktree root** exits 1, but that is not the specified
command. Node's runner picks up the frontend's vitest files (`ERR_MODULE_NOT_FOUND` on
extensionless TS imports, "Vitest failed to access its internal state"), which is a pre-existing
property of the repo layout, not something this change introduced. The criterion specifies
`cd confirm-gate && node --test`, which is 41/41, exit 0.

--------------------------------------------------------------------------------
FINDINGS
--------------------------------------------------------------------------------

### HIGH

**F1 — C4: "1 minutes" still renders. `frontend/src/components/PlanCard/PlanCard.tsx:124`**

    <span>{totalMinutes} minutes</span>

with `totalMinutes = plan.activities.reduce((n, a) => n + a.minutes, 0)` (PlanCard.tsx:65).

Executed probe (temporary vitest file, since deleted; rendered a real `buildPlanScenario()` plan
with the first activity's `minutes` set to 1):

    PROBE one-minute plan meta: "Ages 8–10 · 1 minutes · 3 activities · Course version 1"

So the card reads "**1 minutes**". The activity count in the *same meta line* (PlanCard.tsx:127)
is correct because it uses an inline ternary — the line is half-fixed. A one-minute plan is a
modelled, reachable state: the round's own new test
`frontend/src/components/PublishCard/PublishCard.test.tsx` constructs
`const activity = { ...ACTIVITIES[0], minutes: 1 }` and asserts "Ready — 1 objective, 1 activity,
1 minute." PlanCard is in the card family this round owns, and `PlanCard.module.css` was edited
by it.

This is the same defect class the user reported ("Ready — 1 objectives"), still live.

**F2 — C4: "All 1 proposals decided" still renders. `frontend/src/components/DecisionCard/DecisionCard.tsx:114` and `:132`**

    ? ` All ${proposals.length} proposals decided — every objective carries your decision.`

Executed probe (temporary vitest file, since deleted; a `ConfirmGateHarness` seeded with exactly
one proposal, accepted):

    PROBE decided: "Objective 1: accepted. All 1 proposals decided — every objective carries
                    your decision. ..."

Both lines are in the very file this round converted to `plural()` — the adjacent
`confirmLabel` (DecisionCard.tsx:143-144) correctly reads "Confirm 1 objective · build the plan".
So the same card shows the right singular in one place and "All 1 proposals" in another.

### MEDIUM

**F3 — C3: one real clip survives, on a surface this branch owns.
`frontend/src/components/AiWaiting/AiWaiting.module.css` `.line` (and `AiWaiting.tsx:135-141`)**

My independent 52-measurement sweep found no page-level horizontal scroll, no element past either
viewport edge, and no clipped control label anywhere. The single exception is AiWaiting's
decorative greeked "lines of type", which are `overflow: hidden` boxes holding `flex: none` words
of fixed `ch` width (`AiWaiting.tsx:139`, `width: ${w}ch`). Measured in every card-variant waiting
state (passcode pause and plan drafting) at both widths:

    320px  line 1: content 283 > box 189  (33% cut)   line 2: 230 > 189 (18% cut)
    380px  line 1: content 283 > box 249  (12% cut)

The element is `aria-hidden="true"` and carries no information, and the page does not scroll — so
this is cosmetic, not an accessibility or comprehension defect. It is reported because (a) the
branch explicitly owns and edited `AiWaiting.module.css`, (b) commit `3c09e13` claims "Nothing
overflows or clips from 320px up", and (c) the smoke's own `clipped` predicate *would* flag it —
it never runs while the waiting card is in its running phase (see F6).

**F4 — C2b: three blind spots in the smoke's narrow assertions.
`frontend/scripts/browser-mode-smoke.mjs:144-183`**

I copied `layoutSnapshot()` verbatim, ran it against the real built app at 380px, and injected one
deliberate breakage at a time (each removed before the next; the app's own ink-line clip was
neutralised first so nothing was masked):

| Injected defect | Smoke says | Why |
|---|---|---|
| box past the viewport's **right** edge (`left:200px; width:400px`) | **FAIL** — `past=1`, `scrollSideways=true` | caught |
| box pushed off the **left** edge (`left:-120px`) | **PASS — not caught** | `past` tests only `rect.right > clientWidth + 1`; `rect.left < 0` is never tested |
| **BUTTON** with a clipped label (70px box, nowrap, 255px label) | **FAIL** — `BUTTON. 255>68` | caught, but only because the predicate whitelists `BUTTON\|INPUT\|TEXTAREA`. Chrome's UA gives a plain `<button>` `overflow-x: visible` (verified: 68 vs 255), so without that whitelist a clipped button label would pass |
| label clipped **vertically** (`height:20px; overflow-y:hidden`, wrapped text) | **PASS — not caught** | `clipped` tests only `scrollWidth > clientWidth`; `scrollHeight` is never looked at |
| masthead tagline **hidden** below 40rem (doc defect #1, the originally reported defect) | **PASS — not caught** | a `display:none` element has a zero rect, so both `past` and `clipped` skip it; nothing in the smoke measures visibility |

So the assertions measure horizontal geometry only. They are strong on that axis (see F5) but a
layout broken vertically, off the left edge, or by removing content entirely passes them. The
left-edge case *is* covered by `frontend/scripts/narrow-shell.mjs` (`r.left < -0.5`, line 163),
which is not in the C1 suite list; the other two are covered by nothing executable except
`narrow-width.test.tsx`'s source-text CSS contract.

**F5 — C2b: the "landing" stage assertion is vacuous, and 17 of 26 reachable stages are never
layout-checked. `frontend/scripts/browser-mode-smoke.mjs:219`**

    async function story(label, narrow) {
      passLabel = label;
      if (narrow) await checkNarrow("landing");      // <-- BEFORE page.goto()

`checkNarrow("landing")` runs before `page.goto()`, i.e. against `about:blank` in a freshly created
browser context. The smoke's own output confirms it measured nothing:

    PASS  [narrow 380] narrow landing: the page does not scroll sideways — scrollWidth 380 vs clientWidth 380

`checkNarrow` is then called at 9 points. Never layout-checked at 380: the three onboarding steps,
the three intake-question screens, the outline confirm, the passcode pause, the running waiting
card, the drafted plan's waiting phase, the student-answer running card, the post-reload event
log, and the footer data controls in either state. The doc's own defect table claims the intake
question at 320px had 4 overflowing elements — a surface the narrow pass never measures.

**F6 — C7: `docs/design/narrow-width.md`'s "after" column describes the wrong artifact.**

The doc's **before** column is accurate and fully reproducible. I created a `main` worktree
(e33844f), copied `narrow-shell.mjs` into it, and ran it. Every number matches:

| doc claim | my measurement on main |
|---|---|
| landing + onboarding: 0 overflow, 320/320 | 0 mine at every width; 320/320 |
| onboarding, intake question @320: 4 overflowing, 971/320 | 4 mine, scrollWidth 971 vs clientWidth 320 |
| materials panel @320: 25 overflowing, 971/320 | 25 mine, 971/320 |
| full live course @320: 6, 600/320; @380: 2, 600/380 | 6 mine 600/320; 2 mine 600/380 |
| record band, delete confirm @320: 6, 600/320; @380: 2, 600/380 | 6 mine 600/320; 2 mine 600/380 |
| defect #3 "left 52 → right 347 (width 295)" | `p "kept in this browser · Ada Lovelace · course urn" — left 52 → right 347 (width 295)` |
| defect #5 "left 52 → right 328 (276 px); the file input alone was 276 px" | `section[Course material] — left 52 → right 328 (width 276)` |
| defect #6 "Status span left 290 → right 402; row content 328 > box 234" | `span "not checked" — left 290 → right 402`; `li ... — content 328 > box 234` |

The **after** column (lines 105-117) is the `fix/narrow-shell` branch measured in isolation,
before the cards round was merged, and it is false for the artifact under review:

| doc line | doc's "after" | my measurement on fix/narrow |
|---|---|---|
| 108 onboarding, intake question 320 | 967 / 320 (still scrolls) | 320 / 320, no sideways scroll |
| 109 materials panel 320 | 967 / 320 | 320 / 320 |
| 111 full live course 320 | 596 / 320 | 320 / 320 |
| 112 full live course 380 | 596 / 380 | 380 / 380 |
| 116 record band 320 | 596 / 320 | 320 / 320 |
| 117 record band 380 | 596 / 380 | 380 / 380 |

And lines 119-122 ("The remaining `scrollWidth` above `clientWidth` at 320–480px is **inside the
cards** ... The harness reports those lines as `(not mine)`") is false for the merged artifact:
my run reports **0** overflowing elements on any surface at any width, cards included, and the
page never scrolls sideways. Lines 114-115 also give a single value (768/768, 1440/1440) with no
before/after, unlike every other row in the table.

Net effect: a reader of the shipped doc concludes the app still scrolls sideways roughly 3x at
320px on four surfaces. It does not. The doc under-claims its own fix.

### LOW

**F7 — `frontend/scripts/browser-mode-smoke.mjs:233-234` makes a claim contradicted by
measurement.** The NOTE says the design-system workbench route "overflows on its own (see the
report's unfixed list)". My harness measured that route at 320 and 380 (`stage 2`):
`scrollWidth 320/320` and `380/380`, clean, zero findings. There is also no "report" file in the
repo to point at. This is the stated reason for not layout-checking the route at 380.

**F8 — C4: remaining un-pluralised counts, all pre-existing and outside this round's stated
surfaces.** Listed for completeness; none is a regression.

| location | rendering | note |
|---|---|---|
| `frontend/src/live/LiveCourse.tsx:330` | `Event log verified — ${r.events} events` | "1 events" |
| `frontend/src/live/LiveCourse.tsx:431` | `log {view.integrity.events} events` | "1 events" |
| `frontend/src/live/MaterialsPanel.tsx:86` | `${m.text.length.toLocaleString()} characters` | "1 characters" |
| `frontend/src/gate/pin.ts:101`, `:107` | `(${current.events} vs ${pin.events} events …)` | pin mismatch detail |
| `frontend/src/browser/BrowserRecord.tsx:57`, `:78` | inline `course${n === 1 ? "" : "s"}` | also yields "0 course" when n=0 |
| `frontend/src/components/DecisionCard/DecisionCard.tsx:135` | `Objectives checkpoint confirmed (3 of 5).` | hardcoded; asserted by the existing test at `DecisionCard.test.tsx:245`, so fixing it requires a test edit — likely out of this round's fence. Flagging rather than blocking. |

**F9 — C5: unconditional (all-width) CSS additions, all cosmetic.**
`overflow-wrap: anywhere` on 21 selectors, `white-space: normal` + `text-wrap: balance` +
`max-width: 100%` on `.primaryButton, .ghostButton, .textButton`
(`LiveCourse.module.css`), and the masthead/colophon row-gap moving from `--space-6` to
`--space-3` (`Workbench.module.css`). At 1440 everything fits on one line, so these have no
visible effect; they are not a meaning change. All gutter and stacking changes are correctly
inside `@media (max-width: 40rem)`. Note the two rounds used *different* narrow breakpoints —
`40rem` for the shell, `34rem` for the cards — which is defensible but worth one line in the doc.

**F10 — C2b: the "confirm button shows its whole label" check is largely redundant.**
`browser-mode-smoke.mjs:180-182` asserts `button.scrollWidth <= button.clientWidth + 1` for one
regex-matched button — the same predicate the generic `clipped` check already applies to every
`BUTTON`. It adds nothing the generic check misses; it reads as belt-and-braces rather than a
distinct guarantee.

--------------------------------------------------------------------------------
WHAT PASSES, ON EVIDENCE
--------------------------------------------------------------------------------

- **C1**: all nine required suites green at exactly the stated counts (41 / 57 / 255 / 53 / 272 /
  62 / 145), plus tsc and build clean, `confirm-gate` byte-identical to `main`, `git diff --check`
  clean, and the producer's own `narrow-shell.mjs` at 16/16.
- **C2a**: the narrow assertions have real teeth. Reverting a *single* CSS property
  (`white-space: nowrap` on `PublishCard .confirmStatus`) produced 5 FAILs and exit 1:
  `scrollWidth 464 vs clientWidth 380` (material panel), `464/380` (confirm bar), `454/380`
  (confirmed objectives), `431/380` (plan card), `431/380` (seal confirm step). Restored →
  145/145, exit 0, worktree pristine. Notably, for that overflow the `past` and `clipped` checks
  both **passed** — the `scrollWidth <= clientWidth` check is the load-bearing one.
- **C3**: 52 independent measurements (26 stages x 320/380) covering landing, the design-system
  workbench, all three onboarding steps, all three intake questions, materials confirm, outline
  confirm, the material panel empty and populated, the passcode dialog, the confirm bar in both
  states, the waiting card, the drafted plan, the seal confirm step, the sealed publish card,
  student chat idle/running/answered, post-reload, the event log, and the footer data controls in
  both states. Zero page-level horizontal scroll, zero elements past either viewport edge, zero
  clipped control labels — everywhere except F3.
- **C5**: 58 wide checks inside 145/145. Every `.tsx` change is either a className addition
  (`CourseLibrary.tsx:38` `rowBody`, `LiveCourse.tsx:428` `stageMeta`) or a plural-label
  conversion. No control added, removed, re-armed, or reworded in a way that changes what the
  teacher agrees to. My own narrow-shell run at 1440: 0 overflow.
- **C6**: no honesty string removed or modified. The only removed `frontend/src` lines are CSS,
  the two local `plural()` definitions, and count labels. File-level counts of "what the model
  sees", "not evidence of learning", "nothing you ask is saved", "zero-data-retention", "never
  sees", "on this device", "This browser keeps the record" are unchanged or up by the new test
  file. `narrow-width.test.tsx` pins them byte-for-byte and passes inside 272/272.

--------------------------------------------------------------------------------
WHAT WOULD CLEAR THE BLOCK
--------------------------------------------------------------------------------

1. `PlanCard.tsx:124` → `{plural(totalMinutes, "minute")}` (import from `../../lib/plural`).
2. `DecisionCard.tsx:114` and `:132` → `plural(proposals.length, "proposal")`.
3. Add a unit test for each, mirroring the two the round already added (they are the right shape).
4. Rewrite the "Before / after" table and the paragraph after it in
   `docs/design/narrow-width.md` from a fresh measurement of **`fix/narrow`**, not of
   `fix/narrow-shell` — or state plainly that the table is the shell branch's own numbers and add
   the merged numbers beside them.
5. Either fix the `.line` clip (F3) or record it in the doc's unfixed list with the measured
   12%/33% figures, so commit `3c09e13`'s "nothing clips" claim stops being absolute.

--------------------------------------------------------------------------------
FENCE COMPLIANCE
--------------------------------------------------------------------------------

Read-only against the artifact. No commit, push, merge, tag or `vercel` command was run; no
`.env` was read or printed; no model network call was made (the only `/api/worker` traffic was the
local scripted mock). All work happened in `wt-verify-narrow`, plus a `main` worktree
(`wt-verify-main`) and my own scripts under the profile scratch dir. Two temporary in-worktree
edits were made and fully reverted: one CSS property (the C2a revert experiment) and two vitest
probe files. `git status --porcelain` is empty and HEAD is still `cd146a0`.

Verification commands and their captured exit codes are in the criteria table. Harnesses written
for this review, all outside the worktree:
`/Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/verify-layout.mjs` (C3),
`/Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/defeat-assertions.mjs` (C2b),
`/Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/ink-line-scope.mjs` (F3),
`/Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/run-c1.sh` (C1).
Raw logs: `verify-c1.log`, `verify-layout.log`, `c2a-revert.log`, `c2a-restored.log`,
`c7-main-before.log`.
