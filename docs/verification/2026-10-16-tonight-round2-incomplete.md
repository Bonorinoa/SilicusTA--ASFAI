# V2 (delta fbc5750..e4b6d81) — INCOMPLETE, no verdict

Card t_a18acf77, profile `verifier`. Archived 2026-10-16 14:26 by the orchestrator after two runs ended with no
report. This is an infrastructure failure, not a finding, and it is NOT a pass.

- Run 1 (12:23-13:24): pinned to `deepseek-v4.1-flash` on nous. That id does not exist there (the real id is
  `deepseek/deepseek-v4.1-flash`); every call failed over to `stepfun/step-5-preview:free` at 9-20 min per call.
  Orchestrator error in the pin; fixed and reclaimed.
- Run 2 (13:25-14:25): correct id, but nous answered 429 "upstream capacity" with 600 s backoffs, and one fallback
  call to StepFun took 2,287 s. The run ended at the 3,600 s cap while reviewing e4b6d81.

Evidence that exists for the delta: the orchestrator's own runs at e4b6d81 (all suites green, including the
browser smokes) and a real-model walk with ASFAI (receipt "Took 25 s" for a 25.5 s step).

Disposition: the delta's scope is folded into V3 (t_3706db6b), which verifies `feat/publish-brief`; that branch
contains every commit of the delta. V3 is routed to profile `default`, grok-4.7 via xai-oauth (a different model
family from every product producer). Production (`main`) waits on V3 and on the owner's explicit green gate.
