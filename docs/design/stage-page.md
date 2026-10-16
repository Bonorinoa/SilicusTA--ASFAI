# The stage page: one stage at a time

Branch `feat/stage-page`. The course page used to show everything the course had ever done, all at once, with a
button for every step visible from the first minute. It now shows **one stage**, with **one primary action**, and the
background work (who did what to which artifact) sits in a rail beside it instead of in the reading path.

Every picture below is a real capture of the running app (`frontend/scripts/browser-mode-smoke.mjs`, the online
build, model mocked in the page), at 1440 px and at 380 px. Nothing is mocked-up by hand.

Two things to know when reading the pictures. The drafting model is a stub in the smoke, so the plan's text is the
stub's ("Look at a leaf.", "Took 0 s", "Activity 1: Activity 1" in the student's answer). And the pages are still
tall (2,000 to 3,200 px at 1440): the plan sheet and the rail's list of steps take most of it. Shorter than
before, not short.

## What changed, and why (D1 to D9)

The 15 October walkthrough found nine defects. Each is now a test; here is what the teacher sees instead.

```
 D1  "Confirm 3 objectives · build the plan" did nothing; a second button did the work.
     Now it is the one button, wired, and gone once the plan exists.
 D2  The lesson plan was on the page twice (5,600 to 7,000 px pages).
     Now once, at every stage. "Look at a leaf." x6 before, x3 after (3 activities).
 D3  "checkpoint "files" is not teacher-confirmed" and urn lists in the publish card.
     Now a sentence per reason ("Confirm the material list"). The gate's text is under Record details.
 D4  Host-guard developer text in the intake ("... before calling prepare_outline again").
     Now "Answer the questions above, then send them." The host's wording is under Record details.
 D8  "Course recorded. Confirm the material list when it is right." stayed on screen through publish.
     Now a notice clears when the stage changes.
 D9  The local app wore the developer header ("design workbench · tokens-first", six tabs).
     Now the same product masthead as the online app; the workbench is a quiet "Design system" link in the footer.
```

(D5, D6, D7 are host defects, fixed on `feat/host-contract`; they do not show on the page.)

### Before and after, measured

Same course, same flow, 1440 px wide. "Before" is production on 15 October.

```
                                   before      after
 objectives decided                3,089 px    2,011 px
 plan drafted                      5,646 px    2,499 px
 published                         6,773 px    2,916 px
 plan text on the page             twice       once
 urn / "log N events" /           header and  Record details (one colophon line
   turn refs in the reading path   timeline     on the plan sheet still prints two urns)
 ways forward at objectives        3 at once   1 (draft, confirm and seal buttons all showed before)
```

![Before: objectives decided. A separate "Draft the plan" button, a "Review & publish" button and a "Confirm" bar, all at once](img/before-stage-objectives.png)

*Before, half size. Three ways forward at once, and the seal button already showing.*

![Before: plan drafted, the plan twice](img/before-stage-plan.png)

*Before, half size. The plan renders in its own card, then again inside the publish card.*

![Before: published](img/before-stage-published.png)

*Before, half size. After publishing: the confirm-the-objectives bar is still armed, the plan is twice on the page, and urns and turn references run down the bottom.*

## The stage model

`frontend/src/live/stage.ts`, `stageOf(view)`. It reads the host's own view and chooses **which card to show**.
It decides nothing the host decides: every verb still leaves as an intent and the gate still rules.

```
  intake ─▶ material ─▶ objectives ─▶ plan ─▶ publish ─▶ published
    │          │            │          │        │           │
    │          │            │          │        │           └ a version exists, nothing pending
    │          │            │          │        └ plan confirmed, nothing sealed
    │          │            │          │          (or: drafting version N+1)
    │          │            │          └ objectives confirmed, plan missing / draft / invalidated
    │          │            └ proposals exist and some are undecided
    │          └ outline confirmed, outcomes come from the materials, nothing proposed yet
    └ material list or outline not confirmed

  step index:  1 Material · 2 Outline · 3 Objectives · 4 Plan · 5 Publish     (finished ones ticked)
```

One consequence worth stating plainly: the host confirms the objectives checkpoint by itself the moment every
proposal carries a decision. So the **plan stage begins right then**, and its first sight is the decided
objectives with the button "Confirm N objectives · build the plan". The step index is therefore already on
"4 Plan" while the objectives card is on screen (see the findings at the end).

Finished stages fold into one-line summaries with a "Show" button; future stages are not drawn at all.

### One primary per stage

