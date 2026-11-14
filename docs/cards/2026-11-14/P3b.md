# P3b · Second blind judge, agreement, and the before/after result

Folder `/Users/bonorinoa/Hermes/Projects/silicus-private/plan-scoring/2026-11-14/` (P3a made it). Rubric: the frozen v0.3 page 2
plus decisions, in `/Users/bonorinoa/Hermes/Projects/silicus-private/plan-rubric/`.

1. **Score first, unblinded never.** Score the 12 plan texts yourself (judge B, Claude Sonnet) without reading `key.json` or
   `judge-deepseek.md`. Write `judge-sonnet.md` in the rubric's output format.
2. Then read judge A's file. Report per-criterion exact agreement and every 2-point gap (list them; the rubric sends those to a third
   judge, which is the owner's call, not yours).
3. Then open the key. Report baseline vs v2: mean total per judge, per-criterion means, per course, with n=6 each and the honest
   caveats (two runs per course, one model, same-author rubric, the v2 prompt was written with the rubric in view, so this measures
   whether the plans show the moves, not whether children learn).
4. Write `result.md` in the private folder, and a short public summary for the repo on branch `verify/p3` from `eval/plan-v2`:
   `docs/verification/2026-11-14-plan-quality-before-after.md` with numbers and caveats only, **no rubric text**.

Fence: no product change. Do not edit the judges' files after the key is opened.
