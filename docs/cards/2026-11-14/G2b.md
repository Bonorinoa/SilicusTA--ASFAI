# G2b · Wizard step 1: stage cards, age strip, skill-map anchor, consequence strip

## Design reference (owner approved "A + histogram" on 14 Nov)

Open `/Users/bonorinoa/Hermes/Projects/silicus-private/sketches/2026-11-14-audience-input.html` in a browser
(tab A, plus the bars from tab B). It is a design intent, not a pixel contract: build it with the studio's own
components and tokens (`frontend/src/design/tokens.css`). Do not copy the sketch's stage mottos: they paraphrase
Sarah Chardonnens's booklets and wait for her permission. Use stage names and one plain rule each instead.
Do not commit the sketch.

Continue in worktree `/Users/bonorinoa/Hermes/Projects/silicus-wt/G2`, branch `feat/g2` (G2a is done there; read its
summary and `host/README.md` for the routes).

## Build, in `frontend/src/studio/NewCourseWizard.tsx` step "course"

1. **"Who are your learners?"**: five stage cards (Early primary 4–8, Upper primary 8–12, Lower secondary 12–15, Upper
   secondary 15–19, University / adult 18+). One click selects; "Exact ages" steppers refine min and max; the hint says
   mixed ages are fine and the youngest sets the AI rules. Keyboard and screen-reader operable (radio-group semantics).
2. **A thin histogram strip** under the cards: topics per age from the coverage route, the selected range highlighted,
   "Ages 9–10" shown as text.
3. **Topic, two ways**: "Start from the skill map" (a search box over Marble, filtered by the chosen ages, showing name,
   ages and subject; picking one sets `marbleAnchor` and pre-fills the topic text, which the teacher can edit) or "Write
   your own" (today's field). When the ages have no coverage, the skill-map option says so and the teacher writes their own.
4. **"Anything else about the class?"**: optional free text, labelled as context for the AI, never parsed.
5. **Consequence strip** (three tiles, updates live): AI rules for learners (stage from G2a, plain words), Skill map
   (overlapping topic count, or "No suggestions at these ages: you write your own objectives"), Plan voice (one line by stage).
6. The confirm page shows ages, stage and anchor. The Marble credit line (from G1b) appears wherever skill-map content shows.

## Acceptance

Unit tests for the step's state (stage selection, steppers, anchor pick and clear, no-coverage path). Extend
`frontend/scripts/studio-smoke.mjs`: create a course with ages 5–12 and anchor `mt_AzTrT5ySCx`; create one with ages
19–22 and no anchor and check the "no suggestions" path. Narrow shell at 390 px does not overflow
(`frontend/scripts/narrow-shell.mjs`). All STATUS §3 suites exit 0. Two screenshots (desktop, 390 px) committed under
`docs/img/2026-11-14-wizard-step1-*.png`. Commit on `feat/g2`, no push.

## Fence

No host change unless a G2a route is missing a field (then add it with a test and say so). No `confirm-gate/`, no `api/`.
