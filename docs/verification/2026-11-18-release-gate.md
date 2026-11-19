# REL · Cross-family release gate on `070cf87`, 18 November 2026

## Verdict: **DO NOT SHIP**

The candidate is internally reproducible and every scripted suite is green, but the current live plan path is not reliable enough for the teacher demo. L2 made 37 real plan calls: **23 completed, 10 ended at the 16,000-token ceiling, and 4 never answered**. The UI needed three retries in the Node host and two in the browser host before it obtained a plan. Drafting the lesson plan is the core teacher action, so a scripted-worker green matrix does not close this release risk.

This is a release block, not a lock violation. The integrity locks held in the code, mutations and L2 probes below. Augusto may override the block only by explicitly accepting the live-plan failure mode and the production-path differences in §6; that would change the product verdict to **SHIP WITH CONDITIONS**. I do not make that scope/reliability decision for him.

- **Root:** `/Users/bonorinoa/Hermes/Projects/silicus-wt/REL`, branch `verify/release`, candidate `070cf87008873e3059f942dd105857d2bd610448`.
- **Node:** `/Users/bonorinoa/.local/bin/node`, `v22.22.3`.
- **Verifier route:** agent log for this session, beginning at line 5520: `model=gpt-5.6-sol provider=openai-codex`; no fallback line appears.
- **Fence:** candidate code was read-only. Mutations and clean exports were under `/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/rel-070cf87/`. The only candidate-worktree writes are this record (and the commit that contains it). No push, deploy, PR, paid call, secret read, or email.

## 1. Clean-archive release matrix

I exported the exact candidate with:

```sh
T=/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/rel-070cf87
git archive 070cf87008873e3059f942dd105857d2bd610448 | tar -x -C "$T/tree"
(cd "$T/tree/frontend" && npm ci)
```

Then, from `$T/tree`, each command ran unpiped and its exit status was captured directly.

| Command | Exit | Result |
|---|---:|---:|
| `node -v` | 0 | `v22.22.3` |
| `(cd confirm-gate && node --test)` | 0 | 52 pass, 0 fail |
| `node --test api/test/` | 0 | 59 pass, 0 fail |
| `(cd host && node --test)` | 0 | 483 pass, 0 fail |
| `(cd host && node scripts/e2e-restart.mjs)` | 0 | 58/58 |
| `(cd frontend && npm test)` | 0 | 644 pass in 73 files |
| `(cd frontend && npm run build)` | 0 | built in 1.81 s; Vite's existing >500 kB chunk warning remains |
| `node frontend/scripts/browser-mode-smoke.mjs` | 0 | 316/316 |
| `node frontend/scripts/studio-smoke.mjs` | 0 | 108/108 |
| `node frontend/scripts/live-host-smoke.mjs` | 0 | 89/89 |
| `node frontend/scripts/narrow-shell.mjs` | 0 | 68/68 |

The five script totals are 639 checks. I also searched every generated log for a line beginning `FAIL`: zero matches. These are today's results on the exact SHA, not borrowed suite totals.

## 2. Locks and destructive mutations

Each mutation was made in a fresh archive of `070cf87`; the candidate worktree was never changed. Command:

```sh
env -u PYTHONPATH /Users/bonorinoa/.local/bin/python3 \
  /Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/rel-070cf87/mutate_release.py
```

The mutation runner itself exited 0 after recording each child exit. A non-zero child exit means the guard was killed by a test.

