# HV · Final gate on `feat/g2` before merge to `main`, 14 November 2026

**Verdict: ACCEPT WITH CONDITIONS.** No block. `feat/g2` is **ready to merge into `main` on the merits of the code**, with six
conditions listed in §9. Two of them (C1 and C2) are worth a decision from Augusto before the 1 December demo; none needs a
code change before the merge.

- Artifact: branch `feat/g2` @ `2d92516` (32 commits ahead of the merge-base `97cf7d9`, all by one author, Augusto's identity:
  `git log --format='%an <%ae>' main..feat/g2 | sort | uniq -c` gives `32 Augusto Gonzalez Bonorino <agonz439@asu.edu>`).
- Merge mechanics: `git merge-tree --write-tree main feat/g2` exit 0 (clean). `main` has moved by 26 files since the merge-base;
  `git diff --name-only 97cf7d9 main | grep -v '^docs/'` prints nothing (exit 1), so `main`'s movement is docs only.
- Verifier branch: `verify/h` (this record and `2026-11-14-h-final-gate_probe/`, on top of `2d92516`, not pushed). Worktree
  `/Users/bonorinoa/Hermes/Projects/silicus-wt/HV`.
- Node v22.22.3 for every command (`node -v` printed it; the runner refuses any other).
- Probe folder `docs/verification/2026-11-14-h-final-gate_probe/`: `run-suites.sh`, `probe.mjs`, `prompt.mjs` + `overlap.py`,
  `mutate.sh`, and `logs/` (suites, probe, overlap, mutation).

## 1. Producer route (card item 1)

Source: board DB `~/.hermes/kanban/boards/silicusta-sprint/kanban.db` (`tasks`, `task_runs`) plus the profile `agent.log` files, per
time window. Commit times from `git log --date=format:%H:%M`.

| Card | Profile and run | Model from the agent log | My check |
|---|---|---|---|
| H (`t_80402cbc`) | engineer, runs 66 (`timed_out`, 20:06-20:17) and 67 (`gave_up`, 20:17-20:30). Run 68 is a PM close at 21:35. Commit `27bc081` at 20:22. | `engineer/logs/agent.log`, 14 Nov 20:06-20:30: 120 `API call` lines, **all** `deepseek/deepseek-v4-flash-0731` provider `nous`. Card override is the same model. | **No Claude fallback.** Independent of me (not Claude). `93e6b35` (21:34) is the PM's untested checkpoint, written in no producer run. |
| H2a (`t_2193c123`) | creative, run 69 (21:35-21:45) | `creative/logs/agent.log` 21:35-21:46: 57 calls, all `claude-opus-5-5` `anthropic` | **Same family as me.** |
| H2b (`t_8762692e`) | creative, run 70 (`rate_limited`, 21:46-22:40) and run 71 (22:45-23:03) | run 71 window 22:45-23:04: 34 calls, all `claude-opus-5-5` | **Same family as me.** |
| HV (this gate) | verifier, run 72 | `verifier/logs/agent.log`: `claude-sonnet-5-5` `anthropic`, 0 fallback lines in this window | |

The creative log has two `Fallback skip: anthropic/claude-sonnet-5-5 credential pool is exhausted` warnings (21:59, 22:45). Both
say a fallback was skipped; no call went to another model. So the only Claude involvement is the intended Opus route. Because H2a
and H2b are same-family as this verifier, the verdict below leans on executable evidence: the suites, my own probes, mutation
checks, and the screenshots.

## 2. Clean export, every STATUS §3 suite (card item 2)

`ROOT=/Users/bonorinoa/Hermes/Projects/silicus-wt/G2 BR=feat/g2 bash run-suites.sh`: `git archive feat/g2 | tar -x` into scratch,
exit codes captured per suite, never through a pipe. Logs in `logs/suites-summary.txt` and `logs/suites-counts.txt`. Export sha
`2d92516eb6e4c085213319a43ad8289df204e70c`.

