# Silicus TA 3.0 — roadmap

Written 2026-10-14; updated after Sprints 7 and 8. Plain English on purpose: this is the page the whole
team (Augusto, Michael, Stephen) should be able to read and agree or disagree with.

**The bar.** An intuitive experience, a beautiful UI, a robust implementation, and only the
features that are necessary and sufficient. If a feature is not on the path of one real teacher
finishing one real course, it waits.

**The product in one sentence.** A teacher gives Silicus their course material and their
intent; an AI proposes, the teacher confirms every step, and the result is an auditable course
package that students can later use. AI assists, never decides.

---

## 1. The road traveled

| When | What landed | Why it matters |
|---|---|---|
| Sep 25 | A host invented a teacher's intake answers; ASFAI accepted them. | The founding bug. Showed "fields present" is not "a human answered". |
| Oct 5–10 | Issue #14 + PR #15 to asfai-education (signed clarification receipt, bound outline authorization). | Upstream fix. **Still open, awaiting review.** |
| Oct 6 | Research workspace, Marble and ASFAI MCP reports. | Grounding facts. |
| Oct 10 · Phase 0 | `confirm-gate`: the five-checkpoint trust core. UI workbench (DecisionCard, PlanCard, PublishCard, Timeline). | Nothing is published without a recorded teacher turn. Student chat can never be evidence. |
| Oct 10 · Sprint 1 | `host`: real server, event-sourced hash-chained log, replay, verified loading. | State is rebuilt from the record, so restarts are a test, not a promise. |
| Oct 10 · Sprint 2 | Checkpoint 2 gated on the real ASFAI intake round. Verified local archive. Teacher-device pin. | Honest about limits: tamper-evident, not tamper-proof. |
| Oct 10–11 · Sprint 3 | Host is a native ASFAI MCP client (own OAuth, verified live). Red-team closed. | Silicus is the product surface, not a plugin. |
| Oct 12 · Sprint 4 | Onboarding chat. Objectives derived from the teacher's own words. Plan drafted by an optional OSS worker. Client sends no content. | The hardcoded demo is gone. One rule owns how an answer becomes a list. |
| Oct 12–14 · Sprint 5 | ASFAI is recommended, never required. Host asks its own three questions. | "Local skills are first-class" is now true, with proof at process and browser level. |
| Oct 14 · Sprint 6 | Pluggable knowledge sources (ASFAI graph, local ontology). Suggested alignment on the plan. | "Graph ontologies more generally" is now true, not aspirational. |

**State today.** One teacher can run the whole story end to end, with or without ASFAI:
name course → confirm materials → answer three questions → confirm outline → confirm
objectives → worker drafts plan → confirm plan → publish → sealed, pinned, archived.
Verification: core 26, host 147, frontend 91, e2e 30/30, live browser 50/50. Trust core
untouched since Sprint 2.

---

## 2. Where we are now (Oct 14, after Sprints 7 and 8)

Done since the first draft of this page, and verified (core 26, host 187, frontend 95, e2e 40/40,
live browser 50/50):

- **Sprint 7, the host reads material.** Paste text, add a text file, or give a public web page or a
  YouTube link. A worker proposes objectives; the teacher accepts, renames, drops or adds. The
  teacher no longer has to type outcomes: one explicit "propose these from my materials" act stands in.
  Material text is **never stored** (the log keeps name, digest and size; a test scans every byte of
  the data dir). Live-checked: a Wikipedia page, and 18,430 characters of captions from a 3Blue1Brown
  video via yt-dlp.
- **Worker = OpenRouter `deepseek/deepseek-v4-flash-0731`, zero-data-retention enforced** (preset:
  `SILICUS_WORKER_PROVIDER=openrouter`). Fail-closed: a refusal is one attempt, never a retry elsewhere.
  20 ZDR endpoints exist for it. **Waiting on OpenRouter credits.** Claude Sonnet 5.5 over the native
  Anthropic wire is built and selectable (`SILICUS_WORKER_PROVIDER=anthropic`), but it is NOT
  zero-retention: the host refuses to claim otherwise (ZDR on that wire refuses to start, and the UI says
  so). It was tried briefly, then set aside because no valid key reached the host.
