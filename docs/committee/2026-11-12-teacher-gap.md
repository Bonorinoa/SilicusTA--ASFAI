# Teacher-side gap audit — 12 November 2026

Read-only audit. No product code was edited, nothing was committed, and `docs/STATUS.md` was not
modified. STATUS section 2 stays authoritative; this list only says whether each reported teacher-side
item is still open in the code, or was closed by a later commit.

## Method

- Baseline for STATUS §2: `main` at `6a956d8` / `2e7f233` (2026-10-19). Everything below was re-checked
  at the current product-code HEAD: `3a01b1d` (2026-10-20 11:31 -0700, the `v0.6.0` release code). Only
  one commit (`33e6c44`, docs release record) sits after it, so "closed in a later commit" can only mean
  closed by the evening sprint merged as `1db6b51` and fixed at `3a01b1d`.
- Each item was checked in source: `search_code` on the code graph
  (`Users-bonorinoa-Hermes-Projects-silicus-asfai-handoff`, index ready, 4317 nodes), then targeted
  reads/diffs of the files the item cites. The file paths below are the ones actually read.
- Verdicts are per commit, not per measurement: a live-eval number does not close a code gap.

## Teacher-side items

| # | Verdict | File checked |
|---|---|---|
| 1 | **Still open.** Landing still shows "Class codes · soon"; the studio still says students can't reach this browser and the student space is a preview on this device. Neither file changed in the sprint. | `frontend/src/landing/Landing.tsx:27,145`; `frontend/src/studio/steps/PublishStep.tsx:35` |
| 2 | **Closed in a later commit for the teacher path; narrowed, not removed.** The sprint (R4, `1db6b51`) added the additive `objectivesConfirm: "explicit"` gate, stored per course in the hash-chained `course.created` event, with an explicit `confirmObjectivesCheckpoint` (test-first: `confirm-gate/test/explicit-objectives.test.mjs`, 173 lines). The wizard creates explicit courses. The host default stays `"auto"`, so a course created through the raw API with no flag still auto-confirms — the old behaviour remains for those records. `design/backend-asks.md` line 8 still says #13 is open, but that note dates to 19 Oct (audit at `20acaea`, before the sprint); STATUS wins and the release record (`verification/2026-10-19-sprint-release.md`, row "Objective confirm should be mine") is the newer source. | `confirm-gate/confirm-gate.mjs:648-675`; `host/course.mjs:48-59,86-89`; `host/handler.mjs:288` (route `objectives/confirm`); `frontend/src/studio/NewCourseWizard.tsx:101`; `frontend/src/studio/steps/ObjectivesStep.tsx:134-138` |
| 3 | **Still open.** `#dirty` is still a single boolean (`#dirty = false` in the constructor at `:317`, `#markDirty()` sets it, `publish()` resets it at `:1206`). Nothing in the sprint diff touches the dirty semantics, so "reword and reword back" can still leave the flag set and seal an identical version. The block previously cited as `confirm-gate.mjs:312,1125` is now `:317` / `:1178` because the sprints inserted code above it — same logic. | `confirm-gate/confirm-gate.mjs:317,439-447,1178-1212` |
| 4 | **Still open.** "Known gaps" in the Node-host README is unchanged: revoking a cited objective with no worker leaves the course unable to seal the next version until one is configured. | `host/README.md:295-296` |
| 5 | **Still open.** Course-and-lessons structure does not exist; the copy still says one lesson per course. | `docs/design/glossary.md:17`; `frontend/src/landing/Landing.tsx:20,168` |
| 6 | **Still open.** YouTube is refused online with `YOUTUBE_LOCAL_ONLY`; captions need yt-dlp, which does not run on Vercel. The sprint changed no `api/` file. | `docs/DEPLOY.md:96,111-112` |
| 7 | **Still open (by design).** The integrity section still states tamper-evident, not tamper-proof. | `host/README.md:150-161` |
| 10 | **Still open.** The claim is still on the page and in the studio home (`Home.tsx` line moved 95→93 by the sprint, text identical). No test file or smoke script contains the phrase (grep across `frontend/src`, `frontend/scripts`, `confirm-gate`, `host` finds it only in the two source files). | `frontend/src/landing/Landing.tsx:171`; `frontend/src/studio/Home.tsx:93` |
| 11 | **Still open.** Both retired "seal" strings are still in source: the PublishCard aria-label and the workbench notice. Copy owner decides. | `frontend/src/components/PublishCard/PublishCard.tsx:261`; `frontend/src/workbench/Workbench.tsx:267` |
| 13 | **Still open (narrowed in the repair to new writes; unchanged since).** `CourseSession.create` still keeps names/digests/sizes only for new courses; the browser import (`importAll`) still restores whatever an export file contains, so a legacy/imported record with raw text still lands in the store, view, export and backup. Refuse/warn/accept on import is still the owner's call. | `host/course.mjs:48-59`; `frontend/src/browser/browserHost.ts:190-214`; `docs/STATUS.md` §2 item 13 (residual list unchanged) |
| 16 | **Still open.** B3: `publishBlockers()` checks that *cited* objectives are confirmed, never that every *confirmed* objective is cited — publishing can still seal a confirmed objective the plan does not use. E6: the new wizard caps the title input at 200 chars client-side (`NewCourseWizard.tsx:211,215`), but the host still validates no length and the description field is still unbounded end to end. | `confirm-gate/confirm-gate.mjs:1123-1159` (publishBlockers) + `:1185-1194` (objectiveRefs = confirmed only); `frontend/src/studio/NewCourseWizard.tsx:211,215`; `host/handler.mjs:225-231` |
| 19 | **Still open.** `DEFAULT_TYPICAL_SECONDS` is unchanged by the sprint; the ranges remain hand-widened from a small sample (G6 fixed the wording in round 3, not the figures). | `host/worker-config.mjs:17-27`; `frontend/src/components/AiWaiting/model.ts` |
| 15 | **Already closed (recorded in STATUS; intact).** The sprint's only change to `Rehearse.tsx` is the error-bubble copy via `explainRefusal`; the G4 cancel-keeps-question-and-focus path is untouched. | `frontend/src/studio/Rehearse.tsx` (sprint diff: 3 hunks, error display only); `docs/STATUS.md` §2 item 15 |

