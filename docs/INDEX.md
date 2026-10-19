# Documentation index

Current status lives in one place: [`STATUS.md`](STATUS.md). This index says what each document is and whether it
is **current** (kept up to date) or **historical** (a dated record that is never edited). For a historical file,
the newer source is named in its row. Audited at `20acaea` on 2026-10-19.

## Start here

| Document | Kind | Use it for |
|---|---|---|
| [`STATUS.md`](STATUS.md) | current, canonical | What is built, what is open, how to run it, the latest evidence |
| [`committee/2026-10-19-briefing.md`](committee/2026-10-19-briefing.md) | dated draft, 19 Oct | The committee briefing |
| [`committee/2026-10-12-to-19-delivery.md`](committee/2026-10-12-to-19-delivery.md) | dated, 19 Oct | Chronological delivery with commit references |

## Spine (current; each one points to STATUS for status)

| Document | What it is | Audit note (19 Oct) |
|---|---|---|
| [`../README.md`](../README.md) | Repo entry, layout, run, boundaries | Its "Status (2026-10-14)" section is now labelled historical. It wrongly said the trust core was untouched since Sprint 2: `b95afc8` changed it. |
| [`../host/README.md`](../host/README.md) | Node host: API, trust boundary, integrity, worker config | The test counts are labelled historical. The stale line saying "`add`/`rename` still write extra keys" was corrected (closed by `bd01d4f`). |
| [`../frontend/README.md`](../frontend/README.md) | Design system, two builds, workbench | The "32 tests" count is labelled historical. Added the studio routes and the studio smoke. |
| [`ROADMAP.md`](ROADMAP.md) | Plan as of 14 Oct | A superseded-items banner was added. The body is unchanged. The banner flags the body's wrong "material never persists" claim, PR #15's real state, and that funding is blocking again on 19 Oct. |
| [`DEPLOY.md`](DEPLOY.md) | Vercel functions, environment variable names, guards, limits | Matches `vercel.json` and `api/` (120 s, 115 s, 20 s). A pointer was added. "Nothing is stored on Vercel" was narrowed to "no course-record persistence"; transit and provider terms still apply. |
| [`design/glossary.md`](design/glossary.md) | Copy contract | A drift note was added: on a proposal the studio shows "Edit" (it sends `rename`), and the contract says "Rename". Escalated, not changed. |
| [`design/backend-asks.md`](design/backend-asks.md) | Frontend-to-host asks | A status note was added (#13 still open in source; Rehearse is built). |
| [`../eval/student-helper/README.md`](../eval/student-helper/README.md) | Eval harness (calls a real model) | Last results are historical (`fa68bf9`). Not re-run after `20acaea`. |
| [`deck/README.md`](deck/README.md) | Slide deck notes | The deck is a historical artifact at `bd01d4f` (14 Oct). Superseded claims are listed. The HTML is unchanged. |
| [`lesson-planning-object.md`](lesson-planning-object.md), [`../confirm-gate/SPEC.md`](../confirm-gate/SPEC.md) | Object contract, trust-core contract | Contracts. Not changed. |

## Historical: never edit (newer source in the right-hand column)

| Document(s) | What they record | Newer source |
|---|---|---|
| `verification/*.md` (16 files) | Dated verifier and checkpoint records. All 16 were read in full on 19 Oct; see the table below. | STATUS §4 |
| `RED-TEAM-2026-10-14.md` | Red team of Sprints 5 to 8 | — |
| `decisions/2026-10-16-google-sign-in-and-drive.md` | Decision memo | — |
| `design/*.md` notes (stage-page, workspace, landing, narrow-width, waiting-experience, youtube-first-run, behind-the-scenes, final-sprint-2026-10-16) | Design notes for the sprint each one names | The code; STATUS §1. `youtube-first-run.md` line 43 says material text is never persisted: true of the propose route it cites, not of course creation (STATUS §2 item 13) |
| `../.hermes/plans/*.md` (6 files) | Dated sprint plans | STATUS |
| `deck/silicus-ta-3.0-how-it-works.html` | Generated deck at `bd01d4f` | `deck/README.md` note; STATUS |
| `../eval/student-helper/scorecard-*.md`, `compare.md` | Eval results for the sha each one names | STATUS §2 item 8 |
| `archive/`, `research/`, `mcp-ux-scorecard.md`, `../patches/` | October MCP evidence, research, upstream patch | — |

## Verification records, one by one (historical; read in full, never edited)

"Later state" was checked in source at `20acaea`, not taken from a later record. A verdict covers only the
sha in its row.

| Record | Verdict, sha judged, verifier route | What it found | Later state (source at `20acaea`) |
|---|---|---|---|
| `2026-10-14-online-round1.md` | BLOCK, `feat/online` (sha not stated), gpt-5.6-luna | MED-1: the browser bundle held three server env names | Cleared by round 2 |
| `2026-10-14-online-round2.md` | NO BLOCK, `e0ffe1a`, gpt-5.6-luna | All 8 criteria pass | — |
| `2026-10-14-hotfix-deadline-round1.md` | BLOCK, `cfd9cc4`, gpt-5.6-luna | HIGH: `/api/worker/status` had no deadline | Cleared by round 2 (10 s status deadline) |
| `2026-10-14-hotfix-deadline-round2.md` | NO BLOCK, `4360798`, gpt-5.6-luna | LOW: a blank line at EOF in a test | — |
| `2026-10-14-polish-round1.md` | BLOCK, `bbfb783`, gpt-5.6-luna | HIGH: the client could set `max_tokens` | Cleared by round 2. Still server-owned: `api/_lib/worker.mjs:72-73` |
| `2026-10-14-polish-round2.md` | NO BLOCK, `ae8fe06`, gpt-5.6-luna | No findings | — |
| `2026-10-15-checkpoint.md` | Checkpoint (owner approved shipping with the narrow round 3 incomplete) | Gaps: verifier fallback chain; online paste missing; asfai-education PR #15; ASU data-classification check | Paste exists online now (`frontend/src/studio/SourcesPanel.tsx:110`). The other three have no closing record: STATUS §2 item 12. PR #15 is now CLOSED unmerged (parent's 19 Oct readback), so "needs a reviewer" no longer applies; what replaces it is open |
| `2026-10-15-narrow-round1.md` | BLOCK, `cd146a0`, StepFun free model via nous | Pluralisation misses; a doc's "after" column was wrong; smoke blind spots. Notes that a bare `node --test` at the root exits 1 | Cleared by round 2, except the blind spots (below). Root-run note: STATUS §3 |
| `2026-10-15-narrow-round2.md` | BLOCK, `cec73b0`, StepFun free model via nous | One count in `design/narrow-width.md` (14 vs 34). MEDIUM: the smoke's left-edge, vertical and visibility blind spots remain | The count was fixed before ship (15 Oct checkpoint). The blind spots were not re-checked here |
| `2026-10-15-narrow-round3-incomplete.md` | Provisional BLOCK, no verdict, scope `cec73b0..e8ab2a6` | Stub only. The run did not finish | The 15 Oct checkpoint explains it (session lease lost) |
| `2026-10-16-tonight-round1.md` | NO BLOCK, `fbc5750`, deepseek-v4.1-flash via nous | Minor: rail decision counts never rendered (host keys `accept`, rail read `accepted`) | Fixed by `1f4cf15`: `host/activity.mjs:17` maps to `accepted` and so on |
| `2026-10-16-tonight-round2-incomplete.md` | INCOMPLETE, no verdict, delta `fbc5750..e4b6d81` | Infrastructure failure, then a free-model fallback | Folded into V3 in `2026-10-17-weekend-share.md` |
| `2026-10-16-final-sprint.md` | NO BLOCK, `9bbbc0e`, grok-4.7 via xai-oauth | Copy rulings held; Node v22.22.3 | Commits after it changed smoke scripts only (that record) |
| `2026-10-16-checkpoint.md` | Checkpoint, prod `3ed0d10`; tag `v0.3.0` at `ec9d16e` | Gaps: no new Marble auto-bind test; course library parked; BYOK parked | Not re-checked here |
| `2026-10-17-weekend-share.md` | V3 NO BLOCK, `e03cf14`; V2 NO BLOCK for `fbc5750..e4b6d81`; grok-4.7 via xai-oauth. Written 16 Oct, dated 17 Oct by its file name | LOW: retired "seal" wording (4 places); a glossary line 66 mismatch | Glossary fixed (`c53b3ff`). Tour and pin strings fixed. Two "seal" strings remain: STATUS §2 item 11 |
| `2026-10-17-studio-redesign.md` | ACCEPT, `b96b102`, Sonnet 5.5 (the producer's family) | F1: no guard on the "gone when you reload" claim. F2: Edit vs Rename. Caveat: no studio unit tests | F1 still open: STATUS §2 item 10. F2: `design/glossary.md` Known drift. Studio tests added later and unverified: STATUS §2 item 9 |

The "`confirm-gate` unchanged" checks in these records are diffs against the `main` of that day. They do not
contradict `b95afc8` (14 Oct, the `reword` verb). That commit is already an ancestor of the shas these records
name (checked for `cfd9cc4`, `e0ffe1a`, `31f5fbc`, `e33844f` and `d04e162`). Online round 1 names no sha.

## Outside this repo

- Today's test matrix and the committee reports: `/Users/bonorinoa/Hermes/Reports/silicus-committee-2026-10-19/`
  (raw evidence; committed records: `docs/verification/2026-10-19-pm-integration.md` and `2026-10-19-committee-verifier.md`; a re-run of the paid eval is PENDING).
