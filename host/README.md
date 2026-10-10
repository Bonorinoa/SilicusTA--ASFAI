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
| `server.mjs` | The intent-only HTTP API (node:http). |
| `scripts/e2e-restart.mjs` | The cross-process acceptance run. |

## The API

| Route | Body | Notes |
|---|---|---|
| `GET /api/health` | — | liveness |
| `GET/POST /api/courses` | POST: owner, title, description?, materials? | create / list |
| `GET /api/courses/:id` | — | the full view |
| `GET /api/courses/:id/export` | — | tamper-evident JSON export |
| `GET /api/courses/:id/verify` | — | recompute the event-log chain |
| `GET /api/courses/:id/intake` | — | checkpoint 2's gate: consult BEFORE `prepare_outline` |
| `POST /api/courses/:id/intake/observe` | state, questions?, draftAuthorization?, receipt? | report an OBSERVED `prepare_outline` result |
| `POST /api/courses/:id/intake/answer` | text | the teacher's reply (a real turn; arms the round) |
| `POST /api/courses/:id/archive` | ref? | save the export (atomic + read-back verified) |
| `GET /api/courses/:id/anchor/:version` | — | the anchor a client PINS on the teacher's device |
| `GET /api/courses/:id/archive/:ref` | — | load and re-verify an archived export |
| `GET /api/archives` | — | list archive refs |
| `POST /api/courses/:id/checkpoints` | id (files\|outline), text, note? | checkpoints 1–2 |
| `POST /api/courses/:id/objectives` | items, sources?, assistantText? | AI proposes; nothing is confirmed |
| `POST /api/courses/:id/decisions` | decisions, text | checkpoints 3 (teacher) |
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

- The host does not call the MCP yet (no in-process OAuth client). The runtime asks
  `GET /intake`, makes the real call, and reports the result to
  `POST /intake/observe`. That mirrors host-guard's design: the guard observes tool
  results; it never executes them.
- `POST /intake/answer` records the teacher's reply through the same inbound hook as
  every other teacher action. That is what arms the round.
- Reporting `ready_to_draft` **without** an answer does not authorize. host-guard's
  `onPrepareOutlineResult(ready_to_draft)` clears an unanswered clarifying round by
  design (SPEC §7), so the intake tracks the round itself. Both the session test and
  an HTTP test pin the bypass.
- A `draftAuthorization`, if a future server emits one, authorizes on its own.

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
