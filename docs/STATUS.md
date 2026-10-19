# Silicus TA 3.0: current status

This is the **one authoritative status page**. Other documents link here. They do not restate status.
Dated verification reports, decision memos and plans are historical records. They are not edited.

| | |
|---|---|
| Source audited | `main` at `20acaea` (2026-10-17 21:25 -0700). This is the newest commit in the repository. No commits are dated 18 or 19 October. |
| Written | 2026-10-19, as a documentation audit for the committee review |
| What this page is | A **source audit**: what the code and the committed evidence say. |
| What this page is not | A production attestation. The deployed static frontend bundle was compared on 19 October and is byte-identical to a build of `20acaea` (index.html plus all 16 asset files; verifier record). The deployed `/api` function code is not observable from outside, so it is not attested. |
| Today's tests (19 Oct, `20acaea`) | **Reported by the parent (operator), all exit 0; record is in [`verification/2026-10-19-pm-integration.md`](verification/2026-10-19-pm-integration.md); an independent re-run reproduced the same counts on Node 22 and 24 ([`verification/2026-10-19-committee-verifier.md`](verification/2026-10-19-committee-verifier.md)).** confirm-gate 41; host 298; api 57; frontend 596 tests in 53 files; frontend typecheck and build; host restart e2e 53/53; studio smoke 23/23; browser-mode smoke 339/339. These are deterministic, mocked checks. They are not provider reliability and not pedagogical efficacy. This audit did not run them. Totals are copied from that report, with its attribution, and nothing else. Verifier verdict (19 Oct, Claude Sonnet 5.5, same family as the docs and UX authors): guided committee demo ACCEPT WITH CONDITIONS C-1 to C-7; unattended shared prototype BLOCK (findings U-1 to U-6). Still **PENDING:** a re-run of the paid student-helper eval after provider funding. |
| Live service (19 Oct) | **BLOCKING. No reliable committee demo can be claimed.** Operator readback on 19 October, attributed and not reproduced by this audit: authenticated production `/api/worker` now returns 502 `UPSTREAM_ERROR` (upstream 402, a payment/credit refusal). One earlier plan call succeeded in 6.186 s; three later student calls failed. A fresh 44-question student-helper eval FAILED with upstream outages. Funding the provider and re-running are both required. Green tests do not cover live reliability. |

> **Correction (19 October, pass 3).** Earlier versions of this page, and older documents, state as current fact
> that course material is never stored. That is the **intended invariant (a lock), not current behaviour.** The
> course-creation route persists whatever `materials` objects the client sends. See §2 item 13.

Docs map: [`INDEX.md`](INDEX.md). Committee briefing: [`committee/2026-10-19-briefing.md`](committee/2026-10-19-briefing.md).
Delivery history 12 to 19 October: [`committee/2026-10-12-to-19-delivery.md`](committee/2026-10-12-to-19-delivery.md).

---

## 1. What exists in the code at `20acaea`

Each line below was checked against source, not taken from a roadmap.

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
| Student helper: answers only from the latest published version, cites it or refuses (`off_topic`, `assessment`) | Built. `20acaea` added a server-side assessment pattern check. Cite ids are checked to exist; their meaning is not (§2 item 14). | `host/student.mjs` |
| Studio at `#/studio`: Brief, Objectives, Plan, Publish; Rehearse at `#/studio/<id>/rehearse`; student space at `#/learn/<id>` | Built (17 Oct, `b96b102`), then polished the same evening (`5eae600` to `ee9f81d`) | `frontend/src/studio/` |
| Original course page at `#/live`, landing at `#/` | Built | `frontend/src/live/`, `frontend/src/landing/` |

## 2. Open gaps (checked in source at `20acaea`)

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
8. **New assessment patterns over-match.** `20acaea` refuses any question that contains "mastery",
   "mastered" or "mastering" (`host/student.mjs`, `ASSESSMENT_PATTERNS`). A question such as "What does
   mastery learning mean?" is refused. The pattern check runs after the model call, so the call is still
   made and paid for. The student-helper eval has not been re-run since this commit.
