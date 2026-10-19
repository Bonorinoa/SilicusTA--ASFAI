# Silicus TA 3.0: current status

This is the **one authoritative status page**. Other documents link here. They do not restate status.
Dated verification reports, decision memos and plans are historical records. They are not edited.

| | |
|---|---|
| Source audited | `main` at `6b49604` (2026-10-19 14:07 -0700). It holds the repair branch `fix/committee-2026-10-19`, merged locally. The records say it is not pushed and not deployed. The earlier audit judged `20acaea` (2026-10-17 21:25 -0700). |
| Written | 2026-10-19. Updated after the repair round. |
| What this page is | A **source audit** that follows the committed records. The changes since `20acaea` come from the two independent verifier records and the engineer and quality reports. They were not read again line by line in source. |
| What this page is not | A production attestation. The deployed static bundle matched a build of `20acaea` on 19 October (earlier verifier record). Nothing records that the repair is deployed. The deployed `/api` code is not observable from outside. |
| Today's tests (19 Oct, `6b49604`) | **Independent verifier, clean `git archive` export, Node v22.22.3, no `--test-force-exit`, all exit 0** ([`verification/2026-10-19-repair2-verifier.md`](verification/2026-10-19-repair2-verifier.md), §5). confirm-gate 41; host 303; api 57; frontend 603 tests in 56 files; frontend typecheck and build; host restart e2e 53/53; studio smoke 29/29 (real headless Chrome); browser-mode smoke 339/339. These are deterministic, mocked checks. They are not provider reliability and not pedagogical efficacy. This page's author did not run them. Node 24 was not run for this branch. |
| Verifier verdict (19 Oct, final gate on `6b49604`) | Guided committee demo: **ACCEPT WITH CONDITIONS** (C-1 to C-9, §2). Unattended shared prototype: **BLOCK**. Local merge into `main`: YES, with conditions M-1 to M-5. The verifier ran on Claude Sonnet 5.5. The producer ran on DeepSeek v4.1 flash. |
| Why the unattended BLOCK stays | In plain words: nobody but the teacher can reach a published course. The verifier did not check the live model route. The check that stops the AI from grading catches under half of cold phrasings. Older records can still hold raw material text. Three process conditions have no closing record. The repair fixed none of these. |
| Live eval (19 Oct, `6b49604`) | The student-helper eval ran twice on the funded route. It scored **44/44 measured, exit 0** both times ([`verification/2026-10-19-live-eval-and-cost.md`](verification/2026-10-19-live-eval-and-cost.md)). The morning run lost 15 of 44 replies to a provider payment refusal (402). That was an availability fault, not a quality result. The verifier did not run the live model. A pass is not proof of pedagogy. |

> **Correction (19 October, pass 3), updated after the repair.** Earlier versions of this page said course material is
> never stored. That was the **intended invariant (a lock)**, and the course-creation route broke it at `20acaea`.
> At `6b49604` the route keeps material **names only** for new writes. **Legacy and imported records can still carry
> raw text.** The invariant is still violated for those records. See §2 item 13.

Docs map: [`INDEX.md`](INDEX.md). Committee briefing: [`committee/2026-10-19-briefing.md`](committee/2026-10-19-briefing.md).
Delivery history 12 to 19 October: [`committee/2026-10-12-to-19-delivery.md`](committee/2026-10-12-to-19-delivery.md).

---

## 1. What exists in the code at `6b49604`

Rows without a mark were checked against source at `20acaea`. Rows marked *repair* come from the verifier records of 19 October.

