# H2a · Closing fixes, frontend half (H ran out of room)

Continue in `/Users/bonorinoa/Hermes/Projects/silicus-wt/G2`, branch `feat/g2`. **H already did the host side** (commit `27bc081`:
cap 16k/32k in both hosts, prompt rewording proven, clamps incl. the stage-3 rule, anchor/ages refusal, plan wait 10–60 s) and the
PM checkpointed two untested frontend edits on top (Marble credit inside "Suggested alignment", node tooltip = name + ages). Do not
redo or re-explore H's work. Read `docs/cards/2026-11-14/H.md` items 4, 6, 7 only for context.

## Do, in this order (commit a checkpoint after each)

1. **Credit inside "Suggested alignment"** (checkpointed, untested): unit test (with and without an anchor), and a `studio-smoke.mjs`
   assertion. The section never renders as an empty area: rows plus the credit, or collapsed with its count.
2. **Tooltip** (checkpointed): unit test that no `mt_` id appears in node titles.
3. **Empty state:** on the objectives step of a course with no skill-map coverage (ages 19–22), one quiet line: "No skill-map topics
   for these ages. Write your own objectives." Test.
4. **Age bands:** when the exact ages span two bands (5–12), every band the range touches shows a "covered" state lighter than the
   clicked state; the label under the steppers names the range. Test.
5. **One credit per surface:** wizard step 1 keeps the credit under the anchor card and drops the copy in the consequence strip;
   objectives step keeps it under the neighbourhood view and drops the copy under the suggestions. Update the smoke checks that count
   credits so each Marble surface still has exactly one.
6. **"Silicus adjusted" text matches the plan:** the note and the AI line shown must not quote two different sentences. Test.

Run frontend test + build and `studio-smoke.mjs`. Commit on `feat/g2`, no push.

## Fence

No `host/`, `api/`, `confirm-gate/` change. No screenshots (H2b does them).
