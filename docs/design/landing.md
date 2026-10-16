# Landing page (`#/`)

Sprint weekend-share, lane C-c. Branch `feat/landing`. Code: `frontend/src/landing/`, routing in
`frontend/src/workbench/Workbench.tsx`.

## What it is

The first thing a colleague sees: what Silicus is in one sentence, the five steps, what it never does, who it is for,
and how to run it on a computer. Calm editorial, existing tokens and type only (Source Serif 4 + system UI), no
gradients, no logos, no images, no sign-in. One primary action ("Try it", to `#/live`) and one secondary
("Run it on your computer (with ASFAI)", which scrolls to the setup section on the same page and moves focus there).

Captures: `img/landing-1440.png` and `img/landing-380.png` (browser build; the host build differs in two sentences,
below).

## Routing

- `#/` shows the landing, in both builds.
- `#/live`, `#/decision`, `#/plan`, `#/publish`, `#/audit`, `#/tokens`: unchanged.
- **No hash at all is unchanged too** (online build: the live course; local build: the decision card). See the open
  decision below. Share the link as `https://<site>/#/`.

## Open decision for Augusto: should the bare URL show the landing?

The task says both "`#/` shows the landing" and "change nothing else" in the smoke and the fence. The bare URL is the
link people actually paste, so the landing only does its job if it opens there. But making it so breaks things that
are outside this lane's fence, so I did not do it. I tried it and measured:

- `Workbench.test.tsx`: 4 existing tests render `<Workbench />` with no hash and expect the decision card (the
  file's own header says the local app and its tests keep opening there). All 4 fail.
- `browser-mode-smoke.mjs`: the story's first step, "the bare URL lands on the live course", would fail, and every
  later step of both passes would follow.

The flip is one line in `tabFromHash()` (`window.location.hash === "#/" || window.location.hash === ""`) plus those two
edits: the 4 tests set `window.location.hash = "#/decision"` first, and the smoke story opens `${APP}/#/live`
(its "bare URL" check is renamed or moved to the landing). Say the word and a follow-up card does it.

Related, smaller: nothing in the app links back to the landing. The app masthead's wordmark goes to `#/live`
(a test pins it), and the masthead and footer are outside this fence. A "What is this?" footer link is the obvious
follow-up.

## Copy, read line by line against `glossary.md` and the app

Nothing here is a claim the app does not already make elsewhere. No numbers, no names of institutions, no quotes.

| Line | Source |
|---|---|
| Eyebrow: "A prototype, for teachers of learners aged 5–14" | Brief: prototype stated plainly, ages 5-14 focus |
| H1: "Plan a lesson with an AI that proposes. You decide." | Masthead tagline "The AI proposes. You decide." |
| Lead: "...The AI suggests objectives and drafts the plan. You accept, reword or drop each piece, and nothing is final until you confirm it." | Glossary actors (drafting model "proposes and drafts, never decides"); verbs accept / reword / drop |
| Note (online): "Your courses are kept in this browser. The AI steps ask for a demo passcode." | `PasscodeDialog`: "open to people with the demo passcode"; the live footer's record sentence |
| Note (local): "Your courses are kept on this computer." | The live footer, local build |
| Steps: Course, Brief, Objectives, Lesson plan, Version | Glossary hierarchy, same order and names |
| Course: "Name it, say who it is for, and list your materials..." | Glossary: "a title, who it is for, and the teacher's materials list" |
| Brief: "Your own answers: the topic, who it is for, and what learners should be able to do. You confirm them." | Glossary: Brief is the teacher's own answers, which they confirm |
| Objectives: "...Silicus proposes some; you accept, reword or drop each one." | Glossary objective sources and verbs |
| Lesson plan: "...One lesson per course in this prototype." | Glossary: "Say so where it matters" |
| Version: "...It can't be changed; changes become version 2." | Glossary's one allowed explanation of "sealed"; the word "sealed" is not used |
| "Silicus can propose objectives and draft the plan. Each step is yours to confirm..." | Same as the lead. "Propose" is not claimed for Course or Brief |
| Never: "Decide for you" ("It never accepts an objective, confirms a plan or publishes a version. Only you do.") | Gate contract: teacher confirmation gates every checkpoint and publish |
| Never: "Keep your files" ("stays in your browser tab... sent once to the drafting model... gone when you reload. Use material you are allowed to share.") | `MaterialsPanel`: "stays in this tab only: it is not saved, and it is sent once to the drafting worker". I did not write "never leaves your device", which is false |
| Never: "Grade or save student questions" ("Each question goes to the drafting model... never graded and never saved...") | Glossary scope line ("nothing a student asks is saved"), assessment refusal ("Your teacher decides that"). The model hop is stated because it is true |
| Who: "Teachers of learners aged 5–14... the only group this prototype is designed for" | README boundary: "First real-user slice is ages 5-14" |
| Prototype: "unfinished and it will change. The AI's proposals can be wrong..." | Plain statement, no measurement behind it |
| Local: "The online version keeps your record in the browser, and it cannot use ASFAI or YouTube." (host build: "You are using the version that runs on this computer.") | `frontend/README.md`: ASFAI and YouTube need the local app |
| ASFAI: "a separate lesson-records product... asks questions about your lesson and checks that the plan is in its shared lesson format. It does not judge whether the lesson is good. Silicus works without it." | Glossary ASFAI row and "What Check the plan with ASFAI does"; README "recommended, never required" is softened to "works without it". No approval claim |
| Steps 1-4: Node 18+, `cd host && npm install && npm start`, `cd frontend && npm install && npm run dev`, open `http://localhost:5173/#/live`, `~/.silicus/host`, worker off until configured (`host/README.md`) | Root `README.md` "Run it" and `host/README.md` |
| Footer: "A prototype. Teachers decide every step; the AI only proposes and drafts." + record sentence | The live footer, word for word |

Checked absent (a unit test greps the rendered text): outline, package, sealed, yet, verified, secure, guarantee,
approved, validated, Google, ASU, Arizona, endorse, any percentage, "thousands". Also absent: sign-in, buttons,
images, logos.

## Accessibility and layout

- One `h1`; one banner, one `main`, one footer; every `section` is labelled by its heading.
- Contrast: the AiWaiting pattern, in `Landing.test.tsx`: every text/ground pair the stylesheet uses is >= 4.5:1, and a
  guard fails if the CSS sets a text colour that is not in the list.
- 380 px: the page does not scroll sideways, nothing passes the viewport, nothing is clipped (the smoke's
  `checkNarrow`, plus its own measurement at 1440 and 380).
- Targets: the primary button and the secondary link are 44 px tall. Focus rings come from the base layer.
- The in-page link respects reduced motion by not animating.

## Verified

Run from `frontend/` unless noted. Baselines are the sprint's.

| Check | Result |
|---|---|
| `npx tsc --noEmit -p .` | 0 |
| `npm test` | 417 passed (399 + 18 new, `src/landing/Landing.test.tsx`) |
| `npm run build` (host build) | 0; `#/` loads the landing at 1440 and 380, no sideways scroll, footer says "on this computer", `#/decision` still opens the workbench |
| `node scripts/browser-mode-smoke.mjs` (builds `VITE_SILICUS_MODE=browser`) | 234/234 (219 + 15 new `landing` checks, both widths, 0 CSP violations, 0 console errors) |

The smoke gained one appended block (the landing, at 1440 and 380). Nothing existing in it was changed.
`narrow-shell.mjs`, `live-host-smoke.mjs`, `e2e` and the host, api and confirm-gate suites were not run: nothing in
this lane touches them, and the live-host smoke needs ports the orchestrator's review app holds.
