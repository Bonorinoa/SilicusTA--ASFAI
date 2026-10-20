# For early testers: what to try, and what is not real yet

Version: 19 October 2026. Site: https://silicus-ta.vercel.app. Source: `main` at `2e7f233`.
Owner: Augusto. Ask him for the demo passcode.

This page is for teachers who will try the prototype. It says what works, what does not, and what to tell us.
It does not replace [`STATUS.md`](STATUS.md), which is the full state of the product.

## What it is

Silicus plans a lesson with an AI that proposes. You decide. You type a brief, Silicus proposes objectives from
your own words or from your sources, drafts activities that cite your confirmed objectives, and publishes a
version. Your decisions are recorded in a hash-chained log that you can export.

A teacher of learners aged 5 to 14 is the intended user. Nothing here grades a student.

## What works today

- Create a course with a title, your name and the names of your sources.
- Confirm a brief from your own topic, audience and outcomes.
- Accept, edit or drop each proposed objective. The AI never accepts one for you.
- Draft a lesson plan from the confirmed objectives. It takes about 5 to 15 seconds, sometimes up to 30.
- Confirm the plan and publish a version. Published versions do not change; later edits become the next version.
- Preview the student space on your own device. It answers questions about the lesson, refuses questions
  outside the lesson, and refuses questions about how a student is doing.
- Export the published version, the student handout, and a backup of your courses.
- Reload the page. Your courses come back from this browser.

## What is not real yet, and what to say instead

| Do not say | Say instead |
|---|---|
| "Your students can open this" | "The student space is a preview on this device. Students cannot open a link yet." |
| "The AI can never grade" | "The AI is told not to grade, and the server refuses common ways of asking. It is not a guarantee." |
| "Your sources are never stored" | "Source text is read in this tab and forgotten when you reload. A course made before 19 October, or imported from a backup, can still hold text." |
| "It is always fast" | "Answers usually take 2 to 15 seconds; a plan usually takes 8 to 30 seconds." |
| "The log cannot be changed" | "The log shows tampering. It is tamper-evident, not tamper-proof." |

## Known rough edges, 19 October

- **Basic vocabulary can be refused.** "What is a number line?" is refused as off-topic in a fractions lesson.
  This is model behaviour, seen on the older build too. Ask a question that names the lesson's own idea.
- **The grading net is partial.** The server check catches about half of phrasings written cold. The model refused
  47 of 47 held-out phrasings on 19 October, so the refusal you see usually comes from the model, not the net. One
  model, one run: do not treat a refusal as a guarantee.
- **A published version can include an objective the plan does not cite.** The publish screen does not warn yet.
- **Long titles and descriptions are not limited.**
- **The ASFAI connection does not work in a browser tab.** Its registration and token endpoints do not send the
  headers a browser needs. The Node host works.
- **Students cannot log in, and no student record is kept.** This is a design limit, not a bug.

## How to report a problem

Send Augusto: what you clicked, what you expected, what happened, and a screenshot if you can. If an answer
looked wrong, paste the question and the answer. Do not paste anything about a real student.

## Where the evidence is

- [`STATUS.md`](STATUS.md): what is built and what is open.
- [`verification/2026-10-19-repair3-verifier.md`](verification/2026-10-19-repair3-verifier.md): the independent
  gate that allowed a guided demo and blocked an unattended one.
- [`verification/2026-10-19-production-live-check.md`](verification/2026-10-19-production-live-check.md): the
  walkthrough on the live site.
- [`verification/2026-10-19-live-eval-and-cost.md`](verification/2026-10-19-live-eval-and-cost.md): the live
  eval results and the cost per question.
