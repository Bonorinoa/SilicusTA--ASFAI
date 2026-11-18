# Plan quality, before and after the v2 plan prompt (14 November 2026)

**Status:** result record, dated. Do not edit; add a newer record instead.
**Branch:** `verify/p3`, from `eval/plan-v2` @ 5ba7ea3 (v2 plans). Baseline plans: `eval/plan-quality/baseline-2026-11-14/`
(branch `eval/plan-baseline` @ 5f95dde). v2 plans: `eval/plan-quality/v2-2026-11-14/`. Card t_5ce503cf (P3b).
**Scope:** numbers and caveats only. The scoring rubric, the plan texts shown to the judges, the key and both judge files are
kept outside the repository (private folder `silicus-private/plan-scoring/2026-11-14/`). This file holds no rubric text.

## What was done

- 12 plans: 3 courses x 2 runs x 2 versions (baseline, v2). Same worker model for all 12: `deepseek/deepseek-v4-flash-0731`
  (OpenRouter, zero data retention). Node v22.22.3.
- Each plan was turned into plain text by one renderer, shuffled with a sealed key (seed 20261114), and scored by two judges
  who scored alone, eight checks each, 0 to 2 per check, total 0 to 16.
- Judge A: `deepseek/deepseek-v4-flash-0731` via nous (the P3a session). Judge B: `claude-sonnet-5-5` via anthropic (agent log
  line `model=claude-sonnet-5-5 provider=anthropic`). Judge B scored before reading judge A's file or the key.
- Every number below is recomputed from the checks' scores by `p3b-analysis.py` (private folder, exit 0). Judge A's file
  states plan-11's total as 12; its eight scores sum to 10. The recomputed value is used.

## Result

| | Judge A | Judge B | mean of both |
|---|---|---|---|
| baseline, n=6, mean total of 16 | 7.33 (range 6 to 10) | 6.00 (range 5 to 7) | 6.67 |
| v2, n=6, mean total of 16 | 15.83 (range 15 to 16) | 15.17 (range 15 to 16) | 15.50 |
| difference | +8.50 | +9.17 | +8.83 |

Under both judges, every v2 plan scored higher than every baseline plan. Exact permutation test on the 12 totals: p = 1/924
for each judge, the smallest this design can give. Read it as "the two groups do not overlap", not as a precise error rate:
two runs per course are not 12 independent draws.

Per-check means (n=6 per cell):

| check | A baseline | A v2 | B baseline | B v2 |
|---|---|---|---|---|
| 1 | 2.00 | 2.00 | 1.83 | 2.00 |
| 2 | 0.33 | 2.00 | 0.33 | 2.00 |
| 3 | 1.00 | 2.00 | 1.00 | 1.83 |
| 4 | 0.33 | 2.00 | 0.17 | 2.00 |
| 5 | 1.00 | 1.83 | 1.00 | 1.83 |
| 6 | 0.00 | 2.00 | 0.00 | 2.00 |
| 7 | 1.67 | 2.00 | 1.67 | 2.00 |
| 8 | 1.00 | 2.00 | 0.00 | 1.50 |

Checks 1 and 7 start high and barely move. Checks 3, 5 and 6 depend partly on fields the baseline plan format does not
have, so a low baseline there is by construction. Checks 2, 4 and 8 are where the plan text itself changed.

Per course (total of 16, n=2 per cell):

| course | A baseline | A v2 | B baseline | B v2 |
|---|---|---|---|---|
| ai-in-daily-life (ages 5-12) | 6.50 | 16.00 | 5.50 | 15.00 |
| ecom-57-introductory-statistics (age 19) | 6.50 | 16.00 | 6.00 | 15.50 |
| smart-versus-not-smart-devices (ages 5-8) | 9.00 | 15.50 | 6.50 | 15.00 |

The gain is similar across the three courses (judge A +9.5, +9.5, +6.5; judge B +9.5, +9.5, +8.5). With two plans per cell, no
course ranking is claimed.

## Agreement between the judges

- Exact agreement on 82 of 96 scores (85.4%). By check: 11, 10, 11, 11, 12, 12, 12 and 3 of 12.
- No 2-point gap on any check, so no third judge is triggered by the rubric's rule. Adding one anyway is the owner's call.
- All 14 differences are 1 point; judge B is lower on 13 of them. Pearson r of the 12 totals: 0.985.
- Nine of the 14 differences are on check 8 (3 of 12 exact). Without check 8, agreement is 79 of 84 (94.0%). The two judges read
  that check's boundary between 0, 1 and 2 differently. This is the check to tighten if the rubric is revised.

## Caveats

1. Two runs per course, 12 plans, one worker model. No sampling-variance estimate beyond two runs.
2. The rubric is written by the same team, and the v2 prompt was written with the rubric in view. This measures whether
   the plans show the moves the rubric counts. It does not measure whether children learn.
3. Ceiling: v2 averages 15.2 to 15.8 of 16. The rubric cannot rank v2 variants against each other.
4. Not blind in form: v2 texts carry labelled lines the baseline texts do not, so a reader can tell the versions apart (judge
   B did so on all 12 texts before the key). Both judges were told to score actions, not labels.
5. Judge A is the same model as the plan writer and built the set (it saw the key once at build time, disclosed in P3a). Judge B
   is a different model family, but its task card pasted judge A's group means and two of its judgment calls before scoring.
6. The v2 run changes more than the prompt: structured age fields, a Marble anchor on 2 of 3 courses (not ecom-57), and a worker
   output cap of 65536 instead of 4000. The data cannot separate them.
7. P3a used 21 paid worker calls against a card figure of 12 (owner-authorised cap raise); the worker reports no cost.

## Not decided here

Third judge, rubric rewording, a harder-ceiling rubric, a baseline rerun with the same inputs: owner decisions.
