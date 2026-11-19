# K4 · Where the classic-view smoke checks went (B1)

The classic view (`#/live`) was deleted in K1. K4 ported `frontend/scripts/browser-mode-smoke.mjs` and
`frontend/scripts/live-host-smoke.mjs` to the studio flow. Each row maps one check in the old script (at `87b96cc`)
to its new check, or says why it was removed. Written by the porting run; reviewed by K4.

## browser-mode-smoke.mjs: coverage map, old (HEAD, classic #/live) -> new (studio)

Old names come from `git show HEAD:frontend/scripts/browser-mode-smoke.mjs` (141 `check(` call sites; the numbers are their order).
Every check is prefixed `[wide 1440]`, `[narrow 380]`, `[uploads 1440]`, `[landing 1440/380]` or `[setup]` at run time. Final run: 315/315, exit 0, Node v22.22.3 (`final.log`; also green with `SILICUS_SMOKE_PLAN_MS=48000`, `run8-long.log`).
"studio-smoke:" = already covered by a check in `frontend/scripts/studio-smoke.mjs`, named exactly.

| # | Old check | Now |
|---|---|---|
| 1 | the app builds with VITE_SILICUS_MODE=browser | same name |
| 2 | the browser host is its own chunk in the browser build | same name |
| 3 | serving with vercel.json's strict CSP | same name |
| 4 | the built bundle names no server env variable or key | same name |
| 5 | the built bundle holds nothing key-shaped | same name |
| 6 | narrow ${stage}: the page does not scroll sideways | same name, now run at studio stages: landing, studio home, design system workbench, wizard welcome/steps 1-6, passcode pause, status lines, proposals, accepted objectives, plan, review and publish, publish confirm, published, student space, student thinking, rehearse, history drawer, course, home record section, delete confirm, landing, Under the hood |
| 7 | narrow ${stage}: no element's right edge passes the viewport | same, same stages |
| 8 | narrow ${stage}: no element's content is clipped by its own box | same, same stages. Narrowed: an element with `text-overflow: ellipsis` is not "clipped" (the studio's breadcrumbs truncate on purpose, `max-width: 28ch`) |
| 9 | narrow ${stage}: the confirm button "…" shows its whole label | same name; the button finder now matches the studio primaries (Confirm objectives / Draft the lesson plan / Confirm the lesson plan / Publish version) |
| 10 | workspace ${w}x${h}: the ${stage} primary is inside the window when the stage opens | same name, at: objectives (proposed), objectives (decided), plan (before drafting), plan, publish. **removed for "published"**: the published step has no `data-primary` button (see 78) |
| 11 | polish: a stuck bar is docked flush to the window's bottom edge | removed: the classic stage page's `[data-stage-bar]` was deleted with LiveCourse; the studio's ActionBar is a different component with its own CSS and no equivalent test elsewhere (gap, not covered) |
| 12 | polish: the stage's bar is a layer (sticky, opaque, shadow) | removed: same reason as 11 |
| 13 | polish: scrolled to the bottom, last content above the bar | removed: same reason as 11 |
| 14 | polish: a control in the last content lands clear of the bar (scroll-margin) | removed: same reason as 11 |
| 15 | polish: every block of the stage column, Record details and the browser notice, ends at one right edge | removed: classic page structure (`details[aria-label="Record details"]`, browser notice under the stage) no longer exists; the record notice now lives on the studio home (see 89-95) |
| 16 | polish: no dead band in the stage column | removed: same reason as 15 |
| 17 | navigator: finished steps keep numbers 1-5 and say they are finished | removed: `ol[aria-label="Steps"]` was the classic left navigator. The studio's stepper is a different component (4 steps, ✓ on done); no replacement check (gap) |
| 18 | navigator: finished steps look openable (chevron, pointer) | removed: same reason as 17 |
| 19 | navigator: a finished step has a hover state | removed: same reason as 17 |
| 20 | navigator: the left column's course title scale, one line | removed: same reason as 17 (the classic left column is gone) |
| 21 | navigator: the byline is two deliberate lines | removed: same reason as 17 |
| 22 | draft-once: the navigator's plan line does not say "draft" | removed: no navigator plan line in the studio |
| 23 | draft-once: the finished waiting card is a receipt (no "Draft ready"…) | removed: the studio has no finished waiting card/receipt (the plan arrives and the status line returns to the teacher's turn). Replaced by "when the plan arrives the status line leaves the waiting state and the clock goes" |
| 24 | rail: the header ("Behind the scenes" and the count) is on one line | rail ${name}: the header ("Behind the scenes" and the count) is on one line (now measured in the studio's History drawer; same ActivityRail component) |
| 25 | rail: every tag is a stage word | rail ${name}: every tag is a stage word (…), never Outline, Record or Package (History drawer) |
| 26 | rail: rows do not all say "just now": the clock is shown instead | rail ${name}: rows do not all say "just now": the clock is shown instead. Narrowed to "not ALL rows say just now" (mixed "just now / 1 minute ago" is legitimate; it was a latent failure in the old logic at a slow plan) |
| 27 | rail: " · 2 times" stays whole | rail ${name}: " · 2 times" stays whole (no break inside it) |
| 28 | the bare URL shows the landing, not the live course and not the demo decision card | the bare URL shows the landing, not the studio and not the demo decision card |
| 29 | #/live (Classic view) opens the live course, not the demo decision card | removed: #/live is deleted (K1). Replaced by landing: an old typed #/live lands on the landing (the classic view is gone) and by #/studio (the landing's primary) opens the studio home: 'Your courses' with a 'New course' card and no course yet |
| 30 | the app masthead's Silicus wordmark links back to the landing (#/) | landing: the studio's 'About Silicus' link returns to the landing (#/). The studio wordmark goes to #/studio by design (K4 B2 gave the landing its own link); also studio-smoke: "K4 B2 every studio screen has the \"About Silicus\" link to #/ (…)", and the studio-home check above asserts the link is in the header |
| 31 | the page is titled as the product, with an inline SVG favicon | same name |
| 32 | the header reads as the product, not 'design workbench · tokens-first' | the studio header reads as the product, not 'design workbench · tokens-first' |
| 33 | the component workbench stays reachable through a discreet footer 'Design system' link | removed: the footer link was part of the classic page. Replaced by a typed #/decision still opens the component workbench (it is no longer linked from the app) |
| 34 | tour: opens on the first visit, before any course exists | removed: FirstRunTour was a classic-page feature. Its studio counterpart: wizard: a first run opens on the welcome (#/studio/new); also studio-smoke "the New course card opens the wizard, on its welcome at first run" |
| 35 | tour: closing it puts the cursor in the first question | removed: no tour in the studio |
| 36 | tour: does not open again on reload | removed: no tour; the studio's returning-teacher rule is studio-smoke "a returning teacher's wizard opens on step 1, without the welcome" |
| 37 | the Design system link opens the workbench, with a way back to the course | removed (no link, see 33). The workbench's narrow layout is kept: narrow design system workbench: …(3 checks) on the typed #/decision |
| 38 | the course is recorded in IndexedDB (not on a server) | same name (after the review's confirm) |
| 39 | no /api/courses request ever left the page | same name, plus nothing is recorded before the review's confirm, and no /api/courses request left the page |
| 40 | materials confirmed on the record | the review's confirm records the materials list and the outline as confirmed (files, then outline) |
| 41 | ASFAI says plainly it needs the local app, with no Connect button | removed: the studio has no ASFAI panel or Connect button. Kept in part: rail ${name}: a worker row after drafting, and no ASFAI lane in the online app |
| 42 | outline confirmed on the record | the review's confirm records the materials list and the outline as confirmed (files, then outline) (same check as 40; one confirm now writes both) |
| 43 | the material panel says YouTube needs the local app | the sources step says YouTube needs the local app (online), and will not add it |
| 44 | zero-retention is claimed only because the site's status says zdr: true | zero-retention is claimed only because the site's status says zdr: true (the AI status says the text is not kept by the provider) |
| 45 | an AI action asks for the demo passcode | same name (the arrival's proposal) ; plus wizard: the ranking call asks for the demo passcode first (browser host); studio-smoke "M1 the ranking call asks for the demo passcode first (browser host)" |
| 46 | while the passcode dialog is open the waiting card holds its clock and says why | while the passcode dialog is open the status line holds its clock and says why |
| 47 | proposing objectives ends with a true receipt | proposing ends with the proposals on the page, none accepted (3 waiting, 'Not yours until you accept'). The "receipt" card does not exist in the studio |
| 48 | the worker proposed objectives through /api/worker, with the passcode header | same name |
| 49 | the passcode is in sessionStorage only | same name |
| 50 | the material text went to the model once… | same name (counted per pass) |
| 51 | …and is in no IndexedDB value, localStorage or sessionStorage | same name |
| 52 | one teacher decision recorded per proposal | same name |
| 53 | stage: the objectives stage has exactly one primary action | stage: the objectives step has exactly one primary action |
| 54 | three confirmed objectives are on the page to be sent | three accepted objectives are on the page to be sent |
| 55 | the waiting experience says in plain words what is happening, with the real count | same name (status line: "Silicus is drafting from 3 confirmed objectives"); plus proposing says in plain words what is happening, with the real count, and the usual range ("Silicus is reading 1 source · usually 2–10 s") |
| 56 | it states the typical range the documented defaults give: usually 10–60 seconds | it states the typical range the documented defaults give: usually 10–60 s (the studio prints "usually 10–60 s") |
| 57 | exactly one polite aria-live region announces the start | exactly one polite live region announces the start, without the ticking clock (the clock is aria-hidden); also one polite live region on the step after the wizard. Caveat: the plan wait card's own `WaitLines` has `role="status"` too, so the plan step has TWO status regions; the check excludes `[data-wait-lines]` (see handoff finding) |
| 58 | there is no progress bar and no percentage | same name |
| 59 | 'What the model sees' opens and lists the statements, the topic, the material names, and what it never sees | removed: the studio has no "What the model sees" disclosure (AiWaiting card is not used). The underlying truth is still asserted on the request: what left the page: every accepted statement and the topic were sent; the label and the material text were NOT (see 65) |
| 60 | the elapsed readout is a real clock: it has advanced | same name |
| 61 | past the high end the calm 'taking longer' line appears, and says nothing is lost | past the late mark the calm 'still drafting' line appears (only with SILICUS_SMOKE_PLAN_MS > 47000: the studio's late line is "Still drafting. Long plans can take a minute." at 45 s). The classic "nothing you have recorded is lost" sentence does not exist in the studio |
| 62 | before the high end there is no 'taking longer' line | before the late mark there is no 'still drafting' line |
| 63 | drafting the plan ends with a true receipt | removed: no receipt in the studio (see 23) |
| 64 | it says how long the step took, and the live region announces the finish | removed: no "Took N s" receipt and no finish announcement in the studio; the studio's finish is the status line returning to the teacher's turn (when the plan arrives the status line leaves the waiting state and the clock goes) |
| 65 | what the model sees is what left the page: every statement, the topic and the material name were sent; the label was NOT | what left the page: every accepted statement and the topic were sent; the label and the material text were NOT. **The material NAME is no longer asserted**: the studio's plan request does not carry material names (observed: it was not in the body), and the old check's "material name" claim belonged to the classic "What the model sees" list |
| 66 | the plan is drafted (no second passcode prompt: it is kept for this tab) | same name |
| 67 | stage: the plan stage has exactly one primary action | stage: the plan step has exactly one primary action |
| 68 | stage: the lesson plan's text appears exactly once on the plan stage | stage: the lesson plan's text appears exactly once on the plan step |
| 69 | rail: a worker row after drafting, and no ASFAI lane in the online app | rail ${name}: a worker row after drafting, and no ASFAI lane in the online app |
| 70 | workspace: the plan page is tall enough to scroll, so the return check means something | removed with 72: the scroll-position return is not asserted in the studio (the plan step has no scroll-restore contract and the check measured classic page height) |
| 71 | workspace: 'Edit objectives' opens the objectives, with 'Back to the plan' as the one primary | 'Edit objectives' opens the objectives, looking back, with 'Back to the current step' as the way out (the studio's look-back bar has no `data-primary`, so "one primary" is dropped) |
| 72 | workspace: edit objectives from the plan and back is two clicks, scrollY within 40 px | back from editing the objectives lands on the plan, to confirm (two clicks kept; the scrollY half removed, see 70) |
| 73 | workspace: looking wrote nothing | looking wrote nothing (still exactly the three objective decisions) |
| 74 | plan confirmed on the record | same name |
| 75 | stage: the publish stage has exactly one primary action | stage: the publish step has exactly one primary action |
| 76 | stage: the lesson plan's text appears exactly once on the publish stage | stage: the lesson plan's text appears exactly once on the publish step |
| 77 | version 1 sealed, and pinned in this browser | same name |
| 78 | stage: the published stage has exactly one primary action | removed: the studio's published moment has link buttons and no `data-primary` button; nothing to count |
| 79 | stage: the lesson plan's text appears exactly once on the published stage | removed: the studio's published step does not show the plan (it offers "Read the plan") |
| 80 | 'Check a student question' puts the cursor in the student's question box | removed: no such button in the studio (published moment links to the student space and to Rehearse). Student questions are exercised on #/learn and Rehearse (81-84) |
| 81 | a student's answer shows the compact waiting line: where it looks, a clock, the usual 2–15 seconds | a student's wait shows the 'Silicus is thinking' indicator. **Removed**: the "where it looks", clock and "usually 2–15 seconds" text; Learn shows only the three dots |
| 82 | under prefers-reduced-motion the type-setting motion is off | under prefers-reduced-motion the indicator is still (no CSS animation) |
| 83 | the student gets an answer that cites the published version | the student gets an answer that cites the published lesson ("From the lesson:"); the studio cites the lesson, not "version 1" |
| 84 | student chat wrote nothing (IndexedDB and web storage identical before and after) | same name (#/learn); plus Rehearse answers from the published version and writes nothing |
| 85 | the browser-written log verifies on the Node host's chain (node:crypto) | same name |
| 86 | after a reload the published course is still there | same name |
| 87 | after a reload the record verifies | same name; now History drawer → "Check the record" → "The record checks out: N events, chain intact." |
| 88 | the course notice is shown exactly once, not echoed by every card | the record notice is shown exactly once |
| 89 | an export file was downloaded | same name (now from the studio home's "Export all courses") |
| 90 | the export verifies in Node (envelope digest, chain, meta, replay) | same name |
| 91 | the export holds no material text | same name |
| 92 | delete all empties IndexedDB, the pins and the passcode | same name; plus delete all says so, and the home lists no course |
| 93 | a tampered export is refused with a clear message, and nothing is written | same name (the tamper edits the course title in the file: any changed byte breaks the envelope digest) |
| 94 | import brings the course back, record intact | same name; plus the imported course is listed as published on the home |
| 95 | the imported course verifies in the app | same name |
| 96 | 0 CSP violations | same name |
| 97 | 0 console errors | same name |
| 98 | 0 page errors | same name |
| 99 | the only network calls were the site's functions | same name |
| 100 | the whole flow completed ([wide 1440]) | same name |
| 101 | the whole flow completed ([narrow 380]) | same name |
| 102 | uploads: the main entry chunk does not contain pdf.js (a lazy chunk does) | same name |
| 103 | uploads: mammoth and jszip are lazy chunks too, not in the entry | same name |
| 104 | uploads: the materials question offers 'Add files' with the PDF, DOCX and PPTX types | uploads: the sources step offers 'Choose files' with the PDF, DOCX and PPTX types, several at once |
| 105 | uploads: each file shows its name, kind and character count before anything is sent | same name |
| 106 | uploads: the PDF's character count is the length of its real text layer | same name |
| 107 | uploads: the file names sit on their own lines beside the typed name | removed: the studio has no typed-name field (a file is named by itself; studio-smoke "the sources step is one drop zone (files, paste, web page) with no source-name field") |
| 108 | uploads: nothing has left the page … while files are only chosen | same name |
| 109 | uploads: the record holds the file names as typed names, and not their text | uploads: the record holds the file names, and not their text (names reach the record when Silicus reads the sources, not at course.created) |
| 110 | uploads: 'propose from my materials' finds the files already chosen in this tab | uploads: the review names the two files and says they are read in this tab; none of their text; uploads: the proposal request carries the PDF's text and the DOCX's text, once each (the arrival proposes from the wizard's files; no second upload) |
| 111 | uploads: after a reload the files are not offered (the text was never stored) | uploads: after a reload the files are not held any more (the text was never stored) |
| 112 | uploads: and the panel says to add the file again, in the glossary's words | uploads: and the panel says in its own words that text is forgotten on reload (add the file again to use it). **Behaviour change**: the classic "Add the file again to use its text…" sentence and the studio's "Attach the file" row for named-only sources do not appear for a wizard-made course after reload (its sources panel says "No sources yet.", because the wizard course has no names in `course.materials`) |
| 113 | uploads: the PDF's marker text is in no IndexedDB value, localStorage or sessionStorage | uploads: the PDF's marker text is in no IndexedDB value, localStorage or sessionStorage after the reload |
| 114 | uploads: an image-only PDF says it has no text layer, names the file, and makes no OCR claim | uploads: an image-only PDF says it has no text layer, and makes no OCR claim (the studio's sentence does not name the file) |
| 115 | uploads: a legacy .doc says what to do instead | uploads: a legacy .doc says what to do instead (save as .docx) |
| 116 | uploads: neither failed file was added to the list | same name |
| 117 | uploads: the files added again in the panel are listed with their character counts | same name. Added ONE FILE PER CHOOSE: choosing two files at once in the course panel's "Add a source" dialog keeps only the last (finding below) |
| 118 | uploads: the proposal request carries the PDF's text and the DOCX's text, once each | same name |
| 119 | uploads: the receipt says the proposals were drawn from 2 materials | uploads: the proposals say which materials they were drawn from (both files named); uploads: the sources panel lists both files, read in this tab, and says what they were used for ("Used for N proposals"). No receipt card in the studio |
| 120 | uploads: after proposing, the PDF's marker is STILL in no IndexedDB value … | same name (plus the fixture sentence) |
| 121 | uploads: pdf.js's worker came from the bundle, same origin, as JavaScript | same name |
| 122 | uploads: no request left the page's own origin (no CDN) | same name |
| 123 | uploads: 0 CSP violations | same name |
| 124 | uploads: 0 console or page errors | same name |
| 125 | uploads: the whole upload flow completed (pass) | same name |
| 126 | uploads: the whole upload flow completed (fail) | same name |
| 127 | landing: the bare URL shows one h1, one banner, one main and one footer | same name |
| 128 | landing: the headline breaks after 'proposes.' | same name |
| 129 | landing: the four steps…, Open the studio to #/studio, How it works, Classic view to #/live, no controls and no sign-in | landing: the four steps in order, the three 'Never ...' headings, Open the studio to #/studio, How it works, no 'Classic view' link and no link to #/live, no controls and no sign-in |
| 130 | landing: says prototype and ages 5–14 … | same name |
| 131 | landing: 'decide' appears at most three times; no retention promise | same name |
| 132 | landing: no screenshot; the hero is a drawing … | same name |
| 133 | landing: the technical detail is one collapsed 'Under the hood' disclosure … | same name |
| 134 | landing: ASFAI is defined as a protocol where it first appears | same name |
| 135 | landing: the page does not scroll sideways | same name |
| 136 | landing: How it works stays on the landing … | same name |
| 137 | landing: opening Under the hood shows the setup steps … | same name |
| 138 | landing: Classic view opens the app at #/live | landing: Open the studio opens the studio home at #/studio, then landing: the studio's 'About Silicus' link returns to the landing (#/) |
| 139 | landing: the app's Silicus wordmark returns to the landing (#/) | landing: the studio's 'About Silicus' link returns to the landing (#/) |
| 140 | landing: typing #/live opens the app, not the landing | landing: an old typed #/live lands on the landing (the classic view is gone) |
| 141 | landing: 0 CSP violations and 0 console errors | same name |

## Removed checks and why

- **11-23 (polish, navigator, draft-once):** assert layout of the classic stage page (`[data-stage-bar]`, `ol[aria-label="Steps"]`, "Record details", waiting-card receipt). That DOM no longer exists. The studio's equivalents (ActionBar docking, stepper) are not covered by any script: a coverage gap, not a regression.
- **29, 33, 34, 35, 36, 37:** classic-only features (the route, the footer Design-system link, FirstRunTour). Replaced as listed.
- **41:** no ASFAI panel in the studio.
- **59, 63, 64:** "What the model sees" and the receipt exist only in the AiWaiting card, which the studio does not use. The request-body assertion stays (65).
- **70, 72 (scrollY half):** classic page scroll geometry.
- **78, 79, 80:** the studio's published step has no primary button, does not show the plan, and has no "Check a student question" control.
- **81 (text part):** Learn has only a dots indicator, no "where it looks / clock / usual range".
- **107:** no typed-name field in the studio.

## Findings for the owner (not fixed here: the script is the only file touched)

1. **Course panel "Add a source": choosing two files at once keeps only the last.** `SourceDrop.readFiles` calls `onFile` once per file; `SourcesPanel` builds each next list from its stale `held` prop (`onHeld([...held.filter(...), file])`), so the second overwrites the first. The wizard's Sources step is fine (two files at once are listed). The script adds one file per choose in the panel and says so in a comment.
2. **Plan step has two `role="status"` regions** (StepStatus and `WaitLines`), against the D1 comment "exactly one polite live region". The script's live-region check excludes `[data-wait-lines]`.
3. **After a reload, a wizard-made course shows "No sources yet" for sources that proposals still cite** ("From material: hello.pdf"), so there is no "Attach the file" row to prompt re-adding them.
4. **Plan request carries no material names** (old check 65 asserted "Lesson notes" was sent).
5. `frontend/scripts/live-host-smoke.mjs` shows as modified in the worktree. I did not touch it.


## live-host-smoke.mjs coverage map (classic #/live -> studio)

Old script: `git show HEAD:frontend/scripts/live-host-smoke.mjs` (81 `check(` call sites; the viewport check runs per stage and per window size).
New script: `frontend/scripts/live-host-smoke.mjs`, run with Node v22.22.3 from `frontend/`: **exit 0, 86/86 passed** (two consecutive runs: `run5.log`, `run6.log`; both in this directory).
Drive: real host (mock ASFAI + mock worker), host-mode build, system Chrome. Every check after a teacher action still reads the host (`/api/courses/<id>`), not the DOM, except where marked "UI".

Legend: **same** = same name; **moved** = new name; **API** = the UI half no longer exists, the host half is kept and sent to the host's HTTP route; **removed** = reason given.

| Old check | Now |
|---|---|
| Silicus host is up | same |
| built app is served | same |
| Live tab reaches the host (not the offline notice) | moved: `studio home reaches the host (course list, not the offline notice)` |
| tour: opens on the first visit, before any course exists | removed: `FirstRunTour` is not mounted anywhere in the app now (only its own test imports it); the studio has no first-visit tour. Not in studio-smoke either (its first-run claim is `the New course card opens the wizard, on its welcome at first run`). |
| tour: closing it puts the cursor in the first question | removed: same reason (no tour, no `#onboarding-reply` question box) |
| tour: does not open again on reload | removed: same reason |
| tour: 'How it works' reopens it on demand | removed: same reason (the landing's "How it works" is a landing-page link, covered by Landing.test) |
| a course exists on the host after Start | moved: `a course exists on the host after the wizard's confirm` |
| five checkpoint chips render | moved: `the four-step stepper renders (Brief, Objectives, Plan, Publish)` (the studio has four steps, not five chips) |
| materials confirmed IN THE HOST | moved: `materials confirmed IN THE HOST (the wizard's confirm sent the source-list intent)` |
| before consent the host refuses to call ASFAI (401 AUTH_REQUIRED) | same |
| ASFAI consent completes through the host's own callback | same |
| connected: ASFAI is recommended, and the host's own questions are live beside it | removed (UI): the studio has no ASFAI recommendation card or `#intake-topic` form. Host half kept at `the teacher's answers are recorded on the host and arm the round` (asserts `questionsFrom === "local"` + the three answers) |
| the host called ASFAI and its questions surface in the UI, attributed to ASFAI | API: `the host called ASFAI for this course and its questions are attributed to ASFAI (host record; the studio shows none of it)`. The "surfaces in the UI" half is removed: no studio control renders ASFAI's questions. |
| an outline confirm is refused before the teacher answers | same (now on a probe course made through `POST /api/courses`: the wizard answers and confirms in one click, so an unanswered course has to be made directly) |
| the host cannot ask ASFAI again before the teacher answers | same (probe course) |
| the teacher's answers are recorded on the host and arm the round | same (now recorded by the wizard's confirm; asserts roundAnswered, outlineAuthorized, topic, 2 outcomes) |
| ASFAI received exactly the teacher's words | same, now **API**: after the studio's own wizard answers, the script re-records them and calls `intake/call` on the same course. The studio has no "Send your answers to ASFAI" control, and the host only consults ASFAI's graph for a course whose answers were sent. |
| outline confirmed IN THE HOST after the real intake round | moved: `outline confirmed IN THE HOST in the same click (the wizard sends the brief's intents)` |
| the host proposed 2 objectives, one per recorded outcome line | same (UI: "Use my answers") |
| stage: the objectives stage has exactly one primary action | moved: `... (Confirm objectives, held until every proposal is decided)` |
| workspace 1440x900: the objectives (decided) primary is inside the window when the stage opens | same |
| workspace 1280x800: the objectives (decided) primary is inside the window when the stage opens | same |
| one teacher decision recorded per derived objective | same |
| objectives checkpoint auto-confirmed | moved and inverted: `objectives are NOT confirmed by accepting: the explicit course waits for the teacher's own confirm` + `objectives checkpoint confirmed IN THE HOST by the teacher's own Confirm` (the wizard makes an explicit course, R4) |
| every decision cites a real teacher turn | same |
| plan drafted on the host | same (UI: "Draft the lesson plan"; the classic "Confirm N objectives · build the plan" bar is gone) |
| PlanCard renders the host's plan | same |
| stage: the plan stage has exactly one primary action | same |
| workspace 1440x900 / 1280x800: the plan primary is inside the window | same (2 checks) |
| workspace: 'Edit objectives' opens the objectives, with 'Back to the plan' as the one primary | moved: `... with 'Back to the current step' as the one way on (no competing primary)`. In the studio that button is `variant=primary` without `data-primary`, so the check asserts exactly one such button and zero `data-primary` elements. |
| workspace: edit objectives from the plan and back is two clicks, with scrollY within 40 px | same |
| stage: the lesson plan's text appears exactly once on the plan stage | same |
| rail: a worker row names the drafting model after drafting, and ASFAI has its own lane when connected | moved: `rail: ... ASFAI has its own lane in the local app`. The rail is now in the History drawer and `asfaiAvailable={!BROWSER_MODE}`, so the lane no longer depends on being connected. |
| the plan shows suggested alignment from ASFAI's graph, labelled as a suggestion | same (passes only after the API-sent ASFAI round above) |
| the publish preview does NOT show the suggestions (they are not in the package) | same (now asserted on the Publish step, which is its own page) |
| plan confirmed IN THE HOST | same |
| host arms publish once the plan is confirmed | same |
| stage: the publish stage has exactly one primary action | same |
| workspace 1440x900 / 1280x800: the publish primary is inside the window | same (2 checks) |
| stage: the lesson plan's text appears exactly once on the publish stage | same |
| UI reflects the armed publish checkpoint | same (reads "Ready." in the action bar; the old "ready to publish" chip is gone) |
| seal confirm step appears | same |
| seal confirm defaults to the safe choice | same (focus on "Keep editing") |
| package sealed as version 1 on the host | same |
| all five checkpoints confirmed after publish | same |
| stage: the published stage has exactly one primary action | removed: the studio's published moment has no `data-primary` button (it offers "Open the student space" / "Rehearse student questions" link buttons and secondary actions); there is no single primary to count. Not covered in studio-smoke. |
| workspace 1440x900 / 1280x800: the published primary is inside the window (2 checks) | removed: same reason, no published primary to locate |
| stage: the lesson plan's text appears exactly once on the published stage | removed: the studio's published moment does not render the plan (it links "Read the plan"); the once-only claim still holds on the Plan and Publish stages above |
| 'Check a student question' puts the cursor in the student's question box | moved, weaker: `'Open the student space' opens the student preview, with the question box and the published title` + `the published moment links to the student space and Rehearse`. The focus-on-arrival half is dropped: the studio link just navigates to `#/learn/<id>` (studio-smoke: `the student space is labelled a preview on this device`). |
| export archived with a verified read-back digest | same |
| the archived record reloads and re-verifies | same |
| tamper-evident export carries one sealed version | same |
| event-log hash chain verifies | same |
| the sealed version is pinned on the device | same (reads `silicus.pin.<id>.1` from the page's localStorage; the "Record details / Pinned on this device" disclosure no longer exists) |
| (new) | `the pin is exactly what the host says about version 1 right now` (precondition for the pin check below) |
| the host still blesses the rewritten chain (this is the ledger problem) | same |
| THE PIN CATCHES IT: the device's copy differs from the rewritten record | same name, new mechanism: the studio has no "Check my pinned copies" button, so the script applies `gate/pin.ts` `comparePin`'s rule (digest differs, or record shorter) to the pin from localStorage vs `GET .../anchor/1`. The rule is mirrored in the script, not imported. |
| local: a second host, with no ASFAI credential, is up | same |
| local: the host's own questions are live with ASFAI unconnected, and are not attributed to ASFAI | same name; host half only (`questionsFrom === "local"`, 3 questions). The "not attributed to ASFAI in the intake card" DOM half is removed with the card. |
| local: ASFAI is recommended, not required (Connect ASFAI is offered beside the live questions) | removed (UI): no "Connect ASFAI" / "Recommended:" / "Nothing waits on it" in the studio. The not-required half is still shown by the whole local story completing with zero ASFAI requests. |
| local: the outline is refused until the teacher has answered | same (probe course) |
| local: two of three answers do not open the outline | same (probe course, via `intake/answer`) |
| (new) | `local: the third answer opens the outline` (the old script folded this into the outline-confirm check) |
| local: outline confirmed IN THE HOST on the teacher's own answers | moved: `local: the teacher's own answers opened the outline, and it is confirmed IN THE HOST` |
| local: proposals are the teacher's own sentences, labelled 'from your answer' (not 'to ASFAI') | same |
| local: objectives confirmed through the gate | same (adds the explicit "Confirm objectives" click) |
| rail (local): a worker row names the drafting model after drafting, and no ASFAI step is shown that never happened | same (History drawer) |
| local: the plan is aligned from the ontology file alone, with no ASFAI | same |
| local: seal confirm step appears | same (asserts the focused "Keep editing") |
| local: all five checkpoints confirmed and sealed with no ASFAI | same |
| local: the log verifies | same |
| revise: the published course says version 1 is unchanged, and students keep reading it | same name; new copy: "Students keep seeing version 1 until then." + "your next edits become version 2." |
| revise: opening the revision tools wrote nothing to the host | same (click "Revise objectives"; event count unchanged) |
| revise: the host reads the record as drafting version 2, with the teacher's own objective added | same, now **API** for the add: a confirmed set has no "add" control in the studio (`canWrite = !confirmed`), so the add goes to `POST .../decisions` (also new check `revise: the host accepts the teacher's own added objective on the published course`) |
| revise: while drafting, the page says a draft is never what students see | moved: `revise: while drafting, the page lists what changed since version 1 and offers to publish version 2` ("A draft is never what students see" no longer exists in the studio) |
| revise: the UI says you are drafting version 2, and version 1 is still the only sealed version | same name; asserts "later edits become version 3" on the Publish version 2 step |
| revise: the seal confirm step appears for version 2 | same |
| revise: version 2 is sealed by a teacher turn, linked to version 1, and version 1 is untouched | same |
| revise: the log still verifies and the UI now reports version 2 | same |
| reword: the UI sent a reword and the host kept the objective's id, kind and status | same (UI: "Edit wording" -> "Save wording"; the classic Enter-to-submit is now a button) |
| reword: the plan is still confirmed and publishable, and the host says it was written from the old wording | same |
| reword: version 2 is byte-identical and the host reads the record as drafting version 3 | same |
| reword: the page says 'Reworded by you' with the original visible, and flags the plan without invalidating it | same name; asserts "Reworded by you" and "was “…”" on Objectives, no "Why this plan is invalidated" |
| (new) | `reword: the publish step flags the reworded objective without invalidating the plan` (the plan flag now lives on the Publish step, not the Objectives page) |
| reword: the log still verifies | same |
| local: not one request reached ASFAI during the whole local story | same |
| flow completed without throwing (failure marker) | same |

## New checks with no old counterpart
- `the wizard asked the host to rank the skill map (the ranking call went to the host and was answered)`: host-mode ranking call `/api/knowledge/marble/rank` returns 200 (the step then skips the map).
- `the lesson plan stage is not open yet: the wizard lands on Objectives`.
- `probe: a course with no answers gets ASFAI's questions from the host's call`.
- `the pin is exactly what the host says about version 1 right now`, `local: the third answer opens the outline`, `revise: the host accepts the teacher's own added objective on the published course`, `reword: the publish step flags ...`.

## What ran through the UI vs the host's HTTP API
- UI: wizard (welcome, course/learners, skip map, no sources, objectives, AI check, review, confirm), Use my answers, Accept, Confirm objectives, Draft the lesson plan, Edit objectives / Back, Confirm the lesson plan, Publish version N… / Publish version N, Open the student space, Revise objectives, Edit/Save wording, History drawer.
- Host API only: ASFAI connect/consent, ASFAI intake rounds, probe courses (premature outline, 2-of-3 answers), archive/export/verify/anchor reads, the "add objective" on a published course, the pin comparison.
