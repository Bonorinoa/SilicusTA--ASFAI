# SilicusTA--ASFAI

Silicus TA 3.0 is being designed as a teacher/student product that integrates natively with ASFAI Education records and MCP contracts, while remaining compatible with graph ontologies more generally.

This repository currently preserves the existing ASFAI integration handoff and prototype-evaluation materials as a starting point. Product implementation and architecture decisions are intentionally pending the upstream research on Marble and the ASFAI Education MCP.

## Current materials

- `01-lesson-planning-object.md` — initial course/package/objective/lesson-plan contract and human confirmation checkpoints.
- `02-mcp-ux-scorecard.md` — teacher usefulness and integration test scorecard.
- `asfai-mcp-field-manual.html` — ASFAI MCP field manual.
- `asfai-mcp-tests/` — prior lesson-plan and MCP smoke-test artifacts.
- `patches/` — proposed upstream MCP clarification-receipt fix and issue notes.
- `research-marble-asfai-education.md` — primary-source review of Marble’s published taxonomy, licensing, and its runtime integration through ASFAI Education’s `asfai_graph` gateway.
- `research-asfai-education-mcp-implementation.md` — repository-level review of the ASFAI Education MCP gateway contract, storage boundary, teacher confirmation responsibilities, and integration implications for Silicus.

## Product boundaries to preserve

- Silicus is the teacher/student product surface; ASFAI Education is an independent records/protocol product.
- Teacher confirmation gates publication. AI proposes; it does not decide.
- Marble is an optional public skills-map alignment, not the course store, LMS, or learner database. Local objectives must remain first-class.
- Student chat is not evidence of learning. Teacher onboarding and student use are separate workflows.
- Keep the first real-user slice focused on ages 5–14; RA and graduate-school expansion is parked.

## Status

Repository initialized. Primary-source research reports on Marble and the ASFAI Education MCP are included; architecture decisions remain pending review of those findings and explicit product-contract decisions.
