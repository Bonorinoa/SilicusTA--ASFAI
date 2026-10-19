VERDICT (task t_d55200b3, verifier, Kanban run 147)

  GUIDED COMMITTEE DEMO ............ ACCEPT, WITH CONDITIONS (section 1)
  UNATTENDED SHARED PROTOTYPE ...... BLOCK (section 2, six numbered findings)

Artifact: product at frozen SHA 20acaea636d79461275f50a3c7a227089c8b612f (HEAD of
  .../committee-2026-10-19/wt-verify, `git status` clean before and after), the proposed docs
  worktree ../wt-docs (9 files modified, 5 new, uncommitted), and the audit files in this folder.
Acceptance criterion: independent falsification of the committee-readiness claims (card body).
Assumption: no product fix has landed. This verdict gates the existing snapshot and docs only.

======================================================================
0. ROUTE, INDEPENDENCE, FENCE  (read this first)
======================================================================

Route, from my own agent log (/Users/bonorinoa/.hermes/profiles/verifier/logs/agent.log), not from the card:
  model=claude-sonnet-5-5  provider=anthropic  platform=cli  session=20261019_122036_dbb60a
  52 API calls in this session, 52 on claude-sonnet-5-5/anthropic, 0 on any other model.
  No "Fallback activated" line occurs in this session. The only fallback lines in the log
  (11:42, session 20261019_114203_054ee2: grok-4.7/xai-oauth HTTP 402 -> inkling:free) belong to the
  earlier preflight and none of its output is used here.
  No free-model output is in this verdict. No delegate_task / sub-agents were used.
  Therefore the primary route did not fail and the card's route-change rules were met.

This is NOT the Grok route in the original card: the owner replaced it at 12:13 (card comment).

Independence caveat (required by the card):
  Sonnet is the same family as the docs and UX producers (Claude Opus via hermes-dispatch -c claude).
  The docs lane and the UX lane are therefore NOT independently gated by family. I compensated by
  re-deriving from source, raw files and my own probes, not from producer prose. Engineering and quality
  producers were Codex (gpt-6.1-sol/openai-codex), and the engine under test is DeepSeek, so for those two
  lanes the family is different. A reader should still weigh the docs and UX conclusions as "a second
  reader", the same wording the 2026-10-17 verification record used for itself.

Orchestrator disclosure handled: comments #138, #140, the "Final Committee Readiness Summary" and the
  "guided PASS / unattended FAIL" matrix were written on a free fallback model. I did not cite any of them
  as evidence. I treated the matrix as a hypothesis. Result: unattended-FAIL is confirmed; guided is
  CONDITIONAL, not an unconditional PASS (see section 1).

Fence kept: no edits to product or docs, no commits/push/deploy, no secrets, no vault use, no owner browser
  data. I ran `npm ci` inside wt-verify/frontend only (gitignored node_modules). Headless Chrome was launched
  by the repo's own smokes with a fresh temp profile. Ports 8797 and 5183 belong to the PM's pending-OAuth
  local host and were never touched. My own processes all exited (ps check: none left; ports 8787/5173 free).
  I made only GET requests (and CORS OPTIONS preflights) to public endpoints. I did NOT call the live
  /api/worker (needs the passcode; vault use is outside my fence).

======================================================================
1. GUIDED COMMITTEE DEMO: ACCEPT WITH CONDITIONS
======================================================================

What a guided demo is, for this verdict: Augusto drives, content is public/fixture, the audience is told what is
mocked and what is not. The trust architecture (teacher confirms, AI proposes, local URN identity, hash-chained
record, last-sealed student view, export/import) is demonstrably real and reproduced. A live-AI claim is not.

Conditions (each is a way the demo would misrepresent the product if ignored):
  C-1  Do not claim the live model works today. The only evidence on live is that /api/worker returned 502
       UPSTREAM_ERROR / upstream 402 (see U-1). Use the imported fixture backup or the mocked studio walk
       and label it "fixture / mocked worker", per pm-integration.md section 7.
  C-2  Do not say "students can use this". The student space is a preview on the teacher's own device (verified
       in source: browser-host record in IndexedDB, #/learn/<id> reads the same device; PublishStep.tsx:35 says so).
  C-3  Do not say "material is never stored" without the qualifier in U-2. Through the shipped UI only
       typed source NAMES (<=200 chars, <=24 lines) are stored. The route accepts more.
  C-4  Do not type "mastery"/"mastered" in a demo content question (it is refused as an assessment: probe A22).
  C-5  Do not present the assessment refusal as complete. Only the listed phrasings are caught server-side
       (probe A21). Show "Tell me I passed" (caught), not a creative variant.
  C-6  Avoid the UX-known rough edges the UX lane named (B2 stale "Your turn: review and publish" line after
       publish; B3 reloading the sources path). I confirmed B2/B4 causes in source (section 5).
  C-7  Say the log is tamper-evident, not tamper-proof (probe D7: a fully recomputed chain is accepted).

======================================================================
2. UNATTENDED SHARED PROTOTYPE: BLOCK
======================================================================

Each finding cites evidence I produced. "Unattended shared" = a link handed to people who will try it with no
operator present (the PM's pending, student-facing, real-AI condition).

U-1  Live AI path is blocked and was not demonstrated to work at this SHA end to end after the 402.
     Evidence: pm-live/direct-worker-probe.json = {status 502, error.code UPSTREAM_ERROR, error.status 402};
     quality-evidence/raw-results.json (my recount: 29 completed, 15 errors, every error WORKER_UNREACHABLE;
     runner exit 2). Independence limit: the 402 is single-sourced (the PM's authenticated probe). I could not
     reproduce it (passcode). The quality run cannot tell 402 from any other outage (it drops upstream status).
     Treat as a real blocker; cause attribution is UNVERIFIED by me.
U-2  Lock violation reproduced: material text persists through POST /api/courses.
     Probe C3 (probe-flow.mjs): a {name,text} material sent on create is found in the view, meta.json, the
     hash-chained course.created event, the export and a built backup (all five true). Control C2: the shipped
     materials/propose path persists nothing (disk, view, export all clean). Source:
     host/handler.mjs:192-196, store.mjs:70-80, record-store.mjs:52-62. Once chained it cannot be removed
     without breaking the chain. The shipped UI only sends names, so a guided demo is not exposed.
U-3  Students cannot reach a published version (no delivery, no student authentication). "Shared" therefore has no
     student half. Source and smoke agree: student asks run inside the teacher's browser.
U-4  Student-safety evidence on the real model is incomplete and the committed runner verdict is FAIL.
     My recount of raw-results.json: assessment 4 refused + 4 errors of 8; injection 1 refused + 7 errors of 8;
     plan 8 answered + 2 errors of 10. Missing replies are not refusals and not proof of unsafe text. Also, the
     server-side net is a regex list (probe A21: "Grade my answer", "Rate my understanding", "Pass or fail me",
     "How'm I doing" are not caught; a model that answers "you passed" is returned as a grounded answer) and
     over-matches (A22). So "AI never grades" is enforced only by the model prompt plus the refusal flag.
U-5  Unbounded synchronous loop reproduced (denial of service of the host/tab).
     probe-hang.mjs dup160: two materials with the same 160-character name -> the suffix/truncate loop in
     host/materials-core.mjs never ends; child killed after 6 s (control with 150-char names finished in 0 ms).
     In the browser host this freezes the tab; in the local Node host it blocks every course.
U-6  Process/pre-pilot conditions remain open: ASU data-classification check, a verifier route with no free
     fallback, and the 17 Oct evening polish commits (13 after b96b102) had no independent record until this one.
     (Docs STATUS section 2 items 9 and 12; I could not check the data-classification record from this repo.)

Smaller items that would also matter unattended (not blockers on their own): valid-JSON `null` body to POST
/api/courses is a 500 INTERNAL (probe E3; fails closed, nothing recorded); no per-field length cap on the title
(E6: 300 KB accepted, body cap is 1 MiB); a published version may include an objective the plan does not cite
(probe B3: publish returned 200 with revision.notInPlan listing it); the Vercel rate limit is per instance
(engineering probe, not re-run).

======================================================================
3. PASS / FAIL / UNVERIFIED BY CRITERION
======================================================================

Legend: G = guided demo, U = unattended shared prototype. "mock" = stub/mocked model; "live" = real provider.
My probes use my own OpenAI-wire stub through the real PlanWorker, handler and stores (not the producers' tests).

 #  Criterion                                                        G            U           Evidence
 1  Named course -> own outcomes -> recorded confirmations ->        PASS (mock)  PASS (mock) probe A1-A15 (41 PASS)
    plan -> publish, order enforced (outline blocked before
    answers; publish blocked before plan confirm; plan only by
    worker; model citing unknown objective refused)
 2  Same path from material (propose from material; only names      PASS (mock)  PASS (mock) probe C1, C2
    logged: name, digest, chars)
 3  Reload / export / import / tamper refusal in a real browser      PASS (mock)  PASS (mock) smoke 339/339, studio 23/23, below
 4  Student in-domain / off-topic / assessment                       PASS (mock;  FAIL        A16-A20 PASS; A21 residual; A22 over-match;
                                                                     listed       (model      live eval 29/44 with 15 outages
                                                                     phrasings)   path open)
 5  Live model path works today                                      FAIL/UNVERIFIED  FAIL    U-1 (single-source 402; not reproduced)
 6  Intent / provenance: clients send intents only                   PASS         PASS        A6, A7 (forged provenance/decidedBy/channel/id/
                                                                                              mt_ alignment never reach the log), A9 host-minted
                                                                                              turnRef. Limit: the transport does not
                                                                                              authenticate the human.
 7  Local IDs only (urn:uuid; no mt_ identity)                       PASS         PASS        A1, A6, A8, A15
 8  Student transcript not persisted                                 PASS         PASS        A23 (disk bytes + export identical after 15
                                                                                              asks), A24; smoke "student chat wrote nothing"
 9  Material transient                                               PASS via UI/  FAIL       C2 PASS, C3 FAIL (U-2)
                                                                     propose
10  Last-sealed semantics (students read latest sealed only;         PASS         PASS        B1, B2, B4-B7
    drafts invisible; sealed record and anchor immutable)
11  Reword + revert seals an identical version                       FAIL (known) FAIL        B9: v3 content-identical to v2; docs gap #3 is
                                                                                              real. (No-change republish is idempotent: E1b)
12  Integrity: tamper refused on read and in library, student ask    PASS         PASS        D1, D1b, D4-D6, D8-D12
    refused on tampered course, import fails closed
13  Integrity limits stated honestly (tail truncation and fully      PASS (docs   PASS (docs  D2, D7 INFO: accepted/undetected without the
    recomputed chain undetectable without a pin)                      state it)    state it)   pinned anchor, as the docs say
14  Export safety (no XSS vector, no prototype pollution)            PASS         PASS        no innerHTML/dangerouslySetInnerHTML/eval in
                                                                                              frontend/src; D9, E5; CSP script-src 'self' live
15  Source vs live asset parity                                      PASS         PASS        section 4
16  Engineering critical findings reproducible                       PASS         PASS        hang, raw persistence, null 500, cite-validity !=
                                                                                              semantics: all four reproduced by me
17  Engineering OAuth-refresh-before-deadline finding                UNVERIFIED   UNVERIFIED  not re-run (offline only, needs the ASFAI client)
18  PM-integration claims vs raw files                               PASS except  --          section 4
                                                                     where noted
19  Docs: current vs historical, mocked vs live, routes, limits,     PASS, 4 nits PASS, 4 nits   section 6 (not a gate)
    no fake completion
20  Cross-profile SOUL/skill pointer mechanism                       UNVERIFIED   --          section 6: targets do not exist yet

======================================================================
4. COMMANDS, EXIT CODES, REPRODUCTION (all un-piped; logs in verifier-evidence/)
======================================================================

Evidence folder: /Users/bonorinoa/Hermes/Reports/silicus-committee-2026-10-19/verifier-evidence/
Scripts: run-all.sh, run-smokes.sh, probe-flow.mjs, probe-flow2.mjs, probe-hang.mjs
Probe sandbox: scratch dirs under the macOS temp dir; wt-verify untouched (git status clean, HEAD 20acaea).

Suites, Node v22.22.3 (the version the recorded verifier runs used; summary: suites-node22-summary.txt):
  (cd confirm-gate && node --test)         rc=0   41 pass, 0 fail
  (cd host && node --test)                 rc=0   298 pass, 0 fail
  node --test api/test/                    rc=0   57 pass, 0 fail
  (cd frontend && npm test)                rc=0   596 tests in 53 files pass
  (cd host && node scripts/e2e-restart.mjs) rc=0  53/53
  node frontend/scripts/browser-mode-smoke.mjs  rc=0  339/339 (real headless Chrome, mocked functions)
  node frontend/scripts/studio-smoke.mjs        rc=0  23/23
Suites also run on Node v24.11.1 (the default PATH of a background shell; summary: suites-node24-summary.txt):
  confirm-gate, host, api, frontend test, restart e2e, `npm ci`, browser-mode build: all rc=0, same counts.
  Note: the two shells resolved different `node`; I report both so neither is silently assumed.
  These reproduce the PM's matrix (41/298/57/596/53/23/339). They are mocked/deterministic, not live.
My probes:
  node probe-flow.mjs   rc=0   COUNTS PASS 41, INFO 8, FAIL 4  (FAIL = A21, A22, B9, C3, listed above)
  node probe-flow2.mjs  rc=0   FAIL E3 (null body -> 500); E1b, E2, E4, E5 PASS
  node probe-hang.mjs control rc=0 in 0 ms; dup160 killed by a 6 s timeout (no exit; non-terminating)
  Probe corrections, disclosed (not flaky reruns): run 1 (probe-flow.run1.out) had two wrong expectations of
  mine: a new plan's status is "draft" not "proposed" (A11), and GET /api/courses/. is normalised to the list
  route, not a 404 (D12). B9 first compared objectiveRefs byte-for-byte and was too strict; the final form
  compares ids, statements and plan activities. A third run changed nothing else. All three outputs are kept.
Dependency audit: (cd frontend && npm audit --json) rc=1, 6 advisories: critical 2 (vitest, tinypool; dev tools),
  moderate 4 (mammoth is a direct RUNTIME dependency for DOCX reading; argparse, sprintf-js, @vitest/mocker).
  Matches engineering.md (critical 2, moderate 4). Exploitability in production is not established.

Source vs live parity (my own build: `VITE_SILICUS_MODE=browser npm run build` in wt-verify/frontend, rc=0):
  index.html: byte-identical to https://silicus-ta.vercel.app/ (1283 bytes).
  All 16 files under dist/assets: byte-identical to the live URLs (16 of 16).
  Live response headers equal vercel.json (CSP, Referrer-Policy, X-Content-Type-Options, Permissions-Policy,
  X-Robots-Tag). GET /api/worker/status: 200 {configured true, zdr true, provider openrouter, passcodeRequired
  true, model deepseek/deepseek-v4-flash-0731}.
  Meaning: the deployed FRONTEND bundle is a byte-for-byte build of 20acaea. STATUS.md says "nothing here proves
  which build is live"; that is now provable for the static bundle (not for the /api functions, whose deployed
  code is not observable from outside). "configured true" is config readiness, not provider headroom.

PM-integration claims against raw files:
  Test matrix: reproduced (above). CORS table: reproduced exactly by me with Origin https://silicus-ta.vercel.app
  against https://constitution.asfai.org/education/... (GET discovery 200 with ACAO *, OPTIONS register/token/
  revoke/api/mcp 204 with no Allow-Origin). Board cleanup: board-cleanup.json is internally consistent (47 requested,
  47 archived, 12 previous, 59 total); I did not read the board itself. Partner repo (97 tests, Node 22 build),
  direct ASFAI MCP calls, GitHub PR #15 closed-unmerged, pending local OAuth: UNVERIFIED by me (not re-run; raw
  logs partner-logs/*.json show exit 0 and are consistent). One nuance the PM report omits: pm-live/student-answers.json
  (11:53) shows the first student question failing but the off-topic question getting the refusal, whereas the later
  pm-live/student-live-fixture.json shows all three failing. The 402 therefore looks intermittent/threshold-like, not a
  hard switch. pm-integration.md says "later student calls failed", which is consistent, just less precise.
  The PM report states the PM's own mocked/real boundaries clearly; I found no overclaim in it.

Quality scorecard (quality.md): my recount of quality-evidence/raw-results.json (44 items) equals summary.json
  and the report's table (plan 8/2err, definition 8/2err, off_topic 8 refused, assessment 4 refused/4 err,
  injection 1 refused/7 err; 0 invalid cite ids; runner exit 2). The report states its own limits correctly:
  errors are missing data, one unblinded rater, completed-only latency understates unreliability,
  citation id validity is not semantic support, fresh objective/plan generation is unverified. I add one:
  p95 latency of completed answers was 33 s and one injection reply took 62 s, against the product's
  stated "usually 2 to 8 seconds" (typicalSeconds answer [2,8]), so even a funded demo should expect slow replies.

======================================================================
5. UX LANE (ux.md), checked against source, not screenshots
======================================================================
I did not re-run the Chrome walk. Source confirms the stated causes: StepStatus.module.css:2-10 `.line` has no
flex-basis, `.work` wraps (Studio.module.css:107) -> B1 plausible, rendering UNVERIFIED by me; useCourse.ts
turnPhrase ends in `return "Your turn: review and publish"` with no published branch -> B2 confirmed from code;
"on the right" copy at ObjectivesStep.tsx:115, Rehearse.tsx:88, Landing.tsx:122 -> B4 confirmed; SourcesPanel
"Named only" rows come from course.materials -> B3 mechanism consistent with C3's finding that materials is written
only at create. B5 (focus after passcode cancel) UNVERIFIED. The report's own scope limits (mocked worker, headless
Chrome, no screen reader) are honest. Same-family caveat applies.

======================================================================
6. DOCUMENTATION (wt-docs): contradictions and unsupported statements
======================================================================
Result: calibrated and mostly right. Every file:line citation I spot-checked resolves to the cited code
(confirm-gate.mjs:19, :312, :1125; handler.mjs:192-196, 266-276; course.mjs:47-50, :796; store.mjs:70-80;
record-store.mjs:52-62; student.mjs:39-52; PublishStep.tsx:35; Landing.tsx:171; Home.tsx:95; PublishCard.tsx:261;
Workbench.tsx:267; ObjectivesStep.tsx:193-195; NewCourseDialog.tsx:19-20; LiveCourse.tsx:249-250). I re-derived and
confirmed gaps 2 (auto-confirm objectives, probe A8), 3 (reword+revert identical version, B9), 8 ("mastery"
over-match, A22), 10 (no test contains "gone when you reload"), 13 (raw material persistence, C3), 14 (citation
meaning unchecked, A21), and "no commits dated 18 or 19 October" (git: 0). The historical/current separation, the
mocked-vs-live labels, and the "source audit, not production attestation" framing are correct and consistent
across README, ROADMAP, STATUS, DEPLOY and the briefing. No fake completion found.

Findings (documentation fixes, none touch product):
  D-1  Factual error. STATUS section 2 item 9 says "The 14 commits after it (5eae600 to 20acaea)".
       `git rev-list --count b96b102..20acaea` = 13 and 5eae600..20acaea inclusive = 11 (5 of those are merges).
  D-2  Durability. The canonical STATUS header cites /Users/bonorinoa/Hermes/Reports/.../pm-integration.md, an
       out-of-repo path, and says it is "not yet committed under docs/verification/". It also says "The parent
       finalizes this status", a process note that will read as stale. Both resolve when the record is committed.
  D-3  Over-conservative statement. STATUS says nothing proves which build is live; section 4 above now proves it
       for the frontend bundle. Update after this verdict is accepted.
  D-4  Stale sibling file. documentation.md section 6 still says production "configured true" as health; the
       producer flagged that the later readback (402/502) governs. It is a report, not a product doc; fix before
       anyone quotes it.
  Also: the new docs exist only in scratch worktree wt-docs, uncommitted (cache/scratch is pruned when idle);
  save them (commit on a branch) before the scratch entry is pruned.

Cross-profile SOUL/skill pointer proposal (cross-profile-handoff-proposed.md, and the 12:03 card comment):
  Mechanism is sound in design (pointers, not status; no role/model/secret rewrite; "STATUS wins"). It is NOT
  ready to apply: the canonical path it would name,
  /Users/bonorinoa/Hermes/Projects/silicus-asfai-handoff/docs/STATUS.md (and AGENTS.md), does not exist
  (`ls`: "No such file or directory" for both; that checkout is at 20acaea with only an untracked .claude/). Applying "read STATUS first" to nine
  SOULs today would point every profile at a missing file. Apply only after the docs are merged to that checkout,
  and verify the pointer resolves. I did not read other profiles' SOULs (fence); specificity of their
  current contents is UNVERIFIED.

======================================================================
7. LOCKS
======================================================================
  Teacher confirms ................. held in code (A2-A14, A7). Transport does not authenticate the human.
  AI never grades .................. held by prompt + refusal flag + regex net only; model output is not screened (A21).
  Student chat not evidence ........ held (A23, A24, smoke). 
  Material transient ............... VIOLATED on POST /courses (C3); held on propose (C2).
  Local URNs ....................... held (A1, A6, A8, A15; mt_ cannot enter via decisions, A7).
  ASFAI separate product ........... held (browser build has an ASFAI stand-in that refuses; NO_ASFAI in browserHost.ts).
  No PAYG Anthropic ................ no live Anthropic key used by me; code supports an Anthropic wire (worker.mjs provider
                                     "anthropic") but the live route is OpenRouter/DeepSeek (status JSON). Config not inspected.
  Stop only own PIDs ............... held.

======================================================================
8. WHAT I DID NOT VERIFY
======================================================================
Live /api/worker behaviour (402 cause), live student behaviour, the Vercel function code actually deployed,
fresh objective/plan quality on the real model, ASFAI MCP direct calls, partner repo tests, the board itself,
OAuth-refresh ordering (engineering finding), UX rendered layout and accessibility, other profiles' SOULs, the ASU
data-classification record. No product fixes were assumed.

Report path: /Users/bonorinoa/Hermes/Reports/silicus-committee-2026-10-19/verifier.md
Verification commands: see section 4 (primary: node verifier-evidence/probe-flow.mjs rc=0; suites rc=0 each).
Model route: claude-sonnet-5-5 / anthropic, session 20261019_122036_dbb60a.
