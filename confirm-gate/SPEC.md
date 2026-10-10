# confirm-gate v0 — the teacher-confirm contract (Silicus TA 3.0)

**Status:** reference contract for the host side of Silicus TA 3.0.
**Scope:** two host-side guarantees that ASFAI (by design) cannot make for us.
**Composes with:** ASFAI PR #15 (clarification receipts / `draftAuthorization`), the
four-record object graph in `../01-lesson-planning-object.md`, and the boundary facts in
`../research-asfai-education-mcp-implementation.md`.

Two rules are law here:

1. **AI assists, never decides.** Confirmation is an explicit teacher action recorded with
   provenance. The AI proposes; the teacher decides; only the teacher publishes.
2. **Unconfirmed proposals must not appear on a published lesson plan.** A published
   `CoursePackage` version contains only objectives that carry a recorded teacher decision.

Everything below is enforceable in `host-guard.mjs` + `confirm-gate.mjs`; anything not
enforceable is called out in *Non-guarantees* at the end.

---

## 1. The five checkpoints as a state machine

The contract's five teacher checkpoints are modeled as one ordered machine per course:

```text
  files ──▶ outline ──▶ objectives ──▶ plan ──▶ publish
   (1)        (2)          (3)         (4)       (5)
```

Each checkpoint has a status: `pending → open → confirmed`. Transitions:

| # | Checkpoint | Who opens | What confirms it | What reopens it |
|---|---|---|---|---|
| 1 | `files` | host surfaces the material list | explicit teacher confirm (`confirmCheckpoint("files", provenance)`) | — (materials are checkpoint-1 business; re-confirm supersedes) |
| 2 | `outline` | host surfaces the outline (after PR #15 intake rounds) | explicit teacher confirm **and** an observed `draftAuthorization` (§6) | — |
| 3 | `objectives` | AI proposes objectives (`proposeObjectives`) | **every** proposal carries a teacher decision (accept / rename / drop / add) | a new proposal arrives after confirmation |
| 4 | `plan` | AI proposes the `LessonPlan` (`proposeLessonPlan`) | explicit teacher confirm (`confirmLessonPlan`, provenance required) | a cited objective is dropped, or a new plan proposal supersedes |
| 5 | `publish` | host previews the export (`publishStatus`) | `publish(provenance)` — teacher only | any change after a publish |

Order is enforced: an action belonging to checkpoint *N* requires checkpoints *1..N−1*
confirmed (`CHECKPOINT_ORDER` otherwise). Checkpoints 3 and 4 auto-confirm from their own
decision APIs; there is no separate "confirm the objectives checkpoint" call that could be
invoked without the per-proposal decisions actually existing.

State of the machine is readable at any time (`gate.checkpoints()`), frozen snapshots only.

## 2. Turn provenance — what "the teacher decided" means

A **turn** is one conversation message, recorded in an append-only `TurnLedger` with a
role. Only two roles exist: `teacher`, `assistant`. A `teacher` turn can only be created by
`TeacherChannel#say`, where a `TeacherChannel` capability is minted by
`TurnLedger#teacherChannel` **from the host transport's inbound-user-message hook** — the
code path that fires when a real teacher message arrives. Model output is recorded via
`recordAssistantTurn` and is permanently `assistant`.

Every confirmation carries **teacher provenance**:

```json
{
  "turnRef": "urn:turn:7",
  "decidedBy": "teacher:tk-1",
  "channel": "silicus-ui",
  "decidedAt": 1791580800000
}
```

Validation (any failure = `FabricatedConfirmationError`, nothing is applied):

| Check | Code |
|---|---|
| provenance object present and complete | `MISSING_PROVENANCE` |
| `turnRef` resolves in the ledger | `UNKNOWN_TURN` |
| the cited turn's role is `teacher` | `NON_TEACHER_TURN` |
| `decidedBy` equals the turn's actor | `ACTOR_MISMATCH` |
| `channel` equals the turn's channel | `CHANNEL_MISMATCH` |
| `decidedAt` ≥ the turn's time | `TIME_TRAVEL` |
| `decidedAt` ≥ the proposal's `proposedAt` | `TIME_TRAVEL` |

Consequence: **AI self-confirmation is structurally impossible at the API level.** There is
no method anywhere in these modules that sets `confirmedByEducator` or produces a
`DecisionRecord` without a validated provenance object, and no model-reachable path to
record a `teacher` turn. `proposeObjectives` hard-writes `confirmedByEducator: false`; only
`#requireTeacherProvenance` (one private choke point) can flip it.

## 3. Decision verbs (checkpoint 3)

One `confirmObjectives({ provenance, decisions })` call = one teacher turn over the
proposal set. Verbs: **accept / rename / drop / add**.

| Verb | Semantics | Confirmed-set effect |
|---|---|---|
| `accept` | The proposal enters the confirmed set exactly as proposed (its `urn:uuid` id, its optional `mt_*` reference). | adds `objectiveId = proposalId` |
| `rename` | The teacher's replacement statement becomes the wording of the **same** objective: the `urn:uuid` id stays **stable** (contract: `ObjectiveRef.id` is "URN, stable") so plans citing it survive wording edits. The proposal record itself is immutable and never rewritten; before→after lives on the decision record (`renamedFrom`). | updates `objectiveId = proposalId` (unchanged id); confirmed entry carries the teacher's statement |
| `drop` | Removed from / kept out of the confirmed set. Terminal: a dropped proposal cannot be revived (propose a new one). | removes if present; invalidates any confirmed plan citing it |
| `add` | The teacher authors a new **local** objective (`kind: "local"`, teacher-written statement). Its id is minted locally (`urn:uuid:…`) — never an `mt_*` id. Optional `alignment` (`publicId: mt_…`, `relationship: closeMatch \| relatedTo \| exactMatch`) is metadata with `confirmedByEducator: true`, never a key. | adds immediately (the teacher IS the decision) |

Rules:

- At most one **content-shaping** decision (accept/rename) per proposal; a conflicting
  second decision throws `ALREADY_DECIDED`. `drop` may follow accept/rename (revocation).
- **Rename never mutates the proposal.** Both records survive: the original proposal
  (frozen, `statement` as proposed) and the confirmed entry (teacher's statement,
  `renamedFrom` provenance chain). Provenance on the decision and on the confirmed entry
  cites the teacher turn that carried the rename.
- **Local objectives are first-class.** `kind: "local"` needs only a teacher/AI-written
  statement; `kind: "public"` needs a Marble `publicId` (`mt_…`) and is optional metadata.
  Every objective — public or local — is keyed by its own `urn:uuid` id. **Never key state
  on `mt_*` alone** (two proposals referencing the same `mt_*` stay distinct records).

## 4. The plan gate (checkpoint 4) and publish (checkpoint 5)

`proposeLessonPlan` produces a draft `LessonPlan` whose activities cite objective ids and
`MaterialVersion` ids. `evidenceIfAny` ∈ `none | observation | work-product` — **student
chat is not evidence of learning** and is rejected (`BAD_PLAN`).

`confirmLessonPlan({ planId, provenance })` is the checkpoint-4 gate: `status: confirmed`
only after an explicit teacher action with validated provenance.

`publish({ provenance })` is checkpoint 5 and the ONLY way a `CoursePackage` version comes
into existence. Hard blockers (`PublishBlockedError`, each reason in `.blockers`):

1. checkpoint `files` / `outline` / `objectives` not teacher-confirmed,
2. any proposal still awaiting a first decision,
3. no teacher-confirmed plan (an invalidated plan counts as none),
4. the plan has no activities,
5. **any objective cited by the plan is not in the confirmed set** (never accepted,
   renamed away, or dropped) — *unconfirmed proposals must not appear on a published
   lesson plan*.

Publishing itself requires teacher provenance (§2) — the AI never publishes. A publish
with no changes since the previous one is idempotent (returns the same version record).

## 5. Binding to CoursePackage versions — bump, never overwrite

- Each decision/confirmation records `boundCourseVersion` = the version it will land in
  (`gate.#nextVersion` at record time). Post-publish decisions bind to the next version.
- `publish` snapshots the confirmed set + confirmed plan into a new immutable version record
  (`version: n+1`, `previousVersion: n`), pushed to an append-only history. Nothing in these
  modules mutates a published record; `getVersion(n)` returns frozen data.
- Any change after a publish marks unpublished work and demotes checkpoint 5 to `pending`;
  the next publish is a new version. Old versions keep reflecting exactly what was confirmed
  at the time — including objectives dropped *after* that publish (they remain in the old
  version's `objectiveRefs` and vanish from the next).

## 6. Idempotency of confirm calls

MCP calls get retried; a retried confirm must not double-apply. Every confirm-style
operation is keyed and replay-safe:

| Call | Idempotency key | Replay result | Conflict result |
|---|---|---|---|
| `confirmObjectives` accept/rename/drop | `verb : proposalId : turnRef` | original `DecisionRecord`, no state change | `ALREADY_DECIDED` (different turn re-deciding) |
| `confirmObjectives` add | `add : turnRef : sha256(statement)` | original record; **no second id is minted** | new turn = a genuinely new `add` |
| `confirmLessonPlan` | `confirm-plan : planId : turnRef` | same plan, still confirmed | a later turn may re-confirm (post-invalidation repair) |
| `publish` | (state-based: no changes since last publish) | previous version record | — |

Replaying a whole `confirmObjectives` batch is therefore safe: identical records come back,
the confirmed set is unchanged, and checkpoint status is recomputed identically.

## 7. Composition with ASFAI PR #15 (clarification receipts)

PR #15 makes the clarification round **unskippable server-side**:

- a first `prepare_outline` (mode `new`) without a valid HMAC `clarificationReceipt`
  returns `state: "clarifying"` with `questions[]` and issues a receipt
  (`ASFAI_CLARIFICATION_SECRET`, TTL-bound);
- only a second call echoing that receipt may return a `draftAuthorization` bound to
  `topic|course|audience|learningOutcomes`;
- `validate_outline` rejects outlines without a matching `draftAuthorization`.

What the server **cannot** prove: that a human saw the questions. A host can still call
`prepare_outline` twice in one turn and echo the receipt with invented answers. That is the
**residual rule**, and it is host-side law, enforced by `host-guard.mjs`:

```text
prepare_outline result state "clarifying"
        │
        ▼
   [clarifying] ── beforePrepareOutline() → REFUSED (AWAITING_TEACHER_REPLY)
        │                 receipt echo   → REFUSED (RECEIPT_NOT_ARMED)
        │ teacher turn recorded (TeacherChannel only)
        ▼
     [ready]   ── beforePrepareOutline() → allowed; receipt armed, single-use
```

Division of labor — note these are **different events**:

| Mechanism | Proves | Does NOT prove |
|---|---|---|
| PR #15 `clarificationReceipt` | the clarification round structurally happened before drafting | that a human answered (host must enforce that) |
| host-guard residual rule + receipt arming | a teacher turn landed after the questions were surfaced; receipts are armed per round and single-use | anything about content decisions |
| PR #15 `draftAuthorization` | the server bound a draft to topic\|course\|audience\|outcomes | any teacher decision |
| confirm-gate decision (accept/rename/drop/add) | the teacher decided on a specific proposal | — |
| confirm-gate `publish` provenance | the teacher published this version | — |

**A receipt is answers-arrived. A confirmation is a decision-made. Neither substitutes for
the other.** The confirm gate never treats tool state (`clarifying`, `ready_to_draft`,
`valid`, a receipt, a `draftAuthorization`) as a teacher decision, and the host-guard never
treats a decision as an answered clarification. Concrete composition point: checkpoint 2
(`outline`) cannot be teacher-confirmed while the shared `ResidualRuleGuard` has not
observed a `draftAuthorization` (`MISSING_DRAFT_AUTHORIZATION`) — so an outline built on an
unanswered clarification round cannot reach the plan or publish gates.

## 8. Non-guarantees (honest limits)

- **Process integrity.** "Structurally impossible" means: no API in these modules lets a
  model-authored object become a teacher turn or a confirmation. Code running inside the
  host process with access to the transport hook can record anything — the transport must
  wire `TurnLedger#teacherChannel` to genuine inbound user messages only. (Cryptographic
  end-to-end attestation of "a human was asked" needs a channel the model cannot observe,
  e.g. UI-side signing; out of scope for v0.)
- **Paraphrase fidelity.** The verb+target mapping of a teacher's prose into decisions is
  the host UI's job (the verbs are per-proposal UI actions). The gate validates provenance
  and structure, not whether the decision textually matches the turn.
- **ASFAI validates, ASFAI does not remember.** `validate_outline` returning valid is not
  evidence a teacher reviewed anything; ASFAI stores nothing for us. Durable course state
  lives in Silicus (`get_course` / `export_course` round-trips; decision traces are portable
  objects, e.g. `guard.snapshot()` + `gate.decisions()`).
- The callable MCP surface stays the contract's seven actions
  (`create_course`/`version_course`, `add_material`, `propose_objectives`,
  `confirm_objectives`, `propose_lesson_plan`, `confirm_lesson_plan`,
  `get_course`/`export_course`). This module is the host-side protocol beneath it — it does
  not add tools.

## 9. The host's durable record — event log + replay (Sprint 1)

§8 says durable course state lives in Silicus. This section fixes *how*: the hosting
process appends every mutation to a per-course event log and rebuilds the live gate by
replaying it. The log is the source of record; `get_course` / `export_course` are views
over it.

- **One mutation = one event**: `checkpoint.confirmed`, `objectives.proposed`,
  `objectives.decided`, `plan.proposed`, `plan.confirmed`, `package.published`. An event
  that requires a teacher turn carries the inbound message text it was recorded from.
- **Replay must be exact**, which means local ids and timestamps must be reproducible.
  `ConfirmGate` therefore takes an injectable `idFactory` (it already took an injectable
  `clock`); a replaying host uses `deterministicIdFactory(seed)` with one fixed timestamp
  per event. Proof and falsification: `test/persistence.test.mjs` — a recorded log
  replayed with the default random ids cannot resolve its own decisions
  (`UNKNOWN_PROPOSAL`). Idempotency keys are unchanged (§6), so replay re-applies
  idempotently.
- **The transport, not the caller, supplies provenance.** A replaying host mints the
  `TeacherChannel` inside its inbound-message hook exactly as a live host does; a client
  API must never accept a turn reference, a channel, or a timestamp. This is what keeps
  §2 true once the gate runs server-side rather than in a UI process.
- **Integrity is tamper-evidence, not tamper-proofing** (extends §8). A chained
  `digest = sha256(prev + newline + canonical(event))` detects any edit, reorder or
  deletion *relative to a known head*. It carries no signature and no proof of
  authorship: a writer with access to the record directory can rewrite history and
  recompute a self-consistent chain. The head digest is therefore meaningful only once
  recorded somewhere else. **The provenance check is "a second host reloads the export
  and reaches the same record", not the local chain check alone.**
- **Fails closed on read.** The hosting process recomputes the chain before serving a
  course and *refuses* a record that does not verify (naive edit, mid-log deletion)
  rather than replaying it; it exposes no ledger or gate object to its own callers, so
  the inbound hook stays the only route to a teacher turn. A self-consistent rewrite
  (recompute the chain) remains undetectable in principle and is not claimed otherwise.
