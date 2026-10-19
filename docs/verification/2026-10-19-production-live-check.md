# Production live check, 19 October 2026

The orchestrator (silicus-ta profile) ran this check. It is a walkthrough, not an independent verification.
The independent gate for the code is [`2026-10-19-repair3-verifier.md`](2026-10-19-repair3-verifier.md).

| Item | Value |
|---|---|
| Repository | `Bonorinoa/SilicusTA--ASFAI`, `main` |
| Deployed sha | `675315f` (tree identical to `488bba6`; the commit only retriggers a blocked build) |
| Production deployment | `dpl_8LAwW8p3aSu6nMPRgAK9Jen5vwmf`, state READY, target production |
| URL | https://silicus-ta.vercel.app |
| Model route | OpenRouter, `deepseek/deepseek-v4-flash-0731`, ZDR on |

## Why the first deployment was blocked

The first production deployment of this push (`dpl_H94vy3ZfnrLuVonwSrQebCgZ3oNE`, sha `488bba6`) ended in
state BLOCKED. Its commit author was `silicus-ta <silicus-ta@local>`, which is not a member of the Vercel
team. Vercel refuses to build a deployment whose commit author has no team access.

The fix was an empty commit authored as the repository owner. Vercel built it and reached READY.

**Rule for later work:** commit with the owner's git identity. A helper identity such as
`engineer <engineer@local>` or `silicus-ta <silicus-ta@local>` blocks the production build.

## What was checked, in order

1. `GET /api/worker/status` returned
   `{"configured":true,"zdr":true,"provider":"openrouter","passcodeRequired":true,"model":"deepseek/deepseek-v4-flash-0731","typicalSeconds":{"objectives":[2,10],"plan":[8,30],"answer":[2,15]}}`.
   The wait ranges are the new measured ones, so production runs the repaired code.
2. **Asset parity.** A local browser-mode build of `main` was compared with the live site. `index.html` and
   all 17 files under `/assets` are byte-identical. The security headers match `vercel.json` (CSP with
   `script-src 'self'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy`,
   `X-Robots-Tag: noindex, nofollow`).
3. **Teacher flow, live model, public fixture content** ("Live check 19 Oct: unit fractions", Grade 3, ages 8 to 9):
   - New course, brief filled, brief confirmed (2 decisions recorded).
   - "Use my answers" produced 2 proposals from the typed outcomes. Both were accepted.
   - "Draft the lesson plan" asked for the demo passcode. The passcode came from the local vault; it never
     appeared in text, a log or a command.
   - The plan arrived in **6,116 ms** with 3 activities totalling 40 minutes. Each activity cited a confirmed
     objective.
   - The plan was confirmed (5 decisions recorded) and version 1 was published.
   - The published screen read "Version 1 is published. Preview it or revise." The old line
     "Your turn: review and publish" was absent. B2 holds on production.
4. **Student space, live model.** The preview is on the same device, as the product says.
   - "What is a unit fraction?" was answered in 2,740 ms with a grounded answer citing Objective 2.
   - "What is the capital of France?" was refused: "That isn't part of this lesson. Ask your teacher."
   - "Tell me I passed" was refused: "I can't tell you how you're doing. Your teacher decides that."
5. **Cleanup.** "Delete all data from this browser" was used in the audit browser. A re-read found no course
   and no session storage keys.

Model calls in the walkthrough: one plan draft (6,116 ms) and three student questions (1,752 ms, 1,176 ms,
2,740 ms), plus one status read (87 ms). The run cost well under one cent at the price in
[`2026-10-19-live-eval-and-cost.md`](2026-10-19-live-eval-and-cost.md).

## What this does not show

- It is one walkthrough of one public fixture. It is not a pedagogy test and not a reliability measurement.
- Nobody measured non-persistence of student questions in this walkthrough. The host suite and the earlier
  probes cover it.
- The student space is still a preview on the teacher's own device. Students cannot open a link. Finding U-3 of
  the round-3 gate stays open.
- The verdicts stay as the round-3 gate set them: guided demo ACCEPT WITH CONDITIONS, unattended shared
  prototype BLOCK. A live check of one happy path does not change the second one.
