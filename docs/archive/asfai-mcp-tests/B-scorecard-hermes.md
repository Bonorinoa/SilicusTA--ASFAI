# MCP UX scorecard — Script B / Hermes

- Tester: Augusto + Hermes (this session)
- Date: 2026-10-06
- Host: Hermes desktop (native `asfai_learning`)
- MCP: asfai-learning v2.0.0
- Script: **B stress (ECON 167)**

## Result

Graph `search_objectives "maximum likelihood"` returned **children's probability language** (`Likelihood Language`, ages 9–10) and a PSD risk node — **not** MLE. Host filtered them out and minted **local** outcomes. `prepare_outline` → `ready_to_draft`. `validate_outline` → **`valid: true`**.

Pass bar: plan is about *this* course, not a forced Marble walk. **Y** at the outline layer.

Fail bar (MCP insists every objective is `mt_*`): **did not fail**.

Caveat: no ECON 167 PDF ingest this run. Outcome 3 (course analogy) and 4 (limitation from notes) are **placeholders until materials exist**. That is the point of the local/unknown pattern.

## Timing

| Step | Notes |
|---|---|
| Graph search | Misleading hits; must not auto-bind |
| prepare_outline | First call ready |
| validate_outline | First call valid |
| Course package / files | not run |

## Architecture

| Question | Y/N |
|---|---|
| Local objectives without Marble IDs | **Y** |
| Wrote into Marble | **N** |
| Embeddings required | **N** |
| Teacher confirm before reviewed | **N** (same as A) |
| Grounded in lecture PDFs | **N** — no `add_material` |
| Would a naive host have used `mt_iFFKZd-Vgv` (Likelihood Language)? | **Risk: yes** — Silicus must refuse age/domain mismatch |

## Defects

| ID | Severity | What | Should |
|---|---|---|---|
| B1 | **blocker for product** | Search "maximum likelihood" ranks K–9 *likelihood words* | Filter by subject/age; or return "no public match — use local" |
| B2 | major | No file grounding | Course package path |
| B3 | major | `nextState: reviewed` without teacher click | HITL confirm |

## Verdict

- [x] **Iterate** — local-outcome authoring works; graph search is a footgun for university
- [ ] Freeze-worthy
- [ ] Wrong object (the outline object is fine)

Artifacts: `B-econ167-outline.json`