```
 stage                    the one filled button
 intake                   Record this answer / Confirm the material list / Confirm the outline
 material                 Propose objectives from my materials
 objectives (deciding)    Confirm N objectives — N decisions left   (disabled until every proposal is decided)
 plan, no plan yet        Confirm N objectives · build the plan
 plan, drafted            Confirm the lesson plan            (BELOW the plan it confirms)
 publish                  Review & publish first version     (then: Publish version 1)
 published                Try it as a student                (Download, Export, Revise are quiet)
```

The smoke asserts `[data-primary="true"]` is exactly one on screen at objectives (decided), plan, publish and published, in both widths. The intake, material and deciding rows are by construction (one `data-primary` per card), not yet asserted.

## The stages, 1440 px and 380 px

### 1. First visit: the tour, then the first question

The tour opens once, on a first visit with no course, and not again on reload. "Start my course" (or Close)
puts the cursor in the first question. A quiet "How it works" link in the masthead reopens it.

![Tour, 1440](img/stage-01-tour-1440.png)
![Tour, 380](img/stage-01-tour-380.png)

![First question, 1440](img/stage-02-landing-first-question-1440.png)
![First question, 380](img/stage-02-landing-first-question-380.png)

### 2. Confirm the material list, then intake

The three opening turns (title, name, materials) are kept, with the verb "Record". The rail already shows
"Started this course" by the teacher.

![Confirm material list, 1440](img/stage-03-confirm-material-list-1440.png)
![Confirm material list, 380](img/stage-03-confirm-material-list-380.png)

![Intake, 1440](img/stage-04-intake-1440.png)
![Intake, 380](img/stage-04-intake-380.png)

### 3. Material

![Material, 1440](img/stage-05-material-1440.png)
![Material, 380](img/stage-05-material-380.png)

### 4. Objectives: proposed, then decided

