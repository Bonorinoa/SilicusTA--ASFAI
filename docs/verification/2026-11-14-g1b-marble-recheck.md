# G1bV · Re-check of the G1 conditions on `feat/marble-source`, 14 November 2026

**Verdict: ACCEPT WITH CONDITIONS.** C1 (ages), L1, L2 and L3 are fixed and the tests that guard them fail when the
guard is removed. All eight STATUS §3 commands exit 0 on Node v22.22.3 from a clean export. C2 (attribution) is
**mostly** done: the upstream credit line is verbatim in all three places and both licences are named. Two gaps
remain, both about *where* the credit shows and how a reader reaches the licence texts (A1, A2 below). Neither is a lock
violation. Both should be closed before the branch is shown in the December demo or deployed publicly.

- Artifact: branch `feat/marble-source` @ `14a66d8` (one commit on `b3db0c7`).
- Verifier branch: `verify/g1b` (this record and the probe, on top of `14a66d8`, not pushed). Worktree `/Users/bonorinoa/Hermes/Projects/silicus-wt/G1bV`.
- Node v22.22.3 for every command (`node -v` printed it; the runner refuses any other).
- Probe folder: `docs/verification/2026-11-14-g1b-marble-recheck-probe/` (`audience-probe.mjs`, `mut.sh`, `run-suites.sh`, `studio-credit-probe.mjs.txt`, logs).

## 1. Route (independence)

| | Route | Evidence |
|---|---|---|
| Producer (G1b, task `t_a5f079f1`) | `deepseek/deepseek-v4-flash-0731` on `nous` | `~/.hermes/profiles/engineer/logs/agent.log`: two sessions, `d15d5bb7…` (14:34–14:47, 60 `API call #N` lines) and `c48208cd…` (14:49–14:55, 11 lines). All 71 name that one model and provider. 0 lines for either session match `fallback\|claude\|anthropic`. |
| This verifier | `claude-sonnet-5-5` on `anthropic` | `~/.hermes/profiles/verifier/logs/agent.log`, session `dc100a6a…`: 25 calls at the time of writing, one model, 0 fallback lines. |

No Claude fallback on the producer side. The producer is not Claude, so this check is independent by family.
`git log --format='%an <%ae>' -2` shows Augusto's identity on `14a66d8` and `b3db0c7`.
Note: the producer's own handoff says the intermediate RED commits of the earlier attempt were not kept. I rebuilt the red proof in §3.

## 2. Audience probe (item 2)

`node docs/verification/2026-11-14-g1b-marble-recheck-probe/audience-probe.mjs` (real snapshot, topic "maximum likelihood", limit 8). **Exit 0, "ALL EXPECTATIONS MET".** Log: `audience-probe.log.txt`.

| Group | Phrasing | Band read | Citations |
|---|---|---|---|
| old H1 | `ages 19 and up`, `a 19-year-old course`, `aged 19`, `19 year olds`, `19 year old students`, `16 to 18 year olds`, `17 and 18 year olds` | 19+, 19, 19, 19, 19, 16–18, 17–18 | **0** each (G1V recorded 8 citations for `19 year olds`, `19 year old students`, `16 to 18 year olds` and the undergraduates row before the fix) |
| old H1 | `Econometrics for 2nd-year undergraduates` | null | **0** |
| card extras | `University econometrics`, `adult learners`, `""` (empty) | null | **0** each |
| my extras (17) | `16–18 year olds`, `ages 16-18`, `ages 19-22`, `18+`, `college freshmen`, `PhD students`, `graduate students`, `undergrads`, `high school seniors`, `grade 12`, `19yo`, `nineteen year olds`, `ages 30 to 40`, `adults aged 25-34`, whitespace, `ages 99`, `Econometrics 101, ages 19 to 22` | band or null | **0** each |
| ages 9–10 | `ages 9–10`, `Grade 4 science, ages 9–10`, `ages 9-10`, `9 to 10 year olds`, `8-10 year olds` (topic "AI in daily life"); `a 10-year-old course` (topic "smart devices") | 9–10, 9–10, 9–10, 9–10, 8–10, 10 | **8** each; first hit "AI in Daily Life (ages 5–12)" |

Met. A side effect worth knowing (a design consequence, not a finding): `18+` and `19yo` are unreadable, so they now fail closed to 0, which is the intended direction. A children's course whose teacher types only `grade 4` also gets **0** Marble suggestions (not tested in the card; the probe shows `grade 12` → 0). G2a's structured ages remove this.

## 3. Mutation run (item 3)

