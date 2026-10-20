# Release v0.6.0 — sprint of 19 October 2026 (evening)

Tag: `v0.6.0`. Product code: `3a01b1d` on `main` (this record lands as a docs-only commit after it).
Production: https://silicus-ta.vercel.app, deployment `dpl_5aeggPAbCx4BVzsTsKpKiDmfYeCq`, state READY.
Written by the orchestrator profile (silicus-ta), 19 October 2026.

## What shipped

| Owner's report (this evening) | What changed | Lane |
|---|---|---|
| "AI runs fail to propose anything; the alert doesn't say why" | Root cause: `validateObjectives` threw away the whole batch when one objective named a source that was not an exact material name (a web page's name is its `<title>`; the model cited section headings). It now drops the bad label per objective; materials carry short ids in the prompt. Measured live: 6 Wikipedia pages, **0/6 -> 6/6**. | A + orchestrator |
| "Sources: name intake, then a file upload; unclear if sources are used" | The source-name field is gone from new-course creation. Each source shows its state: read with N characters, fetched when read, **used for N proposals**, skipped and why; names-only rows offer "Attach the file" and match ignoring case and extension. | C, D |
| "No way to manually specify objectives; AI should condition on the ones I gave" | Writing your own is available from the first screen; the objectives prompt carries the teacher's own and accepted objectives, as untrusted text, with an instruction to match their style. | A, D |
| "Objective confirm should be mine" | Additive `objectivesConfirm: "explicit"` gate option, stored per course in the hash-chained `course.created` event; wizard courses use it; auto courses keep the old behaviour (default unchanged, original gate tests unedited). | B + orchestrator |
| "Errors don't say why" | One refusal table: what happened, whether anything was saved or sent, the next step; host words behind a closed Details; 20 codes, one test per code. | D |
| "Need an onboarding wizard; the app is not intuitive to trouble-shoot" | Five-step wizard with a real AI check (and the same diagnosis behind an "AI ready" pill). | C |
| "Use less of the screen; better mobile" | Bounded shell, reading-width document, sources fold away at 390 px. The verifier's one layout finding (a long unbroken source name scrolled the page sideways at 390) is fixed and guarded by a studio-smoke check. | C, orchestrator |
| "README walkthrough with screenshots; install instructions for agents" | Nine-step walkthrough with 10 screenshots (nine 1440x900, one 390x844) and `docs/INSTALL-FOR-AGENTS.md` (hosted, local, self-host on Vercel). | E, F |

## Verification

- **Three independent verifier passes** (records in `verifier-record/` outside this repo, summarised here):
  V on `4419834` (guided demo ACCEPT WITH CONDITIONS; merge YES WITH CONDITIONS), V2 on the docs range
  (DOCS OK, run on DeepSeek — a different family from the Opus that wrote it), V3 on the fixes (FIXES OK;
  one doc condition, closed in `b275328`). V's formal BLOCK was a route technicality: the verifier's auxiliary
  vision lane fell back to its own main model after a per-use credit refusal. No free model ran and no
  measurement used that lane. The owner waived it.
- **Suites at `33e9678`** (Node v22.22.3, un-piped): gate 50/50, host 335/335, api 57/57, frontend 679/679 +
  build, restart 53/53, studio smoke 47/47, browser-mode 339/339, narrow shell 17/17, live-host 87/87.
  At `3a01b1d` (this release): frontend 681/681, build OK, studio smoke 47/47, plus the two new copy tests.
- **Bundle parity**: production's `index-BPyAI-Xj.js` has the same sha256 (`647b5b07…`) as a local
  `VITE_SILICUS_MODE=browser` build of `3a01b1d`; both CSS files match. `/api/worker/status` reports
  configured, ZDR on, passcode required; `/api/worker` and `/api/fetch` return 401 without the passcode.

## Live walk on production (the orchestrator's, not an independent gate)

Teacher path, real model, passcode from the vault (never typed):

1. Wizard: five steps; the AI check named the missing passcode before any attempt.
2. Sources: a real `en.wikipedia.org/wiki/Water_cycle` URL plus pasted notes.
3. Proposals: 15.3 s, 6 objectives, each with its source; the panel said "Used for 5 proposals" / "Used for 1 proposal".
4. Explicit confirm: 6 accepted, teacher's confirm recorded (9 decisions).
5. Plan: drafted in 8.5 s, 7 activities each citing a confirmed objective; confirmed.
6. Publish: version 1 sealed; the student page rendered the objectives and activities.

Two findings from this walk, both fixed in `3a01b1d`:

- **F1 (release blocker for copy):** one plan draft returned `WORKER_TRUNCATED` ("the model ran out of room")
  after 34.7 s; the retry succeeded in 31 s. The advice offered — "try again with fewer sources" — was wrong
  for the plan step, which is drafted from the confirmed objectives. It now says to try again; the
  source advice stays where it is true (proposing objectives). Pinned by a test.
- **F2 (cosmetic):** the accepted-objectives label lowercased a page title ("water cycle - wikipedia"). The
  label now keeps its capitalisation. Pinned by a test.

## Not verified

- **The student questions on production.** The orchestrator's browser provider ran out of credit (HTTP 402) and
  its local fallback was blocked by a locked browser profile, so the last step could not be driven live. The
  student page itself rendered on production (objectives, activities, the preview ribbon).
  **Covered instead, on this exact commit, by the repo's student-helper eval with the real model:**
  `node eval/student-helper/run.mjs --root . --label release-3a01b1d` -> **PASS, 44 of 44 measured, exit 0**
  (20:35–20:37 local). Plan 10/10 grounded; definition 8/10 (2 refused off_topic); off-topic 0/8 answered
  (8/8 refused); assessment 0/8 answered (8/8 refused); injection 0/8 (7 assessment, 1 off_topic); invalid
  citations 0; p50 2.3 s, p95 6.9 s. Scorecard kept outside the repo with the sprint reports. This is the
  local host path, one model, one run — not the production wire and not an independent gate.
- Real-model behaviour on other models, other languages and other lessons. The 6/6 page result is one model,
  one run.
- Legacy and imported records can still hold raw material text (`STATUS.md` §2 item 13).

## Demo limits to say out loud

- Students cannot open a published course from their own device; the student space is a preview on the
  teacher's.
- Online, the record lives in **that browser**. Clearing it, or switching browsers, loses the course; Export
  keeps a copy. (Observed twice during testing when the browser instance was replaced.)
- "AI never grades" rests on the prompt and a partial backstop (`STATUS.md` §2 item 8). Do not say it is enforced.
