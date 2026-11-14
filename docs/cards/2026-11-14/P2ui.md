# P2ui · Show the learning design on the plan

Continue in `/Users/bonorinoa/Hermes/Projects/silicus-wt/G2`, branch `feat/g2` (G2a, G2b, G2c done). First merge
`feat/p2` into `feat/g2` (host-only changes; resolve any conflict in favour of both, with tests) and run the host suites.

## Build (plan step and the published plan view)

1. Stages 1-2: the plan's `aiPolicy` once, at the top, in plain words ("Children don't use AI in this lesson. You may use it to
   prepare."). Stages 3-4: a small AI-status tag per activity (forbidden / permitted / required), with the no-AI alternative
   on hover/focus and always in print.
2. Per activity: a quiet phase chip (1 Notice and guess, 2 Try and fix, 3 Check own work, 4 Keep and reuse), the line
   "Learners first: …", and "Then they decide: …" when present. Channels as small icons or words, never a learner label.
3. "Evidence for this session" as one line under the plan header.
4. "Later" section: each spaced review with its offset ("In 2 days", "Next week"), what changes, and the prompt.
5. The host's clamp `notes` shown to the teacher as a short "Silicus adjusted" list.
6. Print/PDF export includes all of the above (`frontend/src/styles/print.css`).
7. A v1 plan (no new fields) renders exactly as before.

Do not name SYNAPSE or Sarah Chardonnens in the UI yet (permission pending).

## Acceptance

Unit tests for each element and the v1 fallback. Studio smoke: the mock worker's v2 plan shows the policy line, phase chips, one
evidence line and the Later section; a v1 plan shows none of them. Narrow shell at 390 px; print preview screenshot. All STATUS §3
suites exit 0. Screenshots under `docs/img/2026-11-14-plan-v2-*.png`. Commit on `feat/g2`, no push.

## Fence

No `confirm-gate/`, no `api/`. No prompt change (that was P2).
