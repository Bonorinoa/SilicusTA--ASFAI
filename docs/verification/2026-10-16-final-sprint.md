VERDICT: NO BLOCK

# Final sprint — independent verification of 9bbbc0e (2026-10-16)

Verifier: profile `verifier`, model route `grok-4.7` via provider `xai-oauth`
(task `t_ffaac016`, run after the Codex-seat 429; not the producer, not Claude).
Fence honored: no merge, no push, no rebase, no tag, no port 5173 or 8787 bound,
pids 93934 and 93941 not signalled (they were already gone when checked), `wt-int`
not edited, no live Marble/ASFAI graph call, no new dependency, no anthropic
provider set in this run. The only file written under the project is this report.
It is untracked. HEAD of `sprint/final-patches` is still the sha below.

This NO BLOCK covers exactly `9bbbc0e251fe8c1de7739a49368bb42f6d44501a`.
It does not cover anything merged after it.

- Artifact: commit `9bbbc0e251fe8c1de7739a49368bb42f6d44501a` on `sprint/final-patches`.
- Worktree read: `/Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/wt-final` (clean at that sha).
- Frontend suites ran in a detached worktree of the same sha
  (`/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/wt-9bbbc0e`), because
  `wt-final/frontend/node_modules` is a broken symlink to `wt-int` (which has no
  `node_modules`). Lockfile blob `84a032ce8a4f2e3b304cfa069606f7e6ee7a26d7` is the
  same at this sha and at the handoff checkout, so that checkout's `node_modules`
  was symlinked in. The detached tree was restored clean after the guard mutations.
- Node v22.22.3.
- PR https://github.com/Bonorinoa/SilicusTA--ASFAI/pull/1 was merged by `Bonorinoa`
  at 2026-10-16 20:32 -0700 (merge commit `30acb50`), before this verdict. That is
  the owner's gate, not this run. See "After the sha" below.

## Suites (re-run; exit codes not taken through a pipe)

| Suite | Command | Result | Exit |
|---|---|---|---|
| confirm-gate | `cd confirm-gate && node --test` (wt-final) | tests 41, pass 41, fail 0 | 0 |
| host | `cd host && node --test --test-timeout=30000 --test-force-exit` (wt-final) | tests 296, pass 296, fail 0 | 0 |
| frontend | `cd frontend && npx vitest run` (detached sha, local vitest 3.2.7) | Test Files 41 passed, Tests 528 passed | 0 |
| frontend build | `cd frontend && npm run build` (`tsc -p tsconfig.json && vite build`) | built in 2.06s, 139 modules | 0 |
| confirm-gate diff | `git diff -- confirm-gate/` and `git diff 9bbbc0e^..9bbbc0e -- confirm-gate/` | empty | 0 |

The first `npx vitest run` inside `wt-final` exited 1. That was the broken
`node_modules` symlink: npx fetched vitest@5.0.5 and could not resolve
`@vitejs/plugin-react`. It is not a failure of the sha. The counted run is the
second one, which did not download a package (`no npx download warning`).

`npm run build` printed Vite's existing chunk-size advisory for `pdf.worker`
(not in this commit). `tsc` is in the build script and did not fail. Exit 0.

Host used the same `--test-timeout=30000 --test-force-exit` flags earlier
verifications needed so the runner exits. The summary line is `1..296` /
`# pass 296` / `# fail 0`.

Named tests, same tree, `npx vitest run … -t "shows Model name for the whole session|ASFAI is defined as a protocol exactly once"`: 2 passed, 56 skipped, exit 0.

## What the commit actually contains

`git show --stat 9bbbc0e`: 17 files, +135 / -46. confirm-gate is not among them.

1. Rail caption (`ActivityRail.tsx`). `worker == null` yields no caption.
   A non-empty trimmed string yields `Model name: ${name}`. Anything else
   (null, missing, whitespace) yields `Model name: not reported`. The caption
   is outside the in-flight block, and the rail no longer returns null when
   the only thing to show is the caption. There is no `Drafting model:` caption
   string in that file. `LiveCourse` starts `worker` at null, passes the whole
   status object through, and on a failed status call sets `{ configured: false }`
   (no model, so the caption says not reported rather than staying blank).
   `host/worker.mjs` adds `get model()` returning `this.#model` (`null` when
   unset). `transport.ts` types `model?: string | null`. `handler.mjs` adds
   `model: planWorker.model` to the existing status allow-list.
2. Landing. The "How it works" section sits between "Who it is for, and where
   it stands" and "For developers: run it locally". Its paragraph is byte-for-byte
   Variant A from the copy deck (sentence 6 included; no percent sign). The
   never-grades sentence is "You can ask the helper a question a student might
   ask, about a published version." Developer copy says "ASFAI is a protocol…",
   "send a plan to ASFAI", and "Send a plan to ASFAI from the course page".
   `ASFAI account` and `lesson-records` are absent from `Landing.tsx`.
   Eyebrow `A prototype, for teachers of learners aged 5–14` is identical to
   the parent commit, as is the h3 "Teachers of learners aged 5–14".
3. README.md adds one sentence: "ASFAI is a protocol, not the model and not the LMS."
   One occurrence.
4. `docs/design/final-sprint-2026-10-16.md` records what landed, what was refused
   (including the "Drafting model:" prefix and Variant B), and revert = `git revert`.
   The four Marble citations are real tests, not new ones. Titles checked:
   confirm-gate "(v) add mints a new local objective whose id is not an mt_* id";
   derive-objectives "the host derives objectives from the teacher's recorded answers, not from the caller"
   (assertion "no Marble id anywhere" — the note paraphrases the title);
   proposer "a proposal is always kind:local — the proposer cannot mint a Marble id";
   draft-with-context assertion "the sealed version carries no alignment suggestions".
5. Intake prompt/hint, file-picker paragraph, and "Check a student question"
   (LiveCourse button, StudentChat summary and aria-label) are in this commit.
   Glossary section title updated to the same label. `host/test/materials-flow.test.mjs`
   now deep-equals `/api/worker/status` to
   `{ configured, zdr, provider, model, typicalSeconds }` and nothing else.

## Copy rulings (independent)

Agree with the rulings, and the commit follows them rather than the deck's
original caption pattern.

- Caption prefix is `Model name:`, not `Drafting model:`. The lane is still
  named "Drafting model" (`lanes.ts`, unchanged). A caption with that prefix
  would read twice next to "Drafting model: Drafted 3 objectives…". The deck
  offered the colliding prefix and left the clash to a ruling. The ruling won.
- Landing sentence 6 is Variant A. Compared to `copy-deck.md` section 4: equal.
  Variant B's percent signs are not on the page. The copy-contract test still
  forbids `/\d+\s?%/` and passed inside the 528. The paragraph does contain
  "44" and "about ages 4–15". That is what Variant A is. "Words, no percent
  sign" was the ruling; it was not a ban on those two figures.
- Eyebrow left alone. Marble's 4–15 is in "How it works", as the skill map.
  The two ranges are not merged.

No test pins the teacher-asks sentence. The source has it, matching conflict
fix A. That is a coverage gap, not a wrong sentence.

## Red-team: log, provenance, mt_*, invented name

No separate document titled "problems list" exists in the sprint artifacts
(copy deck, RULINGS, RESUME, PR body, design note). The checklist in the
acceptance is what was read against the diff.

- Nothing new lets a client reach the event log. The only host change in the
  status route is one field on an object the route already returned:
  `handler.mjs:146` returns `reportWorker()`, and that function builds
  `{ configured, zdr, provider, model, typicalSeconds }`. The materials-flow
  test deep-equals that object. An extra key (log path, provenance, credential)
  would fail it. That test passed.
- Nothing new lets a client set or read provenance. No route was added. The
  rail does not fetch. It renders `worker.model` as a React text node.
  `LiveCourse` passes the status object, not the course record.
- Nothing new lets a client mint or fetch an `mt_*` id. confirm-gate is
  untouched (`git diff` empty). The new landing sentence says a miss becomes
  a local objective; it does not embed an id. The cited tests still forbid a
  proposal id that is an `mt_*`. An alignment `publicId` can still be an `mt_*`
  when the teacher's own add decision carries one (confirm-gate test (v)).
  That path is older than this commit and is not a client-supplied reach
  added here.
- The caption does not invent a name. Probe, no port bound, `workerFromEnv({})`
  and `new PlanWorker({})`: `model === null`, `enabled === false`. The UI then
  says "not reported", or says nothing while the request is still pending.
  `workerFromEnv({ SILICUS_WORKER_MODEL: "host-model-x", … })` returns that
  string unchanged. The OpenRouter preset in `host/server.mjs` (not in this
  commit) still fills `deepseek/deepseek-v4-flash-0731` when the provider is
  set and `SILICUS_WORKER_MODEL` is empty. That is the model `workerFromEnv`
  will call, not a caption fallback. Unset provider and unset model stay null.

## Evidence triangle (the two named guards)

Both were distrusted enough to break, because a passing suite does not show
the assertion is the thing holding the behavior.

Rail test "shows Model name for the whole session…":
- Asserts: with `worker.model === "host-model-x"` the text matches
  `/Model name: host-model-x/` both while a step is in flight and at rest;
  null, whitespace, and a nameless object match `/Model name: not reported/`
  and not `/null/`; `worker={null}` does not match `/Model name/`.
- Would catch: the old "only while it works" caption, a `Drafting model:`
  prefix, a blank when the name is missing, the word "null", and a caption
  shown before the status request answers.
- Removed the guard: prefix rewritten to `Drafting model:` → exit 1,
  `expected … to match /Model name: host-model-x/`. Missing-name branch
  rewritten to `Model name: gpt-invented` → exit 1,
  `expected … to match /Model name: not reported/`. File restored;
  `git diff` empty.

Landing test "ASFAI is defined as a protocol exactly once":
- Asserts: `/ASFAI is a protocol[^.]*\./g` has length 1, text does not match
  `/ASFAI account/`, text matches `/send a plan to ASFAI/`.
- Would catch: the old "lesson-records product" definition (the regex would
  be length 0), a second "ASFAI is a protocol…." sentence, and "ASFAI account".
  It does not count "an optional protocol" in "How it works" as a second
  definition. That phrase is the deck's sentence 4, and it does not say
  "ASFAI is a protocol".
- Removed the guard: a second "ASFAI is a protocol…" sentence added → exit 1,
  `expected [ …(2) ] to have a length of 1 but got 2`. File restored;
  `git diff` empty.

## After the sha (not covered)

`origin/main` is `3ed0d10`. `9bbbc0e` is an ancestor. Commits after it, all
by Augusto Gonzalez Bonorino:

- `30acb50` Release v0.3.0 (merge; parents `d04e162` and `9bbbc0e`)
- `ec9d16e` prod-narrow: exempt screen-reader-only text
- `3ed0d10` smokes follow the final-sprint copy

`git diff --stat 9bbbc0e..origin/main` is four smoke scripts only
(`browser-mode-smoke.mjs`, `live-host-smoke.mjs`, `narrow-shell.mjs`,
`prod-narrow.mjs`). `git diff 9bbbc0e origin/main -- README.md docs frontend/src host confirm-gate api`
is empty. Those smoke edits were not run and are not part of this verdict.
