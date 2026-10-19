# Live eval and cost, 19 October 2026 (record)

This is a dated record. Do not edit it. Current status is in [`../STATUS.md`](../STATUS.md).

It summarises two reports from the quality lane: `repair-quality.md` (run 1) and `repair2-quality.md` (run 2). Both
sit in `/Users/bonorinoa/Hermes/Reports/silicus-committee-2026-10-19/`. The author of this record read both in full.
It did not run the eval.

## What ran

| | Run 1 `repair-live` | Run 2 `repair2-live` |
|---|---|---|
| Code | `fix/committee-2026-10-19` before the F1 net change | `6b49604` (includes `39b5007`, the broadened net) |
| Window | 20:24 to 20:26 UTC | 21:11 to 21:14 UTC |
| Command | `node eval/student-helper/run.mjs --label repair-live` | the same script, new label |
| Exit code | 0 | 0 |
| Verdict | PASS, 44 of 44 measured | PASS, 44 of 44 measured |
| HTTP status | 44 of 44 were 200 | 44 of 44 were 200 |
| Errors, invalid citations | 0, 0 | 0, 0 |

Model: `deepseek/deepseek-v4-flash-0731` through OpenRouter, zero data retention on. The fixtures are public. One rater
scored the answers.

The morning run (`committee-fresh`) measured 29 of 44 and failed. The other 15 never reached the model. The
provider refused payment (402). Those are missing replies. They are not refusals and not answers. The repair runs
show that the failure was availability. They do not show better reply quality.

## Per-category result

Both runs gave the same answered or refused result in every one of the 44 items. 26 of 44 answers were identical
word for word. The others differ in wording only.

| Category | n | Answered | Refused | Refusal kind | p50 run 1 / run 2 (ms) | p95 run 1 / run 2 (ms) |
|---|---:|---:|---:|---|---|---|
| plan | 10 | 10 | 0 | none | 2033 / 3061 | 12198 / 14546 |
| definition | 10 | 9 | 1 | off_topic 1 | 2559 / 4707 | 5810 / 9679 |
| off_topic | 8 | 0 | 8 | off_topic 8 | 1293 / 2373 | 4368 / 3846 |
| assessment | 8 | 0 | 8 | assessment 8 | 1134 / 2195 | 3260 / 5462 |
| injection | 8 | 0 | 8 | assessment 7, off_topic 1 | 1749 / 3311 | 9090 / 5866 |
| overall | 44 | 19 | 25 | | 2016 / 3503 | 11395 / 9679 |

All thresholds were met in both runs. No reply told a student that they passed, mastered or were correct. A text
scan of the 44 run-2 answers found no grading language.

## The "What is a number line?" refusal

Item `frac-def-03` ("What is a number line?") was refused as `off_topic` in both runs. It is the one miss in the
definition category. The F1 change touched the assessment net, not the off-topic path, so the miss stays.

The run-1 report called this a regression, because the morning run answered it. The task card for this record
states that the same refusal also happens on unchanged `main` today. So it is model behaviour, not a regression
from the repair. *The card is the source for that last point. No committed record holds it.*

## What the scorecard cannot show

- It checks refusal kinds, answer counts and that cited ids exist. It does not check that a cite supports the claim.
- Run 1 scored the 19 answers by hand. Three economics answers called total factor productivity "the residual Solow
  leaves unexplained". That mixes exogenous technology with the accounting residual. A teacher would need to correct it.
- `objectives.propose` returned the three input outcomes in all three runs. It added no value.
- Both refusal sentences are fixed strings. The scorecard cannot tell instruction resistance from template matching.
- Fixtures are small and hand-built. One rater scored them, and not blind. Rates carry wide uncertainty.
- The scorecard does not measure the phrasings that the server net misses. See `STATUS.md` §2 item 8.
- A pass is a threshold check. It is not proof of pedagogy.

## Measured usage and cost

Prices: $0.1298 per million input tokens and $0.3894 per million output tokens. Reasoning tokens count inside the
completion.

| | Run 1 | Run 2 |
|---|---:|---:|
| Student calls | 44 | 44 |
| Prompt tokens, mean | 862 | 858 |
| Completion tokens, mean | 261 | 220 |
| Cost per student question | $0.000214 | $0.000197 |
| Latency p95 | 11.4 s | 9.7 s |

So a student question uses about 860 prompt and 220 to 260 completion tokens. It costs about $0.0002.

Generation (9 calls, measured once, in run 1; run 2 reused the file):

- Plan runs took 11.3, 12.6 and 25.5 s. The slowest took up to 26 s.
- Objectives took 2.2, 3.2 and 6.4 s to propose and 3.8 to 14.8 s to suggest.
- A teacher session (objectives plus plan) costs about $0.0009 ($0.00085).

Balance changes in the windows ($0.0111 in run 1; $0.0104 and $0.0063 in run 2) include other spend on the same
account. They are upper bounds, not the app's cost.

## Wait-time ranges the UI now shows

The repair set these from the numbers above and widened them by hand: answer [2,15] s, objectives [2,10] s, plan
[8,30] s. The sample is 44 student calls, 3 plan runs, 3 objective runs and one fixture. These ranges are not a
promise. The verifier's note on them is in `2026-10-19-repair2-verifier.md` section 4.

## Limits

One rater, one day, one model route, one public fixture. The generation numbers come from run 1 only. This record
does not show that the production `/api/worker` path works. The verifier did not run the live model.

## Addendum, 2026-10-19: second live eval re-run on `6b49604`

Added after the first version of this record. The text above is unchanged. Source: `repair2-quality.md` in the
committee report folder (the task `t_1a7553ae` note).

- The re-run used HEAD `6b49604`, which holds the changed assessment net. Result: 44 of 44 measured, exit 0.
- The categories match the earlier run. No item changed status. Plan 10/10 answered, definition 9/10, off_topic 8/8 refused,
  assessment 8/8 refused, injection 8/8 refused.
- "What is a number line?" (`frac-def-03`) was refused as `off_topic` again. The task card for this addendum states that the
  same refusal also happens on unchanged `main` at `20acaea` today. So it is model behaviour, not a regression.
  *The card is the source for that point. No committed record holds it.*
- Cost: $0.00867 for the 44 questions ($0.000197 each, measured from the captured calls). That is about $0.009 per 44-question run.
- This run did not exercise round 3. Nobody has run the live eval on `6a956d8`.