| Area | State | Where to look |
|---|---|---|
| Trust core: five checkpoints, a teacher turn behind each one | Built. Changed once after Sprint 2: `b95afc8` (14 Oct) added the `reword` verb. | `confirm-gate/` |
| Node host: event-sourced log with a hash chain, replay, verified load, local archive, device pin | Built | `host/` (`server.mjs`, `course.mjs`, `store.mjs`, `chain.mjs`) |
| Browser host: the same handler in the page, the record in IndexedDB | Built (14 Oct, `ce3a212`) | `frontend/src/browser/`, `host/handler.mjs`, `host/record-store.mjs` |
| Online build on Vercel: static app plus three functions (`/api/worker`, `/api/worker/status`, `/api/fetch`) | Built (14 Oct, `5cc1c6f`, `fcb5149`) | `api/`, `vercel.json`, [`DEPLOY.md`](DEPLOY.md) |
| Material intake: paste, text file, public web page, YouTube (local app only) | Built (14 Oct, Sprint 7) | `host/materials*.mjs` |
| PDF, DOCX and PPTX upload, read in the browser | Built (16 Oct, `7dedb7a`). The roadmap's "Later: PDF extraction" line is out of date. | `frontend/src/materials/extract.ts` |
| Objectives from the teacher's answers, from material, or "Suggest up to 3 more" | Built (`b8e5178`, `1616997`, `035be00`) | `host/proposer.mjs`, `host/course.mjs` |
| Lesson plan drafted by the worker, then confirmed by the teacher | Built | `host/worker.mjs` |
| Publish a version, revise it, reword an objective, compare versions | Built (14 Oct) | `host/README.md` § Revising |
| Student helper: answers only from the latest published version, cites it or refuses (`off_topic`, `assessment`) | Built. A server-side assessment net sits under the model prompt. *Repair:* its patterns were anchored and broadened and a text normaliser was added (`39b5007`). It catches about 45% of cold phrasings (§2 item 8). Cite ids are checked to exist. Their meaning is not (§2 item 14). | `host/student.mjs` |
| Course creation keeps material **names only** (*repair*) | Built (`77ca4a1`, `189bf07`, `592892b`). Creation stores names, digests and sizes. A null, array or scalar body is a 400. Two identical 160-character names now end and stay distinct. | `host/course.mjs`, `host/handler.mjs`, `host/materials-core.mjs` |
| Studio at `#/studio`: Brief, Objectives, Plan, Publish; Rehearse at `#/studio/<id>/rehearse`; student space at `#/learn/<id>` | Built (17 Oct, `b96b102`), then polished the same evening (`5eae600` to `ee9f81d`). *Repair:* the status line owns its row (B1). A published course says "Version N is published. Preview it or revise." (B2). Copy no longer says "on the right" (B4). A cancelled passcode leaves one live region and returns focus to the plan step (B5, `8f5562e`). | `frontend/src/studio/`, `frontend/src/browser/PasscodeDialog.tsx` |
| Wait ranges shown by the UI (*repair*) | answer [2,15] s, objectives [2,10] s, plan [8,30] s. They are hand-widened from a small sample. They are not a promise (§2 item 19). | `host/worker-config.mjs`, `frontend/src/components/AiWaiting/model.ts` |
| Original course page at `#/live`, landing at `#/` | Built | `frontend/src/live/`, `frontend/src/landing/` |

The owner ratified two component README edits made in the repair: `frontend/README.md` and `host/README.md` (the wait-range wording). The card fence said "no docs edits". The engineer read that as the `docs/` tree. The verifier advised ratifying. *Source: the task card for this update. No separate record.*

## 2. Open gaps (rechecked against the verifier records at `6b49604`)

Item numbers do not change. A closed item stays in place and says so, because other pages cite the numbers.

**Verifier conditions for the guided demo (C-1 to C-9).** Say these out loud or keep to them.

- C-1. Do not claim the live model works. The verifier did not run it.
- C-2. The student space is a preview on the teacher's own device.
- C-3. A course created at this build keeps source names only. A legacy or imported record can still hold raw text.
- C-5. The assessment net catches about 45% of cold phrasings. Demo only phrasings you have tried. It also refuses some ordinary questions, such as "check my answer" or "what percentage".
- C-7. The log is tamper-evident, not tamper-proof.
- C-9. Do not type a question in Rehearse, cancel the passcode and claim nothing is lost. The typed question is cleared and focus goes to the page body (item 15).

