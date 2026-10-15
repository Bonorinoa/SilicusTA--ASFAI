# Silicus host (Sprint 1)

The product core behind the GUI: the transport that owns each course's ledger
and confirm-gate, plus the append-only event log that makes state durable and
replayable. Zero dependencies (node:http, node:fs, node:crypto). Node >= 18,
tested on 22.

## Why it exists

The trust rule "only a host-minted `TeacherChannel` can record a teacher turn"
only has teeth if the HOST receives the message. In the Phase 0 workbench the
browser was the host, so a click handler and an inbound teacher message were
indistinguishable. Here the server is the host: it mints the channel inside the
inbound-message hook, and the client can only send intents.

## Run it

```sh
npm start                                        # 127.0.0.1:8787, data in ~/.silicus/host
SILICUS_HOST_DATA=/tmp/silicus SILICUS_HOST_PORT=8787 npm start
```

The GUI is a sidecar: it reaches this host through a same-origin `/api` proxy
(`vite.config.ts`, both dev and preview), so the client needs no credentials.

## Test it

```sh
npm test                        # 10 tests: the session flow, restart-by-replay,
                                # tamper detection, the anti-fabrication property
node scripts/e2e-restart.mjs    # 11 acceptance checks at the PROCESS boundary:
                                # drive the flow, SIGTERM, restart, state identical
```

Plus the core seam's own proof, from the repo root:

```sh
cd ../confirm-gate && node --test    # 26 tests, incl. test/persistence.test.mjs
```

## Layout

