# Final sprint — 2026-10-16

What landed in this commit (branch `sprint/final-patches`, merged to `integration/weekend`):

- **Rail caption (`frontend/src/components/ActivityRail/ActivityRail.tsx`)**: "Model name: {name}" is
  shown for the whole session, not only while a step works. When the worker status is missing, empty,
  or the status call failed, the caption is honestly "Model name: not reported" — never a blank, never
  a guessed name. While the status request is still waiting (no worker object yet) there is no caption.
  Ruling: the prefix is "Model name:", not "Drafting model:" — that prefix already names a lane
  ("Drafting model Drafted 3 objectives…"), and a caption with the same words would read twice.
  `LiveCourse` passes the whole worker state now; `host/worker.mjs` exposes `model`; the rail test
  that pinned the old "only while it works" behavior was updated to pin the whole-session behavior.
- **Landing (`frontend/src/landing/Landing.tsx`)**: new "How it works" section (string 4, Variant A —
  words, no percent signs) between "Who it is for" and "For developers". Two conflict fixes applied:
  "A student can ask the helper…" → "You can ask the helper a question a student might ask, about a
  published version." (the helper is a teacher-side try-out, not a student app), and the developer
  section now calls ASFAI a protocol ("ASFAI is a protocol…"), says "send a plan to ASFAI" instead of
  "connect to an ASFAI account", and the setup step reads "Send a plan to ASFAI from the course page".
  The "aged 5–14" eyebrow was left alone (Marble's 4–15 is the skill map, not the audience).
  `Landing.test.tsx` updated: region count 6→7, the ASFAI definition is asserted once as a protocol
  (not "first mention"), the old pinned "lesson-records product" sentence is gone.
- **README.md**: one sentence added — "ASFAI is a protocol, not the model and not the LMS."
- **Marble**: no live graph was called. Existing tests already prove a children's `mt_*` is never
  auto-bound, so none were added — see the citations below.
- **Intake/material copy, "Check a student question" labels, worker `model` exposure**: already in
  the worktree diff when this run resumed; kept and committed together.

What was refused (and why):

- **"Drafting model: {name}" caption**: refused per ruling — it collides with the existing lane name.
- **Variant B (percent signs)**: refused — the copy-contract test forbids `\d+\s?%`.
- **Merging the age ranges**: the eyebrow "aged 5–14" (audience) and Marble's "about ages 4–15"
  (skill map) are different facts; both appear, each in its place.
- **Auto-binding local objectives to Marble nodes**: no such path exists; the derive/propose pipeline
  only ever mints `kind: local` proposals with no `mt_*`, and an `mt_*` link lands in the record only
  when an explicit teacher decision carries it.
- **Live Marble/ASFAI graph calls in this run**: not needed for any of the changes; the fence said
  not to call the live graph.
- **Merging to `main`**: production merge waits for the verifier (NO BLOCK is necessary, not
  sufficient — the owner gates the final merge).

Marble auto-bind evidence (no new test needed):

- `confirm-gate/test/confirm-gate.test.mjs` "(v) add mints a new local objective whose id is not an
  mt_* id": an alignment lands only when the teacher's own `add` decision carries it; without a
  decision the row is `alignment: null` (`host/course.mjs`).
- `host/test/derive-objectives.test.mjs` "the host derives objectives from the teacher's recorded
  answers": proposals are always `kind: local` with "no Marble id anywhere".
- `host/test/proposer.test.mjs` "a proposal is always kind:local — the proposer cannot mint a Marble
  id".
- `host/test/draft-with-context.test.mjs` "citations are suggestions": the sealed package carries no
  alignment suggestions.

Reverting: `git revert` only — never `git reset` on a branch that feeds a PR/preview. The final
sha is what `git log -1` on `integration/weekend` reports after the merge.