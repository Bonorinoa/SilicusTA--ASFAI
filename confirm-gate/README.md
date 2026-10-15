# confirm-gate v0 (Silicus TA 3.0)

Host-side reference implementation of two rules the ASFAI MCP cannot enforce for us:

1. **The residual rule** (`host-guard.mjs`) — after a `prepare_outline` result with
   `state: "clarifying"`, no second `prepare_outline` call until a teacher turn is
   observed; a `clarificationReceipt` obtained in that round may not be echoed until then.
   (PR #15 makes the clarification round unskippable *server-side*; only the host can prove
   it waited for a *human*.)
2. **The teacher-confirm gate** (`confirm-gate.mjs`) — proposals (objectives, then the
   lesson plan) enter a published `CoursePackage` only through explicit teacher decisions
   (`accept` / `rename` / `drop` / `add`, and `reword` for an already confirmed objective) with recorded provenance; publishing with any
   unconfirmed objective in the plan is blocked; AI self-confirmation is structurally
   impossible (no code path from model output to a teacher turn or a confirmation).

Contract: [`SPEC.md`](./SPEC.md). Upstream context:
`../docs/lesson-planning-object.md` (four records + five checkpoints),
`../patches/2026-10-05-clarification-receipt-issue.md` (PR #15 semantics),
`../docs/research/asfai-education-mcp-implementation.md` (ASFAI boundary facts).

## Files

| File | What it is |
|---|---|
| `host-guard.mjs` | `TurnLedger` (append-only turns with enforced `teacher`/`assistant` roles; teacher turns only via a `TeacherChannel` capability minted by the transport) + `ResidualRuleGuard` (the residual-rule state machine over turns: `idle → clarifying → ready`, receipt arming/ single-use). |
| `confirm-gate.mjs` | `ConfirmGate`: five-checkpoint state machine, proposals → teacher decisions → confirmed set, lesson-plan gate, publish blocking, version bumping (never overwrite), idempotent confirm calls, `FabricatedConfirmationError` / `PublishBlockedError`. |
| `test/host-guard.test.mjs` | Residual-rule + ledger tests (required case *i*). |
| `test/confirm-gate.test.mjs` | Confirm-gate tests (required cases *ii–vi* + ordering, idempotency, version binding, PR #15 composition). |
| `SPEC.md` | The contract. |

Zero dependencies: plain ES modules + JSDoc types. No `npm install`, no `package.json`.

## Module ↔ checkpoint map

| Checkpoint | host-guard.mjs | confirm-gate.mjs |
|---|---|---|
| 1 **Files** | teacher turn provenance for the file-list confirmation | `confirmCheckpoint("files", provenance)` |
| 2 **Outline** | residual rule around `prepare_outline`; arms receipts; observes `draftAuthorization` | `confirmCheckpoint("outline", provenance)` — refused (`MISSING_DRAFT_AUTHORIZATION`) until the guard has seen a `draftAuthorization` |
| 3 **Objectives** | teacher turn provenance behind every decision | `proposeObjectives` (proposals, `confirmedByEducator: false`), `confirmObjectives` (accept/rename/drop/add/reword; `rewordedSincePlan` reports cited objectives reworded since the plan); checkpoint auto-confirms when every proposal is decided, reopens on new proposals |
| 4 **Plan** | teacher turn provenance behind the plan confirmation | `proposeLessonPlan`, `confirmLessonPlan`; invalidated + reopened when a cited objective is dropped |
| 5 **Publish** | teacher turn provenance behind the publish action | `publishStatus` (preview), `publish` (version bump, immutable history); blocked while any cited objective is unconfirmed |

## Module ↔ PR #15 map

| PR #15 artifact | Meaning | Owner here |
|---|---|---|
| `clarifying` + `questions[]` | intake is incomplete; answers must come from the teacher | `ResidualRuleGuard.onPrepareOutlineResult` → `clarifying` blocks the next call |
| `clarificationReceipt` (HMAC) | a clarification round happened before drafting | guard arms it per round **only after a teacher turn**; un-armed echo refused (`RECEIPT_NOT_ARMED`); single-use |
| `draftAuthorization` (bound to topic\|course\|audience\|outcomes) | server accepted the intake round | guard records it (`hasDraftAuthorization()`); required before checkpoint 2 can be teacher-confirmed |
| — (receipt ≠ decision) | answers-arrived is not decided | confirm-gate never accepts receipts/tool state as confirmation; every decision needs its own teacher turn |

## Run the tests

```sh
cd /Users/bonorinoa/Hermes/Projects/silicus-asfai-handoff/confirm-gate && node --test
```

(Node ≥ 18 required; developed and verified on Node 22. Expected: 26 tests, 0 fail —
the 22 gate/ledger cases plus 4 in `test/persistence.test.mjs` covering the replay seam.)

## Usage sketch

```js
import { TurnLedger, ResidualRuleGuard } from "./host-guard.mjs";
import { ConfirmGate } from "./confirm-gate.mjs";

const ledger = new TurnLedger();
const guard = new ResidualRuleGuard({ ledger });          // wrap prepare_outline with it
const gate = new ConfirmGate({ courseId: "urn:uuid:…", owner: "teacher:tk-1", ledger, hostGuard: guard });

// Transport hook for REAL inbound user messages (never the model):
const teacher = ledger.teacherChannel({ teacherId: "teacher:tk-1", channel: "silicus-ui" });

// Every confirmation cites a teacher turn:
const turnRef = teacher.say("Drop the third proposal.");
gate.confirmObjectives({
  provenance: { turnRef, decidedBy: "teacher:tk-1", channel: "silicus-ui", decidedAt: Date.now() },
  decisions: [{ verb: "drop", proposalId: proposed[2].id }],
});
```

Anything that fabricates the provenance (model turn, unknown turn, wrong actor, timestamps
before the turn/proposal) is rejected with `FabricatedConfirmationError` and applies
nothing.
