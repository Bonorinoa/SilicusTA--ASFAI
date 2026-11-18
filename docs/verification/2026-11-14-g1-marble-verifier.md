# G1V · Independent verifier gate on G1 (Marble source), 14 November 2026

**Verdict: ACCEPT WITH CONDITIONS.** Two conditions (C1, C2) before this branch merges to `main` or is shown
in the December demo. Every acceptance item on the G1 card is met as written. No lock is violated.
Nothing below is a BLOCK, because the card's named test cases pass and each condition has a minimal fix.

- Artifact: branch `feat/marble-source` @ `b3db0c7` (two commits on `97cf7d9`: `f30099d` PM checkpoint, `b3db0c7` finish).
- Card spec: `docs/cards/2026-11-14/G1.md` on `main` (`3d7ab91`).
- Verifier branch: `verify/g1` (this record and the probe, committed on top of `b3db0c7`, not pushed).
- Node: v22.22.3 for every command below (the suite runner refuses to start on any other version).

## 1. Independence

| | Route | Evidence |
|---|---|---|
| Producer (G1, task `t_12f62100`) | `deepseek/deepseek-v4-flash-0731` on `nous` | `~/.hermes/profiles/engineer/logs/agent.log`: four sessions for this task (`9bd41e85` 12:41, `c2a933ae` 12:57, `ae6df2a5` 13:34, `a2044e85` 13:55–14:08). 227 `API call #N` lines, all that one model and provider. `grep -n "Fallback activated" agent.log` prints no line dated 14 Nov. |
| This verifier | `claude-sonnet-5-5` on `anthropic` | `~/.hermes/profiles/verifier/logs/agent.log`, session `488fbf75…`: 54 calls, one model, no fallback line. |

No fallback to a Claude model happened on the producer side. This check is **independent** (different family, different seat).
The first three producer sessions hit the iteration cap. `f30099d` is the PM's checkpoint of that unfinished work, and
`b3db0c7` is the fourth session's finish. Both commits carry Augusto's git identity (`git log --format='%an <%ae>'`).

## 2. Clean export, every STATUS §3 suite

Export: `git archive feat/marble-source | tar -x -C $SCRATCH/g1v` (dotfiles included; `ls -A` shows `.gitignore`,
`.vercelignore`). `(cd frontend && npm ci)` exit 0. Runner: `run-suites.sh` in the probe folder.
Results from the final run (a first run on the wrong Node and a second with a dotfile-less export were discarded; see §9).

| Command (from repo root) | Exit | Count |
|---|---|---|
| `(cd confirm-gate && node --test)` | 0 | 50 tests, 50 pass |
| `node --test api/test/` | 0 | 57 tests, 57 pass |
| `(cd host && node --test)` | 0 | 362 tests, 362 pass |
| `(cd host && node scripts/e2e-restart.mjs)` | 0 | 53/53 acceptance checks |
| `(cd frontend && npm test)` | 0 | 64 files, 682/682 tests |
| `(cd frontend && npm run build)` | 0 | emits `dist/assets/marble-snapshot-B9Cjl5Qs.json`, 2,048.75 kB, gzip 555.41 kB |
| `node frontend/scripts/studio-smoke.mjs` | 0 | 48/48, including "one draft plan shows a Marble suggested alignment" |
| `node frontend/scripts/browser-mode-smoke.mjs` | 0 | 339/339 |

The producer's numbers (362, 53, 682, 48, 339) match mine. `live-host-smoke.mjs` and `narrow-shell.mjs` are not in the card's
list and were not run. The e2e knowledge-source assertion (`e2e-restart.mjs:132-134`) now reads
`asfai-graph,local-ontology,marble`, all enabled, and the log line passes.

## 3. Data

- Re-downloaded both files at `d4440e28d8fa0fb4a59b4accf3dd1cdde6297d63` with `curl` (HTTP 200 each):
  `topics.json` 2,850,439 B sha256 `fd96ce5963e24f11dcfb549fee46d3cb6afae5d545dc30f4d01366a406444f35`;
  `dependencies.json` 880,941 B sha256 `ed38d8a265699d1687a7fa8166c528999e21771d54449a84ea5362dc1d0e7758`.
  Both equal the hashes recorded in the snapshot (`topicsSha256`, `dependenciesSha256`) and in `PIN`
  (`host/scripts/marble-snapshot.mjs:32-33`). **Met.**
