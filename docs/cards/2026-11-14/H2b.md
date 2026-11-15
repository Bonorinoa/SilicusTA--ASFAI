# H2b · Map layout, a coherent demo plan, full suites, fresh screenshots

Continue in `/Users/bonorinoa/Hermes/Projects/silicus-wt/G2`, branch `feat/g2` (H and H2a done; read H2a's summary only).

## Do, in this order (commit a checkpoint after each)

1. **Neighbourhood view layout** (`frontend/src/studio/graph/SkillMap.tsx`): node titles wrap inside their box (today
   "Computers in Everyday Life" overflows); edges enter a target at separate points, not one shared point; order each column to avoid
   crossings when a reorder can (barycentre order is enough). Unit test for wrap and order on the `mt_AzTrT5ySCx` neighbourhood.
2. **A coherent scripted plan.** The scripted/mock worker used by `studio-smoke.mjs` and the screenshot scripts drafts "How plants eat"
   inside the course "AI around us", so every screenshot looks broken. Make the scripted v2 plan match the anchored smoke course
   (AI in Daily Life, ages 5–12): a 30–40 minute lesson, 3 activities covering phases 1, 2 and 3–4, an opening bet on the hard
   prerequisite (Smart Versus Not-Smart Devices), one session evidence line, two spaced reviews, and objectives that cite the course's
   own objectives. Add a second scripted plan for a stage-3 course (ages 12–14, any Computing topic) where one activity asks for AI
   with no first try, so the host's clamp produces a visible "Silicus adjusted" note. Keep the v1 scripted plan for the v1 tests.
   This is test fixture content, not a product claim; label it as scripted in its file.
3. **All STATUS §3 suites + `narrow-shell.mjs`** on Node 22, from the worktree root. Fix only what fails.
4. **Screenshots**, same names under `docs/img/` (wizard step 1, graph objectives, graph plan, plan v2 desktop / 390 / print) plus
   `docs/img/2026-11-14-plan-v2-stage3.png`. Look at each one before committing and list anything still wrong in your report.

Commit on `feat/g2`, no push.

## Fence

No `confirm-gate/`, no `api/`. `host/` only for the scripted worker fixtures and their tests.