| Command (from repo root) | Exit | Count |
|---|---|---|
| `(cd frontend && npm ci)` | 0 | |
| `(cd confirm-gate && node --test)` | 0 | 50 tests, 50 pass |
| `node --test api/test/` | 0 | 57 tests, 57 pass |
| `(cd host && node --test)` | 0 | 402 tests, 402 pass, 0 fail, 0 skipped |
| `(cd host && node scripts/e2e-restart.mjs)` | 0 | 58/58 |
| `(cd frontend && npm test)` | 0 | 70 files, 738/738 |
| `(cd frontend && npm run build)` | 0 | built |
| `node frontend/scripts/studio-smoke.mjs` | 0 | 80/80 |
| `node frontend/scripts/browser-mode-smoke.mjs` | 0 | 339/339 |
| `node frontend/scripts/live-host-smoke.mjs` | 0 | 87/87 |
| `node frontend/scripts/narrow-shell.mjs` | 0 | 45/45 |

Compared with my G2V run on `2a52a0e`: host 395 to 402, frontend 69 files / 722 to 70 files / 738, studio 77 to 80, narrow 43 to 45;
confirm-gate, api (57), e2e, browser-mode and live-host are unchanged. First and only run of each; none was retried.

## 3. Each H item, with my own probe (card item 3)

`node probe.mjs <export>` drives the real code in the clean export (real `PlanWorker`, the real Vercel handler, the real Node app with
the pinned Marble snapshot). Exit 0, **45 of 45 PASS** (`logs/probe.out`). To prove the probe can fail, and that the shipped tests
guard each item, `mutate.sh` breaks one guard at a time in a scratch clone (`logs/mutation.txt`).

| H item | My probe result | Mutation: does the shipped suite catch the break? |
|---|---|---|
| Cap default 16,000, both hosts | Host `PlanWorker` request body `max_tokens` = 16000 with no config. Vercel handler, env unset, even with a client sending `max_tokens: 99999`: 16000. Constants `DEFAULT_MAX_TOKENS` 16000, `MAX_TOKENS_CEILING` 32000, `UPSTREAM_TIMEOUT_MS` 115000. | |
| Override honoured | Host `maxTokens` 20000 sends 20000, 32000 sends 32000. Vercel env 20000 sends 20000, 32000 sends 32000, 500 sends 500. | |
| Ceiling 32,000 | Host 32001 and 65536 send 32000. Vercel env 65536 sends 32000. Junk, 0, -5, 1.5, `"9"` fall back to 16000. | M5 (host ceiling removed): host `worker.test.mjs` 1 fail of 49. M6 (api ceiling removed): `api/test` 1 fail of 57. **Caught.** |
| No 65,536 anywhere | `git grep -n -E "65[_,]?536" feat/g2` has 3 hits, all negative: a comment in `api/_lib/worker.mjs:28`, and two test lines that assert the clamp (`api/test/worker.test.mjs:246`, `host/test/worker.test.mjs:253`). No code path uses 65,536 as a value. A strict reading of "nowhere" is not met by the comment and the two test inputs; I read the intent as "not a value", which is met. | |
| Stage clamps and the new stage-3 rule | Stage map by youngest age: 5 to 1, 9 to 2, 12 to 3, 16 to 4. Stage 3: `permitted` with no first try becomes `forbidden` plus a note; `permitted` with a first try stays; `required` with a first try becomes `permitted`; `required` with no first try becomes `forbidden` with two notes. Stage 4: `permitted` with no first try is **not** clamped (the rule is stage 3 only). Stage 1 `permitted` becomes `forbidden`; stage 2 `required` becomes `permitted`. | M4 (stage-3 rule disabled): host suite 2 fail of 402 (the unit test and the stage-3 scripted-plan test). **Caught.** |
| `ai` help and operation cases | `helpAfter: "ai"` is dropped with a note at stages 1 and 2, and kept at stage 3, stage 4 and with no ages. `operationDoneBy: "ai"` gets a note at every stage and with no ages (5 of 5). | Not mutated separately. `plan-schema-v2.test.mjs:153` ("P2V C1: helpAfter \"ai\" is dropped at stages 1-2 with a note, and kept ... at stages 3-4") covers the first case. |
| Notes bounded | Five fields fed 5,000-character model strings (`aiStatus`, `helpAfter`, `operationDoneBy`, a channel, a session evidence kind): 8 notes, longest 170 characters (limit I set: 400). Fixed clamp notes are under 300. | |
| Credit inside Suggested alignment, with and without an anchor | Source: `PlanCard.tsx:382` renders `MarbleCredit` inside the `<details>` whenever any citation has `source === "marble"`. Two PlanCard unit tests (anchored; no anchor with a mixed Marble row). `studio-smoke.mjs:440-442` asserts exactly one credit inside the section, with the ODbL, CC BY-SA and attribution links, and a collapsed summary matching `Suggested alignment N references`. | M1 (credit line removed): 3 fail of 45 in `src/components/PlanCard`, including both named tests. **Caught.** |
| Anchor / ages refusal, non-string anchor | Real Node app, snapshot anchor `mt_AzTrT5ySCx` (ages 5 to 12): with course ages 5 to 12, 201. With course ages 19 to 22: **400 `BAD_ANCHOR`**, "the anchor's ages (5-12) do not overlap the course ages (19-22)". `marbleAnchor` of `123`, `{a:1}`, `["mt_AzTrT5ySCx"]`, `true`: each **400 `BAD_ANCHOR`**. `null`: stays absent, 201. A made-up `mt_GHOST`: 400 `UNKNOWN_ANCHOR`. | **M7 (overlap refusal removed): host suite 402/402 still pass. M8 (non-string refusal removed): 402/402 still pass. Neither guard has a test (C1).** |
| Empty-state line | `SkillMap.tsx:22` holds the exact line "No skill-map topics for these ages. Write your own objectives."; unit test for ages 19 to 22 (no coverage) and a negative case (coverage, anchored, no ages). | M3 (line reworded): 1 fail of 20 in `src/studio/graph`. **Caught.** |
| No `mt_` in the tooltip | `SkillMap.tsx:121`: `<title>` is `${name}. ${ages}.`. The prerequisite strip puts `data-marble-id` in an attribute, not in visible or tooltip text. | M2 (id added to the title): 1 fail of 20. **Caught.** |
| Plan wait range 10 to 60 s, upstream deadline | `host/worker-config.mjs` `plan: [10, 60]`; the 115 s upstream deadline is unchanged; `api/test/status.test.mjs` follows the range. The `api/` diff is `worker.mjs` (cap only) plus test files (cap, and the status range). | n/a |

## 4. Prompt overlap with the private rubric, and the Chardonnens grep (card item 4)

**Overlap (`prompt.mjs` then `overlap.py`, logs in `logs/overlap.out`).** `prompt.mjs` captures the plan prompt the real `PlanWorker`
sends for six variants (base, stages 1 to 4, anchored). `overlap.py` lower-cases both sides to words and finds maximal common runs
of 6 or more words. Output prints counts and lengths only; no rubric text is copied into this repository.

| Source | Runs of 6+ words | Longest |
|---|---|---|
| Five booklets (`sarah/*.docx`) | 0 in each | none (at a 4-word threshold: 4 in two booklets, 0 in three) |
| `plan-rubric/2026-11-14-rubric-v0.3.md` (path from H.md) | 30 (4 distinct) | **11 words** |
| `rubric-v0.3-changes.md`, `rubric-v0.3-decisions.md` | 0 | none |
| `rubric-v0.2.md` (older) | 30 | 11 words |

I looked at the four distinct runs on the prompt side. Three are enum lists inside the JSON-shape lines that any prompt with the same
field names must contain (the review-form values, the `helpAfter` values, the channel values; 11, 8 and 7 words). The fourth is a
6-word prose clause about channel labelling. So:

- H's "0 runs of 8+ words" is **true for prose and false if enum lists count**. The longest shared run overall is 11 words, and it
  is an enum list. P2V's earlier finding was three 10-word **prose** runs; those are gone.
- There is one 6-word prose clause left. It is under the 8-word target. Whether that is acceptable for a public repository is
  Augusto's call (C3), not mine.

**SYNAPSE / Chardonnens grep.** `git grep -n -i -E "synapse|chardonnens" feat/g2 -- . ':!docs' ':!.hermes'`:

- Credit comments, 4: `host/worker.mjs:296`, `host/ages.mjs:6`, `frontend/src/studio/audience.ts:8`, `host/test/ages.test.mjs:6`.
  `worker.mjs:296` reads "Sarah Chardonnens, SYNAPSE model (University of Fribourg). Restated in our own words."
- Negative assertions that the UI does **not** name them, 2: `studio-smoke.mjs:478` and `PlanCard.design.test.tsx:90`.
- `host/data/marble/marble-snapshot.json`: 1 occurrence of the lower-case word "synapse", in neuroscience topic text and a prerequisite
  reason. Unrelated to the model (checked with `grep -o` context).
- No hit in any prompt string.

**Built bundle** (`frontend/dist` of the clean export): `grep -r -i -l -E "synapse|chardonnens" ... --include=*.js --include=*.html
--include=*.css --include=*.md` exit 1, no files. The only file with the word is `assets/marble-snapshot-*.json` (the same neuroscience
word). So the built app names neither the model nor the author.

## 5. Diff scope (card item 5)

`git diff main...feat/g2 --stat`: 83 files, 5,488 insertions, 117 deletions. Top-level areas touched, from
`git diff main...feat/g2 --name-only | cut -d/ -f1-2 | sort | uniq -c`:

| Area | Files |
|---|---|
| `api/_lib`, `api/test` | 1 + 2 |
| `docs/img` | 10 (screenshots only; no `docs/` text file, no `STATUS.md`, no dated record) |
| `frontend/src` | 35 |
| `frontend/scripts` | 3 |
| `frontend/vite.config.ts` | 1 |
| `host` (code, tests, data, scripts, sources, marble, README) | 1 README, 1 ages, 1 course, 2 data, 1 handler, 1 knowledge, 1 marble, 1 record-store, 2 scripts, 1 server, 1 sources, 1 store, 15 test, 1 worker-config, 1 worker |

- `api/`: the **only** non-test change is `api/_lib/worker.mjs` (cap 16,000, ceiling 32,000, comment). The two `api/test` files carry
  the cap tests and the status wait range (plan 10 to 60). I read the whole `api/` diff. Condition met.
- `confirm-gate/`: `git diff --quiet main...feat/g2 -- confirm-gate` exit 0 (no diff). Condition met.
- `.hermes/`, `docs/STATUS.md`, `docs/verification/`, `docs/decisions/`: not in the diff.

## 6. Screenshots (card item 6)

All ten files in `docs/img/2026-11-14-*.png` (from the clean export, so they are what is committed). I looked at each; descriptions are
mine, produced with the vision tool and checked against the page structure the code renders.