- `snap_check.py` re-trims the two raw files with my own field lists and compares to the committed file:
  1,912 topics and 4,002 edges, **identical in order and value**. Every topic has exactly
  `id,type,subject,domain,name,description,evidence,ageRangeStart,ageRangeEnd`; every edge exactly
  `topicId,prerequisiteId,strength,reason`. Dropped upstream fields: `assessmentPrompt`, `centrality`, `standards`.
  No dangling edge ends. Ages span 3 to 15. **Met.**
- Size: 2,048,745 B raw. gzip level 9 gives 553,077 B (the card says 559,740 B at the default level; Vite reports 555.41 kB). Immaterial.
- Nothing else from upstream is vendored: `git diff --name-status main...feat/marble-source` lists 22 files; the only data
  files are `marble-snapshot.json` and `ODbL-ATTRIBUTION.md`. `curriculum-standards.json` (third-party licensed) is not copied. **Met.**
- ODbL notice present: **yes, but incomplete. See C2.**

## 4. Locks

- `confirm-gate/` and `api/`: `git diff --stat main...feat/marble-source -- confirm-gate api | wc -l` prints 0. **Met.**
- No code path turns an `mt_*` into an objective id or confirms anything. `grep -rnE "mt_|marble" host/*.mjs host/lib host/asfai frontend/src`
  outside the new files finds only comments (`course.mjs:557,560`, `proposer.mjs:8-9`), the route handlers, and the label map.
  The new routes are GET only (a POST to the search path returns 404 in my probe), take no course id, and call only `marble.search/topic`.
  `MarbleSource` produces citations (`ref: marble:<id>`), which the gate ignores (`course.mjs:125`) and which are not in the sealed
  version (e2e check at `e2e-restart.mjs:139`). **Met.**
- `MarbleSource.egress` is `null` (`host/sources/marble.mjs:36`). Mutation M4 (return a hostname) makes two tests fail. **Met.**
- No network at query time, Node host: `grep -nE "fetch\(|XMLHttpRequest|WebSocket|node:https?|node:net|dns|import\("` over
  `host/marble/marble-graph.mjs` and `host/sources/marble.mjs` finds nothing. Live run: `probe-node.mjs` starts the real
  `createApp` with a preload (`net-block.mjs`) that refuses and records any non-loopback `fetch`, socket or DNS lookup, then runs the
  status call, 4 topic reads, 4 searches, 8 odd-input requests and 16 `MarbleSource.retrieve` calls. Recorded attempts: `[]`. **Met.**
- Browser host: the snapshot loads lazily with one same-origin `GET /assets/marble-snapshot-<hash>.json` at the first retrieval.
  The request carries no teacher text. I ran a copy of `studio-smoke.mjs` with a request logger in real Chrome behind the
  `vercel.json` CSP (`connect-src 'self'`): the whole walk made 16 requests, all to the app's own origin, one of them that asset
  (`studio-requests.txt`). The card asks for lazy loading, so this follows it. It is a same-origin asset fetch, not a query-time
  call to anyone else. I did not run the browser with the network cut after first load.

## 5. Behaviour

Run through the real Node host (`node-probe.log.txt`), real snapshot, loopback only.

- Demo edges (spec): `mt_WRRv1ABECC` (Smart Versus Not-Smart Devices, 5–8) is a **hard** prerequisite of `mt_AzTrT5ySCx`
  (AI in Daily Life, 5–12). `mt_u6SYiVx7FX` is a **soft** prerequisite of it. `mt_kH1DzOPsXG` has it as a **soft** prerequisite
  (so `mt_kH1DzOPsXG` is a soft dependent of AI in Daily Life). All four ids resolve with the ages above. My own check
  of the raw files (`snap_check.py`) prints the same four edges. **Met.**
- Age filter: a search for "AI in daily life" with ages 3–4 returns 5 hits, every one overlapping 3–4. Ages 5–12 puts AI in Daily Life first.
  Mutation M2 (drop the filter) fails 2 tests. **Met.**
- "maximum likelihood": ages 19–25 on the route returns 0 hits; default ages 3–15 returns Ordering Likelihoods, Likelihood Language, and so on
  (that is the wrong-grain risk the guard exists for). Via `MarbleSource`, a course answer of `ages 19 and up`, `a 19-year-old course`,
  `aged 19`, `ages 19-22`, `ages 16-18` returns 0 citations. **Met as written. See C1 for phrasings it misses.**
- The routes write nothing: I created a course, hashed every file under the data dir (sha256 and size), called status, 4 topic
  reads, 4 searches and 8 malformed or odd requests plus one POST, hashed again. **Identical.** The data dir holds only that course's
  `events.ndjson` and `meta.json`, unchanged. **Met.**