Retired in the repair rounds: C-4 (the word "mastery" in a content question), C-6 (layout and copy, except B3) and C-8 (focus at the plan step).

1. **Students cannot reach a published version.** The record lives in the teacher's browser (online) or on the
   teacher's computer (local). The student space at `#/learn/<id>` is a preview on the teacher's own device.
   The studio says so (`frontend/src/studio/steps/PublishStep.tsx:35`). The landing shows "Class codes · soon".
   See `design/backend-asks.md` #1 and #2.
2. **Objectives confirm automatically.** When the teacher has decided the last proposal, the gate confirms
   checkpoint 3 (`confirm-gate/confirm-gate.mjs:19`). The teacher cannot add an objective after that. This is
   `design/backend-asks.md` #13 (P1). It is a trust-core change, so it needs a failing test first and the
   owner's decision.
3. **Reword and reword back can still seal an identical version.** The gate's `#dirty` flag is a plain boolean
   (`confirm-gate/confirm-gate.mjs:312`, `:1125`). Any decision sets it. Reverting does not clear it. The code is
   unchanged since the gap was recorded on 14 October. No test was re-run for this audit.
4. **No re-plan without the worker** after revoking an objective the plan cites (`host/README.md`, Known gaps).
5. **A course holds one lesson plan.** There is no course-and-lessons structure (glossary).
6. **YouTube works in the local app only.** yt-dlp does not run on Vercel ([`DEPLOY.md`](DEPLOY.md)).
7. **The log is tamper-evident, not tamper-proof.** The pin on the teacher's device is the only defence
   against a rewrite that is consistent with itself (`host/README.md` § Integrity).
8. **The assessment net is partial. It is not the guarantee for "AI never grades".** *Repair:* `39b5007` anchored and
   broadened the patterns in `host/student.mjs` and added a normaliser. The bare word "mastery" is no longer refused
   (A22 passes). The verifier wrote 71 self-assessment phrasings and 71 lesson questions before reading the new
   patterns. Held-out result at `6b49604`: **about 45% caught (32 of 71)**, **2.8% false positives (2 of 71)**,
   ReDoS clean (slowest pattern 1.2 ms on 800 characters). Main caught 5.6% and `1240a4a` caught 33.8%.
   Plain, polite and indirect English: 30 of 56. Typos, ESL, loanword and other-language forms: 2 of 15. "Nota" is
   missed in all three tries. A zero-width character inside a word, fullwidth letters and homoglyphs also defeat it.
   The two false positives were a "check my work" step question and "What percentage of the pizza is left". A later,
   non-held-out stress set refused 18 of 34 questions aimed at the weak patterns, so 2.8% is a floor for natural
   traffic. The 95% interval on the catch rate is about ±12 points. The engineer's own 100% catch and 0% false positives are a fit
   to lists it could read. They do not reproduce on unseen phrasings. **Do not quote them.** "AI never grades" rests
   on the prompt, the refusal flag and this partial net. The live eval refused all 15 assessment-shaped and injected
   asks it contained (§4), but the model path is not measured on the phrasings the net misses. The check runs after the model call
   (as at `20acaea`; not re-read). *Verifier levers, not done:* add "can you grade", "my score", "nota", "passing answer";
   NFKC and remove zero-width characters; bound the remaining gaps; keep a held-out set no engineer reads.
9. **The evening polish commits have no verification record.** The 17 October record
   (`verification/2026-10-17-studio-redesign.md`) judges `b96b102`. The 13 commits after it (`5eae600` to
   `20acaea`, 5 of them merges) change the studio, the passcode seam, `PlanCard` and `host/student.mjs`. The repository holds no
   verifier verdict or production check for them. Today's parent matrix ran the code at `20acaea`, including these tests (it reports 596 frontend tests passing). A verifier re-ran the suites at `20acaea` on 19 October (see the verifier record) and judged the guided-demo path; it did not review these commits line by line.
   These commits also added the studio's first unit tests: 10 files under `frontend/src/studio/`
   (`5eae600`, `a48b081`, `acbe318`, `736044e`). So the 17 October caveat "no unit tests for the studio" is
   out of date in source. No record has run those tests.
   *Repair:* the verifier re-ran the suites at `6b49604` and drove the studio in real Chrome. It did not review the evening commits line by line.
