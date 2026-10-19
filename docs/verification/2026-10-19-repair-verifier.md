# Silicus repair re-verification (verifier, lane 3/3)

VERDICT (task t_82090021, verifier)

  GUIDED COMMITTEE DEMO ............ ACCEPT WITH CONDITIONS (section 1). Same bar as 2026-10-19; two conditions retired, three changed or added.
  UNATTENDED SHARED PROTOTYPE ...... BLOCK (section 1). Two of the six 2026-10-19 findings are closed (U-2 for new writes, U-5).
                                     U-1, U-3, U-4, U-6 remain; this branch cannot repair U-1, U-3 or U-6.
  REPAIR BRANCH, per item .......... R1 PASS, R2 PASS with residuals, R3 PASS, R4 PARTIAL, R5 B1/B2/B4 PASS but B5 focus FAILS in real Chrome,
                                     R6 PARTIAL, R7 not landed (optional). Findings F1 to F6 are in section 7; none is a regression.

Artifact: branch fix/committee-2026-10-19 at 1240a4af5bf66f1211d37f92ea0948871e12aa3c (8 commits over main 6af465b),
  worktree /Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/repair-2026-10-19/wt-fix.
Acceptance criterion: card t_82090021 (items 1 to 4).
No regression: every PASS in my 2026-10-19 probe run is still PASS (section 3).

======================================================================
0. ROUTE, INDEPENDENCE, FENCE
======================================================================
Route, from my own agent log (/Users/bonorinoa/.hermes/profiles/verifier/logs/agent.log):
  model=claude-sonnet-5-5 provider=anthropic platform=cli session=20261019_131942_597447
  61 API calls counted at check time, 0 on any other model, 0 "Fallback"/":free" lines for this session id.
  (The fallback lines that exist in that log belong to the 11:42 preflight session 20261019_114203_054ee2; none of its output is used.)
  Anthropic here is the ASU Claude seat (OAuth). No API key, no PAYG. No delegate_task. No vault. No owner browser data.
Independence: the producer ran deepseek/deepseek-v4.1-flash via openrouter (engineer log, session 20261019_130340_c99df1:
  49 of 49 API calls on that route; not a ':free' model). I am not the producer's family. I read the diff before the engineer's rationale
  and wrote my probes without copying the engineer's tests.
Fence kept: the worktree was never edited, built in or run in. Suites, builds and the mutation check ran on a clean `git archive`
  export of 1240a4a under .../verifier/cache/scratch/repair/tree, and a `git archive main` export under .../main-tree for baselines.
  My probes import host code from the worktree (read-only) and write only under TMPDIR. `git status` of the worktree shows two
  UNTRACKED files, eval/student-helper/results-repair-live.json and scorecard-repair-live.md: they belong to the live-eval lane (t_0432437e).
  I did not open them and use none of their numbers. My headless Chrome used a fresh temp profile and a local static server only.
  All my processes exited (ps check: no node/puppeteer/vite of mine left).

======================================================================
1. VERDICT DETAIL
======================================================================
GUIDED DEMO: ACCEPT WITH CONDITIONS.
  Carried from 2026-10-19 (still true): C-1 do not claim the live model works (not re-verified, section 10); C-2 the student space is a preview on the
  teacher's own device; C-7 the log is tamper-evident, not tamper-proof.
  Retired: C-4 (typing "mastery" in a content question is no longer refused: probe A22 PASS, and my new probe agrees on "What is a mastery goal?" and
  "Explain mastered vs mastery."); C-6 mostly (B1 layout, B2 stale "review and publish" and B4 "on the right" are fixed and checked in real Chrome; B3 remains).
  Changed: C-3 may now say: a course created at this build, by the UI or by the HTTP route, keeps source NAMES only (section 5.2).
           It may not say that nothing you imported or created on an older build contains material text (F2).
           C-5: the assessment net catches about 40 percent of phrasings I wrote cold (F1). Demo only phrasings you have tried. It also refuses some
           legitimate lesson questions ("How did we get from one half to two quarters?").
  New: C-8 do not demonstrate "cancel the passcode, then keep typing by keyboard" and claim focus returns (F3).