## 6. Do the tests catch a break? (mutations on a scratch copy)

`mut.sh`, run on a `git archive` copy (not under the project root). Target: the four new Marble test files, 27 tests, 27 pass at baseline.

| Mutation | Result |
|---|---|
| M1 drop the early-return grain guard | 27/27 still pass. The line is redundant: the search filter and `inBand` re-check give the same answer. Harmless. |
| M2 drop the age-overlap filter in `search` | 2 fail (`marble-graph`, `marble-routes`) |
| M4 `egress` returns a hostname | 2 fail |
| M5 drop the `inBand` re-check | 27/27 pass (again covered by the other two layers) |
| M6 corrupt the recorded `topicsSha256` | 1 fail (hash test) |
| M7 remove all three age guards together | 4 fail, including the 19-year-old and 12–15 cases |

The 19-year-old behaviour is held by three layers; no single guard is load-bearing, and the tests do fail when the behaviour is really gone (M7).

## 7. Findings (diff `main...feat/marble-source`, 22 files; read in full)

`main..feat/marble-source` (two dots) also shows four deleted files under `docs/cards/2026-11-14/` (`R1.md`, `R1V.md`, `R2.md`,
`create-rubric.sh`). The producer called these branch-base artifacts. I agree: `git diff --name-only 97cf7d9 main` lists exactly those
four plus `docs/NEXT.md`, and none overlaps the branch's 22 files (`comm -12` count 0), so a merge touches none of them.

### HIGH

- **H1 (C1). The grain guard reads the audience with regexes that miss common phrasings, and then fails open.**
  `host/marble/marble-graph.mjs:44,48` accept `19-year-old` and `8-10 year olds`, but not `19 year olds` (a space before `olds`;
  the pattern allows only `year-?old`), `16 to 18 year olds`, or `17 and 18 year olds`. A band of `null` means "no constraint"
  (`host/sources/marble.mjs:48-51`, and by design the test `source-marble.test.mjs:93-97`), so the whole 3–15 graph is searched.
  Evidence (`audience-probe.log.txt`, real snapshot, topic "maximum likelihood", limit 8):

  | Course answer | Band read | Citations |
  |---|---|---|
  | `ages 19 and up`, `a 19-year-old course`, `aged 19` | 19+ | 0 |
  | `19 year olds` | null | **8**, first "Ordering Likelihoods (ages 8–12)" |
  | `19 year old students` | null | **8** |
  | `16 to 18 year olds` | null | **8** |
  | `Econometrics for 2nd-year undergraduates` | null | **8** |

  The studio's own field is free text ("Who it's for", `NewCourseWizard.tsx:224-225`, placeholder "Grade 4 science, ages 9–10"),
  so these phrasings are what a teacher types. This is the exact failure the card says the guard exists to stop (a plausible children's
  node for a university course). The card's named case passes; its general sentence ("course audience entirely outside 3 to 15 ... return nothing") does not hold for these inputs.
  Minimal fix: accept `year olds` with a space, `N to M`, `N and M`, `N–M` before `year olds`, and add each phrasing to
  `marble-graph.test.mjs` and `source-marble.test.mjs`. The policy for an audience that cannot be read at all
  ("University econometrics", "adult learners") is the owner's call: keep fail-open (current, labelled with ages) or fail-closed
  (return nothing when no age is stated). Alternative that also clears the condition: Augusto accepts fail-open in writing and the README says so.

### MEDIUM

- **M1 (C2). Attribution is incomplete against the upstream's own licence terms.** The upstream README at the pinned commit says the
  dataset is multi-licensed: the database is ODbL 1.0, but the authored text (`name`, `description`, `evidence`, dependency `reason`s) is
  **CC BY-SA 4.0** (`LICENSE-CONTENT`, HTTP 200 at the pin), and "any use must credit": *Marble Skill Taxonomy (v1) · © Generative Spark, Inc. (Marble) ·
  https://withmarble.com · licensed under ODbL 1.0 (database) and CC BY-SA 4.0 (content).* The snapshot ships exactly those text fields.
  `host/data/marble/ODbL-ATTRIBUTION.md:5` says contents are under the "Database Contents License", which upstream does not say
  (it says CC BY-SA 4.0 for the text). The notice has no copyright holder, no link, no licence URI or text, and no statement of how
  the trimmed snapshot (a derived database; upstream: share-alike) is offered. The Landing credit (`Landing.tsx:188-189`) repeats the ODbL-only line.
  The card's own spec asked for the ODbL line only, so the producer followed the spec; the spec premise is what is incomplete.
  I am not giving legal advice. Fix for Augusto to decide: use the upstream's credit line verbatim in the attribution file and on the
  Landing page, name both licences, link `LICENSE` and `LICENSE-CONTENT`, and decide how the trimmed snapshot is made available under ODbL.

