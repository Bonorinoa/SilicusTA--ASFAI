# Silicus TA 3.0

A teacher/student product built on ASFAI Education records and its MCP contract, while staying
compatible with graph ontologies more generally. AI assists, the teacher confirms: every
objective, plan and published version passes a recorded human checkpoint.

## Layout

| Path | What it is |
|---|---|
| `confirm-gate/` | Headless trust core: five-checkpoint state machine + residual rule. Contract in `SPEC.md`. Change nothing here without a failing test first. |
| `host/` | The real transport (zero-dependency `node:http`). Runs the gate server-side, event-sourced, hash-chained log, verified archive. Intents-only API. See `host/README.md`. |
| `frontend/` | Vite + React + TS sidecar app; a thin client of the host. See `frontend/README.md`. |
| `docs/` | Contract (`lesson-planning-object.md`), UX scorecard, `research/` (Marble, ASFAI MCP), and `archive/` (dated Oct 2026 MCP smoke-test evidence). |
| `patches/` | Proposed upstream fix for the ASFAI clarification receipt. |

## Verify

    cd confirm-gate && node --test
    cd host && node --test && node scripts/e2e-restart.mjs
    cd frontend && npm test && npm run build && node scripts/live-host-smoke.mjs

## Boundaries to preserve

- Silicus is the product surface; ASFAI Education is an independent records/protocol product.
- Teacher confirmation gates publication. AI proposes; it does not decide.
- Marble is optional alignment, not the course store. Local objectives are first-class.
- Student chat is not evidence. Teacher onboarding and student use are separate.
- First real-user slice is ages 5-14; RA and graduate school are parked.