## Not teacher-side (listed so the set is complete)

- **Item 8** (assessment net, 52% fresh catch): not a teacher-workflow gap, and still open anyway —
  `host/student.mjs` is byte-identical across the sprint (`git diff 2e7f233 3a01b1d -- host/student.mjs`
  is empty). The 44/44 eval on `3a01b1d` is a measurement on this commit, not a net change.
- **Item 9** (17 Oct evening commits have no verification record): records gap, not code. The sprint's
  later verifier passes cover the sprint's own commits, not `5eae600..20acaea`.
- **Item 12** (three pre-pilot conditions): external/owner-recorded; nothing in this repo closes them.
  The sprint's verifier waiver ("no free model ran") is in the release record, not a closing record.
- **Item 14** (student citations not checked for meaning): student-helper side. `host/student.mjs:363`
  still only filters cite ids to those that exist; no semantic support check.
- **Item 17** (U-1, live path not verified by the independent verifier): verification gap, still open.
- **Item 18** (two tamper mutations M2/M3 have no test): test gap on the host chain; still open (no new
  test names M2/M3 anywhere under `host/test/`, `confirm-gate/test/`).
- Conditions C-1, C-2, C-3, C-5, C-7 are demo-speech conditions, not gaps; C-4, C-6, C-8, C-9 retired
  (STATUS §2 header). The 19 Oct production walk and the 44/44 eval do not retire C-1 (those are not
  the independent verifier's runs).

## Bottom line

Of the teacher-side items in STATUS §2, **one is closed by a later commit** (item 2, for
wizard-created courses, via the additive explicit-confirm gate in `1db6b51`), **one was already
closed** (item 15, G4, intact), and **eleven are still open** (items 1, 3, 4, 5, 6, 7, 10, 11, 13,
16, 19). No closed item was marked closed by editing STATUS.