10. **The "gone when you reload" trust claim has no test.** The 17 October verifier's F1 said its vitest and
    smoke guard was dropped. At `20acaea` the sentence is still on the page (`frontend/src/landing/Landing.tsx:171`,
    `frontend/src/studio/Home.tsx:95`). No test file or smoke script contains it.
11. **Some retired "seal" wording is still visible.** Of the 16 October V3 LOW findings, the tour and the pin
    messages are fixed. Two remain: the PublishCard aria-label "Confirm sealing …"
    (`frontend/src/components/PublishCard/PublishCard.tsx:261`) and the workbench notice "Version N sealed —
    the course package is immutable" (`frontend/src/workbench/Workbench.tsx:267`, reachable by the workbench
    hashes only). The copy owner decides. This sits next to the Edit/Rename drift in `design/glossary.md`.
12. **Three pre-pilot conditions have no closing record in this repository.** The 15 October checkpoint said
    two things must happen before teacher files or real students: asfai-education PR #15 needs a reviewer,
    and the ASU data-classification check must be done. It also said the verifier's model fallback chain
    must change first, because free models are not zero-retention. Three records show verifier runs on a free
    model: `2026-10-15-narrow-round1.md` and `-round2.md` (the same day, before that note) and
    `2026-10-16-tonight-round2-incomplete.md` (the next day, after it). None of the three conditions can be
    checked from this repository. They stay open until the owner records them closed.
    **Upstream state, from the parent's fresh GitHub readback on 19 October (not re-read by this audit):**
    asfai-education issue #14 is OPEN. Clarification PR #15 is **CLOSED, not merged** (`mergedAt: null`,
    last updated 2026-10-15); it is no longer awaiting review. CORS issue #16 is OPEN. Upstream HEAD is
    `dac19d3da211e22c3fd6cb4613add16e652131c9`. No upstream fix for the clarification receipt has shipped.
    The local `patches/` proposal remains unmerged upstream. What replaces PR #15 is an owner decision.
    The operator also reports that upstream `dac19d3` passes `npm ci`, test (97), lint, plugin build and
    plugin smoke (all exit 0), and test (97) plus Next build again on the required Node 22. That is a check
    of the partner repo, not of a fix.
    asfai-education CORS issue #16 means the ASFAI browser path stays off. See §3 ("ASFAI and knowledge sources: Off").
    None of the repair work touched ASFAI.
13. **Invariant violation, narrowed: legacy and imported records keep raw material text.** *Repair:* `77ca4a1` made
    `CourseSession.create` (`host/course.mjs:53`, the one caller of `store.initCourse`) keep names, digests and sizes only.
    The verifier tested 20 smuggling vectors against both stores, the export and the backup. All 20 were clean (probe
    result: 29 pass, 0 fail). So **new writes are fixed (U-2 closed).** Still open:
    - A course created on an older build with raw text can be exported and imported into the repaired tree. The raw text
      then sits in the store, the view, the export and a rebuilt backup. A hash-chained record cannot be scrubbed without
      breaking its chain. Refuse, warn or accept on import is an **owner decision**. (Round-1 finding F2.)
    - Names are free text. Up to 24 names of 200 characters can carry prose.
    - Title and description are unbounded teacher fields. A 50 KB title was accepted (item 16).
    - `store.initCourse` still stores whatever it is handed. The fix is one layer.
    The lock "material text is transient" therefore holds for new writes and is **violated for legacy and imported records**.
