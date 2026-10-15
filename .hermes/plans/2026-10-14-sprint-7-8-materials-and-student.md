# Sprints 7 + 8: the host reads materials; students use the package

> Decided with the owner 2026-10-14. Silicus owns these features (not ASFAI). Failing test first, commit per task.

**Goal.** A teacher gives Silicus real course material (their own, or a public source such as a
web page or a YouTube video's captions) and Silicus *proposes* objectives from it; the teacher
confirms. After publishing, a student can ask questions answered only from the sealed package.
Prototype checkpoint target: end of October.

## Decisions (settled)

1. **Worker (amended 2026-10-14: Claude Sonnet 5.5 via the native Anthropic wire for now; ZDR below is the OpenRouter option, still built, selectable by `SILICUS_WORKER_PROVIDER`).** Originally: OpenRouter `deepseek/deepseek-v4-flash-0731`, zero-data-retention enforced.
   The request carries `provider: {zdr: true, data_collection: "deny"}`; OpenRouter then routes only to
   ZDR endpoints (20 exist for this model) and fails the call otherwise. A ZDR failure is a refusal
   (502), never a silent fallback to a retaining provider. Config: `SILICUS_WORKER_URL`,
   `SILICUS_WORKER_MODEL`, `SILICUS_WORKER_API_KEY`, `SILICUS_WORKER_ZDR=1`. `/api/worker/status` reports
   `{configured, zdr}` (capability, never a credential).
2. **Material is never saved.** The course record (decisions, objectives, plan) stays on the teacher's
   machine as today. Material *text* lives only in the browser tab's memory and in one request to the
   host and the ZDR worker. The log records, per material: name, sha256 digest and character count,
   so an audit can tell which text produced a proposal without keeping the text. Close the tab and the
   material is gone; the teacher re-adds it to propose again. (A hosted deploy later flips the record
   to browser storage + forced export; that is a Sprint 10 decision.)
3. **Public sources are first-class.** A URL material is fetched by the host: https only, no private,
   loopback or link-local addresses (checked on every redirect hop), size and time capped. YouTube
   captions are an adapter over that fetcher and are best-effort (`NO_TRANSCRIPT` is a normal state).
4. **Outcomes become optional when materials stand in.** On the local path only, the teacher may
   answer the outcomes question with one explicit act, "propose them from my materials", recorded as a
   real teacher turn (`outcomes_from: "materials"`). It authorizes checkpoint 2 together with topic and
   course. It is never objective text. The ASFAI path is unchanged.
5. **Materials-derived proposals are authored by a model, so the ledger says so.** An assistant turn is
   recorded (unlike a derived proposal that merely quotes the teacher). Each proposal names the
   material(s) it came from, and the name must be one the teacher supplied. The teacher still accepts,
   renames, drops or adds. Objective identity stays the local URN.
6. **Material is untrusted input.** It may inform proposals; it can never become a teacher statement,
   provenance or a confirmation. Proposals are validated (count, length, single sentence, control
   characters stripped, deduplicated) before the gate sees them.
7. **Student chat is use, never evidence.** It answers only from the SEALED package (confirmed
   objectives + confirmed plan). Every answer must cite package items; an answer with no valid
   citation is replaced by a fixed "that's not in this course yet, ask your teacher". Nothing about a
   student chat is written to any log. No student identifiers are accepted.
8. **Known limit, stated now.** Because material is not kept, student chat can explain the objectives
   and activities but not teach content beyond them. Letting a teacher explicitly *include notes in the
   package* is the next decision, not this sprint.

## Sprint 7 tasks (host first, then UI)

- T1 Worker: ZDR flag, generic JSON call, `draftObjectives`. Tests: ZDR body, fail-closed, validation.
- T2 `host/materials.mjs`: normalize, public fetch (SSRF-guarded), HTML and caption extraction.
- T3 Intake: `outcomes_from: "materials"` authorizes the local path. ASFAI path tests untouched.
- T4 Course: `proposeObjectivesFromMaterials`, log names + digests only, `view.materialsUsed`.
- T5 Route `POST /materials/propose` (content in, never objective text in) and `/worker/status.zdr`.
- T6 UI: add material (paste, text-like file, URL), explicit "propose from my materials", in-memory
  only, a plain note that nothing is saved.
- T7 Acceptance: e2e and browser runs with a mock worker; a live run against OpenRouter and a real
  public source once credits allow.

## Sprint 8 tasks

- S1 `host/student.mjs`: build the package view from the latest sealed version only.
- S2 Worker `answerStudent`; grounded-or-fallback validation; bounded history; no logging.
- S3 Route `POST /courses/:id/student/ask` (409 until published).
- S4 UI: a student tab that talks to the published package, shows what each answer cites, and says
  chat is not evidence.
- S5 Acceptance in the browser smoke.

## Risks

| Risk | Containment |
|---|---|
| Injection through material | Output validated and bounded; teacher confirms every objective; log has no material. |
| Public fetch used as SSRF | https only, IP checks per hop, caps, loopback-only host. DNS rebinding between check and connect is a documented residual. |
| Teacher uploads student data | ZDR-only routing; material never persisted; privacy classification still the owner's call before real teacher files are used. |
| Student chat hallucinates | Citation required, cites validated against the package, fixed fallback. |
| YouTube captions break | Best-effort adapter, honest error, paste-a-transcript always works. |

## Out of scope

Hosting and auth, ASFAI storage, LMS, mastery records, notes-in-package, PDF extraction (text-layer
PDF is the next adapter), any change to `confirm-gate/`.