`bash docs/verification/2026-11-14-g1b-marble-recheck-probe/mut.sh` (scratch copy from `git archive feat/marble-source`; 5 test files: marble-graph, marble-routes, source-marble, marble-in-course, http). Baseline: 37 tests, 37 pass, exit 0. **10 mutants, 0 survived** (the one `SURVIVED` string in `mut.log.txt` is the baseline, which is supposed to pass).

| Mutant | Failing tests |
|---|---|
| C1-a null band → whole 3–15 band (fail-open again) | `an audience the source cannot read fails closed … (C1)` |
| C1-b delete `if (!band) return []` | the same, plus two `source-marble` tests (crash on null) |
| C1-c remove the `N to M year olds` pattern | `audienceAges reads a course answer's age band; nothing else` |
| C1-d remove the `N and M year olds` pattern | the same |
| C1-e remove the `19 year olds` pattern | the same |
| C1-f original G1 behaviour (fail-open + all three widenings out) | 3 tests, including the C1 source test |
| L1-a topic route uses raw `decodeURIComponent` | `the routes are read-only and refuse bad input` |
| L1-b course-id route raw | `a malformed percent-encoded course id or archive ref is a 400 … (L1)` |
| L1-c archive-ref route raw | the same test |
| L1-d `decodeSegment` rethrows a plain Error | both of the above |

Note the course-id and archive-ref routes share one test (`http.test.mjs`), but each mutant fails it on its own, so each route is covered.
Red provenance: I copied the four new test files onto a `b3db0c7` (pre-fix) tree. `red-provenance.log.txt`: exit 1, 19 tests, 14 pass, 5 fail (`audienceAges …`, `a query for a course with no overlaps …`, `an audience the source cannot read fails closed … (C1)`, plus the two files `http.test.mjs` and `marble-routes.test.mjs` failing as files). The tests do detect the old behaviour. What I cannot show is the *order* of authoring, since the producer committed once.

## 4. Attribution against upstream at the pin (item 4)

Not legal advice. This is what upstream asks, and whether the branch does it. Upstream files fetched at `d4440e28d8fa0fb4a59b4accf3dd1cdde6297d63` by HTTP 200 (sha256 in `README.md 8097468c…`, `LICENSE 77d2692c…`, `LICENSE-CONTENT cde7883b…`). `CITATION.cff` and `PROVENANCE.md` also exist at the pin; there is **no `NOTICE` file** (404).

What upstream asks:

1. README §Attribution: "Any use must credit: *Marble Skill Taxonomy (v1) · © Generative Spark, Inc. (Marble) · https://withmarble.com · licensed under ODbL 1.0 (database) and CC BY-SA 4.0 (content).*" Plus the upstream notices in `PROVENANCE.md` "for any curriculum standards you use".
2. README §License: the database is ODbL 1.0 (attribution, share-alike for derivative *databases*); Marble-authored text (`name`, `description`, `evidence`, dependency `reason`s) is CC BY-SA 4.0; `curriculum-standards.json` is **not** Marble's to relicense.
3. `LICENSE` (ODbL) 4.2: publicly conveying a Derivative Database requires (b) "a copy of this License … or its URI with the Database or Derivative Database, including both in the Database or Derivative Database and in any relevant documentation", (c) keep notices intact, (d) if a file cannot carry the notice, put it "in a location … where users would be likely to look". 4.3: publicly using a Produced Work needs a notice "reasonably calculated to make any Person that … views, accesses, interacts with … the Produced Work aware that Content was obtained from the Database … and that it is available under this License" (example: `Contains information from DATABASE NAME, which is made available here under the Open Database License (ODbL)`, with hyperlinks to the database and to the licence text). 4.6: offer recipients the Derivative Database (or an alteration file).
4. `LICENSE-CONTENT` (CC BY-SA 4.0) 3(a)(1): retain creator identification and copyright notice; "a URI or hyperlink to the Licensed Material"; "indicate if You modified the Licensed Material"; "indicate the Licensed Material is licensed under this Public License, and include the text of, or the URI or hyperlink to, this Public License". 3(a)(2): any reasonable manner for the medium.
5. `CITATION.cff` (a "please cite" request, not a licence term) names Guillaume Boniface-Chang as author and Generative Spark, Inc. (Marble).

What the branch does (grep of non-historical files plus an exact-string compare; `Database Contents` and `ODbL-ATTRIBUTION.md` no longer occur anywhere outside dated records):

