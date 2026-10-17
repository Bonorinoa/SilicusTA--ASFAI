# Landing page (bare URL, `#/`)

Sprint weekend-share. Lane C-c built it (`feat/landing`); lane C-d polished it and made it the bare URL. Code:
`frontend/src/landing/`, routing and the masthead wordmark in `frontend/src/workbench/Workbench.tsx`.

## What it is

The first thing a colleague sees: what Silicus is in one sentence, a real picture of the product, the five steps, what it
never does, where the work lives, who it is for, and (collapsed, at the bottom) how to run it locally. Calm editorial,
existing tokens and type only, no gradients, no logos, no sign-in. One primary action ("Try it", to `#/live`) and one
secondary ("See the five steps", an in-page link).

Captures: `img/landing-1440.png` and `img/landing-380.png` (browser build; the host build differs in two places, below).

## Routing (decision: the bare URL is the landing)

- No hash, `#` and `#/` show the landing, in both builds. It is the link people paste.
- `#/live` is the app. `#/decision`, `#/plan`, `#/publish`, `#/audit`, `#/tokens` are unchanged.
- An unknown hash (`#/nope`) is unchanged too: the live course online, the decision card locally.
- The app links back: the Silicus wordmark in the app masthead goes to `#/` (the course is never lost; it lives in the
  record). "Back to the course" in the workbench still goes to `#/live`.
- The in-page link does not use a `#anchor` href: the hash is the router, and an unknown hash would leave the landing.
  It scrolls and moves focus to the steps heading, and leaves the hash alone.

### Checks that changed meaning because of the decision (old -> new)

| Where | Old | New |
|---|---|---|
| `Workbench.test.tsx` x4 (DecisionCard live, PlanCard tab, review flow, token sheet) | render `<Workbench />` with no hash -> decision card | `beforeEach` sets `#/decision`, then the same assertions; `afterEach` resets hash, storage, fetch |
| `Landing.test.tsx` routing | "no hash opens where it always did" | `""`, `#`, `#/` show the landing; `#/decision` does not |
| browser-mode smoke, first step | "the bare URL lands on the live course, not the demo decision card" | "the bare URL shows the landing, not the live course and not the demo decision card"; then Try it opens the live course ("`#/live` (Try it) opens the live course ..."); every later step is unchanged |
| browser-mode smoke, uploads pass | `goto(APP/)` expected the live course | `goto(APP/#/live)` |
| `Landing.test.tsx` / smoke landing block | "run it on your computer" link; five regions; the record sentence in the footer | "See the five steps"; six regions; the record sentence is in "Where your work lives", once |
| `Workbench.tsx` masthead | wordmark `href="#/live"` | `href="#/"` |

New: `Workbench.test.tsx` "no hash at all, '#' and '#/' show the landing", "`#/live` still opens the app (the course),
with the wordmark linking back to the landing", "an unknown hash does not show the landing". Smoke: the masthead
wordmark href is `#/`; clicking it from the app returns to the landing; typing `#/live` opens the app.

## Polish (from the vision critique of the first capture)

- **Product in the hero.** `src/landing/hero-objectives.png` is a real capture of the Objectives stage from this build:
  the "Learning objectives" card, two proposals, Accept / Rename / Drop on each. The browser-mode smoke takes it
  (`SILICUS_SMOKE_SHOTS=<dir>` writes `hero-objectives.png`, 2x); it is not drawn. It runs from the top of the card to
  the foot of the second proposal, so the sticky decision bar is not in it. The course in it is the smoke's invented
  "How plants eat"; no teacher name appears. It sits beside the copy on desktop and below the copy at 380 and at tablet
  widths. The alt text names the step, the two objectives and the three buttons. Retake it whenever the Objectives card
  changes.
- **Headline.** Two lines on purpose: "Plan a lesson with an AI that proposes." / "You decide."
- **Never headings** read on their own: "Never decides for you", "Never keeps your files", "Never grades or saves student
  questions". Claims are scoped to what Silicus controls ("Silicus does not keep it", "Silicus does not grade a question
  or save it"); where the drafting model is involved, the page says the provider's terms apply. The landing makes no
  retention promise: "zero retention" is shown in the app only when the host reports it.
- **Where your work lives**, one short note: courses stay in this browser (this computer, in the local build); material
  text is used for one request and is gone on reload. This resolves the earlier contradiction (the hero said courses are
  kept; the never-keeps-files card said gone on reload).
- **Hero links.** "See the five steps" replaces the local-setup link. "Run it on your computer" is now a collapsed
  "For developers: run it locally" disclosure at the bottom. ASFAI is defined once, in one sentence, where it first
  appears (inside that disclosure): "a separate lesson-records product that checks a plan against its shared lesson
  format; Silicus works without it."