UNATTENDED SHARED PROTOTYPE: BLOCK. What still blocks, by 2026-10-19 number (section 8):
  U-1 live AI path (single-sourced 402; I did not re-run it; not repairable in this branch);
  U-3 no student delivery or authentication (design, outside the repair);
  U-4 student-safety evidence on the real model is incomplete and the server net is still a partial regex (F1);
  U-6 process conditions (data-classification check, verifier route without a free fallback, evening commits).
  Closed: U-2 (new writes; F2 is the legacy/import residual) and U-5 (the hang is gone).

======================================================================
2. SUITE MATRIX (item 1): Node v22.22.3, un-piped, exit codes captured
======================================================================
Script: repair-verifier-evidence/run-matrix.sh. Raw record: /Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/repair/runs/summary.txt and *.log.
Tree: `git archive 1240a4a` export; `npm ci` run in that export.

  Command                                         rc   result                        2026-10-19 baseline -> now
  (cd confirm-gate && node --test)                0    41 pass / 0 fail              41  -> 41   (no gate code touched)
  (cd host && node --test)                        0    303 pass / 0 fail             298 -> 303  (+5)
  node --test api/test/                           0    57 pass / 0 fail              57  -> 57   (assertions edited, none added)
  (cd frontend && npm ci)                         0    ok
  (cd frontend && npm test)                       0    603 pass, 56 files            596/53 -> 603/56 (+7 tests, +3 files)
  (cd frontend && npm run build)                  0    tsc + vite ok
  (cd host && node scripts/e2e-restart.mjs)       0    53/53                         53  -> 53
  (cd frontend && node scripts/studio-smoke.mjs)  0    23/23 (real headless Chrome)  23  -> 23
  (cd frontend && node scripts/browser-mode-smoke.mjs) 0  339/339                    339 -> 339
No --test-force-exit. Matches the engineer's claim (41/303/57/603/53/23/339). I did not run Node 24.

Every count change is explained by the diff (test()/it() calls added in `git diff main..HEAD`; none removed):
  host +5      = create-materials.test.mjs +3 (new file) and materials.test.mjs +2.
                 student.test.mjs gained rows INSIDE its two existing table-driven tests (+0 tests, +12 assessment rows, +6 content rows).
  frontend +7  = PasscodeDialog.focus.test.tsx +1, StepStatus.test.tsx +3, layout-copy.test.ts +2, passcode-cancel.test.tsx +1.
  api, materials-flow: only the expected typicalSeconds literals changed.

Failing-first, checked by me (the repaired test files run against main code):
  host on main:     student.test.mjs 2 red (both tables); materials.test.mjs HANGS (killed at 40 s: the U-5 loop);
                    create-materials.test.mjs red at file level (it imports a symbol main lacks, so it proves little alone; my probes cover R2 by behaviour, 5.2).
  frontend on main: 6 red / 8 green across the four new files (B1 CSS, B2 text, B4 x2, B5 notice, B5 jsdom focus).
  Logs: scratch/repair/runs/failing-first-*.log.

======================================================================
3. MY OWN PROBES AGAINST THE REPAIRED TREE
======================================================================
Copies in repair-verifier-evidence/ with SRC pointed at the worktree; originals untouched.
  node probe-flow.mjs        rc=0  COUNTS PASS 44, INFO 8, FAIL 1      (2026-10-19: PASS 41, INFO 8, FAIL 4)
  node probe-flow2.mjs       rc=0  0 FAIL                               (2026-10-19: 1 FAIL, E3)
  node probe-hang.mjs dup160 rc=0  "finished in 1 ms; names: 160:nnnnnn | 160:nn (2)"   (2026-10-19: killed after 6 s)
  node probe-hang.mjs control rc=0 1 ms
Id-by-id comparison of probe-flow.final.out vs probe-flow.repaired.out (53 ids each) and of probe-flow2 (7 each). ONLY these changed:
  A21 FAIL -> PASS    A22 FAIL -> PASS    C3 FAIL -> PASS    E3 FAIL -> PASS.     No PASS became anything else.
  C2 (control: the shipped propose path persists nothing) PASS before and after.
  B9 FAIL unchanged (docs gap 3; out of scope; expected). B3 INFO unchanged (R7 not landed; publish still seals an objective the plan does not cite).
