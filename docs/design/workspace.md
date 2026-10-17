# The workspace: edit any stage without scrolling

Branch `feat/workspace` (from `sprint/weekend-share` @ 2d59ceb). Owner: "the current design makes me scroll up and down for
editing the course." Measured before this change, 1440x900: Plan primary ~2,400 px down, edit-objective-and-return
~3,000-3,800 px of scrolling, rail blank for ~1,700 px then clipped. The page is now a workspace at 1100 px and up, and
unchanged in spirit (one column, stepper) below it.

All captures are real (`SILICUS_SMOKE_SHOTS=<dir> node frontend/scripts/browser-mode-smoke.mjs`, online build, model mocked).
The plan text is the stub's ("Look at a leaf." x3); "Took 0 s" is the stub's speed.

## What changed

```
 widths        <1100 px                    1100-1279 px                 >=1280 px
 layout        one column, stepper         [navigator | stage]          [navigator | stage | rail]
 course        menu button (name + chevron) in every width; with no course open, a plain list
 stage bar     foot of the stage           sticky to the window's foot  sticky
 rail          disclosure under the stage  disclosure under the stage   sticky, own scroll
```

1. Stage navigator. The step list (Material, Brief, Objectives, Plan, Publish) stands on end in a sticky left column with a
   one-line summary per step ("1 material", the topic, "3 objectives confirmed", "Draft · 3 activities · 45 min", "Version 1").
   Same `<ol aria-label="Steps">` as the stepper: one list, two layouts, nothing drawn twice. A step is a button only where there
   is something to look at; opening one is a look, never an act (the vitest suite asserts no write leaves).
   "Outline" is "Brief" here, as the glossary says (the gate id stays `outline`).
2. Stage bar (`StageBar.tsx`): status sentence + the one primary + secondaries, sticky at the foot of the window in the stage column.
   The DecisionCard's and the PublishCard's own bars are sticky too, by attribute selector (`[data-armed][data-print="hide"]`), because
   their markup is outside this card's fence; a later card can fold them into `StageBar`.