- **Non-AI features, built while the worker waits for credits.** A course library (every course, newest
  first, with honest standing: "2 of 5 checkpoints confirmed", "published, version 1", or "needs
  attention: its record does not verify", so a damaged course is flagged, never hidden); open another
  course or start a new one (writes nothing until the teacher names it); and a **student handout**: one
  standalone page built from the sealed version (confirmed objectives and what learners do; no teacher
  notes, no script, everything escaped) to print or share. None of it calls a model.
- **Revising a published course.** The gate already allowed it; what was missing was a way to see and
  trust it. A published course now says "Version 1 is published and unchanged" and, once the record really
  differs, "...; you are drafting version 2" (a reading of the record by the host, not a mode a click or a
  client can set). **Revise this course** opens the tools and writes nothing. A teacher can add or revoke
  objectives (each a teacher turn), draft a new plan, and seal version 2 (`previousVersion` links back;
  version 1 stays byte-identical). Students and the handout read the last *sealed* version until then.
  Revoking an objective the plan cites says what it costs before it is done. Found on the way: the add and
  rename text was not cleaned like an outcome, so a line break could forge an objective line in the drafting
  prompt; it now goes through the same one rule (one line, 2,000 characters, control and bidi blanked).
  **Not built:** rewording a *confirmed* objective in place (the gate's rename is terminal; it needs a gate
  verb, so a failing test first), and a worker-free way to re-plan after revoking a cited objective.
- **Version diff, non-AI and read-only.** With two or more published versions, the course page shows what changed
  between any two (default: the latest against the one before it): objectives added, removed or reworded
  (matched by id only, never by guessing from similar wording), plan activities added, removed or changed (title,
  minutes, what learners and the teacher do, evidence, which objectives and materials they cite), and the title,
  audience and publish note. Each change is labelled in words. It is computed in the browser from the sealed
  records already in the course view (`frontend/src/live/versionDiff.ts`); it calls no model and writes nothing.
  Known limit: a re-drafted plan gets new activity ids, so its activities show as removed and added.
- **Sprint 8, a student can use the package.** Answers come only from the latest *sealed* version, must
  cite it, or fall back to "ask your teacher". It records nothing and accepts no student identity.
  The teacher tries it from the course page ("Try it as a student").

Open gaps, worst first:

0. **First live run through the real host (2026-10-14), free OpenRouter model `nvidia/nemotron-3-super-120b-a12b:free`, ZDR off, public YouTube lecture:** 5 objectives proposed in about 20 s, a 4-activity plan drafted and validated in about 20-35 s, published, and a student question answered grounded with citations; an out-of-scope question and a "tell me I passed" both fell back to "ask your teacher"; the log verifies. It found a real bug: the model echoed the prompt's `[objective:1]` brackets, so every citation failed the exact-id match and every answer fell back (safe but useless). Fixed (one bracket pair is stripped; the id must still match exactly). Free models are not zero-retention: public material only.
1. **(Superseded by item 0 for the OpenRouter wire.) The live worker has not run through the host's own HTTP client.** (The real prompts and validators were run
   against real Claude Sonnet 5.5 on 2026-10-14 through Hermes' credentials: 8 objectives proposed from a
   public lecture's 18,430-character captions in 11 s, a 5-activity plan that passed validation in 15 s, and
   three student questions answered in about 5 s each: one grounded and cited, one out-of-scope falling back to
   "ask your teacher", one "tell me I passed" refused. 43 s end to end. That proves prompt and validator
   behaviour with a real model, not the native HTTP wire.) The host-side Anthropic wire is proven against a
   faithful stand-in. The OpenRouter path is blocked on credits (HTTP 402); the Anthropic key in this shell
   is empty or rejected. First thing to fix once credits land.
2. **A "full course" is not modelled.** The product drafts one lesson plan from up to 8 materials.
   A YouTube playlist or a whole syllabus needs a course-and-lessons structure. Decide before building.
3. **Students cannot reach it.** Student chat works on the teacher's machine only. That is the hosting
   decision, below.
4. **Packages cannot move.** No import on a second host yet.
5. **One course on screen.** No course list, no way to start a second course in the UI.
6. **UI polish is uneven at the edges** (empty and error states, accessibility, plain-English trust
   panel, mobile). Student chat is functional, not yet beautiful.
7. **Student chat can explain the objectives and activities, not teach content.** Material is not kept,
   so the package has no content. "Include these notes in the package" is a decision, not a build task.
8. **Quality is unmeasured.** No eval of proposed objectives or drafted plans; scorecards A and B unrun.
9. **Red-team of Sprints 5 and 6 has not happened.** Two DeepSeek V4 Flash red-team runs were launched and
   both died on the same 402. Worktrees and briefs are ready.
10. **Known limits, stated.** The log is evidence, not proof. The ASFAI storage round-trip is not built.
    DNS rebinding between the address check and the connect is a documented residual in the URL fetcher.