| Lock | Enforcing code | Test/probe that bites | Mutation result |
|---|---|---|---|
| **ASFAI Education is optional and separate** | `host/intake.mjs` initializes `LOCAL_QUESTIONS`; `host/questions-from.mjs` falls back locally; the studio uses the bundled Marble snapshot | `host/test/materials-flow.test.mjs` and `host/test/asfai-flow.test.mjs` | replacing local questions with `[]`: exit 1, 11/16 failed |
| **Browser and Node hosts have different authority** | browser: `frontend/src/browser/browserHost.ts` + IndexedDB; Node: `host/store.mjs` hash-chained disk record; browser copy states that the record is on this device | parity tests prove equivalent operations, not equal authority | adding visible copy “Browser and Node hosts have equal authority”: frontend tests + build exit 0 (644/644). This governance wording has **no executable guard**. The architectures remain different. |
| **Material text is transient for new writes** | `host/course.mjs` stores `materialNames(materials)`; `host/materials-core.mjs` retains name/digest/chars, not source text | `host/test/create-materials.test.mjs` and `materials-flow.test.mjs` | storing `materials` directly: exit 1, 2/3 failed |
| **AI never grades** | `host/student.mjs`: prompt rule, `looksLikeAssessment`, model `refusal/kind`, and `judgesStudent`; fixed refusal precedes answer paths | `assessment-net`, `student`, `student-kinds`, `n4-student-age`, `n5-helper` | disabling input/model-kind nets: exit 1, 10/42 failed; disabling output judging net: exit 1, 2/43 failed |
| **Student chat is not learning evidence** | `host/plan-edit.mjs` evidence whitelist excludes `student-chat`; `/student/ask` calls `askStudent` without a record write | `host/test/n5-plan-shape.test.mjs`; `host/test/student.test.mjs` “a chat is NOT evidence: it writes nothing” | admitting `student-chat`: exit 1, 1/4 failed; writing chat through intake: exit 1, 1/19 failed |
| **The teacher confirms; AI proposes; client provenance is not trusted** | `confirm-gate/confirm-gate.mjs` requires a real teacher turn and server provenance for confirm/reword/publish; `host/course.mjs` constructs proposal authorship server-side and client decisions are whitelisted | confirm-gate fabricated-confirm/publish/reword tests; `host/test/decisions-whitelist.test.mjs` | disabling the teacher-role check: exit 1, 4/52 failed |
| **Objective identity is the local URN** | gate `#idFactory()` mints `urn:uuid:*`; Marble `mt_*` may only survive as accepted `publicId`/`closeMatch` metadata | confirm-gate public-proposal rename/add tests | using `item.publicId` as identity: exit 1, 3/52 failed |
| **No decorative Google sign-in** | landing contains no account UI; `Landing.test.tsx` explicitly rejects sign-in-like controls | `frontend/src/landing/Landing.test.tsx` | adding a visible Google sign-in button: exit 1, 1/644 failed |
| **Access is the one demo passcode; no account/invite path** | `api/_lib/worker.mjs`, `api/_lib/fetch.mjs`, constant-time digest comparison; browser stores one passcode in the tab | `api/test/worker.test.mjs` wrong/missing passcode, timing, brute-force accounting | bypassing the worker passcode check: exit 1, 3/31 failed |
| **RA and graduate-school use are parked** | no route or product component exists | no policy test | adding visible RA/graduate-school mode copy: frontend tests + build exit 0 (644/644). This is an owner scope lock, not an executable invariant. |

### Prompt-only defence

No integrity lock above is defended *only* by a prompt. However, the universal reading of “AI never grades” is not a host guarantee. Known inputs and output judgements are caught by partial regexes and model refusal flags; unseen semantic grading phrasing ultimately depends on the model following the prompt. N5V's adversarial model leaked 3 of 10 new question phrasings and 3 of 10 paired judging sentences; L2's real model passed 62/62. Both can be true: the live model was safe in that corpus, while the deterministic net remains partial.

The N6 authorship label also has a future-path caveat: `proposedBy:"teacher"` is currently supplied only by one server constant; the gate validates the value but does not itself demand a teacher turn for that proposal label. No client path forwards it today.

## 3. Fresh-eyes Chrome walk

I ran the current browser-host course story again with the scripted worker and real headless Chrome:

```sh
D2_SHOTS=$T/fresh-eyes-shots node frontend/scripts/studio-smoke.mjs
# exit 0; 108/108; 40 PNGs (20 states at 1280 and 390)
```