### LOW

- **L1. `GET /api/knowledge/marble/topics/%` returns 500 `INTERNAL "URI malformed"`** (`host/handler.mjs:170`, `decodeURIComponent`
  throws). Should be a 400. The same pattern already exists at `handler.mjs:232` and `:262`, so it is house behaviour, but G2 will lean on this route.
- **L2. The "`mt_*` is not bound" guard is now weaker by luck.** `browserHost.test.ts:71` asserts the log does not match
  `/forged|attacker|mt_1/`. With Marble on in the browser host, the log legitimately holds `marble:mt_<id>` refs (the in-course test even
  asserts that at `marble-in-course.test.mjs:85`, `log.includes(mc.ref)`). 36 of the 1,912 real Marble ids begin `mt_1` (for example `mt_1z-gJBJFlM`),
  so the guard false-fails if one is ever cited. It passes now only because the scripted "photosynthesis" course cites `mt_6xsEXxKdUX`, `mt_8VA40Tumth` and so on.
  The forged value is `alignment: { publicId: "mt_1" }` (`scripted-course.mjs:76`); assert on that exact string, not a prefix.
  The binding lock itself is still held by a different assertion (the sealed version carries no `marble:mt_`, `e2e-restart.mjs:139`).
- **L3. Landing copy says "about ages 4–15"** (`Landing.tsx:187-188`); the data is 3–15. The credit line is only on the Landing page, not in the studio.
- **L4. Relevance is dumb by design, and shows.** For "AI in daily life" at ages 8–10 the 8 refs are the 4 AI nodes, then "Computers in
  Everyday Life", "Hardware and software", **"Daily Life in a Roman Town"** (a lexical hit on "daily life") and **"Roman Army and Conquest of Britain"** (pulled in as that node's
  dependent by the edge walk, `host/sources/marble.mjs:88-100`). They are labelled with ages and only suggested, so no lock is touched.
  Worth knowing before the demo; a G2 picker will show the same noise.
- **L5. `sources/marble.mjs:48-51` early return is dead for behaviour** (M1/M5 above). Harmless defence in depth; keep.

Positive notes (not findings): hash check refuses a changed upstream (`marble-snapshot.mjs:53-54`); `standards` (third-party licence) is not vendored;
a broken snapshot degrades to no context and `verify` reports `checked:false` instead of "ok"; the e2e assertion was updated honestly; search takes about 20 ms (20 runs, Node 22).

## 8. Conditions

1. **C1.** Fix or explicitly accept the grain-guard misses in H1, with tests for `19 year olds`, `16 to 18 year olds`, `17 and 18 year olds`;
   Augusto decides fail-open vs fail-closed for an unreadable audience.
2. **C2.** Augusto decides the attribution (M1) and the notice and Landing line are updated to match the upstream's licence terms before any public deploy.

L1–L4 are recommended, not conditions.

## 9. What I did not verify, and slips of my own

- I did not re-run `marble-snapshot.mjs` itself (the writer). I did re-download and re-trim independently and the result is byte-equal in content.
- I did not run `live-host-smoke.mjs` or `narrow-shell.mjs` (not in the card's list), nor the browser with the network cut after the first load.
- Legal reading of the licence terms is not mine to give; M1 is a flag for the owner.
- Two of my own runs were discarded: the first background run used Node v24.11.1 (the background shell's PATH differed from my foreground shell) and the next lost dotfiles (`.vercelignore`) when I moved the export; `api/test/config.test.mjs` failed on the missing file. I re-exported with `git archive ... | tar -x -C` directly into the final directory, pinned `PATH` to Node 22 inside the runner, and the numbers above are from that third run only.
- The G1 worktree (`/Users/bonorinoa/Hermes/Projects/silicus-wt/G1`) was not touched. Nothing was pushed.

## 10. Probe

All of it is in `docs/verification/2026-11-14-g1-marble-verifier-probe/`: `run-suites.sh`, `snap_check.py`, `net-block.mjs` + `probe-node.mjs` (+ `node-probe.log.txt`),
`audience-probe.mjs` (+ log), `mut.sh`, `studio-requests.txt`, `suites-summary.txt`, `suites-counts.txt`. Scripts name scratch paths under
`~/.hermes/profiles/verifier/cache/scratch/`; set `ROOT`, `SCRATCH` and `ATTEMPTS` as the headers say.