---

## 3. Prototype checkpoint, end of October (proposed, to agree)

**One sentence:** a teacher pastes a link to a public lecture; Silicus proposes objectives; the teacher
confirms; a lesson plan is drafted and confirmed; the package is sealed; a student asks a question and
gets an answer that cites the package. Five minutes, no typing of outcomes.

**Demo script**
1. Name the course. Answer topic and course. Choose "propose these from my materials".
2. Paste a YouTube link (and optionally a second source). Silicus fetches captions, proposes objectives.
3. Teacher accepts two, renames one, drops one, adds one.
4. A plan is drafted by the ZDR worker; the teacher confirms it; suggested alignment shows, labelled.
5. Publish. The seal is pinned on the teacher's device. Archive verifies.
6. "Try it as a student": one grounded answer with its citation, one honest "ask your teacher".
7. Verify the log; show that no material text is on disk.

**Pass criteria (each is checkable)**
- Link to sealed package in under 10 minutes by someone who did not build it.
- Every objective in the package was confirmed by a recorded teacher turn.
- Zero material bytes under the data directory after the run.
- Student answers cite the package or fall back; zero ungrounded answers across 20 test questions.
- Live worker run succeeds with ZDR on; one retry-free failure mode demonstrated (ZDR unavailable -> refusal).
- Red-team findings on Sprints 5 to 8 triaged, with no CRITICAL left open.
- All suites green, `confirm-gate/` diff still zero.

**Work to get there (in order)**
1. Fund the OpenRouter account and run the live worker (blocker for everything above). Meanwhile, the non-AI work below was built.
2. Re-run the red-team on Sprints 5 and 6, then add Sprints 7 and 8 (injection through material and
   through student questions; the URL fetcher).
3. UI pass on the demo path only: the material step, proposals, student chat. Beautiful and calm, not wider.
4. Decide "full course": ship the demo as one lesson from up to 8 sources, and show the course-level
   shape as a roadmap slide rather than building it.
5. Rehearse the script with Augusto, then with one real teacher if one is available.

## 4. Hosting (open, recommendation)

Students need a URL; the host is loopback-only today. Options:

| Option | Data | Cost to build | Fit |
|---|---|---|---|
| A. Local-first (host on the teacher's machine, demo over localhost or a tunnel) | Everything stays on the teacher's device | None | **Best for the end-of-October checkpoint** |
| B. Static site + a tiny serverless proxy that holds the worker key | Record in the browser (IndexedDB) with forced export on close; the gate already runs in the browser | Medium: move the host logic client-side or keep a thin API | Best long-term privacy story |
| C. A hosted server per teacher or org | Server holds records | Highest: auth, backups, privacy review | Only if the product becomes multi-teacher |

Recommendation: A for the checkpoint; design toward B. A student link in B is "a published package JSON
plus a static page", which is also exactly what the Sprint 10 import needs.

## 5. Later (not October)

LMS export or launch; mastery and evidence records; ASFAI storage round-trip; a signed log; notes-in-package;
playlists as a course structure; PDF extraction; multi-teacher; ages beyond 5 to 14 as profiles; RA.

---

## 6. Rules that keep us honest (do not relax)

- AI proposes, the teacher confirms. The client sends intents, never objective text or provenance.
  (Material is input data, and is the one content route; its output is still only proposals.)
- Teacher onboarding is not student chat. Student chat is never evidence and leaves no record.
- Objective identity is the local URN, never the wording and never `mt_*`.
- ASFAI is integrated natively, separate, and recommended, not required.
- `confirm-gate/` changes only with a failing test first. Making a dependency optional is an additive path.
- Retrieved text and material are untrusted and are not recorded. A citation is a suggestion.
- Material never persists. The worker is zero-data-retention or the call is refused.
- Say "evidence" for the log, not "proof".

## 7. Decisions

| Decision | Status |
|---|---|
| Silicus owns materials intake and student chat (not ASFAI) | **Decided** (owner, Oct 14) |
| Worker model and data policy (OpenRouter V4 Flash 0731, ZDR, material never saved) | **Decided.** Claude Sonnet 5.5 stays available by config, not zero-retention. |
| Demo material: the owner's own, or a public YouTube lecture | Open: public YouTube recommended for the demo (no privacy question) |
| Hosting | Open: recommendation in section 4 |
| "Full course" vs one lesson for the checkpoint | Open: recommendation above |
| Notes-in-package for richer student answers | Open: after the checkpoint |
| Real teacher for the usability session | Open |