| Item | Where | Result |
|---|---|---|
| Upstream credit line, verbatim | `host/data/marble/MARBLE-ATTRIBUTION.md:3`, `frontend/src/landing/Landing.tsx:187-190`, `frontend/src/components/DecisionCard/DecisionCard.tsx:265-269` | **Met.** A normalising string compare (JSX tags and `{" "}` removed) finds the exact upstream line in all three files (`true`, `true`, `true`). |
| Both licences named | all three | **Met.** |
| Licence links | attribution file only (`opendatacommons.org/licenses/odbl/1.0/`, `creativecommons.org/licenses/by-sa/4.0/`) | Present in the file. **Absent from the app** (A2). |
| Derived-database statement, share-alike, content under CC BY-SA | `MARBLE-ATTRIBUTION.md:5-11` ("a **derived database** … offered under the Open Database License v1.0 … content … CC BY-SA 4.0") | **Met** in the repo file. The file does not link upstream's own `LICENSE` / `LICENSE-CONTENT` (it names them). |
| Indication of modification (CC BY-SA 3(a)(1)(B)) | `MARBLE-ATTRIBUTION.md` says "trimmed snapshot … derived database"; no `assessmentPrompt`, `centrality`, `standards` | **Met** in the repo file; not on screen. The studio also appends `(ages a–b)` to a displayed topic name (`sources/marble.mjs` `labelFor`). |
| Curriculum standards / `PROVENANCE.md` notices | `standards` not in the snapshot (topic keys unchanged from G1V; `git diff b3db0c7 HEAD -- host/data/marble/marble-snapshot.json` empty) | **Not applicable**, correctly. |
| ODbL notice inside the snapshot file | `marble-snapshot.json` carries `source: {repo, commit, licence: "ODbL-1.0"}`; no URI, no copyright holder, no CC BY-SA | See A2. |
| Upstream notices intact (4.2c) | upstream has no `NOTICE` | Nothing to keep. |
| `CITATION.cff` | not mentioned anywhere | A request only. Optional line. |

Upstream's own prose counts are stale against its data (README says 1,861 topics and CITATION.cff 1,590; `data/manifest.json` at the pin says 1,912 topics and 4,002 dependencies, which equals the snapshot). Immaterial; noted so nobody "fixes" the snapshot to match the README.

### Gaps (quoted)

- **A1 (condition). The studio credit does not appear where the studio shows Marble suggestions.** The card says "add a short credit line in the studio where Marble suggestions appear". The credit is in `DecisionCard.tsx:264` behind `rows.some((r) => r.alignment)`. But Marble suggestions show in the **plan card's "Suggested alignment" section** (`PlanCard.tsx:248-270`, "· from Marble's skill taxonomy"), which carries no credit. Measured: `studio-credit-probe.mjs.txt` is a copy of `studio-smoke.mjs` plus a DOM watcher; its run exits 0 (48/48) and logs `{"marbleCite":true,"alignKey":false,"credit":false}` on the studio route at the moment the draft plan shows "3 references". The credit never appeared in the whole studio walk (`studio-credit-probe.log.txt`, 4 WATCH lines). No test or smoke asserts the credit line either (grep over `frontend/src` and `frontend/scripts` finds the string only in the two components). Minimal fix: render the same line inside the plan card's reference section when any `citation.source === "marble"`, and assert it in `studio-smoke.mjs`.
- **A2 (condition, public deploy). The licence texts are not reachable from the shipped app.** `grep -l "opendatacommons\|creativecommons" -r frontend/dist` printed nothing, and the build output (`frontend/dist`) holds only `index.html` and `assets/` (the snapshot asset `marble-snapshot-B9Cjl5Qs.json`). `MARBLE-ATTRIBUTION.md` stays in `host/data/marble/` and is not served. The on-screen lines link only `https://withmarble.com`. Upstream's example notice and CC BY-SA 3(a)(1)(C) ask for a hyperlink or the text of the licence. The deployed snapshot asset is itself the derived database and is downloadable whole, and its only licence marker is `"licence":"ODbL-1.0"`. Minimal fix: hyperlink "ODbL 1.0" and "CC BY-SA 4.0" inside the verbatim line (the visible text stays identical), and add `licence`/`attribution` strings with the two URIs to the snapshot's `source` block. The owner may decide that the repo file is enough; that is the owner's call and I am not giving a legal reading.
- **A3 (note, not a condition). The Landing credit sits inside the collapsed "Under the hood" `<details>`** (`Landing.tsx:177-202`). My watcher read `inDetails: true`; `textContent` holds the exact line, but `innerText` of the page does not until a visitor opens it. Fine for "a reasonable manner", but it is easy to miss.
- **A4 (note).** A teacher-accepted `closeMatch` is kept as `alignment: {publicId, relationship, suggested}` (`host/course.mjs:739`): a bare `mt_*` id, no Marble text. Whether a published plan that carries only an id needs the 4.3 notice is an owner question; I did not check what the export and the ASFAI hand-off emit.
- **A5 (note).** `CITATION.cff` is not cited.

