# N5 item 6: student-helper tuning (reasoning off vs low, a prompt fix), 18 November 2026

Card N5 (t_7e862f33), item 6, added by the PM on 18 Nov. Branch `feat/n5` in the worktree
`/Users/bonorinoa/Hermes/Projects/silicus-wt/N5`. Node v22.22.3. The PM capped this item at $0.05 and 60 model calls.
The credential came through `SILICUS_WORKER_ENV_FILE=~/.silicus/worker.env`. The runner and I never read that file;
the host launcher (`host/scripts/with-worker-env.mjs`) reads it.

## Why

The PM's paid eval on `main` @ `1cec646` (`eval/student-helper/scorecard-paid-2026-11-18b.md`, helper reasoning off,
which N1 set) failed two behaviour bars: `clarify.kind` 1/3 and `general.match` 2/5. Every safety bar passed.

## What I ran

Two paid runs, 29 questions each, so 58 model calls. Both used the five categories the PM named: clarify 3,
general 5, nudge 2, assessment 11 and injection 8. Two runner and host changes made the runs possible. Both are
committed on `feat/n5`:

- `--only <categories>` on `eval/student-helper/run.mjs`. The runner applies thresholds only to the categories it
  asked.
- `SILICUS_WORKER_ANSWER_REASONING` and `SILICUS_WORKER_LOG_USAGE=1` in the Node host (`host/server.mjs`), for tuning
  runs only. The first overrides the helper's reasoning; when it is unset, `TASK_REASONING` (answer: off) stays in
  force. The second logs one line per call with its token counts and the cost the route reports, never any content.
  The runner sums these lines into `usage-<label>.json`.

```
SILICUS_WORKER_ENV_FILE=~/.silicus/worker.env SILICUS_WORKER_ANSWER_REASONING=low \
  node eval/student-helper/run.mjs --root "$PWD" --label n5-low --only clarify,general,nudge,assessment,injection      # exit 0
SILICUS_WORKER_ENV_FILE=~/.silicus/worker.env SILICUS_WORKER_ANSWER_REASONING=off \
  node eval/student-helper/run.mjs --root "$PWD" --label n5-off-prompt --only clarify,general,nudge,assessment,injection  # exit 2
```

## Results

| setting | clarify | general | nudge | assessment | injection | p50 | p95 | cost (route-reported) | calls |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| off, `main` prompt (the PM's record `paid-2026-11-18b`, all 68 questions; not re-run here) | **1/3 FAIL** | **2/5 FAIL** | 2/2 | 11/11 | 8/8 | 938 ms | 3714 ms | not recorded | 68 |
| **low**, `main` prompt (`scorecard-n5-low.md`) | 3/3 | 5/5 | 2/2 | 11/11 | 8/8 | 3575 ms | **11878 ms** | $0.00559 | 29 |
| **off**, prompt fix (`scorecard-n5-off-prompt.md`) | 3/3 | **1/5 FAIL** | 2/2 | 11/11 | 8/8 | 837 ms | 6264 ms | $0.00302 | 29 |

Total spent: $0.00861 over 58 calls, within the cap. With low, the run used 11,658 reasoning tokens out of 12,854
output tokens. With off, it used 0 out of 1,023. Low took more than 8 s on assessment (p95 11.9 s) and general
(p95 12.3 s). No reply hit the 20 s deadline: the runs had 0 errors.

**The prompt fix** (reasoning off) had two parts:

1. **clarify.** A message that asks nothing (a single word, a topic name, a short phrase) is clarify, even when the
   model could explain the word. The fix adds one example (`"photosynthesis"` -> clarify) and says that a real
   question is not clarify. **Result: 3/3, up from 1/3.**
2. **18+ general.** The fix gave an order to decide in (package first, then the course's subject = general, then
   off_topic), with one example taken from a different subject. **Result: 1/5, so no better than 2/5.** The misses
   were "What is entropy?" (answered as clarify), two refused as off_topic, and one answered through a try-first
   nudge. A host test also pins the adult lines, and it failed with this text. **I reverted this part.** `feat/n5`
   keeps only the clarify part.

## The pick (part c): no setting I measured passes every bar with p95 under 8 s

- **Low** passes every bar, but its p95 is 11.9 s.
- **Off with the prompt fix** meets the latency bar (p95 6.3 s) and fixes clarify, but fails `general.match`.

I did not change `TASK_REASONING`, so the helper is still **off**, and the 20 s deadline is unchanged. `feat/n5`
holds only the clarify part of the prompt fix. That combination (the clarify fix plus the `main` adult lines) was
**not measured as a whole**: the 60-call cap left no room for a third run. Its general rate is expected to be near
`main`'s 2/5. The `definition` and `plan` categories were not run with the clarify fix. The new rule says a real
"what does X mean" question is not clarify, but it could still lower `definition.answered`.

Decisions for the PM:

- Accept low (all bars pass) and relax the 8 s p95.
- Or keep off and get the 18+ general rate some other way. Options are a second prompt iteration measured on all
  68 questions, or `answer: low` for adult courses only.

Both need a paid run larger than this card's cap.

## Not verified

- The model name that served these runs. It is in the env file, which I did not read, and the usage lines were in
  the runner's temporary log, which the runner deletes.
- The full 68-question set with the clarify fix.
- Low on the under-18 categories.
