# Backend asks from the frontend redesign

Started 2026-10-16 with the full-flow redesign (Augusto + Claude). The redesign is visuals first: screens
may show a feature before the host supports it, behind a dashed "Soon" badge that opens nothing pretend.
Each item says what the screen needs, why, and what the frontend does meanwhile. Add to it as screens land.

> **Status note (audit of 2026-10-19 at `20acaea`; current status lives in [`../STATUS.md`](../STATUS.md)).**
> Every ask below is still open in the host. Checked in source: #13 (`confirm-gate/confirm-gate.mjs:19` still
> confirms objectives automatically) and #1 (students cannot reach a version). The "Meanwhile" column has
> moved. Rehearse is built at `#/studio/<id>/rehearse` (`frontend/src/studio/Rehearse.tsx`), and most "Soon"
> badges were removed on 17 October (`5eae600`, `a48b081`, `ee9f81d`). The ones still in source are "Class
> codes · soon" on the landing and "Local app only" for YouTube in the Sources panel.

Priority: **P1** blocks a destination from working for real · **P2** makes an existing screen honest or
calmer · **P3** nice to have.

## Destinations

| # | Ask | Screen | Why | Meanwhile | P |
|---|---|---|---|---|---|
| 1 | **Reachable published versions.** A read-only URL per published version (`/learn/:courseId/v/:n` or a short code) served from somewhere other than the teacher's browser. | Student space | Records live in the teacher's IndexedDB, so students can't reach anything (ROADMAP §2). The student space is its own destination now. | Student space renders from the teacher's own copy as a preview; "Join with class code · soon". | P1 |
| 2 | **Class codes / join flow.** Teacher makes a code; students enter it with no account. | Student space, Home | Ages 5–14: no logins, no identity. | Badge only. | P2 |
| 3 | **Course sync across devices / share with a colleague.** | Home | "Your courses" is per-browser today; export/import is the only backup. | Badges; export/import stays in the history drawer. | P3 |

## Rehearse (teacher's student simulator)

| # | Ask | Why | Meanwhile | P |
|---|---|---|---|---|
| 4 | **Probe presets as a host concept**: named probes (off-topic, test answers, injection, "how am I doing", personal details) whose expected outcome is a `refusal` code or a grounded answer, and a result of pass/fail against that. | Rehearse shows a guardrail checklist. Today the frontend would have to judge pass/fail from `refusal`/`grounded`, which is the host's call. | Frontend maps `refusal` codes to the probe's expectation; labeled "checked in this tab". | P2 |
| 5 | **Run the eval set from the app** (the 44 questions in `eval/student-helper/`), returning per-question results. | "Run all 44 checks". | Badge only. | P3 |
| 6 | **Saved test sets** per course (teacher-authored questions + expected outcomes), kept on the record but clearly not evidence. | Re-run after each new version. | Badge only. | P3 |
| 7 | **Persona hint** (age band) passed to `student/ask` to set reading level. Must not widen scope. | "Pretend I'm a 9-year-old". | Selector shown, sends nothing; badge "Persona tone · soon". | P3 |
| 8 | **Refusal kinds for "how am I doing" and personal details** if they aren't already distinct from `off_topic`. | Probes need a distinct expected result. | Treated as `off_topic`. | P2 |

## Waiting, streaming, progress

| # | Ask | Why | Meanwhile | P |
|---|---|---|---|---|
| 9 | **Streaming or staged progress** for `materials/propose`, `objectives/suggest`, `plan` (even coarse: `reading` → `drafting` → `checking`). | Skeletons with a real clock are honest but blind; 5–25 s (outliers 52 s) feels long. | Skeleton shaped like the result + real clock + `typicalSeconds` range. No percentages. | P2 |
| 10 | **Per-operation `typicalSeconds`** including `objectives/suggest` and `student/ask` in `/worker/status`. | Each skeleton shows its own usual range. | Reuse the objectives range for suggest. | P2 |
| 11 | **Proposals arrive one by one** (or the response lists them in a stable order with ids before full text). | The proposals tray can fill progressively. | All appear at once when the call returns. | P3 |
| 12 | **Don't hold the course lock for reads during a draft** (or expose "drafting in progress" on the view). | The studio should stay browsable while a plan drafts. | UI disables writes, keeps reads on cached view. | P2 |

## Studio

| # | Ask | Why | Meanwhile | P |
|---|---|---|---|---|
| 13 | **Objectives are not auto-confirmed** when the last proposal is decided; teacher confirms the set with one explicit click. | The redesign gives every step one primary ("Confirm objectives"); today the host confirms itself, so the navigator jumps to Plan while the card is still on screen (stage-page.md). | UI shows the confirm bar but it's a no-op beyond decisions. | P1 |
| 14 | **Edit a Brief answer after confirming** (re-opens the Brief and invalidates downstream, like a reword). | Brief is now a form with all three questions visible and an Edit link. | Edit only before confirm. | P2 |
| 15 | **Merge "files" checkpoint into the Brief.** Sources are a persistent side panel; confirming the source list happens as part of confirming the Brief. | Ends the double material entry (names in onboarding, text later). | UI confirms `files` then `outline` back to back from one click. Needs a check that this is still two explicit teacher turns. | P2 |
| 16 | **Keep material text across reloads (opt-in)**, or at least a hash check so a re-added file is recognized. | Teachers lose pasted text on reload and must redo it. | "Text is read in this tab and not kept" line in the Sources panel. | P3 |
| 17 | **Worker-free re-plan** after revoking a cited objective (ROADMAP known limit). | Removes a dead end in the studio. | Notice + "Draft again" needs the worker. | P3 |
| 18 | **Version diff that matches activities across re-drafts** (ROADMAP known limit). | Publish preview shows "what changed since version N". | Diff shown as-is with a "re-drafted plan" label. | P3 |
| 19 | **History as a compact feed**: a `history` endpoint (or view field) with grouped entries ("Decided 3 objectives") and counts, so the "14 decisions recorded" pill doesn't recompute from `timeline`. | History moves from an always-on rail to a drawer. | Frontend groups `timeline`/`activity`. | P3 |
| 20 | **Google Drive / YouTube in browser mode** sources. | Common teacher sources. | Badges ("Local app only", "Soon"). | P3 |
| 21 | **Add source names after the course exists.** Names are fixed at creation; text added later in the tab only reaches the record (as `materialsUsed`) when Silicus reads it. | The Sources panel is always editable, so the Brief shows record names and tab-only text separately, which is honest but clunky. | Two lists in the Brief's Sources card. | P2 |

## Local design loop

`frontend/scripts/mock-worker.mjs` is a dev-only stand-in for `/api/worker` (canned, obviously fake answers on
127.0.0.1:8787, where `vite dev` proxies `/api`). The real host still validates every reply. It lets the studio's
waiting, plan, publish, Rehearse and student screens be designed without a model or the passcode. Never deploy it.