| File | What it is |
|---|---|
| `store.mjs` | `EventLog` (hash-chained NDJSON) + `CourseStore`. One directory per course: `<data-root>/<slug>/meta.json` and `events.ndjson`. |
| `course.mjs` | `CourseSession`: owns the ledger + gate per course, mints the teacher channel in the inbound hook, appends every mutation, rebuilds by replay, derives the views. |
| `handler.mjs` | The API itself, transport-agnostic: `createHandler(deps).handle({method, url, readBody})` -> `{status, json}`. Routes, intents-only shapes, the per-course lock, verified replay per request, the error mapping. |
| `server.mjs` | The node:http transport around the handler (loopback/origin guard, body reader, CORS), and the Node dependencies it injects. |
| `chain.mjs` | The hash-chain rule (`linkDigest`, `verifyRecords`, `ChainedLog`), shared by the disk log and the browser log. |
| `record-store.mjs` | The `CourseStore` interface over in-memory meta text + NDJSON lines with a write hook (the browser writes it through to IndexedDB). Same bytes as the disk store. |
| `backup.mjs` | Every course + its full log in the archive envelope; `readBackup` fails closed, whole (digest, chain, meta, replay). |
| `materials-core.mjs` | Material rules both hosts share (names, limits, clipping, digests); how a link becomes text is injected. `materials.mjs` adds the Node fetch + SSRF guard + YouTube. |
| `digest.mjs`, `lib/sha256.mjs` | `digestOf(json)`; one synchronous SHA-256 (the browser's `node:crypto` shim is a facade over it), cross-checked against node:crypto. |
| `scripts/e2e-restart.mjs` | The cross-process acceptance run. |
| `scripts/parity-run.mjs` | Runs `test/scripted-course.mjs` on this host (disk, real node:crypto, pinned ids/clock) for the cross-host parity test. |

## One API, two hosts

The same `handler.mjs` + `course.mjs` run in two places; only the injected dependencies differ.

| | Node host (local app, `server.mjs`) | Browser host (online app, `frontend/src/browser/`) |
|---|---|---|
| storage | `CourseStore`: files on disk | `RecordStore` written through to IndexedDB (add-only, awaited before a request answers) |
| hashing | node:crypto | `lib/sha256.mjs` via the `node:crypto` alias |
| worker | `workerFromEnv` (OpenRouter ZDR / OpenAI-wire / Anthropic) | `PlanWorker` at the site's `/api/worker`, demo passcode in sessionStorage |
| links | fetched here behind the SSRF guard; YouTube via captions / yt-dlp | the site's `/api/fetch`; YouTube refused as local-app-only |
| ASFAI, knowledge sources | ASFAI (OAuth) + local ontology | off: `available: false`, `sources: []` |
| archive | `LocalArchive` folder | none: Export all courses / Import (backup.mjs) |

Parity is a test, not a promise: `frontend/src/browser/browserHost.test.ts` runs the scripted course on both and
requires an identical transcript and byte-identical log (and is shown to fail when only the store bytes or only
the hash diverge).

## The API

| Route | Body | Notes |
|---|---|---|
| `GET /api/health` | — | liveness |
| `GET/POST /api/courses` | POST: owner, title, description?, materials? | create / list |
| `GET /api/courses/:id` | — | the full view |
| `GET /api/courses/:id/export` | — | tamper-evident JSON export |
| `GET /api/courses/:id/verify` | — | recompute the event-log chain |
| `GET /api/courses/:id/intake` | — | checkpoint 2's gate: consult BEFORE `prepare_outline` |
| `GET /api/asfai/status` | — | connected? never a token |
| `POST /api/asfai/connect` | — | consent URL; the teacher's click completes it |
| `GET /api/asfai/callback` | — | OAuth redirect (single-use state) |
| `POST /api/courses/:id/intake/call` | — | the HOST calls `prepare_outline`; a body cannot add fields |
| `POST /api/courses/:id/intake/answer` | text?, answers? | the teacher's reply (a real turn; arms the round) |
| `POST /api/courses/:id/plan/validate` | — | the HOST calls `validate_outline` (a signal, not a confirmation) |
| `POST /api/courses/:id/archive` | ref? | save the export (atomic + read-back verified) |
| `GET /api/courses/:id/anchor/:version` | — | the anchor a client PINS on the teacher's device |
| `GET /api/courses/:id/archive/:ref` | — | load and re-verify an archived export |
| `GET /api/archives` | — | list archive refs |
| `POST /api/courses/:id/checkpoints` | id (files\|outline), text, note? | checkpoints 1–2 |
| `POST /api/courses/:id/objectives` | items, sources?, assistantText? | AI proposes; nothing is confirmed |
| `POST /api/courses/:id/decisions` | decisions, text | checkpoints 3 (teacher); also how a published course is revised (add, revoke, reword) |
| `POST /api/courses/:id/plan` | spec, assistantText? | AI drafts |
| `POST /api/courses/:id/plan/confirm` | text, planId? | checkpoint 4 (teacher) |
| `POST /api/courses/:id/publish` | text, note? | checkpoint 5 (teacher) |

## The trust boundary

- **Clients send intents only.** There is no field anywhere in this API that
  accepts provenance, a turn reference, or a channel — so a client cannot hand
  the host a confirmation. It also cannot supply a timestamp: the route passes
  only the decision list and the message text, and the host stamps `decidedAt`.
- **The host mints the turn.** `CourseSession#inbound` is the only place a
  `TeacherChannel` is created, once per inbound teacher message.
- **One mutation = one event.** The event log is the source of record; the gate
  is rebuilt from it on load, so "a second host reloads it" is a real test, not
  a claim.

## Persistence: the replay seam

Replay is exact only if local ids and timestamps are reproducible. `ConfirmGate`
therefore takes an injectable `idFactory` (it already took an injectable clock);
this host uses `deterministicIdFactory(course.seed)` with one fixed timestamp per
event. A recorded log replayed with the default RANDOM ids cannot even resolve
its own decisions (`UNKNOWN_PROPOSAL`) — that falsification is a test, not a
comment. See `confirm-gate/test/persistence.test.mjs`.

## Integrity: what the chain does and does not prove

`verify()` recomputes `digest = sha256(prev + newline + canonical(event))` for
every record. Any edit, reorder, or deletion is detected **relative to a known
head**.

It is tamper-EVIDENT, not tamper-PROOF. Anyone who can write the data directory
can rewrite the log and recompute a self-consistent chain from genesis, and the
local `verify()` will then say `ok: true`. The chain carries **no signature and
no proof of authorship**: the head digest is only meaningful once it has been
recorded somewhere else (the teacher's device, a second host, an ASFAI export).
This is the same honest limit as `confirm-gate/SPEC.md` §8 (process integrity).
The provenance check is therefore "a second host reloads the export and reaches
the same record", not `verify()` alone.

What the host DOES do about it (added after a red-team pass, and each closed by a
regression test):

- **Load verifies and fails closed.** `CourseSession.load` recomputes the chain
  first and refuses a record that does not verify (`CourseIntegrityError`, code
  `LOG_INTEGRITY`; over HTTP a 409). A naively edited record or a mid-log deletion
  is refused on the very request that would have served it.
- **The server loads per request.** The log is the source of record, so a fresh
  verified replay per request is the correct read — there is no in-memory copy to
  mask a tamper.
- **The ledger object is not exposed.** `CourseSession` has no `ledger`/`gate`
  getters, only `turns()`, `turn(ref)` and `isTeacherTurn(ref)`, so in-process
  code cannot mint a `TeacherChannel` and confirm its way to a published package
  (that bypass was found and closed). §8's process-integrity limit still stands
  for code that imports `host-guard.mjs` and builds its own ledger.
- **`meta.json` is unauthenticated write surface**: a writer can point one
  course's directory at another course's seed and replay that log under this
  course's identity. Same class as the rest.

Still true, and unfixed by design: a **self-consistent rewrite** — edit or insert
an event, then recompute every digest from genesis — verifies `ok: true` and is
served as ordinary teacher decisions with ordinary `urn:turn` provenance. Nothing in
the log is signed, so the only defence is a reference the writer cannot reach.

**That defence now exists (the pin).** `GET /api/courses/:id/anchor/:version`
returns the anchor for a sealed version — the digest of the sealed version record,
plus the log's head and length at the moment it sealed. The GUI pins it in **local
browser storage** (`frontend/src/gate/pin.ts`): no new dependency, no server-side
secret, and, crucially, outside the host's write surface. "Check my pinned copies"
compares each pin against the host's current account and reports:

| status | meaning |
|---|---|
| `ok` | the sealed version is exactly as it was when pinned |
| `changed` | the sealed record differs, or the history is SHORTER (events removed) |
| `missing` | the version is no longer in the record at all |
| `advanced` | the record has legitimately grown since (expected if you have worked) |

A pin is per version, so later work does not disturb it. It anchors the *sealed
version* and the log's length at that moment — not the tail: a forged event appended
after the pin is only covered when you pin again.`

## Checkpoint 2: the ASFAI intake round (Sprint 2b)

The outline is not confirmable until the ASFAI clarification round actually happened,
and the host will not take a server token's word for it.

Live contract, captured 2026-10-10 (`fixtures/lesson-intake.json`, asfai-learning
2.0.0): `prepare_outline` with `mode: "new"` and nothing else returns
`state: "clarifying"` with three open questions and issues **no**
`clarificationReceipt`; returning the fields yields `ready_to_draft` with **no**
`draftAuthorization`. Binding this checkpoint to a server-issued authorization would
therefore make the one-teacher flow permanently unreachable. It binds to what
happened instead:

> an **observed** `ready_to_draft` **and** a teacher turn landing after the questions.

- The host calls the MCP itself (`host/asfai/`, its own OAuth, never Hermes' token
  file). `POST /intake/call` builds the payload from the teacher's recorded answers
  and nothing else, then records what the server actually returned. There is no
  report-back route: a client cannot supply a `prepare_outline` result.
- `POST /intake/answer` records the teacher's reply through the same inbound hook as
  every other teacher action. That is what arms the round.
- Reporting `ready_to_draft` **without** an answer does not authorize. host-guard's
  `onPrepareOutlineResult(ready_to_draft)` clears an unanswered clarifying round by
  design (SPEC §7), so the intake tracks the round itself. Both the session test and
  an HTTP test pin the bypass.
- A `draftAuthorization`, if a future server emits one, authorizes on its own.

## Revising a published course

There is no "reopen" route and no revision mode. The gate already reopens by itself: an objective added
or revoked after a seal marks the publish checkpoint pending, revoking one the plan cites invalidates the
plan, and `publish` seals the next version with `previousVersion` pointing back. Every act is an ordinary
teacher turn through `/decisions`, `/plan`, `/plan/confirm` and `/publish`, and replays like any other.

What the audit found, with the worker off or on:

| After version 1 is sealed | Result |
|---|---|
| `add` an objective | allowed; the plan does not cite it yet; version 2 can seal |
| `drop` an objective | allowed; if the plan cites it, the plan is invalidated and publish is blocked |
| `rename` / `accept` a confirmed objective | refused, `ALREADY_DECIDED` (a content decision is terminal) |
| `reword` a confirmed objective | allowed: same id and kind, new statement; the plan keeps its citations; version 2 can seal with no worker (see below) |
| `POST /plan` (re-draft) | needs the worker (`501 WORKER_NOT_CONFIGURED` without it) |
| `publish` with nothing changed | returns version N unchanged, seals nothing |

`view.revision` is a read of the record (writes nothing, takes nothing from a client):
`{sealedVersion, nextVersion, drafting, changes: {objectivesAdded, objectivesRemoved, objectivesReworded:
[{id, before, after}], plan: same|replaced|unconfirmed, planStatus}, notInPlan}`. `drafting` is true only when the
record differs from the sealed version (a reword and a reword back is not a difference). Rows also carry
`citedByPlan` and `reworded`. Students (`/student/ask`) and the handout read `latestSealedVersion()`, never the draft.

### Rewording a confirmed objective: the `reword` verb

`{verb: "reword", proposalId: <the objective's id>, statement}` through the same `POST .../decisions` (no new route,
and the client sends only those three things plus the teacher's text: provenance, ids, `kind`, `alignment` and any
`mt_*` key are not read, and a reword's extra keys are not even written to the log). The gate keeps the objective's
id and kind, takes the statement, and records the decision with `rewordedFrom: {previousStatement, originalStatement}`
(the before, and the proposal's own wording) and the host-minted teacher provenance, as every decision does.

| Refusal | Code | Status |
|---|---|---|
| unknown id, an `mt_*` id, another course's id, no id | `UNKNOWN_OBJECTIVE` | 409 |
| still a proposal (decide it first) | `NOT_CONFIRMED` | 409 |
| dropped / revoked | `OBJECTIVE_REVOKED` | 409 |
| same statement as now (after trimming) | `STATEMENT_UNCHANGED` | 409 |
| empty, not text / more than one line / over 2,000 characters | `BAD_STATEMENT` / `STATEMENT_NOT_ONE_LINE` / `STATEMENT_TOO_LONG` | 422 |

The statement goes through `proposer.teacherStatement`, the one rule `add` and `rename` use, before anything is
recorded. A refused reword writes nothing, and a batch is all or nothing.

**What a reword does to the lesson plan** (the rule, and why). The plan stays what it was: confirmed, and publishable.
Its cited ids did not change, so nothing is invalidated and nothing is re-confirmed on the teacher's behalf. But the
plan was written from the OLD wording, so the host does not pretend it is current: `view.planWording` is
`{stale, objectives: [{id, before, after}]}`, the cited objectives reworded since the plan was last drafted or
confirmed (`ConfirmGate.rewordedSincePlan()`; `before` is the wording the plan was written from). The UI shows it on the
plan and in the revision panel. It is cleared only by the teacher: a new draft (built from the current wording) or a
`POST /plan/confirm` made after the reword, with the notice in view. A later reword raises it again. A plan that is
already invalidated reports nothing here (it has its own re-confirmation story). It never blocks publishing: a teacher
with no worker can still seal the next version with the plan as it reads.

A sealed version never changes: students and the handout keep reading the last sealed wording, and publishing after a
reword seals version N+1 (`previousVersion` N) with the new statement and `rewordedFrom` on the reworded objective.

Statements typed for `add`, `rename` and `reword` are untrusted: `proposer.teacherStatement` applies the same rule as
`outcomeSentences` (control and bidi characters blanked) to ONE sentence, refuses a line break
(`STATEMENT_NOT_ONE_LINE`), empty text (`BAD_STATEMENT`) and more than 2,000 characters
(`STATEMENT_TOO_LONG`, the intake bound), all `422`, with nothing recorded.

Known gaps: revoking a cited objective with no worker leaves the course unable to seal the next version until one is
configured (a reword does not: that is what `reword` is for); over the 1 MiB body cap the connection is cut before
the `413` is sent; `add` and `rename` still write a client's extra decision keys into the log verbatim (inert, the gate
ignores them; only `reword` is reduced to its three fields).

## Archive (Sprint 2a)

`POST /archive` copies the current export into the local archive;
`GET /api/courses/:id/archive/:ref` reads it back. Following the ASFAI storage
resource for a local file store, a save is only "saved" after a temp write, an
**atomic replace**, and a **read-back digest comparison** — so `verified: true` means
the bytes came back. A record that no longer matches its digest is refused
(`ARCHIVE_DIGEST_MISMATCH`).

Not invented: `action_schema` publishes no schema for the ASFAI object operations
(`put_object` / `get_object`), and the educator workspace store explicitly does not
hold course files. A Pod-backed archive therefore needs a file-capable store and its
field names confirmed against the live server first. `export` + `verify` are the
documented ASFAI-shaped path.

## ASFAI is recommended, never required (Sprint 5)

A fresh course carries the host's own three questions (same ids and prompts ASFAI asks). The
teacher's recorded answers authorize checkpoint 2 when ASFAI was never consulted; once ASFAI has
been consulted, its observed round governs exactly as before. "Was ASFAI consulted" is derived
(`observedState !== null`), so there is no new event and replay stays exact.

## Knowledge sources (Sprint 6)

The plan-drafting worker may draw on pluggable sources (`host/knowledge.mjs`). Config only, never
a request field:

- `SILICUS_SOURCE_ASFAI=0` turns ASFAI's graph off (on by default when ASFAI is connected).
- `SILICUS_ONTOLOGY_FILE=/path/ontology.json` enables a local ontology (`fixtures/ontology.example.json`).
- `GET /api/knowledge/status` reports which sources are in play (capability only).

Retrieved text is untrusted context and is never recorded; the plan event keeps ref, label,
source, activities and whether a source actually checked it. ASFAI's graph is only queried for a
course whose answers the teacher already sent to ASFAI. Citations are suggestions: not objectives,
not in the sealed package, never required.

## The drafting worker (config only)

Off unless a model is configured. One worker serves every model call (plan drafting, objectives from
material, grounded student answers); its output is always validated as untrusted input.

| Variable | Meaning |
|---|---|
| `SILICUS_WORKER_PROVIDER` | `openrouter` (preset: OpenRouter, `deepseek/deepseek-v4-flash-0731`, zero-data-retention ON, key from `OPENROUTER_API_KEY`), `anthropic` (native Messages API), or unset (any chat-completions endpoint) |
| `SILICUS_WORKER_URL` | endpoint; `anthropic` defaults to `https://api.anthropic.com/v1/messages` |
| `SILICUS_WORKER_MODEL` | model; `anthropic` defaults to `claude-sonnet-5-5` |
| `SILICUS_WORKER_API_KEY` | credential; `anthropic` also reads `ANTHROPIC_API_KEY` |
| `SILICUS_WORKER_ZDR` | zero-data-retention routing, OpenRouter only. On for the `openrouter` preset (`0` turns it off); opt-in (`1`) otherwise. On the Anthropic wire `1` refuses to start: the host will not claim a guarantee it cannot make |
| `SILICUS_WORKER_REASONING` | OpenAI-wire reasoning: `low`, `medium`, `high`, `off`, or `model-default`. The `openrouter` preset defaults to `low`; other setups omit it unless explicitly set. It is never sent on the Anthropic wire. |
| `SILICUS_TYPICAL_SECONDS` | Optional JSON wait ranges reported by `/api/worker/status`, overridable per task. Defaults to `{"objectives":[3,15],"plan":[5,25],"answer":[2,8]}`; invalid JSON or task entries are ignored. |
| `SILICUS_YTDLP` | path to `yt-dlp`, for YouTube captions |

Retention differs by provider. OpenRouter with `SILICUS_WORKER_ZDR=1` routes only to zero-retention
endpoints. The Anthropic API is under Anthropic's normal API data-retention terms unless the organization
has a zero-retention agreement, which the host cannot see. The material panel says which applies. Use public
material (a public lecture) or material you are allowed to share until that is settled.

Default (OpenRouter, zero-retention): 

    SILICUS_WORKER_PROVIDER=openrouter OPENROUTER_API_KEY=... SILICUS_YTDLP=$HOME/.local/bin/yt-dlp npm start

Claude Sonnet 5.5 is available instead with `SILICUS_WORKER_PROVIDER=anthropic ANTHROPIC_API_KEY=...`.