## 5. L1, L2, L3 and the suites (item 5)

- **L1 met.** `decodeSegment` (`host/handler.mjs:57-63`) throws `HttpError(400, "BAD_URI", …)` and is used on the marble topic route (`:183`), the course-id route (`:245`) and the archive-ref route (`:275`). Tests: `marble-routes.test.mjs` (topic `%`) and `http.test.mjs` (course `%`, archive `%`). All three mutants fail (§3).
- **L2 met.** `browserHost.test.ts` now asserts `not.toMatch(/forged|attacker/)` and `not.toContain('"mt_1"')`. Check: `JSON.stringify({alignment:{publicId:"mt_1"}})` contains `"mt_1"` (caught); a real id such as `"marble:mt_1z-gJBJFlM"` does not (no false failure). The snapshot has 0 ids equal to `mt_1` and 36 beginning `mt_1`. I did not mutate the browser host to bind the forged id, so "the guard fails when the host binds it" rests on the string check, not a run.
- **L3 met.** `Landing.tsx:187` reads "(ages 3–15)". `grep -rn "4–15\|4-15"` over `frontend/src`, `host/*.mjs`, `host/README.md`, `docs/NEXT.md` finds nothing.
- **Fence.** `git diff --stat main...HEAD -- confirm-gate api | wc -l` prints 0. No `mt_*` binding path was added (the diff is the parser, the source, the handler decode, the credit, tests).

Clean export: `bash …/run-suites.sh` runs `git archive feat/marble-source | tar -x` into scratch (the dotfiles `.gitignore` and `.vercelignore` are present), then, with `node -v` = v22.22.3. Logs: `suites-summary.txt`, `suites-counts.txt`.

| Command (from repo root) | Exit | Count |
|---|---|---|
| `(cd frontend && npm ci)` | 0 | |
| `(cd confirm-gate && node --test)` | 0 | 50 tests, 50 pass |
| `node --test api/test/` | 0 | 57 tests, 57 pass |
| `(cd host && node --test)` | 0 | 363 tests, 363 pass |
| `(cd host && node scripts/e2e-restart.mjs)` | 0 | 53/53 acceptance checks |
| `(cd frontend && npm test)` | 0 | 64 files, 682/682 tests |
| `(cd frontend && npm run build)` | 0 | built; emits `marble-snapshot-B9Cjl5Qs.json` (same hash as G1V) |
| `node frontend/scripts/studio-smoke.mjs` | 0 | 48/48 (48 `PASS` lines, 0 `FAIL`) |
| `node frontend/scripts/browser-mode-smoke.mjs` | 0 | 339/339 (339 `PASS`, 0 `FAIL`) |

The producer's counts (50, 57, 363, 53, 682, 48, 339) equal mine. Host was 362 at G1V; now 363 with the new tests.

## 6. Conditions

1. **A1.** Put the verbatim credit line in the plan card's "Suggested alignment" section whenever a Marble citation is shown, and assert it in `studio-smoke.mjs`. Before the December demo.
2. **A2.** Make the two licence texts reachable from the shipped app (hyperlinks inside the credit line; a `licence` URI block in the snapshot). Before any public deploy. The owner may instead accept the repo file as sufficient, in writing.

Recommended, not conditions: A3, A4, A5. The earlier G1 conditions C1 (ages) is cleared by §2-§3; C2 (attribution) is cleared for the repo and the Landing text, open for A1/A2 above.

## 7. What I did not verify

- I did not re-download the Marble data files (the snapshot is byte-identical to the one I verified at G1V: no diff in `marble-snapshot.json` between `b3db0c7` and `14a66d8`).
- I did not run `live-host-smoke.mjs` or `narrow-shell.mjs` (outside the card's list).
- I did not mutate the browser host to confirm the L2 guard fails when the forged id is bound.
- I did not check whether the ASFAI hand-off or the published export carries Marble ids or text (A4).
- The licence reading is mine as a reviewer, not legal advice.
- Slips of my own: my first `run-suites.sh` write was blocked by the harness, and the old script (pointing at the G1V scratch export) started once; I killed it within seconds and discarded it. The numbers above are from the one run of the rewritten script. `mut.sh` first printed `SURVIVED` for the baseline; I fixed the counter and re-ran (the final log says "10 mutants, 0 survived").