14. **The student helper's citations are not checked for meaning.** The helper model sees the published
    package only (`host/student.mjs:39-52`: objective statements and activity text), not the teacher's
    original material, which is not retained. The host validates that each cite id exists in the published
    version. Nothing checks that the cited item actually supports the answer, or that the package itself is
    faithful to the source. So an answer is "package-cited", not "source-grounded", and neither the model
    nor the citations validate semantic support. The parent reports this as an unresolved risk.
15. **Rehearse: a cancelled passcode drops the typed question and loses focus.** The box is cleared on submit
    (`frontend/src/studio/Rehearse.tsx:107,111`), "Ask" is then disabled, and focus goes to the page body (0 of 8 returns).
    Same on `main` before the repair, so it is not a regression. It sits outside the plan-step fix. Whether it is in
    this repair is the owner's call (verifier G4, condition M-5).
16. **Smaller items, unchanged.** B3: publish can seal an objective that the plan does not cite. B9 is item 3.
    E6: title and description length are unbounded. The Vercel per-instance rate limit was not re-run.
17. **The live AI path is not verified by the verifier (U-1).** The verifier did not call the live worker. It needs the passcode,
    which is outside its fence. The live eval of 19 October (§4) is the only live evidence. The verifier used none of its numbers.
    Deployment parity with this branch is unverified: it is not deployed.
18. **Two tamper checks have no test.** The tests do not pin M2 and M3 of the tamper mutations (skip the
    broken-link check, skip the sequence-gap check). The digest check still catches those shapes. Pre-existing.
19. **Wait ranges are hand-widened, not measured.** The sample is 44 student calls, 3 plan runs, 3 objective runs and one fixture.
    The plan lower bound (8 s) is below every observed plan run (minimum 11.3 s). The objectives upper bound (10 s)
    is below one observed suggest run (14.8 s). The answer upper bound (15 s) is above the observed maximum (12.2 s). Passing a bound only
    changes what the UI says. One stale example comment remains in `frontend/src/components/AiWaiting/model.ts:44`.
    Design notes `design/waiting-experience.md` and `design/backend-asks.md` still carry the old figures. They are dated
    records and stay unedited.

**Closed in the repair round (19 Oct, verifier records, `6b49604`).**

- U-2 for new writes (item 13 holds the residual). U-5: the duplicate-name hang (0 ms on the old 160-character case).
- E3: a null, array or scalar body to `POST /api/courses` is a 4xx.
- A21 and A22: the four named phrasings are caught and "mastery" is no longer refused. Breadth stays open (item 8).
- B1, B2, B4 and B5 (one live region, focus returns at the plan step: 40 of 40 in real Chrome, 0 of 40 on the old `main`).
- Latency copy in the UI and the shipped bundle. `docs/DEPLOY.md` now matches.
- Open and unchanged from the earlier verdict: U-1, U-3 (item 1), U-4 (item 8), U-6 (item 12).

## 3. How to run it, and where each run differs

### Two hosts, one API

The same `host/handler.mjs` and `host/course.mjs` serve both builds. Only the injected parts differ. The full
table is in `host/README.md` § One API, two hosts.

| | Local app (Node host) | Online app (browser host) |
|---|---|---|
| Who holds the record | `host/server.mjs` on `127.0.0.1:8787`, files under `~/.silicus/host` | The teacher's browser (IndexedDB). No course-record persistence on Vercel; source text and questions still transit Vercel and the model provider, and provider and platform terms still apply. |
| Who mints the teacher turn | The Node process | Code in the teacher's own browser |
| Model calls | The host's own worker client (`SILICUS_WORKER_*`) | `/api/worker` on Vercel, which holds the key and needs the demo passcode |
| Links | Fetched by the host behind the SSRF guard. YouTube via yt-dlp. | `/api/fetch` (same guard). YouTube is refused. |
| ASFAI and knowledge sources | Available (OAuth) | Off |
| Backup | Local archive folder | Export / Import file |

**The authority is different.** In the local app, the trust boundary is a separate process: a client can only
send intents. In the online app, the host runs in the same browser as the UI. The gate rules and the log rules
are the same code, and parity is a test (`frontend/src/browser/browserHost.test.ts`). But anyone who controls
that browser controls that record. The online build is a prototype for one teacher on one device. It is not a
multi-user server.

**Local Node is not Vercel.** The local app is one long-lived process. Vercel functions are stateless and can
cold-start. They have a 120 s limit (`vercel.json`) and a 115 s upstream deadline (`api/_lib/worker.mjs`). Their
rate limit is per instance and best effort (`DEPLOY.md` § Honest limits).

### Commands

These commands are in the repository. Their results for 19 October at `6b49604` are in the header table. The
older recorded results are historical. They appear in §4 with the sha they judged.

**Run every line from the repository root.** Each `cd` sits inside a subshell `( … )`, so the working
directory never moves and the lines can be pasted in any order.

```sh
# --- from the repository root ---

# Trust core, zero dependencies (docs say Node >= 18, developed on 22)
(cd confirm-gate && node --test)

# Vercel functions (no secrets; tests use stand-ins)
node --test api/test/

# Node host
(cd host && node --test)                         # no --test-force-exit: it would hide a hang
(cd host && node scripts/e2e-restart.mjs)

# Frontend (needs `npm ci` in frontend/ first)
(cd frontend && npm test && npm run build)
node frontend/scripts/browser-mode-smoke.mjs     # browser build + vercel.json headers + mock functions, real Chrome
node frontend/scripts/studio-smoke.mjs           # #/studio end to end, browser host + mock worker, no network
node frontend/scripts/live-host-smoke.mjs        # host mode; needs ports 8787 and 5173 free
node frontend/scripts/narrow-shell.mjs           # 320-480 px

# Run locally (long-running: one terminal each, still started from the repository root)
(cd host && npm start)                           # worker OFF: every AI step says "not configured"
(cd host && npm run start:worker)                # worker ON from host/.env.worker (gitignored)
(cd frontend && npm run dev)                     # http://localhost:5173, proxies /api to 127.0.0.1:8787
```

**Node versions.** The docs say Node >= 18, developed on 22. The recorded verifier runs used v22.22.3
(`verification/2026-10-16-final-sprint.md`, `2026-10-17-weekend-share.md`). On 19 October the committee runner
used Node 22 and this documentation specialist's shell has Node 24; label any result with its Node version.
The verifier's matrix at `6b49604` used Node v22.22.3, un-piped, with no `--test-force-exit`. Node 24 was not run for it.
Node 22 does not expand a directory
argument to `--test`. It resolves the directory as a module. Three consequences:

- `node --test api/test/` works on Node 22 only because `api/test/index.js` exists to catch that resolution
  and load every `*.test.mjs` beside it (the file's own header says so).
- `confirm-gate/test/` has no `index.js`. So `node --test confirm-gate/test/` is **not** a valid form on
  Node 22. The committee runner saw it exit 1 with `MODULE_NOT_FOUND` on v22.22.3 on 19 October. Use
  `(cd confirm-gate && node --test)`.
- A bare `node --test` at the repository root also fails. It picks up the frontend's vitest files
  (`verification/2026-10-15-narrow-round1.md`, note on C1).

Notes:
- The commands that need Chrome use `puppeteer-core` and a local Chrome.
- `eval/student-helper/run.mjs` calls a **real model** (it needs a worker credential), so it is a paid run,
  not a deterministic check.
- The `npm run start:worker` launcher forwards only `SILICUS_WORKER_*` and the two key names from the file
  it reads (`host/README.md`).
- The 19 October live evals ran `node eval/student-helper/run.mjs` twice at `6b49604`. Each run cost about $0.01 (§4).

## 4. Recent recorded evidence (current for `6b49604`; the rest historical)

| Date | Sha judged | Record | What it says |
|---|---|---|---|
| 2026-10-19 | `6b49604` | [`verification/2026-10-19-repair2-verifier.md`](verification/2026-10-19-repair2-verifier.md) | **Current.** Final gate. Guided demo ACCEPT WITH CONDITIONS. Unattended BLOCK. Matrix 41/303/57/603/53, studio smoke 29, browser-mode 339. Net: 45% held-out catch, 2.8% false positives. Focus 40/40 at the plan step. |
| 2026-10-19 | `6b49604` | [`verification/2026-10-19-live-eval-and-cost.md`](verification/2026-10-19-live-eval-and-cost.md) | **Current.** Two live evals, 44/44 each. Cost and wait-time measurements. The "number line" refusal. |
| 2026-10-19 | `1240a4a` | [`verification/2026-10-19-repair-verifier.md`](verification/2026-10-19-repair-verifier.md) | Historical. Round 1 of the repair. Superseded by round 2 for F1, F3 and F4. Still the source for F2 (legacy records). |
| 2026-10-19 | `20acaea` | `verification/2026-10-19-pm-integration.md`, `2026-10-19-committee-verifier.md` | Historical. The audit baseline. Its open findings U-2, U-5, E3 and A21/A22 were fixed or narrowed by the repair. |
| 2026-10-17 | `b96b102` | `verification/2026-10-17-studio-redesign.md` | Verifier ACCEPT, with the caveat that it ran on the producer's own model family. PM runs: frontend 533, host 296, confirm-gate 41, browser-mode 339/339, studio smoke 22/22 ×3, api 57. Production Phase A 15/15. Phase B (real model, ZDR on) PASS. |
| 2026-10-16 | `9bbbc0e` (prod `3ed0d10`) | `verification/2026-10-16-checkpoint.md` | Verifier NO BLOCK. confirm-gate 41, host 296, frontend 528. |
| 2026-10-16 | `e03cf14` | `verification/2026-10-17-weekend-share.md` (V3) | NO BLOCK. Student-helper eval D2 PASS at `bb1653d`, 44/44 measured. |

These counts belong to the sha in the same row. Counts for `20acaea` and older shas are not claims about `6b49604`.
The 21 dated records are listed in [`INDEX.md`](INDEX.md). The 16 records of 14 to 17 October each have a verdict, the sha
they judged and what later superseded them.

Design notes with the old wait-range figures (`design/waiting-experience.md`, `design/backend-asks.md`) are dated. They are not edited. The current ranges are in §1.

## 5. Constraints that do not change (locks)

- ASFAI Education is a separate protocol product. Silicus uses it. It is recommended and never required.
- The teacher confirms. The AI proposes. Clients send intents, never provenance.
- Student chat is **not** learning evidence and leaves no record.
- Material text is transient; the log keeps the name, digest and size. **Holds for new writes at `6b49604`. Still violated
  for legacy and imported records** (§2 item 13). Do not describe it as fully current behaviour.
- **AI never grades.** It rests on the model prompt, the refusal flag and a partial regex net. The net catches about 45% of cold
  phrasings (held-out, §2 item 8). It is not the guarantee. Do not write "100% catch", "0% false positives" or "the net enforces
  AI never grades".
- Objective identity is the local URN, never the wording and never `mt_*`.
- There is no decorative Google sign-in (`decisions/2026-10-16-google-sign-in-and-drive.md`).
- RA and graduate-school use are parked. The first slice is ages 5 to 14.
- Paper numbers and scope decisions belong to Augusto.

## 6. Refreshing this page

1. Change it only from a new frozen sha. Record that sha and its date in the header table.
2. Re-check each line of §1 and §2 against source. Delete a gap only with the commit that closed it.
3. Do not copy test totals in from chat or a worker's own report. Take them from a parent-finalized report and name
   it, as the header does. Add a row to §4 only once a dated record is committed under `docs/verification/`.
4. Mark any run that has not been finalized by the parent as PENDING. Do not fill in numbers for it.
5. The other spine documents keep their pointers here. Do not copy status into them.