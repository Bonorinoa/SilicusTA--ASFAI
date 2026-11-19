# Classic view → studio parity (K5, 18 November 2026)

Card K5. Base: `main` @ `44f4619`, branch `feat/k5`. The classic view is `frontend/src/live/LiveCourse.tsx` and its
panels as they stood at `437f053` (deleted by K1 in `1bdbae8`, `git diff --stat 437f053 1bdbae8 --diff-filter=D`:
37 files, 6,781 deletions). Read with `git show 437f053:frontend/src/live/<file>`.

"Studio" line references are to `44f4619` (before K5's own changes). The last column says what K5 did.

## Teacher-facing capabilities of the classic view

| # | Classic capability (437f053) | In the studio at 44f4619? | Where (file:line) | K5 |
|---|---|---|---|---|
| 1 | Course library: open another course, start a new one (`CourseLibrary.tsx`) | yes | `studio/Home.tsx:19` | — |
| 2 | Onboarding chat: topic, course, outcomes (`OnboardingChat.tsx`) | yes, as a form | `studio/NewCourseWizard.tsx:81`, `studio/steps/BriefStep.tsx` | — |
| 3 | Materials list and its confirmation (`MaterialsPanel.tsx`) | yes | `studio/SourcesPanel.tsx:19` | — |
| 4 | Propose objectives from materials or from the answers (`LiveCourse.tsx:718`) | yes | `studio/steps/ObjectivesStep.tsx:100` | — |
| 5 | Suggest up to 3 more (`LiveCourse.tsx:662`) | yes | `studio/steps/ObjectivesStep.tsx:144` | — |
| 6 | Accept / edit / drop / revoke each objective (`DecisionCard`) | yes | `studio/steps/ObjectivesStep.tsx` | — |
| 7 | Draft, re-draft, confirm and print the plan (`LiveCourse.tsx:746-790`) | yes | `studio/steps/PlanStep.tsx:33`, `:92` | — |
| 8 | **Check the plan with ASFAI** (`LiveCourse.tsx:771`, Node host only) | **no** | — | not restored (see below) |
| 9 | Publish with a two-step confirm; pin the sealed version on this device (`LiveCourse.tsx:422-441`) | yes | `studio/steps/PublishStep.tsx:119`, `studio/useCourse.ts:186-189` | — |
| 10 | **Pinned copies on this device + "Check my pinned copies"** (`LiveCourse.tsx:320-335`, `:943-975`) | **no** (pins were written, never compared; `comparePin` had no caller) | — | **restored** |
| 11 | **Archive the export, read back, digest shown** (`LiveCourse.tsx:337-345`, `:977`, Node host only) | **no** | — | **restored** |
| 12 | **Compare two published versions** (`VersionDiffPanel.tsx`, `versionDiff.ts`) | **no** | — | **restored** |
| 13 | **Revision of a published version** (`RevisionPanel.tsx`): "Version N is published and unchanged; you are drafting N+1", what students read, the change list incl. "Not in the lesson plan yet", draft a new plan | **partly**: "Make changes → Revise objectives", and a "Since version N" list on the Publish step only | `studio/steps/PublishStep.tsx:47-50`, `:78-81` | **restored** the missing parts on every step |
| 14 | Download the student handout (`LiveCourse.tsx:457`) | yes | `studio/steps/PublishStep.tsx:41` | — |
| 15 | Export the published version as tamper-evident JSON (`LiveCourse.tsx:443`) | yes | `studio/steps/PublishStep.tsx:42` | — |
| 16 | Try a student question on the sealed version (`StudentChat.tsx`) | yes | `studio/Rehearse.tsx:44`, `studio/Learn.tsx:14` | — |
| 17 | Check the record's hash chain (`RecordDetails.tsx`, `verifyLog`) | yes | `studio/CourseStudio.tsx:232` | — |
| 18 | Activity rail: who did what (`ActivityRail`) | yes, in the History drawer | `studio/CourseStudio.tsx:230` | — |
| 19 | **Timeline of checkpoints and versions** (`TimelineCard`, `LiveCourse.tsx:980`) | **partly**: the History drawer lists the same decisions as the activity rail | `studio/CourseStudio.tsx:230` | not restored (see below) |
| 20 | **"How it works" first-run tour** (`FirstRunTour`, `LiveCourse.tsx:512`) | **partly**: the top bar links to the landing page | `studio/StudioApp.tsx:69` | not restored (see below) |
| 21 | Browser record: back up and restore (`BrowserRecord`, browser host) | yes | `studio/Home.tsx:105` | — |
| 22 | Demo passcode dialog (`PasscodeDialog`) | yes | `studio/StudioApp.tsx:35` | — |
| 23 | Look back at a finished step, with one way back (`StepIndex`, `LiveCourse.tsx:860-893`) | yes | `studio/CourseStudio.tsx` stepper, `studio/steps/PlanStep.tsx:25` | `data-primary` added to "Back to the current step" |
| 24 | **ASFAI course intake** (added by N2 on 18 Nov for K5V C2/G1): ASFAI asks the clarifying questions (`OnboardingChat.tsx`: "Use ASFAI's questionnaire", "Connect ASFAI", "Send to ASFAI"; `LiveCourse.tsx:283-310`) | **no**: the wizard asks its own questions as a form | — | not restored (see below) |
| 25 | **Record details** (added by N2 on 18 Nov for K5V C2/G2): course id and plan id on screen, the event count, "What the gate said" with the gate's raw publish blockers (`RecordDetails.tsx`) | **partly**: the hash-chain check is row 17; blockers reach the teacher only in plain words (`PublishCard` `reasonsFor`); the raw gate text and the ids are not on screen | — | not restored (see below) |

## Not restored, one line each (the PM decides)

- **#8 Check the plan with ASFAI.** It needs the ASFAI MCP connection, which is Off in the online app (STATUS §3) and
  not a dependency for the December demo (the graph is Marble, read by us). It does not protect the record.
- **#19 Timeline card.** It is a second view of the same events the History drawer already lists; it adds no check
  and no teacher control.
- **#24 ASFAI course intake** (N2). The ASFAI connection is Off in the online app and is not a dependency for the
  December demo; the wizard's own questions cover topic, course and outcomes. The PM decides.
- **#25 Record details** (N2). The raw gate text is what helps diagnose a refused publish (K5V); the teacher sees
  the same blockers in plain words. The PM decides whether a closed "Details" with the raw text is worth restoring.
- **#20 First-run tour.** Onboarding copy, not a record or control feature; the landing page explains the product.

## Where the restored features live (K5)

- `frontend/src/studio/RecordCard.tsx`: "Your record" card on the Publish step, shown once a version exists (published
  view and while drafting the next version). Holds the pinned copies and "Check my pinned copies", "Archive a
  verified copy" (Node host only, as in the classic view), and the version comparison.
- `frontend/src/studio/versionDiff.ts` (moved back from `437f053:frontend/src/live/versionDiff.ts`, unchanged logic)
  and `frontend/src/studio/VersionCompare.tsx` (the classic panel, studio look).
- `frontend/src/studio/RevisionNote.tsx`: the classic RevisionPanel's words, shown above every step while a revision
  is in progress.

## Verification on `feat/k5` (Node v22.22.3, run from the worktree root)

| Command | Exit | Result |
|---|---|---|
| `(cd confirm-gate && node --test)` | 0 | 50/50 |
| `node --test api/test/` | 0 | 57/57 |
| `(cd host && node --test)` | 0 | 432/432 |
| `(cd host && node scripts/e2e-restart.mjs)` | 0 | 58/58 |
| `(cd frontend && npm test && npm run build)` | 0 | 67 files, 615 tests |
| `node frontend/scripts/browser-mode-smoke.mjs` | 0 | 316/316 |
| `node frontend/scripts/studio-smoke.mjs` | 0 | 98/98 |
| `SMOKE_HOST_PORT=8797 SMOKE_APP_PORT=5183 node frontend/scripts/live-host-smoke.mjs` | 0 | 87/87 |
| `node frontend/scripts/narrow-shell.mjs` | 0 | 67/67 |

Smoke assertions changed on purpose (the old ones asserted the defects): browser-mode-smoke expected "No sources yet."
after a reload although the proposals name `hello.pdf`; live-host-smoke expected zero `data-primary` while "Back to the
current step" is the one way on; browser-mode-smoke read the About link's text (now "About" on phones), it now reads
its accessible name.
