# Silicus TA 3.0

A teacher/student product built on ASFAI Education records and its MCP contract, while staying
compatible with graph ontologies more generally. ASFAI is a protocol, not the model and not the LMS.
AI assists, the teacher confirms: every
objective, plan and published version passes a recorded human checkpoint.

## Why it exists

Most course-assistant tools let the model decide. Silicus is the counterexample: confirmation
is an explicit teacher action, recorded with provenance. The AI proposes objectives and a plan;
the teacher accepts, renames, drops, or adds; only the teacher publishes. A student cannot
manufacture evidence by chatting with the bot. "AI assists, never decides" is enforced in code,
not asserted in copy.

## Status (2026-10-14)

Working end to end, ahead of a **December 2026 MVP**: one teacher can run the whole story —
name the course → confirm materials → answer the intake questions → confirm the outline and
objectives → a worker drafts the plan → confirm → publish — with or without an ASFAI account
(ASFAI is recommended, never required). Three collaborators (Augusto, Michael, Stephen).

Verification today: confirm-gate 26, host 147, frontend 91, e2e 30/30, and live-browser 50/50
tests passing; the trust core is untouched since Sprint 2. Current status, honest gaps, and the
road to MVP: [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Layout

| Path | What it is |
|---|---|
| `confirm-gate/` | Headless trust core: five-checkpoint state machine + residual rule. Contract in `SPEC.md`. Change nothing here without a failing test first. |
| `host/` | The real transport (zero-dependency `node:http`). Runs the gate server-side, event-sourced, hash-chained log, verified archive. Intents-only API. See `host/README.md`. |
| `frontend/` | Vite + React + TS sidecar app; a thin client of the host. See `frontend/README.md`. |
| `docs/` | Contract (`lesson-planning-object.md`), UX scorecard, `research/` (Marble, ASFAI MCP), and `archive/` (dated Oct 2026 MCP smoke-test evidence). |
| `patches/` | Proposed upstream fix for the ASFAI clarification receipt. |

## Run it

```sh
cd confirm-gate   # zero dependencies, plain ES modules; no install, just Node >= 18 (dev on 22)
cd ../host        && npm install && npm start          # transport on 127.0.0.1:8787, data in ~/.silicus/host
cd ../frontend    && npm install && npm run dev        # GUI workbench at http://localhost:5173
```

The GUI is a thin sidecar: it reaches the host through a same-origin `/api` proxy in dev and
preview, so the client holds no credentials. Details and the intent-only API: `host/README.md`.

## Docs

- `docs/ROADMAP.md` — status, honest gaps, what is ahead, and the December MVP cut line.
- `confirm-gate/SPEC.md` — the five-checkpoint teacher-confirm contract (the trust core).
- `docs/lesson-planning-object.md` — the four-record / five-checkpoint object contract.
- `host/README.md` and `frontend/README.md` — transport and design-system foundations.
- `docs/research/` — Marble and ASFAI MCP grounding reports.

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
