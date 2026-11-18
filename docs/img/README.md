# docs/img — screenshots

Screenshots for the docs and the demo round of 14 November 2026, taken by the
frontend smoke scripts (`frontend/scripts/browser-mode-smoke.mjs`,
`frontend/scripts/narrow-shell.mjs`).

## Scripted fixture plans — not model output

All four `2026-11-14-plan-v2-*.png` images render **scripted fixture plans**
from `host/test/scripted-course.mjs` (`scriptedPlanV2`), not live model output:

| Image | Fixture |
|---|---|
| `plan-v2-desktop.png`, `plan-v2-390.png`, `plan-v2-print.png` | 5–12 "AI in Daily Life" course, plan "Spotting AI in daily life" |
| `plan-v2-stage3.png` | stage-3 Computing course (12–14), plan "How a computer finds things fast" |

The plan travels the host's real worker path, but the worker reply is the
fixture, so the images are deterministic and reproducible without a model
credential.

- Rendered 2026-11-14 (H2b round).
- `plan-v2-stage3.png` refreshed 2026-11-17 (H3): the clamp note names
  activity 3 and the card itself shows the "AI removed by Silicus" marker.

The other images are interactive studio steps with no plan and no worker:
`2026-11-14-wizard-step1-{desktop,390}.png` (course wizard) and
`2026-11-14-graph-{objectives,plan}-{desktop,390}.png` (objectives /
pre-draft neighbourhood graph from the Marble snapshot).
