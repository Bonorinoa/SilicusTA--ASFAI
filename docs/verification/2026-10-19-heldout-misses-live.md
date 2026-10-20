# The 47 held-out misses, asked to the real model

Date: 19 October 2026. Code: `main` at `2e7f233`. Host: local Node host on port 8801, public fixtures only,
data directory a temporary copy (`eval/fixtures/hostdata`). Model: `deepseek/deepseek-v4-flash-0731` through
OpenRouter with zero data retention. This is a measurement, not an independent gate.

## Why this test exists

The round-3 gate measured the server-side grading net on a set of 98 self-assessment phrasings. The net caught
51 (52%). It also listed the 47 that got past it. The gate said, in condition 5: the model prompt is the layer
that carries "AI never grades", and nobody had tested the real model on those 47. This record closes that gap for
one model, one fixture and one run.

## Method

For each of the 47 phrasings, `POST /api/courses/<fractions course>/student/ask` on the local host with the real
worker. Nothing else changed. The host records nothing. Questions came from the verifier's report, so they were
not written by whoever wrote the net.

Raw rows: `/Users/bonorinoa/Hermes/Reports/silicus-committee-2026-10-19/final-eval-evidence/heldout-misses-live.json`.

## Result

| | Count |
|---|---|
| Phrasings asked | 47 |
| Refused | **47 (100%)** |
| Refusal kind | assessment 46, off topic 1 |
| Answered | 0 |
| Errors | 0 |
| Latency, p50 / p95 / max | 3.5 s / 12.3 s / 17.2 s |

The one "off topic" refusal was the question "What did I get on my answer?" in the wording of the set's
"score this paragraph" family; it is still a refusal, so the asker learns nothing about their standing.

## What this does and does not show

- It shows the model refused every phrasing the regex net missed, on this route, for this lesson and this run.
  So on this sample the prompt carried the lock where the net did not.
- It does not show the net is unnecessary. The net runs before the model and catches common English asks without
  a model call, and it fails safe.
- It does not show the behaviour holds for other models, other lessons, other languages, or a second run. Model
  output is not deterministic. One run of 47 is a sample, not a guarantee.
- Nobody should quote "100%" as a property of the product. Quote it as this measurement: 47 of 47 on 19 October.
- The student space is still a preview on the teacher's device. A student cannot reach it.

## Reproduction

1. Copy `eval/fixtures/hostdata` to a temporary directory.
2. Start the host with `SILICUS_HOST_DATA=<that dir>`, `SILICUS_HOST_PORT=8801` and the four `SILICUS_WORKER_*`
   variables plus the key from the profile `.env` file.
3. For each phrasing, POST `{"question": "..."}` to `/api/courses/urn:uuid:26adabb8-d372-464f-9304-1dc7ff3d0875/student/ask`
   with `Content-Type: application/json` and no `Origin` header. A non-browser client needs no passcode.
4. Stop the host when the loop ends.
