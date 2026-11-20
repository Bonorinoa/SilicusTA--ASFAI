# REL2 · Release re-gate on `32b5366`, 19 November 2026

## Verdict: **SHIP WITH CONDITIONS**

The release blocker from REL is closed on this candidate. PR's paid reliability record finished **12/12 = 100%** of the plan fixtures with nearest-rank p95 **37.497 s**; PRV independently finished its four selected fixtures, and this delta re-ran the deterministic reliability gate from a clean export. The host retries one incomplete plan exactly once, persists both the retry and a final failure, and exposes the failure to the teacher. The four requested regression gates are green.

This is not a general availability guarantee or a production deployment check. The exact owner acceptance is in §5.

- **Root:** `/Users/bonorinoa/Hermes/Projects/silicus-wt/REL2`, branch `verify/release2`.
- **Candidate:** `32b53666b279efc18eaab54d36b4b863f0f76a25` (`main` when the worktree was made).
- **Node:** `/Users/bonorinoa/.local/bin/node`, `v22.22.3`.
- **Verifier route:** `/Users/bonorinoa/.hermes/profiles/verifier/logs/agent.log:7053-7130` records this session as `model=gpt-5.6-sol provider=openai-codex` with no fallback line.
- **Fence:** candidate code was read-only. Clean exports and mutations were under `/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/prv-plan-reliability-lcd_e44x/`. The only candidate-worktree write is this record. No push, deploy, PR, email, paid call, credential read, or private source-text copy occurred. The unrelated deletions already present in the root checkout (`docs/cards/2026-11-14/P1V.md`, `docs/cards/2026-11-14/create-p1.sh`) were observed before worktree creation and were not touched.

## 1. Plan reliability

The immutable PR record, `docs/verification/2026-11-19-plan-reliability.md`, reports **12/12 finished (100%)**, nearest-rank p50 **15.470 s**, p95 **37.497 s**, zero retries and zero failed fixtures. PRV's record, `docs/verification/2026-11-19-plan-reliability-gate.md`, independently reports **4/4 finished**, p95 **29.182 s**, one attempt each. Both records name one OpenRouter DeepSeek route and synthetic public-safe stand-ins; they do not erase L2's earlier failures or establish general availability.

I ran the committed PRV probe against the merged candidate, without `--live`:

```sh
env -u PYTHONPATH /Users/bonorinoa/.local/bin/python3 \
  docs/verification/2026-11-19-plan-reliability-gate-probe.py \
  --candidate 32b53666b279efc18eaab54d36b4b863f0f76a25 --keep
# exit 0
```

The clean-export reliability suite itself was:

```sh
/Users/bonorinoa/.local/bin/node --test eval/plan-reliability/run.test.mjs
# exit 0: 3 pass, 0 fail
```

The suite proves twelve named fixtures, structural plan completeness, and the host paths for one retry plus persisted final failure.

### Retry and teacher-visible failure

Yes. `host/course.mjs:764-785` makes the first attempt, records `plan.draft_retried`, makes exactly one second attempt for a retryable failure, and records `plan.draft_failed` if that attempt also fails. `host/activity.mjs` maps those persisted events to teacher activity rows. The teacher-facing copy is:

> “Retried the lesson plan after an incomplete reply”
>
> “Could not finish the lesson plan after retrying”

The returned failure is `PLAN_DRAFT_FAILED` with:

> “Silicus couldn't finish this plan. Try again, or shorten the sources.”

The clean host suite includes both replay checks: one truncated plan is retried and then drafted; two bad replies produce the named failure and the persisted teacher-visible row.

### The truncation guard bites

The probe made a separate clean export, changed the scripted worker so `short-stage-1` truncates on both attempts, and ran the same reliability suite:

```sh
/Users/bonorinoa/.local/bin/node --test eval/plan-reliability/run.test.mjs
# child exit 1, expected by the probe: 2 pass, 1 fail
```

The failure is not silent. It reports `PLAN_DRAFT_FAILED` and the teacher sentence above instead of a completed fixture. The parent probe therefore exited 0 only because it required this mutated child to exit 1.

## 2. Condition 3: owner acceptance, not a defect

“AI never grades” is still layered rather than guaranteed semantically:

1. **Prompt.** `host/worker.mjs:993-998` tells the model to choose `kind: "assessment"` for grade/pass/mastery/progress requests and says: “Chat is not evidence of learning; never say a student has mastered anything.”
2. **Refusal flag.** `host/student.mjs:552-557` converts the model's `refusal: "assessment"` or `kind: "assessment"` to fixed host refusal text.
3. **Partial nets.** `host/student.mjs:553-555` applies the input net `looksLikeAssessment`; `:580-582` applies the output net `judgesStudent`. The source itself says at `:158`: “It is a SAFETY NET, not a guarantee.”

The shipped landing copy does not use the word “guarantee”; it makes the owner-approved categorical claim at `frontend/src/landing/Landing.tsx:35`:

> “Never grades students. The helper answers only from what you published, and points questions about progress back to you. Questions aren’t saved. The provider’s terms apply to what it receives.”

That categorical product copy is accepted here only under the project's locked interpretation: prompt + refusal flag + partial input/output nets, **not** a semantic guarantee. This remains an owner acceptance and is not reclassified as a code defect.

## 3. Requested regressions from a clean export

The probe made `git archive` export `32b5366`, ran `npm ci` in the exported `frontend/`, and used the absolute Node path. The requested gates were unpiped and their direct child exits were captured:

| Command | Exit | Result |
|---|---:|---:|
| `(cd confirm-gate && /Users/bonorinoa/.local/bin/node --test)` | 0 | 52/52 pass |
| `(cd host && /Users/bonorinoa/.local/bin/node --test)` | 0 | 486/486 pass |
| `/Users/bonorinoa/.local/bin/node frontend/scripts/studio-smoke.mjs` | 0 | 108/108 pass |
| `/Users/bonorinoa/.local/bin/node frontend/scripts/narrow-shell.mjs` | 0 | 68/68 pass |

No host lockfile exists, so there was no host dependency install to run. The probe also ran its broader inherited matrix; this verdict depends only on the four requested rows and the plan-reliability row above.

## 4. Vercel plan path versus the local host

I read `api/_lib/worker.mjs` and ran a direct comparison of its exported settings/body builder with the local worker constants and shared task policy:

```sh
/Users/bonorinoa/.local/bin/node --input-type=module -e '<assert Vercel and local plan policy/caps>'
# exit 0
# localDefault=16000, vercelDefault=16000
# localCeiling=32000, vercelCeiling=32000
# localPlanReasoning={"enabled":false}
# vercelPlanReasoning={"enabled":false}
```

**Match:** for the OpenAI/OpenRouter wire used by Vercel, both paths set plan reasoning **off** (`reasoning: {enabled:false}`), default to **16,000** output tokens, and clamp an override at **32,000**. Vercel derives this from the server-owned task name and drops client-supplied reasoning and token values.

**Differences:**

- Vercel is OpenRouter-only. The local host can also use the native Anthropic wire; on that wire the OpenAI-format reasoning field is omitted, so “off” is not transmitted as `{enabled:false}`.
- Vercel adds a 115 s upstream deadline inside a 120 s serverless function, plus passcode, request-size, per-IP and daily limits. The local `PlanWorker` defaults to 120 s in a long-lived process and has no Vercel limiter/cold-start layer.
- Vercel is a stateless worker proxy for the browser-owned record. The local host owns the disk record. These authority and operational differences are unchanged.

There is no reasoning/cap mismatch on the intended Vercel/OpenRouter plan path.

## 5. Exact conditions the owner accepts

1. **AI-never-grades condition.** The categorical product copy rests on a model prompt, model refusal flag, and partial input/output nets. It is not a semantic guarantee.
2. **Measured reliability, not availability guarantee.** The closing live evidence is one 12-fixture run on one model route with synthetic stand-ins, plus PRV's four-call subset and deterministic gates. It closes REL's measured plan blocker; it does not guarantee future provider availability and does not erase the earlier L2 failures.
3. **Production environment remains unproved.** This exact SHA was not deployed or exercised against Vercel environment variables, DNS/egress, cold starts, rate limits or the live production model route. Code-path parity is green; deployed-environment parity remains open.

Nothing in this delta closes REL's other before-11-December roadmap items; they remain scheduled and must not be presented as already closed.

## 6. Artifact and open work

- Verification record: `docs/verification/2026-11-19-release-gate-2.md` on `verify/release2`.
- Reproduction probe used unchanged: `docs/verification/2026-11-19-plan-reliability-gate-probe.py`.
- Logs: `/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/prv-plan-reliability-lcd_e44x/logs/` (scratch, not committed).
- **Open:** production deployment/live exercise; broader provider availability; previously scheduled non-blocking release conditions.

Under those explicit owner acceptances, the delta verdict is **SHIP WITH CONDITIONS**.