9. **The evening polish commits have no verification record.** The 17 October record
   (`verification/2026-10-17-studio-redesign.md`) judges `b96b102`. The 13 commits after it (`5eae600` to
   `20acaea`, 5 of them merges) change the studio, the passcode seam, `PlanCard` and `host/student.mjs`. The repository holds no
   verifier verdict or production check for them. Today's parent matrix ran the code at `20acaea`, including these tests (it reports 596 frontend tests passing). A verifier re-ran the suites at `20acaea` on 19 October (see the verifier record) and judged the guided-demo path; it did not review these commits line by line.
   These commits also added the studio's first unit tests: 10 files under `frontend/src/studio/`
   (`5eae600`, `a48b081`, `acbe318`, `736044e`). So the 17 October caveat "no unit tests for the studio" is
   out of date in source. No record has run those tests.
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
13. **Invariant violation: course creation persists raw material fields.** The lock says material text is
    transient and the log keeps only name, digest and size. The creation route does not enforce that.
    Source-reviewed at `20acaea` by this audit:
    - `host/handler.mjs:192-196`: `POST /courses` passes `b.materials` through unfiltered (any array of any
      objects, any fields).
    - `host/course.mjs:47-50`: `CourseSession.create` hands it to `store.initCourse`.
    - `host/store.mjs:70-80` (local) and `host/record-store.mjs:52-62` (browser, written through to IndexedDB):
      `initCourse` writes it into `meta.json` **and** into the hash-chained `course.created` event.
    - `host/course.mjs:796`: `view()` returns `meta.materials` to every client. `confirm-gate/confirm-gate.mjs:324`,
      `:1140` keep and emit it. `host/backup.mjs` exports the whole log, so it reaches every backup file.
    The shipped UI sends names only (`frontend/src/studio/NewCourseDialog.tsx:19-20`,
    `frontend/src/live/LiveCourse.tsx:249-250`), so the ordinary studio path stores names. But any client
    that sends `{name, text}` gets the text stored, chained (so it cannot be removed without breaking the
    chain), shown and exported. The parent reproduced a marker string in metadata, the event and the export
    (operator evidence, not re-run here). The `materials/propose` route (`host/handler.mjs:266-276`) does
    reduce to name, chars, digest, kind and truncated. This audit did not change code. Fixing it is a
    trust-core-adjacent change: failing test first, owner decision on what to do with records already written.
14. **The student helper's citations are not checked for meaning.** The helper model sees the published
    package only (`host/student.mjs:39-52`: objective statements and activity text), not the teacher's
    original material, which is not retained. The host validates that each cite id exists in the published
    version. Nothing checks that the cited item actually supports the answer, or that the package itself is
    faithful to the source. So an answer is "package-cited", not "source-grounded", and neither the model
    nor the citations validate semantic support. The parent reports this as an unresolved risk.

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

These commands are in the repository. Their results for 19 October are in the header table and the parent's report. The
most recent recorded results are historical. They appear in §4 with the sha they judged.

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

## 4. Most recent recorded evidence (historical, not today's tests)

| Date | Sha judged | Record | What it says |
|---|---|---|---|
| 2026-10-17 | `b96b102` | `verification/2026-10-17-studio-redesign.md` | Verifier ACCEPT, with the caveat that it ran on the producer's own model family. PM runs: frontend 533, host 296, confirm-gate 41, browser-mode 339/339, studio smoke 22/22 ×3, api 57. Production Phase A 15/15. Phase B (real model, ZDR on) PASS. |
| 2026-10-16 | `9bbbc0e` (prod `3ed0d10`) | `verification/2026-10-16-checkpoint.md` | Verifier NO BLOCK. confirm-gate 41, host 296, frontend 528. |
| 2026-10-16 | `e03cf14` | `verification/2026-10-17-weekend-share.md` (V3) | NO BLOCK. Student-helper eval D2 PASS at `bb1653d`, 44/44 measured. |

These counts belong to the sha in the same row. They are not a claim about `20acaea`.
All 16 dated records are listed in [`INDEX.md`](INDEX.md), each with its verdict, the sha it judged and what
later superseded its findings.

## 5. Constraints that do not change (locks)

- ASFAI Education is a separate protocol product. Silicus uses it. It is recommended and never required.
- The teacher confirms. The AI proposes. Clients send intents, never provenance.
- Student chat is **not** learning evidence and leaves no record.
- Material text is transient; the log keeps the name, digest and size. **This is the intended invariant. It is
  violated today** on the course-creation route (§2 item 13). Do not describe it as current behaviour.
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