| File | What it shows | Anything wrong |
|---|---|---|
| `wizard-step1-desktop` | New-course step 1 of 5. Title "AI around us". Ages 5 to 12. Band cards 4-8 (solid) and 8-12 (dashed, "covered"). Label "Ages 5–12: Early primary and Upper primary". Anchor "AI in Daily Life" (Computing). Stage 1 of 4 rule. 1,884 topics. | Nothing. One Marble credit (under the anchor card). No `mt_`. |
| `wizard-step1-390` | Same step in one column. | No overflow. One credit. The dashed "covered" band is faint and easy to read as inactive (cosmetic). |
| `graph-objectives-desktop` | Objectives step. Six nodes in four columns: Step-by-Step Instructions, Computers in Everyday Life (foundations); Voice Assistants and How They Work, Smart Versus Not-Smart Devices (prerequisites); AI in Daily Life (this lesson, ages 5-12); Data and Information for Computers (unlocks). | Names wrap inside boxes, up to 3 lines, no overflow, no crossings, separate entry points on the focus box. One credit. No `mt_`. Clean. |
| `graph-objectives-390` | Same, narrow. | Loops in the left gutter still bunch, dashed and solid edges run close together (H2b's known open item; confirmed). One credit. |
| `graph-plan-desktop` | Plan step before drafting: prerequisite banner, "The plan will cite these" (3 objectives), map card with evidence panel. | The short straight arrow between the two prerequisites works. No crossings. **Two Marble credits on this step** (banner and map card). |
| `graph-plan-390` | Same, narrow. | Same bunching in the gutter. Edge lines are faint. Two credits. |
| `plan-v2-desktop` | Drafted plan "Spotting AI in daily life": ages 5-12, 35 min, 3 activities (10, 15, 10) with phase chips 1, 2, 3 + 4, opening bet on Smart Versus Not-Smart Devices, one session evidence line, Later at 2 days and next week, the stage-1 AI line, three objectives, "Suggested alignment · 3 references" collapsed, no "Silicus adjusted" note. | Coherent; times add up; no plants content; no `mt_`. The credit inside the collapsed fold is not visible in this shot (by design; asserted by studio-smoke). |
| `plan-v2-390` | Same plan, narrow. | No overflow or clipping. |
| `plan-v2-print` | Print layout: running header, DRAFT at right, minute labels at right, same sections, footer with plan and course ids. | No clipping, no chrome. No alignment section and no Marble credit in print, which is consistent with the shot: it shows no Marble-derived section. |
| `plan-v2-stage3` | Plan "How a computer finds things fast", ages 12-14, 40 min, 3 activities. Tags: activity 1 No AI, activity 2 AI allowed (the teacher watches the first pass), activity 3 No AI. One "Silicus adjusted" note: AI use "permitted" clamped to "forbidden": at this stage AI may follow only an attempt the teacher has watched. No plan-level AI line. "Suggested alignment · 3 references". | **Contradiction (C2):** activity 3 is tagged No AI but its learner text says "Each learner asks a chatbot why halving is faster". The clamp changes the flag, not the prose. The note does not say which activity it refers to. |

H2b's open question on the missing stage-3 AI line has an answer in code, not a bug: `host/worker.mjs` drops a plan-level `aiPolicy`
for stages 3 and 4 with the note "only stages 1 and 2 carry a plan-level AI line" (owner decision 3 in the P2 round). The "3
references" on the unanchored stage-3 plan come from the host's own Marble retrieval for the topic and ages; the scripted plan
cites the reference ids it is given in its prompt (`scripted-course.mjs:171`). I did not trace a single request end to end.

## 7. Scripted plans are fixtures, not model output (PM's binding comment)

- Labelled: `host/test/scripted-course.mjs:97-99` says "test-fixture content ... Not a product claim, not model output, and not a
  recommended lesson". The test file `scripted-plans.test.mjs` says the same in its header.
- Not shipped: in the built `StudioApp-*.js`, "Spotting AI in daily life" 0 hits, "How a computer finds things fast" 0, `TANGERINE-OCELOT`
  0, `scriptedPlanV2` 0. ("How plants eat" has 1 hit: the course-title input placeholder, present on `main` too.) The only importers of
  the fixture outside `host/test` are `frontend/scripts/{studio-smoke,narrow-shell,browser-mode-smoke}.mjs`, a test helper, and
  `host/scripts/parity-run.mjs`. None is part of the app.
- Weak spot: the ten screenshots carry no visible label and `docs/img/` has no caption file, so a screenshot lifted into a demo deck
  would look like model output (C5).

## 8. What I did not verify

- No paid model call, so no live check of 16,000-token behaviour, of whether a real plan fits the 10 to 60 s "usually" range, or of
  whether a long generation can still exceed the unchanged 115 s upstream deadline. STATUS item 19 already says the wait ranges are
  hand-widened, not measured.
- Screenshots were looked at once each through the vision tool, not re-captured. I did not re-render at 320 px.
- Whether the tooltip text is what a browser shows on hover: I checked the SVG `<title>` source and a unit test, not a real hover.
- Mutations M7 and M8 were run against the host suite only. I confirmed by `git grep` that no frontend, `host/scripts` or `api/test`
  file exercises the two refusals; I did not mutate and re-run the frontend suite for them.
- Producer attribution for `93e6b35` rests on the commit time (21:34) and the PM's own note; no run owns it.
- Nothing was pushed, deployed or merged. I did not edit `docs/STATUS.md` or any dated record.

## 9. Conditions

| # | Condition | Evidence | Minimal fix |
|---|---|---|---|
| C1 | **Test gap.** The ages-overlap `BAD_ANCHOR` refusal and the non-string `marbleAnchor` 400 have no test. The behaviour is right (my probe, §3). | M7 and M8: host suite stays 402/402. `git grep` of `host/scripts`, `frontend/scripts`, `frontend/src`, `api/test` finds no test for either. | Add two cases to `host/test/g2-course.test.mjs` (19-22 with the AI in Daily Life anchor; `marbleAnchor: 123`). Can follow the merge. |
| C2 | **Stage-3 demo contradiction** (owner decision). A clamped activity keeps learner text that tells children to ask a chatbot, and the note does not name the activity. This is the screenshot the demo would show. | `plan-v2-stage3.png`, §6. | Owner picks: name the activity in the note, rewrite the fixture's third activity so its text fits "No AI", or have the clamp also flag the prose. Fixture wording is the cheapest. |
| C3 | **Rubric overlap statement is narrower than H says.** True for prose of 8+ words; the longest shared run overall is 11 words (an enum list); one 6-word prose clause remains. | `logs/overlap.out`, §4. | Augusto decides whether a 6-word clause and the enum lists are acceptable in a public prompt. Otherwise reword that clause. |
| C4 | **Narrow map and credit density, carried.** At 390 px the gutter loops still bunch. The plan step shows two Marble credits (prerequisite banner and map card). | `graph-objectives-390`, `graph-plan-390`, `graph-plan-desktop`. | A later layout card. H2a's "one credit per surface" is met per surface; whether the banner and the map card are one surface is a design call. |
| C5 | **Fixture screenshots are unlabelled.** The file header labels the fixtures; the images do not. | §7. | Caption any use of the ten images "scripted fixture plan, not model output", or add a short `docs/img/README.md`. |
| C6 | **Wait range vs deadline, unmeasured.** Cap is 4x higher, the 115 s upstream deadline is not. | §8. | One owner-run live plan with timing before the demo. |

## 10. Is `feat/g2` ready to merge into `main`?

**Yes, with the six conditions carried.** Every STATUS §3 suite and the narrow shell exit 0 on Node v22.22.3 from a clean export;
each H item holds under my own probe; six of the eight guards I broke are caught by the shipped tests and two (C1) are not, in
a code path that behaves correctly; the diff touches only `api/` (cap), `docs/img`, `frontend`, and `host`, with no `confirm-gate/`
change; every lock I could test holds (the anchor stays a pointer, the clamps are in the host, the built app names neither the
model nor the author, and the fixtures are not in the bundle). The merge is clean. The owner does the merge and any push.

---
Route this run: `claude-sonnet-5-5` / `anthropic` (same family as the H2a and H2b producer; independence for those two comes from the
executable evidence above).
Verification commands and captured exits: `logs/suites-summary.txt` (suites), `node probe.mjs <export>` exit 0 (45/45),
`bash mutate.sh` exit 0 (8 mutations: M1-M6 caught, M7 and M8 survive), `TREE=<export> node prompt.mjs` exit 0 then `python3 overlap.py` exit 0.