The story covers the wizard, Marble map, Sources, objective decisions, lesson-plan draft, a plan edit with an audit trace, publish, device pin status, Rehearse/Learn, attempt-first and off-topic refusals, reload, and a second adult course. I inspected the wizard, map, Sources, edited-plan, publish/pin, Rehearse, and 390-pixel publish captures. There were no console/page errors and no new functional blocker.

Fresh observation not called out in D2: on the empty Sources step the progress label says **“✓ listed”** while the panel says **“No sources yet.”** The state is functionally valid (zero sources can be confirmed), but the pair reads as contradictory. Roadmap copy polish, not a ship block.

The walk used no paid call and therefore does not answer the live-plan reliability block.

## 4. Open conditions, reduced against the merged candidate

Later cards closed several earlier conditions: KV/KV2's red smoke scripts and missing About links; the missing pin caller; the wizard step-wrap; multiple-file/source reload/status-button defects; K5V's revision-button overflow; N1V's missing Node revision check; and the 192.0.0.0/16 refusal. I did not carry those as open.

### Blocks the demo

1. **L2 live plan reliability.** 23/37 completed; 10 ended at `finish=length` with `reasoning_tokens=15983` of 16,000 despite `reasoning:low`; 4 did not answer. Four responses also cited an objective after dropping its `urn:uuid:` prefix. This is the release block.

### Before 11 December

2. **N1V/N5V/L2 helper limits.** Under-18 vague questions reached `attempt_first` only 1/5 in L2; the helper never said it was an AI; N5V showed six paired grading-net misses under an adversarial worker. Keep “safety net, not guarantee” in demo language.
3. **L2 plan semantics.** `plan.audience` disagreed with course ages in 8/9 completed plans. The host validates structure and citations, not that free-text audience field.
4. **Observability.** L2 found that failed AI calls leave no trace in the course record. Operational logs exist, but a teacher cannot distinguish “never attempted” from a failed attempt after the fact.
5. **Production-path proof.** The current Vercel handlers pass their unit tests, but this SHA was not deployed or exercised against production environment variables, rate limiting, DNS, cold starts, or the live OpenRouter route.
6. **N6 authorship hardening.** Add a test for the old Workbench `DecisionCard` teacher row, pin the “teacher's own” drafting prompt wording, and either enforce teacher provenance for `proposedBy:"teacher"` in the gate or keep the single constant call site explicit.
7. **N5/D2 plan-edit comprehension.** “Cites” checkboxes are numbered without objective statements; plan-sheet Edit/Move/Remove targets are ~24 px at 390. A teacher can operate them, but must scroll to know which objective a number means.
8. **L2 unexercised production limits.** Production 20-per-10-minute rate limit, same-file-twice, Latin-1 decoding, and UI timeout text were not exercised in L2.

### Roadmap / owner polish

9. **KV source offer:** while proposals wait, “Propose objectives from sources” is hidden rather than shown disabled with a reason.
10. **KV guard-test hole:** the ranking thread-length mutant survives because the test reuses an id. A stale “classic view” comment also remains.
11. **K5V/D2 layout:** long course headers wrap; Publish can expose two live regions; UTC version-picker dates can differ from the local published date; Rehearse remains a wide two-column page; print/plan UI still mixes system UI and Public Sans.
12. **N1V/N5V records and edit scope:** typed wizard objectives are now correctly marked `proposedBy:"teacher"`, but older records remain `ai`; some generated skill-map rationale is intentionally read-only; literal-IP refusal Details are less useful than DNS refusal Details.
13. **N6 auto/legacy paths:** an auto-mode objective-offer condition and the retired Workbench card lack mutations that bite; neither is on the current studio happy path.
14. **L2 low edges:** binary junk named `.txt` is accepted as text; a JS-only page can consume a paid call before yielding little; pasted source names may expose the first 160 characters; title/objective clipping is silent.
15. **Fresh-eyes copy:** “✓ listed” beside “No sources yet.”
16. **Governance-only locks:** RA/graduate-school parking and the statement that browser/Node hosts have different authority are not executable tests. The code currently respects both; future UI copy could contradict them without a red suite.

