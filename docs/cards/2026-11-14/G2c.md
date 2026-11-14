# G2c · The graph on the plan: prerequisite strip, neighbourhood view, objective suggestions

## Design reference

`/Users/bonorinoa/Hermes/Projects/silicus-private/sketches/2026-11-14-marble-neighbourhood.html`: a two-hop view,
columns Foundations / Prerequisites / This lesson / Unlocks next, hard edges solid, soft edges dashed, evidence lines on
hover or focus. Build it with the studio's components and tokens, plain SVG, no graph library. Do not commit the sketch.

Continue in `/Users/bonorinoa/Hermes/Projects/silicus-wt/G2`, branch `feat/g2` (G2a and G2b are done there).

## Build (only for courses with a `marbleAnchor`; others look exactly as today)

1. **Neighbourhood view** in the studio (objectives step and plan step, collapsible), from G2a's neighbourhood route.
   Keyboard-focusable nodes; evidence lines readable without hover on touch.
2. **Prerequisite strip** at the top of the plan: "Before this, learners need: Smart Versus Not-Smart Devices (hard
   prerequisite)", soft prerequisites marked optional.
3. **Objective suggestions from the anchor's evidence lines** on the objectives step: each line is a "Use as my
   objective" button that **pre-fills the teacher's own write-your-own objective field**. The teacher edits and submits it as
   their own; it goes through the existing confirm flow unchanged. Nothing is added or confirmed by the click alone.
4. The Marble credit line wherever this content appears.

## Acceptance

Unit tests for the view's layout (nodes per column, edge styles) and the pre-fill (a click changes the field, the record
gains nothing until the teacher submits). Studio smoke: on the 5–12 anchored course, the strip names `mt_WRRv1ABECC` as hard,
the view shows the soft edge to `mt_kH1DzOPsXG`, and using a suggestion then confirming produces a teacher-origin objective
with a local URN. Narrow shell at 390 px. All STATUS §3 suites exit 0. Screenshots under `docs/img/2026-11-14-graph-*.png`.
Commit on `feat/g2`, no push.

## Fence

No `confirm-gate/`, no `api/`, no plan prompt change. No course paths, coverage maps or student progress views.
