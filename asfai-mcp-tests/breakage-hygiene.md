# ASFAI MCP breakage (2026-10-06)

Hygiene first run: **OpenRouter 402** on `x-ai/grok-4.6` (profile default). Retried with `--model grok-4.7 --provider xai-oauth` without editing hygiene config. Probes below were run from the default-profile session that already had working MCP tools.

No Pod. No Classroom `confirmed` mutations. No `forget_*`. Server did not retain private JSON (`serverRetained: false` on mutating-shaped calls).

| ID | Probe | Result | Severity |
|---|---|---|---|
| 1 | `asfai_lesson` `create_assignment` with `confirmed: true` and stock Block Algebra lesson id, no teacher preview | **Minted** assignment `urn:uuid:850170fd-…`, `lessonVersion` 1.0.0, `verified: false`, `serverRetained: false`. Host could treat this as published. | **major** (HITL) |
| 2 | `validate_grounded_answer`: quote `"due Friday"` not in chunk that contains a prompt-injection line | `valid: false` — `quote is not an exact source span` | pass (validator) |
| 2b | `not_found` + citations | `valid: false` — must not present citations as support | pass |
| 2c | `grounded` + zero citations | `valid: false` — requires ≥1 citation | pass |
| 2d | Injection text in chunk | Validator does **not** inspect chunk for “ignore instructions”; `promptInjectionHandled` is host-claimed. Exact-span still required. | nit / host duty |
| 3 | `add_material` with `title: Section 01 grades` and `provenance.sourceName` containing Jane Doe, GPA, SID | **Accepted.** Course bumped to v2, PII string stored in provenance. No warn. | **major** (PII) |
| 4 | `record_learning` “asked a question → mastered” | Incomplete schema on first tries (`interactions`, `observedEvidence`, `assistance` enum, `assessorSystem`, `rationale`). Third attempt tripped MCP pause (~54s). **Did not prove policy rejects chat-as-mastery.** | unknown / **major if it accepts** |
| 5 | Graph `search_objectives "maximum likelihood"` | Returns ages 9–10 *Likelihood Language*, not MLE. No age/domain guard. | **blocker for university hosts** (see Script B) |
| 6 | `prepare_outline` with `learning_outcomes` snake_case | Hard error `unrecognized_keys` (not `clarifying`). Safer than silently ignoring, worse teacher UX if a host sends snake_case. | nit |
| 7 | `validate_outline` missing `section.purpose` | Not run (server pause after evidence failures). | unknown |

## What Silicus must own

1. **Refuse** graph hits whose age/subject/grain do not match the course (B1).
2. **Teacher confirm** before anything named assignment/publish/reviewed.
3. **PII scan** on material titles/provenance before `add_material`.
4. **Never** call `record_learning` from a student question; if the API allows `level: mastered` from chat, wrap it.
5. Treat citation validator as good; do not skip it.

## Hygiene

- First process: exit 1, 0 tool calls, OpenRouter credits exhausted.
- Retry: `hermes -p hygiene --model grok-4.7 --provider xai-oauth --reasoning high chat -q …` (config not changed). Add OpenRouter credits if you want hygiene’s default model back.
