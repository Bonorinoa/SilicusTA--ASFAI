# MCP UX scorecard

Fill one copy per host × script. Do not merge ChatGPT and Codex into one row.

- Tester: Augusto
- Date:
- Host: `ChatGPT web` | `Codex` | other:
- MCP endpoint / plugin name:
- Script: `A in-scope` | `B stress (ECON)`

## Scripts

### A — In-scope (December narrative)

Corpus: a short AI-literacy slide deck (or equivalent) aimed at ages ~7–11.
Goal: lesson plan that cites Marble AI-literacy nodes **and** at least one local skill the slides need that Marble lacks.
Pass: you would hand this plan to a teacher colleague without rewriting the structure.

### B — Stress (architecture, not the demo)

Corpus: ECON 167 or ECON 57 materials from Silicus 2.0.
Goal: same onboarding; almost all objectives will be **local**.
Pass: a plan exists that is about *this* course, not a forced Marble walk.
Fail: the tool insists every objective is `mt_*` or produces a K–12 plan from college slides.

## Timing

| Step | Minutes | Notes |
|---|---|---|
| Connect / auth / first successful tool call |  | |
| Upload / attach materials until the host “has” them |  | |
| Checkpoint 1 files acknowledged |  | |
| Checkpoint 3 objectives (propose + your edits) |  | |
| Checkpoint 4–5 plan confirmed |  | |
| Export JSON (or equivalent) |  | |
| **Total to confirmed plan** |  | Target: &lt; 30 min on A |

## Usefulness (1 = no, 5 = I would use this next term)

| Item | 1–5 | Comment |
|---|---|---|
| Plan has a real sequence (not a bullet dump of topics) |  | |
| Activities say what the *learner does* |  | |
| I could teach from this on Monday with light edits |  | |
| Chat did not require me to prompt-engineer |  | |
| I stayed in control (could drop/rename skills) |  | |
| Grounding: plan points at *my* files, not generic web knowledge |  | |

**Would teach from this plan?** `Y / N / only after rewrite`

## Architecture (Y/N/unclear)

| Question | Y/N | Evidence (tool name, screenshot, quote) |
|---|---|---|
| Could I add a **local** objective the map does not have? |  | |
| Did an unconfirmed proposal get treated as published? |  | |
| Did anything write into Marble / the public graph? |  | |
| Were embeddings **required** to get a plan? |  | |
| Did student-looking content get a warning? |  | |
| Is the lesson plan a structured object, or only chat prose? |  | |
| Can I export the course + plan as JSON? |  | |
| Preview-then-confirm before publish? |  | |
| Same course reloadable in a new chat? |  | |

## Host-specific

| | Notes |
|---|---|
| What broke only on this host? | |
| What the teacher would not understand (MCP, tools, hashes)? | |
| Auth / API key / plugin friction | |

## Defects (blockers first)

| ID | Severity `blocker` `major` `nit` | What happened | What should happen |
|---|---|---|---|
| 1 |  |  |  |

## Verdict for Silicus 3.0

Tick one:

- [ ] **Freeze-worthy** — I can design a GUI against these tools
- [ ] **Iterate** — useful, but tools/objects still moving (list what must freeze)
- [ ] **Wrong object** — rebuild the contract (`01-lesson-planning-object.md`) before any GUI

## Feedback note (paste to Stephen / Michael)

Three bullets max:

1. Usefulness:
2. Contract (locals / confirm / export):
3. Ask:
