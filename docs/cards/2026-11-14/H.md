# H · Closing fixes on `feat/g2` before merge

Continue in `/Users/bonorinoa/Hermes/Projects/silicus-wt/G2`, branch `feat/g2` (head `2a52a0e`). Read the conditions in
`git show verify/g2:docs/verification/2026-11-14-g2-verifier.md` (§8, §9) and
`git show verify/p2:docs/verification/2026-11-14-p2-verifier.md` (conditions C1–C4).

## Owner decisions (14 Nov)

- Fix everything the PM recommended. **Stage 3 (ages 12–14): an activity marked AI `permitted` with no first try before it is
  clamped to `forbidden`, with a teacher-visible note** (P2V C2), the same way the other stages are clamped.
- **Output cap:** the v2 plan needs more room than 4,000 tokens (P3a: 11 of 14 calls truncated at 4,000). The owner approved
  raising it. Use **16,000** as the default in both hosts: `host/worker.mjs` (`maxTokens`) and the Vercel function
  (`api/_lib/worker.mjs`: `DEFAULT_MAX_TOKENS`, and the `Math.min` ceiling that currently pins any env value at 4,000).
  Keep `SILICUS_WORKER_MAX_TOKENS` as an override, with a hard ceiling of 32,000. Do **not** carry the evaluation branch's
  65,536. Check that the Vercel function's 115 s upstream deadline and the UI wait ranges still make sense for a longer plan;
  if the plan wait range needs widening, widen it and say so. This is the one allowed `api/` change.

## Fix

1. **Cap** as above, with tests in `api/test/` and `host/test/` for the default, the override, and the ceiling.
2. **Prompt wording (P2V C4):** the plan prompt shares three 10-word runs with the private rubric, and this repository is public.
   Rewrite those sentences in different words, same meaning. Prove it with a script that compares 6-word runs between the prompt and
   `/Users/bonorinoa/Hermes/Projects/silicus-private/plan-rubric/2026-11-14-rubric-v0.3.md` and prints the count (target 0 runs of
   8+ words). Keep that script outside the repo (in your scratch dir); report its output only. Update the prompt snapshot tests.
3. **Clamps (P2V C1, C3):** `helpAfter: "ai"` at stages 1–2 is dropped or rewritten with a note; `operationDoneBy: "ai"` is
   noted at every stage; every model string echoed in a note is clipped with the existing `clean` helper (bounded length).
   Stage-3 rule above. Tests first for each.
4. **Credit (G2V C1):** render `MarbleCredit` inside PlanCard's "Suggested alignment" section whenever any citation has
   `source === "marble"`, anchored or not; assert it in `studio-smoke.mjs`.
5. **Anchor vs ages (G2V L1, L2):** the host refuses an anchor whose age range does not overlap the course ages (`BAD_ANCHOR`), and a
   non-string `marbleAnchor` is a 400.
6. **Empty state (G2V L4):** on the objectives step of a course with no skill-map coverage, one quiet line: "No skill-map topics
   for these ages. Write your own objectives."
7. **Raw id on hover (G2V L3):** the neighbourhood node tooltip shows the topic name and ages, not the `mt_` id.

## Acceptance

All STATUS §3 suites exit 0 on Node 22, plus `narrow-shell.mjs`. Then **refresh the screenshots** under `docs/img/` with the same
names (wizard step 1, graph objectives, graph plan, plan v2 desktop / 390 / print) and add one new screenshot of a stage-3 plan
(ages 12–14) that shows a "Silicus adjusted" note, `docs/img/2026-11-14-plan-v2-stage3.png`. Commit on `feat/g2`, no push.

## Fence

No `confirm-gate/` change. The only `api/` change is the cap. No paid model call.
