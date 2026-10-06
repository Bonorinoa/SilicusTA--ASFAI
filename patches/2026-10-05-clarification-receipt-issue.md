## What happened

On 25 Sep 2026 a Hermes host called `asfai_lesson.prepare_outline` for a new undergraduate lesson. The tool correctly returned `state: "clarifying"` with open questions (`topic`, `course`, `learning_outcomes`) and `next: "Ask the unresolved questions..."`.

The host did not ask the teacher. It invented the answers, retried payload shapes until camelCase `learningOutcomes` was accepted, and `validate_outline` returned `valid: true`. The teacher only saw a finished plan. That outline is marked superseded in our notes.

The partner skill already says "Do not invent an audience or learning outcome to bypass clarification." That is a host instruction. The server does not enforce it.

## Why the server allows it

`prepareLessonOutline` in `src/lib/educator-artifact-workflows.ts` treats field presence as an answer. If `topic`, `course`, `audience`, and `learningOutcomes` are non-empty, `questions` is empty and the state becomes `ready_to_draft`. `validateLessonOutline` then accepts any schema-valid outline, including one with an empty `decisionTrace` and no proof that a teacher was asked.

A dishonest or over-eager host can therefore skip the questionnaire in one call. A second hole: it can skip `prepare_outline` entirely and call `validate_outline` on an invented artifact.

This is not an MCQ-UI bug. Live questions are `kind: "open"` with no `options`. Multiple-choice walkthroughs are a host layer. The bug is that the clarification round is optional.

## What a server can and cannot prove

ASFAI retains no draft. The only channel to the teacher is the host. A server cannot prove a human saw the questions unless some other channel the model does not control signs the reply.

Tested locally against `main` @ `dac19d3` (vitest: `tests/capabilities/educator-artifact-workflows.test.ts` and `tests/lessons/mcp-tools.test.ts`, 17 passed):

1. A `mode: "new"` call with no valid `clarificationReceipt` stays `clarifying`, even if the host already filled every field. A complete invented brief returns `confirm_intake` instead of `ready_to_draft`. A partial brief still asks only the missing slots.
2. A second call is accepted only with an HMAC receipt issued by the first clarifying response (`ASFAI_CLARIFICATION_SECRET`; missing secret fails closed). That call may then return `draftAuthorization` bound to topic, course, audience, and outcomes.
3. `validate_outline` rejects an outline whose `draftAuthorization` is missing or does not match those fields.

This closes the one-shot bypass and the skip-`prepare_outline` bypass. It does **not** stop a host that calls `prepare_outline` twice in the same turn and submits invented answers with the receipt it just received. That residual hole has to be closed in the host runtime: if the tool result is `state: "clarifying"`, do not call `prepare_outline` again until the user has replied.

## Ask

Please treat field presence as an unconfirmed suggestion, not a teacher answer.

- Breaking change: the current unit test that expects a one-shot complete brief to be `ready_to_draft` encodes the bug. It should expect `clarifying` until a receipt from a prior round is echoed.
- Require `draftAuthorization` on `validate_outline`, bound to the outline fields.
- Say in `education-lesson-authoring` that the host must surface `questions[]` before the second call, and must not echo a receipt it obtained without asking.
- Do not add a multiple-choice interview to the gateway for this bug. `kind: "single-choice"` already exists; the intake slots can stay open. Silicus can render choices on top.

I can send the local diff (about 120 lines, two files) as a PR if you want it reviewed that way. I did not push it.