## 5. Vercel path versus the local Node host

### What is shared and should behave the same

- `api/_lib/worker.mjs` imports `taskReasoning`, `taskDeadlineMs`, `maxTokensForTask`, and task-name validation from `host/worker-config.mjs`. The server drops client-supplied reasoning. `answer` is off, `rank` is off, `answer_adult` is low, and other known tasks use the configured default.
- `api/_lib/fetch.mjs` imports the Node host's `fetchPublic` and `MaterialFetchError`, so private-address checks, DNS re-checks, redirect validation, body cap, and text normalization are one implementation.
- API tests include the exact `PlanWorker` body and per-task reasoning behavior; all 59 pass on this SHA.

### Differences that remain

| Area | Vercel/browser path | Local Node host |
|---|---|---|
| Record authority | record lives in browser IndexedDB; Vercel is a stateless worker/fetch proxy | hash-chained record is on the Node host's disk |
| Provider | OpenRouter-compatible upstream only, configured by environment | can use the configured OpenRouter path or native Anthropic mode |
| Deadlines | serverless max duration 120 s; API abort near 115 s; browser worker also applies per-task 20/25/120 s limits | `PlanWorker` applies the shared per-task limits directly; no Vercel cold start/max-duration layer |
| Reasoning | server chooses by task; client values are dropped | same defaults, but local operator configuration can select provider/default reasoning |
| Access/limits | passcode, 512 KiB request cap, 20 requests / 10 min / IP and daily upstream cap; in-memory counters are best-effort per warm instance | no Vercel per-IP/daily limiter in the local host route |
| URL fetch | passcode + online handler deadline; no YouTube helper | same SSRF core, plus the local host can use its local YouTube/`yt-dlp` path |
| Environment | requires passcode, model key, model name and public DNS/egress in Vercel | reads local host configuration; no claim that production env currently matches |
| Failure surface | cold starts, serverless instance churn, provider/network timeout, best-effort limiter state | long-lived local process and disk; different operational failure modes |

**Answer:** production should preserve the same task-reasoning choices, validation, SSRF policy and teacher-record semantics, but it will not behave identically to the local host operationally. The record authority, provider options, rate limits, request cap, YouTube handling, cold starts and timeout layering differ. Code parity is green; deployed-environment parity is unverified.

## 6. Exact owner acceptance required to override the block

If Augusto chooses to deploy this SHA despite the verdict, the acceptance must name all of these:

1. The live plan path completed only 23/37 calls in L2; 14/37 either hit the token ceiling or never answered, and retries were visible in both hosts.
2. The scripted 639-check browser/smoke total does not exercise that live-model failure mode.
3. “AI never grades” remains prompt + refusal flag + partial regex/output nets, not a semantic guarantee; helper attempt-first and AI-identity behavior have measured misses.
4. Production Vercel code is unit-tested but this exact SHA/environment was not deployed or live-tested; operational parity with the Node host is not established.
5. The before-11-December conditions in §4 remain scheduled, and none may be presented as already closed.

Without that explicit acceptance—or a new L2/live-plan result that closes item 1—the release-gate verdict remains **DO NOT SHIP**.

## 7. Reproduction and artifact

- Candidate artifact: `070cf87008873e3059f942dd105857d2bd610448`.
- Verification record: `docs/verification/2026-11-18-release-gate.md` on `verify/release`.
- Clean logs and mutation logs: `/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/rel-070cf87/logs/` and `.../mutations/` (scratch, not committed).
- Private L2 detail read in place only: `/Users/bonorinoa/Hermes/Projects/silicus-private/live-tests/2026-11-18/stress/STRESS.md`; no source text copied here.

The release artifact itself was not modified. This record is the only committed deliverable.