- **Next to Try it (online build only):** "The AI steps ask for a demo passcode. Ask the person who shared this link."
- **"You decide" at most three times:** the headline, the steps title, "Never decides for you". A test counts `decid` in
  the page text. The pull-quote under the steps and "Teachers decide every step" in the footer are gone.

## Copy, read line by line against `glossary.md` and the app

Nothing here is a claim the app does not already make elsewhere. No numbers, no names of institutions, no quotes.

| Line | Source |
|---|---|
| Eyebrow: "A prototype, for teachers of learners aged 5–14" | Brief: prototype stated plainly, ages 5-14 focus |
| H1: "Plan a lesson with an AI that proposes. / You decide." | Masthead tagline "The AI proposes. You decide." |
| Lead: "...You accept, rename or drop each piece, and nothing is final until you confirm it." | Glossary actors; the buttons in the capture are Accept / Rename / Drop (see the open finding below) |
| Passcode note (online) | `PasscodeDialog`: open to people with the demo passcode |
| Steps: Course, Brief, Objectives, Lesson plan, Version | Glossary hierarchy, same order and names |
| Version: "...It can't be changed; changes become version 2." | Glossary's one allowed explanation of "sealed"; "sealed" is not used |
| Never decides for you | Gate contract: teacher confirmation gates every checkpoint and publish |
| Never keeps your files: "The course lists the names of your materials. Their text is used for one request and is gone when you reload; Silicus does not keep it. It goes once to the drafting model, and that provider's terms apply..." | `MaterialsPanel` ("stays in this tab only ... sent once to the drafting worker"); the uploads smoke (names recorded, text read in the tab, marker string in no IndexedDB or web-storage value). Not written: "never leaves your device" (false), "zero retention" (host-reported only) |
| Never grades or saves student questions | Glossary scope line ("nothing a student asks is saved"), assessment refusal. The model hop is stated because it is true |
| Where your work lives | The live footer; `MaterialsPanel` |
| Who it is for / A prototype | README boundary: first real-user slice is ages 5-14 |
| Developers: ASFAI sentence; online vs local; steps 1-4 | Root `README.md` "Run it", `host/README.md`, `frontend/README.md` |
| Footer: "A prototype. The AI only proposes and drafts." | The live footer, shortened |

**Open finding (not changed; outside the fence):** the glossary says proposals are "accepted, reworded or dropped", but
the button on a proposal is "Rename" (`DecisionCard`: `rename` answers a proposal, `reword` edits a confirmed
objective). The landing says "rename" so its words match the picture beside them. The glossary line is the one that is off.

Checked absent (a unit test greps the rendered text): outline, package, sealed, yet, verified, secure, guarantee,
approved, validated, Google, ASU, Arizona, endorse, any percentage, "thousands", zero retention, "never leaves". Also
absent: sign-in, buttons, logos. Exactly one image.

## Accessibility and layout

- One `h1`; one banner, one `main`, one footer; every `section` is labelled by its heading (six). The disclosure is a
  native `details`; its `h2` is inside the `summary`.
- Contrast: every text/ground pair the stylesheet uses is >= 4.5:1 (`Landing.test.tsx`), and a guard fails if the CSS
  sets a text colour not in the list.
- 380 px: no sideways scroll, nothing passes the viewport, nothing is clipped (the smoke's `checkNarrow`, also with the
  disclosure open). The picture is full width there; the small print inside it is hard to read at that size, so the alt
  text and the copy carry the same words.
- Targets: the primary button, the secondary link and the disclosure row are 44 px tall.

## Verified (C-d)

From `frontend/`, branch `feat/publish-brief` after merging `feat/landing`.

| Check | Result |
|---|---|
| `npx tsc -p tsconfig.json` | 0 |
| `npx vitest run` | 525 passed (40 files) |
| `npm run build` (host build) | 0 |
| `node scripts/browser-mode-smoke.mjs` (builds `VITE_SILICUS_MODE=browser`, strict-CSP headers) | 336/336, 0 CSP violations, 0 console errors; clean on repeated runs after one race in the wordmark step was fixed |
| `node scripts/narrow-shell.mjs` | 17/17 |

Not run: `live-host-smoke` (ports 8787/5173 are held by the review app), e2e, host/api/confirm-gate suites (untouched).
The host-build landing text (no passcode note, "on this computer") is covered by the unit test, not by a browser pass.
The developer helper scripts `shots.mjs`, `shoot-onboarding.mjs` and `diagnose-print.mjs` open the bare URL and now land
on the landing; they are outside this lane's fence.
