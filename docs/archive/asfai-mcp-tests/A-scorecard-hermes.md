# MCP UX scorecard — Script A / Hermes

- Tester: Augusto + Hermes (this session)
- Date: 2026-10-06
- Host: Hermes desktop (native `asfai_learning` tools)
- MCP: `https://constitution.asfai.org/education/api/mcp` (asfai-learning **v2.0.0**)
- Script: **A in-scope**

## Script A result

Corpus: **equivalent**, not a real slide PDF — a one-hour 7–9 AI-literacy unit assumed from a short deck (objects, sort pile, Teachable Machine).
Public nodes used: `mt_ofOGCQ7FWj` Patterns and Classification; `mt_K6qtan847r` Machine Learning Basics. Light touch on prereq `mt_kH1DzOPsXG` Data and unlock `mt_bPFToj0OhZ` AI Mistakes.
Local outcome: train/test a two-class model; few vs many examples.
Pass bar: would hand this plan to a colleague without rewriting the **structure**. **Y** (they still pick objects / device policy).

## Timing (this session, agent-operated — not a teacher at the keyboard)

| Step | Minutes | Notes |
|---|---|---|
| Connect / first tool | ~0 | Already OAuth’d; `manifest` + `get_skill` worked |
| Upload materials | n/a | No file ingest this script |
| Graph search + neighbors | ~1 | `search_objectives "machine learning"`; `get_neighbors` on ML basics |
| `prepare_outline` | <1 | First call `state: ready_to_draft` (flat `learningOutcomes` array) |
| Draft + `validate_outline` | ~5 | First validate: **`valid: true`**, `nextState: reviewed` |
| Export JSON | yes | `A-ai-literacy-outline.json` + plan md |
| **Total to validated outline** | ~10 agent-min | Teacher-at-keyboard time not measured |

## Usefulness (1–5) — judge as if you were the teacher

| Item | 1–5 | Comment |
|---|---|---|
| Plan has a real sequence | 5 | Hook → sort → three steps → lab → miss → individual exit |
| Activities say what the learner does | 5 | |
| Teach Monday with light edits | 4 | Needs real objects + device/fallback decision |
| Did not require prompt-engineering | 4 | Host followed partner skill; teacher would still need checkpoints in a GUI |
| Stayed in control | 3 | **No human confirm gates in the protocol this path** — outline went draft→validated without a teacher click |
| Grounding in *my* files | 2 | No materials package; graph + invented stand-in deck |

**Would teach from this plan?** `Y` with device/policy edits.

## Architecture (Y/N)

| Question | Y/N | Evidence |
|---|---|---|
| Could I add a **local** objective the map does not have? | **Y** | Outcome 3 (train/test) accepted as a plain string; no `mt_*` required |
| Did an unconfirmed proposal get treated as published? | **N** | `status: draft`; `next: Do not publish`; storage caller-owned |
| Did anything write into Marble? | **N** | Search/neighbors only |
| Were embeddings **required**? | **N** | Outline validated with no vectors |
| Student-looking content warning? | n/a | No upload |
| Lesson plan a structured object, not only chat prose? | **Y** | `kind: lesson-outline` JSON; rich plan is host-side markdown (validator strips activities) |
| Export course + plan as JSON? | **partial** | Outline JSON yes; no `CoursePackage` / `add_material` this script |
| Preview-then-confirm before publish? | **partial** | Validate ≠ teacher confirm; no `confirm_lesson_plan` tool |
| Same course reloadable in a new chat? | **N** | Not saved (`asfai_storage` `not_connected`); files only on disk |

## Host-specific (Hermes)

| | Notes |
|---|---|
| Broke only here? | Tools are one-call-at-a-time; ChatGPT might batch. Not a teacher UX. |
| What a teacher would not understand | Gateway names, `prepare_outline` camelCase, `get_neighbors` |
| Auth | Already done; Pod still `not_connected` |

## Defects

| ID | Severity | What happened | What should happen |
|---|---|---|---|
| A1 | major | No teacher checkpoint in MCP for “accept these 4 outcomes” | Preview-then-confirm before `nextState: reviewed` |
| A2 | major | No course/material objects on this path — plan is not grounded in files | Ingest + `materialVersionIds` on activities |
| A3 | nit | `suggestedActivities` always `[]` after validate | Allow optional activity stubs or keep them host-only (documented) |
| A4 | nit | Graph search “machine learning” also returns Learning-to-Learn / entrepreneurship | Host must filter by subject/domain (we did) |

## Verdict for Silicus 3.0

- [x] **Iterate** — outline loop is freeze-adjacent for *authoring a spine*; not freeze-worthy as a product until HITL confirm + materials package exist
- [ ] Freeze-worthy
- [ ] Wrong object

Artifacts:
- `docs/archive/asfai-mcp-tests/A-ai-literacy-outline.json`
- `docs/archive/asfai-mcp-tests/A-ai-literacy-lesson-plan.md`