Proposed: the receipt of the drafting step sits under the proposals ("3 proposals. None is confirmed until you
decide."). Decided: the confirm bar sits below what it confirms.

![Objectives proposed, 1440](img/stage-06-objectives-proposed-1440.png)
![Objectives proposed, 380](img/stage-06-objectives-proposed-380.png)

![Objectives decided, 1440](img/stage-07-objectives-decided-1440.png)
![Objectives decided, 380](img/stage-07-objectives-decided-380.png)

### 5. Plan: drafting, then drafted

While the model works: the honest waiting card (what it is doing, usual range, what it sees, what it never sees).
Drafted: the plan once, then the receipt, then the one primary below.

![Plan drafting, 1440](img/stage-08-plan-drafting-1440.png)
![Plan drafting, 380](img/stage-08-plan-drafting-380.png)

![Plan drafted, 1440](img/stage-09-plan-drafted-1440.png)
![Plan drafted, 380](img/stage-09-plan-drafted-380.png)

### 6. Publish

The plan appears once, inside the publish card, with what the seal will contain. Sealing asks once more.

![Publish, 1440](img/stage-10-publish-1440.png)
![Publish, 380](img/stage-10-publish-380.png)

![Seal confirm (the publish card, element crop), 1440](img/stage-11-seal-confirm-1440.png)
![Seal confirm (the publish card, element crop), 380](img/stage-11-seal-confirm-380.png)

### 7. The published moment

"Version 1 is published", who sealed it and when, then three outward actions in a fixed order: **Try it as a
student**, Download the student handout, Export the package. "Revise this course" is a ghost button. Decided
objectives are read-only until Revise is pressed.

![Published, 1440](img/stage-12-published-1440.png)
![Published, 380](img/stage-12-published-380.png)

### 8. A student asks

"Try it as a student" scrolls to the student chat and focuses its question box. Nothing asked here is saved.

![Student answer, 1440](img/stage-13-student-answer-1440.png)
![Student answer, 380](img/stage-13-student-answer-380.png)

## The rail and the tour, in context

The rail ("Behind the scenes") answers one question: *which part of this system did what, to which artifact?*
Three lanes online (You, Silicus, Drafting model), a fourth (ASFAI) only when ASFAI is connected. It is drawn from
the host's `activity` list, so it says only what the record says. At 1440 it sits beside the stage and is
open; at 380 it is a disclosure under the stage, closed until asked. Below: open, after publishing.

![Rail open, 1440 (element crop)](img/stage-14-rail-open-1440.png)
![Rail open, 380 (element crop)](img/stage-14-rail-open-380.png)

The tour and the rail are standalone components (see `behind-the-scenes.md`); the page only mounts them and feeds
the rail the in-flight step (worker while objectives, plan and answers are drafted; ASFAI while it asks or checks).

## Copy, read line by line

Method: every capture has its words dumped beside it (the page's `innerText`, same moment), so I read the exact
strings, then looked at each image for what words cannot show (primary, clipping, repetition). N = 1 was read from a
second render of the stage views with one objective, one activity, one material (the stage test's own fixtures).

Passes:
- Plurals at N = 1 (read in the second render): "Confirm 1 objective · build the plan", "All 1 proposal decided",
  "Objectives decided · 1 objective", "Ready — 1 objective, 1 activity, 20 minutes.", "Lesson plan confirmed ·
  1 activity, 20 minutes", "Material list confirmed · 1 material". The rail's sentences are built by `plural()` in
  `ActivityRail/copy.ts` (its own tests cover one). None reads "1 objectives". ("All 1 proposal decided" is
  correct but clumsy.)
- Locks. No zero-retention sentence appears unless the status says `zdr: true` (the material stage shows it because
  the smoke's status says so; the smoke asserts it). "Evidence, not proof": the page says "Asking here is not
  evidence of learning", "chain intact", never "verified" as a badge. Nothing implies the AI decided: the rail
  attributes every decision to "You", the model's rows read "proposes and drafts, never decides", receipts say
  "Nothing is decided yet" / "None is confirmed until you decide".

**Fixed (test first, `frontend/src/live/OnboardingChat.tsx`).** The hint under an unanswered intake question read
"Recorded on this course." in the past tense, with an empty box above it, and then the same words again under the
recorded answer. Before the teacher has pressed anything it is a promise, not a report. Now: "Recorded on this
course when you press Record this answer." (the local app keeps "Not sent to ASFAI."; the ASFAI wording keeps "sent
only when you send the round"). Test: `LiveCourse.stage.test.tsx`, "the hint under an unanswered question promises,
it does not report" (failed before the change, passes after).

**Found, not fixed: outside this card's fence (components are not `frontend/src/live/**`).** For the orchestrator
to route:

1. `components/PublishCard/PublishCard.tsx:236`: "Sealing is irreversible — preview is below." The preview is
   **above** that line (visible in `stage-10-publish-*`). Wrong, and a one-word fix ("above" or drop the clause).
   This is the one I would not ship without.
2. `components/DecisionCard/DecisionCard.tsx`, after every proposal is decided: the header still says "Proposed for
   your course. Nothing is confirmed until you decide", each row repeats "Decided. You can edit its wording, or
   revoke it.", and the bar says "Objectives checkpoint confirmed (3 of 5)" (a machine count) while the step index
   is already on "4 Plan". Honest, but it reads as two states at once. The "(3 of 5)" is the line to cut.
3. `components/ActivityRail`: three identical rows "Decided on the proposed objectives" for accept/accept/accept.
   Known: the host's `objectives.decided` verbs (accept, rename, reword, drop, add) are not the ones the rail's copy
   expects (accepted, renamed, dropped, added), so it falls back to the generic sentence.
4. `components/PlanCard`: the plan sheet's colophon prints the plan urn and the course urn ("Silicus TA · plan
   urn:uuid:... · course urn:uuid:...") in the reading path, though D1-D9's intent was to move urns out. It is the
   plan's own print footer; whether it stays is a decision.

**Found, left on purpose (inside `live/`, not wrong).**

5. Three sentences say one fact after publishing: the notice "Version 1 sealed and pinned on this device.",
   the heading "Version 1 is published", and "Version 1 is published and unchanged." (`RevisionPanel.tsx:76`).
   Redundant, not false. The smokes assert the first by its words, and the third is needed once a revision is open,
   so I did not trim it.
6. `CourseLibrary`: the "YOUR COURSES (1)" control is a wide bordered box (about 600 px) that reads as an empty
   field. A layout matter, not copy; outside this card's fence.

## How the pictures are made

```
SILICUS_SMOKE_SHOTS=<dir> node frontend/scripts/browser-mode-smoke.mjs
```

`stageShot(name)` in the smoke writes `stage-NN-<stage>-<width>.png` (the whole page, capped at 6,000 px) and a
`.txt` of its words beside it; the tour is a viewport shot (a modal is fixed to the viewport), the seal confirm and
the rail are element crops. Files in `docs/design/img/` are palette-compressed (128 colours) to stay small
(about 1.9 MB for the 28 captures). The "before" pictures are production on 15 October
(`vibe/prod/{12,14,16}-*.png`), cut to half size.