3. Return path. The plan's activities show their objectives as chips ("Obj 2", statement on hover or focus; plain "Obj 2" in print).
   "Edit objectives" (in the plan's bar) opens the Objectives stage, editable; its one primary is "Back to the plan", which puts the page
   back where it was. Editable only while nothing is published, or while a revision is open; otherwise a look only.
4. Plan sheet: "Suggested alignment" folds away; urns and the print note moved to Record details (the printed page keeps the urn in its footer; the
   alignment list does not print, it is not part of the sheet).
5. Rail: sticky inside a full-height cell with its own scroll (max height = window minus its margins); consecutive alike steps within two
   minutes are one row ("Your decisions: 3 accepted"). Counts are added only where they are a tally (decisions); identical rows with nothing to add
   say "· 3 times"; different checkpoints, actors or actions are never folded. `copy.ts` untouched.
6. "Your courses (N)" is a real menu button: the open course's name and a chevron; `role="menu"`, arrows, Home/End, Escape (focus returns), click-outside.
7. EarlierSteps (the one-line list of finished steps) is not drawn at 1100 px and up, because the navigator reaches every finished step;
   it stays while a revision keeps one open.
8. A new stage (or the plan appearing) opens at the top of the page. The conversation stages (intake, material), whose cards are not this page's, bring
   their primary into view when they open, when the record moves on, and when the window is resized.

## Measured: is the primary in the window when the stage opens?

From the smoke, wide pass, top of page, one primary on screen (rows: top-bottom in px, window 900 and 800 tall):

```
 stage                     1440x900      1280x800
 confirm material list     840–884       756–800       
 intake                    856–900       756–800       
 confirm outline           170–214       170–214       
 material                  840–884       740–784       
 objectives (proposed)     824–868       724–768       
 objectives (decided)      824–868       724–768       
 plan                      827–871       727–771       
 publish                   798–842       657–701       
 published                 339–383       339–383       
```

Conversation stages are measured where the page comes to rest, not from the top (see "What this does not do").
Edit objectives and back, 1440x900, plan scrolled down: two clicks, `scrollY scrollY 700 -> 731` (budget: within 40 px).

![workspace-view-confirm-material-list-1440x900 at 1440x900](img/workspace-view-confirm-material-list-1440x900.png)
![workspace-view-confirm-outline-1440x900 at 1440x900](img/workspace-view-confirm-outline-1440x900.png)
![workspace-view-intake-1440x900 at 1440x900](img/workspace-view-intake-1440x900.png)
![workspace-view-material-1440x900 at 1440x900](img/workspace-view-material-1440x900.png)
![workspace-view-objectives-decided--1440x900 at 1440x900](img/workspace-view-objectives-decided--1440x900.png)
![workspace-view-objectives-proposed--1440x900 at 1440x900](img/workspace-view-objectives-proposed--1440x900.png)
![workspace-view-plan-1440x900 at 1440x900](img/workspace-view-plan-1440x900.png)
![workspace-view-publish-1440x900 at 1440x900](img/workspace-view-publish-1440x900.png)
![workspace-view-published-1440x900 at 1440x900](img/workspace-view-published-1440x900.png)

## The stages, 1440 px and 380 px

![tour at 1440](img/workspace-01-tour-1440.png) ![tour at 380](img/workspace-01-tour-380.png)

![landing-first-question at 1440](img/workspace-02-landing-first-question-1440.png) ![landing-first-question at 380](img/workspace-02-landing-first-question-380.png)

![confirm-material-list at 1440](img/workspace-03-confirm-material-list-1440.png) ![confirm-material-list at 380](img/workspace-03-confirm-material-list-380.png)

![intake at 1440](img/workspace-04-intake-1440.png) ![intake at 380](img/workspace-04-intake-380.png)

![material at 1440](img/workspace-05-material-1440.png) ![material at 380](img/workspace-05-material-380.png)

![objectives-proposed at 1440](img/workspace-06-objectives-proposed-1440.png) ![objectives-proposed at 380](img/workspace-06-objectives-proposed-380.png)

![objectives-decided at 1440](img/workspace-07-objectives-decided-1440.png) ![objectives-decided at 380](img/workspace-07-objectives-decided-380.png)

![plan-drafting at 1440](img/workspace-08-plan-drafting-1440.png) ![plan-drafting at 380](img/workspace-08-plan-drafting-380.png)

![plan-drafted at 1440](img/workspace-09-plan-drafted-1440.png) ![plan-drafted at 380](img/workspace-09-plan-drafted-380.png)

![edit-objectives at 1440](img/workspace-09b-edit-objectives-1440.png) ![edit-objectives at 380](img/workspace-09b-edit-objectives-380.png)

![publish at 1440](img/workspace-10-publish-1440.png) ![publish at 380](img/workspace-10-publish-380.png)

![seal-confirm at 1440](img/workspace-11-seal-confirm-1440.png) ![seal-confirm at 380](img/workspace-11-seal-confirm-380.png)

![published at 1440](img/workspace-12-published-1440.png) ![published at 380](img/workspace-12-published-380.png)

![student-answer at 1440](img/workspace-13-student-answer-1440.png) ![student-answer at 380](img/workspace-13-student-answer-380.png)

![rail-open at 1440](img/workspace-14-rail-open-1440.png) ![rail-open at 380](img/workspace-14-rail-open-380.png)

## Checks

New (browser-mode smoke, wide pass): 9 stages x 2 window sizes "the primary is inside the window when the stage opens" = 18, plus 4 for edit
objectives and back (tall enough to scroll; opens with one primary; scrollY within 40 px; looking wrote nothing). Browser-mode 219 -> 241.
Narrow-shell: +1 ("380px: the stage navigator collapses to the stepper (a row of labels, no summaries, nothing sticky)"), 16 -> 17.
Vitest 399 -> 424 (+25: navigator, return path, library menu, plan chips, rail grouping and sticky, plan ids).
Live-host smoke: the same two checks were appended; see the status line in the card report (it was not run).

Changed checks, old -> new (selector only, meaning kept):

```
 narrow-shell surface list    ["details", "course library"]  ->  also ["button[aria-haspopup='menu']", "course library"]
 LiveCourse.test (library)    list "Your courses" + button "Open X"  ->  open the menu button, then menu "Your courses" + menuitem "Open X"
 stage.test (step index)      /Outline/  ->  /Brief/
 ActivityRail.test (folds)    eight and eleven identical rows one minute apart  ->  three minutes apart (grouping would, correctly, fold them)
```

## What this does not do

- Intake and material: `OnboardingChat` and `MaterialsPanel` are outside the fence, so their primary cannot ride in the stage bar. The page scrolls it into
  view instead; a long transcript above it still costs a scroll. A later card could dock those composers.
- The DecisionCard bar still prints "Objectives checkpoint confirmed (3 of 5)" (machine count), and its header keeps "Nothing is confirmed until you
  decide" after the decisions. Not mine (`DecisionCard`).
- At 1100-1279 px the rail is a disclosure under the stage (no room for a third column).
- Full-page captures draw sticky parts where the window is; the captures scroll to the top first.

## Copy, read line by line

Method: the `.txt` that the smoke writes beside each capture (the page's `innerText`), 227 distinct lines at 1440, read in order, then the images.
Mine: navigator summaries ("Not confirmed", "Not started", "3 proposals to decide", "3 objectives confirmed", "Draft · 3 activities · 45 min",
"Not published", "Version 1"); bar sentences ("Draft plan · 3 activities, 45 min. It is a draft until you confirm it."; "This plan cites an objective you
dropped, so it cannot be published as it is."; "Edit an objective's wording, or revoke one, then go back to the plan."; "A look at your brief. Nothing
here changes."); "Back to the plan"; "Edit objectives". Nothing implies the AI decided: every decision in the rail is "You", the model's rows say
drafted, the plan stays "a draft until you confirm it".

Found, left (outside this fence; for C-b's sweep against the glossary): "Confirm the outline" button, "The outline needs a subject.", the rail's "Confirmed the
outline" and its "Outline" artifact tag; "sealed" / "package" in "Version 1 sealed and pinned on this device.", "Everything below is exactly what the sealed
package will contain", "Sealing is irreversible", "Export the package", the rail's "Package" tag. "Answered the questions" can show twice when answers are more than two
minutes apart (correct, reads oddly). Contrast: tokens only, no new colour; the chip uses accent-strong on accent-soft.