Regressions: none.
Caution on A21: it PASSES for the four phrasings the card named. It is not a breadth test (F1).

======================================================================
4. DIFF REVIEW / SCOPE (item 1)
======================================================================
`git diff main..fix/committee-2026-10-19 --name-only`: 21 files, all under host/, frontend/src/ or api/test/. Nothing under docs/, .hermes/, confirm-gate/,
vercel.json, api/*.mjs, package files, config or CI. Each file maps to R1-R6:
  R1 host/materials-core.mjs (uniqueName), materials.test.mjs
  R2 host/materials-core.mjs (materialNames, cleanName second argument), host/course.mjs:53, create-materials.test.mjs
  R3 host/handler.mjs:191-192 (null/array/scalar guard)
  R4 host/student.mjs (ASSESSMENT_PATTERNS), student.test.mjs
  R5 frontend/src/studio/{StepStatus.module.css,useCourse.ts,Rehearse.tsx,steps/ObjectivesStep.tsx}, landing/Landing.tsx, browser/PasscodeDialog.tsx + 4 test files
  R6 host/worker-config.mjs, host/README.md, api/test/status.test.mjs, host/test/materials-flow.test.mjs
Scope observations (none blocking): (a) cleanName gained an optional second argument (needed for the 200-char create bound; fine).
  (b) R6 also moved the objectives and plan upper bounds, with no measurement behind them (F4).
  (c) R5-B5 chose to suppress the cancelled-passcode notice: a product call the engineer flagged for the owner. I agree it is the owner's call.
No change to student delivery/auth, ASFAI, provider/route config, Vercel config or citation semantics. R7 (optional) was not done.

======================================================================
5. FALSIFICATION (item 2): my own new probes
======================================================================
Scripts and raw output are in repair-verifier-evidence/. r2, r4 and r5 were also run against `main` to show they can go red.
probe-r1-names was not run against main: main hangs on the first 160-char duplicate (the original probe-hang and main's materials.test.mjs show that).

5.1  R1 (U-5 names)   probe-r1-names.mjs   rc=0   PASS 44 / FAIL 0
  Lengths 1, 5, 100, 155, 158, 159, 160, 161, 200, 500, each as 2, 3 and 8 identical names (LIMITS.maxMaterials is 8; the probe tripped it first):
  terminates, all distinct, each <= 160, identical output on a second run, < 500 ms (0 to 1 ms in practice).
  Also: pre-suffixed collisions in every order (["A","A (2)","A"], ["A","A","A (2)"], ...); a 156-char base with a pre-suffixed twin; three names equal after the
  160-char cut; NFC vs NFD spellings of "café" (distinct strings, visually identical; cosmetic); an emoji at the truncation boundary (no lone surrogate produced);
  whitespace-collapse duplicates; blank/control-only names (refused with NAME_REQUIRED, no hang); 1000 identical max-length names through uniqueName directly (143 ms);
  a hostile pre-filled `used` set. No failure. The loop bound (candidates 2..used.size+2) is sound by pigeonhole.

5.2  R2 (U-2 raw text on create)   probe-r2-create.mjs   rc=0   PASS 29 / INFO 4 / FAIL 0      (main: PASS 10 / INFO 5 / FAIL 18, rc=1; the 18 are leaks, a missing cap, and the null 500)
  20 smuggling vectors, each with its own marker, each sent to BOTH stores (disk CourseStore and browser RecordStore). A vector passes only if the marker is in none of:
  HTTP view, meta.json/events files, store snapshot, export, built backup, course list.
  Vectors: text key; ten other keys (body, content, data, raw, value, source, snippet, extract, file, base64); nested objects and arrays; name as array and as object;
  materials as an object, a string, an array of strings, an array of arrays; "__proto__" and "constructor"/"prototype" keys (from JSON.parse, so real own keys); raw text after
  character 200 inside a name; a newline-padded name; 100 materials; a 2 MB text; top-level extras (text, materialText, body, files, sources); unicode names with emoji, CJK and NFD;
  null, number, boolean and wrong-typed entries; numeric text with digest/chars/kind fields.
  20 of 20 clean. The shipped UI shape ({name}) is still kept; names are capped at 24 (main kept 40) and cut to 200 (main kept 500).
  Single choke point: CourseSession.create (host/course.mjs:53) is the only caller of store.initCourse (grep), so both stores and both hosts get the fix.
  Residuals (INFO; characterised, not regressions):
    - names are free text: 24 x 200 = 4,800 characters of prose can ride in "names" (the same bound the shipped UI has; the lock says NAMES);
    - title and description stay unbounded teacher fields: a 50 KB title and a 100 KB description were accepted and persisted (E6, unchanged, out of scope);
    - store.initCourse still stores whatever it is handed (one layer of defence, not two).
  Import/backup path   probe-r2-import.mjs   rc=0:  a course created on main with raw text, exported with main's buildBackup, is ACCEPTED by the repaired tree's
  readBackup; after import the raw text is in the store, the view, the export and a re-built backup (all four true). The fix stops NEW writes. It does not scrub or
  refuse legacy records, and a hash-chained record cannot be scrubbed without breaking its chain, so this is an owner decision (refuse, warn, or accept). See F2.
  R3 (same probe): null, array, number, string, true, {} and owner-only bodies all return 4xx; no 5xx, no throw. (String()-coerced garbage such as an array owner is still
  accepted as before; not part of R3.)

5.3  R4 (assessment net)   probe-r4-assessment.mjs   (the stub model ALWAYS answers grounded and never refuses, so every refusal comes from the server net)
  I wrote both lists before running anything. Pass 1: 15 self-assessment phrasings and 15 legitimate lesson questions.
    CATCH RATE 6/15 = 40%.    FALSE-POSITIVE RATE 3/15 = 20%.    (main: 0/15 caught.)
    Missed: "Would you give me an A for that?", "Do you think I understand fractions now?", "Be honest, am I ready for the test?",
            "On a scale of 1 to 10 how well do I know this?", "Please tell me whether I'm good at this.", "Am I smart enough for this lesson?",
            "What percentage of this do I know?", "Congratulate me, I passed, right?", "Rank my understanding compared to other students."
    Refused though legitimate: "How did we get from one half to two quarters in the lesson?" (/\bdid (i|we) get\b/),
            "Tell me about the Mark Twain example in the lesson." (/\btell (me|us)\b[^.!?]*\b(...mark|level...)\b/),
            "What does our performance task ask us to do?" (/\b(my|our)\b[^.!?]*\b(...progress|performance|level...)\b/).
  Pass 2 (stress set, written after pass 1 and labelled as such): 24 more self-assessment forms, 10 caught (42%); 15 more content questions, 1 refused ("How did we get 3/4 in the example?").
    Missed forms include the bare "Grade me", "Score me", "Assess me", "Rate me", "Evaluate me", "Did I master this?", "Am I doing well?", "Do I deserve an A", and
    "Grade  my   answer" with two spaces (no whitespace normalisation). Leetspeak ("gr4de") is out of scope.
  Met: the four named phrasings are caught, the bare word "mastery" is no longer refused (A22), both lists are tested in tables.
  Only partly met: "and similar self-assessment asks". Enforcement is the model prompt plus this net, and the net is the layer the lock rests on. See F1.

5.4  R5 (UX): the built bundle and real Chrome (not screenshots)
  Bundle (VITE_SILICUS_MODE=browser builds of 1240a4a and of main; scratch/repair/dist-fixed and dist-main):
    fixed StudioApp-DmmvAZej.css has `_line_9f2kq_2{display:flex;flex-basis:100%;flex-wrap:wrap;...}`; main's rule has no flex-basis.
    No "on the right" string in any fixed asset; main has it in index-*.js and StudioApp-*.js (3 places). "Version N is published. Preview it or revise." is in the fixed index.
  Real Chrome, probe-r5-chrome.mjs (harness pieces from studio-smoke.mjs; assertions mine; mock worker; real mouse clicks for the opener). Fixed: 4 runs. Main: 1 run (26 FAIL).
    B1  1440 px: the status line spans its row (1192 of 1192 px, flex-basis 100%) and the proposals tray sits in the right column (left edge 1120 px).
        Main: status line 383 px wide and the tray pushed to left 248 below it. 380 px: no sideways scroll. PASS in 4/4 runs.
        (At 1024 px the tray wraps under the status line on both builds; I treat that as responsive behaviour.)
    B2  after publishing, the status line reads "Version 1 is published. Preview it or revise." and "Your turn: review and publish" appears nowhere on the screen.
        Before publishing the old text is still there, as it should be. Main shows the stale line. PASS 4/4.
    B4  landing, Objectives lede, Rehearse empty state: no "on the right" (they read "...wait under Proposals..." and "...a guardrail probe under Guardrail probes."). PASS 4/4.
    B5-a  one live region after a cancelled passcode: exactly one non-empty status ("Your turn: draft the lesson plan"). Main shows two (plus the "Nothing was sent" notice).
          PASS in every trial. A wrong code still shows its notice by design, so that case has two regions.
    B5-b  focus returns to the invoking control: FAIL, intermittently. Over the 4 runs the first "Not now" cancel put focus on the primary button 2 of 4 times; the repeated trials
          put it there after "Not now" 8 of 16 times and after Escape 2 of 16 times. Otherwise focus is on <body>. Instrumenting HTMLElement.focus and requestAnimationFrame shows the
          restore is scheduled one frame after close, finds no `[data-primary="true"]` because the step still shows its working skeleton until reload() resolves, and makes no
          focus() call at all. When reload() happens to finish inside that frame it works. The engineer's jsdom tests cannot see this timing. On main focus lands on <body> every time.
          See F3.
  The repo's smokes (339/339, 23/23) contain no assertion for B1, B2 or B5 (grep); the "0 sideways scroll" check in them predates the branch.

5.5  R6 (honest latency copy)
  Host status default and the status API: [3,35] / [5,35] / [3,35] (api and host tests; and "Answers usually take 3–35 s" on the real Rehearse screen in Chrome).
  Not changed: frontend/src/components/AiWaiting/model.ts:15-20 DEFAULT_TYPICAL is still {objectives [3,15], plan [5,25], answer [2,8]} and applies whenever the worker status
  carries no typicalSeconds; frontend/README.md:125-126 documents the same three old ranges and AiWaiting.test.tsx pins them. See F4.

======================================================================
6. LOCKS (item 3)
======================================================================
  Student chat not evidence / no new persistence of student text: held. The diff adds no write path; student.mjs only adds regexes. Probe A23/A24 (disk bytes and export
    identical after 15 asks; student text not in the log) PASS; the host suite and the smoke "student chat wrote nothing" still pass.
  Material transient: held for new writes (5.2). Not held for legacy or imported records (F2).
  Local URNs, no mt_ identity: `git diff main..HEAD | grep mt_` is empty; probe A1/A6/A7/A8/A15 PASS.
  Teacher confirms, AI never grades: confirm order untouched (nothing in confirm-gate/ or the course gate changed); probe A2-A14 PASS. "AI never grades" rests on the prompt,
    the refusal flag and the regex net, and the net is the weak layer (F1).
  ASFAI separate, no PAYG, no Anthropic key: nothing in the diff touches them.
  Tamper-evidence tests still meaningful (mutation-check.py on a scratch COPY; a control run shows the one unrelated red, "the browser host's shared modules name no server env
  variable or key", is an artifact of copying host/ out of the repo):
    M1 skip the digest-mismatch check          -> 6 genuine reds (e.g. "the log is hash-chained: tampering with a past event is detected", "a tampered event log is REFUSED at load").
    M4 publish no longer blocked               -> confirm-gate 2 red, host suite 4 red (e.g. "publish is blocked until the plan is confirmed").
    M2 skip the broken-link check, M3 skip the sequence-gap check -> SURVIVE (no genuine red). The digest check still catches those tamper shapes, so these are redundant guards
       rather than holes, but no test pins them. Pre-existing; not from this branch; recorded only.

======================================================================
7. FINDINGS (numbered, evidence-backed). None is a regression. None blocks the guided demo.
======================================================================
F1  R4: breadth is partial and a new false-positive class replaces the old one.
    Evidence: repair-verifier-evidence/probe-r4-assessment.out (pass 1: 40% caught, 20% false positives; pass 2: 42% / 7%); the patterns at host/student.mjs:76-102
    (`did (i|we) get`; `tell (me|us)...mark|level|score`; `(my|our)...progress|performance|level` with an unbounded gap).
    Effect: "AI never grades" still depends on the model for most phrasings; ordinary lesson questions such as "How did we get from ... ?" are refused as an assessment.
    For the engineer lane (I do not fix): anchor the pronoun patterns, normalise whitespace, add grade/score/rate/assess/evaluate-me, "did I master", "am I doing well".
F2  R2: legacy and imported records keep raw text; title and description are unbounded.
    Evidence: probe-r2-import.out; INFO lines of probe-r2-create.out. This is an owner decision (refuse or warn on import; bound the free-text fields). Not a defect of the create fix.
F3  R5-B5: focus return fails intermittently in real Chrome.
    Evidence: probe-r5-chrome.fixed.out and fixed.run1..3.out ("B5-repeat-*-focus" lines with focus() and rAF logs). "Focus returns to the invoking control" holds only when reload()
    finishes inside one animation frame. The engineer's report cites jsdom tests only for it.
F4  R6: the frontend fallback and docs still promise the old ranges; the plan and objectives bounds are not measured.
    Evidence: AiWaiting/model.ts:15-20 and frontend/README.md:125-126. quality-evidence/raw-results.json measures student answers only (its "plan" category is questions about the plan),
    so [5,35] for plans and [3,35] for objectives are guesses. host/README.md now says the upper bound "is the measured p95 of the slowest observed real request"; the slowest
    completed reply in that data was 62 s (injection category), above 35.
F5  Documentation on main still describes U-2, U-5, E3 and A21/A22 as open (docs/STATUS.md and the 2026-10-19 verdict). That is correct for main today. After the branch merges the status
    owner must update it and keep the F2 legacy caveat. I touched no doc.
F6  R7 not landed: B3 (publish seals an objective the plan does not cite) is unchanged. B9 is unchanged. Both were disclosed by the engineer; optional or out of scope.

======================================================================
8. U-1 TO U-6 RECOMPUTED AGAINST THE NEW BRANCH
======================================================================
  U-1 live AI path blocked / unverified .......... OPEN, unchanged. I did not call the live worker (needs the passcode; vault use is outside my fence). Not repairable in this branch.
  U-2 raw material text via POST /courses ........ CLOSED for new writes (20/20 vectors, two stores, export, backup). RESIDUAL: legacy/imported records (F2), free-text title/description.
  U-3 students cannot reach a published version .. OPEN, unchanged (design; the branch touches no delivery code).
  U-4 student-safety evidence incomplete ......... OPEN, narrowed. The net now catches the four named phrasings and stops the "mastery" over-match, but only ~40% of my cold
                                                   phrasings (F1), and I have no real-model result I may use (the live-eval lane's numbers were not used).
  U-5 unbounded loop on duplicate 160-char names . CLOSED (probe-hang dup160 1 ms; 44 further checks; failing-first confirmed on main).
  U-6 process conditions ......................... OPEN, unchanged (data-classification check, verifier route with no free fallback, evening commits). This record is an independent
                                                   check of the repair branch only.
  Smaller items from 2026-10-19: E3 null body CLOSED (4xx). B3 open. E6 (title length) open. The Vercel per-instance rate limit was not re-run.

======================================================================
9. PASS / FAIL / UNVERIFIED BY CRITERION
======================================================================
 #   Criterion                                                      GUIDED                 UNATTENDED          Evidence
 1   Teacher flow, order enforced, confirmations recorded           PASS (mock)            PASS (mock)         probe-flow A1-A15; suites; e2e 53/53
 2   Material path persists names/digests/chars only                PASS                   PASS (new writes)   C2, C3, probe-r2-create 20/20
 3   Legacy / imported records free of material text                n/a                    FAIL                probe-r2-import (F2)
 4   Duplicate long names cannot hang the host or the tab           PASS                   PASS                probe-hang, probe-r1-names 44/44
 5   Bad create bodies are 4xx                                      PASS                   PASS                probe-flow2 E3; R3 cases in probe-r2-create
 6   Student: in-domain, off-topic, listed assessment phrasings     PASS (mock)            FAIL                A16-A22; 40% catch on cold phrasings; model path open
 7   Student: legitimate content not refused as assessment          PASS for "mastery";    FAIL                A22 PASS; "How did we get..." refused (F1)
                                                                    new false positives
 8   Live model works today                                         UNVERIFIED             FAIL/UNVERIFIED     not run (U-1)
 9   Status line, layout, copy (B1, B2, B4)                         PASS                   PASS                real Chrome 4/4 runs; bundle CSS and strings
10   One live region after a cancelled passcode (B5-a)              PASS                   PASS                real Chrome
11   Focus returns after a cancelled passcode (B5-b)                FAIL (intermittent)    FAIL                real Chrome (F3)
12   Latency copy honest                                            PASS via host status   PARTIAL             frontend fallback and README still old (F4)
13   Integrity: tamper refused, chain verifies, import fails closed PASS                   PASS                suites; mutation M1/M4 red; D-probes unchanged
14   Locks (no mt_, no student persistence, teacher-confirm order)  PASS                   PASS                section 6
15   Student delivery and authentication                            n/a (preview)          FAIL (U-3)          unchanged
16   Reword + revert seals an identical version                     FAIL (known, B9)       FAIL                probe B9 unchanged
17   Deployment parity with this branch                             UNVERIFIED             UNVERIFIED          not deployed (by instruction); not checked

======================================================================
10. WHAT I DID NOT VERIFY
======================================================================
Live model behaviour (any provider), the live /api/worker and its 402, the Vercel deployment (none of this branch is deployed; I did not fetch it), fresh objective and plan quality
on a real model, the engineer's log beyond its model route, ASFAI direct calls, OAuth-refresh ordering, a screen reader (focus was measured with document.activeElement and
focus() instrumentation in headless Chrome only), Safari/Firefox, Node 24 for this branch, `npm audit` for this branch, and the live-eval lane's untracked outputs (not opened).
Headless Chrome's IndexedDB timing may differ from a person's browser. F3 is a structural race, so I expect it at some rate on real devices, but I measured only my environment.

======================================================================
11. COMMANDS, EXIT CODES, ARTIFACTS
======================================================================
Evidence dir: /Users/bonorinoa/Hermes/Reports/silicus-committee-2026-10-19/repair-verifier-evidence/
  run-matrix.sh (every step rc=0 in scratch/repair/runs/summary.txt), build-both.sh (rc 0 for both builds)
  probe-flow.mjs rc=0, probe-flow2.mjs rc=0, probe-hang.mjs dup160 rc=0 and control rc=0     (repointed copies; outputs *.repaired.out, probe-hang.*.out)
  probe-r1-names.mjs rc=0 (PASS 44 / FAIL 0)
  probe-r2-create.mjs rc=0 on the repaired tree (PASS 29 / INFO 4 / FAIL 0); rc=1 on main (PASS 10 / INFO 5 / FAIL 18)     -> *.out, *.main-baseline.out
  probe-r2-import.mjs rc=0 (informational output: raw text carried through import)
  probe-r4-assessment.mjs rc=0 (rates are printed, not asserted)     -> *.out, *.main-baseline.out
  probe-r5-chrome.mjs rc=1 on the repaired tree: only the B5-focus checks fail; every B1/B2/B4/live-region check passes in all 4 runs. rc=1 on main with 26 FAIL.
  mutation-check.py rc=0 -> mutation-check.out
Reproduce: `node <probe>.mjs` from that directory (r5: `DIST=<browser-mode dist> LABEL=x node probe-r5-chrome.mjs`; it needs the scratch `tree` for puppeteer-core).
Worktree after my run: HEAD 1240a4af5bf66f1211d37f92ea0948871e12aa3c, branch fix/committee-2026-10-19, no tracked or staged change; two untracked eval files from the live-eval lane.
Verification command of record: `(cd host && node --test)` rc=0, 303 pass, Node v22.22.3; plus the probe commands above.
Model route: claude-sonnet-5-5 / anthropic (ASU Claude seat), session 20261019_131942_597447, 0 fallback or ':free' calls.
